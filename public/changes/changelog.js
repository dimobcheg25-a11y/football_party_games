// Що нового — для гравців (не технічний журнал комітів). Нове — ЗВЕРХУ; кожен пункт обома мовами.
// game — id гри (значок і назва беруться з GAMES у changes.js) або null — для всього сайту.
// Після кожного помітного для гравців коміту — дописати сюди пункт (дата — день деплою).
window.CHANGELOG = [
  {
    date: '2026-10-23',
    items: [
      { game: 'sketch', uk: 'Більше інструментів: 18 кольорів, заливка, лінія, прямокутник, овал і гумка; товщина пензля — повзунком (або [ і ] на клавіатурі). Над серветкою видно, якого розміру й кольору пензель, ще до першого штриха.', en: 'More tools: 18 colours, fill, line, rectangle, oval and an eraser; brush size is a slider (or [ and ] on the keyboard). Over the napkin you can see the brush size and colour before the first stroke.' },
      { game: 'sketch', uk: 'Під полем відповіді вилазять підказки слів — клікни, і опечатка не завадить. Частина слова («олімп», «ліонель») тепер «майже».', en: 'Word suggestions pop up as you type your guess — click one and a typo won’t matter. Part of the answer (“olymp”, “lionel”) now counts as “so close”.' },
      { game: 'sketch', uk: 'Режим без таймера (∞), кнопки «🏳️ Не знаю» для гравців і «🏳️ Здатися» для художника. Складність тепер стосується всіх категорій, а терміни — ті, що в нас справді кажуть.', en: 'A no-timer mode (∞), a “🏳️ No idea” button for guessers and “🏳️ Give up” for the artist. Difficulty now applies to every category, and the terms are ones people actually use.' },
      { game: 'sketch', uk: 'Нова гра «Тактичний ескіз»: один малює на серветці футболіста, клуб, футбольний термін, трофей чи стадіон — решта вгадує в чаті. Хто швидше, той більше очок, а художник отримує очки за кожного, хто вгадав. Від 2 до 10 гравців.', en: 'New game “Tactical Sketch”: one player sketches a footballer, a club, a football term, a trophy or a stadium on a napkin — everyone else guesses in the chat. The faster you are, the more you score, and the artist scores for everyone who gets it. 2 to 10 players.' },
      { game: null, uk: 'Футболістів росії й білорусі більше не загадуємо в жодній грі. Спробуєш ввести — побачиш, що з ними сталося 🚢', en: 'Players from russia and belarus are never the answer in any game anymore. Try typing one — you’ll see what happened to them 🚢' },
    ],
  },
  {
    date: '2026-10-21',
    items: [
      { game: null, uk: 'Фото гравців у підказках, герби клубів і прапори знову завантажуються — і швидше: тепер їх віддає наш сайт, а не Вікіпедія напряму.', en: 'Player photos in suggestions, club crests and flags load again — and faster: our site now serves them instead of Wikipedia directly.' },
      { game: null, uk: 'Нані — правий вінгер (а не лівий).', en: 'Nani is a right winger (not left).' },
      { game: 'archive', uk: 'Прибрали фото, на якому був непідписаний гравець, — дякуємо за звіт!', en: 'Removed a photo with an untagged player — thanks for the report!' },
    ],
  },
  {
    date: '2026-10-19',
    items: [
      { game: null, uk: 'У кожній грі — кнопка «💬 Відгук про гру» внизу ліворуч: напиши, що подобається, чого бракує або що зламалось. Ми читаємо кожен відгук.', en: 'Every game has a “💬 Feedback” button at the bottom left: tell us what you like, what’s missing or what’s broken. We read every message.' },
      { game: 'archive', uk: 'На великому екрані фото у «Фотоархіві» тепер значно більше — на всю вільну ширину, але вміщається у висоту вікна.', en: 'On large screens the Photo Archive photo is much bigger — it fills the free width while still fitting the window height.' },
      { game: 'archive', uk: 'При першому вході у «Фотоархів» — коротке пояснення, що гра в беті й як допомогти: позначати погані фото 🚩 і додавати непідписаних гравців ➕.', en: 'The first time you open the Photo Archive, a short note explains it’s in beta and how to help: flag bad photos 🚩 and add untagged players ➕.' },
    ],
  },
  {
    date: '2026-10-18',
    items: [
      { game: 'archive', uk: 'Нова гра «Фотоархів» (бета): справжнє матчеве фото закрите сіткою 5×5 — відкривай квадратики й назви всіх загаданих гравців. Що менше відкрив, то більше очок. Соло, кімната «кожен свою сітку» або спільна сітка по черзі.', en: 'New game “Photo Archive” (beta): a real match photo hidden under a 5×5 grid — open tiles and name every player we ask for. The fewer you open, the more you score. Solo, a room with everyone on their own grid, or one shared grid taking turns.' },
      { game: 'archive', uk: 'Фото ще перевіряються: після кожного кадру можна позначити погане фото 🚩 або підказати гравця, якого ми не підписали ➕ — ми перевіримо й виправимо.', en: 'The photos are still being checked: after each shot you can flag a bad photo 🚩 or point out a player we didn’t tag ➕ — we’ll check and fix it.' },
      { game: null, uk: 'Таймер у «Шляху», «Вгадай гравця», «Топ-10» і «Один на один» — рівно по центру поля гри, а не всього екрана з таблицею.', en: 'The timer in Career Path, Guess the Player, Top 10 and One on One is centred over the game area, not the whole screen including the table.' },
      { game: 'crossroads', uk: 'Помітні кнопки «🏳️ Здатися» і «🚪 Вийти з кімнати» (раніше — ледь помітний текст і посилання внизу).', en: 'Easy-to-spot “🏳️ Resign” and “🚪 Leave room” buttons (they used to be faint text and a link at the bottom).' },
      { game: 'spy', uk: 'Помітні кнопки «⏭ Пропустити хід», «🗳 Одразу до голосування» і «🔄 Замінити футболіста».', en: 'Easy-to-spot “⏭ Skip turn”, “🗳 Straight to the vote” and “🔄 Replace footballer” buttons.' },
      { game: null, uk: 'Життя в «Топ-10» і «Один на один» підписані: «Помилок лишилось».', en: 'Lives in Top 10 and One on One are labelled “Mistakes left”.' },
      { game: null, uk: 'На головній — «🟢 Зараз на сайті»: скільки людей відкрили сайт просто зараз (кілька вкладок — одна людина).', en: 'The home page shows “🟢 Online now”: how many people have the site open right now (several tabs count as one).' },
      { game: 'lineup', uk: 'Лава запасних — зелена, як газон біля бровки: сині й білі футболки на ній видно; у всіх гравців на полі є позиція; відмітки гравців біля бровки не вилазять за поле; тренер ПСЖ у матчі 6:1 на місці.', en: 'The bench is green like the turf by the touchline, so blue and white shirts stand out; every player on the pitch has a position; badges of players by the touchline stay on the pitch; PSG’s coach in the 6–1 match is back.' },
      { game: null, uk: 'Наліпка «Складу матчу» на головній — знову поле зі схемою (одна команда, 4-3-3).', en: 'The “Match Lineup” sticker on the home page shows a pitch with a formation again (one team, 4-3-3).' },
      { game: 'lineup', uk: 'Голи й заміни на полі — збоку від футболки, а не на сусідах; біла обводка футболок (синя на синьому не зливається); підписане «Помилок лишилось»; кнопка «🔄 Замінити матч».', en: 'Goals and subs on the pitch sit beside the shirt, not on neighbours; white outline on shirts (blue on blue no longer blends); “Mistakes left” is labelled; “🔄 Swap match” button.' },
      { game: 'lineup', uk: 'Гравець коштує 4 очки — тепер кожна з трьох підказок справді знімає 1 очко.', en: 'A player is worth 4 points — now each of the three hints really takes off 1 point.' },
      { game: 'lineup', uk: 'Нове тло — нічний стадіон із прожекторами, програмка лежить поверх; лава запасних темна, тож білі футболки на ній видно; на полі — короткі прізвища й герби клубів, підписи не налазять один на одного.', en: 'New backdrop — a floodlit stadium at night with the programme on top; the bench is dark so white shirts stand out; short surnames and club crests on the pitch, labels no longer overlap.' },
      { game: 'lineup', uk: 'На комп’ютері обидві команди видно одразу, поруч; більші фото гравців; зрозуміліші підказки (💡 на футболках і пояснення під пошуком).', en: 'On desktop both teams are visible side by side; bigger player photos; clearer hints (💡 on shirts and an explanation under the search).' },
      { game: 'path', uk: 'Англійські, шотландські й валлійські клуби підписані своєю країною, а не «Сполучене Королівство».', en: 'English, Scottish and Welsh clubs are labelled with their own country, not “United Kingdom”.' },
      { game: 'lineup', uk: 'Нова гра «Склад матчу»: схема легендарного матчу без прізвищ — номери, прапори, клуби, голи й заміни. Назви, хто грав за обидві команди, і обох тренерів.', en: 'New game “Match Lineup”: the team sheet of a legendary match without names — numbers, flags, clubs, goals and substitutions. Name who played for both teams and both coaches.' },
      { game: 'lineup', uk: '100 матчів: фінали ЧС, Євро, Копа, Ліги чемпіонів і Ліги Європи, знамениті камбеки, українські матчі — і 13 єврокубкових вечорів Металіста Маркевича.', en: '100 matches: World Cup, Euro, Copa, Champions League and Europa League finals, famous comebacks, Ukrainian matches — and 13 European nights of Markevych’s Metalist.' },
      { game: 'lineup', uk: 'Підказки — на футболку, яку обереш сам; «🏁 Досить» закінчує матч, коли більше нікого не згадати, і знайдене лишається.', en: 'Hints go on the shirt you pick; “🏁 That’s it” ends the match when no one else comes to mind, and the points you found stay.' },
      { game: 'top', uk: 'Зрозуміліше вікно «Здатися»: видно, що раунд закінчиться, ти побачиш увесь топ і скільки вже вгаданих очок залишиться.', en: 'Clearer “Give up” window: it says the round ends, you’ll see the whole top, and how many points you keep.' },
      { game: 'path', uk: 'Підказки показують справжню ціну: на останніх клубах вона менша (або безкоштовно), бо очок за відповідь не може стати менше 5.', en: 'Hints show their real cost: at the last clubs it’s lower (or free), since an answer can’t be worth less than 5 points.' },
      { game: 'path', uk: 'Порядок клубів у кар’єрі — як було насправді: оренди стоять перед клубом, який віддав гравця, і без «оренди з клубу в нього ж» (Саліба, Кʼєлліні).', en: 'Career clubs in the real order: loans come before the parent club, and no more “loan from a club to itself” (Saliba, Chiellini).' },
      { game: 'guess', uk: 'Точні позиції для 250 легенд (Кафу — правий захисник, Зідан — атакувальний півзахисник…); Стерлінг і Неймар — ліві вінгери.', en: 'Exact positions for 250 legends (Cafu — right-back, Zidane — attacking midfielder…); Sterling and Neymar are left wingers.' },
      { game: 'guess', uk: 'Якщо точна позиція гравця невідома, «Півзахисник» тепер збігається з будь-яким півзахисником як «та сама лінія», з поясненням.', en: 'When a player’s exact position is unknown, “Midfielder” now matches any midfielder as “same line”, with an explanation.' },
      { game: null, uk: 'Трофеї: більше не рахуються півфінали й програні фінали (Стоїчков, Костадинов, Кель — не чемпіони світу).', en: 'Trophies: semi-finals and lost finals no longer count (Stoichkov, Kostadinov, Kehl are not world champions).' },
    ],
  },
  {
    date: '2026-10-17',
    items: [
      { game: 'top', uk: 'Кнопка «⏭ Інша тема»: якщо тема не подобається, господар може її змінити, поки ніхто нічого не назвав.', en: '“⏭ Skip topic” button: the host can swap a topic they don’t like before anyone names a player.' },
      { game: 'top', uk: 'Теми більше не повторюються за серію, і два раунди поспіль не бувають з однієї категорії (раніше могли тричі випасти «жовті картки в ЛЧ»).', en: 'Topics no longer repeat within a series, and two rounds in a row never share a category (before, “yellow cards in the UCL” could come up three times).' },
      { game: 'top', uk: 'Зрозуміліші теми про гроші: «Пік ринкової вартості» — найвища оцінка за кар’єру, «Найдорожчі трансфери» — сума, яку заплатив клуб.', en: 'Clearer money topics: “Peak market value” is the highest valuation in a career, “Most expensive transfers” is the fee a club paid.' },
      { game: 'top', uk: 'Неймар повернувся в топи нападників і вінгерів.', en: 'Neymar is back in the forwards & wingers tops.' },
      { game: 'guess', uk: 'Правильний останній клуб у гравців, що їздили в оренди (Сімеоне — «Атлетіко», а не «Алавес»; виправлено ще понад 100 гравців).', en: 'Correct last club for players who went out on loan (Simeone — Atlético, not Alavés; over 100 more players fixed).' },
      { game: null, uk: 'Підтвердження (пас, здатися, вихід, голос) — у вікні в стилі гри, а не системним вікном браузера.', en: 'Confirmations (pass, give up, leave, vote) now appear in a game-styled window instead of the browser’s pop-up.' },
      { game: null, uk: 'Помітні кнопки «🏳️ Здатися» і «🚪 Вийти з гри» — вихід тепер угорі, біля таймера.', en: 'Easy-to-spot “🏳️ Give up” and “🚪 Leave game” buttons — leave is now at the top, next to the timer.' },
      { game: null, uk: 'Сторінка «Що нового» — ось ця.', en: 'This “What’s new” page.' },
    ],
  },
  {
    date: '2026-10-15',
    items: [
      { game: 'duel', uk: 'Нова гра «Один на один»: двоє футболістів і питання — хто старший, вищий, забив більше, дорожчий, популярніший в Instagram. Соло-серія, раунди або кімната до 10 гравців.', en: 'New game “One on One”: two footballers and a question — who is older, taller, scored more, cost more, is more popular on Instagram. Solo streak, rounds or a room for up to 10.' },
      { game: 'duel', uk: 'Режим без таймера і таймер у соло; переможець серії лишається на рингу, але з кожною перемогою — рідше.', en: 'No-timer mode and a timer in solo; the streak winner stays in the ring, but less often with every win.' },
      { game: null, uk: 'Трофеї з кількістю перемог: «Ліга чемпіонів ×2» у «Вгадай гравця», нова категорія «Трофеї» в «Топ-10», питання про трофеї в «Один на один».', en: 'Trophies with win counts: “Champions League ×2” in Guess the Player, a new “Trophies” category in Top 10, trophy questions in One on One.' },
      { game: 'top', uk: 'Нова гра «Топ-10»: назви всіх із топу — трансфери, бомбардири, асисти, матчі, картки. Кожен свій топ або по черзі з життями.', en: 'New game “Top 10”: name everyone in the top — transfers, scorers, assists, appearances, cards. Each on their own or taking turns with lives.' },
      { game: 'top', uk: 'Вибір теми з фільтрами (категорія, клуб, країна) і рівні складності тем.', en: 'Topic picker with filters (category, club, country) and topic difficulty levels.' },
      { game: 'spy', uk: 'Нова гра «Футбольний шпигун» для 3–10 гравців: усі знають футболіста, крім шпигуна.', en: 'New game “Football Spy” for 3–10 players: everyone knows the footballer except the spy.' },
      { game: null, uk: 'Англійська версія сайту — перемикач UA/EN угорі.', en: 'English version of the site — the UA/EN switch at the top.' },
      { game: null, uk: 'Кожна гра отримала своє оформлення, а головна — альбом наліпок.', en: 'Every game got its own look, and the home page became a sticker album.' },
      { game: null, uk: 'Табличка «‹ Футбольні ігри» на кожній сторінці — повернутися на головну.', en: 'A “‹ Football games” tab on every page to get back home.' },
    ],
  },
  {
    date: '2026-10-14',
    items: [
      { game: 'guess', uk: 'Нова гра «Вгадай гравця» (як Wordle): 11 клітинок порівняння з поясненнями, спільні клуби «грали разом».', en: 'New game “Guess the Player” (like Wordle): 11 comparison cells with explanations, shared clubs “played together”.' },
      { game: 'path', uk: 'Нова гра «Шлях футболіста»: вгадай гравця за клубами кар’єри; підказки з ціною, 5 рівнів складності.', en: 'New game “Footballer’s Path”: guess the player from their clubs; hints that cost points, 5 difficulty levels.' },
      { game: null, uk: 'Трансфери й ринкова вартість гравців з Transfermarkt.', en: 'Player transfers and market values from Transfermarkt.' },
      { game: 'crossroads', uk: '«Футбольне перехрестя»: великі поля, гра на 2–4 гравців, чат, нові категорії й режими.', en: 'Football Crossroads: bigger boards, 2–4 players, chat, new categories and modes.' },
    ],
  },
  {
    date: '2026-10-13',
    items: [
      { game: 'crossroads', uk: 'Перша версія: футбольні хрестики-нулики онлайн 1 на 1.', en: 'First version: football tic-tac-toe online, 1 vs 1.' },
    ],
  },
];
