// Партія «Один на один»: пара футболістів і питання («Хто забив більше голів у чемпіонатах?») — обираєш одного.
// Соло «Серія» — переможець пари лишається, приходить новий суперник; гра до кінця життів (1 або 3 помилки), рахунок — правильні відповіді.
// Соло «Раунди» — 10/20 пар, +1 за правильну. Кімната (2–10) — усі бачать ту саму пару й відповідають одночасно за таймером:
// +1 за правильну і ще +1 найшвидшому з правильних; після пари видно, хто кого обрав.
const { T } = require('../../core/i18n');
const { BaseRoom } = require('../../core/base-room');
const { questionsFor, makePair, DIFFICULTIES, GROUPS } = require('./questions');
const { careerOf } = require('../path/careers');
const { nationName, profileOf, placeT } = require('../guess/compare');

const MAX_PLAYERS = 10;
const ALLOWED_ROUNDS = [10, 20];
const ALLOWED_SECONDS = [0, 5, 10, 15]; // 0 — без таймера
const ALLOWED_LIVES = [1, 3];
const LEVELS = ['easy', 'hard', 'mix'];
const REVEAL_MS = Number(process.env.DUEL_REVEAL_MS) || 7000; // кімната: скільки показуємо відповідь, якщо не всі натиснули «далі»

const rand = (list) => list[Math.floor(Math.random() * list.length)];

function publicPlayer(p) { // ім'я, фото, збірна з прапором, рік народження
  const n = careerOf(p)?.nation;
  const nation = n ? profileOf(p)?.nation : null;
  const name = n ? nationName(n.t) : null;
  return {
    id: p.id, name: p.name, uk: p.uk, photo: p.photo, born: p.born || null,
    nation: name ? { name: placeT(name), img: nation?.img || null } : null,
  };
}

class DuelRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, opts.solo ? 1 : MAX_PLAYERS);
    this.solo = !!opts.solo;
    const groups = (Array.isArray(opts.groups) ? opts.groups : []).filter((g) => GROUPS[g]);
    this.options = {
      mode: this.solo && opts.mode === 'streak' ? 'streak' : 'rounds',
      groups: groups.length ? [...new Set(groups)] : Object.keys(GROUPS),
      difficulty: DIFFICULTIES[opts.difficulty] ? opts.difficulty : 'normal',
      level: LEVELS.includes(opts.level) ? opts.level : 'mix',
      rounds: ALLOWED_ROUNDS.includes(Number(opts.rounds)) ? Number(opts.rounds) : 10,
      seconds: ALLOWED_SECONDS.includes(Number(opts.seconds)) ? Number(opts.seconds) : 10,
      lives: ALLOWED_LIVES.includes(Number(opts.lives)) ? Number(opts.lives) : 1,
    };
    this.status = 'waiting'; // waiting | playing | finished
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.resetPair();
  }

  get streak() { return this.options.mode === 'streak'; }

  resetPair() {
    clearTimeout(this.timer);
    this.phase = null; // guess | reveal
    this.question = null;
    this.pair = null; // [{ p, v }, { p, v }]
    this.winner = -1; // 0 | 1 — у кого більше
    this.picks = new Map(); // seat → { side, ms }
    this.results = {}; // seat → { side, correct, points, fastest }
    this.nextVotes = new Set();
    this.deadline = null;
    this.startedAt = 0;
  }

  // Господар — перший, хто зараз онлайн.
  host() {
    const present = this.presentSeats();
    return present.find((i) => this.seats[i].connected) ?? present[0] ?? -1;
  }

  // ── вхід/вихід
  join(token, name) {
    let seat = this.rejoin(token, name);
    if (seat === -1) {
      seat = this.takeSeat(token, name);
      if (seat === -1) return { error: T('Кімната вже заповнена — створи свою гру', 'The room is full — start your own game') };
      this.scores[seat] = 0;
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
    this.picks.delete(seat);
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
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.pairNo = 0;
    this.livesLeft = this.options.lives;
    this.best = 0; // серія: найдовша серія правильних поспіль
    this.run = 0;
    this.champion = null; // серія: хто лишається (переможець попередньої пари) і з якого боку
    this.used = new Set(); // гравці, що вже були (щоб не повторювались)
    this.lastQuestion = null;
    this.status = 'playing';
    this.nextPair();
    return { ok: true };
  }

  // Питання й пара: випадкова група з обраних, у ній — випадкове питання (не те саме, що щойно).
  // Серія: чемпіон лишається на своєму боці, якщо для нього є питання й суперник.
  choosePair() {
    const all = questionsFor(this.options.groups, this.options.difficulty);
    const keep = this.champion?.p || null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const fresh = all.filter((q) => q.id !== this.lastQuestion && (!keep || q.value(keep) != null));
      const pool = fresh.length ? fresh : all;
      const group = rand([...new Set(pool.map((q) => q.group))]);
      const q = rand(pool.filter((x) => x.group === group));
      const pair = makePair(q, this.options.difficulty, this.options.level, { keep: attempt < 20 ? keep : null, avoid: this.used });
      if (!pair) continue;
      // чемпіон — на тому ж боці, новий суперник — навпроти
      const [a, b] = pair;
      const sides = keep && pair[0].p === keep && this.champion.side === 1 ? [b, a] : [a, b];
      return { q, sides };
    }
    this.used.clear(); // вичерпали гравців — дозволяємо повтори
    const q = rand(all);
    const pair = makePair(q, this.options.difficulty, this.options.level);
    return pair ? { q, sides: pair } : null;
  }

  nextPair() {
    this.resetPair();
    const done = this.streak ? this.livesLeft <= 0 : this.pairNo >= this.options.rounds;
    if (done) return this.finish();
    const next = this.choosePair();
    if (!next) return this.finish();
    this.pairNo++;
    this.question = next.q;
    this.pair = next.sides;
    for (const x of this.pair) this.used.add(x.p.id);
    this.lastQuestion = next.q.id;
    this.winner = this.pair[0].v > this.pair[1].v ? 0 : 1;
    this.phase = 'guess';
    this.startedAt = Date.now();
    if (this.options.seconds) { // таймер — і в соло, і в кімнаті; без відповіді вчасно — помилка
      const ms = this.options.seconds * 1000;
      this.deadline = Date.now() + ms;
      this.timer = setTimeout(() => this.reveal(), ms);
    }
    this.changed();
  }

  // ── відповідь: side — 0 (червоний кут) або 1 (синій)
  answer(seat, side) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не можна відповідати', 'You can’t answer right now') };
    if (side !== 0 && side !== 1) return { error: T('Обери одного з двох', 'Pick one of the two') };
    if (this.picks.has(seat)) return { error: T('Ти вже відповів', 'You already answered') };
    this.picks.set(seat, { side, ms: Date.now() - this.startedAt });
    this.touch();
    this.checkProgress();
    if (this.phase === 'guess') this.changed();
    return { ok: true, correct: side === this.winner };
  }

  next(seat) {
    if (this.status !== 'playing' || this.phase !== 'reveal') return { error: T('Пара ще триває', 'The pair is still on') };
    this.nextVotes.add(seat);
    this.checkProgress();
    if (this.phase === 'reveal') this.changed();
    return { ok: true };
  }

  checkProgress() {
    const online = this.presentSeats().filter((i) => this.seats[i].connected);
    if (!online.length) return;
    if (this.phase === 'guess') {
      if (online.every((i) => this.picks.has(i))) this.reveal();
    } else if (this.phase === 'reveal') {
      if (online.every((i) => this.nextVotes.has(i))) this.nextPair();
    }
  }

  reveal() {
    if (this.phase !== 'guess') return;
    clearTimeout(this.timer);
    this.phase = 'reveal';
    this.deadline = null;
    const correct = [...this.picks].filter(([, x]) => x.side === this.winner).sort((a, b) => a[1].ms - b[1].ms);
    const fastest = !this.solo && correct.length ? correct[0][0] : -1;
    for (const [seat, x] of this.picks) {
      const ok = x.side === this.winner;
      const points = ok ? 1 + (seat === fastest ? 1 : 0) : 0;
      this.scores[seat] += points;
      this.results[seat] = { side: x.side, correct: ok, points, fastest: seat === fastest, ms: x.ms };
    }
    if (this.solo) {
      const ok = !!this.results[0]?.correct;
      this.run = ok ? this.run + 1 : 0;
      this.best = Math.max(this.best, this.run);
      if (this.streak && !ok) this.livesLeft--;
      // серія: переможець пари лишається (навіть якщо ти помилився — він же переміг)
      this.champion = this.streak ? { p: this.pair[this.winner].p, side: this.winner } : null;
    }
    this.history.push({
      question: this.question.title,
      players: this.pair.map((x) => ({ name: x.p.name, uk: x.p.uk })),
      winner: this.winner,
      results: { ...this.results },
    });
    if (!this.solo) {
      this.deadline = Date.now() + REVEAL_MS;
      this.timer = setTimeout(() => this.nextPair(), REVEAL_MS);
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
    const q = this.question;
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
      round: this.pairNo || 0,
      rounds: this.streak ? null : this.options.rounds,
      question: q ? { id: q.id, group: q.group, title: q.title, unit: q.unit, note: q.note } : null,
      // «Хто старший?» — рік народження під іменем видав би відповідь, тож до відкриття його не показуємо
      pair: this.pair ? this.pair.map((x) => ({ ...publicPlayer(x.p), ...(this.phase === 'guess' && this.question?.id === 'older' ? { born: null } : {}) })) : null,
      champion: this.streak && this.champion && this.pair?.[this.champion.side]?.p === this.champion.p ? this.champion.side : -1,
      // відповідь — лише після пари
      values: reveal ? this.pair.map((x) => ({ ...q.show(x.v, x.p) })) : null,
      winner: reveal ? this.winner : -1,
      results: reveal ? this.results : {},
      answered: [...this.picks.keys()],
      lives: this.streak ? this.livesLeft : null,
      run: this.solo ? this.run || 0 : null,
      best: this.solo ? this.best || 0 : null,
      nextVotes: [...this.nextVotes],
      scores: this.scores,
      deadline: this.deadline,
      serverNow: Date.now(),
      history: this.status === 'finished' ? this.history : [],
    };
    if (process.env.DUEL_TEST_ANSWER === '1' && this.pair) state.testAnswer = this.winner; // лише для автотесту
    return state;
  }

  // Свій вибір під час пари бачить лише сам гравець.
  privateState(seat) {
    return { myPick: this.picks.get(seat)?.side ?? null };
  }
}

module.exports = { publicPlayer, DuelRoom, ALLOWED_ROUNDS, ALLOWED_SECONDS, ALLOWED_LIVES, LEVELS };
