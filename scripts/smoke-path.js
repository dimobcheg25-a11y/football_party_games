// Автотест «Шляху футболіста» через справжній сервер: соло-серія, підказки з ціною, епохи й складність, кімната
// (старт господарем, етапи, очки, приховування відповідей і підказок, пізній вхід, гравець офлайн не тримає етап), запрошення, чат.
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { io } = require('socket.io-client');
const { players } = require('../server/data');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const URL = `http://localhost:${PORT}`;
const GAME = `${URL}/path`;

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT, PATH_TEST_ANSWER: '1', PATH_REVEAL_MS: '400' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const emit = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
const nextState = (s, pred = () => true) =>
  new Promise((res) => {
    const h = (st) => { if (pred(st)) { s.off('state', h); res(st); } };
    s.on('state', h);
  });
// Стан, що прийде у відповідь на дію (підписуємось до дії, щоб не пропустити).
async function act(s, ev, data, pred) {
  const st = nextState(s, pred);
  const res = await emit(s, ev, data);
  return { res, st: await st };
}
const wrongId = (st) => players.find((p) => p.id !== st.testAnswer).id;

async function main() {
  await new Promise((res) => server.stdout.on('data', (d) => d.toString().includes('запущено') && res()));

  const games = await (await fetch(`${URL}/api/games`)).json();
  assert.ok(games.some((g) => g.id === 'path'), 'гра є в каталозі');
  assert.strictEqual((await fetch(`${URL}/path/`)).status, 200);

  // ── соло
  const solo = io(GAME);
  let { res, st } = await act(solo, 'create', { name: 'Соло', solo: true, rounds: 5, difficulty: 'easy', turnSeconds: 0 }, (x) => x.status === 'playing');
  assert.ok(res.ok, 'соло створено');
  assert.strictEqual(st.round, 1);
  assert.strictEqual(st.stages.length, 1, 'видно лише перший етап');
  assert.ok(st.totalStages >= 3, 'щонайменше 3 клуби');
  assert.strictEqual(st.answer, null, 'відповідь прихована');
  assert.strictEqual(st.stages[0].kind, 'club');
  assert.ok(st.stages[0].years, 'роки показуються');
  console.log('✓ соло: перший етап —', st.stages[0].name, st.stages[0].years, `${st.stages[0].apps}/${st.stages[0].goals}`);

  ({ res, st } = await act(solo, 'guess', { playerId: wrongId(st) }, (x) => x.stage === 1));
  assert.strictEqual(res.correct, false);
  assert.strictEqual(st.stages.length, 2, 'неправильна відповідь → наступний етап');
  const p1 = st.points[1];
  ({ res, st } = await act(solo, 'guess', { playerId: st.testAnswer }, (x) => x.phase === 'reveal'));
  assert.ok(res.correct);
  assert.strictEqual(st.points[0], 100, 'перший клуб — 100');
  assert.strictEqual(st.points[st.points.length - 1], 10, 'останній клуб — 10');
  assert.strictEqual(st.points.length, st.totalStages);
  assert.ok(st.points.every((x, i) => i === 0 || x < st.points[i - 1]), 'очки спадають рівномірно');
  assert.strictEqual(st.scores[0], p1, 'вгадав на 2-му клубі');
  assert.ok(st.answer && st.answer.id === st.testAnswer, 'після раунду відповідь показано');
  assert.strictEqual(st.stages.length, st.totalStages, 'після раунду видно весь шлях');
  console.log(`✓ соло: очки ${st.points.join('/')}, помилка → наступний клуб, вгадав на 2-му: +${p1}`);

  assert.ok(st.answer.facts.some((f) => f.id === 'born'), 'після раунду — факти про гравця');

  // підказки: рік (−1) і позиція (−2) на першому етапі → вгадав за 10 − 3 = 7
  ({ st } = await act(solo, 'next', null, (x) => x.round === 2 && x.phase === 'guess'));
  assert.strictEqual(st.potential, 100);
  const cost = (id) => st.hintCosts.find((h) => h.id === id).cost;
  const n = st.totalStages;
  assert.ok(cost('letter') > cost('position') && cost('position') === cost('nation') && cost('nation') > cost('born'), 'літера найдорожча, позиція = збірна, рік — найдешевший');
  ({ res, st } = await act(solo, 'hint', { id: 'born' }, (x) => x.myHints.length === 1));
  assert.ok(res.ok);
  assert.strictEqual(st.potential, 100 - cost('born'), 'рік народження');
  assert.ok(/^\d{4}$|невідомий/.test(st.myHints[0].text), 'рік народження');
  ({ st } = await act(solo, 'hint', { id: 'position' }, (x) => x.myHints.length === 2));
  const withHints = 100 - cost('born') - cost('position');
  assert.strictEqual(st.potential, withHints);
  ({ st } = await act(solo, 'guess', { playerId: st.testAnswer }, (x) => x.phase === 'reveal'));
  assert.strictEqual(st.scores[0], p1 + withHints);
  console.log(`✓ підказки (кар'єра ${n} клубів): рік −${cost('born')}, позиція −${cost('position')} → вгадав за ${withHints}`);

  for (let r = 3; r <= 5; r++) {
    ({ st } = await act(solo, 'next', null, (x) => x.round === r && x.phase === 'guess'));
    ({ st } = await act(solo, 'guess', { playerId: st.testAnswer }, (x) => x.phase === 'reveal'));
  }
  ({ st } = await act(solo, 'next', null, (x) => x.status === 'finished'));
  assert.strictEqual(st.scores[0], p1 + withHints + 3 * 100);
  assert.strictEqual(st.history.length, 5);
  assert.strictEqual(new Set(st.history.map((h) => h.answer.id)).size, 5, 'гравці в серії не повторюються');
  console.log('✓ соло: серія з 5 раундів, рахунок', st.scores[0]);

  // налаштування: з останнього клубу, без років і статистики
  const solo2 = io(GAME);
  ({ st } = await act(solo2, 'create', { name: 'Хардкор', solo: true, start: 'last', showYears: false, showStats: false, era: 'retired', difficulty: 'expert' }, (x) => x.status === 'playing'));
  assert.strictEqual(st.stages[0].years, null);
  assert.strictEqual(st.stages[0].apps, undefined);
  assert.strictEqual(st.options.start, 'last');
  assert.strictEqual(st.options.era, 'retired');
  assert.ok(st.stages.every((x) => x.kind === 'club'), 'етапи — лише клуби');
  console.log('✓ налаштування: з останнього клубу, без років і матчів');
  solo2.close();

  // складність рахується за ігровою відомістю: тренер-«ноунейм як гравець» не потрапляє в легкі рівні
  const { poolFor } = require('../server/games/path/careers');
  // рівні — верхівка рейтингу впізнаваності: тренери й давні ветерани (дель Боске, Вальверде) — не на легких рівнях
  for (const name of ['Ernesto Valverde', 'Vicente del Bosque', 'Alpay Özalan']) {
    const p = players.find((x) => x.name === name);
    if (p) for (const d of ['easy', 'normal']) assert.ok(!poolFor('all', d).includes(p), `${name} не на рівні ${d}`);
  }
  for (const name of ['Lionel Messi', 'Andriy Shevchenko', 'Frank Lampard']) {
    assert.ok(poolFor('all', 'easy').some((x) => x.name === name), `${name} — на легкому рівні`);
  }
  assert.deepStrictEqual(['easy', 'normal', 'fan', 'hard'].map((d) => poolFor('all', d).length), [400, 800, 1300, 1900], 'розміри рівнів');
  for (const era of ['all', 'modern', 'retired']) for (const d of ['easy', 'normal', 'fan', 'hard', 'expert']) assert.ok(poolFor(era, d).length >= 40, `є кого загадувати: ${era}/${d}`);
  console.log('✓ рівні складності: топ-400/800/1300/1900 за впізнаваністю; дель Боске й Вальверде — не на легких');

  // ── кімната
  const a = io(GAME);
  const b = io(GAME);
  ({ res } = await act(a, 'create', { name: 'Аня', rounds: 5, turnSeconds: 30 }, (x) => x.status === 'waiting'));
  const code = res.code;
  const info = await (await fetch(`${URL}/api/path/room/${code}`)).json();
  assert.deepStrictEqual(info.players, ['Аня']);
  assert.strictEqual(info.options.rounds, 5);
  console.log('✓ кімната', code, '+ інформація для запрошення');

  await emit(b, 'join', { code, name: 'Борис' });
  assert.ok((await emit(b, 'start')).error, 'почати може лише господар');
  const bPlaying = nextState(b, (x) => x.status === 'playing');
  ({ st } = await act(a, 'start', null, (x) => x.status === 'playing'));
  await bPlaying;
  assert.ok(st.deadline, 'таймер етапу');

  // А вгадує одразу; Б не бачить, кого саме
  const bSees = nextState(b, (x) => x.solved[0]);
  ({ res } = await act(a, 'guess', { playerId: st.testAnswer }, (x) => x.solved[0]));
  const bView = await bSees;
  assert.strictEqual(bView.guesses[0].player, undefined, 'чужа правильна відповідь прихована');
  assert.strictEqual(bView.stage, 0, 'етап чекає на Б');
  const aPts = bView.points[0];
  ({ st } = await act(b, 'pass', null, (x) => x.stage === 1));
  const aSeesWrong = nextState(a, (x) => x.guesses.some((g) => !g.correct));
  ({ st } = await act(b, 'guess', { playerId: wrongId(st) }, (x) => x.stage === 2));
  assert.strictEqual((await aSeesWrong).guesses.find((g) => !g.correct).player, undefined, 'чужу неправильну відповідь не видно');
  assert.strictEqual(st.myGuesses.find((g) => !g.correct).player.id, wrongId(st), 'свою — видно');
  const aSeesHint = nextState(a, (x) => x.hintsUsed[1]);
  ({ st } = await act(b, 'hint', { id: 'letter' }, (x) => x.myHints.length === 1));
  const aHint = await aSeesHint;
  assert.strictEqual(aHint.myHints.length, 0, 'чужих підказок не видно');
  const bPts = Math.max(5, st.points[2] - st.hintCosts.find((h) => h.id === 'letter').cost);
  assert.strictEqual(st.potential, bPts, 'клуб 3 − літера (щонайменше 5)');
  ({ st } = await act(b, 'guess', { playerId: st.testAnswer }, (x) => x.phase === 'reveal'));
  assert.deepStrictEqual(st.scores.slice(0, 2), [aPts, bPts], 'А — за 1-й клуб, Б — за 3-й з підказкою-літерою');
  console.log(`✓ очки: ${aPts} і ${bPts}; чужі відповіді й підказки не видно, лише «помилився/вгадав»`);

  // пауза з відповіддю закінчується сама
  ({ st } = await nextState(a, (x) => x.round === 2 && x.phase === 'guess').then((s) => ({ st: s })));
  console.log('✓ після паузи — наступний раунд');

  // пізній вхід
  const c = io(GAME);
  const cJoin = await emit(c, 'join', { code, name: 'Віка' });
  assert.ok(cJoin.ok, 'можна зайти посеред гри');
  const cs = await act(a, 'pass', null, (x) => x.seats[2]);
  assert.strictEqual(cs.st.scores[2], 0);
  console.log('✓ пізній вхід посеред гри');

  // Б зник — етап не чекає на нього
  b.close();
  await nextState(a, (x) => x.seats[1] && !x.seats[1].connected);
  ({ st } = await act(c, 'pass', null, (x) => x.stage === 1));
  console.log('✓ гравець офлайн не тримає етап');

  // чат
  const chatMsg = new Promise((r) => a.once('chat', r));
  await emit(c, 'chat', 'Привіт!');
  assert.strictEqual((await chatMsg).text, 'Привіт!');
  console.log('✓ чат');

  await emit(c, 'leave');
  await emit(a, 'leave');
  assert.strictEqual((await (await fetch(`${URL}/api/path/room/${code}`)).json()).found, true, 'Б ще має місце (офлайн)');
  console.log('\nУСІ ПЕРЕВІРКИ «ШЛЯХУ» ПРОЙШЛИ');
}

main()
  .then(() => { server.kill(); process.exit(0); })
  .catch((e) => { console.error('✗', e); server.kill(); process.exit(1); });
