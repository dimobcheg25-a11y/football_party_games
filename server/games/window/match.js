// «Трансферне вікно»: умовний матч двох складів і міні-ліга «усі з усіма».
// Рахунок — від сили ліній (атака проти оборони суперника, середина дає більше моментів), 6 відрізків по 15 хв:
// вилучення знижує шанси команди до кінця матчу. Хто забив, асистував, отримав картку — пропорційно реальній частоті гравця
// (голи за матч з кар'єри, асисти й картки на 90 хв з 2012; немає даних — типове для позиції). Випадковість — з seed, матч відтворюється.

const { metricsOf, ratingOf } = require('./rating');

// Типові частоти, якщо даних немає: [голів за матч, асистів на 90, жовтих на 90, червоних на 90]
const DEFAULTS = {
  GK: [0, 0.005, 0.05, 0.004], CB: [0.05, 0.03, 0.2, 0.012], FB: [0.04, 0.12, 0.18, 0.008], DM: [0.05, 0.08, 0.24, 0.01],
  CM: [0.1, 0.15, 0.18, 0.006], AM: [0.22, 0.22, 0.12, 0.004], FW: [0.45, 0.18, 0.1, 0.004],
};
const LINE = { GK: 'def', CB: 'def', FB: 'def', DM: 'mid', CM: 'mid', AM: 'mid', FW: 'att' };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const poisson = (rand, l) => { let k = 0, p = Math.exp(-l), s = p; const u = rand(); while (u > s && k < 20) { k++; p *= l / k; s += p; } return k; };
const pick = (rand, list, weight) => {
  const total = list.reduce((s, x) => s + weight(x), 0);
  let u = rand() * total;
  for (const x of list) { u -= weight(x); if (u <= 0) return x; }
  return list[list.length - 1];
};

// Гравець для матчу: сила, лінія і частоти. rate(p) → сила 40…99 за режимом гри (типово — загальний рейтинг)
function matchPlayer(p, rate) {
  const base = ratingOf(p) || { rating: 60, group: 'CM' };
  const r = { ...base, rating: rate ? rate(p) ?? base.rating : base.rating };
  const m = metricsOf(p);
  const d = DEFAULTS[r.group];
  return {
    id: p.id, rating: r.rating, group: r.group, line: LINE[r.group],
    goals: m.goals ?? d[0], assists: m.assists ?? d[1], yellows: m.yellows ?? d[2], reds: m.reds ?? d[3],
  };
}

const avg = (list) => (list.length ? list.reduce((s, x) => s + x.rating, 0) / list.length : 60);
// Сила команди: середня і по лініях (воротар рахується в обороні з подвійною вагою)
function strength(squad) {
  const def = squad.filter((x) => x.line === 'def');
  const gk = squad.filter((x) => x.group === 'GK');
  return {
    total: avg(squad),
    def: (avg(def) * def.length + avg(gk) * gk.length) / (def.length + gk.length || 1),
    mid: avg(squad.filter((x) => x.line === 'mid')),
    att: avg(squad.filter((x) => x.line === 'att' || x.group === 'AM')),
  };
}

const BASE_GOALS = 1.5; // середня кількість голів команди за матч при рівних силах
const SLOTS = 6; // відрізків по 15 хв
const RED_SHARE = 0.3;
const CAREFUL = 0.3; // частка звичайного шансу на картку, коли жовта вже є // у частоті червоних з даних уже є другі жовті — їх симуляція дає сама

