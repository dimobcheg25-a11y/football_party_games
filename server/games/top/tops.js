// «Топ-10»: усі теми-топи, які можна загадати, будуються з нашої бази при старті.
// Трансфери й вартість — server/data/transfers.json (Transfermarkt; legends до ~2012 — частково, див. manual-transfers.js),
// голи й матчі — кар'єри з Вікіпедії (голи в чемпіонатах за кожен клуб, матчі й голи за збірну),
// асисти, гол+пас, рекорди сезону, картки — stats.json (Transfermarkt, з 2012/13), бомбардири турнірів — tournaments.json,
// трофеї (скільки разів виграв) — honours.json (server/data/honours.js), рейтинги «Золотого м'яча» — ballon.json,
// зріст — facts.json, хто кому асистував — assists.json.
// Топ = [{ p, value, text, detail }] за спаданням; гравець може бути в топі кілька разів (два великі трансфери, кілька сезонів) —
// тоді, назвавши його, відкриваєш усі його рядки. p = null — гравця немає в базі: тоді є name, і рядок відкрито одразу (без очок).
// Тексти тем — парами T(укр, англ) (server/core/i18n.js): гравець бачить свою мову.
const { players, playerById, categories: categoriesList } = require('../../data');
const { careerOf, team, teams, poolFor, recognition } = require('../path/careers');
const compare = require('../guess/compare');
const { T } = require('../../core/i18n');
const { countryEn, teamEn } = require('../../data/names-en');
const { honoursOf, nationTitles, summary, leaguesText, NATION_KEYS } = require('../../data/honours');

// Назви країн / збірних тут — рядки-ключі (порівнюються, групуються), тому завжди українською; англійська — через countryEn.
const leagueOf = (q) => { const x = compare.leagueOf(q); return x == null ? x : String(x); };
const nationName = (q) => { const x = compare.nationName(q); return x == null ? x : String(x); };
const moneyUk = (v) => (v >= 1e6 ? `€${Number((v / 1e6).toFixed(v < 1e7 ? 1 : 0))} млн` : `€${Math.round(v / 1e3)} тис.`);
const moneyEn = (v) => (v >= 1e6 ? `€${Number((v / 1e6).toFixed(v < 1e7 ? 1 : 0))}m` : `€${Math.round(v / 1e3)}k`);
const money = (v) => T(moneyUk(v), moneyEn(v));
const en1 = (n, one, many) => `${n} ${n === 1 ? one : many}`; // «1 goal», «5 goals»
const countryT = (uk) => (uk == null ? null : T(uk, countryEn(uk)));

