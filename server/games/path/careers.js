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

// ── наскільки гравець відомий САМЕ ЯК ГРАВЕЦЬ
// fame (кількість мовних розділів Вікіпедії) завищене в тих, хто прославився як тренер (Вальверде, Лопетегі),
// тому до нього додаємо ігрові ознаки: трофеї, матчі за збірну, матчі за великі клуби (клуби з категорій).
const MAJOR = ['BALLON', 'WC', 'UCL', 'EURO', 'COPA', 'BOOT', 'CAPS100', 'G300'];
const CHAMP = ['APL', 'CH_IT', 'CH_ES', 'CH_DE', 'UEL'];
const UA_TAGS = ['UKR', 'DYN', 'SHA', 'UPL0014'];

function signals(p) {
  const c = careerOf(p);
  const caps = c.nation?.a || 0;
  const bigApps = c.clubs.filter((x) => data.teams[x.t]?.cat).reduce((s, x) => s + (x.a || 0), 0);
  const major = MAJOR.some((t) => p.tags.has(t));
  const champ = CHAMP.some((t) => p.tags.has(t));
  const strong = major || caps >= 50 || bigApps >= 200;
  const medium = strong || (champ && bigApps >= 60) || caps >= 25 || bigApps >= 100;
  const some = medium || caps >= 10 || bigApps >= 40;
  // своїх ми знаємо краще: українцям — бонус до відомості
  const fame = p.fame + (UA_TAGS.some((t) => p.tags.has(t)) ? 25 : 0);
  return { fame, strong, medium, some };
}

const DIFFICULTIES = {
  easy: (s) => s.fame >= 65 && s.strong,
  normal: (s) => s.fame >= 45 && s.medium,
  fan: (s) => s.fame >= 30 && s.some,
  hard: (s) => s.fame >= 35 || s.some,
  expert: () => true,
};

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

const candidates = players.filter(hasGoodCareer).map((p) => ({ p, s: signals(p) }));

function poolFor(era, difficulty) {
  const fit = DIFFICULTIES[difficulty];
  return candidates.filter(({ p, s }) => ERAS[era](p) && fit(s)).map(({ p }) => p);
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
