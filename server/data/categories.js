// Категорії, з яких збирається сітка.
//   qid    — елемент Wikidata (для клубів і збірних — за ним збирається база, див. scripts/build-players.js)
//   image  — назва статті en.wikipedia, з якої береться герб/трофей/фото (scripts/fetch-category-images.js),
//            для збірних — файл прапора з Wikimedia Commons; imageOf — взяти картинку іншої категорії
//   short  — коротший підпис для великих полів (5×5, 6×6), де клітинки вузькі
//   colors — запасні кольори значка, поки немає картинки
//   level  — з якого режиму категорія з'являється: без поля — у всіх (легкий+), 'normal' — звичайний+, 'fan' — фанат і складний, 'hard' — лише складний

const clubs = [
  { id: 'RMA', label: 'Реал Мадрид', qid: 'Q8682', image: 'Real Madrid CF', colors: ['#ffffff', '#febe10'] },
  { id: 'BAR', label: 'Барселона', qid: 'Q7156', image: 'FC Barcelona', colors: ['#004d98', '#a50044'] },
  { id: 'ATM', label: 'Атлетіко', qid: 'Q8701', image: 'Atlético Madrid', colors: ['#cb3524', '#272e61'] },
  { id: 'SEV', level: 'hard', label: 'Севілья', qid: 'Q10329', image: 'Sevilla FC', colors: ['#ffffff', '#d81920'] },
  { id: 'VAL', level: 'hard', label: 'Валенсія', qid: 'Q10333', image: 'Valencia CF', colors: ['#ffffff', '#ee7814'] },
  { id: 'MUN', label: 'Манчестер Юнайтед', short: 'Ман Юнайтед', qid: 'Q18656', image: 'Manchester United F.C.', colors: ['#da291c', '#fbe122'] },
  { id: 'LIV', label: 'Ліверпуль', qid: 'Q1130849', image: 'Liverpool F.C.', colors: ['#c8102e', '#00b2a9'] },
  { id: 'CHE', label: 'Челсі', qid: 'Q9616', image: 'Chelsea F.C.', colors: ['#034694', '#dba111'] },
  { id: 'ARS', label: 'Арсенал', qid: 'Q9617', image: 'Arsenal F.C.', colors: ['#ef0107', '#ffffff'] },
  { id: 'MCI', label: 'Манчестер Сіті', short: 'Ман Сіті', qid: 'Q50602', image: 'Manchester City F.C.', colors: ['#6cabdd', '#1c2c5b'] },
  { id: 'TOT', label: 'Тоттенгем', qid: 'Q18741', image: 'Tottenham Hotspur F.C.', colors: ['#132257', '#ffffff'] },
  { id: 'NEW', level: 'normal', label: 'Ньюкасл', qid: 'Q18716', image: 'Newcastle United F.C.', colors: ['#000000', '#ffffff'] },
  { id: 'AVL', level: 'normal', label: 'Астон Вілла', qid: 'Q18711', image: 'Aston Villa F.C.', colors: ['#670e36', '#95bfe5'] },
  { id: 'JUV', label: 'Ювентус', qid: 'Q1422', image: 'Juventus FC', colors: ['#000000', '#ffffff'] },
  { id: 'MIL', label: 'Мілан', qid: 'Q1543', image: 'AC Milan', colors: ['#fb090b', '#000000'] },
  { id: 'INT', label: 'Інтер', qid: 'Q631', image: 'Inter Milan', colors: ['#010e80', '#000000'] },
  { id: 'NAP', level: 'hard', label: 'Наполі', qid: 'Q2641', image: 'SSC Napoli', colors: ['#12a0d7', '#ffffff'] },
  { id: 'ROM', level: 'hard', label: 'Рома', qid: 'Q2739', image: 'AS Roma', colors: ['#8e1f2f', '#f0bc42'] },
  { id: 'LAZ', level: 'normal', label: 'Лаціо', qid: 'Q2609', image: 'SS Lazio', colors: ['#87d8f7', '#ffffff'] },
  { id: 'PAR', level: 'normal', label: 'Парма', qid: 'Q2693', image: 'Parma Calcio 1913', colors: ['#ffd200', '#1b3f8b'] },
  { id: 'BAY', label: 'Баварія', qid: 'Q15789', image: 'FC Bayern Munich', colors: ['#dc052d', '#0066b2'] },
  { id: 'BVB', label: 'Боруссія Д', qid: 'Q41420', image: 'Borussia Dortmund', colors: ['#fde100', '#000000'] },
  { id: 'PSG', label: 'ПСЖ', qid: 'Q483020', image: 'Paris Saint-Germain FC', colors: ['#004170', '#da291c'] },
  { id: 'AJX', level: 'hard', label: 'Аякс', qid: 'Q81888', image: 'AFC Ajax', colors: ['#ffffff', '#d2122e'] },
  { id: 'BEN', level: 'hard', label: 'Бенфіка', qid: 'Q131499', image: 'S.L. Benfica', colors: ['#e30613', '#ffffff'] },
  { id: 'FCP', level: 'hard', label: 'Порту', qid: 'Q128446', image: 'FC Porto', colors: ['#00428c', '#ffffff'] },
  { id: 'DYN', level: 'normal', label: 'Динамо Київ', qid: 'Q179075', image: 'FC Dynamo Kyiv', colors: ['#ffffff', '#0050a0'] },
  { id: 'SHA', level: 'normal', label: 'Шахтар', qid: 'Q172969', image: 'FC Shakhtar Donetsk', colors: ['#f26522', '#000000'] },
  { id: 'MET', level: 'hard', label: 'Металіст Харків', short: 'Металіст', qid: 'Q207462', image: 'FC Metalist Kharkiv', colors: ['#ffd200', '#1b3f8b'] },
  { id: 'DNI', level: 'hard', label: 'Дніпро', qid: 'Q175687', image: 'FC Dnipro', colors: ['#1b4fa0', '#ffffff'] },
].map((c) => ({ ...c, type: 'club' }));

