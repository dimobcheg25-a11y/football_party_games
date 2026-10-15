// «Вгадай гравця»: профіль футболіста (збірна, позиція, рік, клуби, голи, вартість, трофеї) і порівняння спроби із загаданим.
// Кожна клітинка: green — збіг, yellow — близько / колись перетиналися, grey — мимо; note — пояснення словами (чому жовта, у кого більше).
const { careerOf, team, teams, POSITIONS } = require('../path/careers');
const { T } = require('../../core/i18n');
const { countryEn, teamEn } = require('../../data/names-en');
const { honoursOf } = require('../../data/honours');

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
// Назва збірної: британські — окремо, довгі офіційні назви — коротко (СРСР, США…).
const nationName = (q) => NATION_NAMES[q] || shortCountry(teams[q]?.country || teams[q]?.name);

// Англійською — для показу (порівнюємо далі за українськими назвами). Короткі назви з SHORT, яких немає в names-en.
const SHORT_EN = { 'Британія': 'Great Britain', 'ЦАР': 'CAR' };
const placeEn = (uk) => SHORT_EN[uk] || countryEn(uk);
const placeT = (uk) => (uk ? T(uk, placeEn(uk)) : uk);
const clubT = (t) => T(team(t).name, teamEn(t, team(t)));

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
  if (country === 'Монако') return 'Франція'; // Монако грає в чемпіонаті Франції
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
const CONF_LABELS = {
  UEFA: T('Європа', 'Europe'), CONMEBOL: T('Півд. Америка', 'South America'), CONCACAF: T('Півн. Америка', 'North America'),
  CAF: T('Африка', 'Africa'), AFC: T('Азія', 'Asia'), OFC: T('Океанія', 'Oceania'),
};
const confOf = new Map();
for (const [conf, list] of Object.entries(CONFEDERATIONS)) for (const c of list.split(' ')) confOf.set(c.replace(/_/g, ' '), conf);

// Головні трофеї — текстом (значки без підпису незрозумілі).
const TROPHIES = [
  // h — ключ у honours.json: звідти кількість перемог («Ліга чемпіонів ×2»); Золотий м'яч — лише тег
  { id: 'BALLON', label: "Золотий м'яч", en: "Ballon d'Or" },
  { id: 'WC', label: 'Чемпіон світу', en: 'World Cup winner', h: 'wc' },
  { id: 'EURO', label: 'Чемпіон Європи', en: 'Euro winner', h: 'euro' },
  { id: 'COPA', label: 'Кубок Америки', en: 'Copa América', h: 'copa' },
  { id: 'UCL', label: 'Ліга чемпіонів', en: 'Champions League', h: 'ucl' },
  { id: 'UEL', label: 'Ліга Європи', en: 'Europa League', h: 'uel' },
];

// Основна позиція — з Transfermarkt (точніша за перелік у Wikidata); група — для «близько»: та сама лінія на полі.
const TM_POSITIONS = {
  Goalkeeper: ['Воротар', 'GK', 'Goalkeeper'],
  'Centre-Back': ['Центральний захисник', 'DEF', 'Centre-back'],
  'Left-Back': ['Лівий захисник', 'DEF', 'Left-back'],
  'Right-Back': ['Правий захисник', 'DEF', 'Right-back'],
  'Defensive Midfield': ['Опорний півзахисник', 'MID', 'Defensive midfielder'],
  'Central Midfield': ['Центральний півзахисник', 'MID', 'Central midfielder'],
  'Attacking Midfield': ['Атакувальний півзахисник', 'MID', 'Attacking midfielder'],
  'Left Midfield': ['Лівий півзахисник', 'WING', 'Left midfielder'],
  'Right Midfield': ['Правий півзахисник', 'WING', 'Right midfielder'],
  'Left Winger': ['Лівий вінгер', 'WING', 'Left winger'],
  'Right Winger': ['Правий вінгер', 'WING', 'Right winger'],
  'Second Striker': ['Другий нападник', 'FWD', 'Second striker'],
  'Centre-Forward': ['Центральний нападник', 'FWD', 'Centre-forward'],
};
const GROUPS = {
  GK: T('воротар', 'goalkeeper'), DEF: T('захисник', 'defender'), MID: T('центр поля', 'central midfield'),
  WING: T('фланг', 'wide player'), FWD: T('нападник', 'forward'),
};
const POSITIONS_EN = { GK: 'Goalkeeper', DF: 'Defender', MF: 'Midfielder', FW: 'Forward' };
// Запасний варіант (немає в Transfermarkt — зазвичай ветерани): позиції з Wikidata.
const TAG_GROUPS = { GK: 'GK', DF: 'DEF', MF: 'MID', FW: 'FWD' };

let transfers = {};
try {
  transfers = require('../../data/transfers.json');
} catch {
  // трансфери ще не зібрані (npm run build-transfers) — без вартості й точних позицій
}
let stats = null;
try {
  stats = require('../../data/stats.json');
} catch {
  // асисти ще не зібрані (npm run build-stats) — без клітинки асистів
}
// Асисти є лише з сезону 2012/13: клітинку показуємо, тільки якщо загаданий почав кар'єру з 2012-го (інакше число неповне).
const STATS_FROM = 2012;

