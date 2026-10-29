// Партія «Шляху футболіста»: серія раундів, у кожному — один загаданий гравець, етапи відкриваються по одному.
// На кожному етапі кожен має одну спробу; вгадав раніше — більше очок. Підказки (позиція, рік, збірна, літера)
// кожен бере сам, коли захоче, — кожна знімає бали з можливих. Свої підказки й відповіді бачить лише сам гравець.
// Соло — кімната на одного.
const { playerById } = require('../../data');
const { BaseRoom } = require('../../core/base-room');
const { T } = require('../../core/i18n');
const { poolFor, stagesFor, hintValue, hintsFor, HINTS, ERAS, DIFFICULTIES } = require('./careers');

// Очки: на першому клубі — MAX, на останньому — LAST, між ними рівномірно (для кар'єри будь-якої довжини
// останні клуби ще мають вагу). Правильна відповідь з підказками — щонайменше MIN.
const MAX_POINTS = 100;
const LAST_POINTS = 10;
const MIN_POINTS = 5;
const stagePoints = (n) =>
  Array.from({ length: n }, (_, i) => (n === 1 ? MAX_POINTS : Math.round(MAX_POINTS - (i * (MAX_POINTS - LAST_POINTS)) / (n - 1))));
const stepFor = (n) => (MAX_POINTS - LAST_POINTS) / Math.max(1, n - 1);
// Підказки для цього гравця (зріст, прізвисько… — лише якщо є дані) з ціною для кар'єри з n клубів.
const hintCosts = (n, p = null) => (p ? hintsFor(p) : HINTS.filter((h) => !h.has))
  .map((h) => ({ id: h.id, label: h.label, cost: Math.max(h.min, Math.round(h.steps * stepFor(n))) }));
const ALLOWED_TIMERS = [0, 15, 20, 30, 45]; // секунд на етап; 0 — без обмеження
const ALLOWED_ROUNDS = [5, 10, 15];
const MAX_PLAYERS = 8;
const NOT_NOW = T('Зараз не можна', 'Not now');
const ALREADY = T('Ти вже вгадав', 'You’ve already guessed it');
const REVEAL_MS = Number(process.env.PATH_REVEAL_MS) || 10000; // пауза з відповіддю між раундами (у кімнаті)

