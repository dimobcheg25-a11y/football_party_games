// «Вгадай гравця»: профіль футболіста (збірна, позиція, рік, клуби, голи, трофеї) і порівняння спроби із загаданим.
// Кожна клітинка: green — збіг, yellow — близько / колись перетиналися, grey — мимо; arrow — у загаданого більше (up) чи менше (down).
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

const TROPHIES = [
  { id: 'BALLON', icon: '🥇', label: "Золотий м'яч" },
  { id: 'WC', icon: '🏆', label: 'Чемпіон світу' },
  { id: 'UCL', icon: '⭐', label: 'Ліга чемпіонів' },
  { id: 'EURO', icon: '🏅', label: 'Чемпіон Європи' },
  { id: 'COPA', icon: '🌎', label: 'Кубок Америки' },
  { id: 'UEL', icon: '🟠', label: 'Ліга Європи' },
];

const NOW = new Date().getFullYear();
const profiles = new Map();

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
    positions: ['GK', 'DF', 'MF', 'FW'].filter((t) => p.tags.has(t)),
    born: p.born || null,
    last: { t: last.t, ...team(last.t), current: last.e == null },
    country: shortCountry(team(last.t).country),
    countries: new Set(c.clubs.map((x) => shortCountry(team(x.t).country)).filter(Boolean)),
    clubs,
    goals: c.clubs.reduce((s, x) => s + (x.g || 0), 0),
    caps: c.nation?.a || 0,
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
function numberCell(guess, target, { green, yellow }) {
  const d = Math.abs(guess - target);
  const color = d === 0 || d <= Math.max(green[0], target * green[1]) ? 'green' : d <= Math.max(yellow[0], target * yellow[1]) ? 'yellow' : 'grey';
  return { color, arrow: guess === target ? null : target > guess ? 'up' : 'down' };
}

const COLUMNS = [
  { id: 'nation', label: 'Збірна' },
  { id: 'position', label: 'Позиція' },
  { id: 'born', label: 'Рік народження' },
  { id: 'last', label: 'Останній клуб' },
  { id: 'league', label: 'Чемпіонат' },
  { id: 'shared', label: 'Спільні клуби' },
  { id: 'goals', label: 'Голи в чемпіонатах' },
  { id: 'caps', label: 'Матчі за збірну' },
  { id: 'trophies', label: 'Трофеї' },
];

// Рядок клітинок для спроби g проти загаданого t (обидва — профілі).
function compare(g, t) {
  const cells = {};

  if (!g.nation) cells.nation = { text: 'не грав за збірну', color: t.nation ? 'grey' : 'green' };
  else {
    const same = t.nation && g.nation.name === t.nation.name;
    const near = t.nation && g.nation.conf && g.nation.conf === t.nation.conf;
    cells.nation = { text: g.nation.name, img: g.nation.img, color: same ? 'green' : near ? 'yellow' : 'grey', note: near && !same ? CONF_LABELS[g.nation.conf] : null };
  }

  const gp = g.positions, tp = new Set(t.positions);
  const samePos = gp.length === tp.size && gp.every((x) => tp.has(x));
  cells.position = {
    text: gp.length ? gp.map((x) => POSITIONS[x]).join(' / ') : '?',
    color: samePos ? 'green' : gp.some((x) => tp.has(x)) ? 'yellow' : 'grey',
  };

  if (g.born && t.born) {
    const d = Math.abs(g.born - t.born);
    cells.born = { text: String(g.born), color: d === 0 ? 'green' : d <= 2 ? 'yellow' : 'grey', arrow: d === 0 ? null : t.born > g.born ? 'up' : 'down' };
  } else cells.born = { text: g.born ? String(g.born) : '?', color: 'grey' };

  const playedThere = t.clubs.some((x) => x.t === g.last.t);
  cells.last = {
    text: g.last.name,
    img: g.last.img,
    color: g.last.t === t.last.t ? 'green' : playedThere ? 'yellow' : 'grey',
    note: g.last.t !== t.last.t && playedThere ? 'грав там' : g.last.current ? 'зараз' : 'завершив тут',
  };

  cells.league = {
    text: g.country || '?',
    color: g.country && g.country === t.country ? 'green' : g.country && t.countries.has(g.country) ? 'yellow' : 'grey',
    note: g.country && g.country !== t.country && t.countries.has(g.country) ? 'грав там' : null,
  };

  const shared = sharedClubs(g, t);
  cells.shared = {
    text: shared.length ? shared.map((x) => `${x.together ? '🤝 ' : ''}${x.name}`).join(', ') : 'немає',
    clubs: shared,
    color: shared.length ? 'yellow' : 'grey',
    note: shared.some((x) => x.together) ? 'грали разом' : null,
  };

  cells.goals = { text: String(g.goals), ...numberCell(g.goals, t.goals, { green: [3, 0.1], yellow: [15, 0.25] }) };
  cells.caps = { text: String(g.caps), ...numberCell(g.caps, t.caps, { green: [3, 0.1], yellow: [10, 0.3] }) };

  const tt = new Set(t.trophies);
  const sameTrophies = g.trophies.length === tt.size && g.trophies.every((x) => tt.has(x));
  cells.trophies = {
    text: g.trophies.length ? g.trophies.map((id) => TROPHIES.find((x) => x.id === id).icon).join(' ') : '—',
    title: g.trophies.map((id) => TROPHIES.find((x) => x.id === id).label).join(', '),
    color: sameTrophies ? 'green' : g.trophies.some((x) => tt.has(x)) ? 'yellow' : 'grey',
  };

  return COLUMNS.map((c) => ({ id: c.id, ...cells[c.id] }));
}

module.exports = { profileOf, compare, COLUMNS, TROPHIES };
