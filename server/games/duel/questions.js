// Питання «Один на один»: кожне — одне число про футболіста (голи, зріст, вартість, підписники…). Хто має більше — той правильна відповідь.
//   { id, group, title: T(питання), unit: T(підпис під числом), note: T(звідки дані), value(p) → число | null,
//     show(v, p) → { pre, num, dec, post, detail } — як показати (num крутиться лічильником на клієнті),
//     gap: { kind: 'ratio' | 'abs', easy, hard } — наскільки різні значення в «легкій» і «складній» парі,
//     minGap — менше не загадуємо (Instagram: числа приблизні), maxGap — більше не загадуємо на жодному рівні
//     (вік: гравці різних епох — надто очевидно), pairOk(a, b) — додаткова умова пари }.
// Дані, яких може не бути (facts.json, manual-instagram.js збираються окремо), читаються через try — без них питання просто недоступні.
const { T } = require('../../core/i18n');
const { careerOf, team } = require('../path/careers');
const { teamEn } = require('../../data/names-en');
const { honoursOf, count, nationTitles, summary, leaguesText, NATION_KEYS } = require('../../data/honours');

const tryRequire = (file, fallback) => {
  try { return require(file); } catch { return fallback; }
};
const transfers = tryRequire('../../data/transfers.json', {});
const stats = tryRequire('../../data/stats.json', null);
const facts = tryRequire('../../data/facts.json', {}); // { qid: { h: см, dob: 'YYYY-MM-DD', views: перегляди за рік } }
const instagram = tryRequire('../../data/manual-instagram.js', { date: null, followers: {} });

const NOW = new Date().getFullYear();
const STATS_FROM = 2012; // статистика Transfermarkt — з сезону 2012/13

const factsOf = (p) => (p.qid && facts[p.qid]) || {};
const statsOf = (p) => stats?.players?.[transfers[p.id]?.tm] || null;
const firstYear = (p) => { const c = careerOf(p); return c?.clubs[0] ? c.clubs[0].s ?? c.clubs[0].e ?? null : null; };
const modern = (p) => (firstYear(p) ?? 0) >= STATS_FROM;
const clubT = (q) => { const t = team(q); return T(t.name, teamEn(q, t) || t.name); };

// Трофеї — скільки разів виграв (server/data/honours.js); гравцям без розділу трофеїв у статті питання не ставимо.
const HONOURS_SRC = T(' За розділом «Honours» статті гравця в англійській Вікіпедії; трофеї тренером не рахуються.',
  ' Per the Honours section of the player’s English Wikipedia article; titles won as a manager are not counted.');
const withSrc = (uk, en) => T(uk + HONOURS_SRC.uk, en + HONOURS_SRC.en);

// Гроші: €180 млн / €180m; менше мільйона — тисячі.
function money(v) {
  if (v >= 1e6) {
    const m = v / 1e6;
    const dec = m < 10 && m % 1 ? 1 : 0;
    return { pre: '€', num: Number(m.toFixed(dec)), dec, post: T(' млн', 'm') };
  }
  return { pre: '€', num: Math.round(v / 1e3), dec: 0, post: T(' тис.', 'k') };
}
// Великі числа: 12,3 млн / 12.3m; 850 тис. / 850k.
function big(v) {
  if (v >= 1e6) { const m = v / 1e6; const dec = m < 100 && m % 1 >= 0.05 ? 1 : 0; return { num: Number(m.toFixed(dec)), dec, post: T(' млн', 'm') }; }
  if (v >= 1e4) return { num: Math.round(v / 1e3), dec: 0, post: T(' тис.', 'k') };
  return { num: v, dec: 0 };
}
const plain = (v) => ({ num: v, dec: 0 });
const dateText = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
const RATIO = { kind: 'ratio', easy: 1.5, hard: 1.2 }; // легко — у півтора раза й більше, складно — до 20 %

