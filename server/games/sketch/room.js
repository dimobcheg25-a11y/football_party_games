// Партія «Тактичного ескізу»: гравці по черзі малюють загадане (футболіст, клуб, термін або трофей), решта пише відповіді в чат.
// Хід: choose (художник обирає одне з трьох слів — по одному з кожної категорії, тож усі пропонуються однаково часто) → draw (малюнок
// наживо; гравці бачать лише категорію — ні літер, ні їх кількості) → reveal (відповідь, очки) → наступний художник. Кіл — 1/2/3.
// Очки: хто вгадав — 100→20 за часом, що лишився (без таймера — за порядком: 100, 80, 60…), першому +20; художнику — +25 за кожного.
// Без таймера хід закінчується, коли всі вгадали або сказали «не знаю», чи художник здався (кнопки є і з таймером).
// Слово бачить лише художник і ті, хто вже вгадав (privateState); правильну відповідь у чаті не бачить ніхто (screenChat),
// чат тих, хто вгадав, — лише між ними й художником. Штрихи — окремою подією 'draw' (index.js), повний малюнок — дією snapshot.
const { BaseRoom } = require('../../core/base-room');
const { T } = require('../../core/i18n');
const { CATS, decksFor, norm } = require('./words');

const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;
const ALLOWED_LAPS = [1, 2, 3];
const ALLOWED_TIMES = [60, 80, 100, 0]; // 0 — без обмеження часу
const CHOOSE_MS = Number(process.env.SKETCH_CHOOSE_MS) || 15000;
const REVEAL_MS = Number(process.env.SKETCH_REVEAL_MS) || 6000;
const GUESS_MAX = 100;
const GUESS_MIN = 20;
const FIRST_BONUS = 20;
const GUESS_STEP = 20; // без таймера: кожен наступний, хто вгадав, — на 20 менше
const DRAWER_EACH = 25;
// Малюнок: полотно 1000×750 (координати цілі), кольори й товщини — лише з наборів; межі — щоб не роздути кімнату.
// Елементи малюнка: штрих { c, w, p: [x, y, …] } (c = ERASE — гумка), фігура { k: line|rect|oval, c, w, p: [x1, y1, x2, y2] },
// заливка { k: 'fill', c, p: [x, y] } — кожен клієнт заливає у своєму полотні, у тому ж порядку.
const W = 1000;
const H = 750;
const PALETTE = [
  '#1d1d1f', '#5b5f66', '#a3a8b0', '#ffffff', '#d7262e', '#8e1b20', '#f26b2a', '#f7c531', '#f2a93b',
  '#7ac943', '#1e8a3c', '#4fb3ff', '#1f4fd8', '#1b2a6b', '#8a4fd8', '#f07aa8', '#7a4a21', '#f1c7a1',
];
const ERASE = 'erase';
const SIZE = { min: 2, max: 48 }; // товщина пензля — будь-яка в цих межах (повзунок)
const okSize = (w) => Number.isInteger(w) && w >= SIZE.min && w <= SIZE.max;
const SHAPES = ['line', 'rect', 'oval'];
const MAX_POINTS = 40000;
const MAX_STROKES = 1500;

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Наскільки відповідь схожа: 0 — збіг, 1–2 — «майже» (відстань Левенштейна без пробілів).
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function judge(text, word) {
  const t = norm(text);
  const flat = t.replace(/ /g, '');
  if (!flat) return 'miss';
  const words = t.split(' ');
  let close = false;
  for (const v of word.variants) {
    const x = v.replace(/ /g, '');
    if (x === flat) return 'correct';
    const vw = v.split(' ');
    // відповідь цілком у короткому повідомленні («це ж мессі»), але не список імен навздогад
    if (x.length >= 4 && words.length <= vw.length + 2 && ` ${t} `.includes(` ${v} `)) return 'correct';
    if (x.length >= 4 && distance(flat, x) <= (x.length >= 9 ? 2 : 1)) close = true;
    // частина відповіді: початок слова («олімп» → «олімпійські ігри») або спільне слово («ігри», «ліонель»)
    if (flat.length >= 4 && (x.startsWith(flat) || vw.some((w) => w.length >= 4 && (w.startsWith(flat) || words.includes(w))))) close = true;
  }
  return close ? 'close' : 'miss';
}
// Чи є відповідь у тексті (художник не може її написати). Лише цілим словом — тож «гол» не блокує «голова».
function mentions(text, word) {
  const t = ` ${norm(text)} `;
  // будь-якої довжини: раніше лише від 4 літер, і художник міг написати «ПСЖ», «VAR», «Гол»
  return word.variants.some((v) => v.replace(/ /g, '').length >= 2 && t.includes(` ${v} `));
}

class SketchRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, MAX_PLAYERS);
    this.options = {
      laps: ALLOWED_LAPS.includes(Number(opts.laps)) ? Number(opts.laps) : 2,
      drawSeconds: ALLOWED_TIMES.includes(Number(opts.drawSeconds ?? 80)) ? Number(opts.drawSeconds ?? 80) : 80,
      difficulty: opts.difficulty === 'easy' ? 'easy' : 'normal',
    };
    this.status = 'waiting'; // waiting | playing | finished
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.turnNo = 0;
    this.resetTurn();
  }

  resetTurn() {
    clearTimeout(this.timer);
    this.phase = null; // choose | draw | reveal
    this.drawer = -1;
    this.choices = [];
    this.word = null;
    this.strokes = [];
    this.points = 0;
    this.guessed = new Map(); // seat → очки
    this.passed = new Set(); // сказали «не знаю»
    this.drawerGain = 0;
    this.deadline = null;
    this.startedAt = null;
  }

  host() {
    return this.presentSeats()[0] ?? -1;
  }

  online() {
    return this.presentSeats().filter((i) => this.seats[i].connected);
  }

  // ── вхід/вихід
  join(token, name) {
    let seat = this.rejoin(token, name);
    if (seat === -1) {
      seat = this.takeSeat(token, name);
      if (seat === -1) return { error: T('Кімната вже заповнена — створи свою гру', 'The room is full — start your own game') };
      this.scores[seat] = 0;
      if (this.status === 'playing' && !this.order.includes(seat)) this.order.push(seat); // малюватиме в цьому ж колі
    }
    this.touch();
    this.changed();
    return { seat };
  }

  leave(seat) {
    this.seats[seat] = null;
    this.guessed.delete(seat);
    this.touch();
    if (this.status === 'playing') {
      if (this.presentSeats().length < MIN_PLAYERS) return this.finish();
      if (seat === this.drawer && this.phase !== 'reveal') return this.endTurn(T('Художник вийшов', 'The artist left'));
      this.checkProgress();
    }
    this.changed();
  }

  setConnected(token, connected) {
    super.setConnected(token, connected);
    if (this.status === 'playing') this.checkProgress();
  }

  // ── партія
  start(seat) {
    if (this.status === 'playing') return { error: T('Гра вже йде', 'The game is already on') };
    if (seat !== this.host()) return { error: T('Почати гру може той, хто її створив', 'Only the host can start the game') };
    if (this.presentSeats().length < MIN_PLAYERS) return { error: T(`Потрібно щонайменше ${MIN_PLAYERS} гравці`, `At least ${MIN_PLAYERS} players needed`) };
    this.decks = Object.fromEntries(Object.entries(decksFor(this.options.difficulty)).map(([k, list]) => [k, shuffle(list)]));
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.lap = 1;
    this.order = shuffle(this.presentSeats());
    this.turnIdx = -1;
    this.status = 'playing';
    this.nextTurn();
    return { ok: true };
  }

  // Вибір художника — по слову з кожної категорії (футболіст, клуб, термін або трофей), у випадковому порядку.
  drawChoices() {
    return shuffle(Object.keys(CATS).map((cat) => {
      if (!this.decks[cat].length) this.decks[cat] = shuffle(decksFor(this.options.difficulty)[cat]); // довга гра — по другому колу
      return this.decks[cat].pop();
    }));
  }

  nextTurn() {
    this.resetTurn();
    // наступний художник — хто ще тут (вийшов — пропускаємо); коло скінчилось — нове коло з тими, хто є
    for (;;) {
      this.turnIdx++;
      if (this.turnIdx >= this.order.length) {
        if (this.lap >= this.options.laps) return this.finish();
        this.lap++;
        this.order = this.order.filter((i) => this.seats[i]).concat(this.presentSeats().filter((i) => !this.order.includes(i)));
        this.turnIdx = 0;
      }
      const seat = this.order[this.turnIdx];
      if (this.seats[seat]) { this.drawer = seat; break; }
    }
    this.turnNo++;
    this.choices = this.drawChoices();
    this.phase = 'choose';
    this.deadline = Date.now() + CHOOSE_MS;
    this.timer = setTimeout(() => this.choose(this.drawer, this.choices[Math.floor(Math.random() * this.choices.length)]?.key), CHOOSE_MS);
    this.changed();
  }

  // ── дії
  choose(seat, key) {
    if (this.status !== 'playing' || this.phase !== 'choose') return { error: T('Зараз не можна', 'Not right now') };
    if (seat !== this.drawer) return { error: T('Зараз обирає інший гравець', 'Someone else is choosing') };
    const word = this.choices.find((w) => w.key === key);
    if (!word) return { error: T('Обери одне зі слів', 'Pick one of the words') };
    clearTimeout(this.timer);
    this.word = word;
    this.phase = 'draw';
    this.startedAt = Date.now();
    const ms = this.options.drawSeconds * 1000;
    this.deadline = ms ? this.startedAt + ms : null;
    if (ms) this.timer = setTimeout(() => this.endTurn(), ms);
    this.touch();
    this.changed();
    return { ok: true };
  }

  // Штрих від художника → те саме іншим (index.js, streams). Невалідне — null (нікому не йде).
  drawOp(seat, op) {
    if (this.status !== 'playing' || this.phase !== 'draw' || seat !== this.drawer || !op) return null;
    const pts = (list, n) => {
      if (!Array.isArray(list) || list.length % 2 || list.length > 400 || (n && list.length !== n)) return null;
      return list.map((v, i) => Math.max(0, Math.min(i % 2 ? H : W, Math.round(Number(v) || 0))));
    };
    const add = (t, item) => {
      if (this.strokes.length >= MAX_STROKES || this.points + item.p.length > MAX_POINTS) return null;
      this.strokes.push(item);
      this.points += item.p.length;
      return { turn: this.turnNo, t, ...item };
    };
    if (op.t === 's') { // штрих пензлем або гумкою
      const p = pts(op.p);
      if (!p || !p.length || !(PALETTE.includes(op.c) || op.c === ERASE) || !okSize(op.w)) return null;
      return add('s', { c: op.c, w: op.w, p });
    }
    if (op.t === 'g') { // фігура
      const p = pts(op.p, 4);
      if (!p || !SHAPES.includes(op.k) || !PALETTE.includes(op.c) || !okSize(op.w)) return null;
      return add('g', { k: op.k, c: op.c, w: op.w, p });
    }
    if (op.t === 'f') { // заливка
      const p = pts(op.p, 2);
      if (!p || !PALETTE.includes(op.c)) return null;
      return add('f', { k: 'fill', c: op.c, p });
    }
    if (op.t === 'm') { // продовження штриха
      const p = pts(op.p);
      const last = this.strokes[this.strokes.length - 1];
      if (!p || !p.length || !last || last.k || this.points + p.length > MAX_POINTS) return null;
      last.p.push(...p);
      this.points += p.length;
      return { turn: this.turnNo, t: 'm', p };
    }
    if (op.t === 'u') {
      const gone = this.strokes.pop();
      if (gone) this.points -= gone.p.length;
      return { turn: this.turnNo, t: 'u' };
    }
    if (op.t === 'x') {
      this.strokes = [];
      this.points = 0;
      return { turn: this.turnNo, t: 'x' };
    }
    return null;
  }

  // «Не знаю» — гравець більше не вгадує цей хід (хід закінчиться, коли всі вгадали або пасували).
  pass(seat) {
    if (this.status !== 'playing' || this.phase !== 'draw') return { error: T('Зараз не можна', 'Not right now') };
    if (seat === this.drawer || this.guessed.has(seat)) return { ok: true };
    this.passed.add(seat);
    this.touch();
    this.checkProgress();
    this.changed();
    return { ok: true };
  }

  // Художник здається — показуємо відповідь, без очок.
  giveUp(seat) {
    if (this.status !== 'playing' || this.phase !== 'draw') return { error: T('Зараз не можна', 'Not right now') };
    if (seat !== this.drawer) return { error: T('Здатися може лише художник', 'Only the artist can give up') };
    this.endTurn(T('Художник здався', 'The artist gave up'));
    return { ok: true };
  }

  snapshot() {
    return { ok: true, turn: this.turnNo, strokes: this.phase === 'draw' || this.phase === 'reveal' ? this.strokes : [] };
  }

  // Чат під час малювання: правильна відповідь — прихована (і очки), «майже» — бачать автор і художник,
  // тих, хто вже вгадав, — лише вони й художник; художник не може написати відповідь.
  screenChat(seat, text) {
    if (this.status !== 'playing' || this.phase !== 'draw' || !this.word) return null;
    if (seat === this.drawer) {
      return mentions(text, this.word) ? { hide: true, reply: { error: T('Не підказуй відповідь 🙂', 'Don’t give the answer away 🙂') } } : null;
    }
    const insiders = [this.drawer, ...this.guessed.keys()];
    if (this.guessed.has(seat)) return { only: insiders };
    const verdict = judge(text, this.word);
    if (verdict === 'correct') {
      this.score(seat);
      return { hide: true, reply: { ok: true, correct: true } };
    }
    if (verdict === 'close') return { only: [...insiders, seat], reply: { ok: true, close: true } };
    return null;
  }

  score(seat) {
    const ms = this.options.drawSeconds * 1000;
    let points;
    if (ms) points = Math.round((GUESS_MIN + (GUESS_MAX - GUESS_MIN) * (Math.max(0, this.deadline - Date.now()) / ms)) / 5) * 5;
    else points = Math.max(GUESS_MIN, GUESS_MAX - GUESS_STEP * this.guessed.size); // без таймера — за порядком
    this.passed.delete(seat);
    if (!this.guessed.size) points += FIRST_BONUS;
    this.guessed.set(seat, points);
    this.scores[seat] += points;
    this.scores[this.drawer] += DRAWER_EACH;
    this.drawerGain += DRAWER_EACH;
    const name = this.seats[seat].name;
    this.postChat?.(this.addSystemChat(T(`✅ ${name} вгадує!`, `✅ ${name} got it!`)));
    this.touch();
    this.checkProgress();
    this.changed();
  }

  // Хід закінчується, коли вгадали всі, хто онлайн (крім художника).
  checkProgress() {
    if (this.phase !== 'draw') return;
    const guessers = this.online().filter((i) => i !== this.drawer);
    if (guessers.length && guessers.every((i) => this.guessed.has(i) || this.passed.has(i))) this.endTurn();
  }

  endTurn(reason = null) {
    if (this.phase === 'reveal' || this.status !== 'playing') return;
    clearTimeout(this.timer);
    if (!this.word) return this.nextTurn(); // художник вийшов, не обравши слова — одразу далі
    this.phase = 'reveal';
    this.notice = reason;
    this.history.push({ word: this.publicWord(), drawer: this.drawer, drawerName: this.seats[this.drawer]?.name || '', guessed: Object.fromEntries(this.guessed) });
    this.postChat?.(this.addSystemChat(T(`Це було: ${this.word.uk}`, `It was: ${this.word.en}`)));
    this.deadline = Date.now() + REVEAL_MS;
    this.timer = setTimeout(() => this.nextTurn(), REVEAL_MS);
    this.changed();
  }

  finish() {
    this.resetTurn();
    this.status = 'finished';
    this.changed();
  }

  publicWord(w = this.word) {
    return w && { key: w.key, cat: w.cat, catLabel: CATS[w.cat].label, catIcon: CATS[w.cat].icon, text: T(w.uk, w.en), img: w.img };
  }

  publicState() {
    const state = {
      code: this.code,
      solo: false,
      options: this.options,
      capacity: this.capacity,
      minPlayers: MIN_PLAYERS,
      seats: this.publicSeats(),
      host: this.host(),
      status: this.status,
      phase: this.phase,
      turn: this.turnNo,
      lap: this.lap || 0,
      laps: this.options.laps,
      drawer: this.drawer,
      next: this.status === 'playing' ? this.order.slice(this.turnIdx + 1).filter((i) => this.seats[i]) : [],
      category: (this.phase === 'draw' || this.phase === 'reveal') && this.word ? { id: this.word.cat, ...CATS[this.word.cat] } : null,
      guessed: Object.fromEntries(this.guessed),
      passed: [...this.passed],
      drawerGain: this.drawerGain,
      scores: this.scores,
      deadline: this.deadline,
      startedAt: this.phase === 'draw' ? this.startedAt : null,
      drawSeconds: this.options.drawSeconds,
      points: { max: GUESS_MAX, min: GUESS_MIN, first: FIRST_BONUS, step: GUESS_STEP }, // для «вгадаєш зараз — +N» у клієнті
      serverNow: Date.now(),
      notice: this.phase === 'reveal' ? this.notice || null : null,
      answer: this.phase === 'reveal' ? this.publicWord() : null,
      palette: PALETTE,
      size: SIZE,
      erase: ERASE,
      history: this.status === 'finished' ? this.history : [],
    };
    if (process.env.SKETCH_TEST_ANSWER === '1') {
      state.testAnswer = this.word ? this.word.uk : null;
      state.testChoices = this.choices.map((w) => w.key);
    }
    return state;
  }

  // Слово — художнику (і варіанти на вибір) та тим, хто вже вгадав.
  privateState(seat) {
    const sees = seat === this.drawer || this.guessed.has(seat);
    return {
      choices: this.phase === 'choose' && seat === this.drawer ? this.choices.map((w) => this.publicWord(w)) : null,
      word: this.phase === 'draw' && sees ? this.publicWord() : null,
    };
  }
}

module.exports = { SketchRoom, judge, mentions, PALETTE, SIZE, ERASE, ALLOWED_LAPS, ALLOWED_TIMES };
