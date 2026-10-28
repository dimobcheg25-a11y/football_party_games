// «Чотири четвірки»: генерація головоломки — 16 футболістів, які розкладаються на 4 групи по 4 за спільною ознакою.
// Ознаки — категорії бази (клуб, збірна, ліга, трофей, тренер, академія…) + рік народження й тезки (рахуються тут).
// Рівень групи (колір) — 0 проста … 3 підступна. Гравець може підходити до двох груп (це «пастка»), але розклад
// на групи завжди один — перевіряє uniquePartitions.
const { categories, normalize } = require('../../data');
const { poolFor } = require('../path/careers');
const { T } = require('../../core/i18n');

// Рівень кожної категорії бази. Чого тут немає (позиції) — у грі не буває.
const TIER = {};
const setTier = (tier, ids) => ids.forEach((id) => (TIER[id] = tier));
for (const c of categories) {
  if (c.type === 'club' || c.type === 'nation') TIER[c.id] = c.level === 'hard' ? 1 : 0;
  if (c.type === 'league') TIER[c.id] = c.level === 'fan' ? 3 : 1;
  if (c.type === 'coach') TIER[c.id] = 1;
  if (c.type === 'academy') TIER[c.id] = 2;
  if (c.type === 'partner') TIER[c.id] = 3;
}
setTier(0, ['BALLON', 'WC']);
setTier(1, ['UCL', 'EURO', 'APL', 'CH_IT', 'CH_ES', 'CH_DE', 'CAPS100', 'G300', 'BDO3']);
setTier(2, ['COPA', 'UEL', 'BOOT', 'T80', 'T100', 'UCL30', 'G50N', 'A100', 'CO_LUE', 'CO_LOB', 'BDO10', 'W11', 'H190']);
setTier(3, ['TS_EPL', 'TS_SA', 'TS_LL', 'TS_BL', 'TS_L1', 'GBOY', 'JOURNEY', 'H170']);
const BORN_TIER = 2; // рік народження — складна
const NAME_TIER = 3; // тезки — підступна

// Склад головоломки за складністю: рівні чотирьох груп (кольори — за порядком, від простої).
const LEVELS = {
  easy: { pool: 'easy', tiers: [0, 0, 1, 2], traps: [0, 1] },
  normal: { pool: 'normal', tiers: [0, 1, 2, 3], traps: [1, 2] },
  fan: { pool: 'fan', tiers: [1, 2, 3, 3], traps: [2, 4] },
};

const firstName = (s) => normalize(String(s || '').split(/\s+/)[0] || '');

// Усі ознаки для пулу складності: { key, tier, label: T, test(p), members: [p] }.
const featureCache = new Map();
function featuresFor(level) {
  if (featureCache.has(level)) return featureCache.get(level);
  const pool = poolFor('all', LEVELS[level].pool);
  const list = [];
  for (const c of categories) {
    if (TIER[c.id] == null) continue;
    const members = pool.filter((p) => p.tags.has(c.id));
    list.push({ key: c.id, kind: c.type, tier: TIER[c.id], label: T(c.label, c.en), img: c.img, icon: c.icon, test: (p) => p.tags.has(c.id), members });
  }
  const byYear = new Map();
  const byName = new Map();
  for (const p of pool) {
    if (p.born) (byYear.get(p.born) || byYear.set(p.born, []).get(p.born)).push(p);
    // тезки — лише ті, кого знають за ім'ям і прізвищем (Неймара й Пеле не беремо)
    const en = String(p.name).split(/\s+/);
    const uk = String(p.uk || '').split(/\s+/);
    if (en.length < 2 || uk.length < 2) continue;
    const key = firstName(p.name);
    if (key.length < 3) continue;
    (byName.get(key) || byName.set(key, []).get(key)).push(p);
  }
  for (const [year, members] of byYear) {
    list.push({ key: `Y${year}`, kind: 'born', tier: BORN_TIER, label: T(`Народилися ${year} року`, `Born in ${year}`),
      icon: '🎂', test: (p) => p.born === year, members });
  }
  for (const [key, members] of byName) {
    // ім'я однаково пишеться українською в усіх (Луїс ≠ Луіс) — інакше назва групи буде дивна
    const ukNames = new Set(members.map((p) => firstName(p.uk)));
    if (ukNames.size !== 1) continue;
    const uk = members[0].uk.split(/\s+/)[0];
    const en = members[0].name.split(/\s+/)[0];
    list.push({ key: `N${key}`, kind: 'name', tier: NAME_TIER, label: T(`Тезки: ${uk}`, `Namesakes: ${en}`),
      icon: '👥', test: (p) => firstName(p.name) === key && String(p.uk || '').split(/\s+/).length >= 2, members });
  }
  const usable = list.filter((f) => f.members.length >= 4);
  featureCache.set(level, usable);
  return usable;
}

