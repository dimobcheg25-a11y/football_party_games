// Партія «Тактичного ескізу»: гравці по черзі малюють загадане (футболіст, клуб, термін, трофей/стадіон), решта пише відповіді в чат.
// Хід: choose (художник обирає одне з трьох слів однієї категорії; категорії йдуть по колу — однаково часто) → draw (малюнок
// наживо, пропуски з літерами, що відкриваються на ½ і ¾ часу) → reveal (відповідь, очки) → наступний художник. Кіл — 1/2/3.
// Очки: хто вгадав — 100→20 за часом, що лишився, першому +20; художнику — +25 за кожного, хто вгадав.
// Слово бачить лише художник і ті, хто вже вгадав (privateState); правильну відповідь у чаті не бачить ніхто (screenChat),
// чат тих, хто вгадав, — лише між ними й художником. Штрихи — окремою подією 'draw' (index.js), повний малюнок — дією snapshot.
const { BaseRoom } = require('../../core/base-room');
const { T } = require('../../core/i18n');
const { CATS, termWords, placeWords, clubWords, playersFor, norm } = require('./words');

const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;
const ALLOWED_LAPS = [1, 2, 3];
const ALLOWED_TIMES = [60, 80, 100];
const CHOOSE_MS = Number(process.env.SKETCH_CHOOSE_MS) || 15000;
const REVEAL_MS = Number(process.env.SKETCH_REVEAL_MS) || 6000;
const GUESS_MAX = 100;
const GUESS_MIN = 20;
const FIRST_BONUS = 20;
const DRAWER_EACH = 25;
// Малюнок: полотно 1000×750 (координати цілі), кольори й товщини — лише з наборів; межі — щоб не роздути кімнату.
const W = 1000;
const H = 750;
const PALETTE = ['#1d1d1f', '#1f4fd8', '#d7262e', '#1e8a3c', '#f2a93b', '#7a4a21', '#8a8f98', '#ffffff'];
const SIZES = [4, 9, 18, 36];
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
  const t = norm(text).replace(/ /g, '');
  if (!t) return 'miss';
  let best = 3;
  for (const v of word.variants) {
    const x = v.replace(/ /g, '');
    if (x === t) return 'correct';
    if (x.length >= 4) best = Math.min(best, distance(t, x) <= (x.length >= 9 ? 2 : 1) ? 1 : 3);
  }
  return best === 1 ? 'close' : 'miss';
}
// Чи є відповідь у тексті (художник не може її написати; від 4 літер, щоб «гол» не блокував «голова»).
function mentions(text, word) {
  const t = ` ${norm(text)} `;
  return word.variants.some((v) => v.replace(/ /g, '').length >= 4 && t.includes(` ${v} `));
}

// Пропуски: літери й цифри → «_», крім відкритих; пробіли, дефіси, лапки лишаються.
const isLetter = (ch) => /[\p{L}\p{N}]/u.test(ch);
function pattern(text, open) {
  return [...text].map((ch, i) => (isLetter(ch) && !open.has(i) ? '_' : ch)).join('');
}

class SketchRoom extends BaseRoom {
  constructor(code, onChange, opts = {}) {
    super(code, onChange, MAX_PLAYERS);
    this.options = {
      laps: ALLOWED_LAPS.includes(Number(opts.laps)) ? Number(opts.laps) : 2,
      drawSeconds: ALLOWED_TIMES.includes(Number(opts.drawSeconds)) ? Number(opts.drawSeconds) : 80,
      difficulty: opts.difficulty === 'easy' ? 'easy' : 'normal',
    };
    this.status = 'waiting'; // waiting | playing | finished
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.turnNo = 0;
    this.hintTimers = [];
    this.resetTurn();
  }

  resetTurn() {
    clearTimeout(this.timer);
    this.hintTimers.forEach(clearTimeout);
    this.hintTimers = [];
    this.phase = null; // choose | draw | reveal
    this.drawer = -1;
    this.choices = [];
    this.word = null;
    this.strokes = [];
    this.points = 0;
    this.guessed = new Map(); // seat → очки
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
    this.decks = {
      players: shuffle(playersFor(this.options.difficulty)),
      clubs: shuffle(clubWords),
      terms: shuffle(termWords),
      places: shuffle(placeWords),
    };
    this.catQueue = [];
    this.scores = Array(this.capacity).fill(0);
    this.history = [];
    this.lap = 1;
    this.order = shuffle(this.presentSeats());
    this.turnIdx = -1;
    this.status = 'playing';
    this.nextTurn();
    return { ok: true };
  }

