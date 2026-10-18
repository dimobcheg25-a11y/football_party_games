// «Склад матчу»: матчі з server/data/lineups.json (npm run build-lineups) → дошка для гри:
// шапка матчу, дві команди, позиції на полі (x, y — 0..1000 від своїх воріт), номер, прапор (клуби) або клуб гравця (збірні),
// голи, капітан, заміни, тренер. Складність — середній рейтинг відомості основи (recognition), рівні як у «Топ-10»: 30/40/30 %.
const { T } = require('../../core/i18n');
const { playerById, normalize } = require('../../data');
const { team, recognition, careerOf } = require('../path/careers');
const compare = require('../guess/compare');
const { countryEn } = require('../../data/names-en');

let raw = [];
try {
  raw = require('../../data/lineups.json');
} catch {
  // склади ще не зібрані (npm run build-lineups)
}

// ── прапори: код ФІФА → файл Вікісховища
const FLAG_FILES = {
  ENG: 'Flag of England.svg', SCO: 'Flag of Scotland.svg', WAL: 'Flag of Wales.svg', NIR: 'Ulster Banner.svg', FRG: 'Flag of Germany.svg',
  YUG: 'Flag of SFR Yugoslavia.svg', TCH: 'Flag of the Czech Republic.svg', SCG: 'Flag of Serbia and Montenegro.svg', FRY: 'Flag of Serbia and Montenegro.svg',
  URS: 'Flag of the Soviet Union.svg', NED: 'Flag of the Netherlands.svg', USA: 'Flag of the United States.svg', CZE: 'Flag of the Czech Republic.svg',
  COD: 'Flag of the Democratic Republic of the Congo.svg', CIV: "Flag of Côte d'Ivoire.svg", IRL: 'Flag of Ireland.svg', UAE: 'Flag of the United Arab Emirates.svg',
};
const COUNTRY = {
  ALB: 'Albania', ALG: 'Algeria', ANG: 'Angola', ARG: 'Argentina', ARM: 'Armenia', AUS: 'Australia', AUT: 'Austria', BEL: 'Belgium', BFA: 'Burkina Faso',
  BIH: 'Bosnia and Herzegovina', BLR: 'Belarus', BOL: 'Bolivia', BRA: 'Brazil', BUL: 'Bulgaria', CAN: 'Canada', CHI: 'Chile', CMR: 'Cameroon', COL: 'Colombia',
  CRC: 'Costa Rica', CRO: 'Croatia', DEN: 'Denmark', ECU: 'Ecuador', EGY: 'Egypt', ESP: 'Spain', FIN: 'Finland', FRA: 'France', GAB: 'Gabon', GEO: 'Georgia',
  GER: 'Germany', GHA: 'Ghana', GRE: 'Greece', GUI: 'Guinea', HUN: 'Hungary', ISL: 'Iceland', ISR: 'Israel', ITA: 'Italy', JAM: 'Jamaica', JPN: 'Japan',
  KEN: 'Kenya', KOR: 'South Korea', LTU: 'Lithuania', MAR: 'Morocco', MDA: 'Moldova', MEX: 'Mexico', MKD: 'North Macedonia', MLI: 'Mali', MNE: 'Montenegro',
  NGA: 'Nigeria', NOR: 'Norway', PAR: 'Paraguay', PER: 'Peru', POL: 'Poland', POR: 'Portugal', ROU: 'Romania', RSA: 'South Africa', RUS: 'Russia',
  SEN: 'Senegal', SRB: 'Serbia', SUI: 'Switzerland', SVK: 'Slovakia', SVN: 'Slovenia', SWE: 'Sweden', TRI: 'Trinidad and Tobago', TUN: 'Tunisia', TUR: 'Turkey',
  UKR: 'Ukraine', URU: 'Uruguay', UZB: 'Uzbekistan', VEN: 'Venezuela', ZAM: 'Zambia', ZIM: 'Zimbabwe',
};
const flagImg = (code) => {
  const file = FLAG_FILES[code] || (COUNTRY[code] ? `Flag of ${COUNTRY[code]}.svg` : null);
  return file ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=40` : null;
};

// команди з API УЄФА → наші клуби/збірні (назва українською, герб/прапор)
const UEFA_QIDS = {
  Metalist: 'Q207462', 'Dynamo Kyiv': 'Q179075', Shakhtar: 'Q172969', 'Shakhtar Donetsk': 'Q172969', Beşiktaş: 'Q172567', Galatasaray: 'Q495299',
  Benfica: 'Q131499', Sampdoria: 'Q1457', Sochaux: 'Q19512', Salzburg: 'Q994811', Olympiacos: 'Q19628', 'Sporting CP': 'Q75729', Leverkusen: 'Q104761',
  PAOK: 'Q204888', Barcelona: 'Q7156', 'Real Madrid': 'Q8682', 'Bayern München': 'Q15789', Roma: 'Q2739', 'Man City': 'Q50602', Paris: 'Q483020',
  Liverpool: 'Q1130849', Ajax: 'Q81888', Tottenham: 'Q18741', Deportivo: 'Q8760', Milan: 'Q1543', Inter: 'Q631', Chelsea: 'Q9616', Juventus: 'Q1422',
  'Man Utd': 'Q18656', Ukraine: 'Q170403', Sweden: 'Q160826', Slovakia: 'Q174512', England: 'Q47762', Iceland: 'Q189198', France: 'Q47774',
  Switzerland: 'Q165141',
};

// кольори домашньої форми для команд з API УЄФА (там кольорів немає; у Вікіпедії — є в статті)
const KITS = {
  Q207462: '#f2c300', Q179075: '#ffffff', Q172969: '#f47b20', Q172567: '#1a1a1a', Q495299: '#c8102e', Q131499: '#e2001a', Q1457: '#1f4ea3',
  Q19512: '#f6c600', Q994811: '#ffffff', Q19628: '#d00000', Q75729: '#0b7d3e', Q104761: '#e32221', Q204888: '#1a1a1a', Q7156: '#a50044',
  Q8682: '#ffffff', Q15789: '#dc052d', Q2739: '#8e1f2f', Q50602: '#6cabdd', Q483020: '#004170', Q1130849: '#c8102e', Q81888: '#d2122e',
  Q18741: '#ffffff', Q8760: '#1f4fa0', Q1543: '#fb090b', Q631: '#0068a8', Q9616: '#034694', Q1422: '#1a1a1a', Q18656: '#da291c',
  Q170403: '#ffd500', Q160826: '#fecc00', Q174512: '#ffffff', Q47762: '#ffffff', Q189198: '#02529c', Q47774: '#002654', Q165141: '#d52b1e',
};

// ── назви турнірів і стадій
const year = (m) => Number((m.date || '').slice(0, 4)) || null;
function compName(m) {
  const y = year(m);
  switch (m.comp) {
    case 'wc': return ['чемпіонату світу', 'World Cup'];
    case 'euro': return ['Євро', 'Euro'];
    case 'copa': return ['Копа Америка', 'Copa América'];
    case 'uel': return y && y <= 2009 ? ['Кубка УЄФА', 'UEFA Cup'] : ['Ліги Європи', 'Europa League'];
    default: return y && y <= 1992 ? ['Кубка чемпіонів', 'European Cup'] : ['Ліги чемпіонів', 'Champions League'];
  }
}
const ROUNDS = {
  final: ['Фінал', 'Final'], semi: ['Півфінал', 'Semi-final'], quarter: ['Чвертьфінал', 'Quarter-final'], group: ['Груповий етап', 'Group stage'],
  'Final': ['Фінал', 'Final'], 'Semi-finals': ['Півфінал', 'Semi-final'], 'Quarter-finals': ['Чвертьфінал', 'Quarter-final'],
  'Round of 16': ['1/8 фіналу', 'Round of 16'], 'Round of 32': ['1/16 фіналу', 'Round of 32'], 'Group stage': ['Груповий етап', 'Group stage'],
  'Play-Offs': ['Плей-оф', 'Play-off'], 'First round': ['Перший раунд', 'First round'], 'Third qualifying round': ['3-й кваліфікаційний раунд', 'Third qualifying round'],
  'Knockout round play-offs': ['Плей-оф', 'Play-off'], 'League phase': ['Основний етап', 'League phase'],
};

// ── позиції → координати (свої ворота внизу, y = 0..1000; x = 0 — лівий фланг)
const ROW_Y = {
  GK: 60, SW: 170, CB: 230, LB: 270, RB: 270, LWB: 400, RWB: 400, DM: 390, CM: 510, LM: 530, RM: 530, AM: 650, LW: 730, RW: 730,
  LF: 810, RF: 810, SS: 790, CF: 870, ST: 870, DF: 250, MF: 520, FW: 840,
};
const LEFT = new Set(['LB', 'LWB', 'LM', 'LW', 'LF']);
const RIGHT = new Set(['RB', 'RWB', 'RM', 'RW', 'RF']);
const ROW_OF = (pos) => (['SW', 'CB', 'LB', 'RB', 'DF'].includes(pos) ? 'def' : ['DM'].includes(pos) ? 'dm' : ['CM', 'LM', 'RM', 'MF', 'LWB', 'RWB'].includes(pos) ? 'mid'
  : ['AM', 'LW', 'RW'].includes(pos) ? 'am' : pos === 'GK' ? 'gk' : 'fw');
// Вікіпедія перелічує лінію справа наліво (RB, CB, CB, LB) — центральних розставляємо так само
function layout(xi) {
  const out = xi.map((p) => ({ ...p }));
  const haveCoords = out.every((p) => p.x != null && p.y != null);
  if (haveCoords) return out;
  const rows = new Map();
  for (const p of out) {
    p.y = ROW_Y[p.pos] ?? 520;
    if (p.pos === 'GK') { p.x = 500; continue; }
    if (LEFT.has(p.pos)) { p.x = 130; continue; }
    if (RIGHT.has(p.pos)) { p.x = 870; continue; }
    const row = ROW_OF(p.pos);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(p);
  }
  for (const list of rows.values()) {
    const n = list.length;
    const wide = list.some((p) => ['DF', 'MF', 'FW'].includes(p.pos)) ? 380 : n >= 4 ? 300 : n === 3 ? 230 : 130;
    list.forEach((p, i) => { p.x = n === 1 ? 500 : Math.round(500 + wide - (2 * wide * i) / (n - 1)); });
  }
  return out;
}

// ── клуб гравця на дату матчу (для матчів збірних): сезон, що закінчується в рік матчу (у червні-липні — він же)
function clubAt(p, date) {
  const c = careerOf(p);
  if (!c || !date) return null;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const seasonEnd = m >= 8 ? y + 1 : y; // матч восени — уже новий сезон
  const fits = c.clubs.filter((x) => (x.s ?? 0) < seasonEnd && (x.e == null || x.e >= seasonEnd));
  const pick = fits.find((x) => x.loan) || fits[fits.length - 1] || c.clubs.filter((x) => (x.s ?? 0) <= y && (x.e == null || x.e >= y)).pop();
  if (!pick) return null;
  const t = team(pick.t);
  return { name: T(t.name, t.nameEn), img: t.img || null };
}

const surname = (nm) => String(nm || '').trim().split(/\s+/).pop();
const letters = (nm) => surname(nm).replace(/[^\p{L}]/gu, '').length;

function slotOf(p, m, national, key, extra = {}) {
  const pl = p.pid ? playerById.get(p.pid) : null;
  const born = pl?.born || p.born || null;
  const nameUk = pl ? pl.uk || pl.name : p.name;
  const nameEn = pl ? pl.name : p.name;
  return {
    key, num: p.num ?? null, pos: p.pos || null, x: p.x ?? null, y: p.y ?? null,
    flag: !national && p.flag ? flagImg(p.flag) : null, flagCode: p.flag || null,
    club: national && pl ? clubAt(pl, m.date) : null,
    capt: !!p.capt, goals: p.goals || [], off: p.off || null, on: p.on || null, for: p.for ?? null,
    pid: pl?.id || null, name: T(nameUk, nameEn), photo: pl?.photo || null,
    age: born && year(m) ? year(m) - born : null,
    letters: T(String(letters(nameUk)), String(letters(nameEn))), first: T(surname(nameUk)[0] || '?', surname(nameEn)[0] || '?'),
    missing: !pl, ...extra,
  };
}

function teamOf(t, m, k) {
  const qid = t.qid || UEFA_QIDS[t.uefaTeam] || null;
  const our = qid ? team(qid) : null;
  const national = !!t.national;
  const name = our && our.name !== '?' ? T(our.name, our.nameEn) : T(t.name || t.uefaTeam, t.name || t.uefaTeam);
  const xi = layout(t.xi).map((p, i) => slotOf(p, m, national, `${k}-${i}`));
  const bench = (t.bench || []).map((p, i) => slotOf(p, m, national, `${k}-s${i}`, { sub: true }));
  let coach = null;
  if (t.coach) {
    const pl = t.coach.pid ? playerById.get(t.coach.pid) : null;
    const born = pl?.born || t.coach.born || null;
    // uk — з Вікідати (build-lineups); «Маркевич Мирон Богданович» → «Мирон Маркевич»
    const fio = (s) => { const w = String(s || '').split(/\s+/); return w.length === 3 && /(ович|евич|йович|івна)$/.test(w[2]) ? `${w[1]} ${w[0]}` : s; };
    const nameUk = pl ? pl.uk || pl.name : fio(t.coach.uk) || t.coach.name;
    const nameEn = pl ? pl.name : t.coach.name;
    coach = {
      key: `${k}-c`, coach: true, pid: pl?.id || null, coachKey: normalize(t.coach.name), name: T(nameUk, nameEn), photo: pl?.photo || null,
      flag: t.coach.flag ? flagImg(t.coach.flag) : null, age: born && year(m) ? year(m) - born : null,
      letters: T(String(letters(nameUk)), String(letters(nameEn))), first: T(surname(nameUk)[0] || '?', surname(nameEn)[0] || '?'), missing: false,
    };
  }
  const img = national ? (qid ? team(qid).img : null) || null : (t.logo || our?.img || null);
  return { name, img, kit: t.kit || KITS[qid] || null, national, xi, bench, coach, qid };
}

const BANNED_CLUBS = /Zenit|CSKA|Spartak|Lokomotiv Moscow|Rubin/i;
function banned(m) {
  return m.teams.some((t) => {
    const qid = t.qid || UEFA_QIDS[t.uefaTeam];
    return (qid && (compare.leagueOf(qid) === 'Росія' || compare.nationName(qid) === 'Росія' || compare.nationName(qid) === 'Білорусь'))
      || BANNED_CLUBS.test(t.uefaTeam || t.name || '');
  });
}

function build(m) {
  const teams = m.teams.map((t, k) => teamOf(t, m, k));
  // однакові кольори (обидва в білому / жовтому) — гостей у темно-синьому, щоб команди не зливались
  if (teams[0].kit && teams[0].kit.toLowerCase() === teams[1].kit?.toLowerCase()) teams[1].kit = '#1b2a4a';
  const [cu, ce] = compName(m);
  const [ru, re] = ROUNDS[m.round] || [m.round || '', m.round || ''];
  const y = year(m);
  const legUk = m.leg === 2 ? ' (матч-відповідь)' : m.leg === 1 ? ' (перший матч)' : '';
  const legEn = m.leg === 2 ? ' (second leg)' : m.leg === 1 ? ' (first leg)' : '';
  const tags = new Set(m.tags || []);
  tags.add(m.comp);
  // українські матчі за участю наших команд — теж «Україна»
  if (teams.some((t) => ['Q170403', 'Q179075', 'Q172969', 'Q207462', 'Q175687'].includes(t.qid))) tags.add('ua');
  const starters = teams.flatMap((t) => t.xi);
  const known = starters.filter((s) => s.pid);
  const score = known.length ? known.reduce((s, x) => s + recognition(playerById.get(x.pid)), 0) / known.length : 0;
  return {
    id: m.id,
    title: T(`${ru} ${cu} ${y}${legUk}`, `${re === 'Final' ? `${ce} final` : `${ce} ${re.toLowerCase()}`} ${y}${legEn}`),
    date: m.date, year: y, venue: m.venue || null,
    score: m.score, aet: !!m.aet, pens: m.pens || null, aggregate: m.aggregate || null,
    teams, tags: [...tags], comp: m.comp,
    known: starters.length ? known.length / starters.length : 0,
    perTeam: teams.map((t) => t.xi.filter((s) => s.pid).length / Math.max(1, t.xi.length)),
    popularity: Math.round(score),
  };
}

// у грі — матчі, де більшість основи є в нашій базі (решту відкриваємо одразу, без очок).
// Металіст — усі матчі: його склад є повністю, суперника (якщо його гравців немає в базі) просто відкриваємо.
const matches = raw.filter((m) => !banned(m)).map(build)
  .filter((m) => m.tags.includes('metalist') || (m.known >= 0.6 && m.perTeam.every((x) => x >= 0.45)));
const LEVELS = ['easy', 'normal', 'hard'];
[...matches].sort((a, b) => b.popularity - a.popularity)
  .forEach((m, i, all) => { m.level = i < all.length * 0.3 ? 'easy' : i < all.length * 0.7 ? 'normal' : 'hard'; });
const matchById = new Map(matches.map((m) => [m.id, m]));

const CATEGORIES = {
  wc: T('🌍 Чемпіонати світу', '🌍 World Cups'), euro: T('🇪🇺 Євро', '🇪🇺 Euros'), copa: T('🌎 Копа Америка', '🌎 Copa América'),
  ucl: T('⭐ Ліга чемпіонів', '⭐ Champions League'), uel: T('🟠 Кубок УЄФА / Ліга Європи', '🟠 UEFA Cup / Europa League'),
  legend: T('🔥 Легендарні матчі', '🔥 Legendary matches'), ua: T('🇺🇦 Українські', '🇺🇦 Ukrainian'), metalist: T('💛💙 Металіст Маркевича', '💛💙 Markevych’s Metalist'),
};
const matchesFor = (cats) => matches.filter((m) => m.tags.some((t) => cats.includes(t)));

// тренери для пошуку (тих, кого немає в базі гравців, теж можна назвати)
const coaches = [...new Map(matches.flatMap((m) => m.teams.map((t) => t.coach)).filter(Boolean)
  .map((c) => [c.coachKey, { key: c.coachKey, name: c.name, pid: c.pid, photo: c.photo }])).values()];

module.exports = { matches, matchById, matchesFor, CATEGORIES, LEVELS, coaches, flagImg, countryEn };
