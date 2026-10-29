// Партія «Топ-10»: серія раундів, у кожному — тема-топ (найдорожчі трансфери, бомбардири клубу…) і N порожніх рядків.
// Гравці називають футболістів; хто в топі — стає на своє місце. Нижчі місця дають більше очок (перше всі знають).
// Режими кімнати: own — кожен заповнює свій топ (чужі відповіді не видно, лише скільки знайшли);
// turns — один топ на всіх, називаєте по черзі, помилки забирають життя. Соло — own на одного.
// Обмеження налаштовуються: життя (помилки) і таймер раунду (own) або ходу (turns).
const { T } = require('../../core/i18n'); // тексти помилок — парами (укр, англ)
const { playerById } = require('../../data');
const { BaseRoom } = require('../../core/base-room');
const { topicById, topicsFor, fitsSize, SIZES, CATEGORIES, LEVELS } = require('./tops');

const MAX_PLAYERS = 8;
const ALLOWED_LIVES = [0, 1, 3, 5]; // 0 — без обмеження помилок
const ALLOWED_ROUND_SECONDS = [0, 120, 180, 300];
const ALLOWED_TURN_SECONDS = [0, 20, 30, 60];
const ALLOWED_ROUNDS = [3, 5, 10];

// Очки за місце: перше — 1, останнє — 10, між ними рівномірно.
const pointsFor = (i, size) => (size === 1 ? 10 : 1 + Math.round((9 * i) / (size - 1)));
// Підказка «перша літера прізвища» на конкретне місце: платиш одразу половину очок за місце (угору) —
// нижче місце дорожче, бо й дає більше. Вгадаєш — отримаєш повні очки за місце.
const hintCostFor = (i, size) => Math.ceil(pointsFor(i, size) / 2);
// прізвище — усе після першого слова (як у «Правилі рукостискань»): «Кевін Де Брейне» → Д
const initial = (name) => { const w = String(name || '').trim().split(/\s+/); return (w.length > 1 ? w.slice(1).join(' ') : w[0]).charAt(0).toUpperCase(); };