const QUESTIONS = [
  // ── особисте
  {
    id: 'older', group: 'personal',
    title: T('Хто старший?', 'Who is older?'), unit: T('рік народження', 'year of birth'),
    note: T('Дата народження — з Вікідані; без точної дати — лише рік.', 'Date of birth from Wikidata; year only where the exact date is unknown.'),
    // вік у роках (дробовий): з точною датою — точно, лише з роком — середина року
    value(p) {
      const dob = factsOf(p).dob;
      const t = dob && !Number.isNaN(Date.parse(dob)) ? Date.parse(dob) : p.born ? Date.parse(`${p.born}-07-01`) : NaN;
      return Number.isNaN(t) ? null : (Date.now() - t) / 31557600000;
    },
    show(v, p) { const dob = factsOf(p).dob; return { num: dob ? Number(dob.slice(0, 4)) : p.born, dec: 0, detail: dob ? dateText(dob) : null }; },
    gap: { kind: 'abs', easy: 6, hard: 1.5 },
    maxGap: 12,
    // з однаковим роком без точних дат не порівняти
    pairOk: (a, b) => a.born !== b.born || (!!factsOf(a).dob && !!factsOf(b).dob),
  },
  {
    id: 'taller', group: 'personal',
    title: T('Хто вищий?', 'Who is taller?'), unit: T('зріст', 'height'),
    note: T('Зріст — з Вікіданих.', 'Height from Wikidata.'),
    value: (p) => (factsOf(p).h > 140 && factsOf(p).h < 220 ? factsOf(p).h : null),
    show: (v) => ({ num: v, dec: 0, post: T(' см', ' cm') }),
    gap: { kind: 'abs', easy: 10, hard: 3 },
  },

  // ── кар'єра (таблиці кар'єри у Вікіпедії)
  {
    id: 'leagueGoals', group: 'career',
    title: T('Хто забив більше голів у чемпіонатах?', 'Who scored more league goals?'), unit: T('голів у чемпіонатах', 'league goals'),
    note: T('Голи лише в національних чемпіонатах за всю кар’єру — за таблицями кар’єри у Вікіпедії.', 'League goals only, whole career — from Wikipedia career tables.'),
    value(p) { const c = careerOf(p); return c && c.clubs.some((x) => x.g != null) ? c.clubs.reduce((s, x) => s + (x.g || 0), 0) : null; },
    show: plain, gap: RATIO,
  },
  {
    id: 'leagueApps', group: 'career',
    title: T('Хто зіграв більше матчів у чемпіонатах?', 'Who played more league games?'), unit: T('матчів у чемпіонатах', 'league games'),
    note: T('Матчі лише в національних чемпіонатах за всю кар’єру — за таблицями кар’єри у Вікіпедії.', 'League games only, whole career — from Wikipedia career tables.'),
    value(p) { const c = careerOf(p); return c && c.clubs.some((x) => x.a != null) ? c.clubs.reduce((s, x) => s + (x.a || 0), 0) : null; },
    show: plain, gap: RATIO,
  },
  {
    id: 'clubs', group: 'career',
    title: T('Хто змінив більше клубів?', 'Who played for more clubs?'), unit: T('клубів за кар’єру', 'clubs in career'),
    note: T('Різні клуби за кар’єру (з орендами), де зіграно хоча б один матч.', 'Different clubs in a career (loans included) with at least one game.'),
    value(p) { const c = careerOf(p); return c?.clubs.length ? new Set(c.clubs.map((x) => x.t)).size : null; },
    show: plain, gap: { kind: 'abs', easy: 4, hard: 1 },
  },
  {
    id: 'longestClub', group: 'career',
    title: T('Хто довше грав в одному клубі?', 'Who spent longer at one club?'), unit: T('років в одному клубі', 'years at one club'),
    note: T('Найдовший період в одному клубі без перерви, за роками в таблиці кар’єри.', 'Longest unbroken spell at one club, by years in the career table.'),
    value(p) { const b = longest(p); return b ? b.years : null; },
    show(v, p) { const b = longest(p); return { num: v, dec: 0, detail: b ? T(`${clubT(b.t).uk}, ${b.s}–${b.e ?? ''}`, `${clubT(b.t).en}, ${b.s}–${b.e ?? ''}`) : null }; },
    gap: { kind: 'abs', easy: 5, hard: 1 },
  },

  // ── збірна
  {
    id: 'caps', group: 'nation',
    title: T('Хто зіграв більше матчів за збірну?', 'Who has more caps?'), unit: T('матчів за збірну', 'international caps'),
    note: T('Матчі за головну збірну — за Вікіпедією.', 'Senior national team caps — per Wikipedia.'),
    value: (p) => careerOf(p)?.nation?.a ?? null,
    show: plain, gap: RATIO,
  },
  {
    id: 'natGoals', group: 'nation',
    title: T('Хто забив більше за збірну?', 'Who scored more international goals?'), unit: T('голів за збірну', 'international goals'),
    note: T('Голи за головну збірну — за Вікіпедією.', 'Senior national team goals — per Wikipedia.'),
    value: (p) => careerOf(p)?.nation?.g ?? null,
    show: plain, gap: RATIO,
  },
  {
    id: 'natRate', group: 'nation',
    title: T('Хто частіше забивав за збірну?', 'Who scored more often for their country?'), unit: T('гола за матч у збірній', 'international goals per game'),
    note: T('Голи за збірну, поділені на матчі за неї. Лише гравці з 20+ матчами за збірну.', 'International goals divided by caps. Only players with 20+ caps.'),
    value: (p) => { const n = careerOf(p)?.nation; return n && n.a >= 20 && n.g != null ? Math.round((n.g / n.a) * 100) / 100 : null; },
    show: (v) => ({ num: v, dec: 2 }), gap: RATIO,
  },
  {
    id: 'natTitles', group: 'nation',
    title: T('Хто виграв більше турнірів зі збірною?', 'Who won more tournaments with their country?'), unit: T('турнірів зі збірною', 'international titles'),
    note: withSrc('Скільки разів виграв з дорослою збірною ЧС, Євро, Копа Америка, Кубок Африки, Лігу націй, Кубок конфедерацій тощо.',
      'How many times they won the World Cup, Euro, Copa América, AFCON, Nations League, Confederations Cup etc. with the senior team.'),
    value: (p) => (careerOf(p)?.nation ? nationTitles(honoursOf(p)) : null),
    show: (v, p) => ({ num: v, dec: 0, detail: summary(honoursOf(p), NATION_KEYS) }),
    gap: { kind: 'abs', easy: 2, hard: 1 },
  },

  // ── гроші (Transfermarkt)
  {
    id: 'maxValue', group: 'money',
    title: T('Хто коштував дорожче на піку?', 'Who had the higher peak market value?'), unit: T('макс. ринкова вартість', 'peak market value'),
    note: T('Найвища ринкова вартість за кар’єру — за Transfermarkt.', 'Highest market value in a career — per Transfermarkt.'),
    value: (p) => transfers[p.id]?.maxValue || null,
    show: money, gap: RATIO,
  },
  {
    id: 'topFee', group: 'money',
    title: T('Чий найдорожчий трансфер більший?', 'Whose record transfer was bigger?'), unit: T('найдорожчий трансфер', 'record transfer fee'),
    note: T('Найбільша сума одного переходу гравця — за Transfermarkt (оренди без викупу не рахуються).', 'Largest single transfer fee for the player — per Transfermarkt.'),
    value: (p) => transfers[p.id]?.topFee || null,
    show(v, p) { const t = transfers[p.id]; return { ...money(v), detail: t.topFrom ? `${t.topFrom} → ${t.topTo}${t.topSeason ? `, ${t.topSeason}` : ''}` : null }; },
    gap: RATIO,
  },
  {
    id: 'totalFees', group: 'money',
    title: T('За кого заплатили більше за кар’єру?', 'Who cost more in transfer fees overall?'), unit: T('сума всіх трансферів', 'total transfer fees'),
    note: T('Сума всіх платних переходів гравця — за Transfermarkt (лише ті, хто почав кар’єру з 2008-го: раніші дані неповні).', 'Sum of all paid transfers — per Transfermarkt (only careers from 2008 on: earlier data is incomplete).'),
    value: (p) => ((firstYear(p) ?? 0) >= 2008 && transfers[p.id]?.totalFees) || null,
    show(v, p) { const n = transfers[p.id].paid; return { ...money(v), detail: n ? T(`${n} ${n === 1 ? 'трансфер' : n < 5 ? 'трансфери' : 'трансферів'}`, `${n} ${n === 1 ? 'transfer' : 'transfers'}`) : null }; },
    gap: RATIO,
  },

  // ── статистика Transfermarkt з 2012/13 — лише тим, хто почав кар'єру з 2012-го (інакше число неповне)
  {
    id: 'assists', group: 'stats',
    title: T('Хто віддав більше гольових передач?', 'Who has more assists?'), unit: T('асистів', 'assists'),
    note: T('Усі клубні змагання (без збірної) з сезону 2012/13 — за Transfermarkt; лише гравці, що почали кар’єру з 2012-го.', 'All club competitions (no national team) since 2012/13 — per Transfermarkt; only players who started their career in 2012 or later.'),
    value: (p) => (modern(p) ? statsOf(p)?.t[1] ?? null : null),
    show: plain, gap: RATIO,
  },
  {
    id: 'ga', group: 'stats',
    title: T('У кого більше «гол + пас»?', 'Who has more goals + assists?'), unit: T('голів + асистів', 'goals + assists'),
    note: T('Голи й асисти в усіх клубних змаганнях (без збірної) з сезону 2012/13 — за Transfermarkt; лише гравці, що почали кар’єру з 2012-го.', 'Goals and assists, all club competitions (no national team) since 2012/13 — per Transfermarkt; only careers from 2012 on.'),
    value: (p) => { const s = modern(p) && statsOf(p); return s ? s.t[0] + s.t[1] : null; },
    show: plain, gap: RATIO,
  },
  {
    id: 'yellow', group: 'stats',
    title: T('У кого більше жовтих карток?', 'Who has more yellow cards?'), unit: T('жовтих карток', 'yellow cards'),
    note: T('Жовті картки в усіх клубних змаганнях (без збірної) з сезону 2012/13 — за Transfermarkt; лише гравці, що почали кар’єру з 2012-го.', 'Yellow cards, all club competitions (no national team) since 2012/13 — per Transfermarkt; only careers from 2012 on.'),
    value: (p) => (modern(p) ? statsOf(p)?.t[3] ?? null : null),
    show: plain, gap: RATIO,
  },

  // ── трофеї
  {
    id: 'trophies', group: 'trophies',
    title: T('У кого більше трофеїв?', 'Who has won more trophies?'), unit: T('трофеїв', 'trophies'),
    note: withSrc('Усі командні трофеї, кожна перемога: чемпіонати, кубки й суперкубки, єврокубки, турніри збірних.',
      'All team trophies, counting every win: leagues, cups and super cups, continental and international titles.'),
    value: (p) => count(honoursOf(p), 'total'),
    show: (v, p) => ({ num: v, dec: 0, detail: summary(honoursOf(p)) }),
    gap: { kind: 'ratio', easy: 1.6, hard: 1.2 },
  },
  {
    id: 'leagueTitles', group: 'trophies',
    title: T('Хто виграв більше чемпіонатів?', 'Who has won more league titles?'), unit: T('чемпіонств', 'league titles'),
    note: withSrc('Скільки разів ставав чемпіоном країни (вищий дивізіон будь-якої країни).', 'Top-flight league titles in any country.'),
    value: (p) => count(honoursOf(p), 'league'),
    show: (v, p) => ({ num: v, dec: 0, detail: leaguesText(honoursOf(p)) }),
    gap: { kind: 'abs', easy: 4, hard: 1 },
  },
  {
    id: 'uclTitles', group: 'trophies',
    title: T('Хто більше разів виграв Лігу чемпіонів?', 'Who has won the Champions League more times?'), unit: T('Ліг чемпіонів', 'Champions League titles'),
    note: withSrc('Кубок європейських чемпіонів і Ліга чемпіонів.', 'European Cup and Champions League.'),
    value: (p) => count(honoursOf(p), 'ucl'),
    show: plain,
    gap: { kind: 'abs', easy: 2, hard: 1 },
  },

  // ── популярність
  {
    id: 'wikiLangs', group: 'fame',
    title: T('Про кого пишуть більше Вікіпедій?', 'Who is in more Wikipedias?'), unit: T('мовних розділів Вікіпедії', 'Wikipedia languages'),
    note: T('У скількох мовних розділах Вікіпедії є стаття про гравця.', 'In how many Wikipedia language editions the player has an article.'),
    value: (p) => p.rawFame || null,
    show: plain, gap: RATIO,
  },
  {
    id: 'views', group: 'fame',
    title: T('Чию статтю у Вікіпедії читають більше?', 'Whose Wikipedia article gets more views?'), unit: T('переглядів за рік', 'views per year'),
    note: T('Перегляди статті в англійській Вікіпедії за останній рік.', 'English Wikipedia article views over the last year.'),
    value: (p) => factsOf(p).views || null,
    show: big, gap: RATIO,
  },

  // ── Instagram (вручну, приблизно — тому лише пари з помітною різницею)
  {
    id: 'instagram', group: 'instagram',
    title: T('У кого більше підписників в Instagram?', 'Who has more Instagram followers?'), unit: T('підписників в Instagram', 'Instagram followers'),
    note: T(`Приблизно, станом на ${instagram.date || '—'}.`, `Approximate, as of ${instagram.date || '—'}.`),
    value: (p) => instagram.followers?.[p.id] || null,
    show: (v) => ({ pre: '≈ ', ...big(v), detail: T(`станом на ${instagram.date}`, `as of ${instagram.date}`) }),
    gap: { kind: 'ratio', easy: 2, hard: 1.5 },
    minGap: 1.3,
  },
];

