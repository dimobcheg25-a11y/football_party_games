// Питання «All in»: одне число про одного футболіста («Скільки голів у чемпіонатах забив Шевченко?»).
// Значення беремо з питань «Один на один» (duel/questions.js — там уже є дані й перевірки, звідки вони), тут — лише як спитати:
//   { id, group, base (id питання duel) | value(p), label: T(питання без імені — для налаштувань), ask(p) → T, unit: T,
//     scale — як перевести значення duel у число, яке вводить гравець (гроші — у мільйони), dec — скільки знаків після коми можна ввести,
//     tol — соло: ширина «вилки» для трьох рівнів впевненості: { kind: 'ratio' } — ±10/25/50 % від оцінки, { kind: 'abs', w: [a, b, c] } — ± a/b/c }.
const { T } = require('../../core/i18n');
const duel = require('../duel/questions');
const { careerOf, team, poolFor, DIFFICULTIES } = require('../path/careers');
const { teamEn } = require('../../data/names-en');

const nm = (p) => ({ uk: p.uk || p.name, en: p.name });
const ask = (uk, en) => (p) => { const n = nm(p); return T(uk(n.uk), en(n.en)); };
const RATIO = { kind: 'ratio' };
const millions = (v) => { const m = v / 1e6; return m >= 10 ? Math.round(m) : Math.round(m * 10) / 10; };
const UNITS = {
  goals: T('голів', 'goals'), games: T('матчів', 'games'), clubs: T('клубів', 'clubs'), years: T('років', 'years'), year: T('рік', 'year'),
  cm: T('см', 'cm'), meur: T('млн €', '€m'), trophies: T('трофеїв', 'trophies'), times: T('разів', 'times'), assists: T('асистів', 'assists'),
  cards: T('карток', 'cards'), langs: T('мов', 'languages'), mfol: T('млн підписників', 'm followers'),
};

// Перехід, про який питаємо: клуб (не перший і не оренда), де гравець зіграв найбільше матчів.
function bigMove(p) {
  const clubs = careerOf(p)?.clubs || [];
  const first = clubs[0]?.t;
  const list = clubs.filter((x, i) => i > 0 && !x.loan && x.s != null && x.t !== first && (x.a || 0) >= 20);
  return list.sort((a, b) => (b.a || 0) - (a.a || 0))[0] || null;
}
const clubName = (q) => { const t = team(q); return { uk: t.name, en: teamEn(q, t) || t.name }; };

