// Що загадується в «Тактичному ескізі»: 3 категорії з однаковою частотою — футболісти (poolFor, не складніше за «звичайний»),
// клуби (з бази: категорії-клуби + клуби, де грало ≥20 гравців рівня «звичайний»), футбольні терміни й трофеї (вручну, одна категорія:
// трофеїв замало на окрему — повторювались би). Стадіонів немає — їх нецікаво вгадувати.
// Збірних немає — прапор намалювати надто легко. Слово: { key, cat, uk, en, variants: [нормалізовані відповіді], img }.
// Відповідь приймається будь-якою мовою: назва, синоніми, для гравців — і прізвище.
const { normalize, categories } = require('../../data');
const { poolFor, careerOf, team, teams } = require('../path/careers');
const { leagueOf } = require('../guess/compare');
const { T } = require('../../core/i18n');

const CATS = {
  players: { icon: '⚽', label: T('Футболіст', 'Footballer') },
  clubs: { icon: '🛡️', label: T('Клуб', 'Club') },
  terms: { icon: '📖', label: T('Термін або трофей', 'Term or trophy') },
};

// Порівняння відповіді: без регістру, діакритики, апострофів; «фк»/«fc» на початку не важать.
const norm = (s) => normalize(String(s || '')).replace(/^(фк|fc|ac|afc) /, '');