const NOW = new Date().getFullYear();
const profiles = new Map();

function positionOf(p) {
  const tm = TM_POSITIONS[transfers[p.id]?.pos];
  if (tm) return { label: tm[0], en: tm[2], groups: [tm[1]] };
  const tags = ['GK', 'DF', 'MF', 'FW'].filter((t) => p.tags.has(t));
  return {
    label: tags.length ? tags.map((t) => POSITIONS[t]).join(' / ') : '?',
    en: tags.length ? tags.map((t) => POSITIONS_EN[t]).join(' / ') : '?',
    groups: tags.map((t) => TAG_GROUPS[t]),
  };
}

function profileOf(p) {
  if (profiles.has(p.id)) return profiles.get(p.id);
  const c = careerOf(p);
  if (!c || !c.clubs.length) return null;
  let nation = null;
  if (c.nation) {
    const t = teams[c.nation.t] || {};
    const name = nationName(c.nation.t);
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
    modern: (c.clubs[0].s ?? c.clubs[0].e ?? 0) >= STATS_FROM,
    assists: stats?.players?.[transfers[p.id]?.tm]?.t[1] ?? null,
    value: transfers[p.id]?.maxValue || null,
    // трофей є, якщо є тег або перемога в honours; кількість — з honours (якщо є)
    trophies: TROPHIES.filter((t) => p.tags.has(t.id) || (t.h && honoursOf(p)?.[t.h])).map((t) => t.id),
    trophyCount: Object.fromEntries(TROPHIES.filter((t) => t.h && honoursOf(p)?.[t.h] > 1).map((t) => [t.id, honoursOf(p)[t.h]])),
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
      out.set(x.t, { name: clubT(x.t), img: x.img, together: together || !!prev?.together });
    }
  }
  return [...out.values()];
}

// Близькість чисел: відносно загаданого, але не менше абсолютного порогу (щоб 0 і 2 гола були «близько»).
// Зелена — лише точний збіг; green (поріг «майже») — тільки для вартості, де точний збіг неможливий.
// note — словами, у кого більше (самі стрілки незрозумілі).
function numberCell(guess, target, { green, yellow }) {
  const d = Math.abs(guess - target);
  if (d === 0) return { color: 'green', note: T('точно', 'exact') };
  const near = green && d <= Math.max(green[0], target * green[1]);
  const color = near ? 'green' : d <= Math.max(yellow[0], target * yellow[1]) ? 'yellow' : 'grey';
  const up = target > guess;
  const more = up ? 'більше' : 'менше';
  const moreEn = up ? 'more' : 'less';
  return {
    color, arrow: up ? 'up' : 'down',
    note: near ? T(`майже, у загаданого трохи ${more}`, `close, mystery player has slightly ${moreEn}`) : T(`у загаданого ${more}`, `mystery player has ${moreEn}`),
  };
}

const money = (v) => (v >= 1e6 ? `€${Number((v / 1e6).toFixed(v < 1e7 ? 1 : 0))} млн` : `€${Math.round(v / 1e3)} тис.`);
const moneyEn = (v) => (v >= 1e6 ? `€${Number((v / 1e6).toFixed(v < 1e7 ? 1 : 0))}m` : `€${Math.round(v / 1e3)}k`);
const moneyT = (v) => T(money(v), moneyEn(v));

const COLUMNS = [
  { id: 'nation', label: T('Збірна', 'Nation') },
  { id: 'position', label: T('Позиція', 'Position') },
  { id: 'born', label: T('Рік народження', 'Born') },
  { id: 'last', label: T('Останній клуб', 'Last club') },
  { id: 'league', label: T('Чемпіонат', 'League') },
  { id: 'goals', label: T('Голи в чемпіонатах', 'League goals') },
  { id: 'caps', label: T('Матчі за збірну', 'Caps') },
  { id: 'natGoals', label: T('Голи за збірну', 'Intl goals') },
  { id: 'assists', label: T('Асисти', 'Assists') }, // лише коли загаданий почав з 2012/13 — див. columnsFor
  { id: 'value', label: T('Макс. вартість', 'Peak value') },
  { id: 'trophies', label: T('Трофеї', 'Trophies') },
  { id: 'shared', label: T('Спільні клуби', 'Shared clubs') },
];

// Колонки раунду: асисти — лише для загаданих, що почали кар'єру з 2012-го.
const columnsFor = (t) => COLUMNS.filter((c) => c.id !== 'assists' || t?.modern);

const PLAYED_HERE = T('загаданий грав тут', 'mystery player played here');
const NO_DATA = T('немає даних', 'no data');