// Клуби країни: на перетині зі своєю збірною не ставляться («Реал × Іспанія» — надто легко).
// Українські пари (Динамо × Україна) свідомо лишаються — для своїх це не просто легка клітинка.
const NATION_CLUBS = {
  ESP: ['RMA', 'BAR', 'ATM', 'SEV', 'VAL'],
  ENG: ['MUN', 'LIV', 'CHE', 'ARS', 'MCI', 'TOT', 'NEW', 'AVL'],
  ITA: ['JUV', 'MIL', 'INT', 'NAP', 'ROM', 'LAZ', 'PAR'],
  GER: ['BAY', 'BVB'],
  FRA: ['PSG'],
  NED: ['AJX'],
  POR: ['BEN', 'FCP'],
};

const nations = [
  { id: 'ESP', label: 'Іспанія', qid: 'Q42267', image: 'File:Flag of Spain.svg', colors: ['#aa151b', '#f1bf00'] },
  { id: 'FRA', label: 'Франція', qid: 'Q47774', image: 'File:Flag of France.svg', colors: ['#002395', '#ed2939'] },
  { id: 'BRA', label: 'Бразилія', qid: 'Q83459', image: 'File:Flag of Brazil.svg', colors: ['#009c3b', '#ffdf00'] },
  { id: 'ARG', label: 'Аргентина', qid: 'Q79800', image: 'File:Flag of Argentina.svg', colors: ['#74acdf', '#ffffff'] },
  { id: 'ENG', label: 'Англія', qid: 'Q47762', image: 'File:Flag of England.svg', colors: ['#ffffff', '#ce1124'] },
  { id: 'GER', label: 'Німеччина', qid: 'Q43310', image: 'File:Flag of Germany.svg', colors: ['#000000', '#dd0000'] },
  { id: 'ITA', label: 'Італія', qid: 'Q676899', image: 'File:Flag of Italy.svg', colors: ['#009246', '#ce2b37'] },
  { id: 'POR', label: 'Португалія', qid: 'Q267245', image: 'File:Flag of Portugal.svg', colors: ['#006600', '#ff0000'] },
  { id: 'NED', label: 'Нідерланди', qid: 'Q47050', image: 'File:Flag of the Netherlands.svg', colors: ['#ae1c28', '#21468b'] },
  { id: 'BEL', level: 'hard', label: 'Бельгія', qid: 'Q166776', image: 'File:Flag of Belgium (civil).svg', colors: ['#000000', '#fdda24'] },
  { id: 'CRO', level: 'hard', label: 'Хорватія', qid: 'Q134479', image: 'File:Flag of Croatia.svg', colors: ['#ff0000', '#171796'] },
  { id: 'URU', level: 'hard', label: 'Уругвай', qid: 'Q134916', image: 'File:Flag of Uruguay.svg', colors: ['#ffffff', '#0038a8'] },
  { id: 'UKR', level: 'normal', label: 'Україна', qid: 'Q170403', image: 'File:Flag of Ukraine.svg', colors: ['#0057b7', '#ffd700'] },
].map((c) => ({ ...c, type: 'nation', home: NATION_CLUBS[c.id] }));

