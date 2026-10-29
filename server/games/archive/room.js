// Партія «Фотоархіву»: серія раундів, у кожному — матчеве фото з Commons, закрите сіткою 5×5. Гравці відкривають квадратики
// й називають, хто на фото. Загадано лише позначених на Commons гравців з пулу рівня (скільки — видно одразу).
// Очки за кожного відгаданого: 100 − 4 × відкритих квадратиків (не менше 10).
// Відповідь: загаданий — очки; «міг бути на кадрі» (грав тоді за ту саму команду) — нейтрально, перші 3 на фото без штрафу,
// далі як помилка; помилка — own: відкривається ще 1 квадратик, turns: просто кінець ходу.
// Режими кімнати: own — кожен свою сітку (свої квадратики й відповіді — у privateState), turns — спільна сітка по черзі:
// у свій хід відкрий 1 квадратик і назви когось (або пас).
const { T } = require('../../core/i18n');
const { playerById } = require('../../data');
const { BaseRoom } = require('../../core/base-room');
const { shotsFor, targetsOf, maybeOnShot, LEVELS, CATEGORIES } = require('./shots');

const MAX_PLAYERS = 8;
const TILES = 25;
const FREE_NEUTRAL = 3;
const ALLOWED_ROUNDS = [5, 10, 15];
const ALLOWED_ROUND_SECONDS = [0, 60, 120, 180];
const ALLOWED_TURN_SECONDS = [0, 20, 30, 60];
const NOT_NOW = T('Зараз не можна', 'Not right now');

const worth = (opened) => Math.max(10, 100 - 4 * opened);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const publicPlayer = (p) => ({ id: p.id, name: p.name, uk: p.uk, photo: p.photo });

class ArchiveRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, opts.solo ? 1 : MAX_PLAYERS);
    this.solo = !!opts.solo;
    this.options = {
      category: CATEGORIES.includes(opts.category) ? opts.category : 'all',
      level: LEVELS.includes(opts.level) ? opts.level : 'easy',
      mode: !this.solo && opts.mode === 'turns' ? 'turns' : 'own',
      rounds: ALLOWED_ROUNDS.includes(Number(opts.rounds)) ? Number(opts.rounds) : 10,
      roundSeconds: ALLOWED_ROUND_SECONDS.includes(Number(opts.roundSeconds)) ? Number(opts.roundSeconds) : this.solo ? 0 : 120,
      turnSeconds: ALLOWED_TURN_SECONDS.includes(Number(opts.turnSeconds)) ? Number(opts.turnSeconds) : 30,
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
    this.shot = null;
    this.targets = [];
    this.roundPoints = {};
    this.nextVotes = new Set();
    this.finishVotes = new Set();
    this.deadline = null;
    this.boards = new Map(); // own: seat → { open: Set, found: Map(id → очки), neutral: [id], wrong: [id], done }
    this.open = new Set(); // turns: спільні відкриті квадратики
    this.found = new Map(); // turns: id → { seat, points }
    this.named = []; // turns: [{ seat, id, kind: 'neutral' | 'wrong' | 'pass' }]
    this.order = [];
    this.turn = -1;
    this.turnOpened = false;
    this.turnsAfterAll = 0; // ходів після того, як відкрито всю сітку
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
    return shotsFor(this.options.category, this.options.level);
  }

  start(seat) {
    if (this.status === 'playing') return { error: T('Гра вже йде', 'The game is already on') };
    if (seat !== this.host()) return { error: T('Почати гру може той, хто її створив', 'Only the room creator can start the game') };
    return this.startSeries();
  }

  startSeries() {
    if (!this.pool().length) return { error: T('Немає фото для цих налаштувань', 'No photos for these settings') };
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.roundNo = 0;
    this.status = 'playing';
    this.nextRound();
    return { ok: true };
  }

  randomShot() {
    const all = this.pool();
    const fresh = all.filter((s) => !this.used.has(s.id) && s.id !== this.shot?.id);
    return pick(fresh.length ? fresh : all);
  }

  nextRound() {
    this.resetRound();
    if (this.roundNo >= this.options.rounds) return this.finish();
    this.roundNo++;
    this.beginRound(this.randomShot());
  }

  beginRound(shot) {
    this.shot = shot;
    this.targets = targetsOf(shot, this.options.level);
    this.used.add(shot.id);
    this.phase = 'guess';
    if (this.options.mode === 'turns') {
      const present = this.presentSeats();
      const shift = (this.roundNo - 1) % Math.max(1, present.length);
      this.order = [...present.slice(shift), ...present.slice(0, shift)];
      this.turn = -1;
      this.nextTurn();
    } else {
      const sec = this.options.roundSeconds;
      this.deadline = sec ? Date.now() + sec * 1000 : null;
      if (sec) this.timer = setTimeout(() => this.endRound(), sec * 1000);
    }
    this.changed();
  }

  board(seat) {
    if (!this.boards.has(seat)) this.boards.set(seat, { open: new Set(), found: new Map(), neutral: [], wrong: [], done: false });
    return this.boards.get(seat);
  }

  openRandom(set) {
    const closed = [];
    for (let i = 0; i < TILES; i++) if (!set.has(i)) closed.push(i);
    if (closed.length) set.add(pick(closed));
  }

  // ── відкрити квадратик
  openTile(seat, { tile } = {}) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: NOT_NOW };
    const i = Number(tile);
    if (!Number.isInteger(i) || i < 0 || i >= TILES) return { error: T('Такого квадратика немає', 'No such tile') };
    if (this.options.mode === 'turns') {
      if (this.order[this.turn] !== seat) return { error: T('Зараз не твій хід', 'It’s not your turn') };
      if (this.turnOpened) return { error: T('За хід можна відкрити лише один квадратик. Тепер назви гравця або пасуй', 'Only one tile per turn. Now name a player or pass') };
      if (this.open.has(i)) return { error: T('Він уже відкритий', 'Already open') };
      this.open.add(i);
      this.turnOpened = true;
    } else {
      const b = this.board(seat);
      if (b.done) return { error: NOT_NOW };
      b.open.add(i);
    }
    this.touch();
    this.changed();
    return { ok: true };
  }

  // ── відповідь
  guess(seat, { playerId } = {}) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не можна відповідати', 'You can’t answer right now') };
    const p = playerById.get(playerId);
    if (!p) return { error: T('Обери гравця зі списку', 'Pick a player from the list') };
    const turns = this.options.mode === 'turns';
    if (turns) {
      if (this.order[this.turn] !== seat) return { error: T('Зараз не твій хід', 'It’s not your turn') };
      if (!this.turnOpened && this.open.size < TILES) return { error: T('Спершу відкрий один квадратик', 'Open one tile first') };
      if (this.found.has(p.id)) return { error: T('Його вже відгадали', 'Already guessed') };
      if (this.named.some((n) => n.id === p.id)) return { error: T('Його вже називали', 'Already named') };
    }
    const b = turns ? null : this.board(seat);
    if (b) {
      if (b.done) return { error: T('Ти вже закінчив це фото', 'You’ve already finished this photo') };
      if (b.found.has(p.id)) return { error: T('Його вже відгадано', 'Already guessed') };
      if (b.neutral.includes(p.id) || b.wrong.includes(p.id)) return { error: T('Його вже називали', 'Already named') };
    }
    this.touch();
    let res;
    if (this.targets.includes(p.id)) {
      const points = worth(turns ? this.open.size : b.open.size);
      if (turns) this.found.set(p.id, { seat, points });
      else b.found.set(p.id, points);
      this.scores[seat] += points;
      this.roundPoints[seat] = (this.roundPoints[seat] || 0) + points;
      res = { ok: true, result: 'hit', points };
      if (b && b.found.size === this.targets.length) b.done = true;
    } else if (maybeOnShot(this.shot, p)) {
      const used = turns ? this.named.filter((n) => n.seat === seat && n.kind === 'neutral').length : b.neutral.length;
      const free = used < FREE_NEUTRAL;
      if (turns) this.named.push({ seat, id: p.id, kind: 'neutral' });
      else {
        b.neutral.push(p.id);
        if (!free) this.openRandom(b.open);
      }
      res = { ok: true, result: 'neutral', free, left: Math.max(0, FREE_NEUTRAL - used - 1) };
    } else {
      if (turns) this.named.push({ seat, id: p.id, kind: 'wrong' });
      else {
        b.wrong.push(p.id);
        this.openRandom(b.open);
      }
      res = { ok: true, result: 'miss' };
    }
    if (turns) {
      if (this.found.size === this.targets.length) this.endRound();
      else this.nextTurn();
    } else this.checkProgress();
    this.changed();
    return res;
  }

  pass(seat) {
    if (this.options.mode !== 'turns' || this.phase !== 'guess' || this.order[this.turn] !== seat) return { error: T('Зараз не твій хід', 'It’s not your turn') };
    this.named.push({ seat, id: null, kind: 'pass' });
    this.nextTurn();
    this.changed();
    return { ok: true };
  }

  nextTurn() {
    clearTimeout(this.timer);
    if (this.open.size >= TILES && this.turn >= 0 && ++this.turnsAfterAll > this.order.length) return this.endRound();
    const n = this.order.length;
    for (let k = 1; k <= n; k++) {
      const s = this.order[(this.turn + k) % n];
      if (this.seats[s]?.connected) {
        this.turn = (this.turn + k) % n;
        this.turnOpened = false;
        const sec = this.options.turnSeconds;
        this.deadline = sec ? Date.now() + sec * 1000 : null;
        if (sec) this.timer = setTimeout(() => this.timeUp(), sec * 1000);
        return;
      }
    }
    this.endRound();
  }

  // час ходу вийшов: якщо квадратик не відкрив — відкриваємо за нього випадковий, хід переходить
  timeUp() {
    if (this.phase !== 'guess') return;
    if (!this.turnOpened) this.openRandom(this.open);
    this.pass(this.order[this.turn]);
  }

  // own: «Здаюсь» — моє фото закрито (знайдене лишається); turns: «Досить» — раунд закінчується, коли так скажуть усі онлайн
  finishRound(seat) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: NOT_NOW };
    if (this.options.mode === 'own') this.board(seat).done = true;
    else this.finishVotes.add(seat);
    this.checkProgress();
    if (this.phase === 'guess') this.changed();
    return { ok: true };
  }

  canSkip() {
    if (this.status !== 'playing' || this.phase !== 'guess') return false;
    return !this.open.size && !this.found.size && !this.named.length
      && ![...this.boards.values()].some((b) => b.open.size || b.found.size || b.neutral.length || b.wrong.length || b.done);
  }

  skipShot(seat) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: NOT_NOW };
    if (seat !== this.host()) return { error: T('Інше фото може обрати господар кімнати', 'Only the host can swap the photo') };
    if (!this.canSkip()) return { error: T('Фото вже почали відкривати — замінити не вийде', 'Someone has already started on this photo — it can’t be swapped') };
    const next = this.randomShot();
    this.resetRound();
    this.beginRound(next);
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
      if (this.options.mode === 'own' ? online.every((i) => this.board(i).done) : online.every((i) => this.finishVotes.has(i))) this.endRound();
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
    this.history.push({ title: this.caption(), results: { ...this.roundPoints } });
    this.changed();
  }

  finish() {
    clearTimeout(this.timer);
    this.status = 'finished';
    this.phase = null;
    this.deadline = null;
    this.changed();
  }

  // підпис фото для підсумку: хто загаданий і рік
  caption() {
    const names = this.targets.map((id) => playerById.get(id)).filter(Boolean);
    const uk = names.map((p) => p.uk || p.name).join(', ');
    const en = names.map((p) => p.name).join(', ');
    return this.shot.year ? T(`${uk} · ${this.shot.year}`, `${en} · ${this.shot.year}`) : T(uk, en);
  }

  // ── стан
  publicState() {
    const s = this.shot;
    const turns = this.options.mode === 'turns';
    const reveal = this.phase === 'reveal';
    const progress = {};
    if (!turns) {
      for (const i of this.presentSeats()) {
        const b = this.boards.get(i);
        progress[i] = { open: b ? b.open.size : 0, found: b ? b.found.size : 0, done: b ? b.done : false };
      }
    }
    const foundBy = (id) => (turns ? (this.found.has(id) ? [this.found.get(id).seat] : [])
      : [...this.boards].filter(([, b]) => b.found.has(id)).map(([seat]) => seat));
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
      tiles: TILES,
      freeNeutral: FREE_NEUTRAL,
      // фото — через наш сервер (/api/archive/img/:id): у назві файлу Commons часто є імена гравців
      shot: s ? {
        id: s.id, img: `/api/archive/img/${s.id}`, w: s.w, h: s.h, legend: s.legend, count: this.targets.length,
        ...(reveal ? {
          year: s.year, desc: s.desc, author: s.author, license: s.license, page: s.page, file: s.file,
          targets: this.targets.map((id) => ({ ...publicPlayer(playerById.get(id)), by: foundBy(id) })),
          others: s.who.filter((id) => !this.targets.includes(id) && playerById.has(id)).map((id) => publicPlayer(playerById.get(id))), // гравців росії/білорусі в базі немає
        } : {}),
      } : null,
      open: turns ? [...this.open] : null,
      worth: turns ? worth(this.open.size) : null,
      progress,
      order: this.order,
      active: turns && this.phase === 'guess' ? this.order[this.turn] ?? -1 : -1,
      turnOpened: this.turnOpened,
      found: turns ? [...this.found].map(([id, f]) => ({ ...publicPlayer(playerById.get(id)), seat: f.seat, points: f.points })) : null,
      named: turns ? this.named.map((n) => ({ seat: n.seat, kind: n.kind, player: n.id ? publicPlayer(playerById.get(n.id)) : null })) : [],
      roundPoints: this.roundPoints,
      finishVotes: [...this.finishVotes],
      canSkip: this.canSkip(),
      nextVotes: [...this.nextVotes],
      scores: this.scores,
      deadline: this.deadline,
      serverNow: Date.now(),
      history: this.status === 'finished' ? this.history : [],
    };
    if (process.env.ARCHIVE_TEST_ANSWER === '1' && s) state.testAnswer = { targets: this.targets, others: s.who.filter((id) => !this.targets.includes(id)) };
    return state;
  }

  // own: свої квадратики, знайдені й названі бачить лише сам гравець
  privateState(seat) {
    if (this.options.mode !== 'own' || !this.shot) return { mine: null };
    const b = this.board(seat);
    const pub = (id) => publicPlayer(playerById.get(id));
    return {
      mine: {
        open: [...b.open],
        worth: worth(b.open.size),
        found: [...b.found].map(([id, points]) => ({ ...pub(id), points })),
        neutral: b.neutral.map(pub),
        wrong: b.wrong.map(pub),
        freeLeft: Math.max(0, FREE_NEUTRAL - b.neutral.length),
        done: b.done,
      },
    };
  }
}

module.exports = { ArchiveRoom, worth, TILES, FREE_NEUTRAL };
