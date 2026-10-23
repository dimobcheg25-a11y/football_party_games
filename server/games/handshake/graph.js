// «Правило рукостискань»: граф одноклубників — двоє пов'язані, якщо грали в одному клубі в ті самі роки
// (роки в клубі перетинаються, як «🤝 грали разом» у «Вгадай гравця»). Збірні не рахуються.
// Будується один раз при старті з кар'єр усієї бази.
const { players, playerById } = require('../../data');
const { careerOf, team, teams, poolFor, recognition } = require('../path/careers');
const { teamEn } = require('../../data/names-en');
const { T } = require('../../core/i18n');

const NOW = new Date().getFullYear();

// id → Map(id сусіда → [{ t: qid клубу, s, e }]) — усі клуби, де грали разом, і спільні роки
const links = new Map();
function addLink(a, b, info) {
  for (const [x, y] of [[a, b], [b, a]]) {
    if (!links.has(x)) links.set(x, new Map());
    const m = links.get(x);
    if (!m.has(y)) m.set(y, []);
    m.get(y).push(info);
  }
}
(function build() {
  const byClub = new Map();
  for (const p of players) {
    const clubs = (careerOf(p)?.clubs || []).filter((x) => !teams[x.t]?.national && (x.s ?? x.e) != null)
      .map((x) => ({ ...x, s: x.s ?? x.e, e: x.e ?? NOW }));
    for (const x of clubs) {
      // роки в клубі мінус оренди з нього (Маунт: Челсі 2017–2023, але 2017–19 — оренди у Вітессе й Дербі)
      let parts = [[x.s, x.e]];
      if (!x.loan) {
        for (const y of clubs) {
          if (!y.loan || y.s < x.s || y.e > x.e) continue;
          parts = parts.flatMap(([s, e]) => [[s, Math.min(e, y.s)], [Math.max(s, y.e), e]]).filter(([s, e]) => s < e);
        }
      }
      if (!byClub.has(x.t)) byClub.set(x.t, []);
      for (const [s, e] of parts) byClub.get(x.t).push({ id: p.id, s, e });
    }
  }
  for (const [t, list] of byClub) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const s = Math.max(a.s, b.s), e = Math.min(a.e, b.e);
        if (a.id !== b.id && s < e) addLink(a.id, b.id, { t, s, e });
      }
    }
  }
})();

const fame = new Map(players.map((p) => [p.id, recognition(p)]));

// Зв'язок словами: клуб (найдовше разом), його герб і спільні роки.
function linkOf(a, b) {
  const list = links.get(a)?.get(b);
  if (!list) return null;
  const best = [...list].sort((x, y) => (y.e - y.s) - (x.e - x.s))[0];
  const tm = team(best.t);
  return { club: T(tm.name, teamEn(best.t, tm) || tm.name), img: tm.img, years: `${best.s}–${best.e === NOW ? '' : best.e}`.replace(/–$/, '–…') };
}
const linked = (a, b) => !!links.get(a)?.has(b);

// Відстані від гравця до всіх (у кроках).
function distances(from, limit = Infinity) {
  const d = new Map([[from, 0]]);
  const queue = [from];
  for (const x of queue) {
    if (d.get(x) >= limit) continue;
    for (const y of links.get(x)?.keys() || []) {
      if (!d.has(y)) {
        d.set(y, d.get(x) + 1);
        queue.push(y);
      }
    }
  }
  return d;
}

// Найкоротший шлях a → b (через найвідоміших, щоб його можна було впізнати): [id…] від a до b.
function shortestPath(a, b) {
  const toB = distances(b);
  if (!toB.has(a)) return null;
  const path = [a];
  let x = a;
  while (x !== b) {
    const need = toB.get(x) - 1;
    const next = [...links.get(x).keys()].filter((y) => toB.get(y) === need).sort((p, q) => (fame.get(q) || 0) - (fame.get(p) || 0))[0];
    path.push(next);
    x = next;
  }
  return path;
}

// Підказка: з якого клубу наступна ланка на найкоротшому шляху від `from` до `to`.
function hintClub(from, to) {
  const path = shortestPath(from, to);
  return path && path.length > 1 ? linkOf(path[0], path[1]) : null;
}

// Рівні: пул кінців ланцюжка і скільки кроків між ними. Кінці видно одразу й треба знати їхні клуби — тому вони
// з пулу на рівень легшого (Геведес, 483-й у рейтингу, для «звичайного» тут — надто маловідомий); складність — у кроках.
const LEVELS = {
  easy: { pool: 'easy', steps: [2] },
  normal: { pool: 'easy', steps: [3] },
  fan: { pool: 'normal', steps: [3, 4] },
};

// Пара кінців: обидва з пулу, між ними рівно потрібна кількість кроків. avoid — id, що вже були в серії.
function makePair(level = 'normal', avoid = new Set()) {
  const cfg = LEVELS[level] || LEVELS.normal;
  const pool = poolFor('all', cfg.pool).filter((p) => links.has(p.id) && !avoid.has(p.id));
  for (let i = 0; i < 400; i++) {
    const a = pool[Math.floor(Math.random() * pool.length)];
    const steps = cfg.steps[Math.floor(Math.random() * cfg.steps.length)];
    const d = distances(a.id, steps);
    const fits = pool.filter((p) => d.get(p.id) === steps);
    if (!fits.length) continue;
    const b = fits[Math.floor(Math.random() * fits.length)];
    return { start: a, finish: b, steps };
  }
  return null;
}

module.exports = { linked, linkOf, distances, shortestPath, hintClub, makePair, LEVELS, links, playerById };
