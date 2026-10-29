// Партія «Правило рукостискань»: серія раундів. У кожному — старт і фініш; будуєш ланцюжок одноклубників від старту,
// поки не назвеш того, хто грав разом із фінішем. Кожен — у своєму темпі; чужий прогрес — лише кількість ланок.
// Ланку прибрати не можна; помилка — назвав того, хто з останнім у ланцюжку разом не грав. Соло — кімната на одного.
const { BaseRoom } = require('../../core/base-room');
const { linked, linkOf, shortestPath, distances, hintClub, makePair, LEVELS, playerById } = require('./graph');
const { T } = require('../../core/i18n');

const MAX_POINTS = 100;
const MIN_POINTS = 10; // дійшов — щонайменше стільки
const EXTRA_LINK = 20; // за кожну ланку понад найкоротший шлях
const MISTAKE_PENALTY = 10;
const HINT_COST = 15; // «через який клуб»
const LETTER_COST = 25; // перша літера прізвища наступної ланки — сильніша, тому дорожча
const FIRST_BONUS = 10; // у кімнаті — хто першим дійшов найкоротшим шляхом
const MAX_LINKS = 12; // довший ланцюжок — уже не рукостискання
const ALLOWED_MISTAKES = [3, 0]; // 0 — без обмеження
const ALLOWED_TIMERS = [0, 120, 180, 300];
const ALLOWED_ROUNDS = [3, 5, 10];
const MAX_PLAYERS = 8;
const REVEAL_MS = Number(process.env.HANDSHAKE_REVEAL_MS) || 12000;

function publicPlayer(p) {
  return { id: p.id, name: p.name, uk: p.uk, photo: p.photo };
}
// Ланцюжок словами: гравці й зв'язок кожного з попереднім (клуб, роки).
const chainOut = (ids) => ids.map((id, i) => ({ player: publicPlayer(playerById.get(id)), link: i ? linkOf(ids[i - 1], id) : null }));

class HandshakeRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, opts.solo ? 1 : MAX_PLAYERS);
    this.solo = !!opts.solo;
    this.options = {
      difficulty: LEVELS[opts.difficulty] ? opts.difficulty : 'normal',
      rounds: ALLOWED_ROUNDS.includes(Number(opts.rounds)) ? Number(opts.rounds) : 5,
      mistakes: ALLOWED_MISTAKES.includes(Number(opts.mistakes)) ? Number(opts.mistakes) : 3,
      turnSeconds: ALLOWED_TIMERS.includes(Number(opts.turnSeconds)) ? Number(opts.turnSeconds) : this.solo ? 0 : 180,
    };
    this.status = 'waiting'; // waiting | playing | finished
    this.scores = Array(this.capacity).fill(0);
    this.history = []; // [{ start, finish, best, results }]
    this.roundNo = 0;
    this.resetRound();
  }

  resetRound() {
    clearTimeout(this.timer);
    this.phase = null; // guess | reveal
    this.pair = null;
    this.chains = new Map(); // seat → [id…] від старту (фініш — останній, коли дійшов)
    this.mistakes = new Map(); // seat → кількість
    this.hints = new Map(); // seat → [{ after: id, kind: 'club', club, img, years } | { after: id, kind: 'letter', letter }]
    this.results = new Map(); // seat → { done, links, mistakes, hints, points, first }
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
    for (const m of [this.chains, this.mistakes, this.hints, this.results]) m.delete(seat);
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
    if (this.status === 'playing') return { error: T('Гра вже йде', 'The game is already on') };
    if (seat !== this.host()) return { error: T('Почати гру може той, хто її створив', 'Only the host can start the game') };
    return this.startSeries();
  }

  startSeries() {
    const avoid = new Set(); // кінці ланцюжків не повторюються за серію
    this.pairs = [];
    for (let i = 0; i < this.options.rounds; i++) {
      const pair = makePair(this.options.difficulty, avoid);
      if (!pair) break;
      avoid.add(pair.start.id).add(pair.finish.id);
      this.pairs.push(pair);
    }
    if (!this.pairs.length) return { error: T('Не вдалося підібрати пару — спробуй ще раз', "Couldn't find a pair — try again") };
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.roundNo = 0;
    this.status = 'playing';
    this.nextRound();
    return { ok: true };
  }

  nextRound() {
    this.resetRound();
    if (this.roundNo >= this.pairs.length) return this.finish();
    this.pair = this.pairs[this.roundNo++];
    this.toFinish = distances(this.pair.finish.id); // скільки кроків до фінішу від кожного — для «дійдеш найкоротшим — +N»
    this.best = shortestPath(this.pair.start.id, this.pair.finish.id);
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
  chainOf(seat) {
    if (!this.chains.has(seat)) this.chains.set(seat, [this.pair.start.id]);
    return this.chains.get(seat);
  }

  // Гравець закінчив: дійшов (done) — очки за довжину, помилки й підказки; ні (помилки, «здатися», час) — 0.
  finishSeat(seat, done) {
    if (this.results.has(seat)) return;
    const links = this.chainOf(seat).length - 1;
    const mistakes = this.mistakes.get(seat) || 0;
    const hints = (this.hints.get(seat) || []).length;
    const cost = this.hintCost(seat);
    let points = 0;
    let first = false;
    if (done) {
      const extra = links - this.pair.steps;
      points = Math.max(MIN_POINTS, MAX_POINTS - extra * EXTRA_LINK - mistakes * MISTAKE_PENALTY - cost);
      if (!this.solo && extra === 0 && !this.firstDone) {
        this.firstDone = true;
        first = true;
        points += FIRST_BONUS;
      }
    }
    this.scores[seat] += points;
    this.results.set(seat, { done, links, mistakes, hints, points, first });
  }

  // Наступна ланка: гравець, який грав разом з останнім у ланцюжку. Якщо він грав і з фінішем (або це сам фініш) — дійшов.
  add(seat, playerId) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не можна відповідати', "You can't answer right now") };
    if (this.done(seat)) return { error: T('Цей раунд для тебе вже закінчився', 'This round is already over for you') };
    const player = playerById.get(playerId);
    if (!player) return { error: T('Обери гравця зі списку', 'Pick a player from the list') };
    const chain = this.chainOf(seat);
    if (chain.includes(player.id)) return { error: T('Він уже є в ланцюжку', 'He is already in the chain') };
    const last = chain[chain.length - 1];
    const finish = this.pair.finish.id;
    this.touch();
    if (!linked(last, player.id)) {
      const m = (this.mistakes.get(seat) || 0) + 1;
      this.mistakes.set(seat, m);
      if (this.options.mistakes && m >= this.options.mistakes) this.finishSeat(seat, false);
      this.checkProgress();
      this.changed();
      return { ok: true, linked: false };
    }
    chain.push(player.id);
    let finished = player.id === finish;
    if (!finished && linked(player.id, finish)) {
      chain.push(finish);
      finished = true;
    }
    if (finished) this.finishSeat(seat, true);
    else if (chain.length - 1 >= MAX_LINKS) this.finishSeat(seat, false);
    this.checkProgress();
    this.changed();
    return { ok: true, linked: true, finished, link: linkOf(last, player.id) };
  }

  hintCost(seat) {
    return (this.hints.get(seat) || []).reduce((t, h) => t + (h.kind === 'letter' ? LETTER_COST : HINT_COST), 0);
  }

  // Скільки буде, якщо звідси дійти найкоротшим шляхом (без нових помилок і підказок).
  potential(seat) {
    const chain = this.chainOf(seat);
    const left = this.toFinish?.get(chain[chain.length - 1]);
    if (left == null) return null;
    const extra = Math.max(0, chain.length - 1 + left - this.pair.steps);
    return Math.max(MIN_POINTS, MAX_POINTS - extra * EXTRA_LINK - (this.mistakes.get(seat) || 0) * MISTAKE_PENALTY - this.hintCost(seat));
  }

  // Підказки для наступної ланки найкоротшого шляху від останнього в ланцюжку:
  // kind 'club' — через який клуб, 'letter' — перша літера прізвища того, хто там грав (shortestPath детермінований — той самий гравець).
  hint(seat, kind = 'club') {
    if (this.status !== 'playing' || this.phase !== 'guess' || this.done(seat)) return { error: T('Зараз не можна', 'Not right now') };
    if (kind !== 'letter') kind = 'club';
    const chain = this.chainOf(seat);
    const last = chain[chain.length - 1];
    const mine = this.hints.get(seat) || [];
    if (mine.some((h) => h.after === last && (h.kind || 'club') === kind)) return { error: T('Цю підказку ти вже взяв', 'You already took this hint') };
    const path = shortestPath(last, this.pair.finish.id);
    if (!path || path.length < 2) return { error: T('Від цього гравця до фінішу шляху немає', 'There is no way from this player to the finish') };
    if (kind === 'club') mine.push({ after: last, kind, ...hintClub(last, this.pair.finish.id) });
    else {
      const p = playerById.get(path[1]);
      const initial = (name) => { const w = String(name || '').trim().split(/\s+/); return (w.length > 1 ? w.slice(1).join(' ') : w[0]).charAt(0).toUpperCase(); };
      mine.push({ after: last, kind, letter: T(initial(p.uk || p.name), initial(p.name)) });
    }
    this.hints.set(seat, mine);
    this.touch();
    this.changed();
    return { ok: true };
  }

  giveUp(seat) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не можна', 'Not right now') };
    if (this.done(seat)) return { ok: true };
    this.finishSeat(seat, false);
    this.touch();
    this.checkProgress();
    this.changed();
    return { ok: true };
  }

  next(seat) {
    if (this.status !== 'playing' || this.phase !== 'reveal') return { error: T('Раунд ще йде', 'The round is still on') };
    this.nextVotes.add(seat);
    this.checkProgress();
    if (this.phase === 'reveal') this.changed();
    return { ok: true };
  }

  // ── хід раунду: кінець, коли всі онлайн закінчили
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
    for (const i of this.presentSeats()) this.finishSeat(i, false); // не встиг — 0
    this.phase = 'reveal';
    this.deadline = null;
    this.history.push({ start: this.pair.start, finish: this.pair.finish, best: this.best, results: Object.fromEntries(this.results) });
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

  // Стан для всіх: старт, фініш, скільки кроків у найкоротшому; чужий прогрес — лише кількість ланок і помилок.
  publicState() {
    const reveal = this.phase === 'reveal';
    const progress = {};
    for (const i of this.presentSeats()) {
      progress[i] = {
        links: this.pair ? this.chainOf(i).length - 1 : 0,
        mistakes: this.mistakes.get(i) || 0,
        done: this.phase === 'guess' ? this.done(i) : true,
        result: this.results.get(i) || null,
        chain: reveal ? chainOut(this.chainOf(i)) : null, // після раунду — усі ланцюжки
      };
    }
    const state = {
      code: this.code,
      solo: this.solo,
      options: this.options,
      points: { max: MAX_POINTS, min: MIN_POINTS, extra: EXTRA_LINK, mistake: MISTAKE_PENALTY, hint: HINT_COST, letter: LETTER_COST, first: FIRST_BONUS },
      capacity: this.capacity,
      seats: this.publicSeats(),
      host: this.host(),
      status: this.status,
      phase: this.phase,
      round: this.roundNo || 0,
      rounds: this.pairs ? this.pairs.length : this.options.rounds,
      start: this.pair ? publicPlayer(this.pair.start) : null,
      finish: this.pair ? publicPlayer(this.pair.finish) : null,
      steps: this.pair ? this.pair.steps : null,
      progress,
      nextVotes: [...this.nextVotes],
      scores: this.scores,
      deadline: this.deadline,
      serverNow: Date.now(),
      best: reveal && this.best ? chainOut(this.best) : null,
      history: this.status === 'finished'
        ? this.history.map((h) => ({ start: publicPlayer(h.start), finish: publicPlayer(h.finish), best: chainOut(h.best), results: h.results }))
        : [],
    };
    if (process.env.HANDSHAKE_TEST_ANSWER === '1' && this.best) state.testAnswer = this.best;
    return state;
  }

  privateState(seat) {
    if (!this.pair) return { myChain: [], myMistakes: 0, myHints: [], myResult: null };
    return {
      myChain: chainOut(this.chainOf(seat)),
      myMistakes: this.mistakes.get(seat) || 0,
      myHints: this.hints.get(seat) || [],
      myPotential: this.done(seat) || this.phase !== 'guess' ? null : this.potential(seat),
      myResult: this.results.get(seat) || null,
    };
  }
}

module.exports = { HandshakeRoom, MAX_LINKS, ALLOWED_MISTAKES, ALLOWED_TIMERS, ALLOWED_ROUNDS };
