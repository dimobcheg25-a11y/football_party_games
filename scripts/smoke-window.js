// Автотест «Трансферного вікна» через справжній сервер: рейтинги (пул 500 в обох режимах, позиції, Мессі ≫ середняк),
// умовний матч (відтворюється з seed, реалістичні голи й картки), кімната з 3 ботами (схему міняє лише господар, нових посеред
// вікна не беруть, торг за право вибору: гравців на одного більше за учасників, таємна ставка, вибір по черзі (перший — за ставку, далі по 2 млн),
// рівні — пріоритет по колу, без пасу, склади за схемою й позиціями,
// бюджет не в мінусі), кінець вікна (сила, знахідка/переплата, матчі всіх з усіма, таблиця), «Ще одна гра», англійська.
// Запуск: npm test (сервер піднімається сам на випадковому порту).

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { io } = require('socket.io-client');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const URL = `http://localhost:${PORT}`;
const GAME = `${URL}/window`;

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT, WINDOW_SOLD_MS: '150', WINDOW_AUTO_MS: '30' },
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
  const meta = games.find((g) => g.id === 'window');
  assert.ok(meta && !meta.solo && meta.friends === '2–8', 'гра є в каталозі, лише з друзями, 2–8');
  assert.strictEqual((await fetch(`${URL}/window/`)).status, 200);

  // ── рейтинги й пул
  const { players } = require('../server/data');
  const R = require('../server/games/window/rating');
  const { FORMATIONS, fits } = require('../server/games/window/room');
  const byId = (id) => players.find((p) => p.id === id);
  for (const mode of ['all', 'modern']) {
    const pool = R.windowPool(mode);
    assert.strictEqual(pool.length, 500, `пул ${mode}: 500`);
    for (const p of pool) {
      const r = R.ratingOf(p);
      assert.ok(r && r.rating >= 40 && r.rating <= 99, `${p.id}: сила 40…99`);
      assert.ok(Object.values(FORMATIONS).flat().some((t) => fits(p, t)), `${p.id}: підходить хоч на одне місце`);
      if (mode === 'modern') assert.ok(r.modern, `${p.id}: у сучасному — повні дані`);
    }
    // кожного типу місця вистачає на 8 гравців з найжаднішою схемою
    for (const t of ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST']) {
      const need = 8 * Math.max(...Object.values(FORMATIONS).map((f) => f.filter((x) => x === t).length));
      assert.ok(pool.filter((p) => fits(p, t)).length >= need, `${mode}: гравців на ${t} ≥ ${need}`);
    }
  }
  assert.ok(R.ratingOf(byId('lionel-messi')).rating >= 95, 'Мессі — еліта');
  assert.ok(R.ratingOf(byId('virgil-van-dijk')).rating > R.ratingOf(byId('david-alaba')).rating, 'Ван Дайк сильніший за Алабу');
  console.log('✓ рейтинги: пул 500 в обох режимах, позиції, Мессі ≥95, Ван Дайк > Алаба');

  // ── умовний матч
  const M = require('../server/games/window/match');
  const pick = (ids) => ids.map(byId);
  const A = pick(['alisson-becker', 'andy-robertson', 'virgil-van-dijk', 'sergio-ramos', 'cafu', 'ngolo-kante', 'luka-modric', 'andrea-pirlo', 'neymar', 'robert-lewandowski', 'mohamed-salah']);
  const B = pick(['gianluigi-buffon', 'joao-cancelo', 'paolo-maldini', 'john-terry', 'stephan-lichtsteiner', 'sergio-busquets', 'frank-lampard', 'mykhailo-mudryk', 'thierry-henry', 'artem-dovbyk', 'andriy-shevchenko']);
  assert.deepStrictEqual(M.simulate(A, B, 42), M.simulate(A, B, 42), 'той самий seed — той самий матч');
  let goals = 0, reds = 0;
  for (let s = 1; s <= 400; s++) {
    const m = M.simulate(A, B, s);
    goals += m.score[0] + m.score[1];
    reds += m.stats.red[0] + m.stats.red[1];
    for (const e of m.events.filter((x) => x.type === 'goal')) {
      assert.ok([...A, ...B].some((p) => p.id === e.player), 'автор гола — з поля');
      assert.ok(e.assist !== e.player, 'сам собі не асистує');
    }
    assert.strictEqual(m.events.filter((e) => e.type === 'goal' && e.team === 0).length, m.score[0], 'голи в протоколі = рахунок');
  }
  assert.ok(goals / 400 > 2 && goals / 400 < 3.6, `голів за матч ${goals / 400}`);
  assert.ok(reds / 400 < 0.3, `червоних за матч ${reds / 400}`);
  console.log(`✓ матч: seed відтворюється, ${(goals / 400).toFixed(2)} гола і ${(reds / 400).toFixed(2)} червоної за матч`);

  // ── кімната: 3 боти
  const [a, b, c] = [bot(), bot(), bot()];
  let res = await emit(a, 'create', { name: 'Аня', formation: '442', seconds: 10 });
  assert.ok(res.ok);
  await emit(b, 'join', { code: res.code, name: 'Борис' });
  await emit(c, 'join', { code: res.code, name: 'Віра' });
  assert.ok((await emit(b, 'formation', { formation: '433' })).error, 'схему міняє лише господар');
  assert.ok((await emit(a, 'formation', { formation: '9-0-1' })).error, 'невідома схема');
  assert.ok((await emit(a, 'formation', { formation: '433' })).ok);
  let st = await nextState(a, (x) => x.options.formation === '433');
  assert.ok((await emit(b, 'start')).error, 'почати може лише господар');
  await emit(a, 'start');
  st = await nextState(a, (x) => x.phase === 'bid');
  assert.strictEqual(st.line, 0, 'спершу воротарі');
  assert.strictEqual(st.lot.people.length, 3, 'торгуються всі троє');
  assert.strictEqual(st.lot.players.length, 4, 'гравців на одного більше, ніж учасників');
  assert.ok(st.lot.players.every((p) => p.name) && st.lot.types.every((t) => t.length), 'лот: гравці і їхні місця');
  assert.ok(st.result === null && !JSON.stringify(st.lot).includes('rating'), 'сила прихована');
  const { recognition } = require('../server/games/path/careers');
  const fames = st.lot.players.map((p) => recognition(byId(p.id)));
  const late = bot();
  assert.ok((await emit(late, 'join', { code: res.code, name: 'Пізній' })).error, 'посеред вікна нових не беруть');
  late.close();
  assert.ok((await emit(a, 'formation', { formation: '442' })).error, 'під час вікна схему не змінити');

  // торги за право вибору: Аня 30, Борис 30 (рівні — пріоритет лоту 1 в Ані), Віра не ставить — таймер, ставка 2
  assert.strictEqual(st.lot.tieWinner, 0, 'пріоритет лоту 1 — у першого');
  assert.ok((await emit(c, 'bid', { amount: 81 })).error, 'максимум = 100 − 10 порожніх місць × 2');
  assert.ok((await emit(c, 'bid', { amount: 1 })).error, 'мінімум — 2 (не дешевше за наступний вибір)');
  assert.ok((await emit(a, 'pick', { i: 0 })).error, 'обирати — лише після торгів');
  assert.ok((await emit(a, 'bid', { amount: 30 })).ok);
  const bView = await nextState(b, (x) => x.bidders.includes(0));
  assert.strictEqual(bView.myBid, null, 'чужих ставок не видно');
  assert.ok(bView.pick === null && !JSON.stringify(bView).includes('"amount"'), 'до кінця торгів суми приховані');
  assert.strictEqual(last.get(a).myBid, 30, 'свою ставку видно собі');
  await emit(b, 'bid', { amount: 30 });
  st = await nextState(a, (x) => x.phase === 'pick');
  assert.deepStrictEqual(st.pick.order, [0, 1, 2], 'черга вибору — за ставками, рівні — за пріоритетом');
  assert.deepStrictEqual(st.pick.bids, { 0: 30, 1: 30, 2: 2 }, 'після торгів ставки відкрито; хто не поставив — 2');
  assert.ok(st.pick.picker === 0 && st.pick.price === 30, 'перший обирає за свою ставку');
  assert.ok((await emit(b, 'pick', { i: 0 })).error, 'не твоя черга');
  assert.ok((await emit(a, 'pick', { i: 3 })).ok);
  st = await nextState(b, (x) => x.phase === 'pick' && x.pick.picker === 1);
  assert.strictEqual(st.pick.price, 2, 'далі — по 2 млн');
  assert.ok((await emit(b, 'pick', { i: 3 })).error, 'забраного не взяти');
  await emit(b, 'pick', { i: 0 });
  st = await nextState(c, (x) => x.phase === 'pick' && x.pick.picker === 2);
  await emit(c, 'pick', { i: 1 });
  st = await nextState(a, (x) => x.phase === 'sold' && x.lotNo === 1);
  assert.deepStrictEqual(st.lastLot.items.map((x) => [x.winner, x.price]), [[0, 30], [1, 2], [2, 2]], 'хто кого взяв і за скільки');
  assert.strictEqual(st.lastLot.leftover.length, 1, 'четвертий — назад у пул');
  assert.ok(st.budgets[0] === 70 && st.budgets[1] === 98 && st.budgets[2] === 98, 'бюджети');
  console.log(`✓ торг за право вибору: 4 гравці на трьох (відомість ${Math.min(...fames).toFixed(0)}–${Math.max(...fames).toFixed(0)}), таємні ставки, мін. 2 / макс., рівні — пріоритет, перший — за ставку, далі по 2 млн, зайвий — у пул`);

  // далі — автоматично: Аня ставить випадково, Борис 2, Віра 3; хто обирає — бере першого доступного
  const acted = new Set();
  let autos = 0, lots = 0, ties = 0;
  const play = (s, name, choose) => s.on('state', (x) => {
    if (x.status !== 'playing') return;
    if (x.phase === 'sold' && name === 'a' && !acted.has(`sold:${x.lotNo}`)) {
      acted.add(`sold:${x.lotNo}`);
      lots++;
      const L = x.lastLot;
      if (L.auto) { autos++; assert.ok(L.items[0].price <= 5, 'без торгів — 5 млн'); return; }
      const winners = L.items.map((it) => it.winner);
      assert.strictEqual(new Set(winners).size, winners.length, 'кожен бере щонайбільше одного');
      const top = Math.max(...Object.values(L.bids));
      const first = L.items[0];
      if (first) {
        assert.strictEqual(first.price, L.bids[first.winner], 'перший платить свою ставку');
        assert.strictEqual(L.bids[first.winner], top, 'першим обирає найбільша ставка');
        const tied = Object.entries(L.bids).filter(([, v]) => v === top).map(([k]) => Number(k));
        if (tied.length > 1) { ties++; assert.strictEqual(first.winner, L.priority.find((q) => tied.includes(q)), 'рівні — за пріоритетом'); }
      }
      for (const it of L.items.slice(1)) assert.strictEqual(it.price, 2, 'далі — по 2 млн');
    }
    if (x.phase === 'bid' && name === 'a') assert.ok(x.lot.eligible.some((e) => e.length >= 2), 'сам із собою не торгуються');
    if (x.phase === 'bid' && x.lot.people.includes(x.you) && !acted.has(`${name}:bid:${x.lotNo}`)) {
      acted.add(`${name}:bid:${x.lotNo}`);
      s.emit('bid', { amount: Math.min(choose(x), x.maxBids[x.you]) }, () => {});
    }
    if (x.phase === 'pick' && x.pick.picker === x.you && !acted.has(`${name}:pick:${x.lotNo}`)) {
      acted.add(`${name}:pick:${x.lotNo}`);
      s.emit('pick', { i: x.pick.options[0] }, () => {});
    }
  });
  play(a, 'a', (x) => 2 + Math.floor(Math.random() * 12));
  play(b, 'b', () => 2);
  play(c, 'c', () => 3);
  st = await nextState(a, (x) => x.status === 'finished');
  const slots = FORMATIONS['433'];
  for (const seat of [0, 1, 2]) {
    const sq = st.squads[seat];
    assert.strictEqual(sq.length, 11, `склад ${seat}: 11 гравців`);
    assert.deepStrictEqual(sq.map((x) => x.slot).sort((p, q) => p - q), [...slots.keys()], 'кожне місце схеми заповнене один раз');
    for (const x of sq) assert.ok(fits(byId(x.id), slots[x.slot]), `${x.id} підходить на ${slots[x.slot]}`);
    assert.ok(st.budgets[seat] >= 0, 'бюджет не в мінусі');
    assert.strictEqual(100 - st.budgets[seat], sq.reduce((t, x) => t + x.price, 0), 'витрачено = сума цін');
  }
  const ids = Object.values(st.squads).flat().map((x) => x.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'гравець — лише в одному складі');
  console.log(`✓ вікно: ${lots} лотів (${autos} без торгів за 5 млн, ${ties} рівних — за пріоритетом), склади 4-3-3 за позиціями, бюджети`);

  // кінець: сила, знахідка/переплата, матчі всіх з усіма, таблиця
  const r = st.result;
  assert.strictEqual(r.teams.length, 3);
  for (const t of r.teams) {
    assert.ok(t.players.every((x) => x.rating >= 40 && x.rating <= 99 && x.player.name), 'сила кожного гравця відкрита');
    assert.ok(t.strength.total > 40 && t.strength.att > 0, 'сила команди й ліній');
  }
  assert.ok(r.bargain && r.overpay && r.bargain.id !== r.overpay.id, 'знахідка й переплата');
  assert.strictEqual(r.matches.length, 3, '3 матчі всіх з усіма');
  for (const m of r.matches) assert.strictEqual(m.events.filter((e) => e.type === 'goal').length, m.score[0] + m.score[1]);
  assert.strictEqual(r.table.reduce((t, x) => t + x.played, 0), 6, 'по 2 матчі в кожного');
  for (let i = 1; i < r.table.length; i++) assert.ok(r.table[i - 1].pts >= r.table[i].pts, 'таблиця за очками');
  console.log(`✓ кінець вікна: таблиця ${r.table.map((x) => `${st.seats[x.seat].name} ${x.pts}`).join(', ')}`);

  // «Ще одна гра» — нове вікно з лоту 1
  await emit(a, 'start');
  st = await nextState(a, (x) => x.status === 'playing' && x.lotNo === 1 && x.phase === 'bid');
  assert.ok(st.squads.every((q) => q.length === 0) && st.budgets[0] === 100, 'нова гра — порожні склади й повний бюджет');
  console.log('✓ «Ще одна гра» — з лоту 1');
  for (const s of [a, b, c]) s.close();

  // ── «Міні» (7 місць, універсальні в межах лінії) + сила лише за голами; асисти — лише сучасний пул
  for (const basis of ['value', 'goals', 'assists', 'trophies']) {
    const t = R.basisTable('all', basis);
    assert.strictEqual(t.size, 500, `${basis}: 500 гравців`);
    if (R.BASES[basis].modern) for (const id of t.keys()) assert.ok(R.ratingOf(byId(id)).modern, `${basis}: лише сучасні`);
  }
  const goalsT = R.basisTable('all', 'goals');
  assert.ok(goalsT.get('cristiano-ronaldo').rating > goalsT.get('gianluigi-buffon').rating, 'за голами Роналду ≫ Буффон');
  const [m1, m2] = [bot(), bot()];
  res = await emit(m1, 'create', { name: 'Міні', formation: 'mini', basis: 'goals', seconds: 10 });
  await emit(m2, 'join', { code: res.code, name: 'Міні2' });
  await emit(m1, 'start');
  for (const [s, k] of [[m1, 'm1'], [m2, 'm2']]) {
    s.on('state', (x) => {
      if (x.status !== 'playing') return;
      if (x.phase === 'bid' && x.lot.people.includes(x.you) && !acted.has(`${k}:bid:${x.lotNo}`)) {
        acted.add(`${k}:bid:${x.lotNo}`);
        s.emit('bid', { amount: Math.min(x.maxBids[x.you], 2 + Math.floor(Math.random() * 20)) }, () => {});
      }
      if (x.phase === 'pick' && x.pick.picker === x.you && !acted.has(`${k}:pick:${x.lotNo}`)) {
        acted.add(`${k}:pick:${x.lotNo}`);
        s.emit('pick', { i: x.pick.options[Math.floor(Math.random() * x.pick.options.length)] }, () => {});
      }
    });
  }
  st = await nextState(m1, (x) => x.status === 'finished');
  assert.strictEqual(st.slots.length, 7, 'міні: 7 місць');
  for (const seat of [0, 1]) {
    assert.strictEqual(st.squads[seat].length, 7);
    for (const x of st.squads[seat]) assert.ok(fits(byId(x.id), st.slots[x.slot]), `${x.id} — зі своєї лінії`);
  }
  assert.strictEqual(st.result.basis, 'goals');
  for (const t of st.result.teams) for (const x of t.players) assert.strictEqual(x.rating, goalsT.get(x.player.id).rating, 'сила — за голами');
  assert.ok(st.result.teams[0].players.every((x) => Number.isInteger(x.value)), 'кількість голів — у підсумку');
  assert.strictEqual(st.result.matches.length, 1);
  console.log(`✓ «Міні» 7 місць + сила за голами: ${st.result.teams.map((t) => t.strength.total).join(' проти ')}`);
  for (const s of [m1, m2]) s.close();

  // ── англійська
  const cyr = /[А-Яа-яІіЇїЄєҐґ]/;
  const [e1, e2] = [bot('en'), bot('en')];
  res = await emit(e1, 'create', { name: 'En', formation: '352' });
  await emit(e2, 'join', { code: res.code, name: 'En2' });
  await emit(e1, 'start');
  st = await nextState(e1, (x) => x.phase === 'bid');
  const strip = (x) => JSON.stringify({ ...x, seats: null, lot: x.lot && { ...x.lot, players: x.lot.players.map((p) => ({ ...p, uk: null })) }, squads: null, news: null });
  assert.ok(!cyr.test(strip(st)), `стан англійською: ${strip(st).match(/.{0,40}[А-Яа-яІіЇїЄєҐґ].{0,40}/)?.[0]}`);
  res = await emit(e1, 'bid', { amount: 999 });
  assert.ok(/at most/.test(res.error), 'помилка англійською');
  console.log(`✓ англійська: «${st.lines[0]}», «${st.lot.players[0].pos}»`);
  for (const s of [e1, e2]) s.close();

  console.log('\nУСІ ПЕРЕВІРКИ «ТРАНСФЕРНОГО ВІКНА» ПРОЙШЛИ');
}

main()
  .then(() => { server.kill(); process.exit(0); })
  .catch((e) => { console.error('✗', e); server.kill(); process.exit(1); });
