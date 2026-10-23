# Футбольні ігри — сайт з кількома іграми

Node 18+, Express + Socket.IO, клієнт — чистий HTML/CSS/JS без збірки. Інтерфейс і коментарі в коді — українською.
Відповідати користувачу українською.

## Карта
- `server/index.js` — ядро: статика, `/api/players` (спільна база), `/api/games` (каталог), редірект старих `/?room=` → `/crossroads/`.
- `server/games/index.js` — список ігор. Кожна гра: `server/games/<id>/index.js` експортує `{ meta, register({ app, io }) }`.
- `server/core/` — спільне для кімнат: `room-server.js` (`createRoomServer`: код кімнати, вхід за токеном, дії, чат, реакції,
  прибирання; `streams` — часті події без розсилки стану; `room.screenChat` — перевірка чату грою, `room.postChat(addSystemChat(T))` — повідомлення гри; простір імен `/<id>`, `/api/<id>/room/:code`; `room.privateState(seat)` — особисте для гравця) і `base-room.js` (`BaseRoom`: місця, онлайн, чат). Кімната гри наслідує BaseRoom.
- `server/games/crossroads/` — «Футбольне перехрестя»: `room.js` (партія), `grid.js` (генерація сітки), `boards.js` (поля).
  Сокети — простір імен `/crossroads`, API — `/api/crossroads/...`.