// Найдовший безперервний період в одному клубі (сусідні рядки того самого клубу — одним періодом).
const longestCache = new Map();
function longest(p) {
  if (longestCache.has(p.id)) return longestCache.get(p.id);
  const c = careerOf(p);
  let best = null;
  let cur = null;
  for (const x of c?.clubs || []) {
    if (x.s == null) { cur = null; continue; }
    if (cur && cur.t === x.t && !x.loan) cur.e = x.e;
    else cur = { t: x.t, s: x.s, e: x.e };
    const years = (cur.e ?? NOW) - cur.s;
    if (years > 0 && (!best || years > best.years)) best = { ...cur, years };
  }
  if (best) best = { t: best.t, s: best.s, e: best.e, years: (best.e ?? NOW) - best.s };
  longestCache.set(p.id, best);
  return best;
}

const GROUPS = {
  personal: T('🧍 Особисте', '🧍 Personal'),
  career: T('👕 Кар’єра', '👕 Career'),
  nation: T('🏳️ Збірна', '🏳️ National team'),
  money: T('💶 Гроші', '💶 Money'),
  stats: T('🎯 Статистика з 2012', '🎯 Stats since 2012'),
  trophies: T('🏆 Трофеї', '🏆 Honours'),
  fame: T('🌍 Популярність', '🌍 Fame'),
  instagram: T('📸 Instagram', '📸 Instagram'),
};

