// Збирає базу футболістів у server/data/players.json.
//
// Джерела:
//   • Wikidata — клуби (P54, включно з орендами), збірні, позиції (P413), імена EN/RU/UA, рік народження;
//     гравці чемпіонату України 2000–2014 (категорія en.wikipedia + періоди в українських клубах);
//     дати перебування в клубах + каденції тренерів (P6087) — для «грав у тренера»; дубль/молодіжні команди (P831) — академії;
//   • категорії Вікіпедії — трофеї (чемпіони світу/Європи, Копа, ЛЧ, ЛЄ, Золотий м'яч/бутса, 100+ матчів за збірну),
//     гравці ліг (en), чемпіони Італії/Іспанії/Німеччини (de), гравці дублів (en) — для академій;
//   • статті en.wikipedia — чемпіони АПЛ, кращі бомбардири ліг, 50+ голів за збірну, Golden Boy;
//   • server/data/players.js, manual-tags.js — ручні дані (300+ голів, 100+ передач, трансфери 100+ млн, вихованці…).
//
// Запуск: npm run build-players   (≈5–10 хв), далі npm run fetch-photos для нових гравців.

const fs = require('fs');
const path = require('path');
const curated = require('../server/data/players');
const manualTags = require('../server/data/manual-tags');
const shortNames = require('../server/data/manual-names');
const { categories } = require('../server/data/categories');

const OUT = path.join(__dirname, '..', 'server', 'data', 'players.json');
const { getJson, sparql, sleep, qidOf, values } = require('./lib/wikidata');

// Поріг «відомості» — кількість мовних версій статті у Вікіпедії.
const MIN_SITELINKS_CLUB = 35; // грав за один із наших клубів
const MIN_SITELINKS_NATION = 45; // зірки збірних без наших клубів (Пеле, Еусебіо…)
const MIN_SITELINKS_UKRAINE = 18; // українські клуби і збірна — нижчий поріг, щоб їх було достатньо
const MIN_SITELINKS_UPL = 5; // гравці чемпіонату України 2000–2014 (тег UPL0014) — для «Шляху футболіста»
const UPL_YEARS = [2000, 2014];

const TEAM_CODES = Object.fromEntries(categories.filter((c) => c.qid).map((c) => [c.qid, c.id]));
const POSITION_CODES = Object.fromEntries(categories.filter((c) => c.type === 'position').map((c) => [c.positionQid, c.id]));
const CLUB_QIDS = categories.filter((c) => c.type === 'club').map((c) => c.qid);
const NATION_QIDS = categories.filter((c) => c.type === 'nation').map((c) => c.qid);
const UA_QIDS = ['Q179075', 'Q172969', 'Q207462', 'Q175687', 'Q170403']; // Динамо, Шахтар, Металіст, Дніпро, збірна України
// Вінгерів у Wikidata записують по-різному: «winger» (підклас нападника — Ямаль, Азар) або «wing half»
// (підклас півзахисника — Неймар, Куарежма, Фігу). Щоб не було суперечок, вінгер — і нападник, і півзахисник.
const WINGER_POSITIONS = { Q11681748: ['FW', 'MF'], Q8025128: ['FW', 'MF'] };
const COACH_CODES = Object.fromEntries(categories.filter((c) => c.type === 'coach').map((c) => [c.coachQid, c.id]));
const ACADEMY_CODES = Object.fromEntries(categories.filter((c) => c.type === 'academy').map((c) => [c.clubQid, c.id]));

// Ручні гравці, чия стаття в en.wikipedia має уточнення в назві.
// Решту шукаємо спершу за точною назвою статті = ім'я (головна стаття — найвідоміший тезка), потім за підписом Wikidata.
const CURATED_WIKI = {
  'Ronaldo Nazário': 'Ronaldo (Brazilian footballer)',
  'Pedro Rodríguez': 'Pedro (footballer, born 1987)',
  'Pepe': 'Pepe (footballer, born February 1983)',
  'Marcelo': 'Marcelo (footballer, born 1988)',
  'Ederson': 'Ederson (footballer, born 1993)',
  'Xavi Hernández': 'Xavi (footballer, born 1980)',
  'Jorginho': 'Jorginho (footballer, born December 1991)',
};

