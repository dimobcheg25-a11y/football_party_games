// Перевірка інтерфейсу у справжньому Chrome (без вікна): проходить основні екрани ігор, ловить помилки JS
// і зберігає знімки в .shots/ (їх дивиться Claude перед пушем — лише нові/змінені екрани, щоб не витрачати токени).
// Запуск: npm run ui-check -- [hub|top|spy|guess|duel|allin|window|path|crossroads ...] [--mobile]   (без назв — усе)
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
    env: { ...process.env, PORT, GUESS_REVEAL_MS: '300000', FIXED_ORDER: '1', FOURS_TEST_ANSWER: '1', FOURS_REVEAL_MS: '300000', HANDSHAKE_TEST_ANSWER: '1', HANDSHAKE_REVEAL_MS: '300000', ALLIN_REVEAL_MS: '300000', WINDOW_SOLD_MS: '1200', WINDOW_AUTO_MS: '300' }, // FIXED_ORDER — у «Перехресті» першим ходить господар
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

// «Тактичний ескіз» на телефоні (--mobile): сенсорний екран проти ПК, одне коло — телефон і малює (справжні дотики), і вгадує.
async function sketchPhone(browser) {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const phone = await ctx.newPage();
  phone.on('pageerror', (e) => errors.push(`[sketch-phone] ${e.message}`));
  await phone.goto(`${URL}/sketch/`);
  await phone.fill('#name-input', 'Телефон');
  await phone.tap('[data-opt="laps"] [data-val="1"]');
  await phone.tap('#create-btn');
  await phone.waitForSelector('#lobby-code:not(:empty)');
  const code = await phone.textContent('#lobby-code');
  const pc = await person(browser, 'sketch-pc');
  await pc.goto(`${URL}/sketch/?room=${code}`);
  await pc.fill('#name-input', 'ПК');
  await pc.click('#join-btn');
  await phone.waitForSelector('#start-btn:not([disabled])');
  await phone.tap('#start-btn');
  const cdp = await ctx.newCDPSession(phone);
  const touch = async (points) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
    for (const p of points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  for (let turn = 0; turn < 2; turn++) {
    await phone.waitForSelector('.pick-card, #over .wait', { timeout: 15000 }).catch(async (e) => { await shot(phone, 'sketch-phone-fail', { full: true }); throw e; });
    const phoneDraws = !!(await phone.$('.pick-card'));
    const drawer = phoneDraws ? phone : pc;
    const guesser = phoneDraws ? pc : phone;
    if (phoneDraws) await shot(phone, 'sketch-phone-choose', { full: true });
    await (phoneDraws ? phone.tap('.pick-card') : pc.click('.pick-card'));
    await drawer.waitForSelector('#tools:not(.hidden)');
    if (phoneDraws) {
      // координати полотна — щоразу заново: після тапу по інструменту сторінка прокручується
      const at = async (list) => {
        await phone.locator('#canvas').scrollIntoViewIfNeeded();
        const b = await phone.locator('#canvas').boundingBox();
        return list.map(([fx, fy]) => ({ x: b.x + b.width * fx, y: b.y + b.height * fy }));
      };
      await touch(await at([[0.2, 0.3], [0.35, 0.5], [0.5, 0.3], [0.65, 0.5], [0.8, 0.3]]));
      const pick = async (sel, on) => { // тап поки сторінка прокручується може влучити поруч — перевіряємо, що вибрано
        for (let k = 0; k < 3 && !(await phone.$(on)); k++) { await phone.locator(sel).scrollIntoViewIfNeeded(); await phone.tap(sel); }
      };
      await pick('[data-tool="oval"]', '.tool.on[data-tool="oval"]');
      await touch(await at([[0.3, 0.45], [0.5, 0.7], [0.7, 0.95]]));
      await pick('.swatch[data-c="#1e8a3c"]', '.swatch.on[data-c="#1e8a3c"]');
      await pick('[data-tool="fill"]', '.tool.on[data-tool="fill"]');
      const [inside] = await at([[0.5, 0.7]]);
      await phone.touchscreen.tap(inside.x, inside.y);
      await shot(phone, 'sketch-phone-draw', { full: true });
    } else {
      const b = await pc.locator('#canvas').boundingBox();
      await pc.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.5);
      await pc.mouse.down();
      await pc.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.5, { steps: 6 });
      await pc.mouse.up();
    }
    const raw = (await drawer.textContent('#word-bar .word')).trim();
    const word = raw.replace(/\s+/g, '');
    if (!phoneDraws) {
      await phone.tap('#feed-input');
      await phone.fill('#feed-input', raw.slice(0, Math.max(3, raw.length - 3)));
      await phone.waitForSelector('#word-suggestions li');
      await shot(phone, 'sketch-phone-guess', { full: true });
      await phone.locator('#word-suggestions li[data-i]', { hasText: raw }).first().tap();
    } else {
      await guesser.fill('#feed-input', word);
      await guesser.press('#feed-input', 'Enter');
    }
    await phone.waitForSelector('.reveal-card', { timeout: 15000 }).catch(async (e) => { await shot(phone, 'sketch-phone-fail', { full: true }); throw new Error(`немає відповіді (хід ${turn}, телефон малює: ${phoneDraws}, слово ${word})`); });
    if (!phoneDraws) await shot(phone, 'sketch-phone-reveal', { full: true });
    await phone.waitForSelector('.reveal-card', { state: 'detached', timeout: 15000 }).catch(() => {});
  }
  await ctx.close();
  await pc.context().close();
}