function publicPlayer(p) {
  return { id: p.id, name: p.name, uk: p.uk, photo: p.photo };
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class PathRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, opts.solo ? 1 : MAX_PLAYERS);
    this.solo = !!opts.solo;
    this.options = {
      era: ERAS[opts.era] ? opts.era : 'all',
      difficulty: DIFFICULTIES[opts.difficulty] ? opts.difficulty : 'normal',
      rounds: ALLOWED_ROUNDS.includes(Number(opts.rounds)) ? Number(opts.rounds) : 10,
      turnSeconds: ALLOWED_TIMERS.includes(Number(opts.turnSeconds)) ? Number(opts.turnSeconds) : this.solo ? 0 : 30,
      start: opts.start === 'last' ? 'last' : 'first',
      showYears: opts.showYears !== false,
      showStats: opts.showStats !== false,
    };
    this.status = 'waiting'; // waiting | playing | finished
    this.scores = Array(this.capacity).fill(0);
    this.history = []; // [{ answer, results: { seat: { stage, points } } }]
    this.resetRound();
  }

  resetRound() {
    clearTimeout(this.timer);
    this.phase = null; // guess | reveal
    this.answer = null;
    this.stages = [];
    this.stage = 0;
    this.solved = new Map(); // seat → { stage, points }
    this.stageDone = new Set(); // хто вже відповів (або пропустив) на цьому етапі
    this.guesses = []; // { seat, stage, playerId, correct }
    this.hints = new Map(); // seat → [id підказки] (у порядку, в якому брав)
    this.nextVotes = new Set();
    this.deadline = null;
  }

  host() {
    return this.presentSeats()[0] ?? -1;
  }

  // ── вхід/вихід
  join(token, name) {
    let seat = this.rejoin(token, name);
    if (seat === -1) {
      seat = this.takeSeat(token, name);
      if (seat === -1) return { error: T('Кімната вже заповнена — створи свою гру', 'The room is full — start your own game') };
      this.scores[seat] = 0; // місце могло лишитися від того, хто вийшов
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
    this.solved.delete(seat);
    this.touch();
    if (this.status === 'playing') this.checkProgress();
    this.changed();
  }

  setConnected(token, connected) {
    super.setConnected(token, connected);
    // той, хто зник, не тримає етап — чекаємо лише тих, хто онлайн
    if (this.status === 'playing') this.checkProgress();
  }

  // ── серія
  start(seat) {
    if (this.status === 'playing') return { error: T('Гра вже йде', 'The game is already on') };
    if (seat !== this.host()) return { error: T('Почати гру може той, хто її створив', 'Only the host can start the game') };
    return this.startSeries();
  }

  startSeries() {
    const { era, difficulty, rounds } = this.options;
    const pool = poolFor(era, difficulty);
    if (!pool.length) return { error: T('Немає гравців для цих налаштувань', 'No players match these settings') };
    this.picks = shuffle(pool).slice(0, rounds);
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.roundNo = 0;
    this.status = 'playing';
    this.nextRound();
    return { ok: true };
  }

  nextRound() {
    this.resetRound();
    if (this.roundNo >= this.picks.length) return this.finish();
    this.answer = this.picks[this.roundNo++];
    this.stages = stagesFor(this.answer, this.options);
    this.points = stagePoints(this.stages.length);
    this.costs = hintCosts(this.stages.length, this.answer);
    this.phase = 'guess';
    this.startTimer();
    this.changed();
  }

  startTimer() {
    clearTimeout(this.timer);
    const sec = this.options.turnSeconds;
    this.deadline = sec ? Date.now() + sec * 1000 : null;
    if (sec) this.timer = setTimeout(() => this.advanceStage(), sec * 1000);
  }

  // ── очки: за етап мінус ціна взятих підказок, але щонайменше 1
  hintCost(seat) {
    return (this.hints.get(seat) || []).reduce((sum, id) => sum + this.costs.find((h) => h.id === id).cost, 0);
  }

  potential(seat) {
    return Math.max(MIN_POINTS, this.points[this.stage] - this.hintCost(seat));
  }

  // ── дії гравця
  hint(seat, id) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: NOT_NOW };
    if (this.solved.has(seat)) return { error: ALREADY };
    if (!this.costs.some((h) => h.id === id)) return { error: T('Немає такої підказки', 'No such hint') };
    const taken = this.hints.get(seat) || [];
    if (taken.includes(id)) return { ok: true };
    this.hints.set(seat, [...taken, id]);
    this.touch();
    this.changed();
    return { ok: true };
  }

  guess(seat, playerId) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не можна відповідати', 'You can’t answer right now') };
    if (this.solved.has(seat)) return { error: ALREADY };
    if (this.stageDone.has(seat)) return { error: T('Спробу на цей клуб уже використано — чекай наступного', 'You’ve used your guess for this club — wait for the next one') };
    const player = playerById.get(playerId);
    if (!player) return { error: T('Обери гравця зі списку', 'Pick a player from the list') };
    const correct = player.id === this.answer.id;
    this.touch();
    this.guesses.push({ seat, stage: this.stage, playerId: player.id, correct });
    this.stageDone.add(seat);
    if (correct) {
      const points = this.potential(seat);
      this.scores[seat] += points;
      this.solved.set(seat, { stage: this.stage, points });
    }
    this.checkProgress();
    this.changed();
    return { ok: true, correct };
  }

  // «Далі»: без відповіді на цьому етапі — щоб не чекати таймер.
  pass(seat) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: NOT_NOW };
    if (this.solved.has(seat) || this.stageDone.has(seat)) return { ok: true };
    this.touch();
    this.stageDone.add(seat);
    this.checkProgress();
    this.changed();
    return { ok: true };
  }

  // Після відповіді — наступний раунд, коли всі онлайн натиснули «Далі» (або минула пауза).
  next(seat) {
    if (this.status !== 'playing' || this.phase !== 'reveal') return { error: T('Раунд ще йде', 'The round is still on') };
    this.nextVotes.add(seat);
    if (this.waitingFor(this.nextVotes).length === 0) this.nextRound();
    else this.changed();
    return { ok: true };
  }

  // ── хід раунду
  // Хто з онлайн-гравців ще не зробив потрібне (не вгадав і не відповів на етапі / не натиснув «Далі»).
  waitingFor(done) {
    return this.presentSeats().filter((i) => this.seats[i].connected && !this.solved.has(i) && !done.has(i));
  }

  checkProgress() {
    if (this.phase === 'guess') {
      const online = this.presentSeats().filter((i) => this.seats[i].connected);
      if (online.length && online.every((i) => this.solved.has(i))) return this.endRound();
      if (this.waitingFor(this.stageDone).length === 0) this.advanceStage();
    } else if (this.phase === 'reveal') {
      if (this.presentSeats().filter((i) => this.seats[i].connected).every((i) => this.nextVotes.has(i))) this.nextRound();
    }
  }

  advanceStage() {
    if (this.phase !== 'guess') return;
    if (this.stage >= this.stages.length - 1) return this.endRound();
    this.stage++;
    this.stageDone.clear();
    this.startTimer();
    this.changed();
  }

  endRound() {
    clearTimeout(this.timer);
    this.phase = 'reveal';
    this.deadline = null;
    this.history.push({ answer: this.answer, results: Object.fromEntries(this.solved) });
    // у кімнаті — пауза з відповіддю, далі сам наступний раунд; соло — по кнопці
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

  // Стан для клієнтів: загаданого гравця не відправляємо, поки раунд не скінчився.
  publicState() {
    const state = {
      code: this.code,
      solo: this.solo,
      options: this.options,
      points: this.points || [], // очки за кожен клуб цього раунду
      maxPoints: MAX_POINTS,
      capacity: this.capacity,
      seats: this.publicSeats(),
      host: this.host(),
      status: this.status,
      phase: this.phase,
      round: this.roundNo || 0,
      rounds: this.picks ? this.picks.length : this.options.rounds,
      stage: this.stage,
      totalStages: this.stages.length,
      stages: this.phase === 'reveal' ? this.stages : this.stages.slice(0, this.stage + 1),
      stageDone: [...this.stageDone],
      solved: Object.fromEntries(this.solved),
      hintCosts: this.costs || hintCosts(1),
      minPoints: MIN_POINTS, // нижче цього підказки вже не знімають — клієнт показує справжню ціну
      // скільки підказок узяв кожен (самі підказки й чужі відповіді не показуємо — щоб не підказати)
      hintsUsed: Object.fromEntries([...this.hints].map(([s, l]) => [s, l.length])),
      guesses: this.guesses.map((g) => ({ seat: g.seat, stage: g.stage, correct: g.correct })),
      nextVotes: [...this.nextVotes],
      scores: this.scores,
      deadline: this.deadline,
      serverNow: Date.now(),
      answer: this.phase === 'reveal' && this.answer
        ? { ...publicPlayer(this.answer), facts: hintsFor(this.answer).filter((h) => h.id !== 'letter').map((h) => ({ id: h.id, label: h.label, ...hintValue(this.answer, h.id, this.options) })) }
        : null,
      history: this.status === 'finished'
        ? this.history.map((h) => ({ answer: publicPlayer(h.answer), results: h.results }))
        : [],
    };
    if (process.env.PATH_TEST_ANSWER === '1' && this.answer) state.testAnswer = this.answer.id; // лише для автотесту
    return state;
  }

  // Те, що бачить лише цей гравець: його підказки, його відповіді й скільки він може зараз заробити.
  privateState(seat) {
    const taken = this.hints.get(seat) || [];
    return {
      myHints: this.answer
        ? taken.map((id) => ({ id, label: HINTS.find((h) => h.id === id).label, ...hintValue(this.answer, id, this.options) }))
        : [],
      myGuesses: this.guesses
        .filter((g) => g.seat === seat)
        .map((g) => ({ stage: g.stage, correct: g.correct, player: publicPlayer(playerById.get(g.playerId)) })),
      potential: this.phase === 'guess' && !this.solved.has(seat) ? this.potential(seat) : null,
    };
  }
}

module.exports = { PathRoom, stagePoints, hintCosts, ALLOWED_TIMERS, ALLOWED_ROUNDS, HINTS };