let transfers = {};
let tmClubs = {};
let tournaments = {};
let stats = { names: {}, comp: {}, club: {} };
let ballon = {};
let awards = { fifpro: {}, goldenBoy: {} };
let facts = {};
let assists = { names: {}, to: {}, by: {} };
try {
  ballon = require('../../data/ballon.json');
} catch {
  // рейтинги «Золотого м'яча» ще не зібрані (npm run build-ballon)
}
try {
  awards = require('../../data/awards.json');
} catch {
  // FIFPRO World 11 і Golden Boy ще не зібрані (npm run build-awards)
}
try {
  facts = require('../../data/facts.json');
} catch {
  // зріст ще не зібраний (npm run build-facts)
}
try {
  assists = require('../../data/assists.json');
} catch {
  // хто кому асистував — ще не зібрано (npm run build-assists)
}
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
const CATEGORIES = {
  transfers: T('Трансфери', 'Transfers'), goals: T('Голи', 'Goals'), assists: T('Асисти', 'Assists'),
  apps: T('Матчі й кар’єра', 'Appearances & career'), cards: T('Картки', 'Cards'), trophies: T('Трофеї', 'Trophies'),
  ballon: T('Золотий м’яч', 'Ballon d’Or'), awards: T('Нагороди', 'Awards'), height: T('Зріст', 'Height'),
};
// Скільки рядків топу можна відкрити одразу (гравців немає в базі): більше — тема для цього розміру не годиться.
const MAX_MISSING = 0.25;
// Ліги Transfermarkt → як ми їх називаємо (лише ті, де є з чого скласти топ).
const TM_LEAGUES = {
  GB1: 'Прем’єр-ліги', ES1: 'Ла Ліги', IT1: 'Серії A', L1: 'Бундесліги', FR1: 'Ліги 1', UKR1: 'УПЛ',
  PO1: 'чемпіонату Португалії', NL1: 'Ередивізі', TR1: 'Суперліги Туреччини',
};
const TM_LEAGUES_EN = {
  GB1: 'Premier League', ES1: 'La Liga', IT1: 'Serie A', L1: 'Bundesliga', FR1: 'Ligue 1', UKR1: 'Ukrainian Premier League',
  PO1: 'Primeira Liga', NL1: 'Eredivisie', TR1: 'Süper Lig',
};
// Голи за клуби країни (у всіх чемпіонатах, де ці клуби грали: для України — і чемпіонат СРСР, для Англії — і нижчі ліги).
const COUNTRY_CLUBS = {
  Англія: 'англійські', Іспанія: 'іспанські', Італія: 'італійські', Німеччина: 'німецькі', Франція: 'французькі', Україна: 'українські',
  Нідерланди: 'нідерландські', Португалія: 'португальські', Туреччина: 'турецькі', Шотландія: 'шотландські', Бразилія: 'бразильські',
  Аргентина: 'аргентинські', Бельгія: 'бельгійські', Греція: 'грецькі',
};
const COUNTRY_CLUBS_EN = {
  Англія: 'English', Іспанія: 'Spanish', Італія: 'Italian', Німеччина: 'German', Франція: 'French', Україна: 'Ukrainian',
  Нідерланди: 'Dutch', Португалія: 'Portuguese', Туреччина: 'Turkish', Шотландія: 'Scottish', Бразилія: 'Brazilian',
  Аргентина: 'Argentine', Бельгія: 'Belgian', Греція: 'Greek',
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
const CITY_EN = {
  Донецьк: 'Donetsk', Запоріжжя: 'Zaporizhzhia', Київ: 'Kyiv', Харків: 'Kharkiv', Алчевськ: 'Alchevsk', 'Кам’янське': 'Kamianske',
  Кропивницький: 'Kropyvnytskyi', Ліон: 'Lyon', Загреб: 'Zagreb', Дрезден: 'Dresden', Бухарест: 'Bucharest',
};
const sameName = new Map(); // назва → скільки клубів-тем її мають (заповнюється нижче, коли відомо, які клуби стануть темами)
const sameNameEn = new Map(); // те саме для англійських назв
// Назва клубу для теми — українською (рядок: ключ для фільтрів і групування).
function clubTitleUk(q) {
  const name = team(q).name.replace(/\s*\(футбольний клуб,\s*([^)]+)\)/, ' $1');
  if (CITY[q]) return `${name} (${CITY[q]})`;
  return sameName.get(teams[q]?.name) > 1 && !/\(/.test(name) ? `${name} (${leagueOf(q)})` : name;
}
function clubTitleEn(q) {
  const name = teamEn(q, team(q));
  if (CITY[q] && sameNameEn.get(name) > 1) return `${name} (${CITY_EN[CITY[q]] || CITY[q]})`;
  return sameNameEn.get(name) > 1 && !/\(/.test(name) ? `${name} (${countryEn(leagueOf(q))})` : name;
}
const clubTitle = (q) => T(clubTitleUk(q), clubTitleEn(q));
const clubName = (id) => {
  const c = tmClubs[id];
  if (!c) return T('?', '?');
  return c.team ? clubTitle(c.team) : T(c.name, c.name);
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
const feeEntry = (f) => {
  const from = clubName(f.from), to = clubName(f.to);
  return { p: f.p, value: f.fee, text: money(f.fee), detail: T(`${from.uk} → ${to.uk}, ${f.season}`, `${from.en} → ${to.en}, ${f.season}`) };
};
const goalsT = (n) => T(`${n} ${goalsWord(n)}`, en1(n, 'goal', 'goals'));
const appsT = (n) => T(`${n} ${appsWord(n)}`, en1(n, 'app', 'apps'));
const capsT = (n) => T(`${n} ${appsWord(n)}`, en1(n, 'cap', 'caps'));
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
  transfers: T('Скільки клуб заплатив за перехід (це не ринкова вартість). Дані з Transfermarkt, і переходів до 2012 року там бракує.', 'The fee a club paid for the move (not market value). Data from Transfermarkt, which is missing some transfers before 2012.'),
  goals: T('Лише голи в чемпіонатах, без кубків і єврокубків. Дані з таблиць кар’єри у Вікіпедії.', 'League goals only, no cups or European competitions. Data from Wikipedia career tables.'),
  apps: T('Лише матчі в чемпіонатах. Дані з таблиць кар’єри у Вікіпедії.', 'League appearances only. Data from Wikipedia career tables.'),
  nation: T('Офіційні матчі за збірну, дані з Вікіпедії.', 'Official international matches, data from Wikipedia.'),
  trophies: T('Скільки разів гравець виграв трофей — за статтею про нього у Вікіпедії. Трофеї, виграні тренером, не рахуються.', 'How many times the player won a trophy, from his Wikipedia article. Titles won as a manager don’t count.'),
};
// Клуби, які стануть темами: зіставлені клуби Transfermarkt і відомі клуби з голами/матчами. Серед них шукаємо однакові назви.
const knownClub = (qid, map) => teams[qid] && !teams[qid].national && !BANNED.has(leagueOf(qid))
  && (teams[qid].cat || (leagueOf(qid) === 'Україна' && [...map.values()].filter((v) => v.g > 0).length >= 40));
const topicClubs = new Set([
  ...Object.values(tmClubs).filter((c) => c.team && c.league).map((c) => c.team),
  ...[...byClub].filter(([q, map]) => knownClub(q, map)).map(([q]) => q),
]);
for (const q of topicClubs) {
  sameName.set(teams[q]?.name, (sameName.get(teams[q]?.name) || 0) + 1);
  const en = teamEn(q, teams[q]);
  sameNameEn.set(en, (sameNameEn.get(en) || 0) + 1);
}

const topics = []; // { id, category, title, note, entries } — title, note, text, detail — пари T(укр, англ)
function addTopic(id, category, title, entries, note = NOTES[category]) {
  const list = rank(entries);
  if (list.length >= SIZES[0]) topics.push({ id, category, title, note, entries: list.slice(0, 20) });
}

// ── трансфери
const PEAK_NOTE = T('Найвища оцінка гравця на Transfermarkt за всю кар’єру. Це не поточна вартість і не сума трансферу.', 'The player’s highest Transfermarkt valuation over his whole career. Not his current value and not a transfer fee.');
addTopic('fees', 'transfers', T('Найдорожчі трансфери в історії', 'Most expensive transfers ever'), fees.map(feeEntry));
addTopic('fees-ua', 'transfers', T('Найдорожчі трансфери українців', 'Most expensive Ukrainian transfers'), fees.filter((f) => ukr(f.p)).map(feeEntry));
addTopic('total-fees', 'transfers', T('Найбільша сума трансферів за кар’єру', 'Highest total transfer fees in a career'), players.filter((p) => transfers[p.id]?.totalFees)
  .map((p) => ({ p, value: transfers[p.id].totalFees, text: money(transfers[p.id].totalFees), detail: T(`${transfers[p.id].paid} ${transfers[p.id].paid === 1 ? 'трансфер' : transfers[p.id].paid < 5 ? 'трансфери' : 'трансферів'}`, en1(transfers[p.id].paid, 'transfer', 'transfers')) })));
addTopic('max-value', 'transfers', T('Пік ринкової вартості за кар’єру', 'Peak market value in a career'), players.filter((p) => transfers[p.id]?.maxValue)
  .map((p) => ({ p, value: transfers[p.id].maxValue, text: money(transfers[p.id].maxValue), detail: null })), PEAK_NOTE);
// покупки й продажі клубів — лише клуби, які ми знаємо (зіставлені з нашою базою)
const clubIds = Object.keys(tmClubs).filter((id) => tmClubs[id].team && tmClubs[id].league && !BANNED.has(leagueOf(tmClubs[id].team)));
for (const id of clubIds) {
  const n = Number(id);
  const name = clubName(n);
  addTopic(`buys:${id}`, 'transfers', T(`Найдорожчі покупки: ${name.uk}`, `Most expensive signings: ${name.en}`), fees.filter((f) => f.to === n).map(feeEntry));
  addTopic(`sales:${id}`, 'transfers', T(`Найдорожчі продажі: ${name.uk}`, `Most expensive sales: ${name.en}`), fees.filter((f) => f.from === n).map(feeEntry));
}
for (const [code, name] of Object.entries(TM_LEAGUES)) {
  addTopic(`league-buys:${code}`, 'transfers', T(`Найдорожчі покупки клубів ${name}`, `Most expensive signings by ${TM_LEAGUES_EN[code]} clubs`), fees.filter((f) => tmClubs[f.to]?.league === code).map(feeEntry));
}

// ── трансфери за віком, позицією, збірною, десятиліттям, між лігами
const AGE_NOTE = T('Дані з Transfermarkt. Вік приблизний: рік сезону мінус рік народження.', 'Data from Transfermarkt. Age is approximate: the season year minus the birth year.');
addTopic('fees-age:u21', 'transfers', T('Найдорожчі трансфери гравців до 21 року', 'Most expensive transfers of players under 21'), fees.filter((f) => ageAt(f) != null && ageAt(f) <= 20).map(feeEntry), AGE_NOTE);
addTopic('fees-age:30', 'transfers', T('Найдорожчі трансфери гравців від 30 років', 'Most expensive transfers of players aged 30+'), fees.filter((f) => ageAt(f) >= 30).map(feeEntry), AGE_NOTE);
const POS_GROUPS = {
  GK: ['воротарів', ['Goalkeeper'], 'goalkeepers'],
  DEF: ['захисників', ['Centre-Back', 'Left-Back', 'Right-Back'], 'defenders'],
  MID: ['півзахисників', ['Defensive Midfield', 'Central Midfield', 'Attacking Midfield', 'Left Midfield', 'Right Midfield'], 'midfielders'],
  FWD: ['нападників і вінгерів', ['Left Winger', 'Right Winger', 'Second Striker', 'Centre-Forward'], 'forwards and wingers'],
};
const POS_NOTE = T('Скільки клуб заплатив за перехід, дані з Transfermarkt. Позиція — та, на якій гравця знають.', 'The fee a club paid for the move, data from Transfermarkt. Position is the one the player is known for.');
const POS_PEAK_NOTE = T('Найвища оцінка гравця на Transfermarkt за всю кар’єру — не поточна вартість і не сума трансферу. Позиція — та, на якій гравця знають.', 'The player’s highest Transfermarkt valuation over his whole career — not his current value and not a transfer fee. Position is the one he’s known for.');
for (const [key, [word, list, wordEn]] of Object.entries(POS_GROUPS)) {
  const has = (p) => list.includes(transfers[p.id]?.pos);
  addTopic(`fees-pos:${key}`, 'transfers', T(`Найдорожчі трансфери ${word}`, `Most expensive transfers: ${wordEn}`), fees.filter((f) => has(f.p)).map(feeEntry), POS_NOTE);
  addTopic(`value-pos:${key}`, 'transfers', T(`Пік ринкової вартості ${word}`, `Peak market value: ${wordEn}`), players.filter((p) => has(p) && transfers[p.id].maxValue)
    .map((p) => ({ p, value: transfers[p.id].maxValue, text: money(transfers[p.id].maxValue), detail: null })), POS_PEAK_NOTE);
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
  addTopic(`fees-nation:${q}`, 'transfers', T(`Найдорожчі трансфери гравців збірної: ${name}`, `Most expensive transfers of ${countryEn(name)} internationals`), list.map(feeEntry));
}
for (const decade of [2000, 2010, 2020]) {
  addTopic(`fees-decade:${decade}`, 'transfers', T(`Найдорожчі трансфери ${decade}-х`, `Most expensive transfers of the ${decade}s`), fees.filter((f) => seasonStart(f.season) >= decade && seasonStart(f.season) < decade + 10).map(feeEntry));
}
const MOVE_LEAGUES = { GB1: 'АПЛ', ES1: 'Ла Ліга', IT1: 'Серія A', L1: 'Бундесліга', FR1: 'Ліга 1', PO1: 'Португалія', NL1: 'Ередивізі', UKR1: 'УПЛ' };
const MOVE_LEAGUES_EN = { GB1: 'Premier League', ES1: 'La Liga', IT1: 'Serie A', L1: 'Bundesliga', FR1: 'Ligue 1', PO1: 'Portugal', NL1: 'Eredivisie', UKR1: 'UPL' };
for (const from of Object.keys(MOVE_LEAGUES)) {
  for (const to of Object.keys(MOVE_LEAGUES)) {
    if (from === to) continue;
    addTopic(`fees-move:${from}>${to}`, 'transfers', T(`Найдорожчі переходи: ${MOVE_LEAGUES[from]} → ${MOVE_LEAGUES[to]}`, `Most expensive moves: ${MOVE_LEAGUES_EN[from]} → ${MOVE_LEAGUES_EN[to]}`),
      fees.filter((f) => tmClubs[f.from]?.league === from && tmClubs[f.to]?.league === to).map(feeEntry));
  }
}

// ── бомбардири турнірів (з Вікіпедії); кого немає в базі — відкритий рядок з іменем
const TOURNAMENTS = { wc: 'чемпіонатів світу', euro: 'чемпіонатів Європи', copa: 'Кубка Америки', ucl: 'Ліги чемпіонів (і Кубка європейських чемпіонів)', uel: 'Ліги Європи (і Кубка УЄФА)' };
const TOURNAMENTS_EN = { wc: 'World Cup', euro: 'European Championship', copa: 'Copa América', ucl: 'Champions League (incl. European Cup)', uel: 'Europa League (incl. UEFA Cup)' };
for (const [key, title] of Object.entries(TOURNAMENTS)) {
  // name — з англійської Вікіпедії, тому однаковий для обох мов
  const list = (tournaments[key] || []).map(([id, g, name]) => ({
    p: playerById.get(id) || null, name: name ? name.replace(/\s*\(.*\)$/, '') : null, value: g, text: goalsT(g), detail: null,
  }));
  const cup = key === 'ucl' || key === 'uel';
  const where = cup ? 'в основному турнірі (без кваліфікації)' : 'у фінальних турнірах';
  const whereEn = cup ? 'in the main competition (excluding qualifying)' : 'at final tournaments';
  addTopic(`tournament:${key}`, 'goals', T(`Найкращі бомбардири ${title}`, `All-time top scorers: ${TOURNAMENTS_EN[key]}`), list, T(`Голи ${where}, дані з Вікіпедії.`, `Goals ${whereEn}, data from Wikipedia.`));
}

// ── асисти, гол+пас, рекорди сезону й картки (Transfermarkt, з 2012/13)
const byTm = new Map(Object.entries(transfers).filter(([, v]) => v.tm).map(([id, v]) => [v.tm, playerById.get(id)]));
// word — [українські форми за числом, англійські однина/множина]; name (кого немає в базі) — з Transfermarkt, однаковий для обох мов
const statEntry = ([word, one, many]) => ([tm, v, season]) => ({
  p: byTm.get(tm) || null, name: stats.names[tm] || '?', value: v, text: T(`${v} ${word(v)}`, en1(v, one, many)),
  detail: season ? T(`сезон ${season}`, `season ${season}`) : null,
});
const plural3 = (one, few, many) => (n) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const W = {
  assists: [plural3('асист', 'асисти', 'асистів'), 'assist', 'assists'], ga: [plural3('гол+пас', 'гол+пас', 'гол+пас'), 'G+A', 'G+A'],
  goals: [goalsWord, 'goal', 'goals'], yellow: [plural3('жовта', 'жовті', 'жовтих'), 'yellow', 'yellows'],
  red: [plural3('червона', 'червоні', 'червоних'), 'red', 'reds'],
};
const COMP_NAMES = {
  GB1: 'АПЛ', ES1: 'Ла Ліга', IT1: 'Серія A', L1: 'Бундесліга', FR1: 'Ліга 1', UKR1: 'УПЛ', PO1: 'чемпіонат Португалії', NL1: 'Ередивізі',
  TR1: 'чемпіонат Туреччини', BE1: 'чемпіонат Бельгії', SC1: 'чемпіонат Шотландії', CL: 'Ліга чемпіонів', EL: 'Ліга Європи',
};
const COMP_NAMES_EN = {
  GB1: 'Premier League', ES1: 'La Liga', IT1: 'Serie A', L1: 'Bundesliga', FR1: 'Ligue 1', UKR1: 'UPL', PO1: 'Primeira Liga', NL1: 'Eredivisie',
  TR1: 'Süper Lig', BE1: 'Belgian Pro League', SC1: 'Scottish Premiership', CL: 'Champions League', EL: 'Europa League',
};
const STATS_NOTE = T('Дані з Transfermarkt, починаючи із сезону 2012/13.', 'Data from Transfermarkt, starting with the 2012/13 season.');
for (const [comp, t] of Object.entries(stats.comp)) {
  const name = COMP_NAMES[comp];
  if (!name) continue;
  const en = COMP_NAMES_EN[comp];
  const cup = ['CL', 'EL'].includes(comp);
  const one = cup ? 'за один розіграш' : 'за сезон';
  const oneEn = cup ? 'in a single campaign' : 'in a season';
  addTopic(`stat:${comp}:assists`, 'assists', T(`Найбільше асистів: ${name} (з 2012/13)`, `Most assists: ${en} (since 2012/13)`), t.assists.map(statEntry(W.assists)), STATS_NOTE);
  addTopic(`stat:${comp}:ga`, 'assists', T(`Найбільше гол+пас: ${name} (з 2012/13)`, `Most goals + assists: ${en} (since 2012/13)`), t.ga.map(statEntry(W.ga)), STATS_NOTE);
  addTopic(`stat:${comp}:seasonGoals`, 'goals', T(`Найбільше голів ${one}: ${name}`, `Most goals ${oneEn}: ${en}`), t.seasonGoals.map(statEntry(W.goals)), STATS_NOTE);
  addTopic(`stat:${comp}:seasonAssists`, 'assists', T(`Найбільше асистів ${one}: ${name}`, `Most assists ${oneEn}: ${en}`), t.seasonAssists.map(statEntry(W.assists)), STATS_NOTE);
  addTopic(`stat:${comp}:yellow`, 'cards', T(`Найбільше жовтих карток: ${name} (з 2012/13)`, `Most yellow cards: ${en} (since 2012/13)`), t.yellow.map(statEntry(W.yellow)), STATS_NOTE);
  addTopic(`stat:${comp}:red`, 'cards', T(`Найбільше червоних карток: ${name} (з 2012/13)`, `Most red cards: ${en} (since 2012/13)`), t.red.map(statEntry(W.red)), STATS_NOTE);
}
for (const [club, t] of Object.entries(stats.club)) {
  const c = tmClubs[club];
  if (!c?.team || BANNED.has(leagueOf(c.team))) continue;
  const name = clubName(Number(club));
  addTopic(`club-stat:${club}:assists`, 'assists', T(`Найбільше асистів: ${name.uk} (з 2012/13)`, `Most assists: ${name.en} (since 2012/13)`), t.assists.map(statEntry(W.assists)), STATS_NOTE);
  addTopic(`club-stat:${club}:ga`, 'assists', T(`Найбільше гол+пас: ${name.uk} (з 2012/13)`, `Most goals + assists: ${name.en} (since 2012/13)`), t.ga.map(statEntry(W.ga)), STATS_NOTE);
}

// ── «мандрівники»: найбільше різних клубів за кар'єру
// лише впізнавані (топ-1300 за відомістю), інакше топ складався б із невідомих мандрівників нижчих ліг
addTopic('journeymen', 'apps', T('Найбільше клубів за кар’єру', 'Most clubs in a career'), poolFor('all', 'fan').map((p) => {
  const n = new Set((careerOf(p)?.clubs || []).map((x) => x.t)).size;
  return { p, value: n, text: T(`${n} ${plural3('клуб', 'клуби', 'клубів')(n)}`, en1(n, 'club', 'clubs')), detail: null };
}), T('Скільки різних клубів було в кар’єрі, разом з орендами. Дані з Вікіпедії.', 'How many different clubs in a career, loans included. Data from Wikipedia.'));

// ── голи й матчі за клуби: лише відомі клуби (є категорія в базі) і українські
// відомі клуби (є категорія в базі) і українські, у яких забивали щонайменше 40 гравців з бази (без нижчих ліг)
for (const [qid, map] of byClub) {
  if (!knownClub(qid, map)) continue;
  const name = clubTitle(qid);
  const list = [...map].map(([p, v]) => ({ p, ...v }));
  addTopic(`club-goals:${qid}`, 'goals', T(`Найкращі бомбардири: ${name.uk}`, `Top scorers: ${name.en}`), list.map((x) => ({ p: x.p, value: x.g, text: goalsT(x.g), detail: appsT(x.a) })));
  addTopic(`club-apps:${qid}`, 'apps', T(`Найбільше матчів: ${name.uk}`, `Most appearances: ${name.en}`), list.map((x) => ({ p: x.p, value: x.a, text: appsT(x.a), detail: goalsT(x.g) })));
}
for (const [country, map] of byLeague) {
  if (!COUNTRY_CLUBS[country]) continue;
  const list = [...map].map(([p, v]) => ({ p, ...v }));
  addTopic(`league-goals:${country}`, 'goals', T(`Найбільше голів за ${COUNTRY_CLUBS[country]} клуби`, `Most goals for ${COUNTRY_CLUBS_EN[country]} clubs`), list.map((x) => ({ p: x.p, value: x.g, text: goalsT(x.g), detail: appsT(x.a) })));
}
for (const [qid, list] of byNation) {
  const name = nationName(qid);
  if (!name || BANNED.has(name) || list.length < 20) continue;
  const en = countryEn(name);
  addTopic(`nation-goals:${qid}`, 'goals', T(`Найкращі бомбардири збірної: ${name}`, `Top scorers for ${en}`), list.map((x) => ({ p: x.p, value: x.g, text: goalsT(x.g), detail: capsT(x.a) })), NOTES.nation);
  addTopic(`nation-caps:${qid}`, 'apps', T(`Найбільше матчів за збірну: ${name}`, `Most caps for ${en}`), list.map((x) => ({ p: x.p, value: x.a, text: capsT(x.a), detail: goalsT(x.g) })), NOTES.nation);
}

// ── трофеї: скільки разів виграв (усього, чемпіонати, ЛЧ, зі збірною, чемпіонати окремих країн)
const titlesWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'трофей' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'трофеї' : 'трофеїв');
const titlesT = (n) => T(`${n} ${titlesWord(n)}`, en1(n, 'trophy', 'trophies'));
const timesWord = (n) => (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'рази' : 'разів');
const timesT = (n) => T(n === 1 ? '1 раз' : `${n} ${timesWord(n)}`, n === 1 ? 'once' : `${n} times`);
const withHonours = players.filter((p) => honoursOf(p)); // росіян і білорусів у базі немає
const honoursTopic = (id, title, value, text, detail, filter = () => true) => addTopic(id, 'trophies', title,
  withHonours.filter(filter).map((p) => { const h = honoursOf(p), v = value(h); return { p, value: v, text: text(v), detail: detail(h) }; }), NOTES.trophies);
honoursTopic('honours-total', T('Найбільше трофеїв за кар’єру', 'Most trophies in a career'), (h) => h.total || 0, titlesT, (h) => summary(h, ['league', 'ucl', 'wc', 'euro', 'copa']));
honoursTopic('honours-ua', T('Українці з найбільшою кількістю трофеїв', 'Ukrainians with the most trophies'), (h) => h.total || 0, titlesT, (h) => summary(h, ['league', 'ucl', 'uel']), ukr);
honoursTopic('honours-league', T('Найбільше чемпіонств', 'Most league titles'), (h) => h.league || 0, timesT, leaguesText);
honoursTopic('honours-ucl', T('Найбільше перемог у Лізі чемпіонів', 'Most Champions League titles'), (h) => h.ucl || 0, timesT, (h) => summary(h, ['league', 'cwc']));
honoursTopic('honours-nation', T('Найбільше трофеїв зі збірною', 'Most international trophies'), nationTitles, titlesT, (h) => summary(h, NATION_KEYS));
// чемпіонства окремих країн: назви ліг у Вікіпедії (і старі назви тих самих чемпіонатів)
const LEAGUE_TITLES = {
  Англія: ['Premier League', 'Football League First Division'], Іспанія: ['La Liga'], Італія: ['Serie A'], Німеччина: ['Bundesliga'],
  Франція: ['Ligue 1', 'French Division 1', 'Division 1 (French football)'], Україна: ['Ukrainian Premier League', 'Vyshcha Liha (Ukraine)'],
  Нідерланди: ['Eredivisie'], Португалія: ['Primeira Liga'],
};
const LEAGUE_OF = { Англія: 'Англії', Іспанія: 'Іспанії', Італія: 'Італії', Німеччина: 'Німеччини', Франція: 'Франції', Україна: 'України', Нідерланди: 'Нідерландів', Португалія: 'Португалії' };
for (const [country, names] of Object.entries(LEAGUE_TITLES)) {
  const n = (h) => names.reduce((s, x) => s + (h.leagues?.[x] || 0), 0);
  honoursTopic(`honours-league:${country}`, T(`Найбільше чемпіонств ${LEAGUE_OF[country]}`, `Most league titles: ${countryEn(country)}`), n, timesT, (h) => summary(h, ['ucl', 'uel']));
}

// ── «Золотий м'яч»: рейтинги по роках (ballon.json, Вікіпедія) — скільки разів у трійці / десятці / рейтингу, рейтинг окремого року
// «1-ше, 2-ге, 3-тє, 7-ме, 40-ве, решта -те» — як пишуть порядкові числівники середнього роду
const ordUk = (n) => (n % 100 >= 11 && n % 100 <= 19 ? 'те' : n % 100 === 40 ? 'ве' : ({ 1: 'ше', 2: 'ге', 3: 'тє', 7: 'ме', 8: 'ме' })[n % 10] || 'те');
const placeT = (n) => T(`${n}-${ordUk(n)} місце`,`${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'} place`);
const pointsT = (n) => T(`${n} ${plural3('бал', 'бали', 'балів')(n)}`, en1(n, 'point', 'points'));
const BALLON_NOTE = T('За рейтингами «Золотого м’яча» з Вікіпедії. У 2010–2015 роках нагорода називалася FIFA Ballon d’Or, а 2020 року її не вручали.', 'From the Ballon d’Or rankings on Wikipedia. In 2010–2015 the award was called the FIFA Ballon d’Or, and it wasn’t given in 2020.');
const ballonOf = new Map(); // id → [[рік, місце]]
for (const [y, list] of Object.entries(ballon)) {
  for (const [id, place] of list) if (id && playerById.get(id)) (ballonOf.get(id) || ballonOf.set(id, []).get(id)).push([Number(y), place]);
}
const yearsText = (list) => { const ys = list.map(([y]) => y); return ys.length > 4 ? `${ys.slice(0, 3).join(', ')}… ${ys[ys.length - 1]}` : ys.join(', '); };
const ballonCount = (id, title, max, filter = () => true) => addTopic(id, 'ballon', title, [...ballonOf].filter(([pid]) => filter(playerById.get(pid))).map(([pid, list]) => {
  const hits = list.filter(([, place]) => place <= max);
  const text = yearsText(hits);
  return { p: playerById.get(pid), value: hits.length, text: timesT(hits.length), detail: T(text, text) };
}), BALLON_NOTE);
ballonCount('ballon-top3', T('Найбільше разів у трійці «Золотого м’яча»', 'Most Ballon d’Or top-3 finishes'), 3);
ballonCount('ballon-top10', T('Найбільше разів у десятці «Золотого м’яча»', 'Most Ballon d’Or top-10 finishes'), 10);
ballonCount('ballon-any', T('Найбільше разів у рейтингу «Золотого м’яча»', 'Most Ballon d’Or ranking appearances'), Infinity);
ballonCount('ballon-nowin', T('Найчастіше в десятці «Золотого м’яча» — без перемоги', 'Most Ballon d’Or top-10 finishes without winning'), 10, (p) => !ballonOf.get(p.id).some(([, place]) => place === 1));
// найвище місце — менше краще: value = 100 − місце
const bestEntry = (p) => {
  const [y, place] = [...ballonOf.get(p.id)].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  return { p, value: 100 - place, text: placeT(place), detail: T(String(y), String(y)) };
};
const citizenship = (() => { try { return require('../../data/citizenship.json'); } catch { return {}; } })();
const ukrBorn = (p) => ukr(p) || (citizenship[p.qid] || []).includes('UA'); // і радянські українці (Блохін, Бєланов)
addTopic('ballon-ua', 'ballon', T('Українці в рейтингу «Золотого м’яча»: найвище місце', 'Ukrainians in the Ballon d’Or rankings: best finish'),
  [...ballonOf.keys()].map((id) => playerById.get(id)).filter(ukrBorn).map(bestEntry), BALLON_NOTE);
const ballonByNation = new Map();
for (const id of ballonOf.keys()) {
  const n = careerOf(playerById.get(id))?.nation?.t;
  if (n) (ballonByNation.get(n) || ballonByNation.set(n, []).get(n)).push(playerById.get(id));
}
for (const [q, list] of ballonByNation) {
  const name = nationName(q);
  if (!name || BANNED.has(name) || name === 'Україна' || list.length < 12) continue;
  ballonCount(`ballon-nation:${q}`, T(`Найбільше разів у рейтингу «Золотого м’яча»: ${name}`, `Most Ballon d’Or ranking appearances: ${countryEn(name)}`), Infinity, (p) => careerOf(p)?.nation?.t === q);
}
// рейтинг окремого року — лише повний (є переможець і гравців бази досить)
for (const [y, list] of Object.entries(ballon)) {
  if (list[0]?.[1] !== 1) continue;
  addTopic(`ballon-year:${y}`, 'ballon', T(`Рейтинг «Золотого м’яча» ${y}`, `Ballon d’Or ${y} ranking`), list.map(([id, place, pts, name]) => ({
    p: id ? playerById.get(id) || null : null, name: name || null, value: 100 - place, text: placeT(place), detail: pts ? pointsT(pts) : null,
  })), BALLON_NOTE);
}

// ── нагороди (awards.json, Вікіпедія): символічна збірна FIFPRO (з 2005) і Golden Boy (з 2003)
const FIFPRO_NOTE = T('FIFA FIFPRO World 11 — символічна збірна року, за яку голосують самі футболісти (з 2005 року).', 'FIFA FIFPRO Men’s World 11 — the team of the year voted for by players themselves (since 2005).');
const fifproOf = new Map(); // id → [[рік, позиція]]
for (const [y, team] of Object.entries(awards.fifpro || {})) {
  for (const [id, pos] of team) if (id && playerById.get(id)) (fifproOf.get(id) || fifproOf.set(id, []).get(id)).push([Number(y), pos]);
}
const fifproCount = (id, title, filter = () => true) => addTopic(id, 'awards', title, [...fifproOf].map(([pid, list]) => {
  const hits = list.filter(([, pos]) => filter(pos));
  const text = yearsText(hits);
  return { p: playerById.get(pid), value: hits.length, text: timesT(hits.length), detail: T(text, text) };
}), FIFPRO_NOTE);
fifproCount('fifpro', T('Найбільше разів у символічній збірній FIFPRO', 'Most FIFPRO World 11 selections'));
fifproCount('fifpro-pos:DF', T('Найбільше разів у збірній FIFPRO — захисником', 'Most FIFPRO World 11 selections as a defender'), (pos) => pos === 'DF');
fifproCount('fifpro-pos:MF', T('Найбільше разів у збірній FIFPRO — півзахисником', 'Most FIFPRO World 11 selections as a midfielder'), (pos) => pos === 'MF');
fifproCount('fifpro-pos:FW', T('Найбільше разів у збірній FIFPRO — нападником', 'Most FIFPRO World 11 selections as a forward'), (pos) => pos === 'FW');
const GBOY_NOTE = T('Golden Boy — нагорода газети Tuttosport найкращому гравцю Європи до 21 року (з 2003).', 'Golden Boy — Tuttosport’s award for the best under-21 player in Europe (since 2003).');
const goldenBoys = Object.entries(awards.goldenBoy || {}).map(([y, [id]]) => [Number(y), id && playerById.get(id)]).filter(([, p]) => p);
addTopic('goldenboy', 'awards', T('Переможці Golden Boy — від найновішого', 'Golden Boy winners — newest first'),
  goldenBoys.map(([y, p]) => ({ p, value: y, text: T(String(y), String(y)), detail: null })), GBOY_NOTE);
addTopic('goldenboy-value', 'awards', T('Переможці Golden Boy: пік ринкової вартості', 'Golden Boy winners: peak market value'),
  goldenBoys.filter(([, p]) => transfers[p.id]?.maxValue).map(([y, p]) => ({ p, value: transfers[p.id].maxValue, text: money(transfers[p.id].maxValue), detail: T(`Golden Boy ${y}`, `Golden Boy ${y}`) })), PEAK_NOTE);
addTopic('goldenboy-ballon', 'awards', T('Переможці Golden Boy: найвище місце в «Золотому м’ячі»', 'Golden Boy winners: best Ballon d’Or finish'),
  goldenBoys.filter(([, p]) => ballonOf.has(p.id)).map(([, p]) => bestEntry(p)), BALLON_NOTE);

// ── зріст (facts.json: Wikidata, де немає — Transfermarkt) — серед упізнаваних (топ-1300), інакше топ з невідомих велетнів
const HEIGHT_NOTE = T('Зріст за Вікіданими, а де їх немає — за Transfermarkt. Беремо лише відомих гравців з нашої бази.', 'Height from Wikidata, or Transfermarkt where it’s missing. Only well-known players from our database.');
const cmT = (h) => T(`${h} см`, `${h} cm`);
const heightPool = poolFor('all', 'fan').filter((p) => facts[p.qid]?.h);
const tall = (list) => list.map((p) => ({ p, value: facts[p.qid].h, text: cmT(facts[p.qid].h), detail: null }));
const short = (list) => list.map((p) => ({ p, value: 300 - facts[p.qid].h, text: cmT(facts[p.qid].h), detail: null })); // нижчий — вище в топі
const mainPos = (p) => ['GK', 'DF', 'MF', 'FW'].find((t) => p.tags.has(t));
addTopic('height-tall', 'height', T('Найвищі футболісти', 'Tallest footballers'), tall(heightPool), HEIGHT_NOTE);
addTopic('height-short', 'height', T('Найнижчі футболісти', 'Shortest footballers'), short(heightPool), HEIGHT_NOTE);
const HEIGHT_POS = { GK: ['воротарі', 'goalkeepers'], DF: ['захисники', 'defenders'], MF: ['півзахисники', 'midfielders'], FW: ['нападники', 'forwards'] };
for (const [pos, [uk, en]] of Object.entries(HEIGHT_POS)) {
  const list = heightPool.filter((p) => mainPos(p) === pos);
  addTopic(`height-tall:${pos}`, 'height', T(`Найвищі ${uk}`, `Tallest ${en}`), tall(list), HEIGHT_NOTE);
  if (pos !== 'GK') addTopic(`height-short:${pos}`, 'height', T(`Найнижчі ${uk}`, `Shortest ${en}`), short(list), HEIGHT_NOTE);
}
// за клубами з категорій бази і збірними
const heightWide = poolFor('all', 'expert').filter((p) => facts[p.qid]?.h);
for (const c of categoriesList.filter((x) => x.type === 'club' && x.qid)) {
  const list = heightWide.filter((p) => careerOf(p)?.clubs.some((x) => x.t === c.qid));
  const name = clubTitle(c.qid);
  addTopic(`height-club:${c.qid}`, 'height', T(`Найвищі гравці: ${name.uk}`, `Tallest players: ${name.en}`), tall(list), HEIGHT_NOTE);
}
for (const c of categoriesList.filter((x) => x.type === 'nation' && x.qid)) {
  const list = heightWide.filter((p) => careerOf(p)?.nation?.t === c.qid);
  addTopic(`height-nation:${c.qid}`, 'height', T(`Найвищі гравці збірної: ${c.label}`, `Tallest players: ${c.en}`), tall(list), HEIGHT_NOTE);
}

// ── хто кому асистував (assists.json, Transfermarkt — матчі приблизно з 2012/13): лише про найвідоміших (топ-400)
const ASSIST_NOTE = T('Гольові передачі в усіх матчах за клуби й збірні, приблизно із сезону 2012/13. Дані з Transfermarkt.', 'Assists in all club and international matches, from about the 2012/13 season. Data from Transfermarkt.');
const passesT = (n) => T(`${n} ${plural3('передача', 'передачі', 'передач')(n)}`, en1(n, 'assist', 'assists'));
const assistClub = (id) => (tmClubs[id] ? clubName(id) : null);
for (const p of poolFor('all', 'easy')) {
  const tm = transfers[p.id]?.tm;
  if (!tm) continue;
  const name = T(p.uk || p.name, p.name);
  const rows = (list) => list.filter(([other]) => byTm.get(other) !== p).map(([other, n, club]) => ({
    p: byTm.get(other) || null, name: assists.names[other] || '?', value: n, text: passesT(n), detail: assistClub(club),
  }));
  const to = assists.to[tm] || [], by = assists.by[tm] || [];
  // лише коли є про що питати: у десятому рядку — 3+ передачі
  if (to.length >= 10 && to[9][1] >= 3) addTopic(`assist-to:${p.id}`, 'assists', T(`Хто найбільше асистував: ${name.uk}`, `Who assisted ${name.en} the most`), rows(to), ASSIST_NOTE);
  if (by.length >= 10 && by[9][1] >= 3) addTopic(`assist-by:${p.id}`, 'assists', T(`Кому найбільше асистував: ${name.uk}`, `Who ${name.en} assisted the most`), rows(by), ASSIST_NOTE);
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
  else if ((kind === 'height-tall' || kind === 'height-short') && key) t.kind = 'misc'; // за позицією
  else if (kind === 'assist-to' || kind === 'assist-by') t.kind = 'player';
  else if (kind === 'ballon-year') t.kind = 'year';
  else if (kind === 'ballon-nation' || kind === 'height-nation') Object.assign(t, { kind: 'nation', country: nationName(key) });
  else if (kind === 'height-club') Object.assign(t, { kind: 'club', country: leagueOf(key), club: clubTitle(key) });
  else if (kind === 'buys' || kind === 'sales') Object.assign(t, { kind: 'club', country: leagueOf(tmClubs[key].team), club: clubName(Number(key)) });
  else if (kind === 'club-goals' || kind === 'club-apps') Object.assign(t, { kind: 'club', country: leagueOf(key), club: clubTitle(key) });
  else if (kind === 'league-buys') Object.assign(t, { kind: 'league', country: LEAGUE_COUNTRY[key] });
  else if (kind === 'league-goals') Object.assign(t, { kind: 'league', country: key });
  else if (kind === 'honours-league' && key) Object.assign(t, { kind: 'league', country: key });
  else if (kind.startsWith('nation')) Object.assign(t, { kind: 'nation', country: nationName(key) });
  else if (kind === 'tournament') t.kind = 'tournament';
  else t.kind = 'general';
  // country — українська назва (ключ) → пара для клієнта: фільтр «Країна» мовою гравця
  if (t.country) t.country = countryT(t.country);
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
