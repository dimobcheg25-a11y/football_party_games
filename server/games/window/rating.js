// «Трансферне вікно»: сила гравця 40…99 залежно від позиції. Гравцям у грі формула не показується — лише число після вікна.
//
// Кожен показник → перцентиль серед гравців тієї ж групи позицій (воротарі з воротарями…) у довідковому пулі,
// потім зважена сума за WEIGHTS групи. Показника немає (легенди до 2012 — без сухих матчів, карток, хвилин) — його вага
// просто випадає, решта ділиться на суму наявних ваг: відсутні дані не штрафують.
// Дані: stats.json (з 2012/13: хвилини, картки, сухі матчі, перемоги, ЛЧ), careers (голи й матчі за клуби і збірну, усі епохи),
// honours.json (трофеї й особисті нагороди з роками), ballon.json, awards.json (FIFPRO World 11, Golden Boy), transfers.json (пікова вартість), uefa-ranks.json (сила ліг за роками).

const { players } = require('../../data');
const { careerOf, team, recognition } = require('../path/careers');
const { leagueOf } = require('../guess/compare');
const { countryEn } = require('../../data/names-en');
const { honoursOf } = require('../../data/honours');

const load = (f, def) => { try { return require(f); } catch { return def; } };
const stats = load('../../data/stats.json', { players: {} }).players;
const transfers = load('../../data/transfers.json', {});
const ballon = load('../../data/ballon.json', {});
const awards = load('../../data/awards.json', { fifpro: {}, goldenBoy: {} });
const ranks = load('../../data/uefa-ranks.json', {});

// Позиція Transfermarkt → група з власними вагами. Крайні півзахисники — як атакувальні, вінгери — як нападники.
const POS_GROUP = {
  Goalkeeper: 'GK', 'Centre-Back': 'CB', 'Left-Back': 'FB', 'Right-Back': 'FB',
  'Defensive Midfield': 'DM', 'Central Midfield': 'CM', 'Attacking Midfield': 'AM', 'Left Midfield': 'AM', 'Right Midfield': 'AM',
  'Left Winger': 'FW', 'Right Winger': 'FW', 'Second Striker': 'FW', 'Centre-Forward': 'FW',
};
const GROUPS = ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'FW'];

// Ваги показників за групами (погоджено з користувачем): [GK, CB, FB, DM, CM, AM, FW]; від'ємні — менше краще.
const WEIGHTS = {
  cleanSheets: [1.0, 0.9, 0.7, 0.55, 0.4, 0.2, 0],
  conceded: [-1.0, 0, 0, 0, 0, 0, 0],
  goals: [0, 0.3, 0.3, 0.4, 0.6, 0.9, 1.0],
  assists: [0, 0.2, 0.6, 0.5, 0.8, 1.0, 0.7],
  ucl: [0, 0.3, 0.4, 0.5, 0.7, 1.0, 1.0],
  yellows: [-1.0, -1.0, -1.0, -0.8, -0.8, -0.6, -0.5],
  reds: [-1.0, -1.0, -1.0, -0.8, -0.8, -0.6, -0.5],
  winRate: [1, 1, 1, 1, 1, 1, 1],
  regularity: [1, 1, 1, 1, 1, 1, 1],
  peakValue: [1, 1, 1, 1, 1, 1, 1],
  caps: [1, 1, 1, 1, 1, 1, 1],
  intlGoals: [0, 0.2, 0.2, 0.3, 0.5, 0.8, 1.0],
  trophies: [1, 1, 1, 1, 1, 1, 1],
  awards: [1, 1, 1, 1, 1, 1, 1],
  ballon: [1, 1, 1, 1, 1, 1, 1],
  clubLevel: [1, 1, 1, 1, 1, 1, 1],
  topSeasons: [1, 1, 1, 1, 1, 1, 1],
  fame: [1, 1, 1, 1, 1, 1, 1],
};
// Важливість показника — множник поверх ваг позицій. Особиста якість (нагороди, «Золотий м'ям», пікова вартість, відомість)
// важить більше, ніж контекст команди (перемоги, трофеї, рівень клубу, сезони на топрівні — «довго грав у Баварії»).
const IMPORTANCE = {
  awards: 2.5, ballon: 2, peakValue: 1.5, fame: 1.5,
  winRate: 0.5, trophies: 0.7, clubLevel: 0.5, topSeasons: 0.5, caps: 0.5, intlGoals: 0.6, ucl: 0.8, regularity: 0.7,
};
// Лічильники — через логарифм: 10 нагород не в 10 разів краще за одну
const LOG = new Set(['ucl', 'trophies', 'awards', 'ballon', 'caps', 'intlGoals', 'topSeasons', 'fame']);
const Z_CLIP = 3;
const SHRINK = 2; // «уявні» середні показники: у кого даних мало, той ближче до середнього
// Показники, яких немає в гравців до 2012 — без них сучасний режим не бере гравця в пул.
const MODERN = ['cleanSheets', 'conceded', 'assists', 'ucl', 'yellows', 'reds', 'winRate', 'regularity'];
const MIN_MINUTES = 4500; // менше — вибірка замала, показники з 2012 не рахуємо

