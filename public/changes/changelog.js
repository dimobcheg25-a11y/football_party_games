// Що нового — для гравців (не технічний журнал комітів). Нове — ЗВЕРХУ; кожен пункт обома мовами.
// game — id гри (значок і назва беруться з GAMES у changes.js) або null — для всього сайту.
// Після кожного помітного для гравців коміту — дописати сюди пункт (дата — день деплою).
window.CHANGELOG = [
  {
    date: '2026-10-18',
    items: [
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
