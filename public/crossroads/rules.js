// Описи полів, складностей і гравців + тексти правил (для головної і для вікна «?» у грі). Дві мови — I18n.L(укр, англ).
window.Rules = (() => {
  const { L } = window.I18n;
  const SYMBOLS = ['✕', '◯', '△', '□'];
  const COLOR_NAMES = L(['синій', 'рожевий', 'бурштиновий', 'фіолетовий'], ['blue', 'pink', 'amber', 'purple']);

  // Узгоджено з server/boards.js
  const BOARDS = {
    classic: {
      size: 3, win: 3, scoring: 'line', maxPlayers: 2,
      title: L('Класика', 'Classic'), sub: L('3×3 · 3 в ряд', '3×3 · 3 in a row'),
      short: L('Збери 3 в ряд. Тільки вдвох.', 'Get 3 in a row. Two players only.'),
      sample: [0, 4, 8],
    },
    five: {
      size: 5, win: 4, scoring: 'line', maxPlayers: 4,
      title: L('Велике поле', 'Big board'), sub: L('5×5 · 4 в ряд', '5×5 · 4 in a row'),
      short: L('Збери 4 в ряд. Більше місця, щоб обійти блок.', 'Get 4 in a row. More room to get around a block.'),
      sample: [5, 6, 7, 8],
    },
    six: {
      size: 6, win: 4, scoring: 'line', maxPlayers: 4,
      title: L('Арена', 'Arena'), sub: L('6×6 · 4 в ряд', '6×6 · 4 in a row'),
      short: L('Збери 4 в ряд на найбільшому полі.', 'Get 4 in a row on the biggest board.'),
      sample: [7, 14, 21, 28],
    },
    lines: {
      size: 6, win: 3, scoring: 'points', maxPlayers: 4,
      title: L('Збір ліній', 'Line hunt'), sub: L('6×6 · очки за трійки', '6×6 · points for threes'),
      short: L('Граємо, доки є вільні клітинки. Кожна трійка в ряд — очко.', 'Play while there are free cells. Every three in a row is a point.'),
      sample: [12, 13, 14, 15],
    },
  };

  const MODES = {
    easy: {
      label: L('Легкий', 'Easy'), dot: 'easy',
      short: L('Топ-клуби й зірки, багато варіантів', 'Top clubs and stars, lots of answers'),
      rule: L('15 топ-клубів, 9 топових збірних, топ-5 ліг (грав в АПЛ, Серії А, Ла Лізі, Бундеслізі, Лізі 1), Кубок світу, Ліга чемпіонів, Євро, Золотий м\'яч і позиції. У кожній клітинці щонайменше 10 правильних відповідей.',
        '15 top clubs, 9 top national teams, the big five leagues (played in the Premier League, Serie A, La Liga, Bundesliga, Ligue 1), World Cup, Champions League, Euros, Ballon d\'Or and positions. Every cell has at least 10 correct answers.'),
    },
    normal: {
      label: L('Звичайний', 'Normal'), dot: 'normal',
      short: L('Плюс Україна, чемпіони ліг, рекорди', 'Plus Ukraine, league champions, records'),
      rule: L('Додаються Динамо, Шахтар, Лаціо, Парма, Ньюкасл, Астон Вілла, збірна України, чемпіони АПЛ, Італії, Іспанії й Німеччини, 300+ голів, 50+ голів і 100+ матчів за збірну. У кожній клітинці щонайменше 6 відповідей.',
        'Adds Dynamo Kyiv, Shakhtar, Lazio, Parma, Newcastle, Aston Villa, Ukraine, Premier League, Italian, Spanish and German champions, 300+ goals, 50+ international goals and 100+ caps. Every cell has at least 6 answers.'),
    },
    fan: {
      label: L('Фанат', 'Fan'), dot: 'fan',
      short: L('Тренери, академії, бомбардири, трансфери', 'Managers, academies, top scorers, transfers'),
      rule: L('Усе зі звичайного, плюс «грав у тренера» (Гвардіола, Фергюсон, Моурінью, Зідан, Клопп, Анчелотті, Венгер, Луїс Енріке, Лобановський), вихованці академій (Барселона, Реал, Аякс, МЮ, Динамо, Бенфіка, Спортінг, Ліон, Баварія), найкращі бомбардири сезону АПЛ, Серії А, Ла Ліги, Бундесліги й Ліги 1 (хоч раз забив у лізі за сезон більше за всіх), Golden Boy (кращий молодий гравець Європи), трансфер за 100+ млн, ліги МЛС, Китаю й ОАЕ. У кожній клітинці щонайменше 4 відповіді.',
        'Everything from Normal, plus "played under" a manager (Guardiola, Ferguson, Mourinho, Zidane, Klopp, Ancelotti, Wenger, Luis Enrique, Lobanovskyi), academy graduates (Barcelona, Real Madrid, Ajax, Man United, Dynamo Kyiv, Benfica, Sporting, Lyon, Bayern), Premier League, Serie A, La Liga, Bundesliga and Ligue 1 top scorers (finished a league season as top scorer at least once), Golden Boy (best young player in Europe), a €100m+ transfer, MLS, Chinese and UAE leagues. Every cell has at least 4 answers.'),
    },
    mix: {
      label: L('Мікс', 'Mix'), dot: 'mix',
      short: L('Усі категорії разом', 'All categories together'),
      rule: L('Усі категорії гри разом — від Реала й Кубка світу до академії Ліона й Про-ліги ОАЕ — і без обмежень на «очевидні» відповіді. Найрізноманітніший режим. У кожній клітинці щонайменше 4 відповіді.',
        'Every category in the game — from Real Madrid and the World Cup to the Lyon academy and the UAE Pro League — with no limits on "obvious" answers. The most varied mode. Every cell has at least 4 answers.'),
    },
    hard: {
      label: L('Складний', 'Hard'), dot: 'hard',
      short: L('Незвичні клуби, мало очевидних відповідей', 'Unusual clubs, few obvious answers'),
      rule: L('Додаються Аякс, Порту, Бенфіка, Севілья, Валенсія, Наполі, Рома, Металіст, Дніпро, Бельгія, Хорватія, Уругвай, Кубок Америки, Ліга Європи, Золота бутса і 100+ передач. Більшість категорій незвичні, у клітинці 3–15 відповідей і майже немає очевидних зірок.',
        'Adds Ajax, Porto, Benfica, Sevilla, Valencia, Napoli, Roma, Metalist, Dnipro, Belgium, Croatia, Uruguay, Copa América, Europa League, Golden Shoe and 100+ assists. Most categories are unusual, each cell has 3–15 answers and hardly any obvious stars.'),
    },
  };

  function winRule(b) {
    if (b.scoring === 'points') {
      return L(`Гра триває, доки на полі є вільні клітинки, які ще можна заповнити. Кожні ${b.win} твої клітинки поспіль — по горизонталі, вертикалі чи діагоналі — дають 1 очко. Лінії можуть перетинатися: 4 поспіль — це 2 очки, 5 поспіль — 3. Перемагає той, у кого більше очок.`,
        `The game goes on while there are free cells that can still be filled. Every ${b.win} of your cells in a row — horizontally, vertically or diagonally — score 1 point. Lines can overlap: 4 in a row is 2 points, 5 in a row is 3. Most points wins.`);
    }
    return L(`Перемагає той, хто першим займе ${b.win} клітинки поспіль — по горизонталі, вертикалі чи діагоналі.`,
      `The first to claim ${b.win} cells in a row — horizontally, vertically or diagonally — wins.`);
  }

  const COMMON = L([
    'Над стовпцями й біля рядків — клуби, збірні, трофеї, рекорди або позиції.',
    'У свій хід обери клітинку й напиши футболіста, який підходить під <b>обидві</b> умови — рядка і стовпця.',
    'Правильно — клітинка твоя. Помилився — хід переходить далі, а гра покаже, яку умову не виконано.',
    'Не встиг за відведений час — хід переходить далі.',
    'Кожного футболіста можна використати лише <b>один раз</b> за гру. Повтор не зараховується, але й хід не втрачається.',
    'Числа в порожній клітинці, наприклад «6 / 14», означають: підходять 6 відомих гравців, а всього гра зарахує 14 (серед них є маловідомі й гравці давніх часів). Коли когось із них ставлять в іншу клітинку, числа зменшуються.',
    'Після гри відповіді на незайняті клітинки не показуються — щоб сітки лишалися цікавими.',
    'Позиції — за основною роллю гравця. Вінгери (Ямаль, Неймар, Сака, Куарежма) рахуються і нападниками, і півзахисниками.',
  ], [
    'Above the columns and next to the rows are clubs, national teams, trophies, records or positions.',
    'On your turn pick a cell and name a footballer who fits <b>both</b> conditions — the row and the column.',
    'Right — the cell is yours. Wrong — the turn passes on, and the game shows which condition wasn\'t met.',
    'Run out of time — the turn passes on.',
    'Each footballer can be used only <b>once</b> per game. A repeat doesn\'t count, but you don\'t lose your turn either.',
    'Numbers in an empty cell, like "6 / 14", mean 6 well-known players fit, and the game accepts 14 in total (including lesser-known and old-time players). When one of them is placed in another cell, the numbers go down.',
    'After the game, answers for empty cells aren\'t shown — so the grids stay interesting.',
    'Positions follow a player\'s main role. Wingers (Yamal, Neymar, Saka, Quaresma) count as both forwards and midfielders.',
  ]);

  function playersRule(capacity) {
    if (capacity <= 2) return L('Гравці ходять по черзі. Хто ходить першим — вирішує жереб на початку кожної партії.', 'Players take turns. Who goes first is decided by a draw at the start of each game.');
    return L(`Гравці ходять по колу, черговість на кожну партію визначає жереб (видно в картках гравців: «хід 1», «хід 2»…). Кожен має свій колір і символ (${SYMBOLS.slice(0, capacity).join(' ')}). Якщо хтось здається або виходить, гра триває без нього, а його клітинки лишаються на полі. Нічия — лише коли погодились усі.`,
      `Players go round in turn; the order for each game is drawn (shown on the player cards: "turn 1", "turn 2"…). Everyone has their own colour and symbol (${SYMBOLS.slice(0, capacity).join(' ')}). If someone resigns or leaves, the game goes on without them and their cells stay on the board. A draw only happens when everyone agrees.`);
  }

  const ACTIONS = L([
    '<b>Пропустити хід</b> — якщо не знаєш відповіді.',
    '<b>Нічия</b> — інші бачать твою пропозицію, а нічия настає, коли погодяться всі. У «Зборі ліній» замість нічиєї — <b>Завершити гру</b>: рахуються очки на цей момент.',
    '<b>Здатися</b> — удвох це перемога суперника, утрьох і вчотирьох — ти вибуваєш із партії.',
    'Якщо хтось втратив з\'єднання (закрив вкладку, пропав інтернет), гра триває. Виключити його можна, лише якщо він не в мережі щонайменше 2 хвилини <b>і</b> гра через нього стоїть: зараз його хід або він уже пропустив 2 ходи поспіль.',
    '<b>Реванш</b> починається, коли погодились усі. Черговість ходів у ньому — знову за жеребом.',
  ], [
    '<b>Skip turn</b> — if you don\'t know the answer.',
    '<b>Draw</b> — the others see the offer; it takes effect when everyone agrees. In "Line hunt" there\'s <b>End game</b> instead of a draw: points are counted as they stand.',
    '<b>Resign</b> — with two players it\'s a win for your opponent; with three or four you drop out of the game.',
    'If someone loses connection (closed the tab, lost internet), the game goes on. They can be removed only after being offline for at least 2 minutes <b>and</b> holding up the game — it\'s their turn or they\'ve missed 2 turns in a row.',
    '<b>Rematch</b> starts when everyone agrees. The turn order is drawn again.',
  ]);

  const li = (arr) => arr.map((x) => `<li>${x}</li>`).join('');

  // Правила конкретної кімнати
  function forRoom({ board, mode, capacity, turnSeconds }) {
    const b = BOARDS[board] || BOARDS.classic;
    const m = MODES[mode] || MODES.normal;
    const timer = turnSeconds ? L(`${turnSeconds} секунд на хід.`, `${turnSeconds} seconds per turn.`) : L('Час на хід не обмежено.', 'No time limit per turn.');
    return `
      <div class="rules-summary">
        <div><span>${L('Поле', 'Board')}</span><b>${b.title}</b><small>${b.sub}</small></div>
        <div><span>${L('Гравців', 'Players')}</span><b>${capacity}</b><small>${SYMBOLS.slice(0, capacity).join(' ')}</small></div>
        <div><span>${L('Складність', 'Difficulty')}</span><b>${m.label}</b><small>${timer}</small></div>
      </div>
      <h4>${L('Як виграти', 'How to win')}</h4>
      <p>${winRule(b)}</p>
      <h4>${L('Як ходити', 'How to play')}</h4>
      <ul>${li(COMMON)}</ul>
      <h4>${L('Гравці', 'Players')}</h4>
      <p>${playersRule(capacity)}</p>
      <h4>${L('Категорії', 'Categories')} · ${m.label}</h4>
      <p>${m.rule}</p>
      <h4>${L('Кнопки', 'Buttons')}</h4>
      <ul>${li(ACTIONS)}</ul>`;
  }

  // Загальні правила на головній
  function overview() {
    const boards = Object.values(BOARDS)
      .map((b) => `<li><b>${b.title} (${b.sub})</b>, ${b.maxPlayers === 2 ? L('вдвох', 'two players') : L('2–4 гравці', '2–4 players')}. ${winRule(b)}</li>`)
      .join('');
    const modes = Object.values(MODES).map((m) => `<li><b>${m.label}.</b> ${m.rule}</li>`).join('');
    return `
      <details>
        <summary>${L('Як грати', 'How to play')}</summary>
        <div class="rules-body">
          <h4>${L('Основне', 'Basics')}</h4>
          <ul>${li(COMMON)}</ul>
          <h4>${L('Поля', 'Boards')}</h4>
          <ul>${boards}</ul>
          <h4>${L('Складність', 'Difficulty')}</h4>
          <ul>${modes}</ul>
          <h4>${L('Утрьох і вчотирьох', 'Three or four players')}</h4>
          <p>${playersRule(4)}</p>
          <h4>${L('Кнопки', 'Buttons')}</h4>
          <ul>${li(ACTIONS)}</ul>
        </div>
      </details>`;
  }

  return { SYMBOLS, COLOR_NAMES, BOARDS, MODES, forRoom, overview, winRule };
})();