const QUESTIONS = [
  {
    id: 'born', group: 'personal', label: T('У якому році народився?', 'What year was he born?'),
    ask: ask((n) => `У якому році народився ${n}?`, (n) => `What year was ${n} born?`), unit: UNITS.year,
    note: T('Рік народження — з Вікіданих.', 'Year of birth from Wikidata.'),
    value: (p) => p.born || null, tol: { kind: 'abs', w: [0, 1, 3] }, year: true,
  },
  {
    id: 'height', group: 'personal', base: 'taller', label: T('Який у нього зріст?', 'How tall is he?'),
    ask: ask((n) => `Який зріст має ${n}?`, (n) => `How tall is ${n}?`), unit: UNITS.cm, tol: { kind: 'abs', w: [1, 3, 6] },
  },
  {
    id: 'leagueGoals', group: 'career', base: 'leagueGoals', label: T('Скільки голів у чемпіонатах?', 'How many league goals?'),
    ask: ask((n) => `Скільки голів у чемпіонатах за кар’єру забив ${n}?`, (n) => `How many league goals did ${n} score in his career?`), unit: UNITS.goals, tol: RATIO,
  },
  {
    id: 'leagueApps', group: 'career', base: 'leagueApps', label: T('Скільки матчів у чемпіонатах?', 'How many league games?'),
    ask: ask((n) => `Скільки матчів у чемпіонатах за кар’єру зіграв ${n}?`, (n) => `How many league games did ${n} play in his career?`), unit: UNITS.games, tol: RATIO,
  },
  {
    id: 'clubs', group: 'career', base: 'clubs', label: T('За скільки клубів грав?', 'How many clubs?'),
    ask: ask((n) => `За скільки різних клубів зіграв ${n} (з орендами)?`, (n) => `How many different clubs has ${n} played for (loans included)?`), unit: UNITS.clubs, tol: { kind: 'abs', w: [0, 1, 2] },
  },
  {
    id: 'longestClub', group: 'career', base: 'longestClub', label: T('Скільки років в одному клубі?', 'Most years at one club?'),
    ask: ask((n) => `Найдовше ${n} грав в одному клубі без перерви. Скільки років?`, (n) => `What is the longest unbroken spell ${n} had at one club, in years?`), unit: UNITS.years, tol: { kind: 'abs', w: [0, 1, 3] },
  },
  {
    id: 'moveYear', group: 'career', label: T('У якому році перейшов у клуб?', 'What year did he join the club?'),
    ask: (p) => { const n = nm(p); const c = clubName(bigMove(p).t); return T(`У якому році ${n.uk} перейшов у ${c.uk}?`, `What year did ${n.en} join ${c.en}?`); },
    unit: UNITS.year, note: T('Рік переходу — за таблицею кар’єри у Вікіпедії.', 'Year of the move — from the Wikipedia career table.'),
    value: (p) => bigMove(p)?.s ?? null, tol: { kind: 'abs', w: [0, 1, 3] }, year: true,
  },
  {
    id: 'caps', group: 'nation', base: 'caps', label: T('Скільки матчів за збірну?', 'How many caps?'),
    ask: ask((n) => `Скільки матчів за збірну зіграв ${n}?`, (n) => `How many caps does ${n} have?`), unit: UNITS.games, tol: RATIO,
  },
  {
    id: 'natGoals', group: 'nation', base: 'natGoals', label: T('Скільки голів за збірну?', 'How many international goals?'),
    ask: ask((n) => `Скільки голів за збірну забив ${n}?`, (n) => `How many international goals did ${n} score?`), unit: UNITS.goals, tol: RATIO,
  },
  {
    id: 'maxValue', group: 'money', base: 'maxValue', scale: millions, dec: 1, label: T('Пік ринкової вартості?', 'Peak market value?'),
    ask: ask((n) => `Скільки коштував ${n} на піку кар’єри (ринкова вартість)?`, (n) => `What was ${n}’s peak market value?`), unit: UNITS.meur, tol: RATIO,
  },
  {
    id: 'topFee', group: 'money', base: 'topFee', scale: millions, dec: 1, label: T('Найдорожчий трансфер?', 'Record transfer fee?'),
    ask: ask((n) => `${n}: за скільки відбувся його найдорожчий трансфер?`, (n) => `What was ${n}’s record transfer fee?`), unit: UNITS.meur, tol: RATIO,
  },
  {
    id: 'assists', group: 'stats', base: 'assists', label: T('Скільки асистів з 2012?', 'How many assists since 2012?'),
    ask: ask((n) => `Скільки гольових передач у клубах віддав ${n} (з 2012/13)?`, (n) => `How many club assists has ${n} made (since 2012/13)?`), unit: UNITS.assists, tol: RATIO,
  },
  {
    id: 'ga', group: 'stats', base: 'ga', label: T('Скільки «гол + пас» з 2012?', 'Goals + assists since 2012?'),
    ask: ask((n) => `Скільки «гол + пас» у клубах набрав ${n} (з 2012/13)?`, (n) => `How many club goals + assists does ${n} have (since 2012/13)?`), unit: T('гол + пас', 'G+A'), tol: RATIO,
  },
  {
    id: 'yellow', group: 'stats', base: 'yellow', label: T('Скільки жовтих карток з 2012?', 'Yellow cards since 2012?'),
    ask: ask((n) => `Скільки жовтих карток у клубах отримав ${n} (з 2012/13)?`, (n) => `How many club yellow cards has ${n} received (since 2012/13)?`), unit: UNITS.cards, tol: RATIO,
  },
  {
    id: 'trophies', group: 'trophies', base: 'trophies', label: T('Скільки трофеїв?', 'How many trophies?'),
    ask: ask((n) => `Скільки командних трофеїв виграв ${n}?`, (n) => `How many team trophies has ${n} won?`), unit: UNITS.trophies, tol: { kind: 'abs', w: [0, 2, 5] },
  },
  {
    id: 'leagueTitles', group: 'trophies', base: 'leagueTitles', label: T('Скільки чемпіонств?', 'How many league titles?'),
    ask: ask((n) => `Скільки разів ставав чемпіоном країни ${n}?`, (n) => `How many league titles has ${n} won?`), unit: UNITS.times, tol: { kind: 'abs', w: [0, 1, 2] },
  },
  {
    id: 'ballonTop10', group: 'trophies', base: 'ballonTop10', label: T('Скільки разів у десятці «Золотого м’яча»?', 'Ballon d’Or top-10 finishes?'),
    ask: ask((n) => `Скільки разів ${n} потрапляв у десятку «Золотого м’яча»?`, (n) => `How many times did ${n} finish in the Ballon d’Or top 10?`), unit: UNITS.times, tol: { kind: 'abs', w: [0, 1, 2] },
  },
  {
    id: 'wikiLangs', group: 'fame', base: 'wikiLangs', label: T('У скількох Вікіпедіях?', 'In how many Wikipedias?'),
    ask: ask((n) => `${n}: у скількох мовних розділах Вікіпедії є стаття про нього?`, (n) => `In how many Wikipedia languages is there an article about ${n}?`), unit: UNITS.langs, tol: RATIO,
  },
  {
    id: 'instagram', group: 'instagram', base: 'instagram', scale: millions, dec: 1, label: T('Скільки підписників в Instagram?', 'Instagram followers?'),
    ask: ask((n) => `Скільки підписників в Instagram має ${n}?`, (n) => `How many Instagram followers does ${n} have?`), unit: UNITS.mfol, tol: RATIO,
  },
];

