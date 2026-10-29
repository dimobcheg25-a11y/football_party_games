// Автотест «Чотири четвірки» через справжній сервер: генерація (16 різних гравців, розклад один, без росії),
// соло-серія з очками (групи, помилки, «майже», без помилок +10), ліміт помилок, «Головоломка дня» однакова,
// кімната (чужий прогрес — лише кольори, перший розв'язав +10, кінець раунду, коли всі закінчили), англійська.
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const assert = require('assert');
const { smoke } = require('./lib/smoke');
const { io } = require('socket.io-client');

const { GAME, ready, emit, nextState, run, act, URL } = smoke('fours', { FOURS_TEST_ANSWER: '1', FOURS_REVEAL_MS: '400' });

// Помилкова четвірка: троє з групи k + один з іншої («майже»), або по двоє з двох груп.
const oneAway = (st, k) => [...st.testAnswer[k].slice(0, 3), st.testAnswer[(k + 1) % 4][0]];
const twoTwo = (st, k) => [...st.testAnswer[k].slice(0, 2), ...st.testAnswer[(k + 1) % 4].slice(0, 2)];

async function main() {
  // ── генерація
  const { makePuzzle, uniquePartitions, featuresFor } = require('../server/games/fours/groups');
  const { isBanned } = require('../server/data/banned');
  for (const level of ['easy', 'normal', 'fan']) {
    const features = featuresFor(level);
    for (let i = 0; i < 25; i++) {
      const pz = makePuzzle(level);
      assert.ok(pz, `головоломка ${level} складається`);
      assert.strictEqual(pz.board.length, 16);
      assert.strictEqual(new Set(pz.board.map((p) => p.id)).size, 16, 'усі 16 різні');
      assert.ok(pz.board.every((p) => !isBanned(p)), 'без росії й білорусі');
      const tests = pz.groups.map((g) => features.find((f) => f.key === g.key));
      assert.ok(pz.groups.every((g, k) => g.players.every((p) => tests[k].test(p))), 'кожен підходить до своєї групи');
      assert.strictEqual(uniquePartitions(pz.board, tests), 1, 'розклад на групи — один');
      assert.deepStrictEqual(pz.groups.map((g) => g.color), [0, 1, 2, 3]);
    }
  }
  const d1 = makePuzzle('normal', { seed: 'daily-2026-10-23' });
  const d2 = makePuzzle('normal', { seed: 'daily-2026-10-23' });
  assert.deepStrictEqual(d1.board.map((p) => p.id), d2.board.map((p) => p.id), 'з тим самим насінням — та сама головоломка');
  console.log('✓ генерація: 75 головоломок, розклад один; приклад —', d1.groups.map((g) => g.label.uk).join(' | '));

  await ready;
  const games = await (await fetch(`${URL}/api/games`)).json();
  assert.ok(games.some((g) => g.id === 'fours'), 'гра є в каталозі');
  assert.strictEqual((await fetch(`${URL}/fours/`)).status, 200);

  // ── соло
  const solo = io(GAME);
  let { res, st } = await act(solo, 'create', { name: 'Соло', solo: true, rounds: 3, mistakes: 4, difficulty: 'normal', turnSeconds: 0 }, (x) => x.status === 'playing');
  assert.ok(res.ok, 'соло створено');
  assert.strictEqual(st.board.length, 16);
  assert.strictEqual(st.groups, null, 'групи приховані');
  assert.ok(!('players' in (st.board[0] || {})) && !JSON.stringify(st.board).includes('label'), 'на полі — лише гравці');

  // без помилок: 4 × 25 + 10
  for (let k = 0; k < 3; k++) {
    ({ res, st } = await act(solo, 'check', { ids: st.testAnswer[k] }, (x) => x.myFound.length === k + 1));
    assert.ok(res.correct);
    assert.strictEqual(st.myFound[k].color, k);
    assert.ok(st.myFound[k].label && st.myFound[k].players.length === 4, 'знайдена група — з назвою й гравцями');
  }
  ({ st } = await act(solo, 'check', { ids: st.testAnswer[3] }, (x) => x.phase === 'reveal'));
  assert.strictEqual(st.scores[0], 110, 'усі 4 без помилок — 110');
  assert.strictEqual(st.groups.length, 4, 'після раунду — усі групи');
  console.log('✓ соло: усі 4 без помилок — 110');

  // «майже», повтор, помилки
  ({ st } = await act(solo, 'next', null, (x) => x.round === 2 && x.phase === 'guess'));
  ({ res, st } = await act(solo, 'check', { ids: oneAway(st, 0) }, (x) => x.myMistakes === 1));
  assert.ok(!res.correct && res.oneAway, '3 з 4 — «майже»');
  assert.strictEqual(st.myTries[0].colors, null, 'кольори помилок приховані, поки грає');
  assert.ok((await emit(solo, 'check', { ids: oneAway(st, 0) })).error, 'ту саму четвірку двічі не можна');
  assert.ok((await emit(solo, 'check', { ids: st.testAnswer[0].slice(0, 3) })).error, 'треба рівно чотирьох');
  ({ res, st } = await act(solo, 'check', { ids: twoTwo(st, 1) }, (x) => x.myMistakes === 2));
  assert.ok(!res.oneAway, '2 + 2 — не «майже»');
  ({ st } = await act(solo, 'check', { ids: st.testAnswer[0] }, (x) => x.myFound.length === 1));
  assert.ok((await emit(solo, 'check', { ids: oneAway(st, 0) })).error, 'гравців знайденої групи вже не обрати');
  ({ st } = await act(solo, 'check', { ids: twoTwo(st, 2) }, (x) => x.myMistakes === 3));
  ({ st } = await act(solo, 'check', { ids: [...twoTwo(st, 2).slice(0, 2), st.testAnswer[3][0], st.testAnswer[1][0]] }, (x) => x.phase === 'reveal'));
  assert.strictEqual(st.myResult.found, 1);
  assert.strictEqual(st.myResult.points, 25 - 4 * 5, '1 група й 4 помилки — 5');
  assert.ok(st.myTries.every((t) => t.colors), 'після раунду — кольори спроб (для «поділитися»)');
  assert.strictEqual(st.scores[0], 115);
  console.log('✓ соло: «майже», повтори, 4 помилки — кінець, +5');

  // здатися
  ({ st } = await act(solo, 'next', null, (x) => x.round === 3 && x.phase === 'guess'));
  ({ st } = await act(solo, 'check', { ids: st.testAnswer[2] }, (x) => x.myFound.length === 1));
  // підказки: пара з однієї незнайденої групи, наступна — з іншої й дорожча
  assert.strictEqual(st.nextHint, 5, 'перша підказка — 5');
  ({ st } = await act(solo, 'hint', null, (x) => x.myHints.length === 1));
  const groupOf = (id) => st.testAnswer.findIndex((g) => g.includes(id));
  const [h1] = st.myHints;
  assert.strictEqual(h1.ids.length, 2, 'підказка — двоє');
  assert.ok(groupOf(h1.ids[0]) === groupOf(h1.ids[1]) && groupOf(h1.ids[0]) !== 2, 'двоє з однієї незнайденої групи');
  assert.strictEqual(st.nextHint, 10, 'друга — 10');
  ({ st } = await act(solo, 'hint', null, (x) => x.myHints.length === 2));
  assert.notStrictEqual(groupOf(st.myHints[1].ids[0]), groupOf(h1.ids[0]), 'друга — з іншої групи');
  assert.strictEqual(st.myHintCost, 15);
  ({ st } = await act(solo, 'giveUp', null, (x) => x.phase === 'reveal'));
  assert.strictEqual(st.myResult.points, 25 - 15, '1 група й підказки 5 + 10 — 10');
  assert.strictEqual(st.myResult.hints, 2);
  ({ st } = await act(solo, 'next', null, (x) => x.status === 'finished'));
  assert.strictEqual(st.history.length, 3);
  assert.strictEqual(st.scores[0], 125);
  const keys = st.history.flatMap((h) => h.groups.map((g) => g.label));
  assert.strictEqual(new Set(keys).size, 12, 'групи в серії не повторюються');
  solo.close();
  console.log('✓ соло: підказки 5 → 10, здатися, серія з 3, рахунок 125');

  // ── «Головоломка дня»: однакова для двох гравців
  const d = [io(GAME), io(GAME)];
  const days = [];
  for (const s of d) days.push((await act(s, 'create', { name: 'День', solo: true, daily: true, difficulty: 'fan', rounds: 5 }, (x) => x.status === 'playing')).st);
  assert.ok(days[0].daily && days[0].daily.no >= 1, 'номер головоломки дня');
  assert.deepStrictEqual(days[0].board.map((p) => p.id), days[1].board.map((p) => p.id), 'однакова для всіх');
  assert.strictEqual(days[0].rounds, 1);
  assert.strictEqual(days[0].options.difficulty, 'normal');
  d.forEach((s) => s.close());
  console.log(`✓ головоломка дня №${days[0].daily.no} (${days[0].daily.date}) — однакова для всіх`);

  // ── англійська
  const CYR = /[А-Яа-яІіЇїЄєҐґ]/;
  const noNames = (k, v) => (['uk', 'ru', 'aliases'].includes(k) ? undefined : v);
  const en = io(GAME, { auth: { lang: 'en' } });
  ({ st } = await act(en, 'create', { name: 'Bot', solo: true, rounds: 1 }, (x) => x.status === 'playing'));
  ({ st } = await act(en, 'giveUp', null, (x) => x.phase === 'reveal'));
  assert.ok(!CYR.test(JSON.stringify(st.groups, noNames)), 'назви груп англійською: ' + JSON.stringify(st.groups, noNames).match(/.{0,40}[А-Яа-яІіЇїЄєҐґ].{0,40}/)?.[0]);
  const enErr = (await emit(en, 'check', { ids: [] })).error;
  assert.ok(enErr && !CYR.test(enErr), 'помилка англійською: ' + enErr);
  en.close();
  console.log('✓ англійська:', st.groups.map((g) => g.label).join(' | '));

  // ── кімната
  const a = io(GAME);
  const b = io(GAME);
  ({ res } = await act(a, 'create', { name: 'Аня', rounds: 3, mistakes: 0, turnSeconds: 180 }, (x) => x.status === 'waiting'));
  const code = res.code;
  const info = await (await fetch(`${URL}/api/fours/room/${code}`)).json();
  assert.deepStrictEqual(info.players, ['Аня']);
  assert.strictEqual(info.options.mistakes, 0);
  await emit(b, 'join', { code, name: 'Борис' });
  assert.ok((await emit(b, 'start')).error, 'почати може лише господар');
  const bPlaying = nextState(b, (x) => x.status === 'playing');
  ({ st } = await act(a, 'start', null, (x) => x.status === 'playing'));
  await bPlaying;
  assert.ok(st.deadline, 'таймер');

  // А знаходить групу — Б бачить лише колір
  const bSees = nextState(b, (x) => x.progress[0].found.length === 1);
  await act(a, 'check', { ids: st.testAnswer[1] }, (x) => x.myFound.length === 1);
  const bView = await bSees;
  assert.strictEqual(bView.myFound.length, 0);
  assert.deepStrictEqual(bView.progress[0].found, [1], 'чужа група — лише колір');
  assert.ok(!JSON.stringify(bView.progress).includes('label'), 'назви чужої групи не видно');
  // без обмеження помилок: 6 помилок — гра триває
  for (let i = 0; i < 6; i++) {
    const ids = i % 2 ? twoTwo(st, i % 4) : oneAway(st, i % 4);
    const r = await emit(b, 'check', { ids: i < 4 ? ids : [...ids.slice(0, 3), st.testAnswer[(i + 2) % 4][1]] });
    assert.ok(!r.error, 'помилка ' + (i + 1) + ': ' + r.error);
  }
  for (let k = 0; k < 4; k++) if (k !== 1) await emit(a, 'check', { ids: st.testAnswer[k] });
  ({ st } = await act(b, 'giveUp', null, (x) => x.phase === 'reveal'));
  assert.strictEqual(st.progress[0].result.first, true, 'А розв\'язав першим');
  assert.strictEqual(st.scores[0], 100 + 10 + 10, 'А: 4 групи, без помилок, першим');
  assert.strictEqual(st.scores[1], 0, 'Б: 0 груп, мінус не йде нижче нуля');
  console.log('✓ кімната: А без помилок і першим — 120, Б здався; чужий прогрес — лише кольори');

  await nextState(a, (x) => x.round === 2 && x.phase === 'guess');
  console.log('✓ після паузи — наступна головоломка');

  b.close();
  await nextState(a, (x) => x.seats[1] && !x.seats[1].connected);
  ({ st } = await act(a, 'giveUp', null, (x) => x.phase === 'reveal'));
  console.log('✓ гравець офлайн не тримає раунд');

  await emit(a, 'leave');
  console.log('\nУСІ ПЕРЕВІРКИ «ЧОТИРИ ЧЕТВІРКИ» ПРОЙШЛИ');
}

run(main);
