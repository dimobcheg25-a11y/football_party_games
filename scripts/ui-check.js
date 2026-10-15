// Перевірка інтерфейсу у справжньому Chrome (без вікна): проходить основні екрани ігор, ловить помилки JS
// і зберігає знімки в .shots/ (їх дивиться Claude перед пушем — лише нові/змінені екрани, щоб не витрачати токени).
// Запуск: npm run ui-check -- [hub|top|spy|guess|duel|path|crossroads ...] [--mobile]   (без назв — усе)
// Chrome: встановлений у системі (або шлях у змінній CHROME). Браузер не завантажується — лише playwright-core.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, '.shots');
const PORT = 6100 + Math.floor(Math.random() * 500);
const URL = `http://localhost:${PORT}`;
const args = process.argv.slice(2);
const mobile = args.includes('--mobile');
const only = args.filter((a) => !a.startsWith('--'));

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p));

const errors = [];
const shots = [];
const DESKTOP = { width: 1100, height: 760 };
const PHONE = { width: 390, height: 780 };

async function startServer() {
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT, GUESS_REVEAL_MS: '300000', FIXED_ORDER: '1' }, // FIXED_ORDER — у «Перехресті» першим ходить господар
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((res) => server.stdout.on('data', (d) => d.toString().includes('запущено') && res()));
  return server;
}

// Нова «людина» — окремий контекст (своє localStorage), сторінка з перехопленням помилок.
async function person(browser, label, viewport = DESKTOP) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(`[${label}] console: ${m.text()}`));
  page.on('dialog', (d) => d.accept());
  return page;
}

async function shot(page, name, opts = {}) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.waitForTimeout(900); // анімації появи (перекидання табло ~0.7 с)
  await page.screenshot({ path: file, fullPage: !!opts.full });
  shots.push(path.relative(ROOT, file));
}

async function phoneShot(browser, name, url, prepare) {
  if (!mobile) return;
  const p = await person(browser, `${name}-phone`, PHONE);
  await p.goto(URL + url);
  if (prepare) await prepare(p);
  await shot(p, `${name}-phone`, { full: true });
  await p.context().close();
}

// Кімната: хост створює, друзі заходять за посиланням, хост починає.
async function room(browser, game, count, setup = async () => {}) {
  const host = await person(browser, `${game}-host`);
  await host.goto(`${URL}/${game}/`);
  await host.fill('#name-input', 'Хост');
  await setup(host);
  await host.click('#create-btn');
  await host.waitForSelector('#screen-lobby:not(.hidden) #lobby-code:not(:empty)');
  const code = await host.textContent('#lobby-code');
  const guests = [];
  for (let i = 1; i < count; i++) {
    const g = await person(browser, `${game}-guest${i}`);
    await g.goto(`${URL}/${game}/?room=${code}`);
    await g.fill('#name-input', `Друг${i}`);
    await g.click('#join-btn');
    await g.waitForSelector('#screen-lobby:not(.hidden)');
    guests.push(g);
  }
  return { host, guests, code };
}

async function choosePlayer(page, input, query) {
  await page.fill(input, query);
  await page.click(`${input} ~ .suggestions li[data-i="0"], .suggestions li[data-i="0"]`);
}