// Грав у лізі (будь-коли в кар'єрі). Китай, ОАЕ й МЛС — щоб зірки, які туди поїхали, з'являлися ще й через ці ліги.
//   home — збірна й клуби цієї ліги: на перетині з лігою вони не ставляться («Ла Ліга × Барселона» — завжди так, «× Іспанія» — надто легко).
const leagues = [
  { id: 'L_EPL', label: 'Грав в АПЛ', image: 'Premier League', icon: '🏴', home: ['ENG', 'MUN', 'LIV', 'CHE', 'ARS', 'MCI', 'TOT', 'NEW', 'AVL'] },
  { id: 'L_SA', label: 'Грав у Серії А', image: 'Serie A', icon: '🇮🇹', home: ['ITA', 'JUV', 'MIL', 'INT', 'NAP', 'ROM', 'LAZ', 'PAR'] },
  { id: 'L_LL', label: 'Грав у Ла Лізі', image: 'La Liga', icon: '🇪🇸', home: ['ESP', 'RMA', 'BAR', 'ATM', 'SEV', 'VAL'] },
  { id: 'L_BL', label: 'Грав у Бундеслізі', image: 'Bundesliga', icon: '🇩🇪', home: ['GER', 'BAY', 'BVB'] },
  { id: 'L_L1', label: 'Грав у Лізі 1', image: 'Ligue 1', icon: '🇫🇷', home: ['FRA', 'PSG'] },
  { id: 'L_MLS', level: 'fan', label: 'Грав в МЛС (США)', short: 'Грав в МЛС', image: 'Major League Soccer', icon: '🇺🇸' },
  { id: 'L_CSL', level: 'fan', label: 'Грав у Суперлізі Китаю', short: 'Грав у Китаї', image: 'Chinese Super League', icon: '🇨🇳' },
  { id: 'L_UAE', level: 'fan', label: 'Грав у Про-лізі ОАЕ', short: 'Грав в ОАЕ', image: 'UAE Pro League', icon: '🇦🇪' },
].map((c) => ({ ...c, type: 'league', colors: ['#3a4a5c', '#1c2530'] }));

