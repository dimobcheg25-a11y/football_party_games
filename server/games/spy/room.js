// Партія «Футбольний шпигун»: турнір із матчів до TARGET балів. У кожному матчі всі, крім шпигуна, бачать одного футболіста;
// по черзі дають підказки (голосом або текстом), потім голосують, хто шпигун; шпигун може вгадати футболіста.
// Бали: агент +1, якщо вказав на шпигуна; шпигун 0 — явно викрили (голосів більше, ніж у будь-кого), 3 — у нього найменше
// голосів, інакше 2; +2, якщо вгадав футболіста. Хто футболіст і хто шпигун — лише в privateState, доки матч не скінчився.
const { playerById } = require('../../data');
const { BaseRoom } = require('../../core/base-room');
const { T } = require('../../core/i18n');
const { nicknameVariants } = require('../../data/nicknames');
const { poolFor, ERAS, DIFFICULTIES } = require('../path/careers');

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;
const ALLOWED_CIRCLES = [1, 2, 3];
const ALLOWED_TARGETS = [7, 11, 15];
const SPY_GUESS_POINTS = 2;
const CLUE_MAX = 80;

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

// Слова імені футболіста (від 4 літер) і його прізвиська цілком («Шева», «CR7», «La Pulga») — щоб агент не написав їх у підказці.
// Апострофи зводимо до одного: «К'єза», «К’єза», «Кʼєза» — те саме слово; слово з апострофом береться й цілком (частини коротші за 4 літери).
const apos = (s) => s.toLowerCase().replace(/[’ʼ`´]/g, "'");
const nameWords = (p) => {
  const words = apos([p.uk, p.name].filter(Boolean).join(' ')).split(/[\s\-.]+/);
  return [
    ...words.flatMap((w) => [w, ...w.split("'")]).filter((w) => w.length >= 4),
    ...nicknameVariants(p).map(apos).filter((n) => n.length >= 3),
  ];
};

class SpyRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, MAX_PLAYERS);
    this.options = {
      era: ERAS[opts.era] ? opts.era : 'all',
      difficulty: DIFFICULTIES[opts.difficulty] ? opts.difficulty : 'normal',
      circles: ALLOWED_CIRCLES.includes(Number(opts.circles)) ? Number(opts.circles) : 2,
      target: ALLOWED_TARGETS.includes(Number(opts.target)) ? Number(opts.target) : 11,
    };
    this.status = 'waiting'; // waiting | playing | finished
    this.scores = Array(this.capacity).fill(0);
    this.stats = Array(this.capacity).fill(null).map(() => ({ spy: 0, caught: 0 }));
    this.history = []; // [{ footballer, spy, spyPoints, guessed }]
    this.used = new Set();
    this.lastSpy = -1;
    this.matchNo = 0;
    this.resetMatch();
  }

  resetMatch() {
    this.phase = null; // clues | vote | spyGuess | reveal
    this.footballer = null;
    this.spy = -1;
    this.players = []; // місця, що грають цей матч (хто зайшов посеред матчу — чекає наступного)
    this.order = [];
    this.turn = 0;
    this.circle = 1;
    this.clues = []; // [{ seat, circle, text | null (голосом) }]
    this.reroll = null; // { by, yes: Set, no: Set }
    this.votes = new Map(); // seat → за кого
    this.voteCounts = null;
    this.spyPoints = null;
    this.spyGuess = null; // { player, correct } | { skipped: true }
    this.gained = null;
    this.nextVotes = new Set();
    this.tiebreak = false;
  }

  host() {
    return this.presentSeats()[0] ?? -1;
  }

  online(list) {
    return list.filter((i) => this.seats[i]?.connected);
  }

  // ── вхід/вихід
  join(token, name) {
    let seat = this.rejoin(token, name);
    if (seat === -1) {
      seat = this.takeSeat(token, name);
      if (seat === -1) return { error: T('Кімната вже заповнена — створи свою гру', 'The room is full — start your own game') };
      this.scores[seat] = 0;
      this.stats[seat] = { spy: 0, caught: 0 };
    }
    this.touch();
    this.changed();
    return { seat };
  }

  leave(seat) {
    this.seats[seat] = null;
    this.touch();
    if (this.status === 'playing' && this.players.includes(seat)) {
      // до підрахунку голосів без шпигуна або коли гравців замало матч не має сенсу: скасовуємо без балів
      const early = this.phase === 'clues' || this.phase === 'vote';
      if (early && seat === this.spy) this.cancelMatch(T('Шпигун вийшов — матч скасовано', 'The spy left — match cancelled'));
      else if (early && this.players.filter((i) => this.seats[i]).length < MIN_PLAYERS) this.cancelMatch(T('Замало гравців — матч скасовано', 'Not enough players — match cancelled'));
      else this.checkProgress();
    }
    this.changed();
  }

  setConnected(token, connected) {
    const seat = this.seatOf(token);
    if (seat === -1) return;
    Object.assign(this.seats[seat], { connected, offlineSince: connected ? null : Date.now() });
    this.touch();
    this.checkProgress();
    this.changed();
  }

  cancelMatch(reason) {
    this.resetMatch();
    this.status = 'waiting';
    this.notice = reason;
  }

  // ── турнір
  start(seat) {
    if (this.status === 'playing') return { error: T('Гра вже йде', 'The game is already on') };
    if (seat !== this.host()) return { error: T('Почати гру може той, хто її створив', 'Only the room creator can start the game') };
    if (this.presentSeats().length < MIN_PLAYERS) return { error: T(`Потрібно щонайменше ${MIN_PLAYERS} гравці`, `At least ${MIN_PLAYERS} players needed`) };
    if (this.status === 'finished') {
      this.scores = Array(this.capacity).fill(0);
      this.stats = this.stats.map(() => ({ spy: 0, caught: 0 }));
      this.history = [];
      this.used = new Set();
      this.matchNo = 0;
    }
    return this.startMatch();
  }

  pickFootballer() {
    const pool = poolFor(this.options.era, this.options.difficulty);
    let free = pool.filter((p) => !this.used.has(p.id) && p.id !== this.footballer?.id);
    if (!free.length) {
      this.used.clear();
      free = pool.filter((p) => p.id !== this.footballer?.id);
    }
    const p = free[Math.floor(Math.random() * free.length)];
    this.used.add(p.id);
    return p;
  }

  startMatch() {
    const players = this.presentSeats();
    if (players.length < MIN_PLAYERS) return { error: T(`Потрібно щонайменше ${MIN_PLAYERS} гравці`, `At least ${MIN_PLAYERS} players needed`) };
    const tiebreak = this.status === 'playing' && this.isTie();
    this.resetMatch();
    this.notice = null;
    this.status = 'playing';
    this.tiebreak = tiebreak;
    this.matchNo++;
    this.players = players;
    this.footballer = this.pickFootballer();
    const candidates = players.filter((i) => i !== this.lastSpy);
    this.spy = shuffle(candidates.length ? candidates : players)[0];
    this.lastSpy = this.spy;
    this.order = shuffle(players);
    this.phase = 'clues';
    this.skipAbsent();
    this.changed();
    return { ok: true };
  }

  // ── підказки
  activeSeat() {
    return this.phase === 'clues' ? this.order[this.turn] : -1;
  }

  // Хід переходить далі; після останнього кола — голосування.
  advanceTurn() {
    this.turn++;
    if (this.turn >= this.order.length) {
      this.turn = 0;
      this.circle++;
    }
    if (this.circle > this.options.circles) return this.toVote();
    this.skipAbsent();
  }

  // Хто вийшов або офлайн — не тримає гру: його хід пропускаємо.
  skipAbsent() {
    let guard = this.order.length * (this.options.circles + 1);
    while (this.phase === 'clues' && guard-- > 0) {
      const s = this.order[this.turn];
      if (this.seats[s]?.connected) return;
      this.turn++;
      if (this.turn >= this.order.length) {
        this.turn = 0;
        this.circle++;
      }
      if (this.circle > this.options.circles) return this.toVote();
    }
  }

  clue(seat, text) {
    if (this.status !== 'playing' || this.phase !== 'clues') return { error: T('Зараз не час для підказок', 'Not the time for clues') };
    if (this.reroll) return { error: T('Спершу дограйте голосування за заміну', 'Finish the replacement vote first') };
    if (seat !== this.activeSeat()) return { error: T('Зараз не твій хід', 'It’s not your turn') };
    let clean = null;
    if (text != null) {
      clean = String(text).replace(/\s+/g, ' ').trim().slice(0, CLUE_MAX);
      if (!clean) return { error: T('Напиши підказку або натисни «Сказав голосом»', 'Type a clue or press “Said it out loud”') };
      const low = apos(clean);
      if (seat !== this.spy && nameWords(this.footballer).some((w) => low.includes(w))) return { error: T('Не називай самого футболіста 🙂', 'Don’t name the footballer 🙂') };
    }
    this.clues.push({ seat, circle: this.circle, text: clean });
    this.touch();
    this.advanceTurn();
    this.changed();
    return { ok: true };
  }

  // Господар: пропустити хід (гравець відійшов) або одразу до голосування.
  skipTurn(seat) {
    if (seat !== this.host()) return { error: T('Це може лише господар кімнати', 'Only the host can do this') };
    if (this.phase !== 'clues' || this.reroll) return { error: T('Зараз не можна', 'Not now') };
    this.clues.push({ seat: this.activeSeat(), circle: this.circle, text: null, skipped: true });
    this.advanceTurn();
    this.changed();
    return { ok: true };
  }

  forceVote(seat) {
    if (seat !== this.host()) return { error: T('Це може лише господар кімнати', 'Only the host can do this') };
    if (this.phase !== 'clues') return { error: T('Зараз не можна', 'Not now') };
    this.toVote();
    this.changed();
    return { ok: true };
  }

  // ── заміна футболіста (хтось не знає, хто це): голосують усі, більшість «за» — новий футболіст, підказки спочатку
  requestReroll(seat) {
    if (this.phase !== 'clues' || !this.players.includes(seat)) return { error: T('Зараз не можна', 'Not now') };
    if (this.reroll) return { error: T('Голосування вже йде', 'A vote is already on') };
    this.reroll = { by: seat, yes: new Set([seat]), no: new Set() };
    this.checkReroll();
    this.changed();
    return { ok: true };
  }

  rerollVote(seat, { yes } = {}) {
    if (!this.reroll || !this.players.includes(seat)) return { error: T('Голосування немає', 'There is no vote') };
    if (this.reroll.yes.has(seat) || this.reroll.no.has(seat)) return { error: T('Ти вже проголосував', 'You have already voted') };
    (yes ? this.reroll.yes : this.reroll.no).add(seat);
    this.checkReroll();
    this.changed();
    return { ok: true };
  }

  checkReroll() {
    const voters = this.online(this.players.filter((i) => this.seats[i]));
    const { yes, no } = this.reroll;
    const need = Math.ceil(voters.length / 2);
    if (yes.size >= need) {
      this.footballer = this.pickFootballer();
      this.clues = [];
      this.turn = 0;
      this.circle = 1;
      this.reroll = null;
      this.skipAbsent();
    } else if (no.size > voters.length - need || voters.every((i) => yes.has(i) || no.has(i))) {
      this.reroll = null;
    }
  }

  // ── голосування
  toVote() {
    this.phase = 'vote';
    this.reroll = null;
    this.checkProgress();
  }

  vote(seat, { target } = {}) {
    if (this.phase !== 'vote') return { error: T('Зараз не голосуємо', 'Not voting now') };
    if (!this.players.includes(seat)) return { error: T('Ти граєш з наступного матчу', 'You play from the next match') };
    if (this.votes.has(seat)) return { error: T('Ти вже проголосував', 'You have already voted') };
    target = Number(target);
    if (target === seat || !this.players.includes(target) || !this.seats[target]) return { error: T('Обери іншого гравця', 'Pick another player') };
    this.votes.set(seat, target);
    this.touch();
    this.checkProgress();
    this.changed();
    return { ok: true };
  }

  resolveVotes() {
    const alive = this.players.filter((i) => this.seats[i]);
    const counts = Object.fromEntries(alive.map((i) => [i, 0]));
    for (const t of this.votes.values()) if (t in counts) counts[t]++;
    const spyVotes = counts[this.spy] || 0;
    const others = alive.filter((i) => i !== this.spy).map((i) => counts[i]);
    const otherMax = Math.max(0, ...others);
    const min = Math.min(...Object.values(counts));
    // 0 — явно викрили; 3 — у шпигуна строго найменше підозр; інакше (нічия з лідером, середина) — 2
    this.spyPoints = spyVotes > otherMax ? 0 : spyVotes === min && spyVotes < otherMax ? 3 : 2;
    this.voteCounts = counts;
    this.gained = Object.fromEntries(alive.map((i) => [i, i === this.spy ? this.spyPoints : this.votes.get(i) === this.spy ? 1 : 0]));
    for (const [i, pts] of Object.entries(this.gained)) this.scores[i] += pts;
    this.stats[this.spy].spy++;
    if (this.spyPoints === 0) this.stats[this.spy].caught++;
    this.phase = 'spyGuess';
  }

  // ── шпигун називає футболіста (одна спроба) або пропускає
  spyGuessAction(seat, { playerId } = {}) {
    if (this.phase !== 'spyGuess') return { error: T('Зараз не можна', 'Not now') };
    if (seat !== this.spy) return { error: T('Вгадує лише шпигун', 'Only the spy guesses') };
    if (playerId == null) {
      this.spyGuess = { skipped: true };
    } else {
      const p = playerById.get(playerId);
      if (!p) return { error: T('Обери гравця зі списку', 'Pick a player from the list') };
      const correct = p.id === this.footballer.id;
      this.spyGuess = { player: publicPlayer(p), correct };
      if (correct) {
        this.scores[seat] += SPY_GUESS_POINTS;
        this.gained[seat] += SPY_GUESS_POINTS;
      }
    }
    this.toReveal();
    this.changed();
    return { ok: true, correct: !!this.spyGuess.correct };
  }

  toReveal() {
    this.phase = 'reveal';
    this.history.push({
      footballer: publicPlayer(this.footballer),
      spy: this.spy,
      spyName: this.seats[this.spy]?.name || T('Гравець', 'Player'),
      spyPoints: this.spyPoints,
      guessed: !!this.spyGuess?.correct,
    });
  }

  // Після матчу: усі онлайн натиснули «далі» — наступний матч або фінал.
  next(seat) {
    if (this.phase !== 'reveal') return { error: T('Матч ще йде', 'The match is still on') };
    this.nextVotes.add(seat);
    this.checkProgress();
    if (this.phase === 'reveal') this.changed();
    return { ok: true };
  }

  leaders() {
    const seats = this.presentSeats();
    const top = Math.max(0, ...seats.map((i) => this.scores[i]));
    return { top, seats: seats.filter((i) => this.scores[i] === top) };
  }

  isTie() {
    const { top, seats } = this.leaders();
    return top >= this.options.target && seats.length > 1;
  }

  afterReveal() {
    const { top, seats } = this.leaders();
    if (top >= this.options.target && seats.length === 1) {
      this.status = 'finished';
      this.phase = null;
      this.winner = seats[0];
      return this.changed();
    }
    const res = this.startMatch();
    if (res.error) this.cancelMatch(res.error);
    this.changed();
  }

  checkProgress() {
    if (this.status !== 'playing') return;
    const here = this.online(this.players.filter((i) => this.seats[i]));
    if (this.phase === 'clues') {
      if (this.reroll) this.checkReroll();
      if (!this.seats[this.activeSeat()]?.connected) this.skipAbsent();
    }
    if (this.phase === 'vote' && here.every((i) => this.votes.has(i))) this.resolveVotes();
    if (this.phase === 'spyGuess' && !this.seats[this.spy]?.connected) {
      this.spyGuess = { skipped: true };
      this.toReveal();
    }
    if (this.phase === 'reveal') {
      const everyone = this.online(this.presentSeats());
      if (everyone.length && everyone.every((i) => this.nextVotes.has(i))) this.afterReveal();
    }
  }

  publicState() {
    const over = this.phase === 'spyGuess' || this.phase === 'reveal';
    const state = {
      code: this.code,
      options: this.options,
      minPlayers: MIN_PLAYERS,
      spyGuessPoints: SPY_GUESS_POINTS,
      capacity: this.capacity,
      seats: this.publicSeats(),
      host: this.host(),
      status: this.status,
      notice: this.notice || null,
      phase: this.phase,
      match: this.matchNo,
      tiebreak: this.tiebreak,
      players: this.players,
      order: this.order,
      active: this.activeSeat(),
      circle: Math.min(this.circle, this.options.circles),
      clues: this.clues,
      reroll: this.reroll ? { by: this.reroll.by, yes: this.reroll.yes.size, no: this.reroll.no.size, voted: [...this.reroll.yes, ...this.reroll.no] } : null,
      voted: [...this.votes.keys()],
      votes: over ? Object.fromEntries(this.votes) : null,
      voteCounts: over ? this.voteCounts : null,
      spy: over ? this.spy : null,
      spyPoints: over ? this.spyPoints : null,
      spyGuess: this.phase === 'reveal' ? this.spyGuess : null,
      footballer: this.phase === 'reveal' ? publicPlayer(this.footballer) : null,
      gained: over ? this.gained : null,
      nextVotes: [...this.nextVotes],
      scores: this.scores,
      stats: this.stats,
      winner: this.status === 'finished' ? this.winner : null,
      history: this.history,
    };
    if (process.env.SPY_TEST_ANSWER === '1' && this.footballer) Object.assign(state, { testAnswer: this.footballer.id, testSpy: this.spy }); // лише для автотесту
    return state;
  }

  // Роль бачить лише сам гравець: агентам — футболіст, шпигуну — нічого.
  privateState(seat) {
    if (this.status !== 'playing' || !this.players.includes(seat)) return { role: null, card: null };
    const spy = seat === this.spy;
    return { role: spy ? 'spy' : 'agent', card: spy ? null : publicPlayer(this.footballer) };
  }
}

module.exports = { SpyRoom, MIN_PLAYERS, ALLOWED_CIRCLES, ALLOWED_TARGETS };
