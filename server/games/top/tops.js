// «Топ-10»: усі теми-топи, які можна загадати, будуються з нашої бази при старті.
// Трансфери й вартість — server/data/transfers.json (Transfermarkt; legends до ~2012 — частково, див. manual-transfers.js),
// голи й матчі — кар'єри з Вікіпедії (голи в чемпіонатах за кожен клуб, матчі й голи за збірну),
// асисти, гол+пас, рекорди сезону, картки — stats.json (Transfermarkt, з 2012/13), бомбардири турнірів — tournaments.json.
// Топ = [{ p, value, text, detail }] за спаданням; гравець може бути в топі кілька разів (два великі трансфери, кілька сезонів) —
// тоді, назвавши його, відкриваєш усі його рядки. p = null — гравця немає в базі: тоді є name, і рядок відкрито одразу (без очок).
const { players, playerById } = require('../../data');
const { careerOf, team, teams, poolFor, recognition } = require('../path/careers');
const { leagueOf, nationName, money } = require('../guess/compare');

let transfers = {};
let tmClubs = {};
let tournaments = {};
let stats = { names: {}, comp: {}, club: {} };
try {
  stats = require('../../data/stats.json');
} catch {
  // асисти й рекорди сезону ще не зібрані (npm run build-stats)
}
try {
  tournaments = require('../../data/tournaments.json');
} catch {
  // бомбардири турнірів ще не зібрані (npm run build-tournaments)
}
try {
  transfers = require('../../data/transfers.json');
  tmClubs = require('../../data/transfer-clubs.json');
} catch {
  // трансфери ще не зібрані (npm run build-transfers) — лише голи й матчі
}

const SIZES = [5, 10, 20];
const CATEGORIES = { transfers: 'Трансфери', goals: 'Голи', assists: 'Асисти', apps: 'Матчі й кар’єра', cards: 'Картки' };
// Скільки рядків топу можна відкрити одразу (гравців немає в базі): більше — тема для цього розміру не годиться.
const MAX_MISSING = 0.25;
// Ліги Transfermarkt → як ми їх називаємо (лише ті, де є з чого скласти топ).
const TM_LEAGUES = {
  GB1: 'Прем’єр-ліги', ES1: 'Ла Ліги', IT1: 'Серії A', L1: 'Бундесліги', FR1: 'Ліги 1', UKR1: 'УПЛ',
  PO1: 'чемпіонату Португалії', NL1: 'Ередивізі', TR1: 'Суперліги Туреччини',
};
// Голи за клуби країни (у всіх чемпіонатах, де ці клуби грали: для України — і чемпіонат СРСР, для Англії — і нижчі ліги).
const COUNTRY_CLUBS = {
  Англія: 'англійські', Іспанія: 'іспанські', Італія: 'італійські', Німеччина: 'німецькі', Франція: 'французькі', Україна: 'українські',
  Нідерланди: 'нідерландські', Португалія: 'португальські', Туреччина: 'турецькі', Шотландія: 'шотландські', Бразилія: 'бразильські',
  Аргентина: 'аргентинські', Бельгія: 'бельгійські', Греція: 'грецькі',
};

const fame = (p) => p?.fame || 0;
const ukr = (p) => {
  const n = careerOf(p)?.nation;
  return !!n && teams[n.t]?.name === 'Україна';
};
// росію й білорусь не загадуємо.
const BANNED = new Set(['Росія', 'Білорусь']);
// Однакові назви клубів (кілька «Динамо», «Металургів») — уточнюємо містом; інакше — країною.
const CITY = {
  Q388972: 'Донецьк', Q935956: 'Запоріжжя', Q44295: 'Київ', Q2382113: 'Харків', Q2084417: 'Алчевськ', Q2233089: 'Кам’янське',
  Q616528: 'Донецьк', Q1981637: 'Кропивницький', Q704: 'Ліон', Q172803: 'Загреб', Q141931: 'Дрезден', Q204237: 'Бухарест',
};
const sameName = new Map(); // назва → скільки клубів-тем її мають (заповнюється нижче, коли відомо, які клуби стануть темами)
function clubTitle(q) {
  const name = team(q).name.replace(/\s*\(футбольний клуб,\s*([^)]+)\)/, ' $1');
  if (CITY[q]) return `${name} (${CITY[q]})`;
  return sameName.get(teams[q]?.name) > 1 && !/\(/.test(name) ? `${name} (${leagueOf(q)})` : name;
}
const clubName = (id) => {
  const c = tmClubs[id];
  if (!c) return '?';
  return c.team ? clubTitle(c.team) : c.name;
};
const goalsWord = (n) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? 'гол' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'голи' : 'голів';
};
const appsWord = (n) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? 'матч' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'матчі' : 'матчів';
};

