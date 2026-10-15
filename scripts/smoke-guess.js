// Автотест «Вгадай гравця» через справжній сервер: порівняння (Мессі проти Неймара), соло-серія з очками за спробу,
// ліміт спроб, повтор гравця, кімната (чужі спроби — лише кольори, кінець раунду, коли всі закінчили), здатися.
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { io } = require('socket.io-client');
const { players, playerById } = require('../server/data');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const URL = `http://localhost:${PORT}`;
const GAME = `${URL}/guess`;

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT, GUESS_TEST_ANSWER: '1', GUESS_REVEAL_MS: '400' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const emit = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
const nextState = (s, pred = () => true) =>
  new Promise((res) => {
    const h = (st) => { if (pred(st)) { s.off('state', h); res(st); } };
    s.on('state', h);
  });
async function act(s, ev, data, pred) {
  const st = nextState(s, pred);
  const res = await emit(s, ev, data);
  return { res, st: await st };
}
// Неправильні відповіді: відомі гравці з кар'єрою, не загаданий.
const WRONG = ['lionel-messi', 'cristiano-ronaldo', 'andriy-shevchenko', 'neymar', 'zinedine-zidane', 'thierry-henry', 'david-beckham', 'wayne-rooney', 'luka-modric', 'kylian-mbappe', 'kaka']
  .filter((id) => playerById.has(id));
const wrongIds = (st, n) => WRONG.filter((id) => id !== st.testAnswer).slice(0, n);

