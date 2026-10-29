// Партія «All in» (як Wits & Wagers): питання з числовою відповіддю про футболіста, оцінки гравців стають на табло-сукно,
// і всі ставлять фішки на ту оцінку, яка найближча до правди, але не більша за неї.
// Кімната (2–8): фази guess (кожен пише число, приховано) → bet (табло: оцінки за зростанням + «менше за всіх» ×6, коефіцієнти
// від ×2 у центрі до ×5 по краях; у кожного 2 безкоштовні маркери по FREE фішок, до них можна докласти свої; ставки видно наживо;
// «Готово» — ставки зафіксовано; чужих ставок до відповіді не видно — можна блефувати) → reveal (виграшна клітинка платить (маркер + докладене) × коефіцієнт, програні докладені фішки згорають;
// автор виграшної оцінки +AUTHOR_BONUS). Останній раунд — виграші ×2. Банк на старті START_BANK; без фішок не вибуваєш — маркери безкоштовні.
// Соло: оцінка + впевненість (вузька / середня / широка «вилка» — ×5 / ×3 / ×2) + скільки докласти до маркера; одразу відповідь.
const { T } = require('../../core/i18n');
const { BaseRoom } = require('../../core/base-room');
const { questionsFor, candidates, range, rangeText, DIFFICULTIES, GROUPS } = require('./questions');
const { publicPlayer } = require('../duel/room');

const MAX_PLAYERS = 8;
const START_BANK = 100;
const FREE = 10; // безкоштовний маркер
const AUTHOR_BONUS = 20;
const LOW_ODDS = 6; // «менше за всіх»
const SOLO_ODDS = [5, 3, 2]; // вузька, середня, широка вилка
const ALLOWED_ROUNDS = [5, 7, 10];
const ALLOWED_SECONDS = [0, 20, 30, 45]; // час на оцінку; 0 — без таймерів
const BET_MS = Number(process.env.ALLIN_BET_MS) || 25000;
const REVEAL_MS = Number(process.env.ALLIN_REVEAL_MS) || 12000;

const rand = (list) => list[Math.floor(Math.random() * list.length)];

// Коефіцієнт клітинки з оцінкою i з n: непарна кількість — центр ×2, далі ×3, ×4, ×5; парна — дві середні ×3.
function oddsOf(i, n) {
  const d = n % 2 ? Math.abs(i - (n - 1) / 2) + 2 : (i < n / 2 ? n / 2 - 1 - i : i - n / 2) + 3;
  return Math.min(5, d);
}

class AllinRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, opts.solo ? 1 : MAX_PLAYERS);
    this.solo = !!opts.solo;
    const groups = (Array.isArray(opts.groups) ? opts.groups : []).filter((g) => GROUPS[g]);
    this.options = {
      groups: groups.length ? [...new Set(groups)] : Object.keys(GROUPS),
      difficulty: DIFFICULTIES[opts.difficulty] ? opts.difficulty : 'normal',
      rounds: ALLOWED_ROUNDS.includes(Number(opts.rounds)) ? Number(opts.rounds) : this.solo ? 10 : 7,
      seconds: ALLOWED_SECONDS.includes(Number(opts.seconds)) ? Number(opts.seconds) : 30,
    };
    this.status = 'waiting'; // waiting | playing | finished
    this.banks = Array(this.capacity).fill(START_BANK);
    this.history = [];
    this.round = 0;
    this.resetRound();
  }

  resetRound() {
    clearTimeout(this.timer);
    this.phase = null; // guess | bet | reveal
    this.question = null; // { q, p, value }
    this.guesses = new Map(); // seat → число
    this.slots = []; // [{ value | null, odds, authors: [seat], names: [ім'я] }], 0 — «менше за всіх»
    this.bets = new Map(); // seat → [{ slot, extra }, { slot, extra }]; slot -1 — маркер не поставлено
    this.ready = new Set();
    this.win = -1;
    this.results = {}; // seat → { spent, win, bonus, net, … }
    this.nextVotes = new Set();
    this.deadline = null;
  }

  get lastRound() { return this.round >= this.options.rounds; }
  get mult() { return this.lastRound ? 2 : 1; }

  host() {
    const present = this.presentSeats();
    return present.find((i) => this.seats[i].connected) ?? present[0] ?? -1;
  }
  online() { return this.presentSeats().filter((i) => this.seats[i].connected); }

  // ── вхід/вихід
  join(token, name) {
    let seat = this.rejoin(token, name);
    if (seat === -1) {
      seat = this.takeSeat(token, name);
      if (seat === -1) return { error: T('Кімната вже заповнена — створи свою гру', 'The room is full — start your own game') };
      this.banks[seat] = START_BANK;
    }
    this.touch();
    if (this.solo && this.status === 'waiting') {
      const res = this.startSeries();
      if (res.error) return res;
    } else {
      this.changed();
    }
    return { seat };
  }

  leave(seat) {
    this.seats[seat] = null;
    this.guesses.delete(seat);
    this.bets.delete(seat);
    this.ready.delete(seat);
    this.nextVotes.delete(seat);
    this.touch();
    if (this.status === 'playing') this.checkProgress();
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

  // ── серія
  start(seat) {
    if (this.status === 'playing') return { error: T('Гра вже йде', 'The game is already on') };
    if (seat !== this.host()) return { error: T('Почати гру може той, хто її створив', 'Only the room creator can start the game') };
    if (!this.solo && this.presentSeats().length < 2) return { error: T('Потрібно щонайменше 2 гравці', 'At least 2 players needed') };
    return this.startSeries();
  }

  startSeries() {
    if (!questionsFor(this.options.groups, this.options.difficulty).length) return { error: T('Немає питань для цих налаштувань', 'No questions for these settings') };
    this.banks = Array(this.capacity).fill(START_BANK);
    this.history = [];
    this.round = 0;
    this.used = new Set();
    this.lastGroup = null;
    this.lastQuestion = null;
    this.status = 'playing';
    this.nextRound();
    return { ok: true };
  }

  // Питання: випадкова група з обраних (не та сама, що минулого раунду), у ній — питання й гравець, якого ще не було.
  choose() {
    const all = questionsFor(this.options.groups, this.options.difficulty);
    const fresh = all.filter((q) => q.group !== this.lastGroup && q.id !== this.lastQuestion);
    const pool = fresh.length ? fresh : all;
    for (let k = 0; k < 20; k++) {
      const group = rand([...new Set(pool.map((q) => q.group))]);
      const q = rand(pool.filter((x) => x.group === group));
      const ps = candidates(q, this.options.difficulty).filter((p) => !this.used.has(p.id));
      if (ps.length) { const p = rand(ps); return { q, p, value: q.answer(p) }; }
    }
    this.used.clear();
    const q = rand(all);
    const p = rand(candidates(q, this.options.difficulty));
    return { q, p, value: q.answer(p) };
  }

  nextRound() {
    this.resetRound();
    if (this.round >= this.options.rounds) return this.finish();
    this.round++;
    this.question = this.choose();
    this.used.add(this.question.p.id);
    this.lastGroup = this.question.q.group;
    this.lastQuestion = this.question.q.id;
    this.phase = 'guess';
    if (this.options.seconds && !this.solo) {
      const ms = this.options.seconds * 1000;
      this.deadline = Date.now() + ms;
      this.timer = setTimeout(() => this.startBets(), ms);
    }
    this.changed();
  }

  // Оцінка: ціле число (гроші й підписники — з одним знаком після коми), роки — у розумних межах.
  parseGuess(value) {
    const q = this.question.q;
    const v = Number(value);
    if (value === '' || value == null || !Number.isFinite(v) || v < 0 || v > 1e6) return null;
    if (q.year && (v < 1850 || v > 2100)) return null;
    return q.dec ? Math.round(v * 10) / 10 : Math.round(v);
  }

  // ── кімната: оцінка (можна змінити, поки фаза триває)
  // соло: оцінка + рівень впевненості (level 0–2) + докладені фішки — одразу відповідь
  guess(seat, { value, level, extra } = {}) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не час для оцінки', 'It’s not time to guess') };
    const v = this.parseGuess(value);
    if (v == null) return { error: this.question.q.year ? T('Введи рік', 'Enter a year') : T('Введи число', 'Enter a number') };
    if (this.solo) return this.soloGuess(v, Number(level), extra);
    this.guesses.set(seat, v);
    this.touch();
    this.checkProgress();
    if (this.phase === 'guess') this.changed();
    return { ok: true };
  }

  soloGuess(v, level, extra) {
    if (![0, 1, 2].includes(level)) return { error: T('Обери, наскільки впевнений', 'Choose how sure you are') };
    const x = Math.max(0, Math.floor(Number(extra) || 0));
    if (x > this.banks[0]) return { error: T('Стільки фішок у тебе немає', 'You don’t have that many chips') };
    const { q, value } = this.question;
    const [lo, hi] = range(q, v, level);
    const hit = value >= lo && value <= hi;
    const win = hit ? (FREE + x) * SOLO_ODDS[level] * this.mult : 0;
    this.banks[0] += win - x;
    this.guesses.set(0, v);
    this.results[0] = { guess: v, level, odds: SOLO_ODDS[level], range: [lo, hi], rangeText: rangeText(q, level), extra: x, spent: x, win, bonus: 0, net: win - x, hit };
    this.reveal();
    return { ok: true, hit };
  }

  // ── табло: різні оцінки за зростанням; однакові — одна клітинка з кількома авторами
  startBets() {
    if (this.phase !== 'guess') return;
    clearTimeout(this.timer);
    const values = [...new Set(this.guesses.values())].sort((a, b) => a - b);
    this.slots = [{ value: null, odds: LOW_ODDS, authors: [], names: [] }];
    values.forEach((value, i) => {
      const authors = [...this.guesses].filter(([, v]) => v === value).map(([s]) => s);
      this.slots.push({ value, odds: oddsOf(i, values.length), authors, names: authors.map((s) => this.seats[s]?.name || '') });
    });
    this.phase = 'bet';
    this.deadline = null;
    if (this.options.seconds) {
      this.deadline = Date.now() + BET_MS;
      this.timer = setTimeout(() => this.reveal(), BET_MS);
    }
    this.changed();
  }

  // Ставки — цілком: [{ slot, extra }, { slot, extra }]; змінювати можна до «Готово». Чужі — лише після відповіді (блеф).
  bet(seat, { bets } = {}) {
    if (this.status !== 'playing' || this.phase !== 'bet') return { error: T('Ставки зараз не приймаються', 'Bets are closed right now') };
    if (this.ready.has(seat)) return { error: T('Ставки вже зроблено', 'Your bets are locked in') };
    if (!Array.isArray(bets) || bets.length !== 2) return { error: T('Потрібні ставки для обох маркерів', 'Both markers need a bet') };
    const clean = bets.map((b) => {
      const slot = Number.isInteger(b?.slot) && b.slot >= 0 && b.slot < this.slots.length ? b.slot : -1;
      return { slot, extra: slot === -1 ? 0 : Math.max(0, Math.floor(Number(b?.extra) || 0)) };
    });
    if (clean[0].extra + clean[1].extra > this.banks[seat]) return { error: T('Стільки фішок у тебе немає', 'You don’t have that many chips') };
    this.bets.set(seat, clean);
    this.touch();
    this.changed();
    return { ok: true };
  }

  done(seat) {
    if (this.status !== 'playing' || this.phase !== 'bet') return { error: T('Ставки зараз не приймаються', 'Bets are closed right now') };
    if (!(this.bets.get(seat) || []).some((b) => b.slot >= 0)) return { error: T('Постав хоча б один маркер', 'Place at least one marker') };
    this.ready.add(seat);
    this.touch();
    this.checkProgress();
    if (this.phase === 'bet') this.changed();
    return { ok: true };
  }

  next(seat) {
    if (this.status !== 'playing' || this.phase !== 'reveal') return { error: T('Раунд ще триває', 'The round is still on') };
    this.nextVotes.add(seat);
    this.checkProgress();
    if (this.phase === 'reveal') this.changed();
    return { ok: true };
  }

  checkProgress() {
    const online = this.online();
    if (!online.length) return;
    if (this.phase === 'guess' && !this.solo) {
      if (online.every((i) => this.guesses.has(i))) this.startBets();
    } else if (this.phase === 'bet') {
      if (online.every((i) => this.ready.has(i))) this.reveal();
    } else if (this.phase === 'reveal') {
      if (online.every((i) => this.nextVotes.has(i))) this.nextRound();
    }
  }

  // ── відповідь: виграє найбільша оцінка, що не більша за правду; якщо всі більші — «менше за всіх»
  reveal() {
    if (this.phase !== (this.solo ? 'guess' : 'bet')) return;
    clearTimeout(this.timer);
    this.phase = 'reveal';
    this.deadline = null;
    const { q, p, value } = this.question;
    if (!this.solo) {
      let win = 0;
      this.slots.forEach((s, i) => { if (s.value != null && s.value <= value) win = i; });
      this.win = win;
      for (const seat of this.presentSeats()) {
        const bets = (this.bets.get(seat) || []).filter((b) => b.slot >= 0);
        const spent = bets.reduce((s, b) => s + b.extra, 0);
        const gain = bets.filter((b) => b.slot === win).reduce((s, b) => s + (FREE + b.extra) * this.slots[win].odds * this.mult, 0);
        const bonus = this.slots[win].authors.includes(seat) ? AUTHOR_BONUS * this.mult : 0;
        this.banks[seat] += gain + bonus - spent;
        this.results[seat] = { spent, win: gain, bonus, net: gain + bonus - spent };
      }
    }
    this.history.push({
      question: q.ask(p),
      unit: q.unit,
      forms: q.forms,
      answer: value,
      year: !!q.year,
      winValue: this.solo ? null : this.slots[this.win].value,
      results: { ...this.results },
    });
    if (!this.solo) {
      this.deadline = Date.now() + REVEAL_MS;
      this.timer = setTimeout(() => this.nextRound(), REVEAL_MS);
    }
    this.changed();
  }

  finish() {
    clearTimeout(this.timer);
    this.status = 'finished';
    this.phase = null;
    this.deadline = null;
    this.changed();
  }

  publicState() {
    const reveal = this.phase === 'reveal';
    const cur = this.question;
    const showBets = this.phase === 'bet' || reveal;
    const state = {
      code: this.code,
      solo: this.solo,
      minPlayers: this.solo ? 1 : 2,
      options: this.options,
      capacity: this.capacity,
      seats: this.publicSeats(),
      host: this.host(),
      status: this.status,
      phase: this.phase,
      round: this.round,
      rounds: this.options.rounds,
      mult: this.status === 'playing' ? this.mult : 1,
      rules: { start: START_BANK, free: FREE, bonus: AUTHOR_BONUS, low: LOW_ODDS, solo: SOLO_ODDS },
      question: cur ? {
        id: cur.q.id, group: cur.q.group, text: cur.q.ask(cur.p), unit: cur.q.unit, forms: cur.q.forms, note: cur.q.note, dec: !!cur.q.dec, year: !!cur.q.year,
        // «У якому році народився?» — рік під іменем видав би відповідь
        player: { ...publicPlayer(cur.p), ...(cur.q.id === 'born' ? { born: null } : {}) },
        ranges: this.solo ? [0, 1, 2].map((l) => rangeText(cur.q, l)) : null,
      } : null,
      guessed: [...this.guesses.keys()],
      slots: showBets ? this.slots : [],
      bets: reveal ? Object.fromEntries(this.bets) : {}, // до відповіді — лише свої (privateState.myBets): можна блефувати
      ready: [...this.ready],
      answer: reveal ? { value: cur.value, detail: cur.q.detail(cur.p) } : null,
      win: reveal ? this.win : -1,
      results: reveal ? this.results : {},
      nextVotes: [...this.nextVotes],
      banks: this.banks,
      deadline: this.deadline,
      serverNow: Date.now(),
      history: this.status === 'finished' ? this.history : [],
    };
    if (process.env.ALLIN_TEST_ANSWER === '1' && cur) state.testAnswer = cur.value; // лише для автотесту
    return state;
  }

  // Свою оцінку до табло і свої ставки до відповіді бачить лише сам гравець.
  privateState(seat) {
    return { myGuess: this.guesses.get(seat) ?? null, myBets: this.bets.get(seat) || null };
  }
}

module.exports = { AllinRoom, oddsOf, START_BANK, FREE, AUTHOR_BONUS, LOW_ODDS, SOLO_ODDS, ALLOWED_ROUNDS, ALLOWED_SECONDS };