// [укр., англ., ...синоніми]
const TERMS = [
  ['Пенальті', 'Penalty', 'пенальти', 'одинадцятиметровий', 'penalty kick'],
  ['Офсайд', 'Offside', 'поза грою', 'вне игры'],
  ['Кутовий', 'Corner', 'корнер', 'кутовий удар', 'corner kick'],
  ['Жовта картка', 'Yellow card', 'жовтяк', 'гірчичник', 'жовта'],
  ['Червона картка', 'Red card', 'вилучення', 'червона'],
  ['Штрафний удар', 'Free kick', 'штрафний', 'стандарт'],
  ['Стінка', 'Wall', 'стенка', 'стінка зі штрафного'],
  ['Воротар', 'Goalkeeper', 'голкіпер', 'кіпер', 'keeper', 'goalie'],
  ['Суддя', 'Referee', 'арбітр', 'рефері', 'ref'],
  ['Свисток', 'Whistle'],
  ['VAR', 'VAR', 'вар', 'відеоповтор', 'video assistant referee'],
  ['Хет-трик', 'Hat-trick', 'хеттрик', 'hattrick'],
  ['Автогол', 'Own goal'],
  ['Штанга', 'Post', 'стійка', 'goalpost', 'стовп'],
  ['Поперечина', 'Crossbar', 'перекладина'],
  ['Сітка', 'Net', 'сітка воріт'],
  ['Ворота', 'Goalposts', 'goal frame'],
  ['Гол', 'Goal', 'забитий мяч'],
  ['Мʼяч', 'Ball', 'мяч', 'football'],
  ['Бутси', 'Boots', 'football boots', 'cleats', 'бутсы'],
  ['Щитки', 'Shin guards', 'shin pads'],
  ['Капітанська пов’язка', 'Captain’s armband', 'повязка', 'armband', 'капітанська повязка'],
  ['Капітан', 'Captain'],
  ['Заміна', 'Substitution', 'sub'],
  ['Табло', 'Scoreboard'],
  ['Стадіон', 'Stadium', 'арена'],
  ['Трибуна', 'Stand', 'трибуни', 'stands'],
  ['Вболівальники', 'Fans', 'фанати', 'болільники', 'supporters'],
  ['Ультрас', 'Ultras'],
  ['Фаєр', 'Flare', 'файер', 'піротехніка', 'pyro'],
  ['Фанатський шарф', 'Scarf', 'шарф'],
  ['Кутовий прапорець', 'Corner flag', 'прапорець'],
  ['Бічний арбітр', 'Linesman', 'лайнсмен', 'боковий арбітр', 'assistant referee'],
  ['Тренер', 'Coach', 'manager', 'головний тренер'],
  ['Лава запасних', 'Bench', 'лавка', 'substitutes bench', 'запасні'],
  ['Роздягальня', 'Dressing room', 'роздягалка', 'locker room'],
  ['Тактична дошка', 'Tactics board', 'дошка', 'тактика'],
  ['Підкат', 'Slide tackle', 'tackle'],
  ['Навіс', 'Cross', 'центрування', 'подача'],
  ['Удар головою', 'Header', 'головою', 'гра головою'],
  ['Удар через себе', 'Bicycle kick', 'ножиці', 'через себе', 'overhead kick', 'бісіклета'],
  ['Паненка', 'Panenka'],
  ['Рабона', 'Rabona'],
  ['Пас', 'Pass', 'передача'],
  ['Дриблінг', 'Dribbling', 'дриблинг', 'dribble', 'обведення'],
  ['Фінт', 'Feint', 'skill move', 'trick'],
  ['Сейв', 'Save', 'рятувальний сейв'],
  ['Серія пенальті', 'Penalty shootout', 'пенальті серія', 'shootout', 'післяматчеві пенальті'],
  ['Додатковий час', 'Extra time', 'овертайм', 'overtime'],
  ['Компенсований час', 'Stoppage time', 'added time', 'injury time'],
  ['Перерва', 'Half-time', 'half time'],
  ['Нічия', 'Draw', 'tie'],
  ['Суха гра', 'Clean sheet', 'сухар', 'на нуль'],
  ['Дербі', 'Derby'],
  ['Фінал', 'Final'],
  ['Медаль', 'Medal'],
  ['Трансфер', 'Transfer'],
  ['Контракт', 'Contract'],
  ['Агент', 'Agent', 'футбольний агент'],
  ['Спрей арбітра', 'Vanishing spray', 'спрей', 'суддівський спрей'],
  ['Футболка', 'Shirt', 'jersey', 'майка', 'форма', 'kit'],
  ['Симуляція', 'Dive', 'пірнання', 'diving', 'simulation'],
  ['Травма', 'Injury'],
  ['Ноші', 'Stretcher', 'носилки'],
  ['Святкування гола', 'Goal celebration', 'celebration', 'святкування'],
  ['Сіууу', 'Siuuu', 'сіу', 'сиу', 'siu', 'сііі', 'siii'],
  ['Пресконференція', 'Press conference'],
  ['Коментатор', 'Commentator'],
  ['Квиток', 'Ticket'],
  ['Футбольне поле', 'Pitch', 'поле', 'газон', 'field'],
  ['Центральне коло', 'Centre circle', 'center circle'],
  ['Штрафний майданчик', 'Penalty area', 'штрафна', 'box', 'penalty box'],
  ['Точка пенальті', 'Penalty spot', 'одинадцятиметрова позначка'],
  ['Тренування', 'Training', 'practice'],
  ['Фішки', 'Cones', 'конуси'],
  ['Манішка', 'Bib', 'маніжка', 'training bib'],
  ['Автограф', 'Autograph'],
  ['Золотий гол', 'Golden goal'],
  ['Аут', 'Throw-in', 'вкидання', 'вкидання мʼяча', 'throw in'],
  ['Удар від воріт', 'Goal kick'],
  ['Контратака', 'Counterattack', 'контра', 'counter attack', 'counter'],
  ['Пресинг', 'Pressing', 'press'],
  ['Автобус', 'Parking the bus', 'поставити автобус', 'park the bus', 'bus'],
  ['Тікі-така', 'Tiki-taka', 'тікі така', 'tiki taka'],
  ['Удар у девʼятку', 'Top corner', 'девятка', 'в девятку', 'top bins'],
  ['Дубль', 'Brace'],
  ['Фол', 'Foul', 'порушення'],
  ['Удар пʼятою', 'Backheel', 'пяточка', 'пʼяткою'],
  ['Парашут', 'Chip shot', 'парашутик', 'chip', 'lob', 'черпачок'],
  ['Між ніг', 'Nutmeg', 'пробити між ніг', 'тунель', 'панна'],
  ['Нападник', 'Striker', 'форвард', 'forward', 'страйкер'],
  ['Захисник', 'Defender', 'бек'],
  ['Півзахисник', 'Midfielder', 'хавбек'],
  ['Вінгер', 'Winger', 'крайній півзахисник', 'фланговий'],
  ['Бомбардир', 'Top scorer', 'goalscorer', 'найкращий бомбардир'],
  ['Удар з льоту', 'Volley', 'воллей'],
  ['Турнірна таблиця', 'League table', 'таблиця', 'standings'],
  ['Жеребкування', 'Cup draw', 'жеребкування кубка'],
  ['Один на один', 'One-on-one', '1 на 1', 'вихід один на один', 'one on one'],
  ['Воротарські рукавички', 'Goalkeeper gloves', 'рукавички', 'рукавиці', 'gloves'],
  ['Гетри', 'Socks', 'getry'],
  ['Пляжний футбол', 'Beach soccer', 'beach football'],
  ['Футзал', 'Futsal', 'міні футбол'],
  ['Набивання мʼяча', 'Keepy-uppy', 'чеканка', 'чеканити', 'жонглювання', 'набивання', 'juggling', 'keepie uppie', 'keepy uppy'],
  ['Настільний футбол', 'Table football', 'кікер', 'foosball'],
  ['Милиці', 'Crutches'],
  ['Барабан', 'Drum', 'барабанщик'],
  ['Банер', 'Banner', 'транспарант', 'баннер'],
  ['Перформанс на трибунах', 'Tifo', 'перформанс', 'тіфо', 'хореографія'],
  ['Хвиля на трибунах', 'Stadium wave', 'хвиля', 'мексиканська хвиля', 'mexican wave', 'the wave'],
  ['Вувузела', 'Vuvuzela'],
  ['Талісман', 'Mascot'],
  ['Скаут', 'Scout'],
  ['Академія', 'Academy', 'футбольна академія'],
  ['Прожектори', 'Floodlights', 'прожектор'],
  ['Кубок', 'Cup', 'трофей', 'trophy'],
];

