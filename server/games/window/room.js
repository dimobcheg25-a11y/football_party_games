// Партія «Трансферне вікно» (2–8): спільна схема, аукціон із таємними ставками по лініях, потім сила складів і міні-ліга.
// Лоти — випадкові гравці з пулу (500 найвідоміших: усі епохи або лише з повними даними з 2012), по лініях:
// воротарі → захисники → півзахисники → атака, усередині — по одній позиції (усі ЦЗ, потім усі КЗ…): у лоті лише гравці цієї позиції,
// і вона потрібна всім учасникам однаково — кожен отримує по гравцю, торги є за кожне місце.
// Лот — «торг за право вибору»: гравців на одного більше, ніж учасників (удвох — троє), близької відомості (recognition).
// Фази: bid (кожен, кому хтось із лоту підходить у вільне місце, таємно ставить MIN_BID…max за право обрати першим;
// max = бюджет − PICK_PRICE за кожне інше порожнє місце; пасу немає — не поставив, ставка MIN_BID) → pick (по черзі ставок,
// рівні — пріоритет по колу: перший обирає будь-кого й платить свою ставку, наступні — з тих, що лишились, за PICK_PRICE;
// час вийшов або офлайн — випадковий) → sold (хто кого взяв і за скільки, усі ставки; хто лишився — назад у пул).
// Позиція потрібна лише одному (решта вийшли з кімнати) — торгів немає, він сам обирає одного з трьох схожих за AUTO_PRICE.
// Рівні ставки — пріоритет по колу (у кожному лоті — наступний гравець), його видно до ставки.
// Сила гравців (rating.js) прихована до кінця вікна.
// Кінець: склади з силою, «знахідка» й «переплата» вікна, матчі всіх з усіма (match.js) і таблиця.
// Схема «Міні» — 7 місць (ВР, 2 захисники, 2 півзахисники, 2 нападники/вінгери), місця універсальні в межах лінії.
// «Сила за» (basis): загальний рейтинг або один показник — пікова вартість, голи, асисти, трофеї + нагороди (rating.js basisTable).
const { T } = require('../../core/i18n');
const { BaseRoom } = require('../../core/base-room');
const { publicPlayer } = require('../duel/room');
const { profileOf } = require('../guess/compare');
const { windowPool, posOf, basisTable, poolMode, BASES } = require('./rating');
const { recognition } = require('../path/careers');
const { league, strength, matchPlayer } = require('./match');

const MAX_PLAYERS = 8;
const BUDGET = 100; // млн
const PICK_PRICE = 2; // вибір після першого (з тих, що лишились)
const MIN_BID = PICK_PRICE; // право першого вибору не дешевше за наступні
const MAX_SHOWN = 5; // гравців у лоті — учасників + 1, не більше
const NEAR = 8; // трійку добираємо з NEAR найближчих за відомістю
const PICK_MS = Number(process.env.WINDOW_PICK_MS) || 20000; // на вибір — не встиг, береться випадковий
const AUTO_PRICE = 5; // позиція потрібна лише одному — без торгів, але не подарунок
const AUTO_CHOICE = 3; // і тоді він обирає одного з трьох схожих
const ALLOWED_SECONDS = [10, 15, 20, 0]; // 0 — без таймера: торги закриваються, коли всі поставили, вибір чекає того, хто обирає
const SOLD_MS = Number(process.env.WINDOW_SOLD_MS) || 3500;

