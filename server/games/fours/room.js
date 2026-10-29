// Партія «Чотири четвірки»: серія головоломок. У кожній — 16 футболістів, яких треба розкласти на 4 групи по 4.
// Кожен розв'язує ту саму головоломку у своєму темпі; помилок — 4 (або без обмеження). Підказка — підсвічує двох
// з однієї незнайденої групи (далі — третього до вже відомої пари), кожна наступна дорожча. Чужий прогрес — лише кольори
// знайдених груп і кількість помилок. Соло — кімната на одного; «Головоломка дня» — соло з однією головоломкою за датою.
const { BaseRoom } = require('../../core/base-room');
const { makePuzzle, LEVELS } = require('./groups');
const { T } = require('../../core/i18n');

const GROUP_POINTS = 25;
const MISTAKE_PENALTY = 5;
const PERFECT_BONUS = 10; // усі 4 групи без жодної помилки
const FIRST_BONUS = 10; // у кімнаті — хто першим знайшов усі 4
const HINT_STEP = 5; // підказка «двоє з однієї групи»: перша −5, друга −10, третя −15…
const ALLOWED_MISTAKES = [4, 0]; // 0 — без обмеження
const ALLOWED_TIMERS = [0, 120, 180, 300];
const ALLOWED_ROUNDS = [1, 3, 5];
const MAX_PLAYERS = 8;
const REVEAL_MS = Number(process.env.FOURS_REVEAL_MS) || 12000;
const DAILY_START = Date.UTC(2026, 9, 23); // «Головоломка дня» №1

// Дата в Києві (нова головоломка дня — опівночі за київським часом).
function kyivDate(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date(now)); // YYYY-MM-DD
}
const dailyNumber = (date) => Math.round((Date.parse(date) - DAILY_START) / 86400000) + 1;

function publicPlayer(p) {
  return { id: p.id, name: p.name, uk: p.uk, photo: p.photo };
}
const publicGroup = (g) => ({ color: g.color, label: g.label, icon: g.icon, img: g.img, players: g.players.map(publicPlayer) });

class FoursRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, opts.solo ? 1 : MAX_PLAYERS);
    this.solo = !!opts.solo;
    const daily = this.solo && !!opts.daily;
    this.options = {
      daily,
      difficulty: daily ? 'normal' : LEVELS[opts.difficulty] ? opts.difficulty : 'normal',
      rounds: daily ? 1 : ALLOWED_ROUNDS.includes(Number(opts.rounds)) ? Number(opts.rounds) : 3,
      mistakes: daily ? 4 : ALLOWED_MISTAKES.includes(Number(opts.mistakes)) ? Number(opts.mistakes) : 4,
      turnSeconds: daily ? 0 : ALLOWED_TIMERS.includes(Number(opts.turnSeconds)) ? Number(opts.turnSeconds) : 0,
    };
    if (daily) this.date = kyivDate();
    this.status = 'waiting'; // waiting | playing | finished
    this.scores = Array(this.capacity).fill(0);
    this.history = []; // [{ groups, results: { seat: { found, mistakes, points } } }]
    this.roundNo = 0;
    this.resetRound();
  }

  resetRound() {
    clearTimeout(this.timer);
    this.phase = null; // guess | reveal
    this.puzzle = null;
    this.found = new Map(); // seat → [номер групи] у порядку знаходження
    this.mistakes = new Map(); // seat → кількість
    this.tries = new Map(); // seat → [{ key, colors: [4 кольори], correct }]
    this.gaveUp = new Set();
    this.hints = new Map(); // seat → { links: Map(група → [id]), count, cost }
    this.results = new Map(); // seat → { found, mistakes, points, first } — хто вже закінчив
    this.firstDone = false;
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
    for (const m of [this.found, this.mistakes, this.tries, this.hints, this.results]) m.delete(seat);
    this.gaveUp.delete(seat);
    this.touch();
    if (this.status === 'playing') this.checkProgress();
    this.changed();
  }

  // ── серія
  start(seat) {
    if (this.status === 'playing') return { error: T('Гра вже йде', 'The game is already on') };
    if (seat !== this.host()) return { error: T('Почати гру може той, хто її створив', 'Only the host can start the game') };
    return this.startSeries();
  }

  startSeries() {
    const { difficulty, rounds, daily } = this.options;
    const avoid = new Set(); // ознаки не повторюються за серію
    this.puzzles = [];
    for (let i = 0; i < rounds; i++) {
      const p = makePuzzle(difficulty, { seed: daily ? `daily-${this.date}` : null, avoid });
      if (!p) break;
      p.groups.forEach((g) => avoid.add(g.key));
      this.puzzles.push(p);
    }
    if (!this.puzzles.length) return { error: T('Не вдалося скласти головоломку — спробуй ще раз', "Couldn't build a puzzle — try again") };
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.roundNo = 0;
    this.status = 'playing';
    this.nextRound();
    return { ok: true };
  }

  nextRound() {
    this.resetRound();
    if (this.roundNo >= this.puzzles.length) return this.finish();
    this.puzzle = this.puzzles[this.roundNo++];
    this.groupOf = new Map();
    this.puzzle.groups.forEach((g, i) => g.players.forEach((p) => this.groupOf.set(p.id, i)));
    this.phase = 'guess';
    const sec = this.options.turnSeconds;
    this.deadline = sec ? Date.now() + sec * 1000 : null;
    if (sec) this.timer = setTimeout(() => this.endRound(), sec * 1000);
    this.changed();
  }

  // ── дії гравця
  done(seat) {
    return this.results.has(seat);
  }

  // Гравець закінчив головоломку (знайшов усі групи, вичерпав помилки або здався) — рахуємо його очки.
  finishSeat(seat) {
    if (this.results.has(seat)) return;
    const found = (this.found.get(seat) || []).length;
    const mistakes = this.mistakes.get(seat) || 0;
    const { count: hints, cost } = this.hintsOf(seat);
    let points = Math.max(0, found * GROUP_POINTS - mistakes * MISTAKE_PENALTY - cost);
    const perfect = found === 4 && mistakes === 0;
    if (perfect) points += PERFECT_BONUS;
    const first = !this.solo && found === 4 && !this.firstDone;
    if (first) {
      this.firstDone = true;
      points += FIRST_BONUS;
    }
    this.scores[seat] += points;
    this.results.set(seat, { found, mistakes, hints, points, perfect, first });
  }

  check(seat, ids) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не можна відповідати', "You can't answer right now") };
    if (this.done(seat)) return { error: T('Ця головоломка для тебе вже закінчилась', 'This puzzle is already over for you') };
    const pick = [...new Set(Array.isArray(ids) ? ids : [])];
    const mine = this.found.get(seat) || [];
    if (pick.length !== 4 || pick.some((id) => !this.groupOf.has(id) || mine.includes(this.groupOf.get(id)))) {
      return { error: T('Обери чотирьох гравців', 'Pick four players') };
    }
    const key = [...pick].sort().join(',');
    const tries = this.tries.get(seat) || [];
    if (tries.some((t) => t.key === key)) return { error: T('Цю четвірку ти вже пробував', 'You already tried this four') };
    const colors = pick.map((id) => this.groupOf.get(id));
    const correct = colors.every((c) => c === colors[0]);
    tries.push({ key, colors, correct });
    this.tries.set(seat, tries);
    this.touch();
    let oneAway = false;
    if (correct) {
      mine.push(colors[0]);
      this.found.set(seat, mine);
      if (mine.length === 4) this.finishSeat(seat);
    } else {
      const count = new Map();
      for (const c of colors) count.set(c, (count.get(c) || 0) + 1);
      oneAway = [...count.values()].includes(3);
      const m = (this.mistakes.get(seat) || 0) + 1;
      this.mistakes.set(seat, m);
      if (this.options.mistakes && m >= this.options.mistakes) this.finishSeat(seat);
    }
    this.checkProgress();
    this.changed();
    return { ok: true, correct, oneAway };
  }

  hintsOf(seat) {
    return this.hints.get(seat) || { links: new Map(), count: 0, cost: 0 };
  }

  // Група для наступної підказки: серед незнайдених, де відомо менше трьох, — з найменшою кількістю відомих
  // (спершу пара в кожній групі, потім третій), за рівних — простіша. Остання незнайдена група й так очевидна.
  hintTarget(seat) {
    const mine = this.found.get(seat) || [];
    const open = this.puzzle.groups.map((_, i) => i).filter((i) => !mine.includes(i));
    if (open.length <= 1) return -1;
    const { links } = this.hintsOf(seat);
    const known = (i) => (links.get(i) || []).length;
    return open.filter((i) => known(i) < 3).sort((a, b) => known(a) - known(b) || a - b)[0] ?? -1;
  }

  hint(seat) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не можна', 'Not right now') };
    if (this.done(seat)) return { error: T('Ця головоломка для тебе вже закінчилась', 'This puzzle is already over for you') };
    const gi = this.hintTarget(seat);
    if (gi === -1) return { error: T('Підказок більше немає', 'No more hints') };
    const h = this.hintsOf(seat);
    const known = h.links.get(gi) || [];
    const rest = this.puzzle.groups[gi].players.map((p) => p.id).filter((id) => !known.includes(id));
    for (let k = known.length ? 1 : 2; k > 0; k--) known.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
    h.links.set(gi, known);
    h.count += 1;
    h.cost += h.count * HINT_STEP;
    this.hints.set(seat, h);
    this.touch();
    this.changed();
    return { ok: true };
  }

  giveUp(seat) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не можна', 'Not right now') };
    if (this.done(seat)) return { ok: true };
    this.gaveUp.add(seat);
    this.finishSeat(seat);
    this.touch();
    this.checkProgress();
    this.changed();
    return { ok: true };
  }

  // ── хід раунду: кінець, коли всі онлайн закінчили головоломку
  checkProgress() {
    const online = this.online();
    if (this.phase === 'guess') {
      if (online.length && online.every((i) => this.done(i))) this.endRound();
    } else if (this.phase === 'reveal') {
      if (this.allVotedNext()) this.nextRound();
    }
  }

  endRound() {
    if (this.phase !== 'guess') return;
    clearTimeout(this.timer);
    for (const i of this.presentSeats()) this.finishSeat(i); // не встиг — рахуємо те, що знайшов
    this.phase = 'reveal';
    this.deadline = null;
    this.history.push({ groups: this.puzzle.groups, results: Object.fromEntries(this.results) });
    if (!this.solo) {
      this.deadline = Date.now() + REVEAL_MS;
      this.timer = setTimeout(() => this.nextRound(), REVEAL_MS);
    }
    this.changed();
  }

  // Стан для всіх: поле (16 гравців) і чужий прогрес — лише кольори знайдених груп і помилки.
  publicState() {
    const progress = {};
    for (const i of this.presentSeats()) {
      progress[i] = {
        found: this.found.get(i) || [],
        mistakes: this.mistakes.get(i) || 0,
        hints: this.hintsOf(i).count,
        done: this.phase === 'guess' ? this.done(i) : true,
        result: this.results.get(i) || null,
      };
    }
    const state = {
      code: this.code,
      solo: this.solo,
      options: this.options,
      daily: this.options.daily ? { date: this.date, no: dailyNumber(this.date) } : null,
      points: { group: GROUP_POINTS, mistake: MISTAKE_PENALTY, perfect: PERFECT_BONUS, first: FIRST_BONUS, hint: HINT_STEP },
      capacity: this.capacity,
      seats: this.publicSeats(),
      host: this.host(),
      status: this.status,
      phase: this.phase,
      round: this.roundNo || 0,
      rounds: this.puzzles ? this.puzzles.length : this.options.rounds,
      board: this.puzzle ? this.puzzle.board.map(publicPlayer) : [],
      progress,
      nextVotes: [...this.nextVotes],
      scores: this.scores,
      deadline: this.deadline,
      serverNow: Date.now(),
      groups: this.phase === 'reveal' && this.puzzle ? this.puzzle.groups.map(publicGroup) : null,
      history: this.status === 'finished' ? this.history.map((h) => ({ groups: h.groups.map(publicGroup), results: h.results })) : [],
    };
    if (process.env.FOURS_TEST_ANSWER === '1' && this.puzzle) state.testAnswer = this.puzzle.groups.map((g) => g.players.map((p) => p.id));
    return state;
  }

  // Свої знайдені групи (з назвами) і спроби. Кольори спроб — лише коли головоломка для гравця закінчилась
  // (інакше кольори помилкових спроб підказали б, хто з ким в одній групі).
  privateState(seat) {
    const over = this.done(seat) || this.phase !== 'guess';
    return {
      myFound: (this.found.get(seat) || []).map((i) => publicGroup(this.puzzle.groups[i])),
      myMistakes: this.mistakes.get(seat) || 0,
      // підказки: зв'язки без номера групи (колір видав би рівень); знайдені групи — вже не потрібні
      myHints: [...this.hintsOf(seat).links].map(([gi, ids], k) => ({ k, gi, ids }))
        .filter((x) => !(this.found.get(seat) || []).includes(x.gi)).map(({ k, ids }) => ({ k, ids })),
      myHintCost: this.hintsOf(seat).cost,
      nextHint: this.puzzle && this.phase === 'guess' && !this.done(seat) && this.hintTarget(seat) !== -1 ? (this.hintsOf(seat).count + 1) * HINT_STEP : 0,
      myTries: (this.tries.get(seat) || []).map((t) => ({ key: t.key, correct: t.correct, colors: over ? t.colors : null })),
      myResult: this.results.get(seat) || null,
    };
  }
}

module.exports = { FoursRoom, kyivDate, dailyNumber, HINT_STEP, ALLOWED_MISTAKES, ALLOWED_TIMERS, ALLOWED_ROUNDS };