const awards = [
  { id: 'BALLON', label: "Золотий м'яч", image: "Ballon d'Or", icon: '🥇' },
  { id: 'WC', label: 'Володар Кубка світу', short: 'Переможець ЧС', image: 'FIFA World Cup Trophy', icon: '🏆' },
  { id: 'UCL', label: 'Володар Ліги чемпіонів', short: 'Виграв ЛЧ', image: "European Champion Clubs' Cup", icon: '⭐' },
  { id: 'EURO', label: 'Володар Кубка Чемпіонату Європи', short: 'Переможець Євро', image: 'Henri Delaunay Trophy', icon: '🏅' },
  { id: 'COPA', level: 'hard', label: 'Володар Кубка Америки', short: 'Копа Америка', image: 'File:Copa america trofeo.jpg', icon: '🌎' },
  { id: 'UEL', level: 'hard', label: 'Володар Ліги Європи / Кубка УЄФА', short: 'Виграв ЛЄ', image: 'File:PD-Shape Europa League Trophy.svg', icon: '🟠' },
  { id: 'BOOT', level: 'hard', label: 'Золота бутса', image: 'European Golden Shoe', icon: '👟' },
  { id: 'APL', level: 'normal', label: 'Чемпіон АПЛ', image: "File:Premier League Trophy at Manchester's National Football Museum (Ank Kumar) 02.jpg", icon: '🦁' },
  { id: 'CH_IT', level: 'normal', label: 'Чемпіон Італії', image: 'Scudetto', icon: '🛡️' },
  { id: 'CH_ES', level: 'normal', label: 'Чемпіон Іспанії', image: 'File:Trofeo de La Liga 9900.jpg', icon: '🏆' },
  { id: 'CH_DE', level: 'normal', label: 'Чемпіон Німеччини', image: 'Meisterschale', icon: '🥏' },
  // кращий бомбардир сезону — окремо для кожної ліги
  { id: 'TS_EPL', level: 'fan', label: 'Найкращий бомбардир сезону АПЛ', short: 'Бомбардир №1 сезону АПЛ', icon: '🎯' },
  { id: 'TS_SA', level: 'fan', label: 'Найкращий бомбардир сезону Серії А', short: 'Бомбардир №1 сезону Серії А', icon: '🎯' },
  { id: 'TS_LL', level: 'fan', label: 'Найкращий бомбардир сезону Ла Ліги', short: 'Бомбардир №1 сезону Ла Ліги', icon: '🎯' },
  { id: 'TS_BL', level: 'fan', label: 'Найкращий бомбардир сезону Бундесліги', short: 'Бомбардир №1 сезону Бундесліги', icon: '🎯' },
  { id: 'TS_L1', level: 'fan', label: 'Найкращий бомбардир сезону Ліги 1', short: 'Бомбардир №1 сезону Ліги 1', icon: '🎯' },
  // Golden Boy — нагорода кращому молодому (до 21) гравцю Європи; у статті головне фото — гравець, тому лише значок
  { id: 'GBOY', level: 'fan', label: 'Golden Boy', icon: '🌟' },
  // символічна збірна року FIFPRO (FIFA FIFPRO World 11, з 2005; awards.json)
  { id: 'W11', level: 'normal', label: 'Символічна збірна FIFPRO', short: 'Збірна FIFPRO', icon: '⭐' },
  // рейтинги «Золотого м'яча» (ballon.json): на перетині з самим «Золотим м'ячем» і одне з одним не ставляться — завжди так
  { id: 'BDO3', level: 'normal', label: "Трійка «Золотого м'яча»", short: "Топ-3 Золотого м'яча", imageOf: 'BALLON', icon: '🥉', home: ['BALLON', 'BDO10'] },
  { id: 'BDO10', level: 'fan', label: "Десятка «Золотого м'яча»", short: "Топ-10 Золотого м'яча", imageOf: 'BALLON', icon: '🔟', home: ['BALLON', 'BDO3'] },
].map((c) => ({ ...c, type: 'award', colors: ['#d4af37', '#8a6d1d'] }));

const stats = [
  { id: 'G300', level: 'normal', label: "300+ голів у кар'єрі", short: '300+ голів', icon: '⚽' },
  { id: 'G50N', level: 'normal', label: '50+ голів за збірну', icon: '🥅' },
  { id: 'CAPS100', level: 'normal', label: '100+ матчів за збірну', icon: '👕' },
  { id: 'A100', level: 'normal', label: '100+ гольових передач', short: '100+ передач', icon: '🎯' },
  { id: 'T100', level: 'fan', label: 'Трансфер за 100+ млн', short: 'Трансфер 100+ млн', icon: '💰' },
  // з зібраних даних — server/data/derived-tags.js
  { id: 'T80', level: 'normal', label: 'Трансфер за €80+ млн', short: 'Трансфер 80+ млн', icon: '💶' },
  { id: 'UCL30', level: 'normal', label: '30+ голів у Лізі чемпіонів', short: '30+ голів у ЛЧ', icon: '⭐' },
  { id: 'JOURNEY', level: 'fan', label: 'Мандрівник: 10+ клубів', short: 'Мандрівник 10+ клубів', icon: '🧳' },
  { id: 'H190', level: 'normal', label: 'Зріст 190+ см', icon: '📏' },
  { id: 'H170', level: 'fan', label: 'Зріст до 170 см', icon: '📐' },
].map((c) => ({ ...c, type: 'stat', colors: ['#5ad1b8', '#1d6b5c'] }));

