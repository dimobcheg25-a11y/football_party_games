// Кар'єри для «Шляху футболіста»: хто може бути загаданим (епоха × складність), етапи раунду (клуби) і підказки.
// Дані — server/data/careers.json (npm run build-careers), гравці — спільна база.
const { players, categories, categoryById } = require('../../data');
const { T } = require('../../core/i18n');
const { countryEn, teamEn } = require('../../data/names-en');
const { viaServer } = require('../../core/photos');

let data = { teams: {}, careers: {} };
try {
  data = require('../../data/careers.json');
} catch {
  // кар'єри ще не зібрані — у грі не буде кого загадувати
}

require('../../data/derived-tags').cleanCareers(data); // без клубів, де не зіграно жодного матчу
const careerOf = (p) => (p.qid ? data.careers[p.qid] : null);

// ── наскільки гравця впізнають — рейтинг, з якого рівні складності беруть верхівку
// fame (кількість мовних розділів Вікіпедії) завищене в тренерів (дель Боске, Вальверде) і легенд давнини,
// тому до нього додаємо ігрові ознаки (вартість за Transfermarkt, великі трофеї, матчі за збірну й великі клуби)
// і знімаємо бали тим, хто давно завершив кар'єру (молодші гравці їх не пам'ятають). Українцям — бонус: своїх знаємо краще.
const MAJOR = ['BALLON', 'WC', 'UCL', 'EURO', 'COPA'];
const UA_TAGS = ['UKR', 'DYN', 'SHA', 'UPL0014'];

let transfers = {};
let tmClubs = {};
let stats = null;
try {
  transfers = require('../../data/transfers.json');
  tmClubs = require('../../data/transfer-clubs.json');
} catch {
  // трансфери ще не зібрані — рейтинг без вартості
}
try {
  stats = require('../../data/stats.json');
} catch {
  // асисти ще не зібрані (npm run build-stats)
}
let facts = {};
let assists = { to: {} };
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
const { nicknameOf } = require('../../data/nicknames');

function recognition(p) {
  const c = careerOf(p);
  if (!c || !c.clubs.length) return p.fame; // без кар'єри — лише відомість за Вікіпедією
  const end = c.clubs[c.clubs.length - 1].e ?? new Date().getFullYear();
  const caps = c.nation?.a || 0;
  const bigApps = c.clubs.filter((x) => data.teams[x.t]?.cat).reduce((s, x) => s + (x.a || 0), 0);
  const value = (transfers[p.id]?.maxValue || 0) / 1e6;
  let s = p.fame + Math.min(value, 150) * 0.35 + Math.min(caps, 150) / 8 + Math.min(bigApps, 400) / 15;
  if (MAJOR.some((t) => p.tags.has(t))) s += 15;
  if (p.tags.has('BALLON')) s += 20;
  if (UA_TAGS.some((t) => p.tags.has(t))) s += 25;
  return s - Math.max(0, 2002 - end) * 1.2;
}

// Рівень = скільки найвпізнаваніших гравців загадувати (для «Сучасні» / «Завершили» — пропорційно менше, але не менше 40).
const DIFFICULTIES = { easy: 400, normal: 800, fan: 1300, hard: 1900, expert: Infinity };

// Сучасні — ще грають (останній клуб без року завершення; для старших — дані просто неповні).
function isActive(p) {
  const c = careerOf(p);
  const last = c.clubs[c.clubs.length - 1];
  return last.e == null ? (p.born || 0) >= 1983 : last.e >= 2025;
}
const ERAS = {
  all: () => true,
  modern: isActive,
  retired: (p) => !isActive(p),
};

// Загадувати можна лише тих, у кого щонайменше 3 клуби, не більше одного клубу без матчів/голів
// і є всі великі клуби, за які він грав (інакше у Wikidata бракує періоду без дат — шлях вводив би в оману).
const CLUB_IDS = new Set(categories.filter((c) => c.type === 'club').map((c) => c.id));
function hasGoodCareer(p) {
  const c = careerOf(p);
  if (!c || c.clubs.length < 3 || c.clubs.filter((x) => x.a == null).length > 1) return false;
  const have = new Set(c.clubs.map((x) => data.teams[x.t]?.cat).filter(Boolean));
  return [...p.tags].every((t) => !CLUB_IDS.has(t) || have.has(t));
}

const candidates = players.filter(hasGoodCareer).map((p) => ({ p, s: recognition(p) })).sort((a, b) => b.s - a.s).map(({ p }) => p);

