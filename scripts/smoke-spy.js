// Автотест «Футбольного шпигуна» через справжній сервер: ролі (футболіст — лише агентам), черга підказок (текст і голос),
// заміна футболіста голосуванням, голосування й бали, вгадування шпигуна, пізній вхід, вихід шпигуна, турнір до перемоги.
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const assert = require('assert');
const { smoke } = require('./lib/smoke');
const { playerById } = require('../server/data');

const { GAME, ready, emit, nextState, run, bot, last, URL, server } = smoke('spy', { SPY_TEST_ANSWER: '1' });

async function main() {
  await ready;

  const games = await (await fetch(`${URL}/api/games`)).json();
  assert.ok(games.some((g) => g.id === 'spy' && g.title === 'Футбольний шпигун'), 'гра є в каталозі');
  assert.strictEqual((await fetch(`${URL}/spy/`)).status, 200);

  const [a, b, c] = [bot(), bot(), bot()];
  const res = await emit(a, 'create', { name: 'Аня', circles: 1, target: 7, difficulty: 'easy' });
  assert.ok(res.ok);
  const code = res.code;
  const info = await (await fetch(`${URL}/api/spy/room/${code}`)).json();
  assert.strictEqual(info.options.target, 7);
  await emit(b, 'join', { code, name: 'Борис' });
  assert.ok((await emit(a, 'start')).error, 'менше трьох — не починаємо');
  await emit(c, 'join', { code, name: 'Віра' });
  assert.ok((await emit(b, 'start')).error, 'почати може лише господар');
  assert.ok((await emit(a, 'start')).ok);
  const socks = [a, b, c];
  const states = await Promise.all(socks.map((s) => nextState(s, (x) => x.status === 'playing')));

  // ── ролі: один шпигун без картки, агенти бачать того самого футболіста; у спільному стані футболіста немає
  const spy = states[0].testSpy;
  const answer = states[0].testAnswer;
  states.forEach((st, i) => {
    assert.strictEqual(st.role, i === spy ? 'spy' : 'agent');
    if (i === spy) assert.strictEqual(st.card, null, 'шпигун не бачить футболіста');
    else assert.strictEqual(st.card.id, answer);
    assert.strictEqual(st.footballer, null);
    assert.strictEqual(st.spy, null, 'хто шпигун — не видно');
  });
  console.log(`✓ ролі: шпигун — місце ${spy}, футболіст — ${playerById.get(answer).uk || answer}`);

  // ── заміна футболіста: двоє «за» — новий, підказки спочатку
  const first = states[0].order[0];
  await emit(socks[first], 'clue', {});
  const agent = [0, 1, 2].find((i) => i !== spy);
  assert.ok((await emit(socks[agent], 'requestReroll')).ok);
  assert.ok((await emit(socks[agent], 'clue', {})).error, 'під час голосування за заміну хід стоїть');
  const other = [0, 1, 2].find((i) => i !== agent);
  await emit(socks[other], 'rerollVote', { yes: true });
  let st = await nextState(a, (x) => !x.reroll && x.testAnswer !== answer);
  assert.strictEqual(st.clues.length, 0, 'підказки спочатку');
  assert.strictEqual(st.testSpy, spy, 'шпигун той самий');
  const answer2 = st.testAnswer;
  console.log('✓ заміна футболіста голосуванням');

  // ── підказки по черзі: не в свій хід — помилка; ім'я футболіста в підказці — заборонено
  const order = st.order;
  const notActive = order[1];
  assert.ok((await emit(socks[notActive], 'clue', { text: 'щось' })).error, 'не свій хід');
  const p = playerById.get(answer2);
  const word = (p.uk || p.name).split(' ').pop();
  if (order[0] !== spy && word.length >= 4) assert.ok((await emit(socks[order[0]], 'clue', { text: `це ${word}` })).error, 'ім’я в підказці');
  assert.ok((await emit(socks[order[0]], 'clue', { text: 'грав у Європі' })).ok);
  await emit(socks[order[1]], 'clue', {}); // голосом
  // пізній вхід посеред матчу: без ролі, у матчі не бере участі
  const d = bot();
  await emit(d, 'join', { code, name: 'Гліб' });
  const dSt = await nextState(d);
  assert.strictEqual(dSt.role, null, 'пізній — без ролі');
  assert.ok(!dSt.players.includes(dSt.you));
  await emit(socks[order[2]], 'clue', { text: 'відомий' });
  st = await nextState(a, (x) => x.phase === 'vote');
  assert.deepStrictEqual(st.clues.map((x) => x.text), ['грав у Європі', null, 'відомий']);
  console.log('✓ підказки по черзі (текст і голос), пізній гравець — з наступного матчу');

  // ── голосування: обидва агенти за шпигуна → шпигун 0, агенти +1; шпигун вгадує → +2
  assert.ok((await emit(socks[agent], 'vote', { target: agent })).error, 'за себе не можна');
  assert.ok((await emit(d, 'vote', { target: spy })).error, 'пізній не голосує');
  for (const i of [0, 1, 2]) await emit(socks[i], 'vote', { target: i === spy ? (spy + 1) % 3 : spy });
  st = await nextState(a, (x) => x.phase === 'spyGuess');
  assert.strictEqual(st.spy, spy);
  assert.strictEqual(st.spyPoints, 0, 'шпигуна викрили');
  assert.strictEqual(st.footballer, null, 'футболіст ще прихований');
  assert.ok((await emit(socks[agent], 'spyGuess', { playerId: answer2 })).error, 'вгадує лише шпигун');
  const g = await emit(socks[spy], 'spyGuess', { playerId: answer2 });
  assert.ok(g.correct);
  st = await nextState(a, (x) => x.phase === 'reveal');
  assert.strictEqual(st.footballer.id, answer2);
  [0, 1, 2].forEach((i) => assert.strictEqual(st.scores[i], i === spy ? 2 : 1));
  console.log('✓ голосування: шпигуна викрили (0), агенти +1, шпигун вгадав футболіста +2');

  // ── наступний матч: усі натиснули «далі»; новий шпигун (не той самий), пізній тепер грає
  const all = [a, b, c, d];
  for (const s of all) await emit(s, 'next');
  st = await nextState(a, (x) => x.match === 2 && x.phase === 'clues');
  assert.notStrictEqual(st.testSpy, spy, 'шпигун не двічі поспіль');
  assert.strictEqual(st.players.length, 4, 'пізній гравець у грі');
  console.log('✓ другий матч: 4 гравці, новий шпигун');

  // ── вихід шпигуна під час підказок — матч скасовано, бали лишаються
  const scores = st.scores.slice(0, 4);
  const spy2 = st.testSpy;
  await emit(all[spy2], 'leave');
  st = await nextState(all[(spy2 + 1) % 4], (x) => x.status === 'waiting');
  assert.ok(st.notice.includes('Шпигун'));
  assert.deepStrictEqual(st.scores.filter((_, i) => i !== spy2).slice(0, 3), scores.filter((_, i) => i !== spy2).slice(0, 3));
  console.log('✓ шпигун вийшов — матч скасовано, бали збережено');

  // ── турнір до 7: агенти завжди вказують на шпигуна, шпигун вгадує → доки хтось один не набере 7
  const left = all.filter((_, i) => i !== spy2);
  const host = left.find((s) => last.get(s).you === last.get(s).host);
  assert.ok((await emit(host, 'start')).ok);
  for (let m = 0; m < 30; m++) {
    st = await nextState(host, (x) => x.status === 'finished' || x.phase === 'clues');
    if (st.status === 'finished') break;
    const bySeat = Object.fromEntries(left.map((s) => [last.get(s).you, s]));
    const sp = st.testSpy;
    while (last.get(host).phase === 'clues') {
      const cur = last.get(host);
      await emit(bySeat[cur.active], 'clue', {});
      await nextState(host, (x) => x.phase !== 'clues' || x.clues.length > cur.clues.length);
    }
    for (const [seat, s] of Object.entries(bySeat)) {
      const target = Number(seat) === sp ? Number(Object.keys(bySeat).find((x) => Number(x) !== sp)) : sp;
      await emit(s, 'vote', { target });
    }
    await nextState(host, (x) => x.phase === 'spyGuess');
    await emit(bySeat[sp], 'spyGuess', { playerId: st.testAnswer });
    await nextState(host, (x) => x.phase === 'reveal');
    for (const s of left) await emit(s, 'next');
    await nextState(host, (x) => x.status === 'finished' || x.match > st.match);
  }
  st = await nextState(host, (x) => x.status === 'finished');
  assert.ok(st.scores[st.winner] >= 7, 'переможець набрав 7');
  assert.ok(st.history.length >= 3);
  console.log(`✓ турнір: матчів — ${st.history.length}, переможець — ${st.seats[st.winner].name} (${st.scores[st.winner]})`);

  for (const s of all) s.close();

  // ── англійська: каталог, помилки й стан — без кирилиці (крім імен: поля uk/name); англійське ім'я в підказці теж заборонене
  const CYR = /[А-Яа-яІіЇїЄєҐґ]/;
  const noNames = (x) => JSON.stringify(x, (k, v) => (k === 'uk' || k === 'name' ? undefined : v));
  const gamesEn = await (await fetch(`${URL}/api/games?lang=en`)).json();
  assert.strictEqual(gamesEn.find((g) => g.id === 'spy').title, 'Football Spy');
  const [e1, e2, e3] = [bot('en'), bot('en'), bot('en')];
  const er = await emit(e1, 'create', { name: 'Ann', circles: 1, target: 7, difficulty: 'easy' });
  await emit(e2, 'join', { code: er.code, name: 'Bob' });
  const tooFew = await emit(e1, 'start');
  assert.ok(tooFew.error && !CYR.test(tooFew.error), `помилка англійською: ${tooFew.error}`);
  await emit(e3, 'join', { code: er.code, name: 'Cid' });
  assert.ok((await emit(e1, 'start')).ok);
  const es = await nextState(e1, (x) => x.status === 'playing');
  assert.ok(!CYR.test(noNames(es)), `стан англійською: ${noNames(es).match(/.{0,40}[А-Яа-яІіЇїЄєҐґ].{0,40}/)?.[0]}`);
  const eBy = [e1, e2, e3];
  const turn = es.order[0];
  if (turn !== es.testSpy) {
    const word = playerById.get(es.testAnswer).name.split(' ').filter((w) => w.length >= 4).pop();
    if (word) {
      const bad = await emit(eBy[turn], 'clue', { text: `plays like ${word}` });
      assert.ok(bad.error && !CYR.test(bad.error), `англійське ім'я в підказці заборонене: ${bad.error}`);
    }
  }
  eBy.forEach((s) => s.close());
  console.log('✓ англійська: каталог, помилки, стан, заборона імені');
  console.log('\nУСІ ПЕРЕВІРКИ «ШПИГУНА» ПРОЙШЛИ');
}

run(main, 15000);