// Грав під керівництвом тренера (каденції з Wikidata: клуби + завершені у збірних; перетин ≥ 3 місяців)
const coaches = [
  { id: 'CO_GUA', label: 'Грав у Гвардіоли', coachQid: 'Q164038', image: 'Pep Guardiola' },
  { id: 'CO_FER', label: 'Грав у Фергюсона', coachQid: 'Q44980', image: 'Alex Ferguson' },
  { id: 'CO_MOU', label: 'Грав у Моурінью', coachQid: 'Q79983', image: 'José Mourinho' },
  { id: 'CO_ZID', label: 'Грав у Зідана', coachQid: 'Q1835', image: 'Zinedine Zidane' },
  { id: 'CO_KLO', label: 'Грав у Клоппа', coachQid: 'Q83106', image: 'Jürgen Klopp' },
  { id: 'CO_ANC', label: 'Грав в Анчелотті', coachQid: 'Q174614', image: 'Carlo Ancelotti' },
  { id: 'CO_WEN', label: 'Грав у Венгера', coachQid: 'Q47576', image: 'Arsène Wenger' },
  { id: 'CO_LUE', label: 'Грав у Луїса Енріке', short: 'У Луїса Енріке', coachQid: 'Q222789', image: 'Luis Enrique' },
  { id: 'CO_LOB', label: 'Грав у Лобановського', short: 'У Лобановського', coachQid: 'Q324484', image: 'Valeriy Lobanovskyi' },
].map((c) => ({ ...c, type: 'coach', level: 'fan', colors: ['#c9a227', '#3a2f0b'], icon: '📋' }));

// Вихованець академії: дубль/молодіжні команди (Wikidata P831, категорії en.wikipedia) + ручний список
const academies = [
  { id: 'AC_BAR', label: 'Вихованець Барселони', short: 'Академія Барси', clubQid: 'Q7156', imageOf: 'BAR' },
  { id: 'AC_RMA', label: 'Вихованець Реала', short: 'Академія Реала', clubQid: 'Q8682', imageOf: 'RMA' },
  { id: 'AC_AJX', label: 'Вихованець Аякса', short: 'Академія Аякса', clubQid: 'Q81888', imageOf: 'AJX' },
  { id: 'AC_MUN', label: 'Вихованець Манчестер Юнайтед', short: 'Академія МЮ', clubQid: 'Q18656', imageOf: 'MUN' },
  { id: 'AC_DYN', label: 'Вихованець Динамо Київ', short: 'Академія Динамо', clubQid: 'Q179075', imageOf: 'DYN' },
  { id: 'AC_BEN', label: 'Вихованець Бенфіки', short: 'Академія Бенфіки', clubQid: 'Q131499', imageOf: 'BEN' },
  { id: 'AC_SCP', label: 'Вихованець Спортінга', short: 'Академія Спортінга', clubQid: 'Q75729', image: 'Sporting CP' },
  { id: 'AC_OL', label: 'Вихованець Ліона', short: 'Академія Ліона', clubQid: 'Q704', image: 'Olympique Lyonnais' },
  { id: 'AC_BAY', label: 'Вихованець Баварії', short: 'Академія Баварії', clubQid: 'Q15789', imageOf: 'BAY' },
].map((c) => ({ ...c, type: 'academy', level: 'fan', colors: ['#2f6f4f', '#123322'], icon: '🎓' }));