const scenarios = {
  async hub(browser) {
    const p = await person(browser, 'hub');
    await p.goto(URL);
    await p.waitForSelector('#solo-games .game-card');
    await shot(p, 'hub', { full: true });
    await phoneShot(browser, 'hub', '/', (x) => x.waitForSelector('#solo-games .game-card'));
  },

  async top(browser) {
    const p = await person(browser, 'top-solo');
    await p.goto(`${URL}/top/`);
    await shot(p, 'top-home', { full: true });
    await p.fill('#name-input', 'Тест');
    await p.click('[data-opt="pick"] [data-val="host"]');
    await p.click('#solo-btn');
    await p.waitForSelector('#topic-list [data-id]');
    await p.click('#topic-filters [data-f="kind"][data-v="club"]');
    await p.click('#topic-filters [data-f="country"][data-v="Україна"]');
    await shot(p, 'top-picker');
    await p.click('#topic-list [data-id^="buys:"]');
    await p.waitForSelector('#round-box:not(.hidden) #board li');
    await shot(p, 'top-round');
    await p.click('#giveup-btn');
    await p.waitForSelector('#reveal-bar:not(.hidden)');
    await shot(p, 'top-reveal', { full: true });
    // наступна тема: рекорди сезону у фільтрах і топ із гравцем, якого немає в базі (відкритий одразу)
    await p.click('#next-btn');
    await p.waitForSelector('#topic-list [data-id]');
    await p.click('#topic-filters [data-f="kind"][data-v="all"]');
    await p.click('#topic-filters [data-f="country"][data-v="all"]');
    await p.click('#topic-filters [data-f="kind"][data-v="season"]');
    await shot(p, 'top-picker-season');
    await p.fill('#topic-filter', 'Ліги Європи'); // фільтр «рекорди сезону» сам скинеться — таких тем у пошуку немає
    await p.click('#topic-list [data-id="tournament:uel"]');
    await p.waitForSelector('#board li.missing');
    await shot(p, 'top-missing');
    await phoneShot(browser, 'top', '/top/');
    await p.context().close();
  },

  async spy(browser) {
    const { host, guests } = await room(browser, 'spy', 3);
    await shot(host, 'spy-lobby');
    await host.click('#start-btn');
    const all = [host, ...guests];
    for (const x of all) await x.waitForSelector('#role-card');
    await host.click('#role-card');
    await shot(host, 'spy-clues');
    const voters = [];
    for (let k = 0; k < 6; k++) {
      // хто має форму підказки — той ходить; підказки текстом
      const active = (await Promise.all(all.map(async (x) => ((await x.$('#clue-form')) ? x : null)))).find(Boolean);
      if (!active) break;
      await active.fill('#clue-input', 'грав у Лізі чемпіонів');
      await active.click('#clue-form button');
      await active.waitForTimeout(150);
    }
    for (const x of all) if (await x.$('.vote-btn:not([disabled])')) voters.push(x);
    for (const x of voters) await x.click('.vote-btn');
    await host.waitForSelector('#stage .verdict');
    await shot(host, 'spy-verdict', { full: true });
    for (const x of all) await x.context().close();
  },

  async guess(browser) {
    const p = await person(browser, 'guess');
    await p.goto(`${URL}/guess/`);
    await p.fill('#name-input', 'Тест');
    await p.click('#solo-btn');
    await p.waitForSelector('#answer-box:not(.hidden)');
    await choosePlayer(p, '#guess-input', 'мессі');
    await p.waitForSelector('#board .g-row:not(.g-head)');
    await shot(p, 'guess-round');
    await phoneShot(browser, 'guess', '/guess/');
    await p.context().close();
  },

  // Перехрестя: господар — у браузері, суперник — бот через сокет (від нього ж стан поля, щоб знайти правильну відповідь).
  async crossroads(browser) {
    const { io } = require('socket.io-client');
    const { players, matches } = require('../server/data');
    const viewport = mobile ? PHONE : DESKTOP;
    const sfx = mobile ? '-phone' : '';
    const p = await person(browser, 'crossroads', viewport);
    await p.goto(`${URL}/crossroads/`);
    await shot(p, `crossroads-home${sfx}`, { full: true });
    await p.fill('#name-input', 'Хост');
    await p.click('#create-btn');
    await p.waitForSelector('#screen-lobby:not(.hidden)');
    await p.waitForFunction(() => new URLSearchParams(location.search).get('room'));
    const code = await p.evaluate(() => new URLSearchParams(location.search).get('room'));
    const bot = io(`${URL}/crossroads`);
    const st = await new Promise((res) => {
      bot.on('state', (s) => s.status === 'playing' && res(s));
      bot.emit('join', { code, name: 'Бот' }, () => {});
    });
    await p.waitForSelector('#board .cell.playable');
    const answer = (cell) => {
      const n = st.grid.size;
      const r = st.grid.rows[Math.floor(cell / n)].id, c = st.grid.cols[cell % n].id;
      return players.find((x) => matches(x, r) && matches(x, c) && x.photo);
    };
    const a = answer(0);
    await p.click('#board [data-cell="0"]');
    await p.waitForSelector('#picker:not(.hidden)');
    await p.fill('#picker-input', a.uk);
    await p.waitForSelector('#suggestions li[data-idx="0"]');
    await shot(p, `crossroads-picker${sfx}`);
    await p.click('#suggestions li[data-idx="0"]');
    await p.waitForSelector('#board .cell.filled');
    await shot(p, `crossroads-game${sfx}`, { full: true });
    bot.close();
    await p.context().close();
  },

  // Один на один: соло-серія (пара → відповідь → числа), кімната з другом (хто кого обрав), телефон — ринг без прокрутки.
  async duel(browser) {
    const p = await person(browser, 'duel');
    await p.goto(`${URL}/duel/`);
    await p.waitForSelector('[data-multi="groups"] .chip.active');
    await shot(p, 'duel-home', { full: true });
    await p.fill('#name-input', 'Тест');
    await p.click('[data-opt="mode"] [data-val="streak"]');
    await p.click('#solo-btn');
    await p.waitForSelector('#corner-0 .c-name');
    await shot(p, 'duel-pair');
    await p.click('#corner-0');
    await p.waitForSelector('#ring.settled');
    await shot(p, 'duel-reveal');
    await p.context().close();

    const { host, guests } = await room(browser, 'duel', 2);
    await host.click('#start-btn');
    for (const x of [host, ...guests]) await x.waitForSelector('#corner-0 .c-name');
    await host.click('#corner-1');
    await guests[0].click('#corner-0');
    await host.waitForSelector('#ring.settled');
    await shot(host, 'duel-room-reveal', { full: true });
    for (const x of [host, ...guests]) await x.context().close();

    await phoneShot(browser, 'duel', '/duel/', async (x) => {
      await x.fill('#name-input', 'Тест');
      await x.click('#solo-btn');
      await x.waitForSelector('#corner-1 .c-name');
    });
    if (mobile) {
      // телефон: ринг цілком на екрані (без прокрутки) і відповідь
      const x = await person(browser, 'duel-phone2', PHONE);
      await x.goto(`${URL}/duel/`);
      await x.fill('#name-input', 'Тест');
      await x.click('#solo-btn');
      await x.waitForSelector('#corner-1 .c-name');
      const bottom = await x.evaluate(() => document.querySelector('#corner-1').getBoundingClientRect().bottom);
      if (bottom > PHONE.height) errors.push(`[duel-phone] ринг не вміщається: низ синього кута ${Math.round(bottom)} > ${PHONE.height}`);
      await x.click('#corner-1');
      await x.waitForSelector('#ring.settled');
      await shot(x, 'duel-reveal-phone');
      await x.context().close();
    }
  },

  async path(browser) {
    const p = await person(browser, 'path');
    await p.goto(`${URL}/path/`);
    await p.fill('#name-input', 'Тест');
    await p.click('#solo-btn');
    await p.waitForSelector('#path .stage');
    await shot(p, 'path-round');
    await phoneShot(browser, 'path', '/path/');
    await p.context().close();
  },
};

(async () => {
  if (!CHROME) {
    console.error('Не знайдено Chrome — вкажи шлях у змінній CHROME');
    process.exit(1);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  let failed = false;
  for (const [name, run] of Object.entries(scenarios)) {
    if (only.length && !only.includes(name)) continue;
    try {
      await run(browser);
      console.log(`✓ ${name}`);
    } catch (e) {
      failed = true;
      console.error(`✗ ${name}: ${e.message.split('\n')[0]}`);
    }
  }
  await browser.close();
  server.kill();
  if (errors.length) console.error(`Помилки JS:\n  ${errors.join('\n  ')}`);
  console.log(`Знімки (${shots.length}):\n  ${shots.join('\n  ')}`);
  process.exit(failed || errors.length ? 1 : 0);
})();