// Усі платні трансфери наших гравців.
const fees = [];
for (const p of players) {
  for (const [fee, from, to, season] of transfers[p.id]?.fees || []) fees.push({ p, fee, from, to, season });
}
const feeEntry = (f) => ({ p: f.p, value: f.fee, text: money(f.fee), detail: `${clubName(f.from)} → ${clubName(f.to)}, ${f.season}` });
// «17/18» → 2017 (сезони до 2000-го: «99/00» → 1999)
const seasonStart = (season) => { const y = Number(String(season).slice(0, 2)); return y > 50 ? 1900 + y : 2000 + y; };
const ageAt = (f) => (f.p.born ? seasonStart(f.season) - f.p.born : null); // вік — приблизно (±1 рік)

// Голи й матчі за кожен клуб (за кількома періодами в одному клубі — сумарно) і за збірну.
const byClub = new Map(); // qid → Map(player → { g, a })
const byLeague = new Map(); // країна → Map(player → { g, a })
const byNation = new Map(); // qid збірної → [{ p, g, a }]
for (const p of players) {
  const c = careerOf(p);
  if (!c) continue;
  for (const x of c.clubs) {
    const add = (map, key) => {
      if (!map.has(key)) map.set(key, new Map());
      const m = map.get(key);
      const cur = m.get(p) || { g: 0, a: 0 };
      m.set(p, { g: cur.g + (x.g || 0), a: cur.a + (x.a || 0) });
    };
    add(byClub, x.t);
    const league = leagueOf(x.t);
    if (league) add(byLeague, league);
  }
  if (c.nation) {
    if (!byNation.has(c.nation.t)) byNation.set(c.nation.t, []);
    byNation.get(c.nation.t).push({ p, g: c.nation.g || 0, a: c.nation.a || 0 });
  }
}

// Топ із записів: за спаданням, серед рівних — відоміший вище; нулі не беремо.
function rank(entries) {
  return entries.filter((e) => e.value > 0).sort((a, b) => b.value - a.value || fame(b.p) - fame(a.p));
}

const NOTES = {
  transfers: 'За Transfermarkt; переходи до ~2012 року — не всі.',
  goals: 'Голи в чемпіонатах (без кубків і єврокубків) — за таблицями кар’єри у Вікіпедії.',
  apps: 'Матчі в чемпіонатах — за таблицями кар’єри у Вікіпедії.',
  nation: 'Офіційні матчі за збірну — за Вікіпедією.',
};
// Клуби, які стануть темами: зіставлені клуби Transfermarkt і відомі клуби з голами/матчами. Серед них шукаємо однакові назви.
const knownClub = (qid, map) => teams[qid] && !teams[qid].national && !BANNED.has(leagueOf(qid))
  && (teams[qid].cat || (leagueOf(qid) === 'Україна' && [...map.values()].filter((v) => v.g > 0).length >= 40));
const topicClubs = new Set([
  ...Object.values(tmClubs).filter((c) => c.team && c.league).map((c) => c.team),
  ...[...byClub].filter(([q, map]) => knownClub(q, map)).map(([q]) => q),
]);
for (const q of topicClubs) sameName.set(teams[q]?.name, (sameName.get(teams[q]?.name) || 0) + 1);

const topics = []; // { id, category, title, note, entries }
function addTopic(id, category, title, entries, note = NOTES[category]) {
  const list = rank(entries);
  if (list.length >= SIZES[0]) topics.push({ id, category, title, note, entries: list.slice(0, 20) });
}

