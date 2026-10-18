// Автотест «Фотоархіву» через справжній сервер: фото з бази (хто загаданий, хто «міг бути на кадрі»), фото через наш сервер
// (без назви файлу), звіти гравців, соло (квадратик −4, відгаданий, нейтральна відповідь, хибна відкриває квадратик, «Здаюсь»),
// кімната «кожен свою сітку» (чужих квадратиків не видно), кімната «по черзі» (спершу квадратик, потім відповідь, пас), англійська.
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { io } = require('socket.io-client');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const URL = `http://localhost:${PORT}`;
const GAME = `${URL}/archive`;

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT, ARCHIVE_TEST_ANSWER: '1', GITHUB_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const emit = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
const last = new Map();
const nextState = (s, pred = () => true) =>
  new Promise((res) => {
    if (last.has(s) && pred(last.get(s))) return res(last.get(s));
    const h = (st) => { if (pred(st)) { s.off('state', h); res(st); } };
    s.on('state', h);
  });
function bot(lang) {
  const s = io(GAME, lang ? { auth: { lang } } : undefined);
  s.on('state', (st) => last.set(s, st));
  return s;
}

const { players, playerById } = require('../server/data');
const { shots, shotById, targetsOf, maybeOnShot } = require('../server/games/archive/shots');
// гравець, якого на цьому фото бути не могло, і той, хто міг (грав тоді за ту саму команду), але не загаданий
const outsider = (shot) => players.find((p) => !maybeOnShot(shot, p) && !shot.who.includes(p.id)).id;
const maybe = (shot, targets) => players.find((p) => !targets.includes(p.id) && maybeOnShot(shot, p))?.id;

