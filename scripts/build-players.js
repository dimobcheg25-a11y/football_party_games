// Збирає базу футболістів у server/data/players.json.
//
// Джерела:
//   • Wikidata — клуби (P54, включно з орендами), збірні, позиції (P413), імена EN/RU/UA;
//   • категорії Вікіпедії — трофеї (чемпіони світу/Європи, Копа, ЛЧ, ЛЄ, Золотий м'яч/бутса, 100+ матчів за збірну);
//   • en.wikipedia «List of Premier League winning players» — чемпіони АПЛ;
//   • server/data/players.js — ручні дані (300+ голів, 100+ передач, трофеї, яких нема в категоріях, гарні імена).
//
// Запуск: npm run build-players   (≈1–2 хв), далі npm run fetch-photos для нових гравців.

const fs = require('fs');
const path = require('path');
const curated = require('../server/data/players');
const manualTags = require('../server/data/manual-tags');
const shortNames = require('../server/data/manual-names');
const { categories } = require('../server/data/categories');

const OUT = path.join(__dirname, '..', 'server', 'data', 'players.json');
const UA = 'football-games-grid9/1.0 (hobby project)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Поріг «відомості» — кількість мовних версій статті у Вікіпедії.
const MIN_SITELINKS_CLUB = 35; // грав за один із наших клубів
const MIN_SITELINKS_NATION = 45; // зірки збірних без наших клубів (Пеле, Еусебіо…)
const MIN_SITELINKS_UKRAINE = 18; // українські клуби і збірна — нижчий поріг, щоб їх було достатньо

const TEAM_CODES = Object.fromEntries(categories.filter((c) => c.qid).map((c) => [c.qid, c.id]));
const POSITION_CODES = Object.fromEntries(categories.filter((c) => c.type === 'position').map((c) => [c.positionQid, c.id]));
const CLUB_QIDS = categories.filter((c) => c.type === 'club').map((c) => c.qid);
const NATION_QIDS = categories.filter((c) => c.type === 'nation').map((c) => c.qid);
const UA_QIDS = ['Q179075', 'Q172969', 'Q207462', 'Q175687', 'Q170403']; // Динамо, Шахтар, Металіст, Дніпро, збірна України

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

// Категорії Вікіпедії → код трофея
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
];

// ── мережа
async function getJson(url, headers = {}, attempt = 0) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  } catch (e) {
    // обірване з'єднання / таймаут — пробуємо ще
    if (attempt >= 6) throw e;
    console.log(`  (мережева помилка: ${e.message}, повтор)`);
    await sleep(4000 * (attempt + 1));
    return getJson(url, headers, attempt + 1);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    const wait = 4000 * (attempt + 1);
    console.log(`  (HTTP ${res.status}, чекаю ${wait / 1000} с)`);
    await sleep(wait);
    return getJson(url, headers, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 120)}`);
  return res.json();
}

async function sparql(query) {
  const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query);
  const j = await getJson(url, { Accept: 'application/sparql-results+json' });
  return j.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

async function wikiApi(host, params) {
  const url = `https://${host}.wikipedia.org/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const j = await getJson(url);
  await sleep(700);
  return j;
}

const qidOf = (uri) => uri.split('/').pop();
const values = (qids) => qids.map((q) => 'wd:' + q).join(' ');

// ── 1. Кандидати
async function fetchCandidates() {
  const block = (teams, min) => `{ VALUES ?team { ${values(teams)} } ?p p:P54/ps:P54 ?team ; wikibase:sitelinks ?sl . FILTER(?sl >= ${min}) }`;
  const rows = await sparql(`SELECT DISTINCT ?p ?sl WHERE {
    { ${block(CLUB_QIDS, MIN_SITELINKS_CLUB)} } UNION { ${block(NATION_QIDS, MIN_SITELINKS_NATION)} } UNION { ${block(UA_QIDS, MIN_SITELINKS_UKRAINE)} }
    ?p wdt:P106 wd:Q937857 .
  }`);
  return new Map(rows.map((r) => [qidOf(r.p), Number(r.sl)]));
}

// ── 2. Деталі гравців пачками
async function fetchDetails(qids) {
  const players = new Map();
  const teamQids = Object.keys(TEAM_CODES);
  for (let i = 0; i < qids.length; i += 150) {
    const chunk = qids.slice(i, i + 150);
    const [labels, teams, positions] = [
      await sparql(`SELECT ?p ?en ?ru ?uk ?enwiki ?ukwiki ?ruwiki ?born WHERE {
        VALUES ?p { ${values(chunk)} }
        OPTIONAL { ?p rdfs:label ?en FILTER(LANG(?en) = "en") }
        OPTIONAL { ?p rdfs:label ?ru FILTER(LANG(?ru) = "ru") }
        OPTIONAL { ?p rdfs:label ?uk FILTER(LANG(?uk) = "uk") }
        OPTIONAL { ?p wdt:P569 ?born }
        OPTIONAL { ?a schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enwiki }
        OPTIONAL { ?b schema:about ?p ; schema:isPartOf <https://uk.wikipedia.org/> ; schema:name ?ukwiki }
        OPTIONAL { ?c schema:about ?p ; schema:isPartOf <https://ru.wikipedia.org/> ; schema:name ?ruwiki }
      }`),
      await sparql(`SELECT DISTINCT ?p ?team WHERE { VALUES ?p { ${values(chunk)} } VALUES ?team { ${values(teamQids)} }
        ?p p:P54 ?st . ?st ps:P54 ?team . FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank } }`),
      await sparql(`SELECT DISTINCT ?p ?base WHERE {
        VALUES ?p { ${values(chunk)} } VALUES ?base { ${values(Object.keys(POSITION_CODES))} }
        ?p p:P413/ps:P413 ?pos . ?pos wdt:P279* ?base . }`),
    ];
    for (const r of labels) {
      const qid = qidOf(r.p);
      if (players.has(qid)) continue;
      players.set(qid, { qid, en: r.en, ru: r.ru, uk: r.uk, enwiki: r.enwiki, ukwiki: r.ukwiki, ruwiki: r.ruwiki, born: r.born ? Number(r.born.slice(0, 4)) : undefined, tags: new Set() });
    }
    for (const r of teams) players.get(qidOf(r.p))?.tags.add(TEAM_CODES[qidOf(r.team)]);
    for (const r of positions) players.get(qidOf(r.p))?.tags.add(POSITION_CODES[qidOf(r.base)]);
    console.log(`  деталі: ${Math.min(i + 150, qids.length)}/${qids.length}`);
  }
  return players;
}

