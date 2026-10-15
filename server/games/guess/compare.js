// «Вгадай гравця»: профіль футболіста (збірна, позиція, рік, клуби, голи, вартість, трофеї) і порівняння спроби із загаданим.
// Кожна клітинка: green — збіг, yellow — близько / колись перетиналися, grey — мимо; note — пояснення словами (чому жовта, у кого більше).
const { careerOf, team, teams, POSITIONS } = require('../path/careers');

// Британські збірні у Wikidata — окремі команди, але країна в усіх «Сполучене Королівство».
const NATION_NAMES = { Q47762: 'Англія', Q34044: 'Шотландія', Q180857: 'Уельс', Q190978: 'Північна Ірландія' };
const NATION_FLAGS = {
  Q47762: 'Flag of England.svg',
  Q34044: 'Flag of Scotland.svg',
  Q180857: 'Flag of Wales.svg',
  Q190978: 'Ulster banner.svg',
};
const SHORT = {
  'Сполучене Королівство': 'Британія',
  'Сполучені Штати Америки': 'США',
  'Союз Радянських Соціалістичних Республік': 'СРСР',
  'Союзна Республіка Югославія': 'Югославія',
  'Китайська Народна Республіка': 'Китай',
  'Південно-Африканська Республіка': 'ПАР',
  'Демократична Республіка Конго': 'ДР Конго',
  'Центральноафриканська Республіка': 'ЦАР',
};
const shortCountry = (name) => (name ? SHORT[name] || name : null);

// Чемпіонат клубу. У Wikidata всі британські клуби — «Сполучене Королівство», але чемпіонати різні:
// шотландські й північноірландські — окремо, решта (і валлійські Кардіфф, Свонсі, Рексем…) грають в англійській лізі.
const SCOTLAND = 'Q192597 Q19593 Q19597 Q219241 Q852753 Q192873 Q335483 Q187326 Q319136 Q180420 Q822722 Q202093 Q390256 Q210961 Q5328723 Q309059 Q268776 Q5019424 Q1046939';
const N_IRELAND = 'Q3997037 Q312360';
const GIBRALTAR = 'Q15732501 Q13423234';
const UK_LEAGUES = new Map([
  ...SCOTLAND.split(' ').map((q) => [q, 'Шотландія']),
  ...N_IRELAND.split(' ').map((q) => [q, 'Північна Ірландія']),
  ...GIBRALTAR.split(' ').map((q) => [q, 'Гібралтар']),
]);
function leagueOf(t) {
  const country = team(t).country;
  if (country === 'Сполучене Королівство') return UK_LEAGUES.get(t) || 'Англія';
  return shortCountry(country);
}

// Конфедерації — для «близько» у збірній (той самий континент).
const CONFEDERATIONS = {
  UEFA: 'Україна Англія Шотландія Уельс Північна_Ірландія Британія Італія Іспанія Франція Німеччина Нідерланди Португалія Хорватія Грузія Бельгія СРСР Сербія Румунія Польща Росія Білорусь Швеція Данія Туреччина Молдова Швейцарія Чехія Чехословаччина Албанія Югославія Вірменія Боснія_і_Герцеговина Ірландія Греція Північна_Македонія Норвегія Болгарія Литва Австрія Словенія Словаччина Угорщина Азербайджан Чорногорія Латвія Казахстан Ісландія Фінляндія Естонія Ізраїль Косово Кіпр Люксембург',
  CONMEBOL: 'Бразилія Аргентина Уругвай Колумбія Чилі Перу Парагвай Еквадор Болівія Венесуела',
  CONCACAF: 'США Мексика Коста-Рика Канада Гондурас Ямайка Тринідад_і_Тобаго Кюрасао Домініканська_Республіка',
  CAF: "Нігерія Кот-д'Івуар Сенегал Камерун Марокко Гана Алжир ДР_Конго Єгипет Малі ПАР Гвінея Того Габон Буркіна-Фасо Кабо-Верде Туніс Республіка_Конго Ліберія Бенін ЦАР Сьєрра-Леоне Нігер Гвінея-Бісау Зімбабве",
  AFC: 'Японія Південна_Корея Узбекистан Туркменістан Іран Таджикистан Киргизстан Таїланд Китай Австралія Саудівська_Аравія Катар ОАЕ',
  OFC: 'Нова_Зеландія',
};
const CONF_LABELS = { UEFA: 'Європа', CONMEBOL: 'Півд. Америка', CONCACAF: 'Півн. Америка', CAF: 'Африка', AFC: 'Азія', OFC: 'Океанія' };
const confOf = new Map();
for (const [conf, list] of Object.entries(CONFEDERATIONS)) for (const c of list.split(' ')) confOf.set(c.replace(/_/g, ' '), conf);

// Головні трофеї — текстом (значки без підпису незрозумілі).
const TROPHIES = [
  { id: 'BALLON', label: "Золотий м'яч" },
  { id: 'WC', label: 'Чемпіон світу' },
  { id: 'EURO', label: 'Чемпіон Європи' },
  { id: 'COPA', label: 'Кубок Америки' },
  { id: 'UCL', label: 'Ліга чемпіонів' },
  { id: 'UEL', label: 'Ліга Європи' },
];