// Трофеї
const TROPHIES = [
  ['Кубок світу', 'World Cup', 'чемпіонат світу', 'чс', 'мундіаль', 'world cup trophy', 'кубок чемпіонату світу'],
  ['Ліга чемпіонів', 'Champions League', 'лч', 'кубок ліги чемпіонів', 'ucl', 'вухатий'],
  ['Ліга Європи', 'Europa League', 'лє', 'кубок уєфа', 'uefa cup'],
  ['Ліга конференцій', 'Conference League'],
  ['Кубок Європи', 'Euro', 'євро', 'чемпіонат європи', 'кубок анрі делоне', 'european championship'],
  ['Копа Америка', 'Copa América', 'кубок америки'],
  ['Золотий мʼяч', 'Ballon d’Or', 'балон дор', 'ballon dor', 'golden ball'],
  ['Золота бутса', 'Golden Boot', 'golden shoe'],
  ['Золота рукавичка', 'Golden Glove'],
  ['Премія Пушкаша', 'Puskás Award', 'пушкаш', 'puskas'],
  ['Суперкубок УЄФА', 'UEFA Super Cup', 'суперкубок'],
  ['Клубний чемпіонат світу', 'Club World Cup', 'клубний чс'],
  ['Кубок Англії', 'FA Cup'],
  ['Кубок України', 'Ukrainian Cup'],
  ['Олімпійські ігри', 'Olympics', 'олімпіада', 'олімпійська медаль', 'olympic games'],
  ['Кубок Лібертадорес', 'Copa Libertadores', 'лібертадорес', 'libertadores'],
  ['Кубок африканських націй', 'Africa Cup of Nations', 'afcon', 'кан'],
  ['Золотий хлопчик', 'Golden Boy'],
];

