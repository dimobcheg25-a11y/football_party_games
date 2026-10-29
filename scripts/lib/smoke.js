// Спільне для автотестів scripts/smoke-<гра>.js: справжній сервер на випадковому порту й боти socket.io.
//   const { GAME, URL, ready, emit, nextState, bot, act, run } = smoke('top', { TOP_TEST_ANSWER: '1' });
//   run(async () => { await ready; const a = bot(); … console.log('УСІ ПЕРЕВІРКИ … ПРОЙШЛИ'); });
// nextState(s, pred) — для сокета з bot() спершу перевіряє вже отриманий стан (без гонок), для io(GAME) — чекає наступного.
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

function smoke(game, env = {}, { port = 4000 } = {}) {
  const PORT = port + Math.floor(Math.random() * 1000);
  const URL = `http://localhost:${PORT}`;
  const GAME = `${URL}/${game}`; // простір імен socket.io гри
  const server = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server', 'index.js')], {
    env: { ...process.env, PORT, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const ready = new Promise((res) => server.stdout.on('data', (d) => d.toString().includes('запущено') && res()));

  const emit = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
  const last = new Map(); // сокет бота → останній стан
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
  // дія + стан, що прийшов після неї
  async function act(s, ev, data, pred) {
    const st = nextState(s, pred);
    const res = await emit(s, ev, data);
    return { res, st: await st };
  }
  // запуск тесту: успіх — код 0, помилка (або не вклався в timeout мс) — код 1; сервер зупиняється в будь-якому разі
  function run(main, timeout = 0) {
    const fail = (e) => { console.error('✗', e); server.kill(); process.exit(1); };
    if (timeout) setTimeout(() => fail('таймаут'), timeout).unref();
    return main().then(() => { server.kill(); process.exit(0); }, fail);
  }

  return { PORT, URL, GAME, server, ready, emit, last, nextState, bot, act, run };
}

module.exports = { smoke };