const posOf = (p) => transfers[p.id]?.pos || null; // позиція Transfermarkt (з manual-positions)
const groupOf = (p) => POS_GROUP[posOf(p)] || null;
const statsOf = (p) => {
  const s = stats[transfers[p.id]?.tm];
  return s && s.x && s.x.min >= MIN_MINUTES ? s : null;
};

// ——— Сила ліги країни в рік: 0..1 (лідер рейтингу УЄФА = 1). Поза УЄФА — сталі значення.
const YEARS = Object.keys(ranks).map(Number).sort((a, b) => a - b);
const NON_UEFA = { Brazil: 0.45, Argentina: 0.4, Mexico: 0.25, USA: 0.2, 'Saudi Arabia': 0.2, Japan: 0.15, China: 0.15, Qatar: 0.1, UAE: 0.1 };
const ALIAS = { 'Czech Republic': ['Czech Republic', 'Czechia'], Turkey: ['Turkey', 'Türkiye'] };
const USSR = new Set(['Ukraine', 'Russia', 'Georgia', 'Belarus', 'Armenia', 'Azerbaijan', 'Moldova', 'Lithuania', 'Latvia', 'Estonia', 'Kazakhstan']);
const YUGO = new Set(['Serbia', 'Croatia', 'Bosnia and Herzegovina', 'Bosnia-Herzegovina', 'Slovenia', 'North Macedonia', 'Montenegro']);
function leagueStrength(country, year) {
  if (!country) return 0.1;
  if (NON_UEFA[country] != null) return NON_UEFA[country];
  if (!YEARS.length) return 0.5;
  const y = Math.min(Math.max(year || YEARS[YEARS.length - 1], YEARS[0]), YEARS[YEARS.length - 1]);
  let names = ALIAS[country] || [country];
  if (y <= 1991 && USSR.has(country)) names = ['Soviet Union'];
  if (y <= 1991 && YUGO.has(country)) names = ['Yugoslavia'];
  if (y <= 1993 && (country === 'Czech Republic' || country === 'Slovakia')) names = ['Czechoslovakia'];
  for (const n of names) if (ranks[y]?.[n]) return ranks[y][n][1];
  return 0.1;
}
const clubCountry = (t) => countryEn(leagueOf(t)) || null;
// Збірна з УЄФА? null — збірної немає або країну не знайдено
const UEFA_NAMES = new Set(Object.values(ranks).flatMap((r) => Object.keys(r)));
const BRITISH = new Set(['England', 'Scotland', 'Wales', 'Northern Ireland']);
function isEuropean(nationQid) {
  if (!nationQid) return null;
  const country = countryEn(team(nationQid)?.country || '') || '';
  if (!country) return null;
  if (BRITISH.has(country) || UEFA_NAMES.has(country) || (ALIAS[country] || []).some((n) => UEFA_NAMES.has(n))) return true;
  if (/germany|soviet|yugoslavia|czechoslovakia|united kingdom/i.test(country)) return true;
  return false;
}