// Значення, пояснення й подробиці відповіді: з питання duel (base) або своє (value).
for (const q of QUESTIONS) {
  const b = q.base && duel.questionById.get(q.base);
  if (q.base && !b) throw new Error(`allin: немає питання duel ${q.base}`);
  q.raw = b ? b.value : q.value;
  q.answer = (p) => { const v = q.raw(p); return v == null || !Number.isFinite(v) ? null : q.scale ? q.scale(v) : Math.round(v); };
  if (!q.note) q.note = b.note;
  q.detail = (p) => (b ? b.show(b.value(p), p).detail || null : null);
}
const questionById = new Map(QUESTIONS.map((q) => [q.id, q]));
const GROUPS = duel.GROUPS;
const MIN_PLAYERS = 12;

const pools = new Map(); // складність → Map(питання → [гравці зі значенням])
function candidates(q, difficulty) {
  if (!pools.has(difficulty)) {
    const base = poolFor('all', difficulty);
    pools.set(difficulty, new Map(QUESTIONS.map((x) => [x.id, base.filter((p) => x.answer(p) != null)])));
  }
  return pools.get(difficulty).get(q.id);
}
const questionsFor = (groups, difficulty) => QUESTIONS.filter((q) => (!groups || groups.includes(q.group)) && candidates(q, difficulty).length >= MIN_PLAYERS);
function groupList() {
  const avail = questionsFor(null, 'expert');
  return Object.entries(GROUPS).filter(([id]) => avail.some((q) => q.group === id))
    .map(([id, title]) => ({ id, title, questions: avail.filter((q) => q.group === id).map((q) => q.label) }));
}

// Соло: «вилка» навколо оцінки для рівня впевненості (0 — вузька … 2 — широка).
const RATIO_W = [0.1, 0.25, 0.5];
function range(q, guess, level) {
  if (q.tol.kind === 'abs') return [guess - q.tol.w[level], guess + q.tol.w[level]];
  return [guess * (1 - RATIO_W[level]), guess * (1 + RATIO_W[level])];
}
const rangeText = (q, level) => (q.tol.kind !== 'abs' ? `± ${RATIO_W[level] * 100} %` : q.tol.w[level] ? `± ${q.tol.w[level]}` : T('точно', 'exact'));

module.exports = { QUESTIONS, GROUPS, questionById, candidates, questionsFor, groupList, range, rangeText, DIFFICULTIES };
