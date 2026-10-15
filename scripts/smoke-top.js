// Автотест «Топ-10» через справжній сервер: теми з бази, соло (очки за місце, помилки, вибір теми господарем),
// кімната «кожен свій топ» (чужих відповідей не видно), кімната «по черзі» (хід, життя, пас, кінець раунду).
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { io } = require('socket.io-client');
const { playerById } = require('../server/data');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const URL = `http://localhost:${PORT}`;
const GAME = `${URL}/top`;

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT, TOP_TEST_ANSWER: '1' },
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
function bot() {
  const s = io(GAME);
  s.on('state', (st) => last.set(s, st));
  return s;
}
// Відомі гравці, яких точно немає в топі.
const notIn = (st, n) => ['lionel-messi', 'andriy-shevchenko', 'zinedine-zidane', 'thierry-henry', 'kaka', 'luka-modric', 'wayne-rooney', 'neymar', 'kylian-mbappe']
  .filter((id) => playerById.has(id) && !st.testAnswer.includes(id)).slice(0, n);

async function main() {
  await new Promise((res) => server.stdout.on('data', (d) => d.toString().includes('запущено') && res()));

  const games = await (await fetch(`${URL}/api/games`)).json();
  assert.ok(games.some((g) => g.id === 'top'), 'гра є в каталозі');
  assert.strictEqual((await fetch(`${URL}/top/`)).status, 200);

  // ── теми з бази
  const { topicById } = require('../server/games/top/tops');
  const fees = topicById.get('fees');
  assert.strictEqual(fees.entries[0].p.id, 'neymar', 'найдорожчий трансфер — Неймар');
  assert.ok(fees.entries.some((e) => e.p.id === 'eden-hazard'), 'ручні трансфери (Азар) у топі');
  assert.strictEqual(topicById.get('tournament:ucl').entries[0].p.id, 'cristiano-ronaldo', 'ЛЧ: Роналду — найкращий бомбардир');
  const top5 = games.find((g) => g.id === 'top');
  assert.ok(top5.solo && top5.friends, 'на головній — чи можна соло і скільки гравців');
  const list20 = await (await fetch(`${URL}/api/top/topics?categories=goals&size=20`)).json();
  assert.ok(list20.length > 20 && list20.every((t) => t.category === 'goals'), 'список тем для господаря');
  console.log(`✓ теми: ${list20.length} тем «голи» для топ-20; найдорожчий трансфер — Неймар`);

  // ── соло: очки за місце, повтор, помилки
  const solo = bot();
  let res = await emit(solo, 'create', { name: 'Соло', solo: true, size: 5, lives: 3, rounds: 3, categories: ['transfers'], roundSeconds: 0 });
  assert.ok(res.ok);
  let st = await nextState(solo, (x) => x.phase === 'guess');
  assert.strictEqual(st.slots.length, 5);
  assert.deepStrictEqual(st.slots.map((x) => x.points), [1, 3, 6, 8, 10], 'нижчі місця — більше очок');
  assert.ok(!st.slots.some((x) => x.player), 'відповіді приховані');
  const lastId = st.testAnswer[4];
  const lastPlaces = st.testAnswer.map((id, i) => (id === lastId ? i : -1)).filter((i) => i >= 0);
  res = await emit(solo, 'guess', { playerId: lastId });
  assert.ok(res.correct);
  assert.strictEqual(res.points, lastPlaces.reduce((s, i) => s + st.slots[i].points, 0));
  st = await nextState(solo, (x) => x.mine?.found.length === lastPlaces.length);
  assert.strictEqual(st.scores[0], res.points);
  assert.ok((await emit(solo, 'guess', { playerId: lastId })).error, 'повтор не рахується');
  const wrong = notIn(st, 3);
  for (const id of wrong) await emit(solo, 'guess', { playerId: id });
  st = await nextState(solo, (x) => x.phase === 'reveal');
  assert.strictEqual(st.mine.wrong.length, 3);
  assert.ok(st.slots.every((x) => x.player), 'після раунду — увесь топ');
  assert.ok(st.slots[4].by.includes(0) && !st.slots[0].by.includes(0));
  console.log(`✓ соло: останнє місце +${res.points}, 3 помилки — раунд закінчено`);
  solo.close();

  // ── соло, тему обирає господар
  const picker = bot();
  await emit(picker, 'create', { name: 'Вибір', solo: true, size: 10, pick: 'host', categories: ['transfers', 'goals'] });
  st = await nextState(picker, (x) => x.phase === 'pick');
  assert.ok((await emit(picker, 'pickTopic', { topicId: 'nope' })).error);
  await emit(picker, 'pickTopic', { topicId: 'fees' });
  st = await nextState(picker, (x) => x.phase === 'guess');
  assert.strictEqual(st.topic.title, 'Найдорожчі трансфери в історії');
  assert.strictEqual(st.testAnswer[0], 'neymar');
  console.log('✓ господар обрав тему');
  // наступна тема — Ліга Європи: Дітера Мюллера немає в базі — його рядок відкрито одразу, без очок
  await emit(picker, 'giveUp');
  await emit(picker, 'next');
  st = await nextState(picker, (x) => x.phase === 'pick');
  await emit(picker, 'pickTopic', { topicId: 'tournament:uel' });
  st = await nextState(picker, (x) => x.phase === 'guess' && x.topic.id === 'tournament:uel');
  const miss = st.slots.findIndex((x) => x.missing);
  assert.ok(miss >= 0 && st.slots[miss].player.name && st.testAnswer[miss] === null, 'відсутній у базі — відкритий з іменем');
  for (const id of new Set(st.testAnswer.filter(Boolean))) await emit(picker, 'guess', { playerId: id });
  st = await nextState(picker, (x) => x.phase === 'reveal');
  assert.ok(!st.slots[miss].by.length, 'за відкритий рядок очок немає');
  console.log(`✓ Ліга Європи: ${st.slots[miss].player.name} відкритий одразу; решту вгадано — раунд закінчено`);
  const cats = await (await fetch(`${URL}/api/top/topics?categories=assists,cards&size=10`)).json();
  assert.ok(cats.some((t) => t.id === 'stat:GB1:assists') && cats.some((t) => t.category === 'cards'), 'асисти й картки');
  assert.ok(cats.every((t) => ['easy', 'normal', 'hard'].includes(t.level) && t.score >= 0), 'у кожної теми — рівень і популярність');
  // випадкові теми лише легкого рівня
  const easyBot = bot();
  await emit(easyBot, 'create', { name: 'Легкий', solo: true, size: 10, topicLevel: 'easy', rounds: 3 });
  st = await nextState(easyBot, (x) => x.phase === 'guess');
  assert.strictEqual(topicById.get(st.topic.id).level, 'easy', 'легка тема');
  console.log(`✓ рівні тем: випадкова легка — «${st.topic.title}»`);
  easyBot.close();
  picker.close();

  // ── кімната «кожен свій топ»
  const [a, b] = [bot(), bot()];
  res = await emit(a, 'create', { name: 'Аня', mode: 'own', size: 5, lives: 0, rounds: 3, categories: ['goals', 'apps'] });
  await emit(b, 'join', { code: res.code, name: 'Борис' });
  await emit(a, 'start');
  st = await nextState(a, (x) => x.phase === 'guess');
  const answer = st.testAnswer[2];
  await emit(a, 'guess', { playerId: answer });
  const bView = await nextState(b, (x) => x.progress[0]?.found >= 1);
  assert.ok(!JSON.stringify(bView.slots).includes(answer) && !bView.mine?.found?.length, 'чужих відповідей не видно');
  await emit(a, 'giveUp');
  await emit(b, 'giveUp');
  st = await nextState(a, (x) => x.phase === 'reveal');
  assert.ok(st.slots[2].by.includes(0) && !st.slots[2].by.includes(1));
  assert.ok(st.roundPoints[0] > 0 && !st.roundPoints[1]);
  console.log('✓ кімната «кожен свій топ»: свої відповіді приховані, після раунду видно, хто кого знайшов');
  a.close();
  b.close();

  // ── кімната «по черзі»: 2 гравці, 1 життя
  const [c, d] = [bot(), bot()];
  res = await emit(c, 'create', { name: 'Віра', mode: 'turns', size: 5, lives: 1, turnSeconds: 0, rounds: 3, categories: ['transfers'] });
  await emit(d, 'join', { code: res.code, name: 'Гліб' });
  await emit(c, 'start');
  st = await nextState(c, (x) => x.phase === 'guess');
  const socks = [c, d];
  const first = st.active;
  const second = 1 - first;
  assert.ok((await emit(socks[second], 'guess', { playerId: st.testAnswer[0] })).error, 'не свій хід');
  await emit(socks[first], 'guess', { playerId: notIn(st, 1)[0] }); // помилка → вибув
  st = await nextState(c, (x) => x.active === second);
  assert.strictEqual(st.lives[first], 0);
  assert.strictEqual(st.wrong.length, 1);
  res = await emit(socks[second], 'guess', { playerId: st.testAnswer[0] });
  assert.ok(res.correct);
  st = await nextState(c, (x) => x.slots[0].player);
  assert.deepStrictEqual(st.slots[0].by, [second], 'на спільній дошці — хто знайшов');
  assert.strictEqual(st.active, second, 'суперник вибув — ходиш знову');
  await emit(socks[second], 'pass');
  st = await nextState(c, (x) => x.phase === 'reveal');
  assert.strictEqual(st.scores[second], res.points);
  console.log('✓ кімната «по черзі»: хід, помилка забирає життя, пас, усі вибули — кінець раунду');
  c.close();
  d.close();

  // ── англійська: теми, тексти рядків і помилки — англійською (назви клубів — з team-names-en.json, можуть бути неповні)
  const cyr = /[А-Яа-яІіЇїЄєҐґ]/;
  const listEn = await (await fetch(`${URL}/api/top/topics?categories=transfers,goals,assists,apps,cards&size=10&lang=en`)).json();
  const badEn = listEn.filter((t) => t.kind !== 'club' && cyr.test(`${t.title} ${t.country || ''}`));
  assert.deepStrictEqual(badEn.map((t) => t.title), [], 'теми (крім клубних) — англійською');
  const en = io(GAME, { auth: { lang: 'en' } });
  en.on('state', (x) => last.set(en, x));
  res = await emit(en, 'create', { name: 'En', solo: true, size: 5, lives: 3, rounds: 1, categories: ['goals'], pick: 'host', roundSeconds: 0 });
  assert.ok(res.ok);
  st = await nextState(en, (x) => x.phase === 'pick');
  res = await emit(en, 'pickTopic', { topicId: 'tournament:wc' });
  assert.ok(res.ok, 'вибір теми');
  st = await nextState(en, (x) => x.phase === 'guess');
  assert.strictEqual(st.topic.title, 'All-time top scorers: World Cup');
  assert.ok(!cyr.test(st.topic.note), 'примітка англійською');
  res = await emit(en, 'guess', { playerId: 'no-such-player' });
  assert.strictEqual(res.error, 'Pick a player from the list');
  await emit(en, 'giveUp');
  st = await nextState(en, (x) => x.phase === 'reveal');
  assert.ok(st.slots.every((x) => !cyr.test(`${x.text} ${x.detail || ''}`)), 'рядки топу англійською');
  en.disconnect();
  console.log(`✓ англійська: ${listEn.length} тем, «${st.topic.title}», помилки й рядки — англійською`);

  console.log('\nУСІ ПЕРЕВІРКИ «ТОП-10» ПРОЙШЛИ');
}

main()
  .then(() => { server.kill(); process.exit(0); })
  .catch((e) => { console.error('✗', e); server.kill(); process.exit(1); });