// squadA/squadB — масиви гравців бази (p); → протокол матчу
function simulate(squadA, squadB, seed, rate) {
  const rand = rng(seed);
  const teams = [squadA.map((p) => matchPlayer(p, rate)), squadB.map((p) => matchPlayer(p, rate))];
  const st = teams.map(strength);
  const events = [];
  const sent = [new Set(), new Set()];
  const booked = [new Set(), new Set()];
  const goals = [0, 0];
  // очікувані голи за матч: атака проти оборони, середина — проти середини
  const lambda = (i) => {
    const me = st[i], op = st[1 - i];
    return BASE_GOALS * Math.exp((me.att - op.def) / 14 + (me.mid - op.mid) / 18);
  };
  for (let slot = 0; slot < SLOTS; slot++) {
    const from = slot * 15 + 1;
    const minute = () => from + Math.floor(rand() * 15);
    for (const i of [0, 1]) {
      const onPitch = teams[i].filter((x) => !sent[i].has(x.id));
      // картки: імовірність за 15 хв = частота на 90 / 6
      for (const x of onPitch) {
        if (rand() < (x.reds * RED_SHARE) / SLOTS) { sent[i].add(x.id); events.push({ min: minute(), team: i, type: 'red', player: x.id }); continue; }
        // з жовтою грають обережніше — друга вдвічі-втричі рідша
        if (rand() < (x.yellows * (booked[i].has(x.id) ? CAREFUL : 1)) / SLOTS) {
          if (booked[i].has(x.id)) { sent[i].add(x.id); events.push({ min: minute(), team: i, type: 'red', player: x.id, second: true }); }
          else { booked[i].add(x.id); events.push({ min: minute(), team: i, type: 'yellow', player: x.id }); }
        }
      }
    }
    for (const i of [0, 1]) {
      // кожен вилучений — мінус 18 % моментів своїй команді й плюс 12 % суперникові
      const l = (lambda(i) / SLOTS) * Math.pow(0.82, sent[i].size) * Math.pow(1.12, sent[1 - i].size);
      const n = poisson(rand, l);
      for (let k = 0; k < n; k++) {
        const onPitch = teams[i].filter((x) => !sent[i].has(x.id));
        const scorer = pick(rand, onPitch, (x) => x.goals + 0.01);
        const helpers = onPitch.filter((x) => x.id !== scorer.id);
        const assist = rand() < 0.75 ? pick(rand, helpers, (x) => x.assists + 0.01) : null; // чверть голів — без передачі
        goals[i]++;
        events.push({ min: minute(), team: i, type: 'goal', player: scorer.id, assist: assist?.id || null });
      }
    }
  }
  events.sort((a, b) => a.min - b.min);
  // статистика матчу від тих самих сил
  const possA = Math.round(Math.min(68, Math.max(32, 50 + (st[0].mid - st[1].mid) * 1.2 + (rand() - 0.5) * 6)));
  const shots = [0, 1].map((i) => goals[i] + poisson(rand, lambda(i) * 6));
  const onTarget = [0, 1].map((i) => goals[i] + Math.round((shots[i] - goals[i]) * (0.25 + rand() * 0.15)));
  const corners = [0, 1].map((i) => poisson(rand, 3 + lambda(i) * 1.5));
  const count = (i, type) => events.filter((e) => e.team === i && e.type === type).length;
  return {
    score: goals,
    strength: st.map((s) => ({ total: +s.total.toFixed(1), def: +s.def.toFixed(1), mid: +s.mid.toFixed(1), att: +s.att.toFixed(1) })),
    events,
    stats: {
      possession: [possA, 100 - possA], shots, onTarget, corners,
      yellow: [count(0, 'yellow'), count(1, 'yellow')], red: [count(0, 'red'), count(1, 'red')],
    },
  };
}

// Міні-ліга: кожен з кожним один матч; таблиця — очки, різниця, забиті, середня сила складу
function league(squads, seed, rate) {
  const n = squads.length;
  const matches = [];
  const rows = squads.map((_, i) => ({ i, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }));
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const m = simulate(squads[a], squads[b], seed * 31 + a * 7 + b, rate);
      matches.push({ a, b, ...m });
      const [ga, gb] = m.score;
      for (const [i, f, ag] of [[a, ga, gb], [b, gb, ga]]) {
        const r = rows[i];
        r.played++; r.gf += f; r.ga += ag;
        if (f > ag) { r.w++; r.pts += 3; } else if (f === ag) { r.d++; r.pts += 1; } else r.l++;
      }
    }
  }
  const power = squads.map((s) => strength(s.map((p) => matchPlayer(p, rate))).total);
  const table = rows.sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || power[y.i] - power[x.i]);
  return { matches, table };
}

module.exports = { simulate, league, strength, matchPlayer };
