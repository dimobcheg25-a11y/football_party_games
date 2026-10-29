// Партія «Складу матчу»: серія раундів, у кожному — легендарний матч, обидві команди на полі (номери, прапори / клуби гравців,
// голи, капітан), тренери й (за бажанням) заміни. Називаєш футболіста або тренера — він стає на своє місце.
// Очки: 4 за гравця, кожна підказка на ньому (вік, кількість літер, перша літера) — мінус 1 (усі три — 1 очко).
// Режими кімнати (як у «Топ-10»): own — кожен свій склад (чужих відповідей не видно), turns — спільний по черзі з життями.
// Раунд закінчується, коли всі онлайн натиснули «Досить» (або все відгадали / вичерпали життя / вийшов час) — знайдене лишається.
const { T } = require('../../core/i18n');
const { playerById, normalize } = require('../../data');
const { BaseRoom } = require('../../core/base-room');
const { matches, matchesFor, CATEGORIES, LEVELS } = require('./matches');

const MAX_PLAYERS = 8;
const POINTS = 4;
const HINTS = ['age', 'letters', 'first'];
const ALLOWED_LIVES = [0, 3, 5, 10];
const ALLOWED_ROUND_SECONDS = [0, 180, 300, 600];
const ALLOWED_TURN_SECONDS = [0, 20, 30, 60];
const ALLOWED_ROUNDS = [3, 5, 10];
const NOT_NOW = T('Зараз не можна', 'Not right now');

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const publicPlayer = (p) => ({ id: p.id, name: p.name, uk: p.uk, photo: p.photo });

class LineupRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, opts.solo ? 1 : MAX_PLAYERS);
    this.solo = !!opts.solo;
    const categories = (Array.isArray(opts.categories) ? opts.categories : []).filter((c) => CATEGORIES[c]);
    const mode = !this.solo && opts.mode === 'turns' ? 'turns' : 'own';
    let lives = ALLOWED_LIVES.includes(Number(opts.lives)) ? Number(opts.lives) : 5;
    if (mode === 'turns' && !lives) lives = 5; // по черзі без життів раунд не закінчився б сам
    this.options = {
      categories: categories.length ? [...new Set(categories)] : Object.keys(CATEGORIES),
      level: LEVELS.includes(opts.level) ? opts.level : 'mix',
      subs: opts.subs !== false, // заміни на полі — за замовчуванням так
      mode,
      lives,
      roundSeconds: ALLOWED_ROUND_SECONDS.includes(Number(opts.roundSeconds)) ? Number(opts.roundSeconds) : this.solo ? 0 : 300,
      turnSeconds: ALLOWED_TURN_SECONDS.includes(Number(opts.turnSeconds)) ? Number(opts.turnSeconds) : 30,
      rounds: ALLOWED_ROUNDS.includes(Number(opts.rounds)) ? Number(opts.rounds) : 5,
    };
    this.status = 'waiting';
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.used = new Set();
    this.resetRound();
  }

  resetRound() {
    clearTimeout(this.timer);
    this.phase = null; // guess | reveal
    this.match = null;
    this.slots = []; // плоский список місць: склад обох команд, заміни (якщо ввімкнено), тренери
    this.roundPoints = {};
    this.nextVotes = new Set();
    this.finishVotes = new Set();
    this.deadline = null;
    this.boards = new Map(); // own: seat → { found: Set(key), wrong: [id], hints: Map(key → Set), done }
    this.found = new Map(); // turns: key → seat
    this.sharedHints = new Map(); // turns: key → Set(kind)
    this.wrong = []; // turns: [{ seat, id }]
    this.lives = new Map();
    this.order = [];
    this.turn = -1;
  }

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
    } else this.changed();
    return { seat };
  }

  leave(seat) {
    this.seats[seat] = null;
    this.boards.delete(seat);
    this.finishVotes.delete(seat);
    this.touch();
    if (this.status === 'playing') {
      if (this.options.mode === 'turns' && this.phase === 'guess' && this.order[this.turn] === seat) this.nextTurn();
      this.checkProgress();
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

  // ── серія
  pool() {
    const fit = matchesFor(this.options.categories);
    const leveled = this.options.level === 'mix' ? fit : fit.filter((m) => m.level === this.options.level);
    return leveled.length ? leveled : fit; // такого рівня в цих категоріях немає — будь-які
  }

  start(seat) {
    if (this.status === 'playing') return { error: T('Гра вже йде', 'The game is already on') };
    if (seat !== this.host()) return { error: T('Почати гру може той, хто її створив', 'Only the room creator can start the game') };
    return this.startSeries();
  }

  startSeries() {
    if (!this.pool().length) return { error: T('Немає матчів для цих налаштувань', 'No matches for these settings') };
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.roundNo = 0;
    this.status = 'playing';
    this.nextRound();
    return { ok: true };
  }

  randomMatch() {
    const all = this.pool();
    const fresh = all.filter((m) => !this.used.has(m.id));
    return pick(fresh.length ? fresh : all);
  }

  nextRound() {
    this.resetRound();
    if (this.roundNo >= this.options.rounds) return this.finish();
    this.roundNo++;
    this.beginRound(this.randomMatch());
  }

  beginRound(match) {
    this.match = match;
    this.used.add(match.id);
    this.slots = match.teams.flatMap((t, k) => [
      ...t.xi.map((s) => ({ ...s, team: k })),
      ...(this.options.subs ? t.bench.map((s) => ({ ...s, team: k })) : []),
      ...(t.coach ? [{ ...t.coach, team: k }] : []),
    ]);
    this.phase = 'guess';
    if (this.options.mode === 'turns') {
      const present = this.presentSeats();
      const shift = (this.roundNo - 1) % Math.max(1, present.length);
      this.order = [...present.slice(shift), ...present.slice(0, shift)];
      for (const s of this.order) this.lives.set(s, this.options.lives);
      this.turn = -1;
      this.nextTurn();
    } else {
      const sec = this.options.roundSeconds;
      this.deadline = sec ? Date.now() + sec * 1000 : null;
      if (sec) this.timer = setTimeout(() => this.endRound(), sec * 1000);
    }
    this.changed();
  }

  // місця, які ще треба відгадати (кого немає в базі — відкриті одразу)
  open() {
    return this.slots.filter((s) => !s.missing);
  }

  board(seat) {
    if (!this.boards.has(seat)) this.boards.set(seat, { found: new Set(), wrong: [], hints: new Map(), done: false });
    return this.boards.get(seat);
  }

  hintsOn(seat, key) {
    return this.options.mode === 'turns' ? this.sharedHints.get(key) : this.boards.get(seat)?.hints.get(key);
  }

  valueOf(seat, key) {
    return Math.max(1, POINTS - (this.hintsOn(seat, key)?.size || 0));
  }

  // ── відповідь: гравець (playerId) або тренер (coachKey — з /api/lineup/coaches)
  guess(seat, { playerId, coachKey } = {}) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не можна відповідати', 'You can’t answer right now') };
    const player = playerId ? playerById.get(playerId) : null;
    if (!player && !coachKey) return { error: T('Обери гравця або тренера зі списку', 'Pick a player or a coach from the list') };
    const turns = this.options.mode === 'turns';
    if (turns && this.order[this.turn] !== seat) return { error: T('Зараз не твій хід', 'It’s not your turn') };
    const b = turns ? null : this.board(seat);
    if (b?.done) return { error: T('Ти вже закінчив цей раунд', 'You’ve already finished this round') };
    const id = player ? player.id : `coach:${coachKey}`;
    const wrongBefore = turns ? this.wrong.some((w) => w.id === id) : b.wrong.includes(id);
    if (wrongBefore) return { error: T('Його вже називали — у цьому матчі він не грав', 'Already named — he didn’t play in this match') };
    const hit = this.open().filter((s) => (player && s.pid === player.id) || (coachKey && s.coach && s.coachKey === coachKey));
    const fresh = hit.filter((s) => (turns ? !this.found.has(s.key) : !b.found.has(s.key)));
    if (hit.length && !fresh.length) return { error: T('Він уже на полі', 'Already on the pitch') };
    this.touch();
    let res;
    if (fresh.length) {
      const pts = fresh.reduce((sum, s) => sum + this.valueOf(seat, s.key), 0);
      for (const s of fresh) (turns ? this.found.set(s.key, seat) : b.found.add(s.key));
      this.scores[seat] += pts;
      this.roundPoints[seat] = (this.roundPoints[seat] || 0) + pts;
      res = { ok: true, correct: true, points: pts, keys: fresh.map((s) => s.key) };
      if (!turns && b.found.size === this.open().length) b.done = true;
    } else {
      if (turns) {
        this.wrong.push({ seat, id });
        this.lives.set(seat, Math.max(0, (this.lives.get(seat) || 0) - 1));
      } else {
        b.wrong.push(id);
        if (this.options.lives && b.wrong.length >= this.options.lives) b.done = true;
      }
      res = { ok: true, correct: false };
    }
    if (turns) {
      if (this.found.size === this.open().length) this.endRound();
      else this.nextTurn();
    } else this.checkProgress();
    this.changed();
    return res;
  }

  // Підказка на конкретне місце (обирає гравець): вік на момент матчу, кількість літер у прізвищі, перша літера.
  hint(seat, { key, kind } = {}) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: NOT_NOW };
    const slot = this.slots.find((s) => s.key === key);
    if (!slot || slot.missing || !HINTS.includes(kind)) return { error: T('Такої підказки немає', 'No such hint') };
    if (kind === 'age' && slot.age == null) return { error: T('Вік невідомий', 'Age unknown') };
    const turns = this.options.mode === 'turns';
    if (turns && this.order[this.turn] !== seat) return { error: T('Підказку бере той, чий хід', 'Only the player whose turn it is can take a hint') };
    if (turns ? this.found.has(key) : this.board(seat).found.has(key)) return { error: T('Він уже відгаданий', 'Already guessed') };
    if (!turns && this.board(seat).done) return { error: NOT_NOW };
    const map = turns ? this.sharedHints : this.board(seat).hints;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(kind);
    this.touch();
    this.changed();
    return { ok: true };
  }

  pass(seat) {
    if (this.options.mode !== 'turns' || this.phase !== 'guess' || this.order[this.turn] !== seat) return { error: T('Зараз не твій хід', 'It’s not your turn') };
    this.wrong.push({ seat, id: null });
    this.lives.set(seat, Math.max(0, (this.lives.get(seat) || 0) - 1));
    this.nextTurn();
    this.changed();
    return { ok: true };
  }

  nextTurn() {
    clearTimeout(this.timer);
    const n = this.order.length;
    for (let k = 1; k <= n; k++) {
      const s = this.order[(this.turn + k) % n];
      if (this.seats[s]?.connected && this.lives.get(s) > 0) {
        this.turn = (this.turn + k) % n;
        const sec = this.options.turnSeconds;
        this.deadline = sec ? Date.now() + sec * 1000 : null;
        if (sec) this.timer = setTimeout(() => this.pass(this.order[this.turn]), sec * 1000);
        return;
      }
    }
    this.endRound();
  }

  // «Досить» — більше нікого не згадаю: раунд закінчується, коли так скажуть усі онлайн; знайдене лишається.
  finishRound(seat) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: NOT_NOW };
    this.finishVotes.add(seat);
    this.checkProgress();
    if (this.phase === 'guess') this.changed();
    return { ok: true };
  }

  canSkip() {
    if (this.status !== 'playing' || this.phase !== 'guess') return false;
    return !this.wrong.length && !this.found.size && !this.sharedHints.size
      && ![...this.boards.values()].some((b) => b.found.size || b.wrong.length || b.hints.size || b.done);
  }

  skipMatch(seat) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: NOT_NOW };
    if (seat !== this.host()) return { error: T('Інший матч може обрати господар кімнати', 'Only the host can skip the match') };
    if (!this.canSkip()) return { error: T('Матч уже почали вгадувати — замінити не вийде', 'Someone has already started on this match — it can’t be swapped') };
    this.resetRound();
    this.beginRound(this.randomMatch());
    return { ok: true };
  }

  next(seat) {
    if (this.status !== 'playing' || this.phase !== 'reveal') return { error: T('Раунд ще йде', 'The round is still on') };
    this.nextVotes.add(seat);
    this.checkProgress();
    if (this.phase === 'reveal') this.changed();
    return { ok: true };
  }

  checkProgress() {
    const online = this.presentSeats().filter((i) => this.seats[i].connected);
    if (!online.length) return;
    if (this.phase === 'guess') {
      if (online.every((i) => this.finishVotes.has(i) || (this.options.mode === 'own' && this.board(i).done))) this.endRound();
      else if (this.options.mode === 'turns' && !this.seats[this.order[this.turn]]?.connected) this.nextTurn();
    } else if (this.phase === 'reveal') {
      if (online.every((i) => this.nextVotes.has(i))) this.nextRound();
    }
  }

  endRound() {
    if (this.phase !== 'guess') return;
    clearTimeout(this.timer);
    this.phase = 'reveal';
    this.deadline = null;
    this.history.push({ title: this.match.title, results: { ...this.roundPoints } });
    this.changed();
  }

  finish() {
    clearTimeout(this.timer);
    this.status = 'finished';
    this.phase = null;
    this.deadline = null;
    this.changed();
  }

  // ── стан
  revealOf(s) {
    if (s.coach) return { coach: true, name: s.name, photo: s.photo || null };
    return { name: s.name, photo: s.photo || null, id: s.pid || null };
  }

  hintTexts(set, s) {
    if (!set?.size) return null;
    const out = {};
    for (const k of set) out[k] = s[k];
    return out;
  }

  publicSlot(s) {
    const turns = this.options.mode === 'turns';
    const reveal = this.phase === 'reveal';
    const base = {
      key: s.key, num: s.num ?? null, pos: s.pos || null, x: s.x, y: s.y, flag: s.flag || null, club: s.club || null,
      capt: !!s.capt, goals: s.goals || [], off: s.off || null, on: s.on || null, for: s.for ?? null, sub: !!s.sub, coach: !!s.coach,
      missing: !!s.missing, canAge: s.age != null,
    };
    if (reveal || s.missing || (turns && this.found.has(s.key))) {
      base.answer = this.revealOf(s);
      base.by = turns ? (this.found.has(s.key) ? [this.found.get(s.key)] : [])
        : [...this.boards].filter(([, b]) => b.found.has(s.key)).map(([seat]) => seat);
    }
    if (turns) base.hints = this.hintTexts(this.sharedHints.get(s.key), s);
    if (reveal) base.age = s.age;
    return base;
  }

  publicState() {
    const m = this.match;
    const turns = this.options.mode === 'turns';
    const slotsOf = (k, list) => list.map((s) => this.publicSlot(this.slots.find((x) => x.key === s.key) || { ...s, team: k })).filter(Boolean);
    const progress = {};
    if (!turns) {
      for (const i of this.presentSeats()) {
        const b = this.boards.get(i);
        progress[i] = { found: b ? b.found.size : 0, wrong: b ? b.wrong.length : 0, done: b ? b.done : false };
      }
    }
    const state = {
      code: this.code,
      solo: this.solo,
      options: this.options,
      capacity: this.capacity,
      seats: this.publicSeats(),
      host: this.host(),
      status: this.status,
      phase: this.phase,
      round: this.roundNo || 0,
      rounds: this.options.rounds,
      match: m ? {
        id: m.id, title: m.title, date: m.date, venue: m.venue, score: m.score, aet: m.aet, pens: m.pens, aggregate: m.aggregate, level: m.level,
        teams: m.teams.map((t, k) => ({
          name: t.name, img: t.img, kit: t.kit, national: t.national,
          xi: slotsOf(k, t.xi),
          bench: this.options.subs ? slotsOf(k, t.bench) : [],
          coach: t.coach ? this.publicSlot(this.slots.find((x) => x.key === t.coach.key)) : null,
        })),
      } : null,
      total: this.open().length,
      points: POINTS,
      progress,
      order: this.order,
      active: turns && this.phase === 'guess' ? this.order[this.turn] ?? -1 : -1,
      lives: Object.fromEntries(this.lives),
      wrong: turns ? this.wrong.map((w) => ({ seat: w.seat, player: this.wrongPlayer(w.id) })) : [],
      found: turns ? this.found.size : null,
      roundPoints: this.roundPoints,
      finishVotes: [...this.finishVotes],
      canSkip: this.canSkip(),
      nextVotes: [...this.nextVotes],
      scores: this.scores,
      deadline: this.deadline,
      serverNow: Date.now(),
      history: this.status === 'finished' ? this.history : [],
    };
    if (process.env.LINEUP_TEST_ANSWER === '1' && m) {
      state.testAnswer = this.open().map((s) => ({ key: s.key, playerId: s.coach ? null : s.pid, coachKey: s.coach ? s.coachKey : null }));
    }
    return state;
  }

  wrongPlayer(id) {
    if (!id) return null;
    if (id.startsWith('coach:')) {
      const key = id.slice(6);
      const c = matches.flatMap((x) => x.teams.map((t) => t.coach)).find((x) => x && x.coachKey === key);
      return c ? { name: c.name, coach: true } : null;
    }
    const p = playerById.get(id);
    return p ? publicPlayer(p) : null;
  }

  // own: свої знайдені, підказки й помилки бачить лише сам гравець
  privateState(seat) {
    if (this.options.mode !== 'own' || !this.match) return { mine: null };
    const b = this.board(seat);
    const hints = {};
    for (const [key, set] of b.hints) hints[key] = this.hintTexts(set, this.slots.find((s) => s.key === key));
    return {
      mine: {
        found: [...b.found].map((key) => ({ key, ...this.revealOf(this.slots.find((s) => s.key === key)) })),
        hints,
        wrong: b.wrong.map((id) => this.wrongPlayer(id)).filter(Boolean),
        done: b.done,
        livesLeft: this.options.lives ? Math.max(0, this.options.lives - b.wrong.length) : null,
      },
    };
  }
}

module.exports = { LineupRoom, POINTS, HINTS, normalize };