// Генератор випадкових чисел з насінням — «Головоломка дня» однакова для всіх.
function seeded(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rnd) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Скільки є способів розкласти 16 гравців на 4 групи по 4 (кожен — у групу, ознаку якої має). Рахуємо до 2.
function uniquePartitions(board, groups) {
  const fits = board.map((p) => groups.map((g, i) => (g.test(p) ? i : -1)).filter((i) => i !== -1));
  const left = [4, 4, 4, 4];
  let count = 0;
  const walk = (k) => {
    if (count > 1) return;
    if (k === board.length) return void count++;
    for (const i of fits[k]) {
      if (!left[i]) continue;
      left[i]--;
      walk(k + 1);
      left[i]++;
    }
  };
  walk(0);
  return count;
}

// Ознаки, які не можна ставити поруч: дві однакові за суттю (рік і рік, тезки й тезки) — інакше нудно.
const clash = (a, b) => (a.kind === 'born' && b.kind === 'born') || (a.kind === 'name' && b.kind === 'name')
  || (a.kind === 'partner' && b.kind === 'partner') || a.key === b.key;
// «Асистував зірці» перетинається з клубами майже завжди, тож як «пов'язана» ознака вигравала б щоразу — беремо її рідше
const RARE = { partner: 0.25 };

// Одна спроба зібрати головоломку; null — не вийшло.
function attempt(features, cfg, rnd) {
  const chosen = [];
  for (const tier of cfg.tiers) {
    const options = shuffle(features.filter((f) => f.tier === tier && !chosen.some((c) => clash(c, f)) && (!RARE[f.kind] || rnd() < RARE[f.kind])), rnd);
    // пастки бувають, коли ознаки перетинаються — тож після першої беремо пов'язану з уже обраними, якщо така є
    const related = options.find((f) => chosen.some((c) => f.members.filter((p) => c.test(p)).length >= 2));
    const pick = chosen.length && related && rnd() < 0.7 ? related : options[0];
    if (!pick) return null;
    chosen.push(pick);
  }
  // гравці: у кожну групу — 4 різні; відоміші (вище в пулі) — частіше
  const used = new Set();
  const groups = [];
  for (const f of chosen) {
    const free = f.members.filter((p) => !used.has(p.id));
    if (free.length < 4) return null;
    const ranked = free.map((p) => ({ p, w: rnd() * (1 + free.length / (free.indexOf(p) + 8)) })).sort((a, b) => b.w - a.w);
    const four = ranked.slice(0, 4).map((x) => x.p);
    four.forEach((p) => used.add(p.id));
    groups.push({ ...f, players: four });
  }
  const board = groups.flatMap((g) => g.players);
  const traps = board.filter((p) => groups.filter((g) => g.test(p)).length > 1).length;
  if (traps < cfg.traps[0] || traps > cfg.traps[1]) return null;
  if (uniquePartitions(board, groups) !== 1) return null;
  return groups;
}

// Головоломка: { groups: [{ key, color, label, icon, img, players: [p] }] (від простої), board: [p] (перемішано) }.
// seed — рядок (дата для «Головоломки дня»); без нього — випадкова. avoid — ключі ознак, які вже були в серії.
function makePuzzle(level = 'normal', { seed = null, avoid = new Set() } = {}) {
  const cfg = LEVELS[level] || LEVELS.normal;
  const rnd = seed ? seeded(seed) : Math.random;
  const all = featuresFor(LEVELS[level] ? level : 'normal');
  const fresh = all.filter((f) => !avoid.has(f.key));
  for (let i = 0; i < 3000; i++) {
    // пастки підбираються випадково — якщо довго не виходить, ослаблюємо вимогу
    const relaxed = i > 1500 ? { ...cfg, traps: [0, cfg.traps[1]] } : cfg;
    const groups = attempt(i < 2000 ? fresh : all, relaxed, rnd);
    if (!groups) continue;
    return {
      groups: groups.map((g, color) => ({ key: g.key, color, label: g.label, icon: g.icon, img: g.img || null, players: g.players })),
      board: shuffle(groups.flatMap((g) => g.players), rnd),
    };
  }
  return null;
}

module.exports = { makePuzzle, featuresFor, uniquePartitions, LEVELS, TIER };
