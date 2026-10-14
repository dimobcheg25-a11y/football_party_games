# Футбольні ігри — сайт з кількома іграми

Node 18+, Express + Socket.IO, клієнт — чистий HTML/CSS/JS без збірки. Інтерфейс і коментарі в коді — українською.
Відповідати користувачу українською.

## Карта
- `server/index.js` — ядро: статика, `/api/players` (спільна база), `/api/games` (каталог), редірект старих `/?room=` → `/crossroads/`.
- `server/games/index.js` — список ігор. Кожна гра: `server/games/<id>/index.js` експортує `{ meta, register({ app, io }) }`.
- `server/games/crossroads/` — «Футбольне перехрестя»: `room.js` (партія), `grid.js` (генерація сітки), `boards.js` (поля).
  Сокети — простір імен `/crossroads`, API — `/api/crossroads/...`.
- `server/data/` — спільна база футболістів і категорій для всіх ігор (`index.js` — завантаження, `categories.js`, ручні правки в `manual-tags.js`).
- `public/index.html` + `hub.css` + `hub.js` — головна (картки з `/api/games`).
- `public/shared/theme.css` — спільні токени, фон, `.back-link`. Кожна гра підключає її першою.
- `public/<id>/` — сторінка гри (`crossroads/app.js` — ~1100 рядків, читати частинами через Grep).
- `scripts/smoke-test.js` — автотест (боти через справжній сервер).

## Не читати цілком
`server/data/players.json` (~670 КБ), `server/data/photos.json` (~600 КБ), `package-lock.json` — лише Grep по конкретному імені/ключу.

## Нова гра
1. `server/games/<id>/index.js` з `meta` (`id, title, description, players, emoji`) і `register` (свій простір імен `io.of('/<id>')`, свої `/api/<id>/...`).
2. Додати в `server/games/index.js`.
3. `public/<id>/index.html` з `/shared/theme.css`, посиланням `<a class="back-link" href="/">← Усі ігри</a>`.
4. Тести — у `scripts/smoke-test.js` (або окремий файл, підключений у `npm test`).
Якщо логіка кімнат (код кімнати, чат, реакції, очищення) знадобиться вдруге — винести з `crossroads/index.js` у `server/core/`, а не копіювати.

## Команди
- `npm test` — прогін усіх перевірок (~1 хв, є таймаут 15 с). Обов'язково перед комітом.
- `npm run dev` — локальний сервер з перезапуском.
- Деплой: push у `main` → Render сам деплоїть (~2–3 хв). Перевірити https://football-party-games.onrender.com.

## Як працюємо
- Очевидні виправлення — одразу; дизайн великих фіч (нові режими, нова гра) — спершу погодити з користувачем.
- Помилки в даних гравців виправляються в `server/data/manual-tags.js`, потім `npm run build-players`.