// Місця схем. Тип місця → які позиції Transfermarkt на нього годяться.
const FORMATIONS = {
  '433': ['GK', 'CB', 'CB', 'LB', 'RB', 'DM', 'CM', 'CM', 'LW', 'RW', 'ST'],
  '442': ['GK', 'CB', 'CB', 'LB', 'RB', 'CM', 'CM', 'LW', 'RW', 'ST', 'ST'],
  '4231': ['GK', 'CB', 'CB', 'LB', 'RB', 'DM', 'DM', 'AM', 'LW', 'RW', 'ST'],
  '352': ['GK', 'CB', 'CB', 'CB', 'LB', 'RB', 'DM', 'CM', 'CM', 'ST', 'ST'],
  '4312': ['GK', 'CB', 'CB', 'LB', 'RB', 'DM', 'CM', 'CM', 'AM', 'ST', 'ST'],
  mini: ['GK', 'D', 'D', 'M', 'M', 'F', 'F'], // міні-футбол: 6 польових + воротар
};
// Тип місця → які позиції Transfermarkt на нього годяться. Кожна позиція — окремо (лівий і правий захисник, лівий і правий вінгер):
// лот — гравці однієї позиції, і вона потрібна всім однаково.
const SLOT_POS = {
  GK: ['Goalkeeper'], CB: ['Centre-Back'], LB: ['Left-Back'], RB: ['Right-Back'],
  // ЦП — і атакувальні півзахисники: у схемах без місця АП (4-3-3, 4-4-2, 3-5-2) вони інакше не потрапляли б на торги
  DM: ['Defensive Midfield'], CM: ['Central Midfield', 'Attacking Midfield'], AM: ['Attacking Midfield'],
  LW: ['Left Winger', 'Left Midfield'], RW: ['Right Winger', 'Right Midfield'], ST: ['Centre-Forward', 'Second Striker'],
};
// універсальні місця «Міні»: будь-хто зі своєї лінії
SLOT_POS.D = [...SLOT_POS.CB, ...SLOT_POS.LB, ...SLOT_POS.RB];
SLOT_POS.M = [...new Set([...SLOT_POS.DM, ...SLOT_POS.CM, ...SLOT_POS.AM])];
SLOT_POS.F = [...SLOT_POS.LW, ...SLOT_POS.RW, ...SLOT_POS.ST];
const LINES = [['GK'], ['CB', 'LB', 'RB', 'D'], ['DM', 'CM', 'AM', 'M'], ['LW', 'RW', 'ST', 'F']];
const TYPE_ORDER = LINES.flat(); // торги йдуть по позиціях у цьому порядку
const SLOT_NAMES = {
  GK: T('ВР', 'GK'), CB: T('ЦЗ', 'CB'), LB: T('ЛЗ', 'LB'), RB: T('ПЗ', 'RB'), DM: T('ОП', 'DM'), CM: T('ЦП', 'CM'), AM: T('АП', 'AM'),
  LW: T('ЛВ', 'LW'), RW: T('ПВ', 'RW'), ST: T('НАП', 'ST'),
  D: T('ЗАХ', 'DEF'), M: T('ПІВ', 'MID'), F: T('АТ', 'FWD'),
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
    this.lot = null; // { players: [p…], eligible: [[seat]…] — хто може взяти кожного, people — учасники, auto }
    this.pick = null; // { order: [seat] — черга вибору, idx, picks: [{ seat, i, price }], priority }
    this.phase = null; // bid | pick | sold
    this.bids = new Map(); // seat → { amount } — ставка за право обрати першим
    this.lastLot = null; // { items: [{ id, player, winner, price, order }], leftover: [player], bids: { seat: amount }, auto, priority }
    this.news = []; // стрічка BREAKING: останні продажі
    this.used = new Set();
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
      else if (this.phase === 'pick' && this.pick.order[this.pick.idx] === seat) this.startPick();
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
  // ставка — не більше бюджету мінус PICK_PRICE на кожне інше порожнє місце (щоб завжди було чим заплатити за вибір)
  maxBid(seat) { return Math.max(0, this.budgets[seat] - (this.emptyCount(seat) - 1) * PICK_PRICE); }
  // Хто може взяти гравця p: є вільне місце під його позицію
  eligibleFor(p) { return this.presentSeats().filter((s) => this.freeSlots(s).some((i) => fits(p, this.slots[i]))); }

  nextLot() {
    clearTimeout(this.timer);
    this.bids = new Map();
    this.pick = null;
    this.deadline = null;
    // торги — по одній позиції за раз (ВР, ЦЗ, КЗ, ОП…): схема в усіх однакова, тож позиція потрібна всім однаково —
    // кожен учасник отримує по гравцю, і торги є за кожне місце
    const type = TYPE_ORDER.find((t) => this.presentSeats().some((s) => this.freeSlots(s, [t]).length));
    if (!type) return this.finish();
    this.line = LINES.findIndex((l) => l.includes(type));
    const need = this.presentSeats().filter((s) => this.freeSlots(s, [type]).length);
    const candidates = this.pool.filter((p) => !this.used.has(p.id) && fits(p, type));
    if (!candidates.length) return this.fillRest(need, [type]);
    // позиція потрібна лише одному (решта вийшли з кімнати) — без торгів, сам обирає з трьох за AUTO_PRICE
    if (need.length < 2) return this.autoSell(need[0], rand(candidates));
    // гравців на одного більше, ніж учасників (удвох — троє); близької відомості: якір — випадковий,
    // решта — випадкові з NEAR найближчих до нього за recognition
    const count = Math.min(MAX_SHOWN, need.length + 1);
    const anchor = rand(candidates);
    const near = candidates.filter((p) => p.id !== anchor.id)
      .sort((a, b) => Math.abs(this.fame(a) - this.fame(anchor)) - Math.abs(this.fame(b) - this.fame(anchor)))
      .slice(0, Math.max(NEAR, count - 1));
    const players = [anchor];
    while (players.length < count && near.length) players.push(near.splice(Math.floor(Math.random() * near.length), 1)[0]);
    players.sort(() => Math.random() - 0.5); // якір — не завжди перший
    players.forEach((p) => this.used.add(p.id));
    this.lotNo++;
    this.lot = { players, eligible: players.map(() => need), people: need, type, auto: false };
    this.phase = 'bid';
    if (this.options.seconds) {
      const ms = this.options.seconds * 1000;
      this.deadline = Date.now() + ms;
      this.timer = setTimeout(() => this.closeBids(), ms);
    }
    this.changed();
  }

  // Відомість гравця (кеш): за нею підбираємо трійку схожих
  fame(p) {
    this.fameCache ||= new Map();
    if (!this.fameCache.has(p.id)) this.fameCache.set(p.id, recognition(p));
    return this.fameCache.get(p.id);
  }

  // Позиція потрібна лише одному: торгів немає, але він сам обирає одного з AUTO_CHOICE схожих за AUTO_PRICE
  autoSell(seat, p) {
    const type = this.slots[this.freeSlots(seat).find((k) => fits(p, this.slots[k]))];
    this.line = LINES.findIndex((l) => l.includes(type));
    const own = this.pool.filter((x) => x.id !== p.id && !this.used.has(x.id) && fits(x, type))
      .sort((a, b) => Math.abs(this.fame(a) - this.fame(p)) - Math.abs(this.fame(b) - this.fame(p))).slice(0, NEAR);
    const players = [p];
    while (players.length < AUTO_CHOICE && own.length) players.push(own.splice(Math.floor(Math.random() * own.length), 1)[0]);
    players.sort(() => Math.random() - 0.5);
    players.forEach((x) => this.used.add(x.id));
    this.lotNo++;
    this.lot = { players, eligible: players.map(() => [seat]), people: [seat], auto: true };
    this.bids = new Map();
    this.pick = { order: [seat], idx: 0, picks: [], priority: this.priority() };
    this.phase = 'pick';
    this.startPick();
  }

  // Пул вичерпано (дуже рідко): решта місць лінії — найвідоміші з тих, хто лишився, за PICK_PRICE
  fillRest(need, types) {
    for (const seat of need) {
      for (const i of this.freeSlots(seat, types)) {
        const p = windowPool('all', 2000).find((x) => !this.used.has(x.id) && fits(x, this.slots[i]));
        if (!p) continue;
        this.used.add(p.id);
        const price = Math.min(PICK_PRICE, this.budgets[seat]);
        this.squads[seat].push({ slot: i, id: p.id, price });
        this.budgets[seat] -= price;
      }
    }
    this.line++;
    this.nextLot();
  }

  // Таємна ставка за право обрати першим: MIN_BID…max. Пасу немає. Можна змінити, поки торги відкриті.
  bid(seat, { amount } = {}) {
    if (this.status !== 'playing' || this.phase !== 'bid') return { error: T('Зараз торгів немає', 'No lot is open right now') };
    if (!this.lot.people.includes(seat)) return { error: T('Під цих гравців у тебе немає вільного місця', 'You have no free slot for these players') };
    const v = Math.floor(Number(amount));
    if (!Number.isFinite(v) || v < MIN_BID) return { error: T(`Мінімальна ставка — ${MIN_BID} млн`, `The minimum bid is €${MIN_BID}M`) };
    const max = this.maxBid(seat);
    if (v > max) return { error: T(`Можна поставити щонайбільше ${max} млн: решту треба лишити на порожні місця`, `You can bid ${max}M at most: keep the rest for your empty slots`) };
    this.bids.set(seat, { amount: v });
    this.touch();
    this.checkProgress();
    if (this.phase === 'bid') this.changed();
    return { ok: true };
  }

  checkProgress() {
    if (this.phase === 'bid') {
      const waiting = this.lot.people.filter((s) => this.seats[s]?.connected && !this.bids.has(s));
      if (!waiting.length) this.closeBids();
    } else if (this.phase === 'pick') {
      const seat = this.pick.order[this.pick.idx];
      if (!this.seats[seat]?.connected && !this.options.seconds) this.autoPick(); // без таймера офлайн не тримає вибір; з таймером — чекаємо його
    }
  }

  // Пріоритет при рівних ставках: присутні гравці по колу, у кожному лоті починає наступний
  priority() {
    const seats = this.presentSeats();
    const k = seats.length ? (Math.max(1, this.lotNo) - 1) % seats.length : 0;
    return [...seats.slice(k), ...seats.slice(0, k)];
  }

  // Торги закрито: черга вибору — за ставками від найбільшої (рівні — пріоритет лоту). Пасу немає: хто не поставив — MIN_BID.
  closeBids() {
    if (this.phase !== 'bid') return;
    clearTimeout(this.timer);
    for (const s of this.lot.people) if (this.seats[s] && !this.bids.has(s)) this.bids.set(s, { amount: MIN_BID, auto: true });
    const order = this.priority();
    const queue = this.lot.people.filter((s) => this.seats[s])
      .sort((a, b) => this.bids.get(b).amount - this.bids.get(a).amount || order.indexOf(a) - order.indexOf(b));
    this.pick = { order: queue, idx: 0, picks: [], priority: order };
    this.phase = 'pick';
    this.startPick();
  }

  // Що може обрати гравець: ще не забрані, під кого є вільне місце
  pickable(seat) {
    const taken = new Set(this.pick.picks.map((x) => x.i));
    return this.lot.players.map((p, i) => i).filter((i) => !taken.has(i) && this.freeSlots(seat).some((k) => fits(this.lot.players[i], this.slots[k])));
  }

  // Наступний у черзі обирає; кому нема з чого (або вийшов) — пропускаємо
  startPick() {
    clearTimeout(this.timer);
    const pk = this.pick;
    while (pk.idx < pk.order.length && (!this.seats[pk.order[pk.idx]] || !this.pickable(pk.order[pk.idx]).length)) pk.idx++;
    if (pk.idx >= pk.order.length) return this.finishLot();
    this.deadline = null;
    if (this.options.seconds) {
      this.deadline = Date.now() + PICK_MS;
      this.timer = setTimeout(() => this.autoPick(), PICK_MS);
    }
    if (!this.seats[pk.order[pk.idx]].connected && !this.options.seconds) return this.autoPick();
    this.changed();
  }

  // Ціна вибору: перший — своя ставка, далі — PICK_PRICE
  pickPrice(seat) {
    if (this.lot.auto) return Math.min(AUTO_PRICE, this.maxBid(seat)); // без торгів — фіксована ціна
    return this.pick.picks.length ? PICK_PRICE : this.bids.get(seat).amount;
  }

  choose(seat, { i } = {}) {
    if (this.status !== 'playing' || this.phase !== 'pick') return { error: T('Зараз не час обирати', 'It’s not time to pick') };
    if (seat !== this.pick.order[this.pick.idx]) return { error: T('Зараз обирає інший гравець', 'Someone else is picking now') };
    const k = Number(i);
    if (!this.pickable(seat).includes(k)) return { error: T('Цього гравця взяти не можна', 'You can’t take this player') };
    const p = this.lot.players[k];
    const price = this.pickPrice(seat);
    const slot = this.freeSlots(seat).find((x) => fits(p, this.slots[x]));
    this.squads[seat].push({ slot, id: p.id, price });
    this.budgets[seat] -= price;
    this.pick.picks.push({ seat, i: k, price });
    this.news.unshift({ id: p.id, winner: seat, price, auto: false });
    this.news = this.news.slice(0, 6);
    this.pick.idx++;
    this.touch();
    this.startPick();
    return { ok: true };
  }

  // Час вийшов або гравець офлайн — береться випадковий з тих, кого він може взяти
  autoPick() {
    if (this.phase !== 'pick') return;
    const seat = this.pick.order[this.pick.idx];
    const options = this.pickable(seat);
    if (!options.length) { this.pick.idx++; return this.startPick(); }
    this.choose(seat, { i: rand(options) });
  }

  // Лот завершено: хто кого забрав, за скільки, усі ставки; хто лишився — назад у пул
  finishLot() {
    clearTimeout(this.timer);
    const { players } = this.lot;
    const taken = new Set(this.pick.picks.map((x) => x.i));
    const items = this.pick.picks.map((x, n) => ({ id: players[x.i].id, player: this.lotPlayer(players[x.i]), winner: x.seat, price: x.price, order: n }));
    const leftover = players.filter((p, i) => !taken.has(i));
    leftover.forEach((p) => this.used.delete(p.id));
    this.lastLot = {
      items, auto: this.lot.auto, priority: this.pick.priority,
      leftover: leftover.map((p) => this.lotPlayer(p)),
      bids: Object.fromEntries([...this.bids].map(([s, b]) => [s, b.amount])),
    };
    this.pick = null;
    this.phase = 'sold';
    this.deadline = Date.now() + SOLD_MS;
    this.timer = setTimeout(() => this.nextLot(), SOLD_MS);
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
    const open = this.lot && (this.phase === 'bid' || this.phase === 'pick');
    const lot = open ? {
      no: this.lotNo,
      players: this.lot.players.map((p) => this.lotPlayer(p)),
      eligible: this.lot.eligible, // хто може взяти кожного
      people: this.lot.people, // учасники торгів
      // хто виграє при рівних ставках: перший у черзі пріоритету серед учасників
      tieWinner: this.priority().find((s) => this.lot.people.includes(s)),
      // місце, на яке піде кожен гравець
      types: this.lot.players.map((p) => [...new Set(this.slots.filter((t) => fits(p, t)))].map((t) => SLOT_NAMES[t])),
    } : null;
    // вибір: черга (за ставками), хто зараз обирає, що вже забрали, усі ставки (після торгів — відкриті)
    const pick = this.phase === 'pick' ? {
      order: this.pick.order, picker: this.pick.order[this.pick.idx], picks: this.pick.picks, auto: this.lot.auto,
      price: this.pickPrice(this.pick.order[this.pick.idx]), options: this.pickable(this.pick.order[this.pick.idx]),
      bids: Object.fromEntries([...this.bids].map(([s, b]) => [s, b.amount])),
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
      rules: { budget: BUDGET, min: MIN_BID, auto: AUTO_PRICE, pick: PICK_PRICE },
      lot,
      pick,
      bidders: [...this.bids.keys()], // хто вже поставив (суми — таємні)
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