  // Категорія ходу — по колу з перемішаних чотирьох (кожна трапляється однаково часто); три слова з неї на вибір.
  drawChoices() {
    if (!this.catQueue.length) this.catQueue = shuffle(Object.keys(CATS));
    const cat = this.catQueue.shift();
    const deck = this.decks[cat];
    return deck.splice(0, 3);
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
    // порядок, у якому відкриваються літери (для кожної мови свій)
    const order = (text) => shuffle([...text].map((ch, i) => (isLetter(ch) ? i : -1)).filter((i) => i >= 0));
    this.reveal = { uk: order(word.uk), en: order(word.en) };
    this.phase = 'draw';
    this.startedAt = Date.now();
    const ms = this.options.drawSeconds * 1000;
    this.deadline = this.startedAt + ms;
    this.timer = setTimeout(() => this.endTurn(), ms);
    for (const f of [0.5, 0.75]) this.hintTimers.push(setTimeout(() => this.changed(), ms * f + 50));
    this.touch();
    this.changed();
    return { ok: true };
  }

  // Скільки літер відкрито: на ½ часу — одна, на ¾ — ще одна (у словах від 6 літер); короткі слова — без підказок.
  openCount(text) {
    const letters = [...text].filter(isLetter).length;
    if (this.phase !== 'draw' || letters < 4) return 0;
    const f = (Date.now() - this.startedAt) / (this.options.drawSeconds * 1000);
    return (f >= 0.5 ? 1 : 0) + (f >= 0.75 && letters >= 6 ? 1 : 0);
  }

  hint() {
    if (!this.word) return null;
    const one = (lang) => pattern(this.word[lang], new Set(this.reveal[lang].slice(0, this.openCount(this.word[lang]))));
    return T(one('uk'), one('en'));
  }

  // Штрих від художника → те саме іншим (index.js, streams). Невалідне — null (нікому не йде).
  drawOp(seat, op) {
    if (this.status !== 'playing' || this.phase !== 'draw' || seat !== this.drawer || !op) return null;
    const pts = (list) => {
      if (!Array.isArray(list) || list.length % 2 || list.length > 400) return null;
      const out = list.map((v, i) => Math.max(0, Math.min(i % 2 ? H : W, Math.round(Number(v) || 0))));
      return out;
    };
    if (op.t === 's') {
      const p = pts(op.p);
      if (!p || !p.length || !PALETTE.includes(op.c) || !SIZES.includes(op.w) || this.strokes.length >= MAX_STROKES) return null;
      if (this.points + p.length > MAX_POINTS) return null;
      this.strokes.push({ c: op.c, w: op.w, p });
      this.points += p.length;
      return { turn: this.turnNo, t: 's', c: op.c, w: op.w, p };
    }
    if (op.t === 'm') {
      const p = pts(op.p);
      const last = this.strokes[this.strokes.length - 1];
      if (!p || !p.length || !last || this.points + p.length > MAX_POINTS) return null;
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
    const left = Math.max(0, this.deadline - Date.now()) / ms;
    let points = Math.round((GUESS_MIN + (GUESS_MAX - GUESS_MIN) * left) / 5) * 5;
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
    if (guessers.length && guessers.every((i) => this.guessed.has(i))) this.endTurn();
  }

  endTurn(reason = null) {
    if (this.phase === 'reveal' || this.status !== 'playing') return;
    clearTimeout(this.timer);
    this.hintTimers.forEach(clearTimeout);
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
    return w && { key: w.key, cat: w.cat, text: T(w.uk, w.en), img: w.img };
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
      category: this.phase === 'draw' || this.phase === 'reveal' ? (this.word ? { id: this.word.cat, ...CATS[this.word.cat] } : null)
        : this.phase === 'choose' && this.choices[0] ? { id: this.choices[0].cat, ...CATS[this.choices[0].cat] } : null,
      hint: this.phase === 'draw' ? this.hint() : null,
      guessed: Object.fromEntries(this.guessed),
      drawerGain: this.drawerGain,
      scores: this.scores,
      deadline: this.deadline,
      drawSeconds: this.options.drawSeconds,
      serverNow: Date.now(),
      notice: this.phase === 'reveal' ? this.notice || null : null,
      answer: this.phase === 'reveal' ? this.publicWord() : null,
      palette: PALETTE,
      sizes: SIZES,
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

module.exports = { SketchRoom, judge, mentions, pattern, PALETTE, SIZES, ALLOWED_LAPS, ALLOWED_TIMES };
