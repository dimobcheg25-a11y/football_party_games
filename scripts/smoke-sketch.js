// Автотест «Тактичного ескізу» через справжній сервер: вибір слова (лише художник, три слова однієї категорії), штрихи (лише від
// художника й лише іншим), повний малюнок (snapshot), чат: правильна відповідь прихована, «майже» — лише автору й художнику,
// художник не може написати відповідь, чат тих, хто вгадав, — лише між ними; очки, повне коло, пізній вхід, англійська;
// фігури, заливка, гумка; «не знаю» і «здатися»; гра без таймера (очки за порядком); словник підказок.
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { io } = require('socket.io-client');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const URL = `http://localhost:${PORT}`;
const GAME = `${URL}/sketch`;

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT, SKETCH_TEST_ANSWER: '1', SKETCH_REVEAL_MS: '300' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const emit = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const last = new Map(); // сокет → останній стан
const chats = new Map(); // сокет → отримані повідомлення чату
const draws = new Map(); // сокет → отримані штрихи
const nextState = (s, pred = () => true) =>
  new Promise((res) => {
    if (last.has(s) && pred(last.get(s))) return res(last.get(s));
    const h = (st) => { if (pred(st)) { s.off('state', h); res(st); } };
    s.on('state', h);
  });
function bot(lang) {
  const s = io(GAME, lang ? { auth: { lang } } : undefined);
  chats.set(s, []);
  draws.set(s, []);
  s.on('state', (st) => last.set(s, st));
  s.on('chat', (m) => chats.get(s).push(m));
  s.on('draw', (op) => draws.get(s).push(op));
  return s;
}
// Літера в слові замінена — для «майже».
const typo = (w) => { const i = Math.floor(w.length / 2); return w.slice(0, i) + (w[i] === 'о' ? 'а' : 'о') + w.slice(i + 1); };