// Клуби: назва в базі → як показувати (uk, en) і синоніми. Решта — назва з бази і її англійський варіант.
const CLUB_FIX = {
  'Реал Мадрид': ['Реал Мадрид', 'Real Madrid', 'реал', 'real', 'вершкові'],
  'Барселона': ['Барселона', 'Barcelona', 'барса', 'barca', 'барселона'],
  'Атлетіко': ['Атлетіко', 'Atlético Madrid', 'атлетико', 'atletico', 'атлетіко мадрид'],
  'Манчестер Юнайтед': ['Манчестер Юнайтед', 'Manchester United', 'мю', 'ман юнайтед', 'man utd', 'man united', 'юнайтед'],
  'Манчестер Сіті': ['Манчестер Сіті', 'Manchester City', 'сіті', 'ман сіті', 'man city', 'city'],
  'Тоттенгем': ['Тоттенгем', 'Tottenham Hotspur', 'тоттенхем', 'spurs', 'шпори', 'tottenham'],
  'Ювентус': ['Ювентус', 'Juventus', 'юве', 'juve', 'стара синьйора'],
  'Мілан': ['Мілан', 'AC Milan', 'milan'],
  'Інтер': ['Інтер', 'Inter Milan', 'inter', 'інтернаціонале', 'internazionale'],
  'Баварія': ['Баварія', 'Bayern Munich', 'бавария', 'bayern', 'баєрн'],
  'Боруссія Д': ['Боруссія Дортмунд', 'Borussia Dortmund', 'боруссія', 'дортмунд', 'bvb', 'dortmund', 'боруссія д'],
  'ПСЖ': ['ПСЖ', 'Paris Saint-Germain', 'psg', 'парі сен жермен', 'парі'],
  'Аякс': ['Аякс', 'Ajax', 'аякс амстердам'],
  'Динамо Київ': ['Динамо Київ', 'Dynamo Kyiv', 'динамо', 'dynamo', 'динамо киев'],
  'Шахтар': ['Шахтар', 'Shakhtar Donetsk', 'шахтер', 'shakhtar', 'шахтар донецьк'],
  'Металіст Харків': ['Металіст', 'Metalist Kharkiv', 'metalist', 'металіст харків'],
  'Олімпік Марсель': ['Марсель', 'Marseille', 'олімпік марсель', 'olympique de marseille', 'om'],
  'Олімпік': ['Ліон', 'Lyon', 'олімпік ліон', 'olympique lyonnais', 'ol'],
  'Баєр 04': ['Баєр Леверкузен', 'Bayer Leverkusen', 'баєр', 'леверкузен', 'bayer', 'leverkusen'],
  'Бешикташ': ['Бешикташ', 'Beşiktaş', 'besiktas'],
  'Вест Гем Юнайтед': ['Вест Гем', 'West Ham United', 'вест хем', 'west ham'],
  'ПСВ Ейндговен': ['ПСВ', 'PSV Eindhoven', 'psv', 'ейндговен'],
  'Парма': ['Парма', 'Parma'],
  'Сан-Паулу': ['Сан-Паулу', 'São Paulo', 'sao paulo'],
  'Спортінг': ['Спортінг', 'Sporting CP', 'sporting', 'спортінг лісабон'],
  'Аталанта': ['Аталанта', 'Atalanta'],
  'Фламенго': ['Фламенго', 'Flamengo'],
  'Рівер Плейт': ['Рівер Плейт', 'River Plate', 'рівер'],
  'Ньюкасл': ['Ньюкасл', 'Newcastle United', 'newcastle', 'сороки'],
  'Лестер Сіті': ['Лестер', 'Leicester City', 'leicester'],
};

// Рівень «Легкий» — без цих (рідше вживані або важкі для малюнка); клуби — лише клуби-категорії бази.
const HARD = new Set([
  'Рабона', 'Золотий гол', 'Перформанс на трибунах', 'Вувузела', 'Скаут', 'Академія', 'Тікі-така', 'Пресинг', 'Контратака',
  'Компенсований час', 'Додатковий час', 'Удар від воріт', 'Жеребкування', 'Турнірна таблиця', 'Агент', 'Контракт', 'Трансфер',
  'Дубль', 'Бомбардир', 'Симуляція', 'Спрей арбітра', 'Паненка', 'Автобус', 'Суха гра', 'Дербі', 'Удар пʼятою', 'Парашут',
  'Між ніг', 'Удар з льоту', 'Півзахисник', 'Вінгер', 'Пресконференція', 'Коментатор', 'Футзал', 'Пляжний футбол', 'Сіууу',
  'Ліга конференцій', 'Золота рукавичка', 'Премія Пушкаша', 'Суперкубок УЄФА', 'Клубний чемпіонат світу', 'Кубок Англії',
  'Кубок Лібертадорес', 'Кубок африканських націй', 'Золотий хлопчик',
]);