async function main() {
  await new Promise((res) => server.stdout.on('data', (d) => d.toString().includes('запущено') && res()));

  const games = await (await fetch(`${URL}/api/games`)).json();
  assert.ok(games.some((g) => g.id === 'guess'), 'гра є в каталозі');
  assert.strictEqual((await fetch(`${URL}/guess/`)).status, 200);
  assert.ok(WRONG.length >= 9, 'є відомі гравці для неправильних відповідей');

  // ── порівняння: Мессі проти Неймара
  const { profileOf, compare } = require('../server/games/guess/compare');
  const { localize } = require('../server/core/i18n');
  // тексти клітинок — парами T(uk, en); як їх бачить гравець відповідною мовою
  const cellIn = (lang) => (g, t, id) => localize(compare(profileOf(playerById.get(g)), profileOf(playerById.get(t))), lang).find((c) => c.id === id);
  const cell = cellIn('uk');
  const cellEn = cellIn('en');
  const shared = cell('lionel-messi', 'neymar', 'shared');
  assert.strictEqual(shared.color, 'yellow');
  assert.ok(shared.clubs.some((x) => x.name === 'Барселона' && x.together), 'разом у Барселоні');
  assert.ok(shared.clubs.some((x) => x.name === 'ПСЖ' && x.together), 'разом у ПСЖ');
  assert.strictEqual(cell('lionel-messi', 'neymar', 'nation').color, 'yellow', 'Аргентина й Бразилія — один континент');
  assert.strictEqual(cell('lionel-messi', 'neymar', 'born').note, 'загаданий молодший', 'Неймар молодший — словами');
  assert.strictEqual(cell('arda-turan', 'neymar', 'position').text, 'Лівий вінгер', 'основна позиція з Transfermarkt');
  const pos = cell('mykhailo-mudryk', 'lionel-messi', 'position');
  assert.ok(pos.color === 'yellow' && pos.note === 'теж фланг', 'жовта позиція пояснена');
  const trophies = cell('lionel-messi', 'neymar', 'trophies');
  assert.ok(trophies.items.some((x) => x.label === 'Ліга чемпіонів' && x.match), 'трофеї текстом, спільні позначені');
  const value = cell('neymar', 'kylian-mbappe', 'value');
  assert.ok(/^€\d+ млн$/.test(value.text) && /у загаданого (трохи )?більше$/.test(value.note), 'макс. вартість: ' + value.text);
  assert.ok(cell('lionel-messi', 'neymar', 'caps').text !== '100', 'матчі за збірну не обрізані на 100');
  const capsOf = (id) => profileOf(playerById.get(id)).caps;
  if (capsOf('lionel-messi') !== capsOf('neymar')) assert.notStrictEqual(cell('lionel-messi', 'neymar', 'caps').color, 'green', 'зелена — лише точна кількість');
  assert.strictEqual(cell('neymar', 'neymar', 'caps').color, 'green');
  assert.ok(!profileOf(playerById.get('wayne-rooney')).countries.has('Британія'), 'чемпіонат — Англія/Шотландія, не «Британія»');
  // асисти — лише коли загаданий почав з 2012-го; хто почав раніше — «—»
  const { columnsFor } = require('../server/games/guess/compare');
  assert.ok(!columnsFor(profileOf(playerById.get('lionel-messi'))).some((c) => c.id === 'assists'), 'Мессі почав до 2012 — без асистів');
  assert.ok(columnsFor(profileOf(playerById.get('erling-haaland'))).some((c) => c.id === 'assists'), 'Голанд — з асистами');
  assert.strictEqual(cell('lionel-messi', 'erling-haaland', 'assists').text, '—');
  assert.ok(/^\d+$/.test(cell('kylian-mbappe', 'erling-haaland', 'assists').text), 'асисти числом');
  assert.strictEqual(cell('neymar', 'neymar', 'last').color, 'green');
  assert.strictEqual(cell('andriy-shevchenko', 'neymar', 'shared').color, 'grey');
  const eng = cell('david-beckham', 'wayne-rooney', 'nation');
  assert.ok(eng.text === 'Англія' && eng.color === 'green', 'британські збірні — окремо');
  // англійська: ті самі клітинки іншою мовою
  assert.strictEqual(cellEn('lionel-messi', 'neymar', 'born').note, 'mystery player is younger');
  assert.ok(cellEn('lionel-messi', 'neymar', 'shared').clubs.some((x) => x.name === 'Barcelona' && x.together), 'клуби англійською');
  assert.strictEqual(cellEn('david-beckham', 'wayne-rooney', 'nation').text, 'England');
  assert.ok(/^€\d+m$/.test(cellEn('neymar', 'kylian-mbappe', 'value').text), 'вартість англійською');
  assert.ok(cellEn('lionel-messi', 'neymar', 'trophies').items.some((x) => x.label === 'Champions League'));
  // у кожного, кого можна загадати, є профіль
  const { poolFor, careerOf } = require('../server/games/path/careers');
  assert.ok(poolFor('all', 'expert').every((p) => profileOf(p)), 'профілі для всього пулу');
  console.log('✓ порівняння: Мессі → Неймар —', shared.clubs.map((x) => (x.together ? '🤝 ' : '') + x.name).join(', '), '| збірна:', cell('lionel-messi', 'neymar', 'nation').note);

  // ── соло
  const solo = io(GAME);
  let { res, st } = await act(solo, 'create', { name: 'Соло', solo: true, rounds: 3, attempts: 6, difficulty: 'easy', turnSeconds: 0 }, (x) => x.status === 'playing');
  assert.ok(res.ok, 'соло створено');
  assert.strictEqual(st.answer, null, 'відповідь прихована');
  assert.ok(careerOf(playerById.get(st.testAnswer)).nation, 'загаданий грав за збірну');
  assert.deepStrictEqual([st.points[0], st.points[5]], [100, 10], 'очки 100 → 10');
  assert.strictEqual(st.potential, 100);

  const [w1, w2] = wrongIds(st, 2);
  ({ res, st } = await act(solo, 'guess', { playerId: w1 }, (x) => x.myTries.length === 1));
  assert.strictEqual(res.correct, false);
  assert.strictEqual(st.myTries[0].cells.length, st.columns.length, 'клітинка на кожну колонку');
  assert.ok([11, 12].includes(st.columns.length), '11 клітинок, з асистами — 12');
  assert.strictEqual(st.potential, st.points[1]);
  assert.ok((await emit(solo, 'guess', { playerId: w1 })).error, 'того самого гравця двічі не можна');
  ({ st } = await act(solo, 'guess', { playerId: w2 }, (x) => x.myTries.length === 2));
  ({ res, st } = await act(solo, 'guess', { playerId: st.testAnswer }, (x) => x.phase === 'reveal'));
  assert.ok(res.correct);
  assert.strictEqual(st.scores[0], st.points[2], 'вгадав з 3-ї спроби');
  assert.ok(st.myTries[2].cells.every((c) => c.color === 'green'), 'правильна — уся зелена');
  assert.strictEqual(st.answer.id, st.testAnswer);
  assert.ok(st.answer.cells.find((c) => c.id === 'shared').clubs.length >= 3, 'у відповіді — уся кар’єра');
  const p3 = st.points[2];
  console.log(`✓ соло: вгадав з 3-ї спроби — +${p3}`);

  // ліміт спроб: 6 помилок → раунд закінчено без очок
  ({ st } = await act(solo, 'next', null, (x) => x.round === 2 && x.phase === 'guess'));
  const six = wrongIds(st, 6);
  for (let i = 0; i < 5; i++) ({ st } = await act(solo, 'guess', { playerId: six[i] }, (x) => x.myTries.length === i + 1));
  ({ st } = await act(solo, 'guess', { playerId: six[5] }, (x) => x.phase === 'reveal'));
  assert.strictEqual(st.scores[0], p3, 'не вгадав — 0');
  console.log('✓ соло: 6 помилок — раунд закінчено, 0 очок');

  // здатися
  ({ st } = await act(solo, 'next', null, (x) => x.round === 3 && x.phase === 'guess'));
  ({ st } = await act(solo, 'giveUp', null, (x) => x.phase === 'reveal'));
  ({ st } = await act(solo, 'next', null, (x) => x.status === 'finished'));
  assert.strictEqual(st.history.length, 3);
  console.log('✓ соло: здатися, серія з 3 раундів, рахунок', st.scores[0]);

  // ── англійська: гравець з auth.lang 'en' бачить стан і помилки англійською (кирилиця — лише в іменах гравців)
  const CYR = /[А-Яа-яІіЇїЄєҐґ]/;
  const noNames = (k, v) => (['uk', 'ru', 'aliases'].includes(k) ? undefined : v);
  const en = io(GAME, { auth: { lang: 'en' } });
  ({ res, st } = await act(en, 'create', { name: 'Bot', solo: true, rounds: 1, attempts: 6, difficulty: 'easy', turnSeconds: 0 }, (x) => x.status === 'playing'));
  const enWrong = ['lionel-messi', 'neymar'].find((id) => id !== st.testAnswer);
  ({ st } = await act(en, 'guess', { playerId: enWrong }, (x) => x.myTries.length === 1));
  assert.ok(!CYR.test(JSON.stringify(st.columns)), 'колонки англійською');
  assert.ok(!CYR.test(JSON.stringify(st.myTries, noNames)), 'клітинки англійською: ' + JSON.stringify(st.myTries, noNames).match(/.{0,40}[А-Яа-яІіЇїЄєҐґ].{0,40}/)?.[0]);
  const enErr = (await emit(en, 'guess', { playerId: enWrong })).error;
  assert.ok(enErr && !CYR.test(enErr), 'помилка англійською: ' + enErr);
  const enGames = await (await fetch(`${URL}/api/games?lang=en`)).json();
  assert.strictEqual(enGames.find((g) => g.id === 'guess').title, 'Guess the Player');
  en.close();
  console.log('✓ англійська: клітинки, колонки, помилки —', enErr);
  solo.close();

  // ── кімната
  const a = io(GAME);
  const b = io(GAME);
  ({ res } = await act(a, 'create', { name: 'Аня', rounds: 3, attempts: 8, turnSeconds: 60 }, (x) => x.status === 'waiting'));
  const code = res.code;
  const info = await (await fetch(`${URL}/api/guess/room/${code}`)).json();
  assert.deepStrictEqual(info.players, ['Аня']);
  assert.strictEqual(info.options.attempts, 8);
  await emit(b, 'join', { code, name: 'Борис' });
  assert.ok((await emit(b, 'start')).error, 'почати може лише господар');
  const bPlaying = nextState(b, (x) => x.status === 'playing');
  ({ st } = await act(a, 'start', null, (x) => x.status === 'playing'));
  await bPlaying;
  assert.ok(st.deadline, 'таймер раунду');

  // А помиляється — Б бачить лише кольори, без імені
  const bSees = nextState(b, (x) => x.progress[0].colors.length === 1);
  await act(a, 'guess', { playerId: wrongIds(st, 1)[0] }, (x) => x.myTries.length === 1);
  const bView = await bSees;
  assert.strictEqual(bView.myTries.length, 0, 'чужих спроб з іменами не видно');
  assert.strictEqual(bView.progress[0].colors[0].length, bView.columns.length);
  assert.ok(!JSON.stringify(bView.progress).includes(wrongIds(st, 1)[0]), 'імені в спільному стані немає');
  // А вгадує — раунд ще йде, бо Б думає
  ({ st } = await act(a, 'guess', { playerId: st.testAnswer }, (x) => x.progress[0].solved));
  assert.strictEqual(st.phase, 'guess', 'чекаємо Б');
  assert.strictEqual(st.scores[0], st.points[1]);
  // Б здається — раунд закінчено
  ({ st } = await act(b, 'giveUp', null, (x) => x.phase === 'reveal'));
  assert.deepStrictEqual(st.scores.slice(0, 2), [st.points[1], 0]);
  console.log(`✓ кімната: А вгадав з 2-ї (+${st.points[1]}), Б здався; чужі спроби — лише кольори`);

  await nextState(a, (x) => x.round === 2 && x.phase === 'guess');
  console.log('✓ після паузи — наступний раунд');

  // Б зник — раунд не чекає на нього
  b.close();
  await nextState(a, (x) => x.seats[1] && !x.seats[1].connected);
  ({ st } = await act(a, 'giveUp', null, (x) => x.phase === 'reveal'));
  console.log('✓ гравець офлайн не тримає раунд');

  const chatMsg = new Promise((r) => a.once('chat', r));
  const c = io(GAME);
  await emit(c, 'join', { code, name: 'Віка' });
  await emit(c, 'chat', 'Привіт!');
  assert.strictEqual((await chatMsg).text, 'Привіт!');
  console.log('✓ пізній вхід і чат');

  await emit(c, 'leave');
  await emit(a, 'leave');
  console.log('\nУСІ ПЕРЕВІРКИ «ВГАДАЙ ГРАВЦЯ» ПРОЙШЛИ');
}

main()
  .then(() => { server.kill(); process.exit(0); })
  .catch((e) => { console.error('✗', e); server.kill(); process.exit(1); });