const questionById = new Map(QUESTIONS.map((q) => [q.id, q]));

// Наскільки різні два значення: для ratio — у скільки разів (0 проти числа — нескінченно), для abs — різниця.
function gapOf(q, a, b) {
  if (q.gap.kind === 'abs') return Math.abs(a - b);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return lo <= 0 ? Infinity : hi / lo;
}
function fitsLevel(q, a, b, level) {
  if (a === b) return false;
  const g = gapOf(q, a, b);
  if (q.minGap && g < q.minGap) return false;
  if (q.maxGap && g > q.maxGap) return false;
  if (level === 'easy') return g >= q.gap.easy;
  if (level === 'hard') return g <= q.gap.hard;
  return true;
}

module.exports = { QUESTIONS, GROUPS, questionById, fitsLevel, gapOf };

// ── пули гравців і пари
// Хто загадується — верхівка спільного рейтингу відомості (poolFor зі «Шляху»), без гравців збірних росії й білорусі.
const { poolFor, DIFFICULTIES } = require('../path/careers');
const { nationName } = require('../guess/compare');
const BANNED = new Set(['Росія', 'Білорусь']);
const MIN_PLAYERS = 12; // менше гравців зі значенням — питання на цьому рівні не ставимо

const pools = new Map(); // складність → Map(питання → [{ p, v }])
function poolOf(difficulty) {
  if (!pools.has(difficulty)) {
    const base = poolFor('all', difficulty).filter((p) => { const n = careerOf(p)?.nation; return !n || !BANNED.has(nationName(n.t)); });
    const byQ = new Map();
    for (const q of QUESTIONS) {
      const list = [];
      for (const p of base) { const v = q.value(p); if (v != null && Number.isFinite(v)) list.push({ p, v }); }
      byQ.set(q.id, list);
    }
    pools.set(difficulty, byQ);
  }
  return pools.get(difficulty);
}
const candidates = (q, difficulty) => poolOf(difficulty).get(q.id) || [];