// Віддав зірці гольову передачу (assists.json, Transfermarkt — матчі приблизно з 2012/13); фото — фото зірки (server/data/derived-tags.js)
const partners = [
  { id: 'AS_MES', partnerOf: 'lionel-messi', label: 'Асистував Мессі (з 2012)', short: 'Асистував Мессі', en: 'Assisted Messi (since 2012)', enShort: 'Assisted Messi' },
  { id: 'AS_CR7', partnerOf: 'cristiano-ronaldo', label: 'Асистував Роналду (з 2012)', short: 'Асистував Роналду', en: 'Assisted Ronaldo (since 2012)', enShort: 'Assisted Ronaldo' },
  { id: 'AS_LEW', partnerOf: 'robert-lewandowski', label: 'Асистував Левандовському (з 2012)', short: 'Асистував Левандовському', en: 'Assisted Lewandowski (since 2012)', enShort: 'Assisted Lewandowski' },
  { id: 'AS_BNZ', partnerOf: 'karim-benzema', label: 'Асистував Бензема (з 2012)', short: 'Асистував Бензема', en: 'Assisted Benzema (since 2012)', enShort: 'Assisted Benzema' },
  { id: 'AS_SUA', partnerOf: 'luis-suarez-q26517', label: 'Асистував Суаресу (з 2012)', short: 'Асистував Суаресу', en: 'Assisted Suárez (since 2012)', enShort: 'Assisted Suárez' },
  { id: 'AS_MBA', partnerOf: 'kylian-mbappe', label: 'Асистував Мбаппе (з 2012)', short: 'Асистував Мбаппе', en: 'Assisted Mbappé (since 2012)', enShort: 'Assisted Mbappé' },
  { id: 'AS_SAL', partnerOf: 'mohamed-salah', label: 'Асистував Салаху (з 2012)', short: 'Асистував Салаху', en: 'Assisted Salah (since 2012)', enShort: 'Assisted Salah' },
  { id: 'AS_KAN', partnerOf: 'harry-kane', label: 'Асистував Кейну (з 2012)', short: 'Асистував Кейну', en: 'Assisted Kane (since 2012)', enShort: 'Assisted Kane' },
  { id: 'AS_HAA', partnerOf: 'erling-haaland', label: 'Асистував Голанду (з 2012)', short: 'Асистував Голанду', en: 'Assisted Haaland (since 2012)', enShort: 'Assisted Haaland' },
].map((c) => ({ ...c, type: 'partner', level: ['AS_MES', 'AS_CR7'].includes(c.id) ? 'fan' : 'hard', colors: ['#e0663a', '#5c2210'], icon: '🅰️' }));

const positions = [
  { id: 'GK', label: 'Воротар', positionQid: 'Q201330', icon: '🧤' },
  { id: 'DF', label: 'Захисник', positionQid: 'Q336286', icon: '🛡️' },
  { id: 'MF', label: 'Півзахисник', positionQid: 'Q193592', icon: '🎽' },
  { id: 'FW', label: 'Нападник', positionQid: 'Q280658', icon: '⚡' },
].map((c) => ({ ...c, type: 'position', colors: ['#9aa7ff', '#3a4699'] }));

