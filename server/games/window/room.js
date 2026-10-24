// Партія «Трансферне вікно» (2–8): спільна схема, аукціон із таємними ставками по лініях, потім сила складів і міні-ліга.
// Лоти — випадкові гравці з пулу (500 найвідоміших: усі епохи або лише з повними даними з 2012), по лініях:
// воротарі → захисники → півзахисники → атака; у лоті — гравець на позицію, яка ще комусь потрібна.
// Фази лоту: bid (кожен, кому гравець підходить у вільне місце, таємно ставить 1…max млн або пасує; max = бюджет − 1 млн за кожне
// інше порожнє місце) → sold (усі ставки відкрито: виграє найбільша, при рівних — раніша; без ставок — «не продано»).
// Місце в лінії потрібне лише одному — лоти йдуть йому автоматично за 1 млн. Сила гравців (rating.js) прихована до кінця вікна.
// Кінець: склади з силою, «знахідка» й «переплата» вікна, матчі всіх з усіма (match.js) і таблиця.
// Схема «Міні» — 7 місць (ВР, 2 захисники, 2 півзахисники, 2 нападники/вінгери), місця універсальні в межах лінії.
// «Сила за» (basis): загальний рейтинг або один показник — пікова вартість, голи, асисти, трофеї + нагороди (rating.js basisTable).
const { T } = require('../../core/i18n');
const { BaseRoom } = require('../../core/base-room');
const { publicPlayer } = require('../duel/room');
const { profileOf } = require('../guess/compare');
const { windowPool, posOf, basisTable, poolMode, BASES } = require('./rating');
const { league, strength, matchPlayer } = require('./match');

const MAX_PLAYERS = 8;
const BUDGET = 100; // млн
const MIN_BID = 1;
const ALLOWED_SECONDS = [10, 15, 20, 0]; // 0 — без таймера: лот закривається, коли всі поставили або пасували
const SOLD_MS = Number(process.env.WINDOW_SOLD_MS) || 3500;
const AUTO_MS = Number(process.env.WINDOW_AUTO_MS) || 1600;
const UNSOLD_LIMIT = 4; // стільки лотів поспіль без ставок — далі лоти лінії розходяться автоматично тим, кому бракує

// Місця схем. Тип місця → які позиції Transfermarkt на нього годяться.
const FORMATIONS = {
  '433': ['GK', 'CB', 'CB', 'FB', 'FB', 'DM', 'CM', 'CM', 'W', 'W', 'ST'],
  '442': ['GK', 'CB', 'CB', 'FB', 'FB', 'CM', 'CM', 'W', 'W', 'ST', 'ST'],
  '4231': ['GK', 'CB', 'CB', 'FB', 'FB', 'DM', 'DM', 'AM', 'W', 'W', 'ST'],
  '352': ['GK', 'CB', 'CB', 'CB', 'FB', 'FB', 'DM', 'CM', 'CM', 'ST', 'ST'],
  '4312': ['GK', 'CB', 'CB', 'FB', 'FB', 'DM', 'CM', 'CM', 'AM', 'ST', 'ST'],
  mini: ['GK', 'D', 'D', 'M', 'M', 'F', 'F'], // міні-футбол: 6 польових + воротар
};
const SLOT_POS = {
  GK: ['Goalkeeper'], CB: ['Centre-Back'], FB: ['Left-Back', 'Right-Back'],
  DM: ['Defensive Midfield'], CM: ['Central Midfield'], AM: ['Attacking Midfield'],
  W: ['Left Winger', 'Right Winger', 'Left Midfield', 'Right Midfield'], ST: ['Centre-Forward', 'Second Striker'],
};
// універсальні місця «Міні»: будь-хто зі своєї лінії
SLOT_POS.D = [...SLOT_POS.CB, ...SLOT_POS.FB];
SLOT_POS.M = [...SLOT_POS.DM, ...SLOT_POS.CM, ...SLOT_POS.AM];
SLOT_POS.F = [...SLOT_POS.W, ...SLOT_POS.ST];
const LINES = [['GK'], ['CB', 'FB', 'D'], ['DM', 'CM', 'AM', 'M'], ['W', 'ST', 'F']];
const SLOT_NAMES = {
  GK: T('ВР', 'GK'), CB: T('ЦЗ', 'CB'), FB: T('КЗ', 'FB'), DM: T('ОП', 'DM'), CM: T('ЦП', 'CM'), AM: T('АП', 'AM'), W: T('ВІН', 'W'), ST: T('НАП', 'ST'),
  D: T('ЗАХ', 'DEF'), M: T('ПЗ', 'MID'), F: T('АТ', 'FWD'),
};
const LINE_NAMES = [T('Воротарі', 'Goalkeepers'), T('Захисники', 'Defenders'), T('Півзахисники', 'Midfielders'), T('Атака', 'Attack')];