// Питання, які можна ставити на цьому рівні (є дані про достатньо гравців).
const questionsFor = (groups, difficulty) => QUESTIONS.filter((q) => (!groups || groups.includes(q.group)) && candidates(q, difficulty).length >= MIN_PLAYERS);

// Групи для налаштувань: лише ті, де є хоч одне питання (на найширшому рівні).
function groupList() {
  const avail = questionsFor(null, 'expert');
  return Object.entries(GROUPS).filter(([id]) => avail.some((q) => q.group === id))
    .map(([id, title]) => ({ id, title, questions: avail.filter((q) => q.group === id).map((q) => q.title) }));
}

const rand = (list) => list[Math.floor(Math.random() * list.length)];

// Пара для питання q: два гравці з різними значеннями, що відповідають рівню пари (легко/складно/мікс).
// keep — гравець, що лишається (серія: переможець попередньої пари); avoid — id, яких не брати.
function makePair(q, difficulty, level, { keep = null, avoid = new Set() } = {}) {
  const list = candidates(q, difficulty);
  const ok = (a, b, lvl) => a.p.id !== b.p.id && !avoid.has(b.p.id) && fitsLevel(q, a.v, b.v, lvl) && (!q.pairOk || q.pairOk(a.p, b.p));
  for (const lvl of level === 'mix' ? ['mix'] : [level, 'mix']) {
    for (let k = 0; k < (keep ? 1 : 40); k++) {
      const a = keep ? { p: keep, v: q.value(keep) } : rand(list);
      if (!a || a.v == null || (!keep && avoid.has(a.p.id))) continue;
      const bs = list.filter((b) => ok(a, b, lvl));
      if (bs.length) return [a, rand(bs)];
    }
  }
  return null;
}

module.exports.poolOf = poolOf;
module.exports.questionsFor = questionsFor;
module.exports.groupList = groupList;
module.exports.makePair = makePair;
module.exports.DIFFICULTIES = DIFFICULTIES;