const scenarios = {
  async hub(browser) {
    const p = await person(browser, 'hub');
    await p.goto(URL);
    await p.waitForSelector('#solo-games .game-card');
    await shot(p, 'hub', { full: true });
    await phoneShot(browser, 'hub', '/', (x) => x.waitForSelector('#solo-games .game-card'));
    // «Що нового»: закладка з крапкою → сторінка версій; після неї крапка гасне
    await p.click('#changes-tab');
    await p.waitForSelector('.change-sheet');
    await shot(p, 'changes', { full: true });
    await phoneShot(browser, 'changes', '/changes/', (x) => x.waitForSelector('.change-sheet'));
    await p.goto(URL);
    await p.waitForSelector('#changes-tab .tab-dot.hidden', { state: 'attached' });
    await p.context().close();
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
    await p.waitForSelector('.ask-sheet');
    await shot(p, 'top-ask'); // підтвердження — у вікні в стилі гри
    await p.click('.ask-sheet [data-ask="1"]');
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
    for (const [k, x] of voters.entries()) {
      await x.click('.vote-btn');
      await x.waitForSelector('.ask-sheet');
      if (!k) await shot(x, 'spy-ask');
      await x.click('.ask-sheet [data-ask="1"]');
    }
    await host.waitForSelector('#stage .verdict');
    await shot(host, 'spy-verdict', { full: true });
    for (const x of all) await x.context().close();
  },

  // Тактичний ескіз: художник обирає слово й малює мишею; гість пише хибну, потім правильну відповідь (слово — з екрана художника).
  async sketch(browser) {
    const { host, guests } = await room(browser, 'sketch', 3);
    await shot(host, 'sketch-lobby');
    await host.click('#start-btn');
    const all = [host, ...guests];
    for (const x of all) await x.waitForSelector('#over:not(.hidden)');
    const drawer = (await Promise.all(all.map(async (x) => ((await x.$('.pick-card')) ? x : null)))).find(Boolean);
    const guest = all.find((x) => x !== drawer);
    await shot(drawer, 'sketch-choose');
    await drawer.click('.pick-card');
    await drawer.waitForSelector('#tools:not(.hidden)');
    const box = await drawer.locator('#canvas').boundingBox();
    const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
    for (const path of [[[0.3, 0.5], [0.4, 0.3], [0.5, 0.5], [0.4, 0.7], [0.3, 0.5]], [[0.55, 0.5], [0.8, 0.5]], [[0.75, 0.42], [0.8, 0.5], [0.75, 0.58]]]) {
      await drawer.mouse.move(...at(...path[0]));
      await drawer.mouse.down();
      for (const p of path.slice(1)) await drawer.mouse.move(...at(...p), { steps: 6 });
      await drawer.mouse.up();
    }
    await drawer.click('.swatch[data-c="#d7262e"]');
    await drawer.mouse.move(...at(0.15, 0.2));
    await drawer.mouse.down();
    await drawer.mouse.move(...at(0.22, 0.28), { steps: 4 });
    await drawer.mouse.up();
    // прямокутник, заливка всередині, потім пензель — курсор-коло над серветкою
    await drawer.click('[data-tool="rect"]');
    await drawer.mouse.move(...at(0.6, 0.12));
    await drawer.mouse.down();
    await drawer.mouse.move(...at(0.9, 0.35), { steps: 5 });
    await drawer.mouse.up();
    await drawer.click('[data-tool="fill"]');
    await drawer.click('.swatch[data-c="#f7c531"]');
    await drawer.click('[data-tool="fill"]');
    await drawer.mouse.click(...at(0.75, 0.24));
    await drawer.click('[data-tool="pen"]');
    const slider = await drawer.locator('#size-range').boundingBox(); // товщина — тягнемо повзунок праворуч
    await drawer.mouse.move(slider.x + slider.width * 0.12, slider.y + slider.height / 2);
    await drawer.mouse.down();
    await drawer.mouse.move(slider.x + slider.width * 0.8, slider.y + slider.height / 2, { steps: 5 });
    await drawer.mouse.up();
    const box2 = await drawer.locator('#canvas').boundingBox(); // сторінка могла прокрутитись
    await drawer.mouse.move(box2.x + box2.width * 0.5, box2.y + box2.height * 0.6, { steps: 3 });
    const word = (await drawer.textContent('#word-bar .word')).replace(/\s+/g, '');
    await shot(drawer, 'sketch-drawer');
    await guest.fill('#feed-input', 'пенальті?');
    await guest.press('#feed-input', 'Enter');
    await guest.waitForTimeout(800);
    await guest.fill('#feed-input', word.slice(0, 3));
    await guest.waitForSelector('#word-suggestions li');
    await shot(guest, 'sketch-guess');
    await guest.fill('#feed-input', word);
    await guest.press('#feed-input', 'Enter');
    await guest.waitForSelector('.coaster');
    await shot(guest, 'sketch-coaster');
    await phoneShot(browser, 'sketch', '/sketch/');
    for (const x of all) await x.context().close();
    if (mobile) await sketchPhone(browser);
  },

  // Чотири четвірки: господар — у браузері, другий гравець — бот через сокет (від нього ж відповіді, щоб клікати правильні капсули).
  async fours(browser) {
    const { io } = require('socket.io-client');
    const p = await person(browser, 'fours');
    await p.goto(`${URL}/fours/`);
    await shot(p, 'fours-home', { full: true });
    await p.fill('#name-input', 'Хост');
    await p.click('#create-btn');
    await p.waitForSelector('#screen-lobby:not(.hidden) #lobby-code:not(:empty)');
    const code = await p.textContent('#lobby-code');
    const bot = io(`${URL}/fours`);
    await new Promise((res) => bot.emit('join', { code, name: 'Бот' }, res));
    const playing = new Promise((res) => bot.on('state', (s) => s.status === 'playing' && res(s)));
    await p.click('#start-btn');
    const st = await playing;
    await p.waitForSelector('#capsules .capsule');
    const pick = async (ids) => { for (const id of ids) await p.click(`.capsule[data-id="${id}"]`); await p.click('#check-btn'); };
    await pick(st.testAnswer[0]);
    await p.waitForSelector('.pot');
    await pick([...st.testAnswer[1].slice(0, 3), st.testAnswer[2][0]]); // «майже»
    await p.click('#hint-btn'); // підказки: пара A, потім пара B
    await p.waitForSelector('.cap-link');
    await p.click('#hint-btn');
    await p.waitForFunction(() => document.querySelectorAll('.cap-link').length >= 4);
    await shot(p, 'fours-play', { full: true });
    await new Promise((res) => bot.emit('check', { ids: st.testAnswer[3] }, res)); // бот знайшов групу — у таблиці кулька
    await p.click('#giveup-btn');
    await p.click('.ask-sheet [data-ask="1"]');
    await new Promise((res) => bot.emit('giveUp', null, res));
    await p.waitForSelector('#reveal:not(.hidden)');
    await shot(p, 'fours-reveal', { full: true });
    bot.close();
    await p.context().close();
    if (mobile) {
      const m = await person(browser, 'fours-phone', PHONE);
      await m.goto(`${URL}/fours/`);
      await shot(m, 'fours-phone', { full: true });
      await m.fill('#name-input', 'Тел');
      await m.click('#daily-btn');
      await m.waitForSelector('#capsules .capsule');
      for (let i = 1; i <= 3; i++) await m.click(`#capsules .capsule:nth-child(${i})`);
      await shot(m, 'fours-phone-game', { full: true });
      await m.context().close();
    }
  },

  // Правило рукостискань: господар — у браузері, другий гравець — бот (від нього найкоротший ланцюжок, щоб назвати правильних).
  async handshake(browser) {
    const { io } = require('socket.io-client');
    const { playerById } = require('../server/data');
    const p = await person(browser, 'handshake');
    await p.goto(`${URL}/handshake/`);
    await shot(p, 'handshake-home', { full: true });
    await p.fill('#name-input', 'Хост');
    await p.click('[data-opt="difficulty"] [data-val="normal"]');
    await p.click('#create-btn');
    await p.waitForSelector('#screen-lobby:not(.hidden) #lobby-code:not(:empty)');
    const code = await p.textContent('#lobby-code');
    const bot = io(`${URL}/handshake`);
    await new Promise((res) => bot.emit('join', { code, name: 'Бот' }, res));
    const playing = new Promise((res) => bot.on('state', (s) => s.status === 'playing' && res(s)));
    await p.click('#start-btn');
    const st = await playing;
    await p.waitForSelector('#chain .jack');
    await choosePlayer(p, '#link-input', playerById.get(st.testAnswer[1]).uk);
    await p.waitForSelector('#chain .jack:nth-child(2)');
    await p.click('#hint-btn');
    await p.waitForSelector('#hint-list li');
    await shot(p, 'handshake-play', { full: true });
    await choosePlayer(p, '#link-input', playerById.get(st.testAnswer[2]).uk);
    await p.waitForSelector('.jack.finish.on');
    await new Promise((res) => bot.emit('giveUp', null, res));
    await p.waitForSelector('#reveal:not(.hidden) .best');
    await shot(p, 'handshake-reveal', { full: true });
    bot.close();
    await p.context().close();
    if (mobile) {
      const m = await person(browser, 'handshake-phone', PHONE);
      await m.goto(`${URL}/handshake/`);
      await shot(m, 'handshake-phone', { full: true });
      await m.fill('#name-input', 'Тел');
      await m.click('#solo-btn');
      await m.waitForSelector('#chain .jack');
      await m.fill('#link-input', 'шевч');
      await m.waitForSelector('#suggestions li[data-i="0"]');
      await shot(m, 'handshake-phone-game', { full: true });
      await m.context().close();
    }
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
    await p.fill('#guess-input', 'аршав'); // росіянин — сірий рядок з приміткою, вибрати не можна
    await p.waitForSelector('#suggestions li.shamed');
    await shot(p, 'guess-shame');
    await p.fill('#guess-input', '');
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

  // All in: соло (оцінка, вилка, ставка → відповідь), кімната на трьох (сукно з оцінками, ставки наживо, ALL IN, відповідь), телефон.
  // Трансферне вікно: головна, лобі зі схемою, лот зі ставкою, продаж, кінець вікна (склади й сила, матчі й таблиця), телефон
  async window(browser) {
    const p = await person(browser, 'window');
    await p.goto(`${URL}/window/`);
    await p.waitForSelector('[data-opt="basis"] .chip.active');
    await shot(p, 'window-home', { full: true });
    await p.context().close();

    const { host, guests } = await room(browser, 'window', 2);
    await host.click('#lobby-formation [data-f="mini"]');
    await host.waitForSelector('#lobby-formation [data-f="mini"].active');
    await shot(host, 'window-lobby');
    await host.click('#start-btn');
    const people = [host, ...guests];
    let shotBid = false, shotSold = false;
    // кожен ставить на кожен лот, поки вікно не закриється
    await host.waitForSelector('#bid-input');
    await shot(host, 'window-bid', { full: true });
    shotBid = true;
    for (let guard = 0; guard < 80; guard++) {
      if (await host.isVisible('#screen-final')) break;
      for (const [k, x] of people.entries()) {
        if (await x.isVisible('#bid-input') && !(await x.textContent('#bid-status')).match(/млн|пасуєш/)) {
          await x.fill('#bid-input', String(2 + k * 3 + (guard % 4)));
          await x.click('#bid-btn');
        }
      }
      if (!shotBid && await host.isVisible('#bid-input')) { await shot(host, 'window-bid', { full: true }); shotBid = true; }
      if (!shotSold && await host.isVisible('.stamp-sold')) { await shot(host, 'window-sold', { full: true }); shotSold = true; }
      await host.waitForTimeout(400);
    }
    await host.waitForSelector('#screen-final:not(.hidden)');
    await shot(host, 'window-final-squads', { full: true });
    await host.click('[data-tab="matches"]');
    await shot(host, 'window-final-matches', { full: true });
    for (const x of people) await x.context().close();

    await phoneShot(browser, 'window', '/window/', async () => {});
  },

  async allin(browser) {
    const p = await person(browser, 'allin');
    await p.goto(`${URL}/allin/`);
    await p.waitForSelector('[data-multi="groups"] .chip.active');
    await shot(p, 'allin-home', { full: true });
    await p.fill('#name-input', 'Тест');
    await p.click('#solo-btn');
    await p.waitForSelector('#guess-input');
    await p.fill('#guess-input', '30');
    await p.click('#levels [data-level="0"]');
    await p.click('#stake [data-d="50"]');
    await shot(p, 'allin-solo-guess');
    await p.click('#guess-btn');
    await p.waitForSelector('.reveal-box .ans-num');
    await shot(p, 'allin-solo-reveal');
    // до кінця й «Ще одна гра»: нова гра знову з роздачі 1 — питання й форма мають бути нові (інакше сервер не прийме оцінку)
    const guessAny = async () => {
      await p.waitForSelector('#guess-input');
      await p.fill('#guess-input', (await p.getAttribute('#guess-input', 'placeholder')) === '2005' ? '2000' : '1');
      await p.click('#guess-btn');
      await p.waitForSelector('.reveal-box .ans-num');
    };
    for (let r = 2; r <= 7; r++) {
      await p.click('#next-btn');
      await guessAny();
    }
    await p.click('#next-btn');
    await p.waitForSelector('#screen-final:not(.hidden)');
    await shot(p, 'allin-final');
    await p.click('#again-btn');
    await guessAny();
    await p.context().close();

    const { host, guests } = await room(browser, 'allin', 3);
    await host.click('#start-btn');
    const people = [host, ...guests];
    for (const [k, x] of people.entries()) {
      await x.waitForSelector('#guess-input');
      await x.fill('#guess-input', String(20 + k * 15));
      await x.click('#guess-btn');
    }
    for (const x of people) await x.waitForSelector('#felt .slot');
    await host.click('#felt .slot[data-slot="2"]');
    await host.click('#bet-stake [data-all]');
    await guests[0].click('#felt .slot[data-slot="1"]');
    await guests[0].click('#felt .slot[data-slot="0"]');
    await guests[1].click('#felt .slot[data-slot="2"]');
    await host.waitForSelector('#felt .slot[data-slot="2"] .token.mine');
    // чужих фішок до відповіді не видно (блеф): у гостя на сукні — лише свої
    await guests[1].waitForSelector('#felt .slot[data-slot="2"] .token.mine');
    if (await guests[1].locator('#felt .token:not(.mine)').count()) throw new Error('allin: до відповіді видно чужі фішки');
    await shot(host, 'allin-room-bet', { full: true });
    for (const x of people) await x.click('#done-btn');
    await host.waitForSelector('#felt.revealed');
    await shot(host, 'allin-room-reveal', { full: true });
    for (const x of people) await x.context().close();

    await phoneShot(browser, 'allin', '/allin/', async (x) => {
      await x.fill('#name-input', 'Тест');
      await x.click('#solo-btn');
      await x.waitForSelector('#guess-input');
    });
    if (mobile) {
      // телефон у кімнаті: сукно зі ставками
      const ph = await person(browser, 'allin-phone-room', PHONE);
      await ph.goto(`${URL}/allin/`);
      await ph.fill('#name-input', 'Телефон');
      await ph.click('#create-btn');
      await ph.waitForSelector('#lobby-code:not(:empty)');
      const code = await ph.textContent('#lobby-code');
      const pc = await person(browser, 'allin-pc');
      await pc.goto(`${URL}/allin/?room=${code}`);
      await pc.fill('#name-input', 'ПК');
      await pc.click('#join-btn');
      await ph.waitForSelector('#start-btn:not(.hidden)');
      await ph.click('#start-btn');
      for (const [k, x] of [ph, pc].entries()) {
        await x.waitForSelector('#guess-input');
        await x.fill('#guess-input', String(10 + k * 25));
        await x.click('#guess-btn');
      }
      await ph.waitForSelector('#felt .slot');
      await ph.click('#felt .slot[data-slot="1"]');
      await ph.click('#bet-stake [data-d="50"]');
      await pc.click('#felt .slot[data-slot="2"]');
      await ph.waitForSelector('#felt .slot[data-slot="2"] .token');
      await shot(ph, 'allin-bet-phone', { full: true });
      await ph.context().close();
      await pc.context().close();
    }
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

  // «Склад матчу»: соло, лише Металіст (тренер завжди Маркевич) — тренер, підказка на футболку, «Досить» і відкритий матч
  async lineup(browser) {
    const p = await person(browser, 'lineup');
    await p.goto(`${URL}/lineup/`);
    await shot(p, 'lineup-home', { full: true });
    await p.fill('#name-input', 'Тест');
    for (const c of ['wc', 'euro', 'copa', 'ucl', 'uel', 'legend', 'ua']) await p.click(`[data-multi="categories"] [data-val="${c}"]`);
    await p.click('#solo-btn');
    await p.waitForSelector('#teams .shirt');
    await choosePlayer(p, '#guess-input', 'Маркевич');
    await p.waitForSelector('.coach-row .shirt.open');
    await p.click('#teams .pitch .shirt:not(.open):not(.missing)');
    await p.click('#hint-bar [data-hint="first"]');
    await p.waitForSelector('#hint-bar .hb-got');
    await shot(p, 'lineup-round', { full: true });
    await p.click('#finish-btn');
    await p.click('.ask-sheet [data-ask="1"]');
    await p.waitForSelector('#reveal-bar:not(.hidden)');
    await shot(p, 'lineup-reveal', { full: true });
    await phoneShot(browser, 'lineup', '/lineup/', async (x) => {
      await x.fill('#name-input', 'Тест');
      await x.click('#solo-btn');
      await x.waitForSelector('#teams .shirt');
    });
    await p.context().close();
  },

  async archive(browser) {
    const p = await person(browser, 'archive');
    await p.goto(`${URL}/archive/`);
    await p.waitForSelector('.beta-sheet');
    await shot(p, 'archive-beta');
    await p.click('[data-beta-ok]');
    await p.click('.fb-fab');
    await p.click('.fb-sheet [data-kind="bug"]');
    await p.fill('#fb-text', 'Тестовий відгук');
    await shot(p, 'feedback');
    await p.click('#fb-send');
    await p.waitForSelector('.fb-thanks');
    await p.click('.fb-sheet [data-fb-close]');
    await shot(p, 'archive-home', { full: true });
    await p.fill('#name-input', 'Тест');
    await p.click('#solo-btn');
    await p.waitForSelector('#tiles .tile');
    await p.waitForFunction(() => document.querySelector('#shot-img').complete);
    for (const t of [6, 7, 12, 17]) await p.click(`#tiles [data-tile="${t}"]`);
    await choosePlayer(p, '#guess-input', 'Блохін');
    await p.waitForSelector('#misses .miss');
    await shot(p, 'archive-round', { full: true });
    await p.click('#finish-btn');
    await p.click('.ask-sheet [data-ask="1"]');
    await p.waitForSelector('#reveal-bar:not(.hidden)');
    await p.click('#rp-missing');
    await shot(p, 'archive-reveal', { full: true });
    await phoneShot(browser, 'archive', '/archive/', async (x) => {
      await x.click('[data-beta-ok]');
      await x.fill('#name-input', 'Тест');
      await x.click('#solo-btn');
      await x.waitForSelector('#tiles .tile');
      await x.click('#tiles [data-tile="12"]');
    });
    await p.context().close();
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