// ── трансфери
addTopic('fees', 'transfers', 'Найдорожчі трансфери в історії', fees.map(feeEntry));
addTopic('fees-ua', 'transfers', 'Найдорожчі трансфери українців', fees.filter((f) => ukr(f.p)).map(feeEntry));
addTopic('total-fees', 'transfers', 'Найбільша сума трансферів за кар’єру', players.filter((p) => transfers[p.id]?.totalFees)
  .map((p) => ({ p, value: transfers[p.id].totalFees, text: money(transfers[p.id].totalFees), detail: `${transfers[p.id].paid} ${transfers[p.id].paid === 1 ? 'трансфер' : transfers[p.id].paid < 5 ? 'трансфери' : 'трансферів'}` })));
addTopic('max-value', 'transfers', 'Найвища ринкова вартість за кар’єру', players.filter((p) => transfers[p.id]?.maxValue)
  .map((p) => ({ p, value: transfers[p.id].maxValue, text: money(transfers[p.id].maxValue), detail: null })));
// покупки й продажі клубів — лише клуби, які ми знаємо (зіставлені з нашою базою)
const clubIds = Object.keys(tmClubs).filter((id) => tmClubs[id].team && tmClubs[id].league && !BANNED.has(leagueOf(tmClubs[id].team)));
for (const id of clubIds) {
  const n = Number(id);
  const name = clubName(n);
  addTopic(`buys:${id}`, 'transfers', `Найдорожчі покупки: ${name}`, fees.filter((f) => f.to === n).map(feeEntry));
  addTopic(`sales:${id}`, 'transfers', `Найдорожчі продажі: ${name}`, fees.filter((f) => f.from === n).map(feeEntry));
}
for (const [code, name] of Object.entries(TM_LEAGUES)) {
  addTopic(`league-buys:${code}`, 'transfers', `Найдорожчі покупки клубів ${name}`, fees.filter((f) => tmClubs[f.to]?.league === code).map(feeEntry));
}

// ── трансфери за віком, позицією, збірною, десятиліттям, між лігами
const AGE_NOTE = 'За Transfermarkt; вік — приблизно (рік сезону мінус рік народження).';
addTopic('fees-age:u21', 'transfers', 'Найдорожчі трансфери гравців до 21 року', fees.filter((f) => ageAt(f) != null && ageAt(f) <= 20).map(feeEntry), AGE_NOTE);
addTopic('fees-age:30', 'transfers', 'Найдорожчі трансфери гравців від 30 років', fees.filter((f) => ageAt(f) >= 30).map(feeEntry), AGE_NOTE);
const POS_GROUPS = {
  GK: ['воротарів', ['Goalkeeper']],
  DEF: ['захисників', ['Centre-Back', 'Left-Back', 'Right-Back']],
  MID: ['півзахисників', ['Defensive Midfield', 'Central Midfield', 'Attacking Midfield', 'Left Midfield', 'Right Midfield']],
  FWD: ['нападників і вінгерів', ['Left Winger', 'Right Winger', 'Second Striker', 'Centre-Forward']],
};
for (const [key, [word, list]] of Object.entries(POS_GROUPS)) {
  const has = (p) => list.includes(transfers[p.id]?.pos);
  addTopic(`fees-pos:${key}`, 'transfers', `Найдорожчі трансфери ${word}`, fees.filter((f) => has(f.p)).map(feeEntry), 'За Transfermarkt; позиція — основна на Transfermarkt.');
  addTopic(`value-pos:${key}`, 'transfers', `Найвища ринкова вартість ${word}`, players.filter((p) => has(p) && transfers[p.id].maxValue)
    .map((p) => ({ p, value: transfers[p.id].maxValue, text: money(transfers[p.id].maxValue), detail: null })), 'За Transfermarkt; позиція — основна на Transfermarkt.');
}
const feesByNation = new Map();
for (const f of fees) {
  const n = careerOf(f.p)?.nation?.t;
  if (!n) continue;
  if (!feesByNation.has(n)) feesByNation.set(n, []);
  feesByNation.get(n).push(f);
}
for (const [q, list] of feesByNation) {
  const name = nationName(q);
  if (!name || BANNED.has(name) || name === 'Україна' || list.length < 20) continue; // українці — окрема тема вище
  addTopic(`fees-nation:${q}`, 'transfers', `Найдорожчі трансфери гравців збірної: ${name}`, list.map(feeEntry));
}
for (const decade of [2000, 2010, 2020]) {
  addTopic(`fees-decade:${decade}`, 'transfers', `Найдорожчі трансфери ${decade}-х`, fees.filter((f) => seasonStart(f.season) >= decade && seasonStart(f.season) < decade + 10).map(feeEntry));
}
const MOVE_LEAGUES = { GB1: 'АПЛ', ES1: 'Ла Ліга', IT1: 'Серія A', L1: 'Бундесліга', FR1: 'Ліга 1', PO1: 'Португалія', NL1: 'Ередивізі', UKR1: 'УПЛ' };
for (const from of Object.keys(MOVE_LEAGUES)) {
  for (const to of Object.keys(MOVE_LEAGUES)) {
    if (from === to) continue;
    addTopic(`fees-move:${from}>${to}`, 'transfers', `Найдорожчі переходи: ${MOVE_LEAGUES[from]} → ${MOVE_LEAGUES[to]}`,
      fees.filter((f) => tmClubs[f.from]?.league === from && tmClubs[f.to]?.league === to).map(feeEntry));
  }
}