function publicPlayer(p) {
  return { id: p.id, name: p.name, uk: p.uk, photo: p.photo };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

class TopRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, opts.solo ? 1 : MAX_PLAYERS);
    this.solo = !!opts.solo;
    const categories = (Array.isArray(opts.categories) ? opts.categories : []).filter((c) => CATEGORIES[c]);
    const mode = !this.solo && opts.mode === 'turns' ? 'turns' : 'own';
    let lives = ALLOWED_LIVES.includes(Number(opts.lives)) ? Number(opts.lives) : 3;
    if (mode === 'turns' && !lives) lives = 3; // по черзі без життів раунд ніколи б не скінчився
    this.options = {
      categories: categories.length ? [...new Set(categories)] : Object.keys(CATEGORIES),
      size: SIZES.includes(Number(opts.size)) ? Number(opts.size) : 10,
      mode,
      lives,
      roundSeconds: ALLOWED_ROUND_SECONDS.includes(Number(opts.roundSeconds)) ? Number(opts.roundSeconds) : this.solo ? 0 : 180,
      turnSeconds: ALLOWED_TURN_SECONDS.includes(Number(opts.turnSeconds)) ? Number(opts.turnSeconds) : 30,
      rounds: ALLOWED_ROUNDS.includes(Number(opts.rounds)) ? Number(opts.rounds) : 5,
      pick: opts.pick === 'host' ? 'host' : 'random',
      topicLevel: LEVELS.includes(opts.topicLevel) ? opts.topicLevel : 'mix', // з яких тем брати випадкову
    };
    this.status = 'waiting'; // waiting | playing | finished
    this.scores = Array(this.capacity).fill(0);
    this.history = []; // [{ title, results: { seat: очки } }]
    this.usedTopics = new Set();
    this.resetRound();
  }

  resetRound() {
    clearTimeout(this.timer);
    this.phase = null; // pick | guess | reveal
    this.topic = null;
    this.slots = [];
    this.missing = new Set(); // місця гравців, яких немає в базі: відкриті одразу, без очок
    this.roundPoints = {};
    this.hints = new Map(); // seat → Set(місце), де взяв підказку (бачить лише сам)
    this.hintSpent = {}; // seat → скільки очок віддав за підказки в раунді
    this.nextVotes = new Set();
    this.deadline = null;
    // own: свій топ кожного
    this.boards = new Map(); // seat → { found: Set(місце), wrong: [id], done }
    // turns: спільний топ
    this.found = new Map(); // місце → seat
    this.wrong = []; // [{ seat, playerId }]
    this.lives = new Map(); // seat → скільки лишилось
    this.order = [];
    this.turn = -1;
  }

  // Господар — перший, хто зараз онлайн (щоб офлайн-господар не тримав вибір теми).
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
    this.boards.delete(seat);
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
  start(seat) {
    if (this.status === 'playing') return { error: T('Гра вже йде', 'The game is already on') };
    if (seat !== this.host()) return { error: T('Почати гру може той, хто її створив', 'Only the room creator can start the game') };
    return this.startSeries();
  }

  startSeries() {
    if (!topicsFor(this.options.categories, this.options.size).length) return { error: T('Немає тем для цих налаштувань', 'No topics for these settings') };
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.roundNo = 0;
    this.status = 'playing';
    this.nextRound();
    return { ok: true };
  }

  nextRound() {
    this.resetRound();
    if (this.roundNo >= this.options.rounds) return this.finish();
    this.roundNo++;
    if (this.options.pick === 'host') {
      this.phase = 'pick';
      return this.changed();
    }
    this.beginRound(this.randomTopic());
  }

  randomTopic() {
    const fit = topicsFor(this.options.categories, this.options.size);
    const level = this.options.topicLevel;
    const leveled = level === 'mix' ? fit : fit.filter((t) => t.level === level);
    const all = leveled.length ? leveled : fit; // для цих категорій такого рівня немає — беремо будь-які
    // спершу обираємо категорію (щоб трансферних тем-клубів не було в рази більше), потім тему.
    // Лише з тем, яких ще не було (у категорії може бути одна тема — вона не має випадати знову),
    // і не з тієї ж категорії, що минулого раунду, якщо є інші.
    let fresh = all.filter((t) => !this.usedTopics.has(t.id));
    if (!fresh.length) fresh = fit.filter((t) => !this.usedTopics.has(t.id)); // теми цього рівня скінчились — беремо інші
    if (!fresh.length) fresh = all; // усе вже було — повторюємо
    let cats = [...new Set(fresh.map((t) => t.category))];
    if (cats.length > 1) cats = cats.filter((c) => c !== this.lastCategory);
    const cat = pick(cats);
    return pick(fresh.filter((t) => t.category === cat));
  }

  canSkip() {
    if (this.status !== 'playing' || this.phase !== 'guess') return false;
    return !this.wrong.length && !this.hints.size && ![...this.boards.values()].some((b) => b.found.size || b.wrong.length || b.done);
  }

  // Пропустити тему (не хочеться її грати): замість неї — інша, номер раунду той самий.
  // Лише господар (у соло — сам гравець) і лише поки в раунді ще ніхто нічого не знайшов і не помилився.
  skipTopic(seat) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не можна', 'Not right now') };
    if (seat !== this.host()) return { error: T('Пропустити тему може господар кімнати', 'Only the host can skip the topic') };
    if (!this.canSkip()) return { error: T('Тему вже почали — пропустити не можна', 'The topic is already in play — it can’t be skipped') };
    this.resetRound();
    if (this.options.pick === 'host') {
      this.phase = 'pick';
      this.changed();
    } else {
      this.beginRound(this.randomTopic());
    }
    return { ok: true };
  }

  // Господар обирає тему (або випадкову — topicId не вказано).
  pickTopic(seat, topicId) {
    if (this.phase !== 'pick') return { error: T('Зараз не обираємо тему', 'Not picking a topic right now') };
    if (seat !== this.host()) return { error: T('Тему обирає господар кімнати', 'The host picks the topic') };
    let topic;
    if (topicId == null) topic = this.randomTopic();
    else {
      topic = topicById.get(topicId);
      if (!topic || !fitsSize(topic, this.options.size)) return { error: T('Такої теми немає', 'No such topic') };
    }
    this.beginRound(topic);
    return { ok: true };
  }

  beginRound(topic) {
    this.topic = topic;
    this.lastCategory = topic.category; // наступна випадкова тема — з іншої категорії
    this.usedTopics.add(topic.id);
    this.slots = topic.entries.slice(0, this.options.size);
    this.missing = new Set(this.slots.map((e, i) => (e.p ? -1 : i)).filter((i) => i >= 0));
    this.phase = 'guess';
    if (this.options.mode === 'turns') {
      // черга зсувається з кожним раундом, щоб першим ходив не завжди той самий
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

  slotsOf(playerId) {
    return this.slots.map((e, i) => (e.p && e.p.id === playerId ? i : -1)).filter((i) => i >= 0);
  }

  board(seat) {
    if (!this.boards.has(seat)) this.boards.set(seat, { found: new Set(), wrong: [], done: false });
    return this.boards.get(seat);
  }

  addPoints(seat, places) {
    const pts = places.reduce((s, i) => s + pointsFor(i, this.slots.length), 0);
    this.scores[seat] += pts;
    this.roundPoints[seat] = (this.roundPoints[seat] || 0) + pts;
    return pts;
  }

  // Підказка на місце i: перша літера прізвища, ціна знімається одразу.
  hint(seat, i) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не можна', 'Not right now') };
    i = Number(i);
    const e = this.slots[i];
    if (!e || !e.p) return { error: T('Для цього місця підказки немає', 'No hint for this place') };
    if (this.options.mode === 'turns') {
      if (!this.order.includes(seat) || !(this.lives.get(seat) > 0)) return { error: T('Ти зараз не граєш у цьому раунді', 'You’re not playing this round') };
      if (this.found.has(i)) return { error: T('Це місце вже відкрито', 'This place is already revealed') };
    } else {
      const b = this.board(seat);
      if (b.done) return { error: T('Твій топ у цьому раунді вже закрито', 'Your top is already closed this round') };
      if (b.found.has(i)) return { error: T('Це місце ти вже відкрив', 'You already found this place') };
    }
    const mine = this.hints.get(seat) || new Set();
    if (mine.has(i)) return { error: T('Підказка для цього місця вже є', 'You already have a hint for this place') };
    mine.add(i);
    this.hints.set(seat, mine);
    const cost = hintCostFor(i, this.slots.length);
    this.scores[seat] -= cost;
    this.roundPoints[seat] = (this.roundPoints[seat] || 0) - cost;
    this.hintSpent[seat] = (this.hintSpent[seat] || 0) + cost;
    this.touch();
    this.changed();
    return { ok: true, cost };
  }

  // ── відповідь
  guess(seat, playerId) {
    if (this.status !== 'playing' || this.phase !== 'guess') return { error: T('Зараз не можна відповідати', 'You can’t answer right now') };
    const player = playerById.get(playerId);
    if (!player) return { error: T('Обери гравця зі списку', 'Pick a player from the list') };
    const places = this.slotsOf(player.id);
    this.touch();
    return this.options.mode === 'turns' ? this.guessTurns(seat, player, places) : this.guessOwn(seat, player, places);
  }

  guessOwn(seat, player, places) {
    const b = this.board(seat);
    if (b.done) return { error: T('Твій топ у цьому раунді вже закрито', 'Your top is already closed this round') };
    if (places.some((i) => b.found.has(i)) || b.wrong.includes(player.id)) return { error: T('Цього гравця ти вже називав', 'You already named this player') };
    let res;
    if (places.length) {
      places.forEach((i) => b.found.add(i));
      res = { ok: true, correct: true, places, points: this.addPoints(seat, places) };
      if (b.found.size + this.missing.size === this.slots.length) b.done = true;
    } else {
      b.wrong.push(player.id);
      if (this.options.lives && b.wrong.length >= this.options.lives) b.done = true;
      res = { ok: true, correct: false };
    }
    this.checkProgress();
    this.changed();
    return res;
  }

  guessTurns(seat, player, places) {
    if (this.order[this.turn] !== seat) return { error: T('Зараз не твій хід', 'It’s not your turn') };
    if (places.some((i) => this.found.has(i))) return { error: T('Він уже на дошці', 'He’s already on the board') };
    if (this.wrong.some((w) => w.playerId === player.id)) return { error: T('Його вже називали — його немає в топі', 'Already named — he’s not in the top') };
    let res;
    if (places.length) {
      places.forEach((i) => this.found.set(i, seat));
      res = { ok: true, correct: true, places, points: this.addPoints(seat, places) };
    } else {
      this.wrong.push({ seat, playerId: player.id });
      this.loseLife(seat);
      res = { ok: true, correct: false };
    }
    if (this.found.size + this.missing.size === this.slots.length) this.endRound();
    else this.nextTurn();
    this.changed();
    return res;
  }

  // Пас (по черзі) — як помилка: інакше можна було б пасувати безкінечно.
  pass(seat) {
    if (this.options.mode !== 'turns' || this.phase !== 'guess' || this.order[this.turn] !== seat) return { error: T('Зараз не твій хід', 'It’s not your turn') };
    this.wrong.push({ seat, playerId: null });
    this.loseLife(seat);
    this.nextTurn();
    this.changed();
    return { ok: true };
  }

  loseLife(seat) {
    this.lives.set(seat, Math.max(0, (this.lives.get(seat) || 0) - 1));
  }

  // Наступний у черзі, хто ще в грі (має життя, онлайн); нікого — раунд закінчено.
  nextTurn() {
    clearTimeout(this.timer);
    const n = this.order.length;
    for (let k = 1; k <= n; k++) {
      const s = this.order[(this.turn + k) % n];
      if (this.seats[s]?.connected && this.lives.get(s) > 0) {
        this.turn = (this.turn + k) % n;
        const sec = this.options.turnSeconds;
        this.deadline = sec ? Date.now() + sec * 1000 : null;
        if (sec) {
          this.timer = setTimeout(() => {
            this.pass(this.order[this.turn]);
          }, sec * 1000);
        }
        return;
      }
    }
    this.endRound();
  }

  // Своїм топом у раунді більше не граєш (own).
  giveUp(seat) {
    if (this.options.mode !== 'own' || this.phase !== 'guess') return { error: T('Зараз не можна', 'Not right now') };
    this.board(seat).done = true;
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

  checkProgress() {
    const online = this.presentSeats().filter((i) => this.seats[i].connected);
    if (this.phase === 'guess') {
      if (this.options.mode === 'own') {
        if (online.length && online.every((i) => this.board(i).done)) this.endRound();
      } else if (!this.seats[this.order[this.turn]]?.connected) {
        this.nextTurn();
      }
    } else if (this.phase === 'reveal') {
      if (online.length && online.every((i) => this.nextVotes.has(i))) this.nextRound();
    }
  }

  endRound() {
    if (this.phase !== 'guess') return;
    clearTimeout(this.timer);
    this.phase = 'reveal';
    this.deadline = null;
    this.history.push({ title: this.topic.title, results: { ...this.roundPoints }, hints: { ...this.hintSpent } });
    this.changed();
  }

  finish() {
    clearTimeout(this.timer);
    this.status = 'finished';
    this.phase = null;
    this.deadline = null;
    this.changed();
  }

  slotFull(i) {
    const e = this.slots[i];
    const player = e.p ? publicPlayer(e.p) : { id: null, name: e.name, uk: null, photo: null };
    return { player, text: e.text, detail: e.detail, points: pointsFor(i, this.slots.length), missing: !e.p };
  }

  publicState() {
    const reveal = this.phase === 'reveal';
    const turns = this.options.mode === 'turns';
    const slots = this.slots.map((_, i) => {
      if (reveal) {
        const by = turns ? (this.found.has(i) ? [this.found.get(i)] : []) : [...this.boards].filter(([, b]) => b.found.has(i)).map(([s]) => s);
        return { ...this.slotFull(i), by };
      }
      if (this.missing.has(i)) return { ...this.slotFull(i), by: [] };
      if (turns && this.found.has(i)) return { ...this.slotFull(i), by: [this.found.get(i)] };
      return { points: pointsFor(i, this.slots.length), hintCost: hintCostFor(i, this.slots.length) };
    });
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
      topic: this.topic ? { id: this.topic.id, title: this.topic.title, note: this.topic.note, category: this.topic.category } : null,
      slots,
      progress,
      // по черзі: хто ходить, життя, хто кого назвав мимо
      order: this.order,
      active: turns && this.phase === 'guess' ? this.order[this.turn] ?? -1 : -1,
      lives: Object.fromEntries(this.lives),
      wrong: turns ? this.wrong.map((w) => ({ seat: w.seat, player: w.playerId ? publicPlayer(playerById.get(w.playerId)) : null })) : [],
      roundPoints: this.roundPoints,
      hintSpent: this.hintSpent, // скільки хто віддав за підказки — для розкладу раунду
      canSkip: this.canSkip(), // тему ще можна пропустити (ніхто нічого не назвав)
      nextVotes: [...this.nextVotes],
      scores: this.scores,
      deadline: this.deadline,
      serverNow: Date.now(),
      history: this.status === 'finished' ? this.history : [],
    };
    if (process.env.TOP_TEST_ANSWER === '1' && this.slots.length) state.testAnswer = this.slots.map((e) => e.p?.id ?? null); // лише для автотесту
    return state;
  }

  // own: свої знайдені й помилки бачить лише сам гравець.
  privateState(seat) {
    // свої підказки: місце → перша літера прізвища
    const myHints = [...(this.hints.get(seat) || [])].map((i) => {
      const p = this.slots[i]?.p;
      return { i, letter: p ? T(initial(p.uk || p.name), initial(p.name)) : '' };
    });
    if (this.options.mode !== 'own' || !this.boards.has(seat)) return { mine: null, myHints };
    const b = this.boards.get(seat);
    return {
      myHints,
      mine: {
        found: [...b.found].map((i) => ({ i, ...this.slotFull(i) })),
        wrong: b.wrong.map((id) => publicPlayer(playerById.get(id))),
        done: b.done,
        livesLeft: this.options.lives ? Math.max(0, this.options.lives - b.wrong.length) : null,
      },
    };
  }
}

module.exports = { TopRoom, pointsFor, hintCostFor, ALLOWED_LIVES, ALLOWED_ROUND_SECONDS, ALLOWED_TURN_SECONDS, ALLOWED_ROUNDS };