// ——— Особисті нагороди: тип за назвою → вага; ліга — за назвою, і тоді вага × сила ліги того року.
const AWARD_SKIP = /^\[\[|^$|^(france football'?s? )?(super )?ballon d'or(?!.*fifa)|ballon d'or dream team|hall of fame|walk of fame|\brecords?\b|\bmost\b|longest|fastest|oldest|youngest|order of|medal|knight|officer|commander|cavaliere|honorary|citizen|doctorate|freedom of|inducted|legend|all[- ]time|greatest|of the (decade|century)|century|achievement|career|tribute|president'?s award|one club man|sporting director|manager|coach/i;
const AWARD_YOUNG = /young|youth|breakthrough|revelation|newcomer|emerging|rookie|talent|golden boy|kopa|under-?\d\d|u-?\d\d\b/i;
const AWARD_WORLD = /fifa (world|men'?s|best)|the best fifa|fifpro|world (soccer )?player of the year|world 11|world xi|world team of the year|uefa (men'?s )?(best )?player of the year|uefa club (footballer|player|goalkeeper|defender|midfielder|forward)|uefa team of the year|champions league .*(team|squad|player|goalkeeper|defender|midfielder|forward) of the (season|year)|^european golden shoe|golden boot \(europe|european golden|onze d'or|onze de|esm team|world cup .*(golden ball|golden boot|golden glove|best|all-star|team|dream)|european championship .*team|euro .*team of the tournament|uefa euro .*(golden boot|best player)|copa am[ée]rica .*(team|best|golden|top)|champions league top ?(scorer|assist)|iffhs (world|men'?s world|best)|world soccer|l'[ée]quipe (team|champion)|el pa[ií]s european|bravo/i;
const AWARD_CONT = /nations league .*team|europa league .*(team|squad|player|top ?scorer)|club world cup .*(golden|ball|best)|africa(n)? cup of nations .*(team|best|top)|caf |african (footballer|player)|afc |asian (footballer|player)|south american (footballer|player|team)|conmebol|concacaf|gold cup .*(best|team|golden)|confederations cup .*(golden|team)|olympic .*(golden|top|team)|eastern european|european (team|xi)|onze (mondial|d'argent)|golden boy|kopa|globe soccer/i;
const AWARD_MONTH = /of the month|goal of the|save of the|man of the match|player of the round|team of the week|matchday/i;
const AWARD_LOWER = /championship|segunda|serie b|2\. bundesliga|ligue 2|eerste divisie|league one|league two|second division/i;
const AWARD_CUP = /\bcup\b|coppa|copa del rey|pokal|coupe|ta[çc]a|supercup|super cup/i;
const AWARD_LEAGUE = /player of the (year|season)|footballer of the (year|season)|team of the (year|season)|xi of the (year|season)|best xi|all-star|top ?scorer|golden boot|golden shoe|capocannoniere|pichichi|zamora|(goalkeeper|defender|midfielder|forward|striker) of the (year|season)|best (player|goalkeeper|defender|midfielder|forward|foreign)|oscar del calcio|gran gal[aà]|pallone d'(argento|oro)|guerin|kicker|unfp|pfa|fwa|don bal[oó]n|lfp|bola de (prata|ouro)|golden ball/i;
// страна ліги/країни за назвою нагороди; перше збігання
const AWARD_COUNTRY = [
  [/premier league|\bpfa\b(?! scotland)|\bfwa\b|english|football league|\befl\b|alan hardaker|england/i, 'England'],
  [/pfa scotland|scottish|\bspfl\b|\bspl\b|scotland/i, 'Scotland'],
  [/serie a|italian|calcio|capocannoniere|guerin|\baic\b|pallone d'|gran gal|italy/i, 'Italy'],
  [/la ?liga|spanish|pichichi|zamora|don bal[oó]n|\blfp\b|primera divisi|spain|marca/i, 'Spain'],
  [/bundesliga|german|kicker|germany/i, 'Germany'],
  [/ligue 1|french|\bunfp\b|division 1 \(france|france|l'[ée]quipe/i, 'France'],
  [/eredivisie|dutch|netherlands|johan cruyff (trophy|award)/i, 'Netherlands'],
  [/primeira liga|portug/i, 'Portugal'],
  [/ukrain|vyshcha|vyscha|\bupl\b/i, 'Ukraine'],
  [/s[üu]per lig|turk/i, 'Turkey'],
  [/belgi|jupiler|pro league/i, 'Belgium'],
  [/croat/i, 'Croatia'], [/serbia/i, 'Serbia'], [/polish|poland|ekstraklasa/i, 'Poland'], [/czech/i, 'Czech Republic'],
  [/swiss|switzerland/i, 'Switzerland'], [/austria/i, 'Austria'], [/greek|greece/i, 'Greece'], [/danish|denmark/i, 'Denmark'],
  [/swed/i, 'Sweden'], [/norw/i, 'Norway'], [/brazil|brasileir|bola de (prata|ouro)/i, 'Brazil'], [/argentin/i, 'Argentina'], [/\bmls\b|major league soccer/i, 'USA'],
  [/saudi/i, 'Saudi Arabia'], [/mexic|liga mx/i, 'Mexico'],
];
// → [вага, країна | null]; 0 — не рахуємо
function awardKind(label) {
  if (AWARD_SKIP.test(label)) return [0, null];
  if (AWARD_MONTH.test(label)) return [0.15, null];
  if (/^golden boy$/i.test(label)) return [1.5, null]; // головна молодіжна нагорода Європи — трохи більше за інші молодіжні
  const young = AWARD_YOUNG.test(label);
  if (FIFPRO_RESERVE.test(label)) return [0.5, null]; // запасні збірні й номінанти FIFPRO
  if (AWARD_WORLD.test(label)) return [young ? 1 : 3, null];
  if (AWARD_CONT.test(label)) return [young ? 1 : 2, null];
  if (/golden foot/i.test(label)) return [0.5, null]; // нагорода за кар'єру
  if (AWARD_LOWER.test(label) || AWARD_CUP.test(label)) return [0.5, null];
  const country = (AWARD_COUNTRY.find(([re]) => re.test(label)) || [])[1] || null;
  // нагорода ліги чи країни; без країни в назві — клубна («Гравець року Арсеналу») — трохи
  if (AWARD_LEAGUE.test(label) && country) return [young ? 0.6 : 2, country];
  return [young ? 0.3 : 0.4, null];
}
// Символічна збірна FIFPRO і Golden Boy — з awards.json (повні списки), а не з «Honours» статей (там різні назви, пропуски й дублі).
const FIFPRO_LABEL = /fifpro|^fifa men'?s world (11|xi)$/i;
const FIFPRO_RESERVE = /fifpro.*(\d(st|nd|rd|th) team|nominee|reserve)/i;
const GBOY_LABEL = /^golden boy( award)?$/i;
const fifproYears = new Map();
for (const [y, team] of Object.entries(awards.fifpro || {})) for (const [id] of team) if (id) (fifproYears.get(id) || fifproYears.set(id, []).get(id)).push(Number(y));
const goldenBoyYear = new Map(Object.entries(awards.goldenBoy || {}).filter(([, [id]]) => id).map(([y, [id]]) => [id, Number(y)]));
// Особисті нагороди гравця: [[назва, [роки]]] — null, якщо невідомо нічого
function awardList(p, h) {
  const own = [];
  if (fifproYears.has(p.id)) own.push(['FIFPRO World 11', fifproYears.get(p.id)]);
  if (goldenBoyYear.has(p.id)) own.push(['Golden Boy', [goldenBoyYear.get(p.id)]]);
  if (!h?.ind && !own.length) return null;
  return [...(h?.ind || []).filter(([l]) => !GBOY_LABEL.test(l) && !(FIFPRO_LABEL.test(l) && !FIFPRO_RESERVE.test(l))), ...own];
}
function awardsScore(list) {
  if (!list) return 0;
  let sum = 0;
  for (const [label, years] of list) {
    const [w, country] = awardKind(label);
    if (!w) continue;
    for (const y of years.length ? years : [null]) sum += country ? w * leagueStrength(country, y) : w;
  }
  return sum;
}

// ——— «Золотий м'яч»: очки за місця в усі роки
const BALLON_PTS = [0, 10, 6, 4.5, 3, 2.5, 2, 1.7, 1.4, 1.2, 1];
const ballonOf = new Map();
for (const rows of Object.values(ballon)) {
  for (const [id, place] of rows) if (id) ballonOf.set(id, (ballonOf.get(id) || 0) + (BALLON_PTS[place] ?? (place <= 30 ? 0.4 : 0)));
}

// «Золоті м'ячі», які France Football у 2015 присудив заднім числом (Пеле ×7: тоді неєвропейцям не давали) — як перші місця
const retroBallon = (h) => (h?.ind || []).filter(([l]) => /france football'?s? ballon d'or/i.test(l)).reduce((s, [, ys]) => s + ys.length * BALLON_PTS[1], 0);

// ——— Показники одного гравця: { назва: число | null }
function metricsOf(p) {
  const c = careerOf(p);
  const s = statsOf(p);
  const x = s?.x, t = s?.t;
  const clubs = (c?.clubs || []).filter((k) => k.a > 0);
  const apps = clubs.reduce((n, k) => n + k.a, 0);
  const goals = clubs.reduce((n, k) => n + (k.g || 0), 0);
  const h = honoursOf(p);
  const tr = transfers[p.id];
  // рівень клубів: сила ліги за роками кожного етапу, зважена матчами; сезони на топрівні — роки в лігах топ-5 УЄФА того року.
  // Рейтинг УЄФА — з 1979: роки до нього не рахуємо зовсім (ні «за», ні «проти»), сезони на топрівні — пропорційно всій кар'єрі.
  let level = 0, levelApps = 0, top = 0, covered = 0, years = 0;
  for (const k of clubs) {
    const country = clubCountry(k.t);
    const end = k.e || new Date().getFullYear();
    const len = Math.max(1, end - k.s);
    let inRange = 0, sum = 0;
    for (let y = k.s + 1; y <= Math.max(end, k.s + 1); y++) {
      years++;
      if (y < YEARS[0]) continue;
      inRange++; covered++;
      sum += leagueStrength(country, y);
      const r = ranks[y] && Object.entries(ranks[y]).find(([n]) => n === country || (ALIAS[country] || []).includes(n));
      if (r && r[1][0] <= 5) top++;
    }
    if (inRange) { level += (k.a * inRange / len) * (sum / inRange); levelApps += k.a * inRange / len; }
  }
  // «Золотий м'яч» до 1995 — лише для європейців: позаєвропейцю без 5+ сезонів після 1995 відсутній — не мінус, а «невідомо»
  const european = isEuropean(c?.nation?.t);
  const after95 = clubs.reduce((n, k) => n + Math.max(0, (k.e || new Date().getFullYear()) - Math.max(k.s, 1995)), 0);
  const trophies = h
    ? (h.ucl || 0) * 5 + (h.wc || 0) * 6 + ((h.euro || 0) + (h.copa || 0)) * 4 + (h.league || 0) * 2 + (h.uel || 0) * 2
      + ((h.afcon || 0) + (h.nl || 0) + (h.intl || 0) + (h.lib || 0) + (h.olympic || 0)) * 1.5 + ((h.cwc || 0) + (h.usc || 0) + (h.cont || 0)) * 0.5 + (h.cups || 0) * 0.5
    : null;
  const per90 = (v) => (v * 90) / x.min;
  return {
    cleanSheets: x && x.full >= 30 ? x.cs / x.full : null,
    conceded: x && x.full >= 30 ? x.conc / x.full : null,
    goals: apps >= 50 ? goals / apps : null,
    assists: x ? per90(t[1]) : null,
    ucl: x ? x.clG + x.clA : null,
    yellows: x ? per90(t[3]) : null,
    reds: x ? per90(x.red) : null,
    winRate: x ? x.win / t[2] : null,
    regularity: x ? x.min / t[2] : null,
    peakValue: tr?.maxValue ? Math.log10(tr.maxValue) : null,
    caps: c?.nation ? c.nation.a || 0 : 0,
    intlGoals: c?.nation ? c.nation.g || 0 : 0,
    trophies,
    awards: h || awardList(p, h) ? awardsScore(awardList(p, h)) : null,
    ballon: (ballonOf.get(p.id) || 0) + retroBallon(h) || (european === false && after95 < 5 ? null : 0),
    // рейтингом УЄФА покрито менше половини кар'єри (Еусебіо — лише кінець) — картина хибна, краще «невідомо»
    clubLevel: levelApps && covered >= years / 2 ? level / levelApps : null,
    topSeasons: covered && covered >= years / 2 ? (top * years) / covered : null,
    fame: p.rawFame ?? p.fame ?? null, // мовних розділів Вікіпедії
  };
}

// ——— Довідковий пул і перцентилі
const REF_SIZE = 1500;
const CALIBRATION = 700; // середній з них у своїй групі = RATING_MID
const RATING_MID = 76;
const RATING_STEP = 8; // за одне стандартне відхилення
let cache = null;
function build() {
  const ref = players.filter((p) => groupOf(p)).map((p) => ({ p, r: recognition(p) }))
    .sort((a, b) => b.r - a.r).slice(0, REF_SIZE).map((x) => x.p);
  const rows = ref.map((p) => ({ p, g: groupOf(p), m: metricsOf(p), modern: !!statsOf(p) }));
  // Показник → відстань від середнього своєї групи в стандартних відхиленнях (z), лічильники — через log.
  // Не перцентиль: у еліти різниця саме в «хвості» (нагороди 92 проти 41 — це не 0,99 проти 0,95).
  const val = (k, v) => (LOG.has(k) ? Math.log1p(Math.max(0, v)) : v);
  const dist = {};
  for (const g of GROUPS) {
    dist[g] = {};
    for (const k of Object.keys(WEIGHTS)) {
      const vs = rows.filter((r) => r.g === g && r.m[k] != null).map((r) => val(k, r.m[k]));
      const mean = vs.reduce((s, v) => s + v, 0) / (vs.length || 1);
      const sd = Math.sqrt(vs.reduce((s, v) => s + (v - mean) ** 2, 0) / (vs.length || 1)) || 1;
      dist[g][k] = { mean, sd };
    }
  }
  for (const r of rows) {
    const gi = GROUPS.indexOf(r.g);
    let sum = 0, wsum = 0;
    r.parts = {};
    for (const [k, ws] of Object.entries(WEIGHTS)) {
      const w = ws[gi] * (IMPORTANCE[k] ?? 1);
      if (!w || r.m[k] == null) continue;
      const { mean, sd } = dist[r.g][k];
      const z = Math.max(-Z_CLIP, Math.min(Z_CLIP, (val(k, r.m[k]) - mean) / sd));
      const v = w > 0 ? z : -z;
      r.parts[k] = v;
      sum += Math.abs(w) * v; wsum += Math.abs(w);
    }
    // мало даних — ближче до середнього (0): SHRINK уявних «середніх» ваг у знаменнику
    r.score = sum / (wsum + SHRINK);
  }
  // підсумок: на скільки бал вищий за середній у своїй групі серед CALIBRATION найвідоміших (z) → RATING_MID + RATING_STEP × z.
  // Не місце в рейтингу, а відстань — розриви між гравцями зберігаються (Мессі помітно вище за «просто хорошого» нападника).
  const known = new Set(rows.slice(0, CALIBRATION).map((r) => r.p.id));
  for (const g of GROUPS) {
    const cal = rows.filter((r) => r.g === g && known.has(r.p.id)).map((r) => r.score);
    const mean = cal.reduce((s, v) => s + v, 0) / (cal.length || 1);
    const sd = Math.sqrt(cal.reduce((s, v) => s + (v - mean) ** 2, 0) / (cal.length || 1)) || 1;
    for (const r of rows) if (r.g === g) r.rating = Math.max(40, Math.min(99, Math.round(RATING_MID + RATING_STEP * ((r.score - mean) / sd))));
  }
  return new Map(rows.map((r) => [r.p.id, r]));
}
const table = () => (cache ||= build());

// { rating, group, modern } | null — гравця немає в довідковому пулі або невідома позиція
function ratingOf(p) {
  const r = table().get(p.id);
  return r ? { rating: r.rating, group: r.g, modern: r.modern } : null;
}

// ——— «Сила за» одним показником (режим гри): значення показника → місце серед пулу гри → 40…99.
// overall — загальний рейтинг вище. Асисти (з 2012) і вартість (≈з 2004) у легенд невідомі — ці режими беруть лише сучасний пул.
const BASES = {
  overall: { modern: false },
  value: { modern: true, of: (p) => transfers[p.id]?.maxValue || 0 }, // пікова ринкова вартість, €
  goals: { modern: false, of: (p) => { const c = careerOf(p); return (c?.clubs || []).reduce((n, k) => n + (k.g || 0), 0) + (c?.nation?.g || 0); } }, // клуби + збірна
  assists: { modern: true, of: (p) => statsOf(p)?.t[1] || 0 }, // усі змагання з 2012/13
  trophies: { modern: false, of: (p) => trophyCount(p) }, // командні трофеї + особисті нагороди
};
// Командні трофеї (honours: total) + особисті нагороди поштучно: «Золотий м'яч», світові й континентальні збірні, нагороди ліг;
// лише рівня ліги й вище (awardKind ≥ 1): без клубних, місячних, молодіжних, «залів слави» й рекордів.
function trophyCount(p) {
  const h = honoursOf(p);
  const list = awardList(p, h);
  if (!h && !list) return 0;
  let n = h?.total || 0;
  for (const [label, years] of list || []) {
    const ballonWin = /^(france football'?s? )?ballon d'or$/i.test(label);
    if (ballonWin || awardKind(label)[0] >= 1) n += Math.max(1, years.length);
  }
  return n;
}
const poolMode = (mode, basis) => (BASES[basis]?.modern ? 'modern' : mode);
const basisCache = new Map();
// Map(id → { rating, value }) для пулу гри; overall — рейтинг з таблиці, value — null
function basisTable(mode, basis) {
  const key = `${poolMode(mode, basis)}:${basis}`;
  if (basisCache.has(key)) return basisCache.get(key);
  const pool = windowPool(poolMode(mode, basis));
  let map;
  if (!BASES[basis]?.of) map = new Map(pool.map((p) => [p.id, { rating: table().get(p.id).rating, value: null }]));
  else {
    const vals = pool.map((p) => [p, BASES[basis].of(p)]);
    const sorted = vals.map(([, v]) => v).sort((a, b) => a - b);
    // місце серед пулу: середній ранг однакових значень → 40…99
    const pct = (v) => { const lo = sorted.indexOf(v), hi = sorted.lastIndexOf(v); return (lo + hi) / 2 / Math.max(1, sorted.length - 1); };
    map = new Map(vals.map(([p, v]) => [p.id, { rating: Math.round(40 + 59 * pct(v)), value: v }]));
  }
  basisCache.set(key, map);
  return map;
}

// Пул гри: 500 найвідоміших; modern — лише з повними даними з 2012
function windowPool(mode = 'all', size = 500) {
  return [...table().values()].filter((r) => mode !== 'modern' || r.modern)
    .map((r) => ({ r, k: recognition(r.p) })).sort((a, b) => b.k - a.k).slice(0, size).map((x) => x.r.p);
}

module.exports = { ratingOf, windowPool, basisTable, poolMode, BASES, trophyCount, metricsOf, groupOf, posOf, awardKind, leagueStrength, table, WEIGHTS, GROUPS, POS_GROUP, MODERN };