// ── бомбардири турнірів (з Вікіпедії); кого немає в базі — відкритий рядок з іменем
const TOURNAMENTS = { wc: 'чемпіонатів світу', euro: 'чемпіонатів Європи', copa: 'Кубка Америки', ucl: 'Ліги чемпіонів (і Кубка європейських чемпіонів)', uel: 'Ліги Європи (і Кубка УЄФА)' };
for (const [key, title] of Object.entries(TOURNAMENTS)) {
  const list = (tournaments[key] || []).map(([id, g, name]) => ({
    p: playerById.get(id) || null, name: name ? name.replace(/\s*\(.*\)$/, '') : null, value: g, text: `${g} ${goalsWord(g)}`, detail: null,
  }));
  const where = key === 'ucl' || key === 'uel' ? 'в основному турнірі (без кваліфікації)' : 'у фінальних турнірах';
  addTopic(`tournament:${key}`, 'goals', `Найкращі бомбардири ${title}`, list, `Голи ${where} — за Вікіпедією.`);
}

// ── асисти, гол+пас, рекорди сезону й картки (Transfermarkt, з 2012/13)
const byTm = new Map(Object.entries(transfers).filter(([, v]) => v.tm).map(([id, v]) => [v.tm, playerById.get(id)]));
const statEntry = (word) => ([tm, v, season]) => ({
  p: byTm.get(tm) || null, name: stats.names[tm] || '?', value: v, text: `${v} ${word(v)}`, detail: season ? `сезон ${season}` : null,
});
const plural3 = (one, few, many) => (n) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const W = {
  assists: plural3('асист', 'асисти', 'асистів'), ga: plural3('гол+пас', 'гол+пас', 'гол+пас'), goals: goalsWord,
  yellow: plural3('жовта', 'жовті', 'жовтих'), red: plural3('червона', 'червоні', 'червоних'),
};
const COMP_NAMES = {
  GB1: 'АПЛ', ES1: 'Ла Ліга', IT1: 'Серія A', L1: 'Бундесліга', FR1: 'Ліга 1', UKR1: 'УПЛ', PO1: 'чемпіонат Португалії', NL1: 'Ередивізі',
  TR1: 'чемпіонат Туреччини', BE1: 'чемпіонат Бельгії', SC1: 'чемпіонат Шотландії', CL: 'Ліга чемпіонів', EL: 'Ліга Європи',
};
const STATS_NOTE = 'З сезону 2012/13 — за Transfermarkt.';
for (const [comp, t] of Object.entries(stats.comp)) {
  const name = COMP_NAMES[comp];
  if (!name) continue;
  const one = ['CL', 'EL'].includes(comp) ? 'за один розіграш' : 'за сезон';
  addTopic(`stat:${comp}:assists`, 'assists', `Найбільше асистів: ${name} (з 2012/13)`, t.assists.map(statEntry(W.assists)), STATS_NOTE);
  addTopic(`stat:${comp}:ga`, 'assists', `Найбільше гол+пас: ${name} (з 2012/13)`, t.ga.map(statEntry(W.ga)), STATS_NOTE);
  addTopic(`stat:${comp}:seasonGoals`, 'goals', `Найбільше голів ${one}: ${name}`, t.seasonGoals.map(statEntry(W.goals)), STATS_NOTE);
  addTopic(`stat:${comp}:seasonAssists`, 'assists', `Найбільше асистів ${one}: ${name}`, t.seasonAssists.map(statEntry(W.assists)), STATS_NOTE);
  addTopic(`stat:${comp}:yellow`, 'cards', `Найбільше жовтих карток: ${name} (з 2012/13)`, t.yellow.map(statEntry(W.yellow)), STATS_NOTE);
  addTopic(`stat:${comp}:red`, 'cards', `Найбільше червоних карток: ${name} (з 2012/13)`, t.red.map(statEntry(W.red)), STATS_NOTE);
}
for (const [club, t] of Object.entries(stats.club)) {
  const c = tmClubs[club];
  if (!c?.team || BANNED.has(leagueOf(c.team))) continue;
  const name = clubName(Number(club));
  addTopic(`club-stat:${club}:assists`, 'assists', `Найбільше асистів: ${name} (з 2012/13)`, t.assists.map(statEntry(W.assists)), STATS_NOTE);
  addTopic(`club-stat:${club}:ga`, 'assists', `Найбільше гол+пас: ${name} (з 2012/13)`, t.ga.map(statEntry(W.ga)), STATS_NOTE);
}

