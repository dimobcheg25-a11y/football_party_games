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
- `server/games/path/` — «Шлях футболіста»: `careers.js` (епоха × складність за ігровою відомістю, етапи-клуби, підказки з ціною),
  `room.js` (серія раундів, очки 100→10 рівномірно за довжиною кар'єри мінус підказки, ціна підказки — частка кроку; соло = кімната на одного; `privateState` — свої підказки й
  відповіді лише гравцю). Дані — `server/data/careers.json` (кар'єри, герби/прапори посиланнями на Wikimedia).
- `server/data/` — спільна база футболістів і категорій для всіх ігор (`index.js` — завантаження, `categories.js`, ручні правки в `manual-tags.js`).
  Тег `UPL0014` — грав у чемпіонаті України 2000–2014 (у «Шляху» дає український бонус до відомості).
- `public/index.html` + `hub.css` + `hub.js` — головна (картки з `/api/games`).
- `public/shared/` — спільне для сторінок ігор: `theme.css` (токени, фон, `.back-link`), `ui.css` (кнопки, поля, чипи, вікна,
  підказки пошуку, тост, звук, чат), `players.js` (`window.Players.search` — автодоповнення імен), `sounds.js` (`window.Sound`).
- `public/<id>/` — сторінка гри (`crossroads/app.js` — ~1100 рядків, читати частинами через Grep).
- `scripts/smoke-test.js` (Перехрестя), `scripts/smoke-path.js` (Шлях) — автотести ботами через справжній сервер.
- `scripts/build-players.js` → `players.json`; `scripts/build-careers.js` → `careers.json` (запускати після build-players);
  `scripts/lib/wikidata.js` — запити до Wikidata з повторами.

## Не читати цілком
`server/data/players.json`, `server/data/careers.json`, `server/data/photos.json` (сотні КБ), `package-lock.json` — лише Grep
або `node -e` по конкретному імені/ключу.

## Нова гра
1. `server/games/<id>/index.js` з `meta` (`id, title, description, players, emoji`) і `register` (свій простір імен `io.of('/<id>')`, свої `/api/<id>/...`).
2. Додати в `server/games/index.js`.
3. `public/<id>/index.html` з `/shared/theme.css`, посиланням `<a class="back-link" href="/">← Усі ігри</a>`.
4. Тести — у `scripts/smoke-test.js` (або окремий файл, підключений у `npm test`).
Кімнати — через `createRoomServer` + `BaseRoom` (див. `server/games/path/` як приклад). На клієнті — `public/shared/*`.

## Команди
- `npm test` — прогін усіх перевірок (~1,5 хв, є таймаут 15 с). Обов'язково перед комітом.
- Оновити базу: `npm run build-players` (≈15 хв) → `npm run build-careers` (≈10 хв; кар'єри з таблиць en.wikipedia) → `npm run fetch-photos`.
- `npm run dev` — локальний сервер з перезапуском.
- Деплой: push у `main` → Render сам деплоїть (~2–3 хв). Перевірити https://football-party-games.onrender.com.

## Як працюємо
- Очевидні виправлення — одразу; дизайн великих фіч (нові режими, нова гра) — спершу погодити з користувачем.
- Помилки в даних гравців виправляються в `server/data/manual-tags.js`, потім `npm run build-players`.