// Англійська версія (сайт двомовний): назва й коротка назва. label/short лишаються українськими рядками —
// для англійської пари збирає той, хто показує (crossroads/room.js → T(label, en)).
const EN = {
  RMA: ['Real Madrid'], BAR: ['Barcelona'], ATM: ['Atlético Madrid', 'Atlético'], SEV: ['Sevilla'], VAL: ['Valencia'],
  MUN: ['Manchester United', 'Man United'], LIV: ['Liverpool'], CHE: ['Chelsea'], ARS: ['Arsenal'], MCI: ['Manchester City', 'Man City'],
  TOT: ['Tottenham'], NEW: ['Newcastle'], AVL: ['Aston Villa'], JUV: ['Juventus'], MIL: ['AC Milan'], INT: ['Inter'],
  NAP: ['Napoli'], ROM: ['Roma'], LAZ: ['Lazio'], PAR: ['Parma'], BAY: ['Bayern Munich', 'Bayern'], BVB: ['Borussia Dortmund', 'Dortmund'],
  PSG: ['PSG'], AJX: ['Ajax'], BEN: ['Benfica'], FCP: ['Porto'], DYN: ['Dynamo Kyiv'], SHA: ['Shakhtar Donetsk', 'Shakhtar'],
  MET: ['Metalist Kharkiv', 'Metalist'], DNI: ['Dnipro'],
  ESP: ['Spain'], FRA: ['France'], BRA: ['Brazil'], ARG: ['Argentina'], ENG: ['England'], GER: ['Germany'], ITA: ['Italy'],
  POR: ['Portugal'], NED: ['Netherlands'], BEL: ['Belgium'], CRO: ['Croatia'], URU: ['Uruguay'], UKR: ['Ukraine'],
  L_EPL: ['Played in the Premier League', 'Premier League'], L_SA: ['Played in Serie A', 'Serie A'], L_LL: ['Played in La Liga', 'La Liga'],
  L_BL: ['Played in the Bundesliga', 'Bundesliga'], L_L1: ['Played in Ligue 1', 'Ligue 1'], L_MLS: ['Played in MLS (USA)', 'Played in MLS'],
  L_CSL: ['Played in the Chinese Super League', 'Played in China'], L_UAE: ['Played in the UAE Pro League', 'Played in the UAE'],
  BALLON: ["Ballon d'Or"], WC: ['World Cup winner'], UCL: ['Champions League winner', 'Won the UCL'], EURO: ['European Championship winner', 'Euro winner'],
  COPA: ['Copa América winner', 'Copa América'], UEL: ['Europa League / UEFA Cup winner', 'Won the UEL'], BOOT: ['Golden Shoe'],
  APL: ['Premier League champion'], CH_IT: ['Italian champion'], CH_ES: ['Spanish champion'], CH_DE: ['German champion'],
  TS_EPL: ['Premier League season top scorer', 'PL top scorer'], TS_SA: ['Serie A season top scorer', 'Serie A top scorer'],
  TS_LL: ['La Liga season top scorer', 'La Liga top scorer'], TS_BL: ['Bundesliga season top scorer', 'Bundesliga top scorer'],
  TS_L1: ['Ligue 1 season top scorer', 'Ligue 1 top scorer'], GBOY: ['Golden Boy'], W11: ['FIFPRO World 11'],
  G300: ['300+ career goals', '300+ goals'], G50N: ['50+ international goals'], CAPS100: ['100+ international caps'],
  A100: ['100+ assists'], T100: ['€100m+ transfer', 'Transfer €100m+'], T80: ['€80m+ transfer', 'Transfer €80m+'],
  UCL30: ['30+ Champions League goals', '30+ UCL goals'], JOURNEY: ['Journeyman: 10+ clubs', 'Journeyman 10+ clubs'],
  H190: ['Height 190+ cm'], H170: ['Height up to 170 cm'],
  BDO3: ["Ballon d'Or top 3"], BDO10: ["Ballon d'Or top 10"],
  CO_GUA: ['Played under Guardiola'], CO_FER: ['Played under Ferguson'], CO_MOU: ['Played under Mourinho'], CO_ZID: ['Played under Zidane'],
  CO_KLO: ['Played under Klopp'], CO_ANC: ['Played under Ancelotti'], CO_WEN: ['Played under Wenger'],
  CO_LUE: ['Played under Luis Enrique', 'Under Luis Enrique'], CO_LOB: ['Played under Lobanovskyi', 'Under Lobanovskyi'],
  AC_BAR: ['Barcelona academy graduate', 'Barça academy'], AC_RMA: ['Real Madrid academy graduate', 'Real academy'],
  AC_AJX: ['Ajax academy graduate', 'Ajax academy'], AC_MUN: ['Man United academy graduate', 'Man United academy'],
  AC_DYN: ['Dynamo Kyiv academy graduate', 'Dynamo academy'], AC_BEN: ['Benfica academy graduate', 'Benfica academy'],
  AC_SCP: ['Sporting academy graduate', 'Sporting academy'], AC_OL: ['Lyon academy graduate', 'Lyon academy'],
  AC_BAY: ['Bayern academy graduate', 'Bayern academy'],
  GK: ['Goalkeeper'], DF: ['Defender'], MF: ['Midfielder'], FW: ['Forward'],
};

const categories = [...clubs, ...nations, ...leagues, ...awards, ...stats, ...coaches, ...academies, ...partners, ...positions];
for (const c of categories) [c.en, c.enShort] = EN[c.id] || [c.en || c.label, c.enShort];
const categoryById = new Map(categories.map((c) => [c.id, c]));

module.exports = { categories, categoryById };