// ── «мандрівники»: найбільше різних клубів за кар'єру
// лише впізнавані (топ-1300 за відомістю), інакше топ складався б із невідомих мандрівників нижчих ліг
addTopic('journeymen', 'apps', 'Найбільше клубів за кар’єру', poolFor('all', 'fan').map((p) => {
  const n = new Set((careerOf(p)?.clubs || []).map((x) => x.t)).size;
  return { p, value: n, text: `${n} ${plural3('клуб', 'клуби', 'клубів')(n)}`, detail: null };
}), 'Різні клуби в кар’єрі (з орендами) — за Вікіпедією.');

// ── голи й матчі за клуби: лише відомі клуби (є категорія в базі) і українські
// відомі клуби (є категорія в базі) і українські, у яких забивали щонайменше 40 гравців з бази (без нижчих ліг)
for (const [qid, map] of byClub) {
  if (!knownClub(qid, map)) continue;
  const name = clubTitle(qid);
  const list = [...map].map(([p, v]) => ({ p, ...v }));
  addTopic(`club-goals:${qid}`, 'goals', `Найкращі бомбардири: ${name}`, list.map((x) => ({ p: x.p, value: x.g, text: `${x.g} ${goalsWord(x.g)}`, detail: `${x.a} ${appsWord(x.a)}` })));
  addTopic(`club-apps:${qid}`, 'apps', `Найбільше матчів: ${name}`, list.map((x) => ({ p: x.p, value: x.a, text: `${x.a} ${appsWord(x.a)}`, detail: `${x.g} ${goalsWord(x.g)}` })));
}
for (const [country, map] of byLeague) {
  if (!COUNTRY_CLUBS[country]) continue;
  const list = [...map].map(([p, v]) => ({ p, ...v }));
  addTopic(`league-goals:${country}`, 'goals', `Найбільше голів за ${COUNTRY_CLUBS[country]} клуби`, list.map((x) => ({ p: x.p, value: x.g, text: `${x.g} ${goalsWord(x.g)}`, detail: `${x.a} ${appsWord(x.a)}` })));
}
for (const [qid, list] of byNation) {
  const name = nationName(qid);
  if (!name || BANNED.has(name) || list.length < 20) continue;
  addTopic(`nation-goals:${qid}`, 'goals', `Найкращі бомбардири збірної: ${name}`, list.map((x) => ({ p: x.p, value: x.g, text: `${x.g} ${goalsWord(x.g)}`, detail: `${x.a} ${appsWord(x.a)}` })), NOTES.nation);
  addTopic(`nation-caps:${qid}`, 'apps', `Найбільше матчів за збірну: ${name}`, list.map((x) => ({ p: x.p, value: x.a, text: `${x.a} ${appsWord(x.a)}`, detail: `${x.g} ${goalsWord(x.g)}` })), NOTES.nation);
}

