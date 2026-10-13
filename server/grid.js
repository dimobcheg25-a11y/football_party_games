const { players, categories, categoryById, matches } = require('./data');

// Минимум вариантов ответа в каждой клетке — чтобы не было «одного правильного ответа».
const MIN_ANSWERS_PER_CELL = 3;
const MAX_ATTEMPTS = 20000;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// candidates[cell] — массив id игроков, подходящих в клетку (cell = row * 3 + col).
function cellCandidates(rows, cols, excluded = new Set()) {
  const result = [];
  for (const r of rows) {
    for (const c of cols) {
      result.push(
        players.filter((p) => !excluded.has(p.id) && matches(p, r) && matches(p, c)).map((p) => p.id),
      );
    }
  }
  return result;
}

// Максимальное паросочетание «клетки ↔ игроки» (алгоритм Куна).
// Возвращает массив: для каждой клетки id игрока или null.
function maxMatching(candidates) {
  const owner = new Map(); // playerId -> cell
  const assign = candidates.map(() => null);

  function tryCell(cell, seen) {
    for (const pid of candidates[cell]) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      if (!owner.has(pid) || tryCell(owner.get(pid), seen)) {
        owner.set(pid, cell);
        assign[cell] = pid;
        return true;
      }
    }
    return false;
  }

  candidates.forEach((list, cell) => {
    if (list.length) tryCell(cell, new Set());
  });
  return assign;
}

// Можно ли заполнить указанные клетки разными игроками (без уже использованных).
function canFillDistinct(rows, cols, cells, usedIds) {
  const all = cellCandidates(rows, cols, usedIds);
  const subset = cells.map((cell) => all[cell]);
  return maxMatching(subset).every((pid) => pid !== null);
}

// ── Режими гри
// easy   — 15 топ-клубів, 9 топ-збірних, ЧС/ЛЧ/Євро/Золотий м'яч, позиції; щонайменше 10 відповідей у клітинці,
//          з них 6 — зірки (стаття у 55+ мовних розділах Вікіпедії);
// normal — топ-клуби й збірні; у кожній клітинці щонайменше 4 ВІДОМІ відповіді й 6 відповідей загалом
//          (клітинки з 5 і менше варіантами — «ту мач» для звичайного режиму). Для українських категорій
//          поріг м'якший: їхніх гравців наші знають краще, ніж каже статистика Вікіпедії, а перетинів у них мало;
// hard   — усі категорії, але щонайменше 4 з 6 — «нешаблонні» (level у categories.js); у клітинці 3–15 відповідей
//          і не більше 3 зірок — щоб клітинку не закривали Роналду з Мессі. Через це найочевидніші категорії
//          (Реал, ЧС, ЛЧ, Золотий м'яч, польові позиції) у складний майже не потрапляють — вони для легкого/звичайного.
const UA_TAGS = ['UKR', 'DYN', 'SHA'];
const isFamous = (p) => p.fame >= 50 || (p.fame >= 25 && UA_TAGS.some((t) => p.tags.has(t)));

const MODES = {
  easy: {
    categories: categories.filter((c) => !c.level).map((c) => c.id),
    pool: players.filter((p) => p.fame >= 55),
    minAnswers: 6,
    minTotal: 10,
    maxMeanAnswers: Infinity,
  },
  normal: {
    categories: categories.filter((c) => c.level !== 'hard').map((c) => c.id),
    pool: players.filter(isFamous),
    minAnswers: 4, // відомих гравців у клітинці
    minTotal: 6, // усіх правильних відповідей у клітинці
    uaMinAnswers: 3,
    uaMinTotal: 4,
    maxMeanAnswers: Infinity,
  },
  hard: {
    categories: categories.map((c) => c.id),
    pool: players,
    minAnswers: 3,
    minTotal: 3, // з 2 відповідями й правилом «без повторів» клітинка перетворюється на лотерею
    maxTotal: 15, // більше — клітинка надто проста
    maxStars: 3, // зірок (55+ мовних розділів Вікіпедії) у клітинці
    minNiche: 4, // категорій не з легкого режиму в сітці
    maxMeanAnswers: Infinity,
  },
};

// Скільки спільних гравців у кожної пари категорій — рахуємо один раз на старті:
// pairCount — серед пулу режиму (відомих), pairTotal — серед усіх гравців бази.
const countPairs = (pool, ids) => {
  const m = new Map(ids.map((id) => [id, new Map()]));
  for (const a of ids) {
    for (const b of ids) {
      if (a >= b) continue;
      const n = pool.reduce((acc, p) => acc + (matches(p, a) && matches(p, b) ? 1 : 0), 0);
      m.get(a).set(b, n);
      m.get(b).set(a, n);
    }
  }
  return m;
};
const STAR_FAME = 55;
for (const mode of Object.values(MODES)) {
  mode.pairCount = countPairs(mode.pool, mode.categories);
  mode.pairTotal = mode.pool === players ? mode.pairCount : countPairs(players, mode.categories);
  if (mode.maxStars !== undefined) mode.pairStars = countPairs(players.filter((p) => p.fame >= STAR_FAME), mode.categories);
}