// Основна позиція — з Transfermarkt (точніша за перелік у Wikidata); група — для «близько»: та сама лінія на полі.
const TM_POSITIONS = {
  Goalkeeper: ['Воротар', 'GK'],
  'Centre-Back': ['Центральний захисник', 'DEF'],
  'Left-Back': ['Лівий захисник', 'DEF'],
  'Right-Back': ['Правий захисник', 'DEF'],
  'Defensive Midfield': ['Опорний півзахисник', 'MID'],
  'Central Midfield': ['Центральний півзахисник', 'MID'],
  'Attacking Midfield': ['Атакувальний півзахисник', 'MID'],
  'Left Midfield': ['Лівий півзахисник', 'WING'],
  'Right Midfield': ['Правий півзахисник', 'WING'],
  'Left Winger': ['Лівий вінгер', 'WING'],
  'Right Winger': ['Правий вінгер', 'WING'],
  'Second Striker': ['Другий нападник', 'FWD'],
  'Centre-Forward': ['Центральний нападник', 'FWD'],
};
const GROUPS = { GK: 'воротар', DEF: 'захисник', MID: 'центр поля', WING: 'фланг', FWD: 'нападник' };
// Запасний варіант (немає в Transfermarkt — зазвичай ветерани): позиції з Wikidata.
const TAG_GROUPS = { GK: 'GK', DF: 'DEF', MF: 'MID', FW: 'FWD' };

let transfers = {};
try {
  transfers = require('../../data/transfers.json');
} catch {
  // трансфери ще не зібрані (npm run build-transfers) — без вартості й точних позицій
}

const NOW = new Date().getFullYear();
const profiles = new Map();

function positionOf(p) {
  const tm = TM_POSITIONS[transfers[p.id]?.pos];
  if (tm) return { label: tm[0], groups: [tm[1]] };
  const tags = ['GK', 'DF', 'MF', 'FW'].filter((t) => p.tags.has(t));
  return { label: tags.length ? tags.map((t) => POSITIONS[t]).join(' / ') : '?', groups: tags.map((t) => TAG_GROUPS[t]) };
}

