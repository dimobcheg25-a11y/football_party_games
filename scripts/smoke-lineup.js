// Автотест «Складу матчу» через справжній сервер: матчі з бази (фінали, Металіст), соло (гравець +3, підказка на обрану футболку −1,
// тренер, помилка, «Досить» — знайдене лишається), кімната «кожен свій склад» (чужих відповідей не видно, раунд — коли «Досить» натиснули всі),
// кімната «по черзі» (хід, підказку бере той, чий хід, пас), англійська.
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { io } = require('socket.io-client');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const URL = `http://localhost:${PORT}`;
const GAME = `${URL}/lineup`;

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT, LINEUP_TEST_ANSWER: '1' },
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
const slotsOf = (st) => st.match.teams.flatMap((t) => [...t.xi, ...t.bench, ...(t.coach ? [t.coach] : [])]);
// гравець, якого точно немає в цьому матчі
const outsider = (st) => ['oleg-blokhin', 'pele', 'eusebio', 'diego-maradona', 'johan-cruyff'].find((id) => !st.testAnswer.some((a) => a.playerId === id));

async function main() {
  await new Promise((res) => server.stdout.on('data', (d) => d.toString().includes('запущено') && res()));

  const games = await (await fetch(`${URL}/api/games`)).json();
  const meta = games.find((g) => g.id === 'lineup');
  assert.ok(meta && meta.solo && meta.friends, 'гра є в каталозі, соло і з друзями');
  assert.strictEqual((await fetch(`${URL}/lineup/`)).status, 200);

  // ── «Зараз на сайті»: унікальні відвідувачі з усіх сторінок (дві вкладки однієї людини — одна)
  const hub = io(`${URL}/presence`, { auth: { vid: 'smoke-A' } });
  let online = 0;
  hub.on('online', (n) => { online = n; });
  const tab2 = io(`${URL}/top`, { auth: { vid: 'smoke-A' } });
  const other = io(GAME, { auth: { vid: 'smoke-B' } });
  await new Promise((r) => setTimeout(r, 2500));
  assert.strictEqual(online, 2, 'дві вкладки + інший відвідувач — 2');
  other.close();
  await new Promise((r) => setTimeout(r, 2500));
  assert.strictEqual(online, 1, 'інший пішов — 1');
  hub.close();
  tab2.close();
  console.log('✓ «зараз на сайті»: вкладки однієї людини — одна, хто пішов — зникає');

  // ── матчі з бази
  const { matches, matchById } = require('../server/games/lineup/matches');
  const final = matchById.get('ucl-final-2005-05-25');
  assert.ok(final, 'фінал ЛЧ 2005 є');
  assert.deepStrictEqual(final.score, [3, 3]);
  assert.deepStrictEqual(final.pens, [2, 3]);
  const milan = final.teams[0];
  assert.strictEqual(milan.xi.length, 11);
  assert.ok(milan.xi.some((s) => s.pid === 'andriy-shevchenko' && s.flag), 'Шевченко в складі, з прапором (матч клубів)');
  assert.ok(milan.xi.find((s) => s.pid === 'paolo-maldini').capt, 'Мальдіні — капітан');
  assert.ok(milan.xi.find((s) => s.pid === 'hernan-crespo').goals.length === 2, 'Креспо — два голи');
  assert.ok(milan.bench.some((s) => s.pid === 'rui-costa' && s.on), 'Руй Кошта вийшов на заміну');
  assert.ok(milan.coach && milan.coach.pid === 'carlo-ancelotti', 'тренер — Анчелотті');
  const wc = matchById.get('wc-final-2022-12-18');
  assert.ok(wc.teams[0].xi.find((s) => s.pid === 'lionel-messi').club, 'матч збірних: у гравця — клуб');
  const metalist = matches.filter((m) => m.tags.includes('metalist'));
  assert.ok(metalist.length >= 10, 'матчі Металіста');
  assert.ok(metalist.every((m) => m.teams.some((t) => t.coach?.coachKey.includes('markevych'))), 'у Металіста — Маркевич');
  assert.ok(!matches.some((m) => m.id === 'uel-final-2008-05-14'), 'фінал із Зенітом — не загадуємо');
  const coaches = await (await fetch(`${URL}/api/lineup/coaches`)).json();
  assert.ok(coaches.some((c) => c.name === 'Мирон Маркевич'), 'тренери для пошуку — українською');
  console.log(`✓ матчі: ${matches.length} (Металіста — ${metalist.length}), фінал-2005 — склади, голи, капітан, заміни, тренер`);

  // ── соло
  const solo = bot();
  let res = await emit(solo, 'create', { name: 'Соло', solo: true, categories: ['metalist'], subs: true, lives: 3, rounds: 3, roundSeconds: 0 });
  assert.ok(res.ok);
  let st = await nextState(solo, (x) => x.phase === 'guess');
  assert.ok(st.match.teams.length === 2 && st.match.teams.every((t) => t.xi.length === 11), 'обидві команди по 11');
  const hidden = slotsOf(st).filter((s) => !s.missing);
  assert.ok(hidden.every((s) => !s.answer), 'прізвища приховані');
  const [p1, p2] = st.testAnswer.filter((a) => a.playerId);
  res = await emit(solo, 'guess', { playerId: p1.playerId });
  assert.ok(res.correct && res.points === 4, 'гравець — 4 очки');
  // підказка на обрану футболку
  res = await emit(solo, 'hint', { key: p2.key, kind: 'first' });
  assert.ok(res.ok);
  st = await nextState(solo, (x) => x.mine?.hints?.[p2.key]?.first);
  assert.ok(!JSON.stringify(st.match).includes('"first"'), 'свої підказки — лише в приватному стані');
  await emit(solo, 'hint', { key: p2.key, kind: 'letters' });
  res = await emit(solo, 'guess', { playerId: p2.playerId });
  assert.strictEqual(res.points, 2, '2 підказки — 4 − 2 = 2');
  const coach = st.testAnswer.find((a) => a.coachKey && a.coachKey.includes('markevych'));
  res = await emit(solo, 'guess', { coachKey: coach.coachKey });
  assert.ok(res.correct, 'тренера теж називаємо');
  res = await emit(solo, 'guess', { playerId: outsider(st) });
  assert.ok(!res.correct);
  assert.ok((await emit(solo, 'guess', { playerId: p1.playerId })).error, 'повтор не рахується');
  await emit(solo, 'finishRound');
  st = await nextState(solo, (x) => x.phase === 'reveal');
  assert.strictEqual(st.scores[0], 4 + 2 + 4, 'знайдене лишається');
  assert.ok(slotsOf(st).every((s) => s.answer), 'після «Досить» — увесь склад');
  console.log(`✓ соло: +4 за гравця, 2 підказки → +2, тренер, «Досить» — ${st.scores[0]} очок лишилось`);
  solo.close();

  // ── кімната «кожен свій склад»: раунд закінчується, коли «Досить» натиснули обидва
  const [a, b] = [bot(), bot()];
  res = await emit(a, 'create', { name: 'Аня', mode: 'own', lives: 0, rounds: 3, categories: ['ucl', 'wc'] });
  await emit(b, 'join', { code: res.code, name: 'Борис' });
  await emit(a, 'start');
  st = await nextState(a, (x) => x.phase === 'guess');
  const ans = st.testAnswer.find((x) => x.playerId);
  await emit(a, 'guess', { playerId: ans.playerId });
  const bView = await nextState(b, (x) => x.progress[0]?.found >= 1);
  assert.ok(!JSON.stringify(bView.match).includes(ans.playerId) && !bView.mine?.found?.length, 'чужих відповідей не видно');
  await emit(a, 'finishRound');
  st = await nextState(b, (x) => x.finishVotes.includes(0));
  assert.strictEqual(st.phase, 'guess', 'один натиснув «Досить» — раунд іде');
  await emit(b, 'finishRound');
  st = await nextState(a, (x) => x.phase === 'reveal');
  assert.ok(st.roundPoints[0] === 4 && !st.roundPoints[1]);
  console.log('✓ кімната «кожен свій склад»: відповіді приховані, раунд — коли «Досить» натиснули всі');
  a.close();
  b.close();

  // ── кімната «по черзі»
  const [c, d] = [bot(), bot()];
  res = await emit(c, 'create', { name: 'Віра', mode: 'turns', lives: 3, turnSeconds: 0, rounds: 3, categories: ['ucl'] });
  await emit(d, 'join', { code: res.code, name: 'Гліб' });
  await emit(c, 'start');
  st = await nextState(c, (x) => x.phase === 'guess');
  const socks = [c, d];
  const first = st.active;
  const second = 1 - first;
  const t0 = st.testAnswer.filter((x) => x.playerId);
  assert.ok((await emit(socks[second], 'hint', { key: t0[0].key, kind: 'first' })).error, 'підказку бере той, чий хід');
  assert.ok((await emit(socks[first], 'hint', { key: t0[0].key, kind: 'first' })).ok);
  res = await emit(socks[first], 'guess', { playerId: t0[0].playerId });
  assert.strictEqual(res.points, 3);
  st = await nextState(c, (x) => x.active === second);
  assert.ok(slotsOf(st).find((s) => s.key === t0[0].key).answer, 'на спільному полі видно відгаданого');
  await emit(socks[second], 'pass');
  st = await nextState(c, (x) => x.active === first);
  assert.strictEqual(st.lives[second], 2, 'пас — мінус життя');
  console.log('✓ кімната «по черзі»: хід, підказка того, чий хід, спільне поле, пас');
  c.close();
  d.close();

  // ── англійська
  const en = bot('en');
  res = await emit(en, 'create', { name: 'En', solo: true, categories: ['wc'], rounds: 3, roundSeconds: 0 });
  st = await nextState(en, (x) => x.phase === 'guess');
  const cyr = /[А-Яа-яІіЇїЄєҐґ]/;
  assert.ok(!cyr.test(st.match.title) && !cyr.test(st.match.teams.map((t) => t.name).join(' ')), 'назва матчу й команд — англійською');
  res = await emit(en, 'guess', {});
  assert.strictEqual(res.error, 'Pick a player or a coach from the list');
  en.disconnect();
  console.log(`✓ англійська: «${st.match.title}»`);

  console.log('\nУСІ ПЕРЕВІРКИ «СКЛАДУ МАТЧУ» ПРОЙШЛИ');
}

main()
  .then(() => { server.kill(); process.exit(0); })
  .catch((e) => { console.error('✗', e); server.kill(); process.exit(1); });
