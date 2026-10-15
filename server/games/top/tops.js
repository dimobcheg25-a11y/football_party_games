// «Топ-10»: усі теми-топи, які можна загадати, будуються з нашої бази при старті.
// Трансфери й вартість — server/data/transfers.json (Transfermarkt; legends до ~2012 — частково, див. manual-transfers.js),
// голи й матчі — кар'єри з Вікіпедії (голи в чемпіонатах за кожен клуб, матчі й голи за збірну).
// Топ = [{ player, value, detail }] за спаданням; гравець може бути в топі кілька разів (два великі трансфери) —
// тоді, назвавши його, відкриваєш усі його рядки.
const { players, playerById } = require('../../data');
const { careerOf, team, teams } = require('../path/careers');
const { leagueOf, nationName, money } = require('../guess/compare');

let transfers = {};
let tmClubs = {};
let tournaments = {};
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
const CATEGORIES = { transfers: 'Трансфери', goals: 'Голи', apps: 'Матчі' };
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

const fame = (p) => p.fame || 0;
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

// ── бомбардири турнірів (з Вікіпедії); топ обрізаємо перед першим гравцем, якого немає в базі
const TOURNAMENTS = { wc: 'чемпіонатів світу', euro: 'чемпіонатів Європи', ucl: 'Ліги чемпіонів (і Кубка європейських чемпіонів)', uel: 'Ліги Європи (і Кубка УЄФА)' };
for (const [key, title] of Object.entries(TOURNAMENTS)) {
  const list = tournaments[key] || [];
  const cut = list.findIndex(([id]) => !id || !playerById.has(id));
  const known = (cut === -1 ? list : list.slice(0, cut)).map(([id, g]) => ({ p: playerById.get(id), value: g, text: `${g} ${goalsWord(g)}`, detail: null }));
  addTopic(`tournament:${key}`, 'goals', `Найкращі бомбардири ${title}`, known, 'Голи у фінальних турнірах — за Вікіпедією.');
}

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
const LEAGUE_COUNTRY = { GB1: 'Англія', ES1: 'Іспанія', IT1: 'Італія', L1: 'Німеччина', FR1: 'Франція', UKR1: 'Україна', PO1: 'Португалія', NL1: 'Нідерланди', TR1: 'Туреччина' };
for (const t of topics) {
  const [kind, key] = t.id.split(':');
  if (kind === 'buys' || kind === 'sales') Object.assign(t, { kind: 'club', country: leagueOf(tmClubs[key].team), club: clubName(Number(key)) });
  else if (kind === 'club-goals' || kind === 'club-apps') Object.assign(t, { kind: 'club', country: leagueOf(key), club: clubTitle(key) });
  else if (kind === 'league-buys') Object.assign(t, { kind: 'league', country: LEAGUE_COUNTRY[key] });
  else if (kind === 'league-goals') Object.assign(t, { kind: 'league', country: key });
  else if (kind.startsWith('nation')) Object.assign(t, { kind: 'nation', country: nationName(key) });
  else if (kind === 'tournament') t.kind = 'tournament';
  else t.kind = 'general';
}

const topicById = new Map(topics.map((t) => [t.id, t]));

// Теми, з яких можна скласти топ такого розміру.
function topicsFor(categories, size) {
  return topics.filter((t) => categories.includes(t.category) && t.entries.length >= size);
}

module.exports = { topics, topicById, topicsFor, SIZES, CATEGORIES };