async function main() {
  await new Promise((res) => server.stdout.on('data', (d) => d.toString().includes('запущено') && res()));

  const games = await (await fetch(`${URL}/api/games`)).json();
  assert.ok(games.some((g) => g.id === 'sketch' && g.title === 'Тактичний ескіз' && !g.solo), 'гра є в каталозі, лише з друзями');
  assert.strictEqual((await fetch(`${URL}/sketch/`)).status, 200);
  const dict = await (await fetch(`${URL}/api/sketch/words?lang=en`)).json();
  assert.ok(dict.length > 900 && dict.every((w) => w.t && w.c && w.v.length), 'словник підказок');
  assert.ok(dict.some((w) => w.t === 'Offside') && !dict.some((w) => w.t === 'Офсайд'), 'словник — мовою запиту');

  const [a, b, c] = [bot(), bot(), bot('en')];
  const res = await emit(a, 'create', { name: 'Аня', laps: 1, drawSeconds: 60, difficulty: 'easy' });
  assert.ok(res.ok);
  const code = res.code;
  assert.strictEqual((await (await fetch(`${URL}/api/sketch/room/${code}`)).json()).options.laps, 1);
  assert.ok((await emit(a, 'start')).error, 'сам — не починаємо');
  await emit(b, 'join', { code, name: 'Борис' });
  await emit(c, 'join', { code, name: 'Віра' });
  assert.ok((await emit(b, 'start')).error, 'почати може лише господар');
  assert.ok((await emit(a, 'start')).ok);
  const socks = [a, b, c];
  const seatOf = (s) => last.get(s).you;
  const sockOf = (seat) => socks.find((s) => seatOf(s) === seat);

  const drawn = new Set();
  const cats = [];
  for (let turn = 1; turn <= 3; turn++) {
    const states = await Promise.all(socks.map((s) => nextState(s, (x) => x.turn === turn && x.phase === 'choose')));
    const drawer = states[0].drawer;
    assert.ok(!drawn.has(drawer), 'кожен малює раз за коло');
    drawn.add(drawer);
    const d = sockOf(drawer);
    const guessers = socks.filter((s) => s !== d);
    // вибір: три слова однієї категорії — лише художнику
    const mine = last.get(d);
    assert.strictEqual(mine.choices.length, 3);
    assert.strictEqual(new Set(mine.choices.map((w) => w.cat)).size, 1, 'три слова однієї категорії');
    cats.push(mine.choices[0].cat);
    guessers.forEach((s) => assert.strictEqual(last.get(s).choices, null, 'іншим вибору не видно'));
    assert.ok((await emit(guessers[0], 'choose', { key: mine.choices[0].key })).error, 'обирає лише художник');
    assert.ok((await emit(d, 'choose', { key: mine.choices[1].key })).ok);
    await Promise.all(socks.map((s) => nextState(s, (x) => x.turn === turn && x.phase === 'draw')));
    const answer = last.get(d).testAnswer;
    assert.ok(last.get(d).word?.text, 'художник бачить слово (своєю мовою)');
    guessers.forEach((s) => assert.strictEqual(last.get(s).word, null, 'гравці слова не бачать'));
    assert.ok(/_/.test(last.get(guessers[0]).hint), 'пропуски замість літер');

    if (turn === 1) {
      // ── штрихи: від художника → іншим; від гравця й невалідні — нікому
      guessers.forEach((s) => draws.get(s).splice(0));
      d.emit('draw', { t: 's', c: '#1d1d1f', w: 6, p: [10, 10] });
      d.emit('draw', { t: 'm', p: [20, 20, 30, 30] });
      d.emit('draw', { t: 's', c: 'red', w: 6, p: [1, 1] }); // колір не з палітри
      guessers[0].emit('draw', { t: 's', c: '#1d1d1f', w: 6, p: [5, 5] }); // не художник
      await sleep(200);
      assert.deepStrictEqual(draws.get(guessers[1]).map((o) => o.t), ['s', 'm'], 'іншим — лише валідні штрихи художника');
      assert.strictEqual(draws.get(d).length, 0, 'художник свої штрихи назад не отримує');
      const snap = await emit(guessers[1], 'snapshot');
      assert.deepStrictEqual(snap.strokes.map((x) => x.p), [[10, 10, 20, 20, 30, 30]], 'повний малюнок');
      d.emit('draw', { t: 'u' });
      await sleep(100);
      assert.strictEqual((await emit(guessers[1], 'snapshot')).strokes.length, 0, 'назад — штрих прибрано');
      // фігура, заливка, гумка; невідома фігура — ні
      d.emit('draw', { t: 'g', k: 'rect', c: '#d7262e', w: 6, p: [100, 100, 300, 200] });
      d.emit('draw', { t: 'f', c: '#f7c531', p: [200, 150] });
      d.emit('draw', { t: 's', c: 'erase', w: 22, p: [150, 150] });
      d.emit('draw', { t: 'g', k: 'star', c: '#d7262e', w: 6, p: [1, 1, 2, 2] });
      await sleep(150);
      assert.deepStrictEqual((await emit(guessers[1], 'snapshot')).strokes.map((x) => x.k || x.c), ['rect', 'fill', 'erase'], 'фігура, заливка, гумка');
      d.emit('draw', { t: 'x' });
      await sleep(100);

      // ── чат
      assert.ok((await emit(d, 'chat', `це ${answer}`)).error, 'художник не пише відповідь');
      chats.forEach((l) => l.splice(0));
      assert.ok((await emit(guessers[0], 'chat', 'зовсім не те')).ok);
      await sleep(100);
      assert.ok(chats.get(guessers[1]).some((m) => m.text === 'зовсім не те'), 'хибну відповідь видно всім');
      if (answer.replace(/[^\p{L}]/gu, '').length >= 5) {
        await sleep(750);
        const close = await emit(guessers[0], 'chat', typo(answer));
        assert.ok(close.close, `«майже» для ${typo(answer)} (${answer})`);
        await sleep(100);
        assert.ok(!chats.get(guessers[1]).some((m) => m.text === typo(answer)), '«майже» не бачать інші гравці');
        assert.ok(chats.get(d).some((m) => m.text === typo(answer)), '«майже» бачить художник');
      }
    }

    // перший вгадує → приховано, системне повідомлення, очки; потім його чат — лише своїм
    await sleep(750);
    const before = last.get(a).scores.slice();
    const ok = await emit(guessers[0], 'chat', answer.toUpperCase());
    assert.ok(ok.correct, `правильна відповідь ${answer}`);
    const st = await nextState(guessers[1], (x) => x.guessed[seatOf(guessers[0])] != null);
    const pts = st.guessed[seatOf(guessers[0])];
    assert.ok(pts >= 100 && pts <= 120, `перший: ${pts} очок`);
    assert.strictEqual(st.scores[drawer], before[drawer] + 25, 'художнику +25');
    await sleep(100);
    assert.ok(!chats.get(guessers[1]).some((m) => m.text === answer.toUpperCase()), 'правильну відповідь не видно');
    assert.ok(chats.get(guessers[1]).some((m) => m.system), 'системне «вгадує»');
    assert.ok(last.get(guessers[0]).word, 'хто вгадав — бачить слово');
    if (turn === 1) {
      await sleep(750);
      await emit(guessers[0], 'chat', 'легко ж було');
      await sleep(100);
      assert.ok(!chats.get(guessers[1]).some((m) => m.text === 'легко ж було'), 'чат тих, хто вгадав, — не для всіх');
      assert.ok(chats.get(d).some((m) => m.text === 'легко ж було'));
      assert.ok(/^[A-Za-z ⚽]/.test(last.get(c).category.label), 'англійською — категорія англійською');
      // частина відповіді — «майже» («олімп» для «Олімпійські ігри»)
      const part = answer.split(' ')[0];
      if (part.length >= 6) {
        await sleep(750);
        assert.ok((await emit(guessers[1], 'chat', part.slice(0, part.length - 2))).close, `«майже» для частини ${part}`);
      }
    }
    if (turn === 3) assert.ok((await emit(guessers[0], 'giveUp')).error, 'здатися може лише художник');
    if (turn === 2) {
      // другий каже «не знаю» → хід закінчується (усі вгадали або пасували)
      assert.ok((await emit(guessers[1], 'pass')).ok);
      const rv = await nextState(a, (x) => x.turn === turn && x.phase === 'reveal');
      assert.strictEqual(Object.keys(rv.guessed).length, 1);
      assert.deepStrictEqual(rv.passed, [seatOf(guessers[1])]);
      continue;
    }
    // другий вгадує → усі вгадали → відповідь
    await emit(guessers[1], 'chat', answer);
    const rv = await nextState(a, (x) => x.turn === turn && x.phase === 'reveal');
    assert.strictEqual(rv.answer.text, answer);
    assert.strictEqual(Object.keys(rv.guessed).length, 2);
  }
  assert.strictEqual(new Set(cats).size, 3, 'категорії ходів різні (по колу)');
  const fin = await nextState(a, (x) => x.status === 'finished');
  assert.strictEqual(fin.history.length, 3);
  assert.deepStrictEqual(fin.scores.slice(0, 3).map((x) => x > 0), [true, true, true]);

  // ── нова гра: пізній вхід малює в цьому ж колі; вихід художника — хід далі
  assert.ok((await emit(a, 'start')).ok);
  await nextState(a, (x) => x.status === 'playing' && x.phase === 'choose');
  const d4 = bot();
  await emit(d4, 'join', { code, name: 'Гліб' });
  const late = await nextState(d4, (x) => x.status === 'playing');
  assert.ok(late.next.includes(late.you) || late.drawer === late.you, 'пізній гравець малюватиме в цьому колі');
  const drawerSock = [...socks, d4].find((s) => last.get(s)?.drawer === last.get(s)?.you);
  const t0 = last.get(a).turn;
  await emit(drawerSock, 'leave');
  const after = await nextState(a, (x) => x.turn === t0 + 1 || x.status === 'finished');
  assert.ok(after.turn === t0 + 1 || after.status === 'finished', 'художник вийшов — наступний хід');

  // ── без таймера: дедлайну немає, очки за порядком (перший 100 + 20); художник може здатися
  const [e1, e2, e3] = [bot(), bot(), bot()];
  const r2 = await emit(e1, 'create', { name: 'Єва', laps: 1, drawSeconds: 0 });
  assert.strictEqual(r2.ok, true);
  await emit(e2, 'join', { code: r2.code, name: 'Женя' });
  await emit(e3, 'join', { code: r2.code, name: 'Зоя' });
  assert.strictEqual(last.get(e1).options.drawSeconds, 0);
  await emit(e1, 'start');
  for (let turn = 1; turn <= 2; turn++) {
    const st0 = await nextState(e1, (x) => x.turn === turn && x.phase === 'choose');
    const dr = [e1, e2, e3].find((x) => last.get(x).you === st0.drawer);
    const others = [e1, e2, e3].filter((x) => x !== dr);
    await nextState(dr, (x) => x.turn === turn && x.choices);
    await emit(dr, 'choose', { key: last.get(dr).choices[0].key });
    const live = await nextState(e1, (x) => x.turn === turn && x.phase === 'draw');
    assert.strictEqual(live.deadline, null, 'без таймера — дедлайну немає');
    assert.ok(live.startedAt, 'час початку малюнка є');
    if (turn === 1) {
      await sleep(750);
      await emit(others[0], 'chat', live.testAnswer);
      await sleep(750);
      await emit(others[1], 'chat', live.testAnswer);
      const rv = await nextState(e1, (x) => x.turn === turn && x.phase === 'reveal');
      assert.deepStrictEqual(Object.values(rv.guessed).sort((x, y) => y - x), [120, 80], 'без таймера: 100 + 20 першому, далі 80');
    } else {
      assert.ok((await emit(dr, 'giveUp')).ok);
      const rv = await nextState(e1, (x) => x.turn === turn && x.phase === 'reveal');
      assert.ok(rv.notice && rv.answer, 'художник здався — відповідь показано');
    }
  }

  [...socks, d4, e1, e2, e3].forEach((s) => s.close());
  console.log('УСІ ПЕРЕВІРКИ «ТАКТИЧНОГО ЕСКІЗУ» ПРОЙШЛИ');
}

main()
  .catch((e) => {
    console.error('✗', e);
    process.exitCode = 1;
  })
  .finally(() => server.kill());
