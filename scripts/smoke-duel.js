// Автотест «Один на один» через справжній сервер: питання й пари (рівні складності, без однакових значень),
// соло «Серія» (переможець лишається, кінець після помилки), соло «Раунди», кімната з 2 ботами (одночасні відповіді,
// бонус найшвидшому, таймер, чужий вибір прихований), англійська.
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const assert = require('assert');
const { smoke } = require('./lib/smoke');

const { GAME, ready, emit, nextState, run, bot, URL } = smoke('duel', { DUEL_TEST_ANSWER: '1', DUEL_REVEAL_MS: '1500' });

async function main() {
  await ready;

  const games = await (await fetch(`${URL}/api/games`)).json();
  const meta = games.find((g) => g.id === 'duel');
  assert.ok(meta && meta.solo && meta.friends === '2–10', 'гра є в каталозі, соло й 2–10');
  assert.strictEqual((await fetch(`${URL}/duel/`)).status, 200);
  const cats = await (await fetch(`${URL}/api/duel/categories`)).json();
  for (const id of ['career', 'nation', 'money', 'trophies']) assert.ok(cats.some((c) => c.id === id), `група ${id} доступна`);
  console.log(`✓ каталог і групи: ${cats.map((c) => `${c.id} (${c.questions.length})`).join(', ')}`);

  // ── питання й пари
  const { QUESTIONS, makePair, gapOf, questionsFor } = require('../server/games/duel/questions');
  const avail = questionsFor(null, 'normal');
  assert.ok(avail.length >= 10, 'на звичайному рівні є питання');
  for (const q of avail) {
    for (const level of ['easy', 'hard', 'mix']) {
      for (let k = 0; k < 5; k++) {
        const pair = makePair(q, 'normal', level);
        assert.ok(pair, `пара для ${q.id}/${level}`);
        const [a, b] = pair;
        assert.notStrictEqual(a.v, b.v, `${q.id}: однакових значень не буває`);
        assert.notStrictEqual(a.p.id, b.p.id);
        const g = gapOf(q, a.v, b.v);
        if (q.minGap) assert.ok(g >= q.minGap, `${q.id}: різниця не менше ×${q.minGap}`);
        if (q.pairOk) assert.ok(q.pairOk(a.p, b.p), `${q.id}: умова пари`);
        const show = q.show(a.v, a.p);
        assert.ok(typeof show.num === 'number' && !Number.isNaN(show.num), `${q.id}: число для показу`);
      }
    }
    // легкі пари — справді з помітною різницею (якщо такі існують для цього питання)
    const easy = makePair(q, 'normal', 'easy');
    const hard = makePair(q, 'normal', 'hard');
    if (q.gap.kind === 'ratio' && gapOf(q, easy[0].v, easy[1].v) < q.gap.easy) console.log(`  (${q.id}: легких пар немає — взято мікс)`);
    assert.ok(gapOf(q, hard[0].v, hard[1].v) <= Math.max(q.gap.hard, gapOf(q, easy[0].v, easy[1].v)), `${q.id}: складна пара близька`);
  }
  const goals = QUESTIONS.find((q) => q.id === 'leagueGoals');
  for (let k = 0; k < 20; k++) {
    const [a, b] = makePair(goals, 'normal', 'easy');
    assert.ok(gapOf(goals, a.v, b.v) >= 1.5, 'легко — ≥ ×1.5');
    const [c, d] = makePair(goals, 'normal', 'hard');
    assert.ok(gapOf(goals, c.v, d.v) <= 1.2 && c.v !== d.v, 'складно — до 20 %');
  }
  console.log(`✓ пари: ${avail.length} питань на звичайному рівні, рівні пар і різні значення`);

  // ── соло «Серія»: 1 помилка; переможець лишається
  const s1 = bot();
  let res = await emit(s1, 'create', { name: 'Серія', solo: true, mode: 'streak', lives: 1, groups: ['career', 'nation'] });
  assert.ok(res.ok);
  let st = await nextState(s1, (x) => x.phase === 'guess');
  assert.strictEqual(st.values, null, 'числа приховані до відповіді');
  assert.strictEqual(st.winner, -1);
  assert.ok(['career', 'nation'].includes(st.question.group), 'питання з обраних груп');
  assert.ok(st.pair.every((p) => p.name), 'двоє гравців');
  let win = st.testAnswer;
  res = await emit(s1, 'answer', { side: win });
  assert.ok(res.correct);
  st = await nextState(s1, (x) => x.phase === 'reveal');
  assert.strictEqual(st.winner, win);
  assert.ok(st.values.length === 2 && st.values.every((v) => typeof v.num === 'number'), 'після відповіді — обидва числа');
  assert.strictEqual(st.run, 1);
  assert.ok((await emit(s1, 'answer', { side: 0 })).error, 'двічі не відповідаєш');
  const champ = st.pair[win].id;
  await emit(s1, 'next');
  st = await nextState(s1, (x) => x.phase === 'guess' && x.round === 2);
  if (st.champion !== -1) assert.strictEqual(st.pair[st.champion].id, champ, 'чемпіон лишився на своєму боці');
  assert.ok(st.pair.some((p) => p.id === champ), 'переможець пари лишається');
  res = await emit(s1, 'answer', { side: 1 - st.testAnswer });
  assert.ok(!res.correct);
  st = await nextState(s1, (x) => x.phase === 'reveal');
  assert.strictEqual(st.lives, 0);
  await emit(s1, 'next');
  st = await nextState(s1, (x) => x.status === 'finished');
  assert.strictEqual(st.scores[0], 1);
  assert.strictEqual(st.history.length, 2);
  console.log(`✓ соло «Серія»: перемога, ${st.pair ? '' : ''}чемпіон лишився, помилка — кінець (рахунок ${st.scores[0]})`);
  s1.close();

  // ── соло з таймером: час вийшов без відповіді — помилка, серія закінчилась
  const s3 = bot();
  await emit(s3, 'create', { name: 'Таймер', solo: true, mode: 'streak', lives: 1, seconds: 5, difficulty: 'easy', level: 'easy' });
  st = await nextState(s3, (x) => x.phase === 'guess');
  assert.ok(st.deadline > Date.now(), 'соло з таймером — є дедлайн');
  st = await nextState(s3, (x) => x.phase === 'reveal', 9000);
  assert.strictEqual(st.lives, 0, 'не відповів вчасно — мінус життя');
  console.log('✓ соло з таймером: час вийшов — помилка');
  s3.close();

  // ── соло «Раунди»: 10 пар
  const s2 = bot();
  await emit(s2, 'create', { name: 'Раунди', solo: true, mode: 'rounds', rounds: 10, seconds: 0, difficulty: 'easy', level: 'easy' });
  for (let i = 1; i <= 10; i++) {
    st = await nextState(s2, (x) => x.phase === 'guess' && x.round === i);
    assert.strictEqual(st.deadline, null, '«без таймера» (seconds: 0) — дедлайну немає');
    await emit(s2, 'answer', { side: i === 3 ? 1 - st.testAnswer : st.testAnswer });
    await nextState(s2, (x) => x.phase === 'reveal' && x.round === i);
    await emit(s2, 'next');
  }
  st = await nextState(s2, (x) => x.status === 'finished');
  assert.strictEqual(st.scores[0], 9, '9 з 10');
  assert.strictEqual(new Set(st.history.flatMap((h) => h.players.map((p) => p.name))).size, 20, 'гравці не повторюються');
  console.log('✓ соло «Раунди»: 10 пар, 9 правильних, гравці не повторюються');
  s2.close();

  // ── кімната: 2 гравці, одночасно, бонус найшвидшому, таймер
  const [a, b] = [bot(), bot()];
  res = await emit(a, 'create', { name: 'Аня', rounds: 10, seconds: 5, groups: ['money', 'career'] });
  assert.ok((await emit(a, 'start')).error, 'сам не почнеш');
  await emit(b, 'join', { code: res.code, name: 'Борис' });
  await emit(a, 'start');
  st = await nextState(a, (x) => x.phase === 'guess');
  assert.ok(st.deadline > st.serverNow, 'таймер відповіді');
  win = st.testAnswer;
  await emit(a, 'answer', { side: win });
  const bView = await nextState(b, (x) => x.answered.includes(0));
  assert.strictEqual(bView.myPick, null, 'свій вибір бачиш лише ти');
  assert.ok(!JSON.stringify(bView.results).includes('side'), 'чужого вибору не видно до кінця пари');
  await new Promise((r) => setTimeout(r, 50));
  await emit(b, 'answer', { side: win });
  st = await nextState(a, (x) => x.phase === 'reveal');
  assert.deepStrictEqual([st.results[0].points, st.results[1].points], [2, 1], 'найшвидший правильний +2, інший +1');
  assert.ok(st.results[0].fastest && !st.results[1].fastest);
  assert.deepStrictEqual(st.scores.slice(0, 2), [2, 1]);
  console.log('✓ кімната: обидва вгадали — найшвидшому +2, другому +1');
  // далі — автоматично (DUEL_REVEAL_MS); нова пара: ніхто не відповів — таймер закриває пару
  st = await nextState(a, (x) => x.phase === 'guess' && x.round === 2);
  await emit(b, 'answer', { side: 1 - st.testAnswer });
  st = await nextState(a, (x) => x.phase === 'reveal' && x.round === 2);
  assert.ok(!st.results[0] && st.results[1] && !st.results[1].correct, 'хто не встиг — без відповіді');
  await emit(a, 'next');
  await emit(b, 'next');
  st = await nextState(a, (x) => x.phase === 'guess' && x.round === 3);
  console.log('✓ кімната: таймер закриває пару, «далі» від усіх — наступна пара');
  a.close();
  b.close();

  // ── англійська: тексти стану й помилки — англійською (кирилиця лише в українських іменах гравців)
  const cyr = /[А-Яа-яІіЇїЄєҐґ]/;
  const catsEn = await (await fetch(`${URL}/api/duel/categories?lang=en`)).json();
  assert.ok(!cyr.test(JSON.stringify(catsEn)), 'групи англійською');
  const en = bot('en');
  await emit(en, 'create', { name: 'En', solo: true, mode: 'rounds', rounds: 10 });
  res = await emit(en, 'answer', { side: 5 });
  assert.strictEqual(res.error, 'Pick one of the two');
  const strip = (x) => JSON.stringify({ ...x, pair: x.pair?.map(({ uk, ...p }) => p), history: x.history.map((h) => ({ ...h, players: h.players.map((p) => p.name) })), seats: null });
  for (let i = 1; i <= 10; i++) {
    st = await nextState(en, (x) => x.phase === 'guess' && x.round === i);
    assert.ok(!cyr.test(strip(st)), `стан англійською: ${strip(st).match(/.{0,40}[А-Яа-яІіЇїЄєҐґ].{0,40}/)?.[0]}`);
    await emit(en, 'answer', { side: st.testAnswer });
    st = await nextState(en, (x) => x.phase === 'reveal' && x.round === i);
    assert.ok(!cyr.test(strip(st)), `відповідь англійською: ${strip(st).match(/.{0,40}[А-Яа-яІіЇїЄєҐґ].{0,40}/)?.[0]}`);
    await emit(en, 'next');
  }
  st = await nextState(en, (x) => x.status === 'finished');
  assert.ok(!cyr.test(strip(st)), 'підсумок англійською');
  console.log(`✓ англійська: «${st.history[0].question}» — 10 пар без кирилиці`);
  en.close();

  console.log('\nУСІ ПЕРЕВІРКИ «ОДИН НА ОДИН» ПРОЙШЛИ');
}

run(main);