// Категорії Вікіпедії → код
const WIKI_CATEGORIES = [
  ['uk', 'Категорія:Чемпіони світу з футболу', 'WC'],
  ['ru', 'Категория:Чемпионы мира по футболу', 'WC'],
  ['uk', 'Категорія:Чемпіони Європи з футболу', 'EURO'],
  ['ru', 'Категория:Чемпионы Европы по футболу', 'EURO'],
  ['ru', 'Категория:Чемпионы Южной Америки по футболу', 'COPA'],
  ['uk', 'Категорія:Переможці Ліги чемпіонів УЄФА', 'UCL'],
  ['uk', 'Категорія:Переможці Ліги Європи УЄФА', 'UEL'],
  ['ru', 'Категория:Обладатели «Золотого мяча»', 'BALLON'],
  ['ru', 'Категория:Обладатели «Золотой бутсы»', 'BOOT'],
  ['uk', 'Категорія:Футболісти, які зіграли 100 і більше матчів за збірну', 'CAPS100'],
  // гравці ліг
  ['en', 'Category:Premier League players', 'L_EPL'],
  ['en', 'Category:Serie A players', 'L_SA'],
  ['en', 'Category:La Liga players', 'L_LL'],
  ['en', 'Category:Bundesliga players', 'L_BL'],
  ['en', 'Category:Ligue 1 players', 'L_L1'],
  ['en', 'Category:Major League Soccer players', 'L_MLS'],
  ['en', 'Category:Chinese Super League players', 'L_CSL'],
  ['en', 'Category:UAE Pro League players', 'L_UAE'],
  // чемпіони країн (у категоріях є й тренери — далі лишаємо тільки тих, хто грав у цій лізі)
  ['de', 'Kategorie:Italienischer Meister (Fußball)', 'CH_IT'],
  ['de', 'Kategorie:Spanischer Meister (Fußball)', 'CH_ES'],
  ['de', 'Kategorie:Deutscher Meister (Fußball)', 'CH_DE'],
  // дублі й молодіжні команди — для «вихованців»
  ['en', 'Category:FC Barcelona Atlètic players', 'AC_BAR'],
  ['en', 'Category:FC Barcelona C players', 'AC_BAR'],
  ['en', 'Category:Real Madrid Castilla footballers', 'AC_RMA'],
  ['en', 'Category:Real Madrid C footballers', 'AC_RMA'],
  ['en', 'Category:Jong Ajax players', 'AC_AJX'],
  ['en', 'Category:FC Dynamo-2 Kyiv players', 'AC_DYN'],
  ['en', 'Category:FC Dynamo-3 Kyiv players', 'AC_DYN'],
  ['en', 'Category:S.L. Benfica B players', 'AC_BEN'],
  ['en', 'Category:Sporting CP B players', 'AC_SCP'],
  ['en', 'Category:FC Bayern Munich II players', 'AC_BAY'],
];

// Чемпіон країни / кращий бомбардир ліги — лише якщо гравець справді грав у цій лізі
const REQUIRES_LEAGUE = { CH_IT: 'L_SA', CH_ES: 'L_LL', CH_DE: 'L_BL' };