// Для вибору теми господарем: тип (загальні / клуб / ліга / збірна / турнір), країна й клуб — щоб фільтрувати список.
const LEAGUE_COUNTRY = {
  GB1: 'Англія', ES1: 'Іспанія', IT1: 'Італія', L1: 'Німеччина', FR1: 'Франція', UKR1: 'Україна', PO1: 'Португалія', NL1: 'Нідерланди',
  TR1: 'Туреччина', BE1: 'Бельгія', SC1: 'Шотландія',
};
for (const t of topics) {
  const [kind, key, sub] = t.id.split(':');
  if (kind === 'stat') {
    if (sub === 'seasonGoals' || sub === 'seasonAssists') Object.assign(t, { kind: 'season', country: LEAGUE_COUNTRY[key] || null });
    else if (key === 'CL' || key === 'EL') t.kind = 'tournament';
    else Object.assign(t, { kind: 'league', country: LEAGUE_COUNTRY[key] });
  } else if (kind === 'club-stat') Object.assign(t, { kind: 'club', country: leagueOf(tmClubs[key].team), club: clubName(Number(key)) });
  else if (kind === 'fees-nation') Object.assign(t, { kind: 'nation', country: nationName(key) });
  else if (['fees-age', 'fees-pos', 'value-pos', 'fees-decade', 'fees-move', 'journeymen'].includes(kind)) t.kind = 'misc';
  else if (kind === 'buys' || kind === 'sales') Object.assign(t, { kind: 'club', country: leagueOf(tmClubs[key].team), club: clubName(Number(key)) });
  else if (kind === 'club-goals' || kind === 'club-apps') Object.assign(t, { kind: 'club', country: leagueOf(key), club: clubTitle(key) });
  else if (kind === 'league-buys') Object.assign(t, { kind: 'league', country: LEAGUE_COUNTRY[key] });
  else if (kind === 'league-goals') Object.assign(t, { kind: 'league', country: key });
  else if (kind.startsWith('nation')) Object.assign(t, { kind: 'nation', country: nationName(key) });
  else if (kind === 'tournament') t.kind = 'tournament';
  else t.kind = 'general';
}

// Популярність теми — середній рейтинг відомості (той самий, що й для рівнів складності в інших іграх) гравців її топ-10;
// кого немає в базі — 0. Рівень: верхні 30% — легкі, наступні 40% — середні, решта — складні.
const LEVELS = ['easy', 'normal', 'hard'];
const recCache = new Map();
const rec = (p) => {
  if (!p) return 0;
  if (!recCache.has(p.id)) recCache.set(p.id, recognition(p));
  return recCache.get(p.id);
};
for (const t of topics) {
  const head = t.entries.slice(0, 10);
  t.score = Math.round(head.reduce((s, e) => s + rec(e.p), 0) / head.length);
}
const byScore = [...topics].sort((a, b) => b.score - a.score);
byScore.forEach((t, i) => (t.level = i < byScore.length * 0.3 ? 'easy' : i < byScore.length * 0.7 ? 'normal' : 'hard'));

const topicById = new Map(topics.map((t) => [t.id, t]));

// Тема годиться для топу такого розміру: рядків досить і серед них не забагато гравців, яких немає в базі.
const fitsSize = (t, size) => t.entries.length >= size && t.entries.slice(0, size).filter((e) => !e.p).length <= size * MAX_MISSING;
function topicsFor(categories, size) {
  return topics.filter((t) => categories.includes(t.category) && fitsSize(t, size));
}

module.exports = { topics, topicById, topicsFor, fitsSize, SIZES, CATEGORIES, LEVELS };
