// Партія «Вгадай гравця»: серія раундів, у кожному — один загаданий гравець. Кожен вгадує сам, у своєму темпі:
// вводить будь-якого футболіста й бачить, у чому той збігається із загаданим (збірна, позиція, рік, клуби, голи…).
// Свої спроби (з іменами) бачить лише сам гравець, інші — тільки кольори. Соло — кімната на одного.
const { playerById } = require('../../data');
const { BaseRoom } = require('../../core/base-room');
const { poolFor, careerOf, ERAS, DIFFICULTIES } = require('../path/careers');
const { profileOf, compare, COLUMNS } = require('./compare');

// Очки: з першої спроби — MAX, з останньої — LAST, між ними рівномірно.
const MAX_POINTS = 100;
const LAST_POINTS = 10;
const attemptPoints = (n, max) => (max === 1 ? MAX_POINTS : Math.round(MAX_POINTS - (n * (MAX_POINTS - LAST_POINTS)) / (max - 1)));
const ALLOWED_ATTEMPTS = [6, 8, 10];
const ALLOWED_TIMERS = [0, 60, 120, 180]; // секунд на раунд; 0 — без обмеження
const ALLOWED_ROUNDS = [3, 5, 10];
const MAX_PLAYERS = 8;
const REVEAL_MS = Number(process.env.GUESS_REVEAL_MS) || 10000;

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

// Рядок самого загаданого (відповідь або правильна спроба): усе зелене, без пояснень-порівнянь;
// замість спільних клубів — уся його кар'єра.
function answerCells(target) {
  return compare(target, target).map((c) => {
    const cell = { ...c, color: 'green', arrow: null, note: null };
    if (c.items) cell.items = c.items.map((x) => ({ ...x, match: false }));
    if (c.id === 'shared') Object.assign(cell, { clubs: c.clubs.map((x) => ({ ...x, together: false })), note: "уся кар'єра" });
    if (c.id === 'last') cell.note = c.note;
    return cell;
  });
}

class GuessRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, opts.solo ? 1 : MAX_PLAYERS);
    this.solo = !!opts.solo;
    this.options = {
      era: ERAS[opts.era] ? opts.era : 'all',
      difficulty: DIFFICULTIES[opts.difficulty] ? opts.difficulty : 'normal',
      rounds: ALLOWED_ROUNDS.includes(Number(opts.rounds)) ? Number(opts.rounds) : 5,
      attempts: ALLOWED_ATTEMPTS.includes(Number(opts.attempts)) ? Number(opts.attempts) : 8,
      turnSeconds: ALLOWED_TIMERS.includes(Number(opts.turnSeconds)) ? Number(opts.turnSeconds) : this.solo ? 0 : 120,
    };
    this.status = 'waiting'; // waiting | playing | finished
    this.scores = Array(this.capacity).fill(0);
    this.history = []; // [{ answer, results: { seat: { attempts, points } } }]
    this.resetRound();
  }

  resetRound() {
    clearTimeout(this.timer);
    this.phase = null; // guess | reveal
    this.answer = null;
    this.tries = new Map(); // seat → [{ playerId, cells, correct }]
    this.solved = new Map(); // seat → { attempts, points }
    this.gaveUp = new Set();
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
      if (seat === -1) return { error: 'Кімната вже заповнена — створи свою гру' };
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
    this.tries.delete(seat);
    this.solved.delete(seat);
    this.gaveUp.delete(seat);
    this.touch();
    if (this.status === 'playing') this.checkProgress();
    this.changed();
  }

  setConnected(token, connected) {
    super.setConnected(token, connected);
    if (this.status === 'playing') this.checkProgress();
  }

  // ── серія
  start(seat) {
    if (this.status === 'playing') return { error: 'Гра вже йде' };
    if (seat !== this.host()) return { error: 'Почати гру може той, хто її створив' };
    return this.startSeries();
  }

  startSeries() {
    const { era, difficulty, rounds } = this.options;
    // загадуємо лише тих, хто грав за збірну, — інакше колонка «Збірна» нічого не дає
    const pool = poolFor(era, difficulty).filter((p) => careerOf(p).nation && profileOf(p));
    if (!pool.length) return { error: 'Немає гравців для цих налаштувань' };
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
    this.target = profileOf(this.answer);
    this.phase = 'guess';
    const sec = this.options.turnSeconds;
    this.deadline = sec ? Date.now() + sec * 1000 : null;
    if (sec) this.timer = setTimeout(() => this.endRound(), sec * 1000);
    this.changed();
  }

  // ── дії гравця
  done(seat) {
    return this.solved.has(seat) || this.gaveUp.has(seat) || (this.tries.get(seat) || []).length >= this.options.attempts;
  }

  guess(seat, playerId) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: 'Зараз не можна відповідати' };
    if (this.done(seat)) return { error: 'Спроби в цьому раунді закінчились' };
    const player = playerById.get(playerId);
    const profile = player && profileOf(player);
    if (!player) return { error: 'Обери гравця зі списку' };
    if (!profile) return { error: 'Про цього гравця бракує даних — обери іншого' };
    const mine = this.tries.get(seat) || [];
    if (mine.some((t) => t.playerId === player.id)) return { error: 'Цього гравця ти вже називав' };
    const correct = player.id === this.answer.id;
    const cells = correct ? null : compare(profile, this.target);
    mine.push({ playerId: player.id, cells: correct ? answerCells(this.target) : cells, correct });
    this.tries.set(seat, mine);
    this.touch();
    if (correct) {
      const points = attemptPoints(mine.length - 1, this.options.attempts);
      this.scores[seat] += points;
      this.solved.set(seat, { attempts: mine.length, points });
    }
    this.checkProgress();
    this.changed();
    return { ok: true, correct };
  }

  giveUp(seat) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: 'Зараз не можна' };
    if (this.done(seat)) return { ok: true };
    this.gaveUp.add(seat);
    this.touch();
    this.checkProgress();
    this.changed();
    return { ok: true };
  }

  next(seat) {
    if (this.status !== 'playing' || this.phase !== 'reveal') return { error: 'Раунд ще йде' };
    this.nextVotes.add(seat);
    this.checkProgress();
    if (this.phase === 'reveal') this.changed();
    return { ok: true };
  }

  // ── хід раунду: кінець, коли всі онлайн вгадали або витратили спроби (здалися)
  checkProgress() {
    const online = this.presentSeats().filter((i) => this.seats[i].connected);
    if (this.phase === 'guess') {
      if (online.length && online.every((i) => this.done(i))) this.endRound();
    } else if (this.phase === 'reveal') {
      if (online.every((i) => this.nextVotes.has(i))) this.nextRound();
    }
  }

  endRound() {
    if (this.phase !== 'guess') return;
    clearTimeout(this.timer);
    this.phase = 'reveal';
    this.deadline = null;
    this.history.push({ answer: this.answer, results: Object.fromEntries(this.solved) });
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

  // Стан для всіх: чужі спроби — лише кольори, без імен (щоб не підказати).
  publicState() {
    const progress = {};
    for (const i of this.presentSeats()) {
      progress[i] = {
        colors: (this.tries.get(i) || []).map((t) => t.cells.map((c) => c.color)),
        solved: this.solved.get(i) || null,
        done: this.phase === 'guess' ? this.done(i) : true,
      };
    }
    const state = {
      code: this.code,
      solo: this.solo,
      options: this.options,
      columns: COLUMNS,
      maxPoints: MAX_POINTS,
      points: Array.from({ length: this.options.attempts }, (_, n) => attemptPoints(n, this.options.attempts)),
      capacity: this.capacity,
      seats: this.publicSeats(),
      host: this.host(),
      status: this.status,
      phase: this.phase,
      round: this.roundNo || 0,
      rounds: this.picks ? this.picks.length : this.options.rounds,
      progress,
      nextVotes: [...this.nextVotes],
      scores: this.scores,
      deadline: this.deadline,
      serverNow: Date.now(),
      answer: this.phase === 'reveal' && this.answer
        ? { ...publicPlayer(this.answer), cells: answerCells(this.target) }
        : null,
      history: this.status === 'finished' ? this.history.map((h) => ({ answer: publicPlayer(h.answer), results: h.results })) : [],
    };
    if (process.env.GUESS_TEST_ANSWER === '1' && this.answer) state.testAnswer = this.answer.id; // лише для автотесту
    return state;
  }

  privateState(seat) {
    return {
      myTries: (this.tries.get(seat) || []).map((t) => ({ player: publicPlayer(playerById.get(t.playerId)), cells: t.cells, correct: t.correct })),
      potential: this.phase === 'guess' && !this.done(seat) ? attemptPoints((this.tries.get(seat) || []).length, this.options.attempts) : null,
    };
  }
}

module.exports = { GuessRoom, attemptPoints, ALLOWED_ATTEMPTS, ALLOWED_TIMERS, ALLOWED_ROUNDS };
