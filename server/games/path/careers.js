// Кар'єри для «Шляху футболіста»: хто може бути загаданим (набір × складність) і з яких етапів складається раунд.
// Дані — server/data/careers.json (npm run build-careers), гравці — спільна база.
const { players, categoryById } = require('../../data');

let data = { teams: {}, careers: {} };
try {
  data = require('../../data/careers.json');
} catch {
  // кар'єри ще не зібрані — у грі не буде кого загадувати
}

const POSITIONS = { GK: 'Воротар', DF: 'Захисник', MF: 'Півзахисник', FW: 'Нападник' };
const UA_TAGS = ['UKR', 'DYN', 'SHA', 'UPL0014'];
const isUa = (p) => UA_TAGS.some((t) => p.tags.has(t));

// Відомість — кількість мовних розділів Вікіпедії зі статтею про гравця (поле fame).
// Набори: усі гравці бази або лише ті, хто грав у чемпіонаті України 2000–2014.
const POOLS = {
  all: {
    easy: (p) => p.fame >= 60,
    normal: (p) => p.fame >= 45 || (isUa(p) && p.fame >= 20),
    hard: () => true,
  },
  upl: {
    easy: (p) => p.fame >= 25,
    normal: (p) => p.fame >= 12,
    hard: () => true,
  },
};

const careerOf = (p) => (p.qid ? data.careers[p.qid] : null);

// Загадувати можна лише тих, у кого щонайменше 3 клуби, і не більше одного клубу без матчів/голів.
function hasGoodCareer(p) {
  const c = careerOf(p);
  return !!c && c.clubs.length >= 3 && c.clubs.filter((x) => x.a == null).length <= 1;
}

const candidates = players.filter(hasGoodCareer);

function poolFor(set, difficulty) {
  const fit = POOLS[set][difficulty];
  return candidates.filter((p) => (set === 'upl' ? p.tags.has('UPL0014') : true) && fit(p));
}

const years = (s, e) => (e === s ? `${s}` : `${s}–${e ?? ''}`);

function team(qid) {
  const t = data.teams[qid] || { name: '?' };
  const cat = t.cat ? categoryById.get(t.cat) : null;
  return { name: t.name, country: t.country || null, img: cat?.img || null };
}

// Етапи раунду: клуби (з першого або з останнього), далі підказки — збірна, позиція, рік народження.
function stagesFor(p, { start = 'first', showYears = true, showStats = true } = {}) {
  const c = careerOf(p);
  const clubs = start === 'last' ? [...c.clubs].reverse() : c.clubs;
  const stages = clubs.map((x) => ({
    kind: 'club',
    ...team(x.t),
    years: showYears ? years(x.s, x.e) : null,
    apps: showStats ? x.a : undefined,
    goals: showStats ? x.g : undefined,
  }));
  if (c.nation) {
    stages.push({ kind: 'nation', name: team(c.nation.t).name, apps: showStats ? c.nation.a : undefined, goals: showStats ? c.nation.g : undefined });
  }
  const pos = ['GK', 'DF', 'MF', 'FW'].find((t) => p.tags.has(t));
  if (pos) stages.push({ kind: 'position', name: POSITIONS[pos] });
  if (p.born) stages.push({ kind: 'born', name: String(p.born) });
  return stages;
}

module.exports = { poolFor, stagesFor, POOLS };
