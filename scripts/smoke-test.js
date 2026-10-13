// Прогін гри двома ботами через справжній сервер: створення, вхід, хід, помилка, повтор, таймаут, перемога, реванш.
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
  const r = state.grid.rows[Math.floor(cell / 3)].id;
  const c = state.grid.cols[cell % 3].id;
  return players.find((p) => matches(p, r) && matches(p, c) && !state.usedIds.includes(p.id) && !exclude.includes(p.id));
}
function wrongFor(state, cell) {
  const r = state.grid.rows[Math.floor(cell / 3)].id;
  const c = state.grid.cols[cell % 3].id;
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

  // хід не в свою чергу
  assert.ok((await emit(b, 'move', { cell: 0, playerId: answerFor(st, 0).id })).error, 'чужий хід відхилено');

  // правильний хід А в клітинку 0
  const p0 = answerFor(st, 0);
  let wait = nextState(b, (s) => s.board[0]);
  const r1 = await emit(a, 'move', { cell: 0, playerId: p0.id });
  assert.ok(r1.correct, 'правильна відповідь');
  st = await wait;
  assert.strictEqual(st.turn, 1);
  assert.ok('photo' in st.board[0].player, 'клітинка містить поле фото');
  console.log('✓ А поставив', st.board[0].player.uk);

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
  wait = nextState(b, (s) => s.board[1]);
  await emit(a, 'move', { cell: 1, playerId: answerFor(st, 1).id });
  st = await wait;
  wait = nextState(a, (s) => s.turn === 0 && s.lastEvent?.type === 'skip');
  await emit(b, 'skip');
  st = await wait;
  const fin = nextState(b, (s) => s.status === 'finished');
  await emit(a, 'move', { cell: 2, playerId: answerFor(st, 2).id });
  st = await fin;
  assert.strictEqual(st.winner, 0);
  assert.deepStrictEqual(st.winLine, [0, 1, 2]);
  assert.deepStrictEqual(st.scores, [1, 0]);
  assert.ok(st.reveal.some(Boolean), 'після гри показані можливі відповіді');
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
  assert.strictEqual(sd.drawOffer, null);
  console.log('✓ нічию відхилено — граємо далі');
  // нічия за згодою
  await emit(c, 'offerDraw');
  const dr = nextState(c, (s) => s.status === 'finished');
  await emit(d, 'offerDraw');
  assert.strictEqual((await dr).winner, 'draw');
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

  // Іра зникла → Вова забирає перемогу (у тесті поріг 1.5 с)
  assert.ok((await emit(c, 'claimWin')).error, 'поки суперник онлайн — не можна');
  f.disconnect();
  await new Promise((r) => setTimeout(r, 1800));
  w = nextState(c, (s) => s.status === 'finished');
  assert.ok((await emit(c, 'claimWin')).ok);
  sd = await w;
  assert.strictEqual(sd.winner, 0);
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

  console.log('\nУСІ ПЕРЕВІРКИ ПРОЙШЛИ');
  [a2, b, c, d, e, f].forEach((s) => s.close());
}

main()
  .catch((err) => {
    console.error('✗', err.message);
    process.exitCode = 1;
  })
  .finally(() => server.kill());
