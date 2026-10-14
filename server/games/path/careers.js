// Кар'єри для «Шляху футболіста»: хто може бути загаданим (епоха × складність), етапи раунду (клуби) і підказки.
// Дані — server/data/careers.json (npm run build-careers), гравці — спільна база.
const { players, categories, categoryById } = require('../../data');

let data = { teams: {}, careers: {} };
try {
  data = require('../../data/careers.json');
} catch {
  // кар'єри ще не зібрані — у грі не буде кого загадувати
}

const careerOf = (p) => (p.qid ? data.careers[p.qid] : null);

// ── наскільки гравця впізнають — рейтинг, з якого рівні складності беруть верхівку
// fame (кількість мовних розділів Вікіпедії) завищене в тренерів (дель Боске, Вальверде) і легенд давнини,
// тому до нього додаємо ігрові ознаки (вартість за Transfermarkt, великі трофеї, матчі за збірну й великі клуби)
// і знімаємо бали тим, хто давно завершив кар'єру (молодші гравці їх не пам'ятають). Українцям — бонус: своїх знаємо краще.
const MAJOR = ['BALLON', 'WC', 'UCL', 'EURO', 'COPA'];
const UA_TAGS = ['UKR', 'DYN', 'SHA', 'UPL0014'];

let transfers = {};
try {
  transfers = require('../../data/transfers.json');
} catch {
  // трансфери ще не зібрані — рейтинг без вартості
}

function recognition(p) {
  const c = careerOf(p);
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

const years = (s, e) => (!s ? `до ${e}` : e === s ? `${s}` : `${s}–${e ?? ''}`);

function team(qid) {
  const t = data.teams[qid] || { name: '?' };
  const cat = t.cat ? categoryById.get(t.cat) : null;
  // «Барселона (жіночий футбольний клуб)» → «Барселона (жін.)», «Полтава (спортивний клуб)» → «Полтава»
  const name = t.name.replace(/\s*\((жіночий|женский)[^)]*\)$/i, ' (жін.)').replace(/\s*\([^)]*клуб\)$/i, '');
  return { name, country: t.country || null, img: cat?.img || t.img || null };
}

// Етапи раунду — клуби кар'єри (з першого або з останнього).
function stagesFor(p, { start = 'first', showYears = true, showStats = true } = {}) {
  const c = careerOf(p);
  const clubs = start === 'last' ? [...c.clubs].reverse() : c.clubs;
  return clubs.map((x) => ({
    kind: 'club',
    ...team(x.t),
    years: showYears ? years(x.s, x.e) : null,
    loan: !!x.loan,
    apps: showStats ? x.a : undefined,
    goals: showStats ? x.g : undefined,
  }));
}

// ── підказки: гравець сам обирає, яку взяти; кожна знімає бали з можливих
// Ціна підказки — частка «кроку» (скільки очок забирає наступний клуб), але не менше min:
// що коротша кар'єра, то дорожчі підказки. Позиція і збірна — рівноцінні; рік народження слабкий
// (епоху й так видно з років у клубах); перша літера прізвища — найсильніша, тому найдорожча.
const HINTS = [
  { id: 'position', label: 'Позиція', steps: 0.6, min: 5 },
  { id: 'nation', label: 'Збірна', steps: 0.6, min: 5 },
  { id: 'born', label: 'Рік народження', steps: 0.3, min: 3 },
  { id: 'letter', label: 'Перша літера прізвища', steps: 2, min: 15 },
];
const POSITIONS = { GK: 'Воротар', DF: 'Захисник', MF: 'Півзахисник', FW: 'Нападник' };

function hintValue(p, id, { showStats = true } = {}) {
  const c = careerOf(p);
  if (id === 'position') {
    const pos = ['GK', 'DF', 'MF', 'FW'].find((t) => p.tags.has(t));
    return { text: pos ? POSITIONS[pos] : 'невідома' };
  }
  if (id === 'born') return { text: p.born ? String(p.born) : 'невідомий' };
  if (id === 'nation') {
    if (!c.nation) return { text: 'не грав за збірну' };
    const t = team(c.nation.t);
    return { text: t.name, img: t.img, apps: showStats ? c.nation.a : undefined, goals: showStats ? c.nation.g : undefined };
  }
  if (id === 'letter') {
    const surname = (p.uk || p.name).trim().split(/\s+/).pop();
    return { text: `${surname[0].toUpperCase()}…` };
  }
  return null;
}

module.exports = { poolFor, stagesFor, hintValue, careerOf, team, teams: data.teams, POSITIONS, HINTS, ERAS, DIFFICULTIES };