// Рядок клітинок для спроби g проти загаданого t (обидва — профілі). Тексти — парами T (мову обирає room-server).
function compare(g, t) {
  const cells = {};

  if (!g.nation) cells.nation = { text: T('не грав за збірну', 'no caps'), color: t.nation ? 'grey' : 'green' };
  else {
    const same = t.nation && g.nation.name === t.nation.name;
    const near = t.nation && g.nation.conf && g.nation.conf === t.nation.conf;
    const conf = CONF_LABELS[g.nation.conf];
    cells.nation = {
      text: placeT(g.nation.name), img: g.nation.img, color: same ? 'green' : near ? 'yellow' : 'grey',
      note: near && !same ? T(`теж ${conf.uk}`, `also ${conf.en}`) : null,
    };
  }

  // зелена — та сама позиція; жовта — та сама лінія (обидва захисники, обидва на фланзі…), пояснюємо словами
  const gp = g.position, tp = t.position;
  const common = gp.groups.find((x) => tp.groups.includes(x));
  const samePos = gp.label === tp.label;
  cells.position = {
    text: T(gp.label, gp.en), color: samePos ? 'green' : common ? 'yellow' : 'grey',
    note: !samePos && common ? T(`теж ${GROUPS[common].uk}`, `also a ${GROUPS[common].en}`) : null,
  };

  if (g.born && t.born) {
    const d = Math.abs(g.born - t.born);
    cells.born = {
      text: String(g.born),
      color: d === 0 ? 'green' : d <= 2 ? 'yellow' : 'grey',
      note: d === 0 ? T('однолітки', 'same age') : t.born > g.born ? T('загаданий молодший', 'mystery player is younger') : T('загаданий старший', 'mystery player is older'),
    };
  } else cells.born = { text: g.born ? String(g.born) : '?', color: 'grey' };

  const playedThere = t.clubs.some((x) => x.t === g.last.t);
  cells.last = {
    text: clubT(g.last.t),
    img: g.last.img,
    color: g.last.t === t.last.t ? 'green' : playedThere ? 'yellow' : 'grey',
    note: g.last.t !== t.last.t && playedThere ? PLAYED_HERE : g.last.current ? T('зараз', 'current') : T('завершив тут', 'ended career here'),
  };

  cells.league = {
    text: placeT(g.country) || '?',
    color: g.country && g.country === t.country ? 'green' : g.country && t.countries.has(g.country) ? 'yellow' : 'grey',
    note: g.country && g.country !== t.country && t.countries.has(g.country) ? PLAYED_HERE : null,
  };

  cells.goals = { text: String(g.goals), ...numberCell(g.goals, t.goals, { yellow: [15, 0.25] }) };
  cells.caps = { text: String(g.caps), ...numberCell(g.caps, t.caps, { yellow: [10, 0.3] }) };
  cells.natGoals = { text: String(g.natGoals), ...numberCell(g.natGoals, t.natGoals, { yellow: [5, 0.3] }) };

  if (!g.value) cells.value = { text: '?', color: 'grey', note: NO_DATA };
  else if (!t.value) cells.value = { text: moneyT(g.value), color: 'grey', note: T('про загаданого немає даних', 'no data for the mystery player') };
  else cells.value = { text: moneyT(g.value), ...numberCell(g.value, t.value, { green: [1e6, 0.1], yellow: [3e6, 0.35] }) };

  // трофеї — списком; ті, що є й у загаданого, позначені (match)
  const tt = new Set(t.trophies);
  const sameTrophies = g.trophies.length === tt.size && g.trophies.every((x) => tt.has(x));
  const someTrophies = g.trophies.some((x) => tt.has(x));
  cells.trophies = {
    text: g.trophies.length ? '' : T('немає великих', 'no major ones'),
    items: g.trophies.map((id) => {
      const x = TROPHIES.find((y) => y.id === id);
      const n = g.trophyCount[id] ? ` ×${g.trophyCount[id]}` : '';
      return { label: T(x.label + n, x.en + n), match: tt.has(id) };
    }),
    color: sameTrophies ? 'green' : someTrophies ? 'yellow' : 'grey',
    note: !sameTrophies && someTrophies ? T('✓ — є і в загаданого', '✓ — mystery player has it too') : null,
  };

  const shared = sharedClubs(g, t);
  cells.shared = {
    text: shared.length ? '' : T('немає', 'none'),
    clubs: shared,
    color: shared.length ? 'yellow' : 'grey',
    note: shared.some((x) => x.together) ? T('🤝 — грали разом', '🤝 — played together') : null,
  };

  if (t.modern) {
    if (!g.modern) cells.assists = { text: '—', color: 'grey', note: T('почав до 2012 — даних немає', 'started before 2012 — no data') };
    else if (g.assists == null || t.assists == null) cells.assists = { text: g.assists == null ? '?' : String(g.assists), color: 'grey', note: NO_DATA };
    else cells.assists = { text: String(g.assists), ...numberCell(g.assists, t.assists, { yellow: [10, 0.3] }) };
  }
  return columnsFor(t).map((c) => ({ id: c.id, ...cells[c.id] }));
}

module.exports = { profileOf, compare, columnsFor, leagueOf, nationName, placeT, COLUMNS, TROPHIES, money };