function words(base) {
  return [...new Set(base.map(norm).filter(Boolean))];
}

const termWords = TERMS.map(([uk, en, ...alt], i) => ({ key: `t${i}`, cat: 'terms', uk, en, variants: words([uk, en, ...alt]), img: null, easy: !HARD.has(uk) }));
const trophyWords = TROPHIES.map(([uk, en, ...alt], i) => ({ key: `s${i}`, cat: 'terms', uk, en, variants: words([uk, en, ...alt]), img: null, easy: !HARD.has(uk) }));

// Клуби: усі клуби-категорії + клуби, де грало ≥ 20 гравців рівня «звичайний»; без ліг росії й білорусі.
const clubWords = (() => {
  const count = new Map();
  for (const p of poolFor('all', 'normal')) for (const q of new Set(careerOf(p).clubs.map((x) => x.t))) count.set(q, (count.get(q) || 0) + 1);
  const base = new Set(categories.filter((c) => c.type === 'club' && c.qid).map((c) => c.qid));
  const qids = new Set(base);
  for (const [q, n] of count) if (n >= 20) qids.add(q);
  const seen = new Set();
  const out = [];
  for (const q of qids) {
    const t = teams[q];
    if (!t || t.national || ['Росія', 'Білорусь'].includes(String(leagueOf(q)))) continue;
    const { name, nameEn, img } = team(q);
    if (seen.has(name)) continue;
    seen.add(name);
    const [uk, en, ...alt] = CLUB_FIX[name] || [name, nameEn];
    out.push({ key: `c${q}`, cat: 'clubs', uk, en, variants: words([uk, en, name, ...alt]), img, easy: base.has(q) });
  }
  return out;
})();

// Гравець: повне ім'я обома мовами, псевдоніми, і прізвище (останні слова імені, від 4 літер).
function playerWord(p) {
  const full = [p.uk, p.name, ...(p.aliases || [])].filter(Boolean).map(norm);
  const tails = [];
  for (const v of [norm(p.uk || ''), norm(p.name)]) {
    const parts = v.split(' ');
    for (let i = 1; i < parts.length; i++) {
      const tail = parts.slice(i).join(' ');
      if (tail.replace(/ /g, '').length >= 4) tails.push(tail);
    }
  }
  return { key: `p${p.id}`, cat: 'players', uk: p.uk || p.name, en: p.name, variants: words([...full, ...tails]), img: p.photo || null, id: p.id };
}
const playersFor = (difficulty) => poolFor('all', difficulty === 'easy' ? 'easy' : 'normal').map(playerWord);

// Колода на гру: «Легкий» — найвідоміші футболісти, клуби бази, прості терміни й головні трофеї; «Звичайний» — усе.
function decksFor(difficulty) {
  const easy = difficulty === 'easy';
  const pick = (list) => (easy ? list.filter((w) => w.easy) : list);
  return { players: playersFor(difficulty), clubs: pick(clubWords), terms: pick([...termWords, ...trophyWords]) };
}

// Словник для підказок при введенні відповіді: усі слова рівня «Звичайний» (він містить і «Легкий»).
const dictionary = [...playersFor('normal'), ...clubWords, ...termWords, ...trophyWords]
  .map((w) => ({ c: w.cat, t: T(w.uk, w.en), v: w.variants }));

module.exports = { CATS, TERMS, TROPHIES, termWords, trophyWords, clubWords, playersFor, decksFor, dictionary, norm };
