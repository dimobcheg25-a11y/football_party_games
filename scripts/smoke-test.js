// Прогін гри ботами через справжній сервер: класика вдвох (хід, помилка, повтор, таймаут, перемога, реванш, вихід),
// режими складності, великі поля, гра утрьох і вчотирьох.
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { io } = require('socket.io-client');
const { players, matches } = require('../server/data');

const PORT = 3000 + Math.floor(Math.random() * 1000);
const URL = `http://localhost:${PORT}`;

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT, CLAIM_WIN_MS: '1500' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const emit = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
const nextState = (s, pred = () => true) =>
  new Promise((res) => {
    const h = (st) => { if (pred(st)) { s.off('state', h); res(st); } };
    s.on('state', h);
  });

function answerFor(state, cell, exclude = []) {
  const n = state.grid.size;
  const r = state.grid.rows[Math.floor(cell / n)].id;
  const c = state.grid.cols[cell % n].id;
  return players.find((p) => matches(p, r) && matches(p, c) && !state.usedIds.includes(p.id) && !exclude.includes(p.id));
}
function wrongFor(state, cell) {
  const n = state.grid.size;
  const r = state.grid.rows[Math.floor(cell / n)].id;
  const c = state.grid.cols[cell % n].id;
  return players.find((p) => !(matches(p, r) && matches(p, c)));
}

