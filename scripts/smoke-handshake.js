// Автотест «Правило рукостискань» через справжній сервер: граф одноклубників (оренди віднімаються, збірні не рахуються),
// пари на потрібній відстані, соло (найкоротший — 100, помилка, підказка, зайва ланка, ліміт помилок),
// кімната (чужий ланцюжок — лише кількість ланок, першому найкоротшим +10), англійська.
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const assert = require('assert');
const { smoke } = require('./lib/smoke');
const { io } = require('socket.io-client');

const { GAME, ready, emit, nextState, run, act, URL } = smoke('handshake', { HANDSHAKE_TEST_ANSWER: '1', HANDSHAKE_REVEAL_MS: '400' });

// останній отриманий стан (без очікування нового)
const lastState = new WeakMap();
const nextStateNow = async (s) => lastState.get(s);
const track = (s) => { s.on('state', (st) => lastState.set(s, st)); return s; };

async function main() {
  // ── граф
  const g = require('../server/games/handshake/graph');
  const { players } = require('../server/data');
  assert.ok(g.linked('lionel-messi', 'neymar') && g.linked('neymar', 'lionel-messi'), 'Мессі й Неймар — разом у Барселоні');
  assert.strictEqual(g.linkOf('lionel-messi', 'neymar').club.uk, 'Барселона');
  assert.ok(!g.linked('mason-mount', 'eden-hazard'), 'Маунт у 2017–19 був в оренді — з Азаром у Челсі не грав');
  assert.ok(!g.linked('lionel-messi', 'angel-di-maria') || g.linkOf('lionel-messi', 'angel-di-maria').club.uk === 'ПСЖ', 'збірна не рахується');
  for (const level of ['easy', 'normal', 'fan']) {
    for (let i = 0; i < 10; i++) {
      const pair = g.makePair(level);
      assert.ok(pair, `пара ${level}`);
      const best = g.shortestPath(pair.start.id, pair.finish.id);
      assert.strictEqual(best.length - 1, pair.steps, 'найкоротший — рівно потрібна кількість кроків');
      assert.ok(best.every((id, k) => !k || g.linked(best[k - 1], id)), 'шлях — з одноклубників');
      assert.ok(g.LEVELS[level].steps.includes(pair.steps));
    }
  }
  console.log('✓ граф:', g.links.size, 'гравців; Мессі — Неймар:', g.linkOf('lionel-messi', 'neymar').years);

  await ready;
  const games = await (await fetch(`${URL}/api/games`)).json();
  assert.ok(games.some((x) => x.id === 'handshake'), 'гра є в каталозі');
  assert.strictEqual((await fetch(`${URL}/handshake/`)).status, 200);

  // хтось, хто з цим гравцем разом не грав (для помилки)
  const stranger = (id, also) => players.find((p) => p.id !== id && !g.linked(id, p.id) && p.id !== also).id;
  // пройти шлях від останнього в ланцюжку до фінішу (останній гравець шляху — фініш — додається сам)
  async function walk(s, best) {
    let st;
    for (let k = 1; k < best.length - 1; k++) {
      const before = (await nextStateNow(s)).myChain.length;
      const res = await act(s, 'add', { playerId: best[k] }, (x) => x.myChain.length > before || x.myResult);
      assert.ok(res.res.linked, `ланка ${k}`);
      st = res.st;
    }
    return st;
  }

  // ── соло
  const solo = track(io(GAME));
  let { res, st } = await act(solo, 'create', { name: 'Соло', solo: true, rounds: 5, mistakes: 3, difficulty: 'normal', turnSeconds: 0 }, (x) => x.status === 'playing');
  assert.ok(res.ok, 'соло створено');
  assert.strictEqual(st.best, null, 'найкоротший прихований');
  assert.strictEqual(st.steps, 3);
  assert.strictEqual(st.myChain.length, 1, 'ланцюжок починається зі старту');
  st = await walk(solo, st.testAnswer);
  st = st.myResult ? st : await nextState(solo, (x) => x.phase === 'reveal');
  assert.ok(st.myResult.done);
  assert.strictEqual(st.myResult.links, 3);
  assert.strictEqual(st.scores[0], 100, 'найкоротший — 100');
  assert.strictEqual(st.myChain[st.myChain.length - 1].player.id, st.finish.id, 'фініш додано сам');
  assert.ok(st.myChain[1].link.club && st.myChain[1].link.years, 'ланка підписана клубом і роками');
  console.log('✓ соло: найкоротший ланцюжок —', st.myChain.map((x) => x.player.uk).join(' → '), '— 100');

  // помилка, повтор, підказки → 100 − 10 − 15 − 25
  ({ st } = await act(solo, 'next', null, (x) => x.round === 2 && x.phase === 'guess'));
  const best2 = st.testAnswer;
  ({ res, st } = await act(solo, 'add', { playerId: stranger(st.start.id, st.finish.id) }, (x) => x.myMistakes === 1));
  assert.strictEqual(res.linked, false, 'не одноклубник — помилка');
  assert.strictEqual(st.myChain.length, 1, 'помилка в ланцюжок не йде');
  assert.ok((await emit(solo, 'add', { playerId: st.start.id })).error, 'той, хто вже в ланцюжку, — ні');
  ({ st } = await act(solo, 'hint', null, (x) => x.myHints.length === 1));
  assert.ok(st.myHints[0].club, 'підказка — клуб');
  assert.ok((await emit(solo, 'hint')).error, 'друга підказка для тієї ж ланки — ні');
  assert.strictEqual(st.myPotential, 75, 'дійдеш найкоротшим — 100 − 10 − 15');
  ({ st } = await act(solo, 'hint', { kind: 'letter' }, (x) => x.myHints.length === 2));
  const next = g.playerById.get(best2[1]);
  const words = next.uk.split(/\s+/);
  assert.strictEqual(st.myHints[1].letter, (words.length > 1 ? words.slice(1).join(' ') : words[0])[0].toUpperCase(), 'літера — прізвища наступного на найкоротшому шляху');
  assert.ok((await emit(solo, 'hint', { kind: 'letter' })).error, 'другу літеру для тієї ж ланки — ні');
  assert.strictEqual(st.myPotential, 50, 'після літери — ще −25');
  st = await walk(solo, best2);
  st = st.myResult ? st : await nextState(solo, (x) => x.myResult);
  assert.strictEqual(st.myResult.points, 50, '100 − 10 за помилку − 15 за клуб − 25 за літеру');
  console.log('✓ соло: помилка, підказки клуб і літера — 50');

  // зайва ланка: одноклубник старту, від якого до фінішу стільки ж кроків
  ({ st } = await act(solo, 'next', null, (x) => x.round === 3 && x.phase === 'guess'));
  const toFinish = g.distances(st.finish.id);
  const detour = [...g.links.get(st.start.id).keys()].find((y) => toFinish.get(y) === st.steps);
  let total = 150;
  if (detour) {
    ({ st } = await act(solo, 'add', { playerId: detour }, (x) => x.myChain.length === 2));
    st = await walk(solo, g.shortestPath(detour, st.finish.id)); // від detour, який уже в ланцюжку
    st = st.myResult ? st : await nextState(solo, (x) => x.myResult);
    assert.strictEqual(st.myResult.links, st.steps + 1);
    assert.strictEqual(st.myResult.points, 80, 'одна зайва ланка — 80');
    total += 80;
    console.log('✓ соло: на одну ланку довше — 80');
  } else {
    ({ st } = await act(solo, 'giveUp', null, (x) => x.myResult));
  }

  // ліміт помилок: 3 — раунд закінчено, 0 очок
  ({ st } = await act(solo, 'next', null, (x) => x.round === 4 && x.phase === 'guess'));
  const wrong = players.filter((p) => !g.linked(st.start.id, p.id) && p.id !== st.start.id && p.id !== st.finish.id).slice(0, 3);
  for (let i = 0; i < 2; i++) ({ st } = await act(solo, 'add', { playerId: wrong[i].id }, (x) => x.myMistakes === i + 1));
  ({ st } = await act(solo, 'add', { playerId: wrong[2].id }, (x) => x.phase === 'reveal'));
  assert.strictEqual(st.myResult.done, false);
  assert.strictEqual(st.scores[0], total, 'не дійшов — 0');
  assert.ok(st.best.length === st.steps + 1, 'після раунду — найкоротший ланцюжок');
  console.log('✓ соло: 3 помилки — раунд закінчено, 0');

  ({ st } = await act(solo, 'next', null, (x) => x.round === 5 && x.phase === 'guess'));
  ({ st } = await act(solo, 'giveUp', null, (x) => x.phase === 'reveal'));
  ({ st } = await act(solo, 'next', null, (x) => x.status === 'finished'));
  assert.strictEqual(st.history.length, 5);
  const ends = st.history.flatMap((h) => [h.start.id, h.finish.id]);
  assert.strictEqual(new Set(ends).size, 10, 'кінці ланцюжків не повторюються');
  solo.close();
  console.log('✓ соло: серія з 5, рахунок', st.scores[0]);

  // ── англійська
  const CYR = /[А-Яа-яІіЇїЄєҐґ]/;
  const en = track(io(GAME, { auth: { lang: 'en' } }));
  ({ st } = await act(en, 'create', { name: 'Bot', solo: true, rounds: 3 }, (x) => x.status === 'playing'));
  ({ st } = await act(en, 'add', { playerId: st.testAnswer[1] }, (x) => x.myChain.length === 2));
  assert.ok(!CYR.test(st.myChain[1].link.club), 'клуб англійською: ' + st.myChain[1].link.club);
  const enErr = (await emit(en, 'add', { playerId: 'nobody' })).error;
  assert.ok(enErr && !CYR.test(enErr), 'помилка англійською: ' + enErr);
  en.close();
  console.log('✓ англійська:', st.myChain[1].link.club, st.myChain[1].link.years);

  // ── кімната
  const a = track(io(GAME));
  const b = track(io(GAME));
  ({ res } = await act(a, 'create', { name: 'Аня', rounds: 3, mistakes: 0, turnSeconds: 180, difficulty: 'easy' }, (x) => x.status === 'waiting'));
  const code = res.code;
  const info = await (await fetch(`${URL}/api/handshake/room/${code}`)).json();
  assert.deepStrictEqual(info.players, ['Аня']);
  await emit(b, 'join', { code, name: 'Борис' });
  assert.ok((await emit(b, 'start')).error, 'почати може лише господар');
  const bPlaying = nextState(b, (x) => x.status === 'playing');
  ({ st } = await act(a, 'start', null, (x) => x.status === 'playing'));
  await bPlaying;
  assert.strictEqual(st.steps, 2);
  // без обмеження: 4 помилки Б — гра триває
  for (let i = 0; i < 4; i++) assert.ok(!(await emit(b, 'add', { playerId: players.filter((p) => !g.linked(st.start.id, p.id))[i + 1].id })).error);
  const bSees = nextState(b, (x) => x.progress[0].result);
  await walk(a, st.testAnswer);
  const bView = await bSees;
  assert.strictEqual(bView.progress[0].links, 2, 'чужий прогрес — кількість ланок');
  assert.strictEqual(bView.progress[0].chain, null, 'чужого ланцюжка під час раунду не видно');
  assert.strictEqual(bView.myChain.length, 1, 'у Б — свій ланцюжок');
  ({ st } = await act(b, 'giveUp', null, (x) => x.phase === 'reveal'));
  assert.strictEqual(st.scores[0], 110, 'А: найкоротший і першим — 110');
  assert.strictEqual(st.scores[1], 0);
  assert.ok(st.progress[0].chain.length === 3, 'після раунду — ланцюжки всіх');
  console.log('✓ кімната: А першим найкоротшим — 110, Б здався; чужі ланцюжки — лише після раунду');

  await nextState(a, (x) => x.round === 2 && x.phase === 'guess');
  b.close();
  await nextState(a, (x) => x.seats[1] && !x.seats[1].connected);
  ({ st } = await act(a, 'giveUp', null, (x) => x.phase === 'reveal'));
  console.log('✓ гравець офлайн не тримає раунд');

  await emit(a, 'leave');
  console.log('\nУСІ ПЕРЕВІРКИ «ПРАВИЛА РУКОСТИСКАНЬ» ПРОЙШЛИ');
}

run(main);