function profileOf(p) {
  if (profiles.has(p.id)) return profiles.get(p.id);
  const c = careerOf(p);
  if (!c || !c.clubs.length) return null;
  let nation = null;
  if (c.nation) {
    const t = teams[c.nation.t] || {};
    const name = NATION_NAMES[c.nation.t] || shortCountry(t.country || t.name);
    const flag = NATION_FLAGS[c.nation.t];
    nation = {
      name,
      img: flag ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(flag)}?width=80` : t.img || null,
      conf: confOf.get(name) || null,
    };
  }
  const last = c.clubs[c.clubs.length - 1];
  const clubs = c.clubs.map((x) => ({ t: x.t, s: x.s ?? x.e ?? NOW, e: x.e ?? NOW, ...team(x.t) }));
  const profile = {
    nation,
    position: positionOf(p),
    born: p.born || null,
    last: { t: last.t, ...team(last.t), current: last.e == null },
    country: leagueOf(last.t),
    countries: new Set(c.clubs.map((x) => leagueOf(x.t)).filter(Boolean)),
    clubs,
    goals: c.clubs.reduce((s, x) => s + (x.g || 0), 0),
    caps: c.nation?.a || 0,
    natGoals: c.nation?.g || 0,
    value: transfers[p.id]?.maxValue || null,
    trophies: TROPHIES.filter((t) => p.tags.has(t.id)).map((t) => t.id),
  };
  profiles.set(p.id, profile);
  return profile;
}

// Клуби, де грали обоє; together — їхні роки в клубі перетинаються (грали разом).
function sharedClubs(a, b) {
  const out = new Map();
  for (const x of a.clubs) {
    for (const y of b.clubs) {
      if (x.t !== y.t) continue;
      const together = Math.max(x.s, y.s) < Math.min(x.e, y.e);
      const prev = out.get(x.t);
      out.set(x.t, { name: x.name, img: x.img, together: together || !!prev?.together });
    }
  }
  return [...out.values()];
}

// Близькість чисел: відносно загаданого, але не менше абсолютного порогу (щоб 0 і 2 гола були «близько»).
// Зелена — лише точний збіг; green (поріг «майже») — тільки для вартості, де точний збіг неможливий.
// note — словами, у кого більше (самі стрілки незрозумілі).
function numberCell(guess, target, { green, yellow }) {
  const d = Math.abs(guess - target);
  if (d === 0) return { color: 'green', note: 'точно' };
  const near = green && d <= Math.max(green[0], target * green[1]);
  const color = near ? 'green' : d <= Math.max(yellow[0], target * yellow[1]) ? 'yellow' : 'grey';
  const more = target > guess ? 'більше' : 'менше';
  return { color, arrow: target > guess ? 'up' : 'down', note: near ? `майже, у загаданого трохи ${more}` : `у загаданого ${more}` };
}

const money = (v) => (v >= 1e6 ? `€${Number((v / 1e6).toFixed(v < 1e7 ? 1 : 0))} млн` : `€${Math.round(v / 1e3)} тис.`);

const COLUMNS = [
  { id: 'nation', label: 'Збірна' },
  { id: 'position', label: 'Позиція' },
  { id: 'born', label: 'Рік народження' },
  { id: 'last', label: 'Останній клуб' },
  { id: 'league', label: 'Чемпіонат' },
  { id: 'goals', label: 'Голи в чемпіонатах' },
  { id: 'caps', label: 'Матчі за збірну' },
  { id: 'natGoals', label: 'Голи за збірну' },
  { id: 'value', label: 'Макс. вартість' },
  { id: 'trophies', label: 'Трофеї' },
  { id: 'shared', label: 'Спільні клуби' },
];

// Рядок клітинок для спроби g проти загаданого t (обидва — профілі).
function compare(g, t) {
  const cells = {};

  if (!g.nation) cells.nation = { text: 'не грав за збірну', color: t.nation ? 'grey' : 'green' };
  else {
    const same = t.nation && g.nation.name === t.nation.name;
    const near = t.nation && g.nation.conf && g.nation.conf === t.nation.conf;
    cells.nation = { text: g.nation.name, img: g.nation.img, color: same ? 'green' : near ? 'yellow' : 'grey', note: near && !same ? `теж ${CONF_LABELS[g.nation.conf]}` : null };
  }

  // зелена — та сама позиція; жовта — та сама лінія (обидва захисники, обидва на фланзі…), пояснюємо словами
  const gp = g.position, tp = t.position;
  const common = gp.groups.find((x) => tp.groups.includes(x));
  const samePos = gp.label === tp.label;
  cells.position = { text: gp.label, color: samePos ? 'green' : common ? 'yellow' : 'grey', note: !samePos && common ? `теж ${GROUPS[common]}` : null };

  if (g.born && t.born) {
    const d = Math.abs(g.born - t.born);
    cells.born = {
      text: String(g.born),
      color: d === 0 ? 'green' : d <= 2 ? 'yellow' : 'grey',
      note: d === 0 ? 'однолітки' : t.born > g.born ? 'загаданий молодший' : 'загаданий старший',
    };
  } else cells.born = { text: g.born ? String(g.born) : '?', color: 'grey' };

  const playedThere = t.clubs.some((x) => x.t === g.last.t);
  cells.last = {
    text: g.last.name,
    img: g.last.img,
    color: g.last.t === t.last.t ? 'green' : playedThere ? 'yellow' : 'grey',
    note: g.last.t !== t.last.t && playedThere ? 'загаданий грав тут' : g.last.current ? 'зараз' : 'завершив тут',
  };

  cells.league = {
    text: g.country || '?',
    color: g.country && g.country === t.country ? 'green' : g.country && t.countries.has(g.country) ? 'yellow' : 'grey',
    note: g.country && g.country !== t.country && t.countries.has(g.country) ? 'загаданий грав тут' : null,
  };

  cells.goals = { text: String(g.goals), ...numberCell(g.goals, t.goals, { yellow: [15, 0.25] }) };
  cells.caps = { text: String(g.caps), ...numberCell(g.caps, t.caps, { yellow: [10, 0.3] }) };
  cells.natGoals = { text: String(g.natGoals), ...numberCell(g.natGoals, t.natGoals, { yellow: [5, 0.3] }) };

  if (!g.value) cells.value = { text: '?', color: 'grey', note: 'немає даних' };
  else if (!t.value) cells.value = { text: money(g.value), color: 'grey', note: 'про загаданого немає даних' };
  else cells.value = { text: money(g.value), ...numberCell(g.value, t.value, { green: [1e6, 0.1], yellow: [3e6, 0.35] }) };

  // трофеї — списком; ті, що є й у загаданого, позначені (match)
  const tt = new Set(t.trophies);
  const sameTrophies = g.trophies.length === tt.size && g.trophies.every((x) => tt.has(x));
  const someTrophies = g.trophies.some((x) => tt.has(x));
  cells.trophies = {
    text: g.trophies.length ? '' : 'немає великих',
    items: g.trophies.map((id) => ({ label: TROPHIES.find((x) => x.id === id).label, match: tt.has(id) })),
    color: sameTrophies ? 'green' : someTrophies ? 'yellow' : 'grey',
    note: !sameTrophies && someTrophies ? '✓ — є і в загаданого' : null,
  };

  const shared = sharedClubs(g, t);
  cells.shared = {
    text: shared.length ? '' : 'немає',
    clubs: shared,
    color: shared.length ? 'yellow' : 'grey',
    note: shared.some((x) => x.together) ? '🤝 — грали разом' : null,
  };

  return COLUMNS.map((c) => ({ id: c.id, ...cells[c.id] }));
}

module.exports = { profileOf, compare, COLUMNS, TROPHIES, money };