async function main() {
  await new Promise((res) => server.stdout.on('data', (d) => d.toString().includes('запущена') && res()));
  const a = io(URL);
  const b = io(URL);

  // створення з таймером 15 с
  const created = await emit(a, 'create', { name: 'Аня', turnSeconds: 15 });
  assert.ok(created.ok && created.code.length === 5, 'кімната створена');
  console.log('✓ кімната', created.code);

  const bad = await emit(b, 'join', { code: 'ZZZZZ', name: 'Борис' });
  assert.ok(bad.error, 'неіснуюча кімната → помилка');

  const started = nextState(a, (s) => s.status === 'playing');
  const joined = await emit(b, 'join', { code: created.code, name: 'Борис' });
  assert.strictEqual(joined.seat, 1);
  let st = await started;
  assert.strictEqual(st.turn, 0);
  assert.ok(st.deadline > Date.now(), 'є дедлайн ходу');
  assert.ok(!('answers' in st.grid), 'відповіді не відправляються клієнтам');
  console.log('✓ гра почалась:', st.grid.rows.map((r) => r.label).join(', '), '×', st.grid.cols.map((c) => c.label).join(', '));

  // чат: повідомлення доходить до іншого гравця; порожні й надто часті — відхиляються
  const got = new Promise((res) => b.once('chat', res));
  assert.ok((await emit(a, 'chat', '  Привіт, <b>удачі</b>!  ')).ok);
  const msg = await got;
  assert.strictEqual(msg.text, 'Привіт, <b>удачі</b>!');
  assert.strictEqual(msg.seat, 0);
  assert.ok((await emit(a, 'chat', 'ще одне')).error, 'надто часто — відхилено');
  assert.ok((await emit(b, 'chat', '   ')).error, 'порожнє — відхилено');
  console.log('✓ чат працює');

  // хід не в свою чергу
  assert.ok((await emit(b, 'move', { cell: 0, playerId: answerFor(st, 0).id })).error, 'чужий хід відхилено');

  // правильний хід А в клітинку 0
  const p0 = answerFor(st, 0);
  const countsBefore = st.grid.answerCounts;
  let wait = nextState(b, (s) => s.cells[0]);
  const r1 = await emit(a, 'move', { cell: 0, playerId: p0.id });
  assert.ok(r1.correct, 'правильна відповідь');
  st = await wait;
  assert.strictEqual(st.turn, 1);
  assert.ok('photo' in st.cells[0].player, 'клітинка містить поле фото');
  console.log('✓ А поставив', st.cells[0].player.uk);
  // лічильник варіантів: поставлений гравець більше не рахується ні в цій, ні в інших клітинках, де він підходив
  st.grid.answerCounts.forEach((n, i) => {
    const r = st.grid.rows[Math.floor(i / 3)].id, c = st.grid.cols[i % 3].id;
    const had = matches(players.find((x) => x.id === p0.id), r) && matches(players.find((x) => x.id === p0.id), c);
    assert.strictEqual(n, countsBefore[i] - (had ? 1 : 0), `клітинка ${i}: лічильник оновився`);
  });
  console.log('✓ лічильники варіантів зменшились там, де підходив', st.cells[0].player.uk);

  // Б пробує того ж гравця в іншу клітинку — заборонено, хід не втрачається
  const r2 = await emit(b, 'move', { cell: 4, playerId: p0.id });
  assert.ok(r2.error && r2.error.includes('вже був'), 'повтор гравця заборонено');
  console.log('✓ повтор заборонено:', r2.error);

  // Б помиляється — хід переходить до А
  wait = nextState(a, (s) => s.lastEvent?.type === 'miss');
  const r3 = await emit(b, 'move', { cell: 4, playerId: wrongFor(st, 4).id });
  assert.strictEqual(r3.correct, false);
  st = await wait;
  assert.strictEqual(st.turn, 0);
  assert.ok(st.lastEvent.failed.length > 0, 'вказано, яку умову не виконано');
  console.log('✓ помилка → хід до суперника (не «' + st.lastEvent.failed.join('», не «') + '»)');

  // А займає 1, Б пропускає, А займає 2 → перемога в ряду
  wait = nextState(b, (s) => s.cells[1]);
  await emit(a, 'move', { cell: 1, playerId: answerFor(st, 1).id });
  st = await wait;
  wait = nextState(a, (s) => s.turn === 0 && s.lastEvent?.type === 'skip');
  await emit(b, 'skip');
  st = await wait;
  const fin = nextState(b, (s) => s.status === 'finished');
  await emit(a, 'move', { cell: 2, playerId: answerFor(st, 2).id });
  st = await fin;
  assert.deepStrictEqual(st.winners, [0]);
  assert.deepStrictEqual(st.winLine, [0, 1, 2]);
  assert.deepStrictEqual(st.scores, [1, 0]);
  assert.ok(!('reveal' in st), 'після гри відповіді не розкриваються');
  console.log('✓ перемога А, рахунок', st.scores.join(':'));

  // реванш — починає Б
  await emit(a, 'rematch');
  const re = nextState(a, (s) => s.status === 'playing');
  await emit(b, 'rematch');
  st = await re;
  assert.strictEqual(st.turn, 1, 'у реванші починає інший гравець');
  assert.strictEqual(st.usedIds.length, 0);
  console.log('✓ реванш, починає Б');

  // таймаут: Б не ходить 15 с → хід до А
  console.log('… чекаю таймаут 15 с');
  st = await nextState(a, (s) => s.lastEvent?.type === 'timeout');
  assert.strictEqual(st.turn, 0);
  console.log('✓ таймаут → хід перейшов');

  // перепідключення за токеном
  a.disconnect();
  const a2 = io(URL);
  const back = await emit(a2, 'join', { code: created.code, name: 'Аня', token: created.token });
  assert.strictEqual(back.seat, 0, 'повернулась на своє місце');
  console.log('✓ перепідключення');

  // кімната без ліміту часу
  const c = io(URL);
  const unl = await emit(c, 'create', { name: 'Вова', turnSeconds: 0 });
  const d = io(URL);
  const st0 = nextState(c, (s) => s.status === 'playing');
  await emit(d, 'join', { code: unl.code, name: 'Гена' });
  assert.strictEqual((await st0).deadline, null, 'без ліміту — немає дедлайну');
  // відхилена нічия — гра йде далі
  let w = nextState(c, (s) => s.lastEvent?.type === 'drawDeclined');
  await emit(c, 'offerDraw');
  await emit(d, 'declineDraw');
  let sd = await w;
  assert.strictEqual(sd.status, 'playing');
  assert.strictEqual(sd.drawVotes.length, 0);
  console.log('✓ нічию відхилено — граємо далі');
  // нічия за згодою
  await emit(c, 'offerDraw');
  const dr = nextState(c, (s) => s.status === 'finished');
  await emit(d, 'offerDraw');
  assert.deepStrictEqual((await dr).winners, []);
  console.log('✓ без ліміту часу + нічия за згодою');

  // третій гравець не може зайти
  const e = io(URL);
  assert.ok((await emit(e, 'join', { code: unl.code, name: 'Зайвий' })).error, 'кімната повна');
  console.log('✓ третій гравець не пройшов');

  // реванш: Вова хоче, Гена виходить → Вова лишається в кімнаті й чекає іншого
  await emit(c, 'rematch');
  w = nextState(c, (s) => s.status === 'waiting');
  await emit(d, 'leave');
  sd = await w;
  assert.strictEqual(sd.notice.type, 'left');
  assert.strictEqual(sd.notice.name, 'Гена');
  assert.strictEqual(sd.you, 0);
  assert.deepStrictEqual(sd.scores, [0, 0]);
  console.log('✓ суперник вийшов → кімната чекає нового гравця');

  // новий друг заходить за тим самим посиланням
  const f = io(URL);
  w = nextState(c, (s) => s.status === 'playing');
  const fj = await emit(f, 'join', { code: unl.code, name: 'Іра' });
  assert.strictEqual(fj.seat, 1);
  sd = await w;
  assert.strictEqual(sd.seats[1].name, 'Іра');
  console.log('✓ новий суперник зайшов, гра почалась');

  // Іра зникла → Вова забирає перемогу (у тесті поріг 1.5 с), але лише коли Іра заважає грі — зараз її хід
  assert.ok((await emit(c, 'claimWin')).error, 'поки суперник онлайн — не можна');
  if (sd.turn === 0) {
    w = nextState(c, (s) => s.turn === 1);
    await emit(c, 'skip');
    sd = await w;
  }
  f.disconnect();
  await new Promise((r) => setTimeout(r, 1800));
  w = nextState(c, (s) => s.status === 'finished');
  assert.ok((await emit(c, 'claimWin')).ok);
  sd = await w;
  assert.deepStrictEqual(sd.winners, [0]);
  assert.strictEqual(sd.endReason, 'abandoned');
  console.log('✓ суперник офлайн → перемогу забрано');

  // обидва вийшли → кімнати більше нема (Іра повертається за токеном і теж виходить)
  const f2 = io(URL);
  await emit(f2, 'join', { code: unl.code, name: 'Іра', token: fj.token });
  await emit(f2, 'leave');
  await emit(c, 'leave');
  f2.close();
  assert.ok((await emit(e, 'join', { code: unl.code, name: 'Хтось' })).error, 'порожню кімнату видалено');
  console.log('✓ порожню кімнату видалено');

  // складний режим
  const h1 = io(URL);
  const h2 = io(URL);
  const hr = await emit(h1, 'create', { name: 'Хард', turnSeconds: 20, mode: 'hard' });
  w = nextState(h1, (s) => s.status === 'playing');
  await emit(h2, 'join', { code: hr.code, name: 'Гість' });
  sd = await w;
  assert.strictEqual(sd.mode, 'hard');
  const normalOnly = new Set(require('../server/grid').MODES.normal.categories);
  console.log('✓ складний режим:', [...sd.grid.rows, ...sd.grid.cols].map((c) => c.label + (normalOnly.has(c.id) ? '' : '*')).join(', '));
  h1.close();
  h2.close();

  // легкий режим — лише «легкі» категорії, мінімум 10 варіантів у клітинці
  const e1 = io(URL);
  const e2 = io(URL);
  const er = await emit(e1, 'create', { name: 'Легко', turnSeconds: 30, mode: 'easy' });
  w = nextState(e1, (s) => s.status === 'playing');
  await emit(e2, 'join', { code: er.code, name: 'Гість' });
  sd = await w;
  assert.strictEqual(sd.mode, 'easy');
  const easyCats = new Set(require('../server/grid').MODES.easy.categories);
  assert.ok([...sd.grid.rows, ...sd.grid.cols].every((c) => easyCats.has(c.id)), 'лише категорії легкого режиму');
  assert.ok(sd.grid.answerCounts.every((n) => n >= 10), 'у кожній клітинці ≥10 варіантів');
  console.log('✓ легкий режим:', [...sd.grid.rows, ...sd.grid.cols].map((c) => c.label).join(', '), '| мін', Math.min(...sd.grid.answerCounts));
  e1.close();
  e2.close();

  // «Фанат» і «Мікс» — нові рівні
  for (const mode of ['fan', 'mix']) {
    const m1 = io(URL);
    const m2 = io(URL);
    const mr = await emit(m1, 'create', { name: 'Режим', turnSeconds: 30, mode });
    w = nextState(m1, (s) => s.status === 'playing');
    await emit(m2, 'join', { code: mr.code, name: 'Гість' });
    sd = await w;
    assert.strictEqual(sd.mode, mode);
    const allowed = new Set(require('../server/grid').MODES[mode].categories);
    assert.ok([...sd.grid.rows, ...sd.grid.cols].every((c) => allowed.has(c.id)), 'категорії режиму');
    assert.ok(sd.grid.answerCounts.every((n) => n >= 3), 'у клітинках є відповіді');
    console.log(`✓ режим ${mode}:`, [...sd.grid.rows, ...sd.grid.cols].map((c) => c.label).join(', '));
    m1.close();
    m2.close();
  }

  // ── утрьох: «збір ліній» 6×6
  const t = [io(URL), io(URL), io(URL)];
  const tr = await emit(t[0], 'create', { name: 'Перший', turnSeconds: 0, mode: 'easy', board: 'lines', players: 3 });
  await emit(t[1], 'join', { code: tr.code, name: 'Другий' });
  w = nextState(t[0], (s) => s.status === 'playing');
  await emit(t[2], 'join', { code: tr.code, name: 'Третій' });
  sd = await w;
  assert.strictEqual(sd.capacity, 3);
  assert.strictEqual(sd.grid.size, 6);
  assert.strictEqual(sd.cells.length, 36);
  assert.strictEqual(sd.board.scoring, 'points');
  console.log('✓ утрьох, 6×6 «збір ліній»:', sd.grid.rows.length + sd.grid.cols.length, 'категорій');
  // ходи по колу: 0 → 1 → 2 → 0
  w = nextState(t[0], (s) => s.turn === 1);
  assert.ok((await emit(t[0], 'move', { cell: 0, playerId: answerFor(sd, 0).id })).correct);
  sd = await w;
  w = nextState(t[0], (s) => s.turn === 2);
  await emit(t[1], 'skip');
  sd = await w;
  // третій здається → вибуває, гра триває, хід до першого
  w = nextState(t[0], (s) => s.out.includes(2));
  await emit(t[2], 'surrender');
  sd = await w;
  assert.strictEqual(sd.status, 'playing');
  assert.strictEqual(sd.turn, 0);
  console.log('✓ хід по колу; третій здався — гра триває без нього');
  // нічия: двоє активних погоджуються → кінець
  w = nextState(t[0], (s) => s.status === 'finished');
  await emit(t[0], 'offerDraw');
  await emit(t[1], 'offerDraw');
  sd = await w;
  assert.strictEqual(sd.endReason, 'agreed');
  console.log('✓ нічия — коли погодились усі активні');
  // реванш утрьох — починає наступний
  w = nextState(t[0], (s) => s.status === 'playing');
  for (const sock of t) await emit(sock, 'rematch');
  sd = await w;
  assert.strictEqual(sd.turn, 1, 'у реванші починає наступний гравець');
  assert.strictEqual(sd.out.length, 0);
  // другий виходить посеред гри → гра триває вдвох, новий гравець зайти не може
  w = nextState(t[0], (s) => s.seats[1] === null);
  await emit(t[1], 'leave');
  sd = await w;
  assert.strictEqual(sd.status, 'playing');
  assert.notStrictEqual(sd.turn, 1);
  const late = io(URL);
  assert.ok((await emit(late, 'join', { code: tr.code, name: 'Запізнився' })).error, 'посеред гри зайти не можна');
  late.close();
  // перший здається → лишився один → він переміг
  w = nextState(t[0], (s) => s.status === 'finished');
  await emit(t[0], 'surrender');
  sd = await w;
  assert.deepStrictEqual(sd.winners, [2]);
  console.log('✓ вихід посеред гри утрьох; останній активний перемагає');
  t.forEach((x) => x.close());

  // ── вчотирьох на 5×5, і класика завжди вдвох
  const q = [io(URL), io(URL), io(URL), io(URL)];
  const qr = await emit(q[0], 'create', { name: 'А', turnSeconds: 20, mode: 'hard', board: 'five', players: 4 });
  for (let i = 1; i < 3; i++) await emit(q[i], 'join', { code: qr.code, name: 'Гравець' + i });
  w = nextState(q[0], (s) => s.status === 'playing');
  await emit(q[3], 'join', { code: qr.code, name: 'Гравець3' });
  sd = await w;
  assert.strictEqual(sd.capacity, 4);
  assert.strictEqual(sd.grid.size, 5);
  assert.strictEqual(sd.board.win, 4);
  console.log('✓ вчотирьох, 5×5 · 4 в ряд, складний:', sd.grid.rows.map((x) => x.label).join(', '));
  q.forEach((x) => x.close());
  const k = io(URL);
  const kstate = new Promise((res) => k.once('state', res));
  const kr = await emit(k, 'create', { name: 'Класик', board: 'classic', players: 4 });
  const ks = await kstate;
  assert.strictEqual(kr.ok, true);
  assert.strictEqual(ks.capacity, 2, 'класика — лише вдвох');
  k.close();
  console.log('✓ класика 3×3 завжди вдвох');

  console.log('\nУСІ ПЕРЕВІРКИ ПРОЙШЛИ');
  [a2, b, c, d, e, f].forEach((s) => s.close());
}

main()
  .catch((err) => {
    console.error('✗', err.message);
    process.exitCode = 1;
  })
  .finally(() => server.kill());
