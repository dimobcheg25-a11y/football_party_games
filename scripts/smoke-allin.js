// Автотест «All in» через справжній сервер: питання (усі мають число й текст обома мовами), коефіцієнти табло,
// соло (вилка впевненості, ставка, ALL IN), кімната з 3 ботами (приховані оцінки, табло, ставки наживо, «не більше»,
// «менше за всіх», бонус автору, фінальний раунд ×2), англійська.
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { io } = require('socket.io-client');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const URL = `http://localhost:${PORT}`;
const GAME = `${URL}/allin`;

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT, ALLIN_TEST_ANSWER: '1', ALLIN_REVEAL_MS: '1500', ALLIN_BET_MS: '3000' },
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

async function main() {
  await new Promise((res) => server.stdout.on('data', (d) => d.toString().includes('запущено') && res()));

  const games = await (await fetch(`${URL}/api/games`)).json();
  const meta = games.find((g) => g.id === 'allin');
  assert.ok(meta && meta.solo && meta.friends === '2–8', 'гра є в каталозі, соло й 2–8');
  assert.strictEqual((await fetch(`${URL}/allin/`)).status, 200);
  const cats = await (await fetch(`${URL}/api/allin/categories`)).json();
  for (const id of ['personal', 'career', 'nation', 'money']) assert.ok(cats.some((c) => c.id === id), `група ${id} доступна`);
  console.log(`✓ каталог і групи: ${cats.map((c) => `${c.id} (${c.questions.length})`).join(', ')}`);

  // ── питання: число є, текст обома мовами, з ім'ям
  const { questionsFor, candidates } = require('../server/games/allin/questions');
  const { oddsOf } = require('../server/games/allin/room');
  const avail = questionsFor(null, 'normal');
  assert.ok(avail.length >= 12, 'на звичайному рівні є питання');
  for (const q of avail) {
    for (const p of candidates(q, 'normal').slice(0, 30)) {
      const v = q.answer(p);
      assert.ok(Number.isFinite(v) && v >= 0, `${q.id}: число`);
      const t = q.ask(p);
      assert.ok(t.uk.includes(p.uk || p.name) && t.en.includes(p.name), `${q.id}: ім'я в питанні`);
    }
  }
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((i) => oddsOf(i, 5)), [4, 3, 2, 3, 4], 'непарна кількість — центр ×2');
  assert.deepStrictEqual([0, 1, 2, 3].map((i) => oddsOf(i, 4)), [4, 3, 3, 4], 'парна — дві середні ×3');
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => oddsOf(i, 8)), [5, 5, 4, 3, 3, 4, 5, 5], 'краї — не більше ×5');
  console.log(`✓ ${avail.length} питань на звичайному рівні; коефіцієнти табло`);

  // ── соло: влучив вузькою вилкою з ALL IN, не влучив — докладене згоріло, маркер безкоштовний
  const s1 = bot();
  let res = await emit(s1, 'create', { name: 'Соло', solo: true, rounds: 5 });
  assert.ok(res.ok);
  let st = await nextState(s1, (x) => x.phase === 'guess');
  assert.strictEqual(st.answer, null, 'відповідь прихована');
  assert.strictEqual(st.deadline, null, 'соло — без таймера');
  assert.strictEqual(st.question.ranges.length, 3, 'три вилки');
  assert.ok(st.question.player.name && st.question.text, 'гравець і питання');
  assert.ok((await emit(s1, 'guess', { value: 'abc', level: 0 })).error, 'не число — помилка');
  assert.ok((await emit(s1, 'guess', { value: st.testAnswer, level: 0, extra: 101 })).error, 'більше за банк не поставиш');
  res = await emit(s1, 'guess', { value: st.testAnswer, level: 0, extra: 100 });
  assert.ok(res.ok && res.hit, 'точна оцінка влучає');
  st = await nextState(s1, (x) => x.phase === 'reveal');
  assert.strictEqual(st.banks[0], 100 - 100 + (10 + 100) * 5, 'ALL IN ×5');
  assert.strictEqual(st.answer.value, st.testAnswer);
  await emit(s1, 'next');
  st = await nextState(s1, (x) => x.phase === 'guess' && x.round === 2);
  const bank = st.banks[0];
  await emit(s1, 'guess', { value: st.testAnswer * 3 + 50, level: 2, extra: 40 });
  st = await nextState(s1, (x) => x.phase === 'reveal' && x.round === 2);
  assert.ok(!st.results[0].hit && st.banks[0] === bank - 40, 'промах — докладене згоріло');
  for (let r = 3; r <= 5; r++) {
    await emit(s1, 'next');
    st = await nextState(s1, (x) => x.phase === 'guess' && x.round === r);
    if (r === 5) assert.strictEqual(st.mult, 2, 'останній раунд ×2');
    await emit(s1, 'guess', { value: st.testAnswer, level: 1, extra: 0 });
    st = await nextState(s1, (x) => x.phase === 'reveal' && x.round === r);
    assert.strictEqual(st.results[0].win, 10 * 3 * (r === 5 ? 2 : 1), 'безкоштовний маркер ×3');
  }
  await emit(s1, 'next');
  st = await nextState(s1, (x) => x.status === 'finished');
  assert.strictEqual(st.history.length, 5);
  console.log(`✓ соло: вилки, ALL IN, промах, фінальний ×2 — банк ${st.banks[0]}`);
  s1.close();

  // ── кімната: 3 гравці
  const [a, b, c] = [bot(), bot(), bot()];
  res = await emit(a, 'create', { name: 'Аня', rounds: 5, seconds: 20 });
  assert.ok((await emit(a, 'start')).error, 'сам не почнеш');
  await emit(b, 'join', { code: res.code, name: 'Борис' });
  await emit(c, 'join', { code: res.code, name: 'Віра' });
  await emit(a, 'start');
  st = await nextState(a, (x) => x.phase === 'guess');
  assert.ok(st.deadline > st.serverNow, 'таймер оцінки');
  let ans = st.testAnswer;
  // Аня — точно, Борис — більше (не годиться), Віра — менше
  await emit(a, 'guess', { value: ans });
  const bView = await nextState(b, (x) => x.guessed.includes(0));
  assert.strictEqual(bView.myGuess, null, 'свою оцінку бачиш лише ти');
  assert.ok(!JSON.stringify(bView.slots).includes(String(ans)) || bView.slots.length === 0, 'чужих оцінок до табло не видно');
  assert.strictEqual(last.get(a).myGuess, ans);
  await emit(b, 'guess', { value: ans + 1000 });
  await emit(c, 'guess', { value: Math.max(0, ans - 1) === ans ? 0 : ans - 1 });
  st = await nextState(a, (x) => x.phase === 'bet');
  const exact = st.slots.findIndex((x) => x.value === ans);
  const over = st.slots.findIndex((x) => x.value === ans + 1000);
  assert.ok(exact > 0 && over > exact && st.slots[0].value === null && st.slots[0].odds === 6, 'табло: «менше за всіх» + оцінки за зростанням');
  assert.deepStrictEqual(st.slots[exact].authors, [0]);
  // ставки: Аня — ALL IN на свою, Борис — на свою + 30, Віра — маркер на Аню
  assert.ok((await emit(a, 'bet', { bets: [{ slot: exact, extra: 101 }, { slot: -1 }] })).error, 'більше за банк — ні');
  await emit(a, 'bet', { bets: [{ slot: exact, extra: 100 }, { slot: -1, extra: 0 }] });
  const cView = await nextState(c, (x) => x.bets[0]);
  assert.strictEqual(cView.bets[0][0].extra, 100, 'ставки видно наживо');
  await emit(b, 'bet', { bets: [{ slot: over, extra: 30 }, { slot: 0, extra: 0 }] });
  await emit(c, 'bet', { bets: [{ slot: exact, extra: 0 }, { slot: -1, extra: 0 }] });
  for (const s of [a, b, c]) assert.ok((await emit(s, 'done')).ok);
  assert.ok((await emit(a, 'bet', { bets: [{ slot: 0, extra: 0 }, { slot: -1 }] })).error, 'після «Готово» не змінити');
  st = await nextState(a, (x) => x.phase === 'reveal');
  assert.strictEqual(st.win, exact, 'виграє найближча не більша');
  const odds = st.slots[exact].odds;
  assert.strictEqual(st.results[0].net, (10 + 100) * odds + 20 - 100, 'Аня: ALL IN × коеф. + бонус автору');
  assert.strictEqual(st.banks[1], 100 - 30, 'Борис: докладене згоріло');
  assert.strictEqual(st.banks[2], 100 + 10 * odds, 'Віра: безкоштовний маркер');
  console.log(`✓ кімната: табло, ставки наживо, «не більше», ALL IN ×${odds} + бонус автору`);

  // раунд 2: усі завищили — виграє «менше за всіх»; хто не поставив — 0; таймер ставок закриває раунд
  st = await nextState(a, (x) => x.phase === 'guess' && x.round === 2);
  ans = st.testAnswer;
  await emit(a, 'guess', { value: ans + 5 });
  await emit(b, 'guess', { value: ans + 7 });
  await emit(c, 'guess', { value: ans + 5 });
  st = await nextState(a, (x) => x.phase === 'bet' && x.round === 2);
  assert.strictEqual(st.slots.length, 3, 'однакові оцінки — одна клітинка');
  assert.deepStrictEqual(st.slots[1].authors, [0, 2]);
  const bankB = st.banks[1];
  await emit(b, 'bet', { bets: [{ slot: 0, extra: 10 }, { slot: -1, extra: 0 }] });
  st = await nextState(a, (x) => x.phase === 'reveal' && x.round === 2);
  assert.strictEqual(st.win, 0, 'усі більші — «менше за всіх»');
  assert.strictEqual(st.banks[1], bankB - 10 + 20 * 6, '«менше за всіх» ×6');
  console.log('✓ кімната: однакові оцінки — одна клітинка, «менше за всіх» ×6, таймер ставок');
  for (const s of [a, b, c]) await emit(s, 'next');
  // решта раундів — швидко; останній ×2
  for (let r = 3; r <= 5; r++) {
    st = await nextState(a, (x) => x.phase === 'guess' && x.round === r);
    for (const s of [a, b, c]) await emit(s, 'guess', { value: st.testAnswer });
    st = await nextState(a, (x) => x.phase === 'bet' && x.round === r);
    if (r === 5) assert.strictEqual(st.mult, 2);
    const before = st.banks[2];
    for (const s of [a, b, c]) { await emit(s, 'bet', { bets: [{ slot: 1, extra: 0 }, { slot: -1, extra: 0 }] }); await emit(s, 'done'); }
    st = await nextState(a, (x) => x.phase === 'reveal' && x.round === r);
    assert.strictEqual(st.banks[2] - before, (10 * st.slots[1].odds + 20) * (r === 5 ? 2 : 1), `раунд ${r}: виграш`);
    for (const s of [a, b, c]) await emit(s, 'next');
  }
  st = await nextState(a, (x) => x.status === 'finished');
  assert.strictEqual(st.history.length, 5);
  console.log('✓ кімната: 5 раундів, фінальний ×2, підсумок');
  for (const s of [a, b, c]) s.close();

  // ── англійська
  const cyr = /[А-Яа-яІіЇїЄєҐґ]/;
  const catsEn = await (await fetch(`${URL}/api/allin/categories?lang=en`)).json();
  assert.ok(!cyr.test(JSON.stringify(catsEn)), 'групи англійською');
  const en = bot('en');
  await emit(en, 'create', { name: 'En', solo: true, rounds: 10 });
  res = await emit(en, 'guess', { value: 'x', level: 0 });
  assert.ok(res.error === 'Enter a number' || res.error === 'Enter a year');
  const strip = (x) => JSON.stringify({ ...x, question: x.question && { ...x.question, player: null }, seats: null, answer: x.answer && { ...x.answer, detail: null } });
  for (let i = 1; i <= 10; i++) {
    st = await nextState(en, (x) => x.phase === 'guess' && x.round === i);
    assert.ok(!cyr.test(strip(st)), `стан англійською: ${strip(st).match(/.{0,40}[А-Яа-яІіЇїЄєҐґ].{0,40}/)?.[0]}`);
    await emit(en, 'guess', { value: st.testAnswer, level: 2 });
    st = await nextState(en, (x) => x.phase === 'reveal' && x.round === i);
    await emit(en, 'next');
  }
  st = await nextState(en, (x) => x.status === 'finished');
  console.log(`✓ англійська: «${st.history[0].question}»`);
  en.close();

  console.log('\nУСІ ПЕРЕВІРКИ «ALL IN» ПРОЙШЛИ');
}

main()
  .then(() => { server.kill(); process.exit(0); })
  .catch((e) => { console.error('✗', e); server.kill(); process.exit(1); });