- `server/games/path/` — «Шлях футболіста»: `careers.js` (рейтинг упізнаваності `recognition`: fame + вартість + трофеї + збірна/великі клуби − давно завершив, +українцям;
  рівні = топ-400/800/1300/1900/усі, `poolFor(era, difficulty)` — спільний для «Шляху» і «Вгадай гравця»; етапи-клуби (сума переходу з
  transfers.json, асисти в чемпіонаті з stats.json — лише для періодів з 2012), підказки з ціною),
  `room.js` (серія раундів, очки 100→10 рівномірно за довжиною кар'єри мінус підказки, ціна підказки — частка кроку; соло = кімната на одного; `privateState` — свої підказки й
  відповіді лише гравцю). Дані — `server/data/careers.json` (кар'єри, герби/прапори посиланнями на Wikimedia).
- `server/games/guess/` — «Вгадай гравця» (як Wordle): `compare.js` (профіль гравця й 11 клітинок порівняння: збірна/континент, позиція (Transfermarkt; «близько» = та сама лінія),
  рік (старший/молодший словами), останній клуб, чемпіонат, голи, матчі й голи за збірну, асисти (лише якщо загаданий почав з 2012 — `columnsFor`;
  хто почав раніше — «—»), макс. вартість, трофеї текстом (з кількістю перемог з `honours`: «Ліга чемпіонів ×2»), спільні клуби з 🤝
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
  налаштовуються; тема випадкова (без повторів за серію й не тієї ж категорії, що минулого раунду) або `pick` — обирає господар через `/api/top/topics`;
  `skipTopic` — господар міняє тему, поки в раунді ніхто нічого не назвав (`state.canSkip`)). Теми вартості — «Пік ринкової вартості» (`maxValue`), трансфери — сума переходу; це сказано в `note`.
- `server/games/duel/` — «Один на один»: `questions.js` (питання `{ id, group, title, unit, note, value(p), show(v, p), gap }` у 8 групах — особисте (вік, зріст з `facts.json`),
  кар'єра, збірна, гроші, статистика з 2012 (`stats.json`, лише хто почав з 2012), трофеї (`honours`: усього, чемпіонати, ЛЧ; турніри зі збірною — теж звідти), популярність (`rawFame`, перегляди `facts.views`), Instagram
  (`manual-instagram.js`, пари лише ≥ ×1.3); без даних — питання/група недоступні (`/api/duel/categories`); пул — `poolFor` без росії/білорусі; `makePair` — рівні пар
  легко ≥ ×1.5 / складно ≤ 20 % (або свої абсолютні пороги), однакових значень немає), `room.js` (соло `streak` — переможець лишається, до кінця життів 1/3; соло `rounds` 10/20, +1;
  таймер 5/10/15 с або без нього (і в соло: не встиг — помилка); кімната 2–10 — одночасно, +1 і +1 найшвидшому правильному; числа (`values`) і чужий вибір — лише після `reveal`, свій — `privateState.myPick`).
- `server/games/lineup/` — «Склад матчу»: `matches.js` (матчі з `lineups.json`: обидві команди, позиції → x/y на полі (Вікіпедія — за кодом позиції, УЄФА — свої координати),
  номер, прапор (клуби) або клуб гравця на дату матчу (збірні, з кар'єр), голи, капітан, заміни, тренер; у грі — де ≥60 % основи в базі (Металіст — усі);
  рівні — середній `recognition` основи 30/40/30 %; категорії wc/euro/copa/ucl/uel/legend/ua/metalist; росія/білорусь — ні), `room.js` (серія матчів; гравець 4 очки,
  підказка на обрану футболку (вік, літер у прізвищі, перша літера) −1 (усі три — 1 очко); тренери — завжди, за `coachKey` з `/api/lineup/coaches`; заміни — опція;
  режими own / turns як у «Топ-10»; «🏁 Досить» (`finishRound`) — раунд закінчується, коли натиснули всі онлайн; `skipMatch`; свої знайдені й підказки — у `privateState`).
- `server/games/archive/` — «Фотоархів» (бета, `meta.beta` → значок на наліпці): `shots.js` (фото з `shots.json`; загадані — позначені на Commons з `poolFor` рівня easy/normal/fan,
  `maybeOnShot` — грав того року за клуб/збірну когось із позначених → нейтральна відповідь), `room.js` (сітка 5×5; за гравця 100 − 4 × відкритих (≥10);
  нейтральні — перші 3 на фото без штрафу; хибна — own: +1 квадратик, turns: кінець ходу; режими own / turns (у хід: 1 квадратик, потім відповідь або пас);
  свої квадратики й відповіді — у `privateState`; при першому вході — вікно «бета» `betaIntro()` в app.js), `reports.js` (звіти 🚩/➕ з `/api/archive/report` → GitHub Issues з міткою `photo-report`, потрібен `GITHUB_TOKEN`
  на Render; без нього — лише консоль). Фото — через `/api/archive/img/:id` (у назві файлу Commons — імена).
- `server/games/sketch/` — «Тактичний ескіз» (2–10, лише кімната): `words.js` (3 категорії — футболісти `poolFor` easy/normal, клуби з бази,
  терміни й трофеї вручну (одна категорія), `HARD` — не для «Легкого» (`decksFor`); збірних немає; `variants` — відповіді будь-якою мовою, для гравців
  і прізвище; `dictionary` → `/api/sketch/words` — підказки при введенні), `room.js` (хід: `choose` — художнику 3 слова, по одному з кожної категорії
  (футболіст, клуб, термін або трофей; стадіонів немає) → `draw` — штрихи/фігури/заливка подією `draw` через `streams` room-server, повний малюнок — дія `snapshot`
  (заливку кожен клієнт робить у своєму полотні); гравці бачать лише категорію (ні літер, ні їх кількості) → `reveal`; кіл 1/2/3;
  відповіді — у чаті: `screenChat` ховає правильну, «майже» (опечатка або частина слова) — лише автору й художнику, чат тих, хто вгадав, — лише їм;
  `pass` «не знаю», `giveUp` художника; очки 100→20 за часом (без таймера — за порядком), першому +20, художнику +25 за кожного; слово — лише в `privateState`).
- `server/games/fours/` — «Чотири четвірки» (як Connections): `groups.js` (16 гравців з `poolFor` → 4 групи по 4 за ознакою: категорії бази з рівнем `TIER`
  0 проста (клуб, збірна, Золотий м'яч, ЧС) … 3 підступна, + рік народження (складна) і тезки (підступна); склад рівнів і кількість «пасток»
  (гравець підходить до двох груп) — `LEVELS` easy/normal/fan; розклад завжди один — `uniquePartitions`; `seed` — «Головоломка дня» за київською датою),
  `room.js` (серія 1/3/5, кожен у своєму темпі; `check` 4 id → група / «майже» (3 з 4) / помилка, помилок 4 або ∞; бали 25 за групу − 5 за помилку,
  без помилок +10, у кімнаті першому +10; знайдені групи, спроби (кольори — лише коли закінчив) — у `privateState`; чужий прогрес — кольори й помилки).
- `server/data/` — спільна база футболістів і категорій для всіх ігор (`index.js` — завантаження, `categories.js`, ручні правки в `manual-tags.js`;
  `derived-tags.js` — категорії з зібраних даних при завантаженні: A100 (+ асисти TM), UCL30, T80, JOURNEY (10+ різних клубів), і
  `cleanCareers` — прибирає з кар'єр клуби з 0 матчів, крім поточного; клуб, з якого гравець їздив в оренди, ставить після оренд у межах його років;
  той самий клуб двічі поспіль зливає в один етап; той самий об'єкт careers.json бачать усі ігри;
  `manual-positions.js` — позиція, якою гравця знають: замість поточної з Transfermarkt (Неймар, Стерлінг) і для легенд без даних TM (усі до рівня «Фанат»)).
  `banned.js` — гравців росії й білорусі в базі немає (`isBanned`: збірна рф/рб, або без іншої збірної громадянство з `citizenship.json` —
  `npm run build-citizenship`; українців не чіпає; винятки `ALLOW`/`BAN`); у підказках вони сірі з випадковою принизливою приміткою —
  `Players.shame(query)` у `shared/players.js`, нова гра додає його в `renderSuggestions` (див. guess).
  Тег `UPL0014` — грав у чемпіонаті України 2000–2014 (у «Шляху» дає український бонус до відомості).
- `public/index.html` + `hub.css` + `hub.js` — головна-альбом наліпок Panini: картки з `/api/games` у двох групах — «можна самому» (`meta.solo`) і «тільки з друзями»;
  на наліпці значки «🎮 Соло» і «👥 З друзями · `meta.friends`»; стиль наліпки — клас `s-<id>` у hub.css + малюнок `ART[id]` у hub.js (немає — біла наліпка з emoji).
  Закладка «📋 Що нового» → `public/changes/` (сторінка-вкладиш альбому; дані — `changes/changelog.js`, червона крапка на головній — поки нову версію не відкрили).
- `server/core/presence.js` — «Зараз на сайті» на головній: унікальні відвідувачі (мітка `vid` з `public/shared/presence.js`, localStorage) з усіх просторів імен;
  головна й «Що нового» — `Presence.show()` (сокет `/presence`, подія `online`), ігри передають `vid` в auth свого сокета. Нова сторінка — підключити `/shared/presence.js`.
- `server/core/feedback.js` — відгуки гравців (`POST /api/feedback`) → GitHub Issues з міткою `feedback` + `feedback-like|idea|bug`; клієнт — `public/shared/feedback.js`
  (підписана кнопка «💬 Відгук про гру» внизу ліворуч — `.fb-fab`, ставиться сама; підключати одразу після i18n.js). Запити до GitHub (і для звітів «Фотоархіву») — `server/core/github.js`.
- `public/shared/` — спільне для сторінок ігор: `theme.css` (базові токени й фон, які гра перевизначає — див. «Оформлення гри»; `.home-link` — закріплена табличка «‹ Футбольні ігри» на головну, у кожній `index.html` перед екранами), `ui.css` (кнопки, поля, чипи, вікна,
  підказки пошуку, тост, звук, чат), `players.js` (`window.Players.search` — автодоповнення імен), `sounds.js` (`window.Sound`),
  `room-client.js` (`RoomClient.create` — уся спільна логіка клієнта кімнатних ігор).
- `public/<id>/` — сторінка гри (`crossroads/app.js` — ~1100 рядків, читати частинами через Grep).
- `scripts/smoke-test.js` (Перехрестя), `scripts/smoke-path.js` (Шлях), `scripts/smoke-guess.js` (Вгадай гравця), `scripts/smoke-spy.js` (Шпигун), `scripts/smoke-top.js` (Топ-10), `scripts/smoke-duel.js` (Один на один), `scripts/smoke-lineup.js` (Склад матчу), `scripts/smoke-archive.js` (Фотоархів), `scripts/smoke-sketch.js` (Тактичний ескіз), `scripts/smoke-fours.js` (Чотири четвірки) — автотести ботами через справжній сервер.
- `scripts/build-players.js` → `players.json`; `scripts/build-careers.js` → `careers.json` (запускати після build-players);
  `scripts/build-transfers.js` → `transfers.json` (за id гравця: `maxValue` — макс. ринкова вартість, `value` — поточна (лише активні),
  `topFee/topFrom/topTo/topSeason` — найдорожчий трансфер, `totalFees` — сума всіх трансферів, `paid` — їх кількість,
  `fees` — усі платні трансфери [сума, клуб TM звідки, куди, сезон]; євро; з відкритого transfermarkt-datasets, CC0; покриття — гравці
  приблизно з 2012 р., легенди здебільшого без даних — відомі пропуски дописуються в `server/data/manual-transfers.js`)
  і `transfer-clubs.json` (клуб TM → назва, ліга, наш qid — зіставлено за кар'єрами гравців);
  `scripts/build-tournaments.js` → `tournaments.json` (бомбардири ЧС, Євро, Копа, ЛЧ, ЛЄ з таблиць en.wikipedia; кого немає в базі — `null` + ім'я);
  `scripts/build-honours.js` → `honours.json` (розділ «Honours» статей en.wikipedia: скільки разів виграв чемпіонат (з назвами ліг), ЛЧ, ЛЄ, кубки, ЧС, Євро…;
  без молодіжних, особистих нагород і трофеїв тренером; доступ — `server/data/honours.js` (`honoursOf(p)`: null — розділу немає, невідомо);
  у «Топ-10» — категорія `trophies`);
  `scripts/build-stats.js` → `stats.json` (з таблиці виходів transfermarkt-datasets, кожен матч з 2012/13: готові топи асистів, гол+пас,
  голів/асистів за сезон, карток — по лігах, ЛЧ/ЛЄ і клубах; `players[tm]` — підсумки гравців бази: `t` [голи, асисти, матчі, жовті] усі змагання, `c[клуб]` лише чемпіонат);
  `scripts/build-lineups.js` → `lineups.json` (склади: статті Вікіпедії про фінали ЧС/Євро/Копа/ЛЧ/ЛЄ і окремі знамениті матчі + вибрані матчі з API УЄФА
  `match.uefa.com/v5` — Металіст Маркевича, Динамо, Шахтар, Україна, камбеки; гравці — за посиланням → `p.wiki` або ім'я + рік народження; тренери поза базою — ім'я uk з Вікідати;
  новий матч УЄФА — id у `UEFA_MATCHES` або команди в `UEFA_FIND`);
  `scripts/build-shots.js` → `shots.json` (фото «Фотоархіву»: файли Commons з «зображено» P180 = гравець, верхні 1300; кеш — `.cache/shots-depicts.json`;
  ручні правки — `server/data/manual-shots.js`: `rejected`, `extra`, `legends`); `scripts/apply-shot-reports.js` — схвалені звіти (задачі з мітками
  `photo-report` + `approved`) → `manual-shots.js` і `shots.json`, задачі закриває (токен — `git credential fill`);
  `scripts/lib/wikidata.js` — запити до Wikidata з повторами.

## Складність — єдиний рейтинг відомості
`recognition(p)` у `server/games/path/careers.js` — для ВСІХ ігор: fame (кількість мовних статей Вікіпедії; тренерам ×0,6 —
`coaches.json`, знижка вже в `p.fame`, сирий — `p.rawFame`) + ринкова вартість + матчі за збірну й великі клуби + великі трофеї;
українцям +25, давно завершеним — штраф. «Шлях», «Вгадай гравця», «Шпигун» — `poolFor` (верхівка рейтингу); «Перехрестя» — пули
`EASY_POOL/FAMOUS/FAN_POOL` (верхні 540/760/1500); «Топ-10» — популярність теми = середній рейтинг гравців її топ-10, рівні тем
easy/normal/hard = верхні 30% / наступні 40% / решта. Нова гра бере складність звідси ж, своїх порогів на fame не вигадувати.

## Не читати цілком
`server/data/players.json`, `careers.json`, `honours.json`, `lineups.json`, `photos.json`, `transfers.json`, `transfer-clubs.json`, `tournaments.json`, `stats.json` (десятки–сотні КБ), `package-lock.json` —
лише Grep або `node -e` по конкретному імені/ключу. Клієнти ігор (`public/<id>/app.js`, 240–320 рядків; crossroads — 1100) читати частинами: потрібне місце шукати Grep за назвою функції
(`renderGame`, `renderFinal`, `renderScoreboard`…).

## Нова гра
1. `server/games/<id>/index.js` з `meta` (`id, title, description, solo, friends, emoji`) і `register` (свій простір імен `io.of('/<id>')`, свої `/api/<id>/...`).
   `solo: true` — гра є в групі «Можна грати самому» на головній; `friends` — скільки гравців у кімнаті ('2–8').
2. Додати в `server/games/index.js`.
3. `public/<id>/` — `index.html`, `app.js` на `RoomClient` (див. «Клієнт нової гри»), `style.css` зі своїм світом (див. «Оформлення гри»).
4. `scripts/smoke-<id>.js` — скопіювати `smoke-top.js` або `smoke-spy.js`, додати в `npm test` (package.json).
5. Коротко описати гру в «Карті» вище (1–4 рядки: файли, фази, бали, що приватне).
6. Наліпка на головній: клас `s-<id>` у `hub.css` + `ART[id]` у `hub.js`; сценарій у `scripts/ui-check.js`.

### Оформлення гри — у кожної свій світ
Спільний каркас (лобі, кнопки, чат, room-client, розкладка, Manrope для тексту, кольори гравців `--p0..--p3`) однаковий; кожна гра має
**свій матеріал, шрифт заголовків/цифр, акцент і одну фірмову анімацію**, взяті з її механіки. Макет-погодження: https://claude.ai/artifact/5gTn9EM8Y5GpRY68MmakoZ
- Перехрестя — крейдяна тактична дошка (Caveat, жовта крейда, ✕◯ «дописуються» — `chalkMark()`); Шлях — світла схема метро (Oswald, червона лінія,
  клуби-станції з гербом, трансфер — пересадка, очки на «квитку»; стилі в `path/skin.css`, бо `path/style.css` — база для інших ігор);
  Вгадай — перекидне табло Solari (JetBrains Mono, бурштин, клітинки перекидаються по черзі + звук `flap`); Шпигун — досьє (PT Mono / Rubik Mono One,
  тека, фото на скріпці, печатка «ЦІЛКОМ ТАЄМНО» + звук `stamp`); Топ-10 — телешоу (Russo One, неон, скошені плашки, звук `ding`);
  Один на один — афіша боксерського поєдинку (Alumni Sans, червоний і синій кути з фото на всю половину, золоте «VS»; числа крутяться лічильником,
  переможець спалахує, переможений тьмяніє + звук `gong`); Склад матчу — офіційна програмка (Playfair Display, кремовий папір, синя смуга й червоний акцент,
  поле надруковане в програмці, гравці — футболки в кольорах форми з номером; відгадав — футболка перевертається з фото + звук `crowd`);
  Фотоархів — фотолабораторія (Unbounded + IBM Plex Mono, червона лампа, фото на білому папері, квадратики — шматки негативу з кодами A1…E5,
  жовтогарячі «плівкові» написи; відгаданий «проявляється» + звук `shutter`); Тактичний ескіз — серветка в спортбарі (Amatic SC, дерев'яний стіл,
  паперова серветка з тисненою рамкою й слідом від келиха, малюнок маркером, бурштиновий акцент; хтось вгадав — підставка під пиво з очками
  прилітає на серветку + звук `clink`); Чотири четвірки — церемонія жеребкування (Forum, темно-синя сцена під золотим прожектором,
  гравці в прозорих капсулах, знайдена група — кошик свого кольору, капсули скочуються в нього по одній + звук `capsule`).
  Нова гра — новий світ, не повторювати ці.
- Як: у `public/<id>/style.css` на початку `:root { --bg --bg-2 --surface --surface-solid --surface-2 --line --line-strong --text --muted --accent --accent-ink --radius --display }`
  + свій `.pitch-bg`; шрифт — Google Fonts з кирилицею в `index.html` (і `theme-color`); логотип `.logo` — у стилі світу.
  У спільних файлах кольори — лише через токени (`color-mix(in srgb, var(--accent) N%, transparent)`, `var(--surface-2)`), без вшитих rgba лайму.
  Світла гра — свій `skin.css` з перевизначенням того, що в ui.css зроблено на `rgba(255,255,255,…)`, і `color-scheme: light`.
- **Фото гравців, герби клубів, прапори — завжди лишаються** (світ їх обрамлює, а не ховає); фото — великі (~60 px у списках, 120+ у картці відповіді).
- Анімацію, що перемальовується зі станом, запускати лише для нового (ключ, як `cardKey` у spy), і вимикати в `prefers-reduced-motion`.
- Звук гри — функція в `shared/sounds.js` (`flap`, `station`, `stamp`, `ding` — приклади), виклик у `playSounds` гри.

### Дві мови — українська (основна) й англійська
Перемикач UA/EN на кожній сторінці (сам ставиться в `.sound-ctl` / `[data-lang-switch]`), вибір у localStorage `lang`, перемикання перезавантажує сторінку.
У кімнаті кожен бачить свою мову. Кожен новий текст — одразу обома мовами.
- Клієнт — `public/shared/i18n.js` (підключати першим зі скриптів): статичний HTML — український текст у розмітці + `data-en="…"`
  (`data-en-html`, `data-en-placeholder`, `data-en-title`, `data-en-aria-label`, `data-en-content`); JS — `I18n.L('укр', 'eng')`,
  `I18n.name(p)` (ім'я гравця: `p.uk` або `p.name`), `I18n.plural(n, [3 укр. форми], [one, many])`. `/api/...` — з `?lang=${I18n.lang}`.
- Сервер — `server/core/i18n.js`: тексти парами `T('укр', 'eng')` у стані, помилках, відповідях дій; room-server перед відправкою робить
  `localize(…, socket.lang)` (мова з `io('/<id>', { auth: { lang } })` — room-client це робить сам). Пари не склеювати «+» — будувати обидва рядки: `T('Раунд ' + n, 'Round ' + n)`.
  Для /api — `localize(дані, langOf(req.query.lang))`. `meta.title/description` гри — теж `T`.
- Назви англійською: `server/data/names-en.js` — `countryEn(укр. назва країни)`, `teamEn(qid, team)` (клуби з `team-names-en.json`,
  `npm run build-names-en` після build-careers; ручні правки — `TEAM_FIX`). Гравці — `p.name` (англійське ім'я вже є в базі).

### Клієнт нової гри
Усе спільне — `public/shared/room-client.js` (`RoomClient.create(cfg)`; опис `cfg` і того, що повертає, — у коментарі на початку файлу):
налаштування-чипи (`[data-opt]` один варіант, `[data-multi]` кілька, `[data-toggle]` вмикач; підказка `#difficulty-hint` — сама, підказка під іншим вибором — `cfg.hints` → `#<опція>-hint`; статичний текст під вибором не писати), вхід/перепідключення,
запрошення `?room=`, лобі (`state.minPlayers`, `state.notice` — якщо є), вихід, чат, реакції, звук, кнопки `#start-btn`/`#again-btn`. Підтвердження — лише `g.ask(питання, { note, ok, danger })` (вікно в стилі гри; `confirm()` не використовувати;
  штрихи світу — `.ask-sheet` у `<id>/style.css`). «Вийти з гри» — `.btn-leave` у `.game-top`, «Здатися» — `.btn-giveup`.
Гра пише лише своє: `defaults`, `createOptions`, `optionList`, `onState` (свої змінні + звуки), `renderGame`, `renderFinal`.
- `index.html` — скопіювати `public/top/index.html` (або `guess`) і замінити налаштування й `#screen-game`; скрипти: socket.io, `/shared/players.js`,
  `/shared/sounds.js`, `/shared/room-client.js`, `/<id>/app.js` (і `/shared/feedback.js` після i18n.js). Без `#solo-btn` — гра лише для кімнати (як `spy`).
- `app.js` — за зразком `public/guess/app.js` (~240 рядків, найкоротший) або `public/spy/app.js` (кімната з ролями/чергою/голосуванням;
  `#stage` перемальовується лише коли змінився ключ етапу — щоб не збивати введення). Автодоповнення гравця — функції `renderSuggestions/choose` з guess/top.
- Стилі: `/shared/theme.css`, `/shared/ui.css`, `/path/style.css` (лобі, таблиця, поле відповіді, `.answer-card`, підсумок) + свій `/<id>/style.css` (токени світу — «Оформлення гри»).
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
- Оновити базу: `npm run build-players` (≈15 хв) → `npm run build-careers` (≈10 хв; кар'єри з таблиць en.wikipedia) → `npm run fetch-photos`; `npm run build-transfers` (≈1 хв); `npm run build-tournaments` (≈1 хв); `npm run build-stats` (≈2 хв, після build-transfers); `npm run build-coaches` (≈1 хв); `npm run build-names-en` (≈5 хв, англійські назви клубів, після build-careers); `npm run build-honours` (≈4 хв, трофеї); `npm run build-facts` (≈10 хв: зріст, дата народження, перегляди Вікіпедії → `facts.json`); `npm run build-lineups` (≈3 хв, склади матчів, після build-players і build-careers); `npm run build-shots` (≈20 хв уперше, фото «Фотоархіву», після build-players); `npm run apply-shot-reports` (схвалені звіти гравців про фото). Instagram — вручну в `server/data/manual-instagram.js`.
- `npm run dev` — локальний сервер з перезапуском.
- `npm run ui-check -- [hub|top|spy|guess|duel|path|lineup|archive|sketch|fours|crossroads] [--mobile]` — справжній Chrome без вікна (playwright-core + встановлений Chrome; окремий процес,
  браузер користувача не чіпає): проходить основні екрани, ловить помилки JS, знімки — у `.shots/` (не в git). Перед пушем UI-змін запускати
  для зміненої гри й дивитися (Read) лише нові/змінені екрани — 3–5 знімків (~1–1,5 тис. токенів кожен). Нова гра — додати сценарій у `scenarios`.
- Деплой: push у `main` → Render сам деплоїть (~2–3 хв). Перевірити https://football-party-games.onrender.com.

## Як працюємо
- Після помітних для гравців змін — пункт у `public/changes/changelog.js` (обома мовами, простими словами, не текст коміту).
- Баг в одній грі — перевіряти й виправляти в усіх місцях, де він може повторитись (інші ігри зі спільним каркасом: `path/style.css`, room-client, кнопки, таймер, дані бази); `npm run ui-check` для кожної зачепленої гри.
- Очевидні виправлення — одразу; дизайн великих фіч (нові режими, нова гра) — спершу погодити з користувачем.
- Помилки в даних гравців виправляються в `server/data/manual-tags.js`, потім `npm run build-players`; пропущені трансфери — `manual-transfers.js`.
- росію й білорусь у темах/питаннях не загадуємо.
- Перевіряти дані сюди ж: `node -e "require('./server/games/top/tops')…"` — швидше, ніж піднімати сервер.
- Windows: у Bash `sed` з'їдає `\` у регулярках — правки з бекслешами робити через Edit; багаторядкові заміни — Edit або python-скрипт.