// ── 3. Категорії Вікіпедії
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

// ── 4. Чемпіони АПЛ: усі посилання зі сторінки-списку
async function premierLeagueWinners() {
  const titles = new Set();
  let cont = {};
  do {
    const j = await wikiApi('en', { action: 'query', prop: 'links', titles: 'List of Premier League winning players', pllimit: '500', plnamespace: '0', ...cont });
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
  console.log(`  знайдено ${candidates.size}`);

  console.log('2/5 Клуби, збірні, позиції…');
  const players = await fetchDetails([...candidates.keys()]);

  console.log('3/5 Трофеї з категорій Вікіпедії…');
  const byWikiTitle = { en: new Map(), uk: new Map(), ru: new Map() };
  for (const p of players.values()) {
    if (p.enwiki) byWikiTitle.en.set(p.enwiki, p);
    if (p.ukwiki) byWikiTitle.uk.set(p.ukwiki, p);
    if (p.ruwiki) byWikiTitle.ru.set(p.ruwiki, p);
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

  console.log('4/5 Чемпіони АПЛ…');
  const apl = await premierLeagueWinners();
  let aplHits = 0;
  for (const t of apl) {
    const p = byWikiTitle.en.get(t);
    // посилання на сторінці — переможці, але й клуби/сезони; лишаємо тільки гравців, що грали в Англії за наш клуб
    if (p && ['MUN', 'LIV', 'CHE', 'ARS', 'MCI', 'TOT'].some((c) => p.tags.has(c)) || (p && p.tags.has('ENG'))) {
      p.tags.add('APL');
      aplHits++;
    }
  }
  console.log(`  посилань ${apl.size}, чемпіонів у базі ${aplHits}`);

  console.log('5/5 Злиття з ручними даними…');
  const byName = new Map();
  for (const p of players.values()) {
    for (const n of [p.en, p.enwiki]) if (n) byName.set(normalize(n), p);
  }
  const diffs = [];
  let matched = 0;
  for (const c of curated) {
    const p = byWikiTitle.en.get(CURATED_WIKI[c.name] || c.name) || byName.get(normalize(c.name));
    const manualTags = [...c.nations, ...c.clubs, ...c.awards];
    if (p) {
      matched++;
      const missingInWikidata = c.clubs.filter((t) => !p.tags.has(t));
      if (missingInWikidata.length) diffs.push(`${c.name}: у Wikidata немає ${missingInWikidata.join(',')}`);
      manualTags.forEach((t) => p.tags.add(t));
      p.curated = c;
    } else {
      // немає у вибірці Wikidata — додаємо як є
      const qid = 'manual-' + slugify(c.name);
      players.set(qid, { qid, en: c.name, ru: c.ru, uk: c.uk, tags: new Set(manualTags), curated: c });
    }
  }
  console.log(`  ручних гравців: ${curated.length}, зіставлено з Wikidata: ${matched}`);
  const unmatched = curated.filter((c) => !byWikiTitle.en.get(CURATED_WIKI[c.name] || c.name) && !byName.get(normalize(c.name)));
  if (unmatched.length) console.log('  Не зіставлені (додані як є): ' + unmatched.map((c) => c.name).join(', '));
  const notInBase = [];
  for (const [name, tags] of Object.entries(manualTags)) {
    const p = byName.get(normalize(name));
    // «-BAR» — прибрати помилковий тег з Wikidata
    if (p) tags.forEach((t) => (t.startsWith('-') ? p.tags.delete(t.slice(1)) : p.tags.add(t)));
    else notInBase.push(name);
  }
  // нормально для тренерів-«запобіжників», яких немає серед гравців бази
  if (notInBase.length) console.log(`  manual-tags: не в базі (${notInBase.length}): ${notInBase.join(', ')}`);
  if (diffs.length) console.log('  Розбіжності (клуби з ручного списку, яких немає у Wikidata — залишені):\n   ' + diffs.join('\n   '));

  // ── формуємо вихід
  const knownCodes = new Set(categories.map((c) => c.id));
  const usedIds = new Set();
  const out = [];
  for (const p of players.values()) {
    const tags = [...p.tags].filter((t) => knownCodes.has(t));
    // без жодного клубу чи збірної гравець у сітку не потрапить
    if (!tags.some((t) => categories.find((c) => c.id === t && (c.type === 'club' || c.type === 'nation')))) continue;
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