const rand = (list) => list[Math.floor(Math.random() * list.length)];
const fits = (p, type) => SLOT_POS[type].includes(posOf(p));

class WindowRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, MAX_PLAYERS);
    this.options = {
      formation: FORMATIONS[opts.formation] ? opts.formation : '433',
      mode: opts.mode === 'modern' ? 'modern' : 'all',
      seconds: ALLOWED_SECONDS.includes(Number(opts.seconds)) ? Number(opts.seconds) : 15,
      basis: BASES[opts.basis] ? opts.basis : 'overall',
    };
    this.status = 'waiting'; // waiting | playing | finished
    this.reset();
  }

  reset() {
    clearTimeout(this.timer);
    this.squads = Array(this.capacity).fill(null).map(() => []); // [{ slot (індекс місця схеми), id, price }]
    this.budgets = Array(this.capacity).fill(BUDGET);
    this.line = 0;
    this.lotNo = 0;
    this.lot = null; // { p, eligible: [seat], auto }
    this.phase = null; // bid | sold
    this.bids = new Map(); // seat → { amount (0 — пас), t }
    this.lastLot = null; // { id, winner, price, bids: { seat: amount }, unsold, auto }
    this.news = []; // стрічка BREAKING: останні продажі
    this.used = new Set();
    this.unsoldRun = 0;
    this.deadline = null;
    this.result = null;
  }

  get slots() { return FORMATIONS[this.options.formation]; }

  host() {
    const present = this.presentSeats();
    return present.find((i) => this.seats[i].connected) ?? present[0] ?? -1;
  }
  online() { return this.presentSeats().filter((i) => this.seats[i].connected); }

  // ── вхід/вихід: посеред вікна нових не беремо — склад не встигне зібратись
  join(token, name) {
    let seat = this.rejoin(token, name);
    if (seat === -1) {
      if (this.status === 'playing') return { error: T('Трансферне вікно вже відкрите — дочекайся наступної гри', 'The window is already open — wait for the next game') };
      seat = this.takeSeat(token, name);
      if (seat === -1) return { error: T('Кімната вже заповнена — створи свою гру', 'The room is full — start your own game') };
    }
    this.touch();
    this.changed();
    return { seat };
  }

  leave(seat) {
    this.seats[seat] = null;
    this.squads[seat] = [];
    this.budgets[seat] = BUDGET;
    this.bids.delete(seat);
    this.touch();
    if (this.status === 'playing') {
      if (this.presentSeats().length < 2) this.finish();
      else this.checkProgress();
    }
    this.changed();
  }

  setConnected(token, connected) {
    const seat = this.seatOf(token);
    if (seat === -1) return;
    Object.assign(this.seats[seat], { connected, offlineSince: connected ? null : Date.now() });
    this.touch();
    if (this.status === 'playing') this.checkProgress();
    this.changed();
  }

  // ── вікно
  start(seat) {
    if (this.status === 'playing') return { error: T('Гра вже йде', 'The game is already on') };
    if (seat !== this.host()) return { error: T('Почати гру може той, хто її створив', 'Only the room creator can start the game') };
    if (this.presentSeats().length < 2) return { error: T('Потрібно щонайменше 2 гравці', 'At least 2 players needed') };
    this.reset();
    this.pool = windowPool(poolMode(this.options.mode, this.options.basis));
    this.power = basisTable(this.options.mode, this.options.basis);
    this.status = 'playing';
    this.nextLot();
    return { ok: true };
  }

  // Хост міняє схему в лобі (домовились у чаті) — до початку вікна.
  setFormation(seat, { formation } = {}) {
    if (this.status === 'playing') return { error: T('Схему вже не змінити — вікно відкрите', 'The formation is locked — the window is open') };
    if (seat !== this.host()) return { error: T('Схему обирає господар кімнати', 'The host picks the formation') };
    if (!FORMATIONS[formation]) return { error: T('Невідома схема', 'Unknown formation') };
    this.options.formation = formation;
    this.changed();
    return { ok: true };
  }

  // Вільні місця гравця заданих типів (індекси місць схеми)
  freeSlots(seat, types) {
    const taken = new Set(this.squads[seat].map((x) => x.slot));
    return this.slots.map((t, i) => i).filter((i) => !taken.has(i) && (!types || types.includes(this.slots[i])));
  }
  emptyCount(seat) { return this.slots.length - this.squads[seat].length; }
  maxBid(seat) { return Math.max(0, this.budgets[seat] - (this.emptyCount(seat) - 1) * MIN_BID); }
  // Хто може взяти гравця p: є вільне місце під його позицію
  eligibleFor(p) { return this.presentSeats().filter((s) => this.freeSlots(s).some((i) => fits(p, this.slots[i]))); }

  nextLot() {
    clearTimeout(this.timer);
    this.bids = new Map();
    this.deadline = null;
    // лінія, у якій комусь ще бракує гравців
    while (this.line < LINES.length && !this.presentSeats().some((s) => this.freeSlots(s, LINES[this.line]).length)) {
      this.line++;
      this.unsoldRun = 0;
    }
    if (this.line >= LINES.length) return this.finish();
    const types = LINES[this.line];
    const need = this.presentSeats().filter((s) => this.freeSlots(s, types).length);
    const neededTypes = [...new Set(need.flatMap((s) => this.freeSlots(s, types).map((i) => this.slots[i])))];
    const candidates = this.pool.filter((p) => !this.used.has(p.id) && neededTypes.some((t) => fits(p, t)));
    if (!candidates.length) return this.fillRest(need, types);
    // місце потрібне лише одному або лоти лінії довго не продаються — гравець іде автоматично за 1 млн
    if (need.length === 1 || this.unsoldRun >= UNSOLD_LIMIT) {
      const seat = need.length === 1 ? need[0] : rand(need);
      const own = candidates.filter((p) => this.freeSlots(seat, types).some((i) => fits(p, this.slots[i])));
      return this.autoSell(seat, rand(own.length ? own : candidates));
    }
    const p = rand(candidates);
    this.used.add(p.id);
    this.lotNo++;
    this.lot = { p, eligible: this.eligibleFor(p), auto: false };
    this.phase = 'bid';
    if (this.options.seconds) {
      const ms = this.options.seconds * 1000;
      this.deadline = Date.now() + ms;
      this.timer = setTimeout(() => this.close(), ms);
    }
    this.changed();
  }

  autoSell(seat, p) {
    this.used.add(p.id);
    this.lotNo++;
    this.lot = { p, eligible: [seat], auto: true };
    this.bids = new Map([[seat, { amount: MIN_BID, t: Date.now() }]]);
    this.close();
  }

  // Пул вичерпано (дуже рідко): решта місць лінії — найвідоміші з тих, хто лишився, за 1 млн
  fillRest(need, types) {
    for (const seat of need) {
      for (const i of this.freeSlots(seat, types)) {
        const p = windowPool('all', 2000).find((x) => !this.used.has(x.id) && fits(x, this.slots[i]));
        if (!p) continue;
        this.used.add(p.id);
        this.squads[seat].push({ slot: i, id: p.id, price: MIN_BID });
        this.budgets[seat] -= MIN_BID;
      }
    }
    this.line++;
    this.nextLot();
  }

  // Таємна ставка: amount 0 — пас; можна змінити, поки лот відкритий
  bid(seat, { amount } = {}) {
    if (this.status !== 'playing' || this.phase !== 'bid') return { error: T('Зараз торгів немає', 'No lot is open right now') };
    if (!this.lot.eligible.includes(seat)) return { error: T('Під цього гравця в тебе немає вільного місця', 'You have no free slot for this player') };
    const v = Math.floor(Number(amount));
    if (!Number.isFinite(v) || v < 0) return { error: T('Введи суму в мільйонах', 'Enter an amount in millions') };
    const max = this.maxBid(seat);
    if (v > max) return { error: T(`Можна щонайбільше ${max} млн — решта на порожні місця`, `${max}M at most — the rest is for empty slots`) };
    this.bids.set(seat, { amount: v, t: Date.now() });
    this.touch();
    this.checkProgress();
    if (this.phase === 'bid') this.changed();
    return { ok: true };
  }

  pass(seat) { return this.bid(seat, { amount: 0 }); }

  checkProgress() {
    if (this.phase !== 'bid') return;
    const waiting = this.lot.eligible.filter((s) => this.seats[s]?.connected && !this.bids.has(s));
    if (!waiting.length) this.close();
  }

  // Лот закрито: найбільша ставка (рівні — раніша) купує; усі ставки відкриваються
  close() {
    if (this.phase !== 'bid' && !this.lot?.auto) return;
    clearTimeout(this.timer);
    const { p, auto } = this.lot;
    const offers = [...this.bids].filter(([s, b]) => b.amount > 0 && this.seats[s]).sort((a, b) => b[1].amount - a[1].amount || a[1].t - b[1].t);
    const all = Object.fromEntries([...this.bids].map(([s, b]) => [s, b.amount]));
    if (offers.length) {
      const [seat, b] = offers[0];
      const slot = this.freeSlots(seat).find((i) => fits(p, this.slots[i]));
      this.squads[seat].push({ slot, id: p.id, price: b.amount });
      this.budgets[seat] -= b.amount;
      this.lastLot = { id: p.id, winner: seat, price: b.amount, bids: all, auto };
      this.news.unshift({ id: p.id, winner: seat, price: b.amount, auto });
      this.news = this.news.slice(0, 6);
      this.unsoldRun = 0;
    } else {
      this.lastLot = { id: p.id, winner: -1, price: 0, bids: all, unsold: true };
      this.unsoldRun++;
    }
    this.phase = 'sold';
    this.lastLot.player = this.lotPlayer(p);
    const ms = auto ? AUTO_MS : SOLD_MS;
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this.nextLot(), ms);
    this.changed();
  }

  // ── кінець вікна: сила, «знахідка» і «переплата», матчі всіх з усіма
  finish() {
    clearTimeout(this.timer);
    this.status = 'finished';
    this.phase = null;
    this.deadline = null;
    this.lot = null;
    const seats = this.presentSeats().filter((s) => this.squads[s].length);
    const byId = new Map(this.pool?.map((p) => [p.id, p]) || []);
    const all = require('../../data').players;
    const find = (id) => byId.get(id) || all.find((p) => p.id === id);
    const squads = seats.map((s) => this.squads[s].map((x) => find(x.id)));
    const rate = (p) => this.power.get(p.id)?.rating;
    const teams = seats.map((s, k) => {
      const list = this.squads[s].slice().sort((a, b) => a.slot - b.slot).map((x) => {
        const p = find(x.id);
        const pw = this.power.get(p.id) || { rating: 60, value: null };
        return { slot: x.slot, type: this.slots[x.slot], price: x.price, rating: pw.rating, value: pw.value, player: this.lotPlayer(p) };
      });
      const st = strength(squads[k].map((p) => matchPlayer(p, rate)));
      return { seat: s, players: list, spent: BUDGET - this.budgets[s], strength: { total: +st.total.toFixed(1), def: +st.def.toFixed(1), mid: +st.mid.toFixed(1), att: +st.att.toFixed(1) } };
    });
    // знахідка/переплата: відхилення сили від очікуваної за ціну (пряма через усі продажі)
    const sold = teams.flatMap((t) => t.players.map((x) => ({ seat: t.seat, ...x })));
    let bargain = null, overpay = null;
    if (sold.length >= 3) {
      const n = sold.length;
      const mx = sold.reduce((s, x) => s + x.price, 0) / n, my = sold.reduce((s, x) => s + x.rating, 0) / n;
      const sxx = sold.reduce((s, x) => s + (x.price - mx) ** 2, 0);
      const k = sxx ? sold.reduce((s, x) => s + (x.price - mx) * (x.rating - my), 0) / sxx : 0;
      const res = sold.map((x) => ({ x, d: x.rating - (my + k * (x.price - mx)) })).sort((a, b) => b.d - a.d);
      const pick = ({ x }) => ({ seat: x.seat, id: x.player.id, price: x.price, rating: x.rating });
      bargain = pick(res[0]);
      overpay = pick(res[res.length - 1]);
    }
    const seed = Math.floor(Math.random() * 1e9);
    const lg = seats.length >= 2 ? league(squads, seed, rate) : { matches: [], table: [] };
    this.result = {
      basis: this.options.basis, teams, bargain, overpay,
      matches: lg.matches.map((m) => ({ a: seats[m.a], b: seats[m.b], score: m.score, strength: m.strength, events: m.events, stats: m.stats })),
      table: lg.table.map((r) => ({ ...r, seat: seats[r.i] })),
    };
    this.changed();
  }

  lotPlayer(p) {
    const pr = profileOf(p);
    return {
      ...publicPlayer(p),
      pos: pr?.position ? T(pr.position.label, pr.position.en) : null,
      club: pr?.last ? { name: T(pr.last.name, pr.last.nameEn || pr.last.name), img: pr.last.img || null } : null,
    };
  }

  publicState() {
    const lot = this.lot && this.phase === 'bid' ? {
      no: this.lotNo, player: this.lotPlayer(this.lot.p), eligible: this.lot.eligible,
      // місце, на яке піде гравець у кожного, хто може його взяти
      types: [...new Set(this.slots.filter((t) => fits(this.lot.p, t)))].map((t) => SLOT_NAMES[t]),
    } : null;
    const state = {
      code: this.code,
      minPlayers: 2,
      options: this.options,
      capacity: this.capacity,
      seats: this.publicSeats(),
      host: this.host(),
      status: this.status,
      phase: this.phase,
      line: this.line,
      lines: LINE_NAMES,
      lotNo: this.lotNo,
      lotsTotal: this.slots.length * this.presentSeats().length,
      slots: this.slots,
      slotNames: SLOT_NAMES,
      rules: { budget: BUDGET, min: MIN_BID },
      lot,
      bidders: [...this.bids.keys()], // хто вже поставив або пасував (суми — таємні)
      lastLot: this.phase === 'sold' ? this.lastLot : null,
      squads: this.squads.map((list) => list.map((x) => ({ slot: x.slot, id: x.id, price: x.price, ...this.squadInfo(x.id) }))),
      budgets: this.budgets,
      maxBids: this.budgets.map((_, s) => (this.seats[s] ? this.maxBid(s) : 0)),
      news: this.news.map((n) => ({ ...n, ...this.squadInfo(n.id) })),
      deadline: this.deadline,
      serverNow: Date.now(),
      result: this.status === 'finished' ? this.result : null,
    };
    return state;
  }

  // Імена й фото куплених — для поля й стрічки (кешуються)
  squadInfo(id) {
    this.infoCache ||= new Map();
    if (!this.infoCache.has(id)) {
      const p = (this.pool || []).find((x) => x.id === id) || require('../../data').players.find((x) => x.id === id);
      this.infoCache.set(id, p ? { name: p.name, uk: p.uk, photo: p.photo || null } : {});
    }
    return this.infoCache.get(id);
  }

  // Свою ставку бачить лише сам гравець
  privateState(seat) {
    return { myBid: this.bids.get(seat)?.amount ?? null };
  }
}

module.exports = { WindowRoom, FORMATIONS, SLOT_POS, LINES, BUDGET, MIN_BID, ALLOWED_SECONDS, fits };