// Статті en.wikipedia: посилання на гравців (перетинаємо з базою).
// sections — беремо лише ці розділи (у статтях про бомбардирів є ще таблиці «за весь час» / «100+ голів» — вони не підходять)
const WIKI_LINK_PAGES = [
  ['List of Premier League winning players', 'APL', null, null],
  ['Pichichi Trophy', 'TS_LL', 'L_LL', /^(Winners|Men|Wins by player)/],
  ['Capocannoniere', 'TS_SA', 'L_SA', /^(Winners|Wins by player)/],
  ['Premier League Golden Boot', 'TS_EPL', 'L_EPL', /^(Winners|Multiple awards won by player)/],
  ['List of Bundesliga top scorers by season', 'TS_BL', 'L_BL', /^(Winners|Multiple winners)/],
  ['List of Ligue 1 top scorers', 'TS_L1', 'L_L1', /^(Top scorers by season|Wins by player)/],
  ["List of men's footballers with 50 or more international goals", 'G50N', null, null],
  ['Golden Boy (award)', 'GBOY', null, null],
];

// ── мережа
async function wikiApi(host, params) {
  const url = `https://${host}.wikipedia.org/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const j = await getJson(url);
  await sleep(700);
  return j;
}


// ── 1. Кандидати
async function fetchCandidates() {
  const block = (teams, min) => `{ VALUES ?team { ${values(teams)} } ?p p:P54/ps:P54 ?team ; wikibase:sitelinks ?sl . FILTER(?sl >= ${min}) }`;
  const rows = await sparql(`SELECT DISTINCT ?p ?sl WHERE {
    { ${block(CLUB_QIDS, MIN_SITELINKS_CLUB)} } UNION { ${block(NATION_QIDS, MIN_SITELINKS_NATION)} } UNION { ${block(UA_QIDS, MIN_SITELINKS_UKRAINE)} }
    ?p wdt:P106 wd:Q937857 .
    FILTER NOT EXISTS { ?p wdt:P21 ?g . FILTER(?g IN (wd:Q6581072, wd:Q1052281)) } # лише чоловічий футбол
  }`);
  return new Map(rows.map((r) => [qidOf(r.p), Number(r.sl)]));
}

// Гравці чемпіонату України 2000–2014: категорія en.wikipedia «Ukrainian Premier League players» (років там немає)
// ∩ період в українському клубі (Wikidata, країна команди — Україна), що перетинається з UPL_YEARS.
async function fetchUplCandidates() {
  const qids = [];
  let cont = {};
  do {
    const j = await wikiApi('en', {
      action: 'query', generator: 'categorymembers', gcmtitle: 'Category:Ukrainian Premier League players',
      gcmlimit: '500', gcmtype: 'page', prop: 'pageprops', ppprop: 'wikibase_item', ...cont,
    });
    for (const pg of j.query?.pages || []) if (pg.pageprops?.wikibase_item) qids.push(pg.pageprops.wikibase_item);
    cont = j.continue || null;
  } while (cont);
  const found = new Map();
  const [from, to] = UPL_YEARS;
  for (let i = 0; i < qids.length; i += 200) {
    const rows = await sparql(`SELECT ?p (MAX(?sl) AS ?s) WHERE { VALUES ?p { ${values(qids.slice(i, i + 200))} }
      ?p p:P54 ?st . ?st ps:P54 ?team . ?team wdt:P17 wd:Q212 . ?st pq:P580 ?b . OPTIONAL { ?st pq:P582 ?e }
      FILTER(YEAR(?b) <= ${to} && (!BOUND(?e) || YEAR(?e) >= ${from}))
      ?p wikibase:sitelinks ?sl . FILTER(?sl >= ${MIN_SITELINKS_UPL}) } GROUP BY ?p`);
    for (const r of rows) found.set(qidOf(r.p), Number(r.s));
  }
  return found;
}

// дата Wikidata → рік із дробом; точність «рік» (1 січня) трактуємо як середину року (літнє трансферне вікно)
function toYear(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(+d)) return null;
  if (d.getUTCMonth() === 0 && d.getUTCDate() === 1) return d.getUTCFullYear() + 0.5;
  return d.getUTCFullYear() + (d.getUTCMonth() + (d.getUTCDate() - 1) / 31) / 12;
}

// ── 2. Деталі гравців пачками
async function fetchDetails(qids, tenures) {
  const players = new Map();
  const teamQids = Object.keys(TEAM_CODES);
  const academyParents = Object.keys(ACADEMY_CODES);
  for (let i = 0; i < qids.length; i += 150) {
    const chunk = qids.slice(i, i + 150);
    const [labels, teams, positions, wingers, spells] = [
      await sparql(`SELECT ?p ?en ?ru ?uk ?enwiki ?ukwiki ?ruwiki ?dewiki ?born WHERE {
        VALUES ?p { ${values(chunk)} }
        OPTIONAL { ?p rdfs:label ?en FILTER(LANG(?en) = "en") }
        OPTIONAL { ?p rdfs:label ?ru FILTER(LANG(?ru) = "ru") }
        OPTIONAL { ?p rdfs:label ?uk FILTER(LANG(?uk) = "uk") }
        OPTIONAL { ?p wdt:P569 ?born }
        OPTIONAL { ?a schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enwiki }
        OPTIONAL { ?b schema:about ?p ; schema:isPartOf <https://uk.wikipedia.org/> ; schema:name ?ukwiki }
        OPTIONAL { ?c schema:about ?p ; schema:isPartOf <https://ru.wikipedia.org/> ; schema:name ?ruwiki }
        OPTIONAL { ?d schema:about ?p ; schema:isPartOf <https://de.wikipedia.org/> ; schema:name ?dewiki }
      }`),
      await sparql(`SELECT DISTINCT ?p ?team WHERE { VALUES ?p { ${values(chunk)} } VALUES ?team { ${values(teamQids)} }
        ?p p:P54 ?st . ?st ps:P54 ?team . FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank } }`),
      await sparql(`SELECT DISTINCT ?p ?base WHERE {
        VALUES ?p { ${values(chunk)} } VALUES ?base { ${values(Object.keys(POSITION_CODES))} }
        ?p p:P413/ps:P413 ?pos . ?pos wdt:P279* ?base . }`),
      await sparql(`SELECT DISTINCT ?p ?pos WHERE { VALUES ?p { ${values(chunk)} } VALUES ?pos { ${values(Object.keys(WINGER_POSITIONS))} }
        ?p p:P413/ps:P413 ?pos . }`),
      // усі періоди в командах з датами (клуби й збірні) + «батьківський клуб» для дублів/молодіжок
      await sparql(`SELECT ?p ?team ?start ?end ?parent WHERE { VALUES ?p { ${values(chunk)} }
        ?p p:P54 ?st . ?st ps:P54 ?team . FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
        OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end } OPTIONAL { ?team wdt:P831 ?parent } }`),
    ];
    for (const r of labels) {
      const qid = qidOf(r.p);
      if (players.has(qid)) continue;
      players.set(qid, {
        qid, en: r.en, ru: r.ru, uk: r.uk, enwiki: r.enwiki, ukwiki: r.ukwiki, ruwiki: r.ruwiki, dewiki: r.dewiki,
        born: r.born ? Number(r.born.slice(0, 4)) : undefined, tags: new Set(),
      });
    }
    for (const r of teams) players.get(qidOf(r.p))?.tags.add(TEAM_CODES[qidOf(r.team)]);
    for (const r of positions) players.get(qidOf(r.p))?.tags.add(POSITION_CODES[qidOf(r.base)]);
    for (const r of wingers) WINGER_POSITIONS[qidOf(r.pos)].forEach((t) => players.get(qidOf(r.p))?.tags.add(t));
    for (const r of spells) {
      const p = players.get(qidOf(r.p));
      if (!p) continue;
      const team = qidOf(r.team);
      if (r.parent && academyParents.includes(qidOf(r.parent))) p.tags.add(ACADEMY_CODES[qidOf(r.parent)]);
      // «грав у тренера»: періоди в одному клубі перетинаються щонайменше на 3 місяці
      const s = toYear(r.start);
      if (s == null) continue;
      const e = toYear(r.end) ?? 2026.9;
      for (const t of tenures) {
        if (t.team === team && Math.min(e, t.e) - Math.max(s, t.s) >= 0.25) p.tags.add(t.code);
      }
    }
    console.log(`  деталі: ${Math.min(i + 150, qids.length)}/${qids.length}`);
  }
  return players;
}

// Каденції тренерів: клуби — усі; збірні — лише завершені. Поточну збірну (напр. Зідан — Франція з 2026) не беремо:
// у Wikidata в багатьох гравців членство у збірній без дати кінця, і всі нинішні збірники «зараховувались» би новому тренеру.
// Каденції, де тренер був асистентом, а не головним (у Wikidata ролі майже не позначені)
const ASSISTANT_TENURES = [
  ['Q174614', 'Q676899'], // Анчелотті — збірна Італії 1992–1995, асистент Саккі
];

async function fetchCoachTenures() {
  const rows = await sparql(`SELECT ?c ?team ?start ?end ?nt WHERE { VALUES ?c { ${values(Object.keys(COACH_CODES))} }
    ?c p:P6087 ?st . ?st ps:P6087 ?team .
    OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end }
    BIND(EXISTS { ?team wdt:P31/wdt:P279* wd:Q6979593 } AS ?nt) }`);
  return rows
    .filter((r) => r.nt !== 'true' || r.end)
    .filter((r) => !ASSISTANT_TENURES.some(([c, t]) => c === qidOf(r.c) && t === qidOf(r.team)))
    .map((r) => ({ code: COACH_CODES[qidOf(r.c)], team: qidOf(r.team), s: toYear(r.start), e: toYear(r.end) ?? 2026.9 }))
    .filter((t) => t.s != null);
}

// Поточні каденції у збірних (Анчелотті — Бразилія, Зідан — Франція): у Wikidata членство у збірній часто без дати кінця,
// тож «гравців тренера» беремо з Вікіпедії — розділи «Current squad» і «Recent call-ups» статті про збірну (виклик не раніше
// початку каденції) та заявка на ЧС-2026, якщо тренером у ній був саме він.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WORLD_CUP_2026 = 2026.45; // червень 2026

async function wikitext(title) {
  const j = await wikiApi('en', { action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: title, redirects: '1' });
  return j.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content || '';
}

// Розділ статті від заголовка «=== name ===» до наступного заголовка.
function section(text, name) {
  const m = text.match(new RegExp(`\n(=+)\s*${name}\s*=+\s*\n`, 'i'));
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(new RegExp(`\n={2,${m[1].length}}[^=]`));
  return next === -1 ? rest : rest.slice(0, next);
}

// «latest=v. {{fb|AUS}}, 25 September 2026» / «[[2026 FIFA World Cup]]» → рік із дробом
function callupDate(latest) {
  const m = latest.match(new RegExp(`(${MONTHS.join('|')})\s+(\d{4})`, 'i'));
  if (m) return Number(m[2]) + MONTHS.indexOf(m[1].toLowerCase()) / 12;
  if (/2026 FIFA World Cup/.test(latest)) return WORLD_CUP_2026;
  const y = latest.match(/\b(20\d\d)\b/);
  return y ? Number(y[1]) + 0.5 : null;
}

const playerLink = (line) => line.match(/name\s*=\s*\[\[([^\]|#]+)/)?.[1]?.trim();

async function currentCoachCallups() {
  const rows = await sparql(`SELECT ?c ?start ?teamwiki ?coachEn WHERE { VALUES ?c { ${values(Object.keys(COACH_CODES))} }
    ?c p:P6087 ?st . ?st ps:P6087 ?team . FILTER NOT EXISTS { ?st pq:P582 ?e } OPTIONAL { ?st pq:P580 ?start }
    ?team wdt:P31/wdt:P279* wd:Q6979593 .
    ?a schema:about ?team ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?teamwiki .
    ?c rdfs:label ?coachEn FILTER(LANG(?coachEn) = "en") }`);
  const callups = new Map(); // назва статті гравця → Set<код тренера>
  const add = (title, code) => {
    if (!title) return;
    if (!callups.has(title)) callups.set(title, new Set());
    callups.get(title).add(code);
  };
  const wc = await wikitext('2026 FIFA World Cup squads');
  for (const r of rows) {
    const code = COACH_CODES[qidOf(r.c)];
    const start = toYear(r.start) ?? 0;
    const text = await wikitext(r.teamwiki);
    let n = 0;
    for (const line of section(text, 'Current squad').split('\n')) if (/nat fs g player/i.test(line) && playerLink(line)) { add(playerLink(line), code); n++; }
    for (const line of section(text, 'Recent call-ups').split('\n')) {
      const latest = line.match(/latest\s*=\s*([^|}]*(?:\{\{[^}]*\}\}[^|}]*)*)/)?.[1] || '';
      const d = callupDate(latest);
      if (/nat fs r player/i.test(line) && d != null && d >= start) { add(playerLink(line), code); n++; }
    }
    // заявка на ЧС-2026 — якщо тренером у ній був саме він
    const country = r.teamwiki.replace(/ (men's )?national (association )?football team$/i, '');
    const squad = section(wc, country);
    const surname = r.coachEn.split(' ').pop();
    if (start <= WORLD_CUP_2026 && new RegExp(`Coach:[^\n]*${surname}`).test(squad)) {
      for (const line of squad.split('\n')) if (/nat fs g player/i.test(line) && playerLink(line)) { add(playerLink(line), code); n++; }
    }
    console.log(`  ${code} — ${r.teamwiki}: викликів ${n}`);
  }
  return callups;
}

// ── 3. Категорії й посилання Вікіпедії
async function categoryMembers(host, title) {
  const titles = [];
  let cont = {};
  do {
    const j = await wikiApi(host, { action: 'query', list: 'categorymembers', cmtitle: title, cmlimit: '500', cmnamespace: '0', ...cont });
    titles.push(...j.query.categorymembers.map((m) => m.title));
    cont = j.continue || null;
  } while (cont);
  return titles;
}

// посилання лише з розділів, назва яких підходить під regex
async function sectionLinks(title, sectionRe) {
  const j = await wikiApi('en', { action: 'parse', page: title, prop: 'sections', redirects: '1' });
  const titles = new Set();
  for (const sec of j.parse.sections.filter((x) => sectionRe.test(x.line))) {
    const l = await wikiApi('en', { action: 'parse', page: title, prop: 'links', section: sec.index, redirects: '1' });
    for (const link of l.parse.links || []) if (link.ns === 0 && link.exists !== false) titles.add(link.title);
  }
  return titles;
}

async function pageLinks(title) {
  const titles = new Set();
  let cont = {};
  do {
    const j = await wikiApi('en', { action: 'query', prop: 'links', titles: title, pllimit: '500', plnamespace: '0', redirects: '1', ...cont });
    for (const l of j.query.pages[0].links || []) titles.add(l.title);
    cont = j.continue || null;
  } while (cont);
  return titles;
}

// ── допоміжне
function normalize(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/ё/g, 'е').replace(/ґ/g, 'г').replace(/[’'`ʼ]/g, '')
    .replace(/\(.*?\)/g, '').replace(/[^a-zа-яіїєø0-9]+/g, ' ').trim();
}
const slugify = (s) => normalize(s).replace(/\s+/g, '-');
// «Месси, Лионель» → «Лионель Месси»; «Блохін Олег Володимирович» → «Олег Блохін»
function naturalOrder(s) {
  if (!s) return s;
  if (/^[^,]+, [^,]+$/.test(s)) return s.split(', ').reverse().join(' ');
  const m = s.match(/^(\S+) (\S+) \S+(?:ович|евич|йович|ьович|івна|ївна|овна|евна)$/);
  if (m) return `${m[2]} ${m[1]}`;
  // «Олег Владимирович Блохин» → «Олег Блохин»
  const r = s.match(/^(\S+) \S+(?:ович|евич|йович|ьович|івна|ївна|овна|евна) (\S+)$/);
  return r ? `${r[1]} ${r[2]}` : s;
}

