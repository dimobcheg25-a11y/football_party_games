# Футбольні ігри — сайт з кількома іграми

Node 18+, Express + Socket.IO, клієнт — чистий HTML/CSS/JS без збірки. Інтерфейс і коментарі в коді — українською.
Відповідати користувачу українською.

## Карта
- `server/index.js` — ядро: статика, `/api/players` (спільна база), `/api/games` (каталог), редірект старих `/?room=` → `/crossroads/`.
- `server/games/index.js` — список ігор. Кожна гра: `server/games/<id>/index.js` експортує `{ meta, register({ app, io }) }`.
- `server/core/` — спільне для кімнат: `room-server.js` (`createRoomServer`: код кімнати, вхід за токеном, дії, чат, реакції,
  прибирання; простір імен `/<id>`, `/api/<id>/room/:code`; `room.privateState(seat)` — особисте для гравця) і `base-room.js` (`BaseRoom`: місця, онлайн, чат). Кімната гри наслідує BaseRoom.
- `server/games/crossroads/` — «Футбольне перехрестя»: `room.js` (партія), `grid.js` (генерація сітки), `boards.js` (поля).
  Сокети — простір імен `/crossroads`, API — `/api/crossroads/...`.
- `server/games/path/` — «Шлях футболіста»: `careers.js` (рейтинг упізнаваності `recognition`: fame + вартість + трофеї + збірна/великі клуби − давно завершив, +українцям;
  рівні = топ-400/800/1300/1900/усі, `poolFor(era, difficulty)` — спільний для «Шляху» і «Вгадай гравця»; етапи-клуби (сума переходу з
  transfers.json, асисти в чемпіонаті з stats.json — лише для періодів з 2012), підказки з ціною),
  `room.js` (серія раундів, очки 100→10 рівномірно за довжиною кар'єри мінус підказки, ціна підказки — частка кроку; соло = кімната на одного; `privateState` — свої підказки й
  відповіді лише гравцю). Дані — `server/data/careers.json` (кар'єри, герби/прапори посиланнями на Wikimedia).
- `server/games/guess/` — «Вгадай гравця» (як Wordle): `compare.js` (профіль гравця й 11 клітинок порівняння: збірна/континент, позиція (Transfermarkt; «близько» = та сама лінія),
  рік (старший/молодший словами), останній клуб, чемпіонат, голи, матчі й голи за збірну, асисти (лише якщо загаданий почав з 2012 — `columnsFor`;
  хто почав раніше — «—»), макс. вартість, трофеї текстом, спільні клуби з 🤝
  «грали разом» за роками; кожна клітинка має `note` — пояснення словами), `room.js` (серія раундів, кожен
  вгадує у своєму темпі, очки 100→10 за номером спроби, чужі спроби — лише кольори). Пул загаданих — `poolFor` зі «Шляху» + є збірна.
- `server/games/spy/` — «Футбольний шпигун» (3–10 гравців): `room.js` — турнір із матчів до 7/11/15 балів; у матчі шпигун (не двічі поспіль)
  і футболіст з `poolFor`; фази `clues` (черга підказок, N кіл; текстом або «сказав голосом»; ім'я футболіста в підказці заборонене;
  заміна футболіста голосуванням більшості) → `vote` → `spyGuess` (шпигун має одну спробу, +2) → `reveal`. Бали: агент +1 за голос проти шпигуна; шпигун 0/2/3.
  Футболіст і роль — лише в `privateState`; хто зайшов посеред матчу — грає з наступного; вихід шпигуна до підрахунку — матч скасовано.
- `server/games/top/` — «Топ-10»: `tops.js` (усі теми-топи будуються з бази при старті: трансфери — найдорожчі, українців, покупки/продажі
  клубу, покупки клубів ліги, сума за кар'єру, макс. вартість; голи й матчі за клуб, голи за клуби країни, бомбардири й матчі за збірну,
  бомбардири ЧС/Євро/Копа/ЛЧ/ЛЄ з `tournaments.json`; асисти, гол+пас, рекорди сезону, картки — `stats.json` (з 2012/13);
  трансфери за віком/позицією/збірною/десятиліттям/між лігами; «мандрівники». Категорії: transfers, goals, assists, apps, cards.
  Рядок топу з `p: null` (гравця немає в базі) — відкритий одразу з `name`, без очок; тема годиться для розміру, якщо таких ≤25% (`fitsSize`);
  до 20 рядків; росію/білорусь не загадуємо; однакові назви клубів — з містом (`CITY`) або країною), `room.js` (серія раундів, топ 5/10/20,
  очки за місце 1→10 (нижчі — більше); режими `own` — кожен свій топ, `turns` — спільний по черзі з життями; життя й таймер (раунду/ходу)
  налаштовуються; тема випадкова або `pick` — обирає господар через `/api/top/topics`).
- `server/data/` — спільна база футболістів і категорій для всіх ігор (`index.js` — завантаження, `categories.js`, ручні правки в `manual-tags.js`;
  `derived-tags.js` — категорії з зібраних даних при завантаженні: A100 (+ асисти TM), UCL30, T80, JOURNEY (10+ різних клубів), і
  `cleanCareers` — прибирає з кар'єр клуби з 0 матчів, крім поточного; той самий об'єкт careers.json бачать усі ігри).
  Тег `UPL0014` — грав у чемпіонаті України 2000–2014 (у «Шляху» дає український бонус до відомості).
- `public/index.html` + `hub.css` + `hub.js` — головна: картки з `/api/games` у двох групах — «можна самому» (`meta.solo`) і «тільки з друзями»;
  на картці значки «🎮 Соло» і «👥 З друзями · `meta.friends`».
- `public/shared/` — спільне для сторінок ігор: `theme.css` (токени, фон, `.back-link`), `ui.css` (кнопки, поля, чипи, вікна,
  підказки пошуку, тост, звук, чат), `players.js` (`window.Players.search` — автодоповнення імен), `sounds.js` (`window.Sound`),
  `room-client.js` (`RoomClient.create` — уся спільна логіка клієнта кімнатних ігор).
- `public/<id>/` — сторінка гри (`crossroads/app.js` — ~1100 рядків, читати частинами через Grep).
- `scripts/smoke-test.js` (Перехрестя), `scripts/smoke-path.js` (Шлях), `scripts/smoke-guess.js` (Вгадай гравця), `scripts/smoke-spy.js` (Шпигун), `scripts/smoke-top.js` (Топ-10) — автотести ботами через справжній сервер.
- `scripts/build-players.js` → `players.json`; `scripts/build-careers.js` → `careers.json` (запускати після build-players);
  `scripts/build-transfers.js` → `transfers.json` (за id гравця: `maxValue` — макс. ринкова вартість, `value` — поточна (лише активні),
  `topFee/topFrom/topTo/topSeason` — найдорожчий трансфер, `totalFees` — сума всіх трансферів, `paid` — їх кількість,
  `fees` — усі платні трансфери [сума, клуб TM звідки, куди, сезон]; євро; з відкритого transfermarkt-datasets, CC0; покриття — гравці
  приблизно з 2012 р., легенди здебільшого без даних — відомі пропуски дописуються в `server/data/manual-transfers.js`)
  і `transfer-clubs.json` (клуб TM → назва, ліга, наш qid — зіставлено за кар'єрами гравців);
  `scripts/build-tournaments.js` → `tournaments.json` (бомбардири ЧС, Євро, Копа, ЛЧ, ЛЄ з таблиць en.wikipedia; кого немає в базі — `null` + ім'я);
  `scripts/build-stats.js` → `stats.json` (з таблиці виходів transfermarkt-datasets, кожен матч з 2012/13: готові топи асистів, гол+пас,
  голів/асистів за сезон, карток — по лігах, ЛЧ/ЛЄ і клубах; `players[tm]` — підсумки гравців бази: `t` усі змагання, `c[клуб]` лише чемпіонат);
  `scripts/lib/wikidata.js` — запити до Wikidata з повторами.

## Складність — єдиний рейтинг відомості
`recognition(p)` у `server/games/path/careers.js` — для ВСІХ ігор: fame (кількість мовних статей Вікіпедії; тренерам ×0,6 —
`coaches.json`, знижка вже в `p.fame`, сирий — `p.rawFame`) + ринкова вартість + матчі за збірну й великі клуби + великі трофеї;
українцям +25, давно завершеним — штраф. «Шлях», «Вгадай гравця», «Шпигун» — `poolFor` (верхівка рейтингу); «Перехрестя» — пули
`EASY_POOL/FAMOUS/FAN_POOL` (верхні 540/760/1500); «Топ-10» — популярність теми = середній рейтинг гравців її топ-10, рівні тем
easy/normal/hard = верхні 30% / наступні 40% / решта. Нова гра бере складність звідси ж, своїх порогів на fame не вигадувати.

## Не читати цілком
`server/data/players.json`, `careers.json`, `photos.json`, `transfers.json`, `transfer-clubs.json`, `tournaments.json`, `stats.json` (десятки–сотні КБ), `package-lock.json` —
лише Grep або `node -e` по конкретному імені/ключу. Клієнти ігор (`public/<id>/app.js`, 240–320 рядків; crossroads — 1100) читати частинами: потрібне місце шукати Grep за назвою функції
(`renderGame`, `renderFinal`, `renderScoreboard`…).

## Нова гра
1. `server/games/<id>/index.js` з `meta` (`id, title, description, solo, friends, emoji`) і `register` (свій простір імен `io.of('/<id>')`, свої `/api/<id>/...`).
   `solo: true` — гра є в групі «Можна грати самому» на головній; `friends` — скільки гравців у кімнаті ('2–8').
2. Додати в `server/games/index.js`.
3. `public/<id>/` — `index.html`, `app.js` на `RoomClient` (див. «Клієнт нової гри»), `style.css`.
4. `scripts/smoke-<id>.js` — скопіювати `smoke-top.js` або `smoke-spy.js`, додати в `npm test` (package.json).
5. Коротко описати гру в «Карті» вище (1–4 рядки: файли, фази, бали, що приватне).

### Клієнт нової гри
Усе спільне — `public/shared/room-client.js` (`RoomClient.create(cfg)`; опис `cfg` і того, що повертає, — у коментарі на початку файлу):
налаштування-чипи (`[data-opt]` один варіант, `[data-multi]` кілька, `[data-toggle]` вмикач; підказка `#difficulty-hint` — сама), вхід/перепідключення,
запрошення `?room=`, лобі (`state.minPlayers`, `state.notice` — якщо є), вихід, чат, реакції, звук, кнопки `#start-btn`/`#again-btn`.
Гра пише лише своє: `defaults`, `createOptions`, `optionList`, `onState` (свої змінні + звуки), `renderGame`, `renderFinal`.
- `index.html` — скопіювати `public/top/index.html` (або `guess`) і замінити налаштування й `#screen-game`; скрипти: socket.io, `/shared/players.js`,
  `/shared/sounds.js`, `/shared/room-client.js`, `/<id>/app.js`. Без `#solo-btn` — гра лише для кімнати (як `spy`).
- `app.js` — за зразком `public/guess/app.js` (~240 рядків, найкоротший) або `public/spy/app.js` (кімната з ролями/чергою/голосуванням;
  `#stage` перемальовується лише коли змінився ключ етапу — щоб не збивати введення). Автодоповнення гравця — функції `renderSuggestions/choose` з guess/top.
- Стилі: `/shared/theme.css`, `/shared/ui.css`, `/path/style.css` (лобі, таблиця, поле відповіді, `.answer-card`, підсумок) + свій `/<id>/style.css`.
  Готові класи в `spy/style.css` (`.stage-box`, `.vote-grid`, `.vote-results`, `.turn-order`) і `top/style.css` (`.slot`, `.topic-list`, `.misses`).
- «Перехрестя» (`public/crossroads/app.js`) — старий окремий клієнт без room-client, не брати за зразок.

### Шаблон гри (щоб не перечитувати інші ігри)
**Сервер, `index.js`:** `createRoomServer({ app, io, id, createRoom: (code, options, broadcast) => new XRoom(code, broadcast, options),
actions: { start, guess, ... : (room, seat, payload) => ({ ok } | { error }) }, roomInfo: (room) => ({ solo, options }) })`.
Сокет-події від клієнта: `create` (options + `name`, `solo`), `join` ({ code, name, token }), дії з `actions`, `leave`, `chat`, `react`.
Сервер шле `state` (= `publicState()` + `you` + `privateState(seat)`), `chatHistory`, `chat`, `reaction`.

**Сервер, `room.js`** (`class XRoom extends BaseRoom`, `super(code, onChange, solo ? 1 : 8)`; приклади: `guess/room.js` 270 рядків — найкоротший):
- обов'язково: `join(token, name)` → `{ seat } | { error }` (спершу `this.rejoin`, потім `this.takeSeat`; соло — одразу старт),
  `leave(seat)` (`this.seats[seat] = null`), `publicState()`; за потреби `privateState(seat)`, `setConnected` (оновити місце + `checkProgress()` + `changed()`).
- з BaseRoom: `seats[]` ({ token, name, connected }), `presentSeats()`, `publicSeats()`, `touch()`, `changed()` (розсилає стан),
  `this.timer` (чиститься в `destroy`). Господар — `presentSeats()[0]` (у top — перший онлайн, щоб офлайн-господар не тримав гру).
- статус `waiting | playing | finished`; раунди: `phase` `guess | reveal`; кінець раунду — у `checkProgress()`, коли всі онлайн закінчили
  (офлайн не тримає гру); далі — `nextVotes` (усі онлайн натиснули «далі») або пауза `REVEAL_MS`.
  Відповідь не відправляти в `publicState`, доки `phase !== 'reveal'`; для тестів — `process.env.<ID>_TEST_ANSWER === '1'` → `state.testAnswer`.
- дані гравця: `require('../../data')` → `players`, `playerById`, `normalize` (p.tags — Set, p.qid, p.born, p.fame, p.uk, p.photo);
  кар'єри/пул «хто загадується» за епохою × складністю — `require('../path/careers')` (`poolFor`, `careerOf`, `team`, `teams`, `POSITIONS`, `ERAS`, `DIFFICULTIES`);
  `require('../guess/compare')` → `profileOf` (збірна, позиція, клуби, голи, вартість…), `leagueOf(qid клубу)` (країна чемпіонату, британські — окремо),
  `nationName(qid збірної)`, `money(євро)`; `require('../top/tops')` → `topics` / `topicById` (готові топи-рейтинги з бази).

**Клієнт, деталі:** `window.Players.search(text)` (p.id, p.uk, p.name, p.born, p.thumb), `window.Players.normalize`,
`window.Sound.play('win'|'miss'|'pop'|'whistle')`; плейсхолдер імені (випадкова легенда) ставить `shared/players.js` сам.
Таймер — `state.deadline` і `g.serverNow()`.

**Тести:** `scripts/smoke-<id>.js`: сервер на випадковому порту з `<ID>_TEST_ANSWER=1`; боти через `bot()` + `last` (останній стан кожного) і
`nextState(s, pred)` — спершу перевіряє вже отриманий стан (без гонок). Під час розробки запускати лише свій файл (`node scripts/smoke-<id>.js`, ~10 с),
повний `npm test` (~3 хв) — один раз перед комітом, у фоні.

## Команди
- `npm test` — прогін усіх перевірок (~3 хв). Обов'язково перед комітом; запускати у фоні, вивід — у файл і `grep ПРОЙШЛИ|✗`.
- Оновити базу: `npm run build-players` (≈15 хв) → `npm run build-careers` (≈10 хв; кар'єри з таблиць en.wikipedia) → `npm run fetch-photos`; `npm run build-transfers` (≈1 хв); `npm run build-tournaments` (≈1 хв); `npm run build-stats` (≈2 хв, після build-transfers); `npm run build-coaches` (≈1 хв).
- `npm run dev` — локальний сервер з перезапуском.
- `npm run ui-check -- [hub|top|spy|guess|path] [--mobile]` — справжній Chrome без вікна (playwright-core + встановлений Chrome; окремий процес,
  браузер користувача не чіпає): проходить основні екрани, ловить помилки JS, знімки — у `.shots/` (не в git). Перед пушем UI-змін запускати
  для зміненої гри й дивитися (Read) лише нові/змінені екрани — 3–5 знімків (~1–1,5 тис. токенів кожен). Нова гра — додати сценарій у `scenarios`.
- Деплой: push у `main` → Render сам деплоїть (~2–3 хв). Перевірити https://football-party-games.onrender.com.

## Як працюємо
- Очевидні виправлення — одразу; дизайн великих фіч (нові режими, нова гра) — спершу погодити з користувачем.
- Помилки в даних гравців виправляються в `server/data/manual-tags.js`, потім `npm run build-players`; пропущені трансфери — `manual-transfers.js`.
- росію й білорусь у темах/питаннях не загадуємо.
- Перевіряти дані сюди ж: `node -e "require('./server/games/top/tops')…"` — швидше, ніж піднімати сервер.
- Windows: у Bash `sed` з'їдає `\` у регулярках — правки з бекслешами робити через Edit; багаторядкові заміни — Edit або python-скрипт.