// Мінімальні пороги для клітинки «a × b» (для українських категорій — м'якші, якщо задані)
function thresholds(mode, a, b) {
  const ua = UA_TAGS.includes(a) || UA_TAGS.includes(b);
  return {
    famous: ua && mode.uaMinAnswers ? mode.uaMinAnswers : mode.minAnswers,
    total: ua && mode.uaMinTotal ? mode.uaMinTotal : mode.minTotal,
  };
}

const typeOf = (id) => categoryById.get(id).type;

function pickCompatible(mode, mustMatch, taken, count) {
  const enough = (a, b) => {
    const t = thresholds(mode, a, b);
    const total = mode.pairTotal.get(a).get(b) || 0;
    if (mode.maxTotal !== undefined && total > mode.maxTotal) return false;
    if (mode.maxStars !== undefined && (mode.pairStars.get(a).get(b) || 0) > mode.maxStars) return false;
    return (mode.pairCount.get(a).get(b) || 0) >= t.famous && total >= t.total;
  };
  const options = shuffle(mode.categories.filter((id) => !taken.includes(id) && mustMatch.every((m) => enough(id, m))));
  return options.length >= count ? options.slice(0, count) : null;
}

function validMix(picked) {
  // Трофеї та рекорди — не більше двох на сітку, основа — клуби й збірні.
  if (picked.filter((id) => ['award', 'stat'].includes(typeOf(id))).length > 2) return false;
  // Позиція — максимум одна: «воротар × нападник» — порожня клітинка, а дві позиції роблять сітку нудною.
  if (picked.filter((id) => typeOf(id) === 'position').length > 1) return false;
  return true;
}

// Кандидати серед пулу режиму (для перевірки, що сітка «чесна»)
function poolCandidates(mode, rows, cols) {
  const result = [];
  for (const r of rows) for (const c of cols) result.push(mode.pool.filter((p) => matches(p, r) && matches(p, c)).map((p) => p.id));
  return result;
}

// Сітку будуємо від «насіння»: спершу випадкова категорія (усі мають рівні шанси),
// потім стовпці, сумісні з нею, потім рядки, сумісні з усіма стовпцями.
function generateGrid(modeName = 'normal') {
  const mode = MODES[modeName] || MODES.normal;
  let seed = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // одне «насіння» пробуємо кілька разів — інакше нішеві категорії (Україна, Динамо) майже не випадають
    if (attempt % 40 === 0) seed = mode.categories[Math.floor(Math.random() * mode.categories.length)];
    const cols = pickCompatible(mode, [seed], [seed], 3);
    if (!cols) continue;
    const others = pickCompatible(mode, cols, [seed, ...cols], 2);
    if (!others) continue;
    let rows = shuffle([seed, ...others]);
    let colsOrdered = cols;
    if (Math.random() < 0.5) [rows, colsOrdered] = [colsOrdered, rows]; // насіння буває і в стовпцях
    if (!validMix([...rows, ...colsOrdered])) continue;
    if (mode.minNiche && [...rows, ...colsOrdered].filter((id) => categoryById.get(id).level).length < mode.minNiche) continue;

    const pool = poolCandidates(mode, rows, colsOrdered);
    const cellMin = (i) => thresholds(mode, rows[Math.floor(i / 3)], colsOrdered[i % 3]);
    if (pool.some((list, i) => list.length < cellMin(i).famous)) continue;
    // Головне правило: у сітку можна поставити 9 РІЗНИХ футболістів (з пулу режиму).
    if (maxMatching(pool).some((pid) => pid === null)) continue;
    // Складний режим — відкидаємо надто «широкі» сітки (у перших спробах; далі — будь-яку валідну).
    const mean = pool.reduce((a, l) => a + l.length, 0) / 9;
    if (mean > mode.maxMeanAnswers && attempt < MAX_ATTEMPTS / 2) continue;

    // Зараховуються всі гравці бази, тож показуємо повну кількість правильних відповідей.
    const all = cellCandidates(rows, colsOrdered);
    if (all.some((list, i) => list.length < cellMin(i).total)) continue;
    return { rows, cols: colsOrdered, answerCounts: all.map((l) => l.length) };
  }
  throw new Error('Не вдалося згенерувати сітку — замала база гравців');
}

module.exports = { generateGrid, cellCandidates, maxMatching, canFillDistinct, MODES };