async function main() {
  console.log('1/5 Кандидати з Wikidata…');
  const candidates = await fetchCandidates();
  const upl = await fetchUplCandidates();
  for (const [q, sl] of upl) if (!candidates.has(q)) candidates.set(q, sl);
  console.log(`  знайдено ${candidates.size} (з них УПЛ 2000–2014: ${upl.size})`);

  console.log('2/5 Клуби, збірні, позиції, тренери, академії…');
  const tenures = await fetchCoachTenures();
  console.log(`  каденцій тренерів (клуби + завершені у збірних): ${tenures.length}`);
  const players = await fetchDetails([...candidates.keys()], tenures);
  for (const q of upl.keys()) players.get(q)?.tags.add('UPL0014');

  console.log('3/5 Категорії Вікіпедії…');
  const byWikiTitle = { en: new Map(), uk: new Map(), ru: new Map(), de: new Map() };
  for (const p of players.values()) {
    for (const host of ['en', 'uk', 'ru', 'de']) if (p[`${host}wiki`]) byWikiTitle[host].set(p[`${host}wiki`], p);
  }
  for (const [host, title, code] of WIKI_CATEGORIES) {
    const members = await categoryMembers(host, title);
    let hits = 0;
    for (const t of members) {
      const p = byWikiTitle[host].get(t);
      if (p) { p.tags.add(code); hits++; }
    }
    console.log(`  ${code.padEnd(8)} ${title}: ${members.length} статей, у нашій базі ${hits}`);
  }

  console.log('  поточні тренери збірних — склади з Вікіпедії:');
  for (const [title, codes] of await currentCoachCallups()) {
    const p = byWikiTitle.en.get(title);
    if (p) codes.forEach((c) => p.tags.add(c));
  }

  console.log('4/5 Статті-списки (АПЛ, бомбардири, 50+ голів, Golden Boy)…');
  for (const [title, code, league, sectionRe] of WIKI_LINK_PAGES) {
    const links = sectionRe ? await sectionLinks(title, sectionRe) : await pageLinks(title);
    let hits = 0;
    for (const t of links) {
      const p = byWikiTitle.en.get(t);
      if (!p) continue;
      // на сторінках є й інші посилання — для АПЛ лишаємо тих, хто грав в Англії; для бомбардирів — у цій лізі
      if (code === 'APL' && !(['MUN', 'LIV', 'CHE', 'ARS', 'MCI', 'TOT', 'NEW', 'AVL'].some((c) => p.tags.has(c)) || p.tags.has('ENG'))) continue;
      if (league && !p.tags.has(league)) continue;
      p.tags.add(code);
      hits++;
    }
    console.log(`  ${code.padEnd(8)} ${title}: посилань ${links.size}, у базі ${hits}`);
  }
  // чемпіони країн — лише ті, хто грав у цій лізі (у категоріях є й тренери, напр. Гвардіола в «Deutscher Meister»)
  for (const p of players.values()) {
    for (const [code, league] of Object.entries(REQUIRES_LEAGUE)) if (p.tags.has(code) && !p.tags.has(league)) p.tags.delete(code);
  }

  console.log('5/5 Злиття з ручними даними…');
  const byName = new Map();
  for (const p of players.values()) {
    for (const n of [p.en, p.enwiki]) if (n) byName.set(normalize(n), p);
  }
  const diffs = [];
  let matched = 0;
  for (const c of curated) {
    const p = byWikiTitle.en.get(CURATED_WIKI[c.name] || c.name) || byName.get(normalize(c.name));
    const manual = [...c.nations, ...c.clubs, ...c.awards];
    if (p) {
      matched++;
      const missingInWikidata = c.clubs.filter((t) => !p.tags.has(t));
      if (missingInWikidata.length) diffs.push(`${c.name}: у Wikidata немає ${missingInWikidata.join(',')}`);
      manual.forEach((t) => p.tags.add(t));
      p.curated = c;
    } else {
      // немає у вибірці Wikidata — додаємо як є
      const qid = 'manual-' + slugify(c.name);
      players.set(qid, { qid, en: c.name, ru: c.ru, uk: c.uk, tags: new Set(manual), curated: c });
    }
  }
  console.log(`  ручних гравців: ${curated.length}, зіставлено з Wikidata: ${matched}`);
  const unmatched = curated.filter((c) => !byWikiTitle.en.get(CURATED_WIKI[c.name] || c.name) && !byName.get(normalize(c.name)));
  if (unmatched.length) console.log('  Не зіставлені (додані як є): ' + unmatched.map((c) => c.name).join(', '));
  const notInBase = [];
  for (const [name, tags] of Object.entries(manualTags)) {
    const p = byWikiTitle.en.get(name) || byName.get(normalize(name));
    // «-BAR» — прибрати помилковий тег з Wikidata
    if (p) tags.forEach((t) => (t.startsWith('-') ? p.tags.delete(t.slice(1)) : p.tags.add(t)));
    else notInBase.push(name);
  }
  // нормально для тренерів-«запобіжників», яких немає серед гравців бази
  if (notInBase.length) console.log(`  manual-tags: не в базі (${notInBase.length}): ${notInBase.join(', ')}`);
  if (diffs.length) console.log('  Розбіжності (клуби з ручного списку, яких немає у Wikidata — залишені):\n   ' + diffs.join('\n   '));

  // ── формуємо вихід
  const knownCodes = new Set([...categories.map((c) => c.id), 'UPL0014']);
  const usedIds = new Set();
  const out = [];
  for (const p of players.values()) {
    const tags = [...p.tags].filter((t) => knownCodes.has(t));
    // без жодного клубу чи збірної гравець у сітку не потрапить (гравці УПЛ лишаються — для «Шляху футболіста»)
    if (!tags.includes('UPL0014') && !tags.some((t) => categories.find((c) => c.id === t && (c.type === 'club' || c.type === 'nation')))) continue;
    const c = p.curated;
    // назва статті en.wikipedia надійніша за підпис Wikidata (там трапляється вандалізм, напр. «elpisha» замість Joaquín)
    const name = c?.name || (p.enwiki && p.enwiki.replace(/\s*\(.*\)$/, '')) || p.en;
    if (!name || /^Q\d+$/.test(name)) continue;
    const uk = c?.uk || shortNames[name] || naturalOrder(p.uk) || naturalOrder(p.ru) || name;
    const ru = c?.ru || naturalOrder(p.ru) || uk;
    let id = slugify(name);
    if (usedIds.has(id)) id = `${id}-${p.qid.toLowerCase()}`;
    usedIds.add(id);
    const aliases = new Set(c?.aliases || []);
    for (const a of [p.en, naturalOrder(p.uk), naturalOrder(p.ru), p.uk, p.ru]) if (a && a !== name && a !== uk && a !== ru && !/^[a-z]/.test(a)) aliases.add(a);
    out.push({
      id,
      qid: p.qid.startsWith('Q') ? p.qid : undefined,
      name,
      ru,
      uk,
      aliases: [...aliases],
      wiki: p.enwiki,
      born: p.born,
      fame: candidates.get(p.qid) || 100,
      tags: tags.sort(),
    });
  }
  out.sort((a, b) => b.fame - a.fame || a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{') + '\n');

  const counts = {};
  out.forEach((p) => p.tags.forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
  console.log(`\nГотово: ${out.length} гравців → ${path.relative(process.cwd(), OUT)}`);
  console.log(categories.map((c) => `${c.id}:${counts[c.id] || 0}`).join(' '));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { currentCoachCallups };