async function main() {
  await new Promise((res) => server.stdout.on('data', (d) => d.toString().includes('запущено') && res()));

  const games = await (await fetch(`${URL}/api/games`)).json();
  const meta = games.find((g) => g.id === 'archive');
  assert.ok(meta && meta.solo && meta.friends && meta.beta, 'гра є в каталозі, соло, з друзями, бета');
  assert.strictEqual((await fetch(`${URL}/archive/`)).status, 200);

  // ── фото з бази
  assert.ok(shots.length > 500, 'фото зібрано');
  assert.strictEqual(new Set(shots.map((s) => s.id)).size, shots.length, 'мітки фото унікальні');
  assert.ok(shots.every((s) => s.who.length && s.author !== undefined && s.license !== undefined && s.page), 'у кожного фото — хто, автор, ліцензія');
  assert.ok(shots.some((s) => s.legend) && shots.some((s) => !s.legend), 'є легенди й сучасні');
  const counts = await (await fetch(`${URL}/api/archive/counts`)).json();
  assert.ok(counts.all.easy > 0 && counts.all.fan >= counts.all.easy, 'на «Фанаті» фото не менше, ніж на «Легкому»');
  const multi = shots.find((s) => targetsOf(s, 'fan').length >= 2);
  assert.ok(multi, 'є фото з кількома загаданими');
  assert.ok(multi.who.every((id) => maybeOnShot(multi, playerById.get(id))), 'позначені на фото — завжди «могли бути на кадрі»');
  console.log(`✓ фото: ${shots.length} (легенди — ${shots.filter((s) => s.legend).length}), на «Легкому» — ${counts.all.easy}`);

  // ── фото через наш сервер
  const img = await fetch(`${URL}/api/archive/img/${shots[0].id}`);
  if (img.status === 200) assert.ok(img.headers.get('content-type').startsWith('image/'), 'віддається картинка');
  else console.log(`  (Commons недоступний: ${img.status} — фото не перевірено)`);
  assert.strictEqual((await fetch(`${URL}/api/archive/img/nope`)).status, 404);

  // ── звіти гравців (без GITHUB_TOKEN — лише в консоль)
  const report = (body) => fetch(`${URL}/api/archive/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  assert.ok((await report({ shot: multi.id, kind: 'bad', reason: 'hidden', vid: 'smoke' })).ok, 'погане фото');
  assert.ok((await report({ shot: multi.id, kind: 'bad', reason: 'nope' })).error, 'без причини — ні');
  assert.ok((await report({ shot: multi.id, kind: 'missing', players: [multi.who[0]] })).error, 'уже позначеного не додаємо');
  assert.ok((await report({ shot: multi.id, kind: 'missing', players: [outsider(multi)], vid: 'smoke' })).ok, 'хто ще на фото');
  assert.ok((await report({ shot: 'nope', kind: 'bad', reason: 'other' })).error, 'невідоме фото');
  console.log('✓ звіти: погане фото з причиною, хто ще на фото; зайве — відхиляється');

  // ── соло
  const solo = bot();
  let res = await emit(solo, 'create', { name: 'Соло', solo: true, category: 'all', level: 'fan', rounds: 5, roundSeconds: 0 });
  assert.ok(res.ok);
  let st = await nextState(solo, (x) => x.phase === 'guess');
  const shot = shotById.get(st.shot.id);
  const targets = st.testAnswer.targets;
  assert.strictEqual(st.shot.count, targets.length, 'скільки загадано — видно одразу');
  assert.ok(!st.shot.file && !st.shot.desc && !st.shot.targets, 'підпис і відповіді — лише після кадру');
  assert.ok(st.shot.img.startsWith('/api/archive/img/') && !st.shot.img.includes(shot.file.slice(0, 8)), 'фото — без назви файлу');
  assert.strictEqual(st.mine.worth, 100);
  res = await emit(solo, 'open', { tile: 7 });
  assert.ok(res.ok);
  st = await nextState(solo, (x) => x.mine.open.length === 1);
  assert.strictEqual(st.mine.worth, 96, 'квадратик — мінус 4');
  assert.ok((await emit(solo, 'open', { tile: 99 })).error, 'такого квадратика немає');
  res = await emit(solo, 'guess', { playerId: targets[0] });
  assert.strictEqual(res.result, 'hit');
  assert.strictEqual(res.points, 96, 'відгаданий — 100 − 4 × відкритих');
  assert.ok((await emit(solo, 'guess', { playerId: targets[0] })).error, 'повтор не рахується');
  const neutralId = maybe(shot, targets);
  if (targets.length > 1 && neutralId) {
    res = await emit(solo, 'guess', { playerId: neutralId });
    assert.strictEqual(res.result, 'neutral');
    assert.ok(res.free && res.left === 2, 'перша нейтральна — без штрафу');
    st = await nextState(solo, (x) => x.mine.neutral.length === 1);
    assert.strictEqual(st.mine.open.length, 1, 'нейтральна не відкриває квадратик');
  }
  if (targets.length > 1) {
    const before = (await nextState(solo)).mine.open.length;
    res = await emit(solo, 'guess', { playerId: outsider(shot) });
    assert.strictEqual(res.result, 'miss');
    st = await nextState(solo, (x) => x.mine.open.length === before + 1);
    assert.ok(st.mine.wrong.length === 1, 'хибна відповідь відкриває ще квадратик');
    await emit(solo, 'finishRound');
  }
  st = await nextState(solo, (x) => x.phase === 'reveal');
  assert.strictEqual(st.scores[0], 96, 'знайдене лишається');
  assert.ok(st.shot.targets.length === targets.length && st.shot.page && 'author' in st.shot, 'після кадру — хто це, автор, посилання');
  assert.ok(st.shot.targets[0].by.includes(0), 'видно, хто кого відгадав');
  await emit(solo, 'next');
  st = await nextState(solo, (x) => x.phase === 'guess' && x.round === 2);
  assert.strictEqual(st.mine.open.length, 0, 'нове фото — сітка закрита');
  console.log(`✓ соло: квадратик −4, відгаданий +96, нейтральна без штрафу, хибна відкриває квадратик, «Здаюсь» — ${st.scores[0]} очок лишилось`);
  solo.close();

  // ── кімната «кожен свою сітку»
  const [a, b] = [bot(), bot()];
  res = await emit(a, 'create', { name: 'Аня', mode: 'own', rounds: 5, roundSeconds: 0, level: 'fan' });
  await emit(b, 'join', { code: res.code, name: 'Борис' });
  await emit(a, 'start');
  st = await nextState(a, (x) => x.phase === 'guess');
  await emit(a, 'open', { tile: 0 });
  await emit(a, 'open', { tile: 1 });
  const bView = await nextState(b, (x) => x.progress[0]?.open === 2);
  assert.strictEqual(bView.mine.open.length, 0, 'чужих квадратиків не видно');
  assert.strictEqual(bView.open, null);
  await emit(a, 'guess', { playerId: st.testAnswer.targets[0] });
  await emit(a, 'finishRound');
  st = await nextState(b, (x) => x.progress[0]?.done);
  assert.strictEqual(st.phase, 'guess', 'один здався — раунд іде');
  await emit(b, 'finishRound');
  st = await nextState(a, (x) => x.phase === 'reveal');
  assert.ok(st.roundPoints[0] === 92 && !st.roundPoints[1], 'Аня: 2 квадратики → 92');
  console.log('✓ кімната «кожен свою сітку»: квадратики й відповіді — свої, раунд — коли закінчили всі');
  a.close();
  b.close();

  // ── кімната «по черзі»
  const [c, d] = [bot(), bot()];
  res = await emit(c, 'create', { name: 'Віра', mode: 'turns', turnSeconds: 0, rounds: 5, level: 'fan' });
  await emit(d, 'join', { code: res.code, name: 'Гліб' });
  await emit(c, 'start');
  st = await nextState(c, (x) => x.phase === 'guess');
  const socks = [c, d];
  const first = st.active;
  const second = 1 - first;
  const tt = st.testAnswer.targets;
  assert.ok((await emit(socks[second], 'open', { tile: 3 })).error, 'відкриває той, чий хід');
  assert.ok((await emit(socks[first], 'guess', { playerId: tt[0] })).error, 'спершу квадратик');
  assert.ok((await emit(socks[first], 'open', { tile: 3 })).ok);
  assert.ok((await emit(socks[first], 'open', { tile: 4 })).error, 'за хід — один квадратик');
  res = await emit(socks[first], 'guess', { playerId: tt[0] });
  assert.strictEqual(res.points, 96);
  if (tt.length > 1) {
    st = await nextState(c, (x) => x.active === second);
    assert.ok(st.found.some((f) => f.id === tt[0] && f.seat === first), 'на спільній сітці видно відгаданого');
    assert.ok((await emit(socks[second], 'open', { tile: 3 })).error, 'відкритий не відкриваєш');
    await emit(socks[second], 'pass');
    st = await nextState(c, (x) => x.active === first);
    assert.strictEqual(st.named.at(-1).kind, 'pass');
  } else st = await nextState(c, (x) => x.phase === 'reveal');
  console.log('✓ кімната «по черзі»: спершу квадратик, потім відповідь, спільна сітка, пас');
  c.close();
  d.close();

  // ── англійська
  const en = bot('en');
  res = await emit(en, 'create', { name: 'En', solo: true, rounds: 5, roundSeconds: 0 });
  st = await nextState(en, (x) => x.phase === 'guess');
  res = await emit(en, 'guess', {});
  assert.strictEqual(res.error, 'Pick a player from the list');
  en.disconnect();
  console.log('✓ англійська');

  console.log('\nУСІ ПЕРЕВІРКИ «ФОТОАРХІВУ» ПРОЙШЛИ');
}

main()
  .then(() => { server.kill(); process.exit(0); })
  .catch((e) => { console.error('✗', e); server.kill(); process.exit(1); });