function poolFor(era, difficulty) {
  const list = candidates.filter(ERAS[era]);
  const size = DIFFICULTIES[difficulty];
  return list.slice(0, Math.max(40, Math.round((size * list.length) / candidates.length)));
}

const years = (s, e) => (!s ? T(`до ${e}`, `until ${e}`) : e === s ? `${s}` : `${s}–${e ?? ''}`);

// Британські збірні у Wikidata — окремі команди, але назва й прапор в усіх — «Сполучене Королівство»
const BRITISH = {
  Q47762: ['Англія', 'England', 'Flag of England.svg'], Q34044: ['Шотландія', 'Scotland', 'Flag of Scotland.svg'],
  Q180857: ['Уельс', 'Wales', 'Flag of Wales.svg'], Q190978: ['Північна Ірландія', 'Northern Ireland', 'Ulster banner.svg'],
};

function team(qid) {
  if (BRITISH[qid]) {
    const [name, nameEn, flag] = BRITISH[qid];
    return { name, nameEn, country: name, img: viaServer(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(flag)}?width=80`) };
  }
  const t = data.teams[qid] || { name: '?' };
  const cat = t.cat ? categoryById.get(t.cat) : null;
  // «Барселона (жіночий футбольний клуб)» → «Барселона (жін.)», «Полтава (спортивний клуб)» → «Полтава»
  const name = t.name.replace(/\s*\((жіночий|женский)[^)]*\)$/i, ' (жін.)').replace(/\s*\([^)]*клуб\)$/i, '')
    .replace(/\s*\(футбольний клуб,\s*([^)]+)\)/, ' $1'); // «Ред Булл (футбольний клуб, Зальцбург)» → «Ред Булл Зальцбург»
  // nameEn — для англійської версії (інші ігри беруть name як рядок — його не чіпаємо)
  return { name, nameEn: teamEn(qid, t) || name, country: t.country || null, img: viaServer(cat?.img || t.img) || null };
}

// Етапи раунду — клуби кар'єри (з першого або з останнього).
const money = (v) => (v >= 1e6
  ? T(`€${Number((v / 1e6).toFixed(v < 1e7 ? 1 : 0))} млн`, `€${Number((v / 1e6).toFixed(v < 1e7 ? 1 : 0))}m`)
  : T(`€${Math.round(v / 1e3)} тис.`, `€${Math.round(v / 1e3)}k`));
const seasonYear = (season) => { const y = Number(String(season).slice(0, 2)); return y > 50 ? 1900 + y : 2000 + y; };
const STATS_FROM = 2012; // асисти є лише з сезону 2012/13

// Сума переходу в клуб (платні трансфери Transfermarkt): той клуб і сезон поруч із роком приходу.
function feeFor(p, x) {
  const list = (transfers[p.id]?.fees || []).filter(([, , to, season]) => tmClubs[to]?.team === x.t && Math.abs(seasonYear(season) - (x.s ?? 0)) <= 1);
  return list.length ? Math.max(...list.map((f) => f[0])) : null;
}
// Асисти в клубі за Transfermarkt — лише якщо весь період у клубі після 2012 (інакше число неповне).
function assistsFor(p, x) {
  const per = stats?.players?.[transfers[p.id]?.tm];
  if (!per || x.s == null || x.s < STATS_FROM) return undefined;
  let a = null;
  for (const [club, v] of Object.entries(per.c)) if (tmClubs[club]?.team === x.t) a = (a || 0) + v[1];
  return a ?? undefined;
}

// Країна клубу словами: британські — Англія / Шотландія / Уельс (а не «Сполучене Королівство»), як у «Вгадай гравця».
// compare підключаємо тут, а не вгорі: він сам бере careers (взаємне підключення).
function placeOf(qid, country) {
  if (!country) return null;
  const place = country === 'Сполучене Королівство' ? String(require('../guess/compare').leagueOf(qid)) : country;
  return T(place, countryEn(place));
}

function stagesFor(p, { start = 'first', showYears = true, showStats = true } = {}) {
  const c = careerOf(p);
  const clubs = start === 'last' ? [...c.clubs].reverse() : c.clubs;
  return clubs.map((x) => {
    const fee = feeFor(p, x);
    const { nameEn, ...t } = team(x.t);
    return {
      kind: 'club',
      ...t,
      name: T(t.name, nameEn),
      country: placeOf(x.t, t.country),
      years: showYears ? years(x.s, x.e) : null,
      loan: !!x.loan,
      fee: fee ? money(fee) : null,
      apps: showStats ? x.a : undefined,
      goals: showStats ? x.g : undefined,
      assists: showStats ? assistsFor(p, x) : undefined,
    };
  });
}

// ── підказки: гравець сам обирає, яку взяти; кожна знімає бали з можливих
// Ціна підказки — частка «кроку» (скільки очок забирає наступний клуб), але не менше min:
// що коротша кар'єра, то дорожчі підказки. Позиція і збірна — рівноцінні; рік народження й зріст слабкі
// (епоху й так видно з років у клубах); хто найбільше асистував і прізвисько — сильні; перша літера прізвища — найсильніша,
// тому найдорожча. has(p) — підказка є лише для цього гравця (є дані); без has — для всіх.
const HINTS = [
  { id: 'position', label: T('Позиція', 'Position'), steps: 0.6, min: 5 },
  { id: 'nation', label: T('Збірна', 'National team'), steps: 0.6, min: 5 },
  { id: 'born', label: T('Рік народження', 'Year of birth'), steps: 0.3, min: 3 },
  { id: 'height', label: T('Зріст', 'Height'), steps: 0.3, min: 3, has: (p) => !!facts[p.qid]?.h },
  { id: 'partner', label: T('Найбільше гольових йому віддав', 'Gave him the most assists'), steps: 1, min: 8, has: (p) => !!topAssister(p) },
  { id: 'nickname', label: T('Прізвисько', 'Nickname'), steps: 1.2, min: 10, has: (p) => !!nicknameOf(p) },
  { id: 'letter', label: T('Перша літера прізвища', 'First letter of surname'), steps: 2, min: 15 },
];
const hintsFor = (p) => HINTS.filter((h) => !h.has || h.has(p));

// Хто найбільше асистував гравцю (Transfermarkt, приблизно з 2012/13) — гравець бази з 3+ передачами, інакше null.
const byTm = new Map(players.filter((p) => transfers[p.id]?.tm).map((p) => [transfers[p.id].tm, p]));
function topAssister(p) {
  const row = (assists.to[transfers[p.id]?.tm] || []).find(([tm]) => byTm.has(tm) && byTm.get(tm) !== p);
  return row && row[1] >= 3 ? { p: byTm.get(row[0]), n: row[1] } : null;
}
const POSITIONS = { GK: 'Воротар', DF: 'Захисник', MF: 'Півзахисник', FW: 'Нападник' }; // рядками — їх бере й «Вгадай гравця»
const POSITIONS_EN = { GK: 'Goalkeeper', DF: 'Defender', MF: 'Midfielder', FW: 'Forward' };

function hintValue(p, id, { showStats = true } = {}) {
  const c = careerOf(p);
  if (id === 'position') {
    const pos = ['GK', 'DF', 'MF', 'FW'].find((t) => p.tags.has(t));
    return { text: pos ? T(POSITIONS[pos], POSITIONS_EN[pos]) : T('невідома', 'unknown') };
  }
  if (id === 'born') return { text: p.born ? String(p.born) : T('невідомий', 'unknown') };
  if (id === 'nation') {
    if (!c.nation) return { text: T('не грав за збірну', 'never played for a national team') };
    const t = team(c.nation.t);
    return { text: T(t.name, t.nameEn), img: t.img, apps: showStats ? c.nation.a : undefined, goals: showStats ? c.nation.g : undefined };
  }
  if (id === 'height') return { text: facts[p.qid]?.h ? T(`${facts[p.qid].h} см`, `${facts[p.qid].h} cm`) : T('невідомий', 'unknown') };
  if (id === 'partner') {
    const a = topAssister(p);
    if (!a) return { text: T('невідомо', 'unknown') };
    const n = a.n % 10 === 1 && a.n % 100 !== 11 ? 'передача' : a.n % 10 >= 2 && a.n % 10 <= 4 && (a.n % 100 < 12 || a.n % 100 > 14) ? 'передачі' : 'передач';
    return { text: T(`${a.p.uk || a.p.name} (${a.n} ${n})`, `${a.p.name} (${a.n} assists)`), img: a.p.photo ? `${a.p.photo}?s=120` : null };
  }
  if (id === 'nickname') return { text: nicknameOf(p) || T('немає', 'none') };
  if (id === 'letter') {
    // англійською — літера англійського прізвища (так, як його шукатимуть у списку)
    const first = (n) => `${(n || '').trim().split(/\s+/).pop()[0]?.toUpperCase() || '?'}…`;
    return { text: T(first(p.uk || p.name), first(p.name || p.uk)) };
  }
  return null;
}

module.exports = { poolFor, stagesFor, hintValue, hintsFor, careerOf, recognition, team, teams: data.teams, POSITIONS, POSITIONS_EN, HINTS, ERAS, DIFFICULTIES };
