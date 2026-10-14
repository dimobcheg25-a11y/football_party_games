// Збирає кар'єри футболістів для «Шляху футболіста» у server/data/careers.json.
//
// Основне джерело — таблиця кар'єри в інфобоксі статті en.wikipedia ({{Infobox football biography}}: years/clubs/caps/goals,
// оренди позначені «→ … (loan)», збірні — nationalteam/nationalcaps). Вона повніша й свіжіша за Wikidata.
// Запасне джерело (статті без таблиці) — Wikidata: періоди в командах (P54) з роками, матчами (P1350) і голами (P1351).
// Матчі й голи — лише чемпіонат. Гравці беруться з уже зібраної players.json, теги «Перехрестя» скрипт не змінює.
//
// Назви клубів — українською з Wikidata (посилання таблиці → елемент Wikidata), країна — P17.
// Герби — головне зображення статті клубу en.wikipedia (pilicense=any, бо герби не вільні), запасний варіант — P154;
// прапори збірних — P41 країни. Зберігаємо посилання на мініатюри з upload.wikimedia.org.
//
// Запуск: npm run build-careers   (≈10 хв)

const fs = require('fs');
const path = require('path');
const { sparql, getJson, sleep, qidOf, values } = require('./lib/wikidata');
const { categories } = require('../server/data/categories');
const players = require('../server/data/players.json');

const OUT = path.join(__dirname, '..', 'server', 'data', 'careers.json');
const CREST_SIZE = 80;

// Молодіжні/олімпійські/другі команди не показуємо — у кар'єрі лише дорослі клуби і головна збірна.
// «-2»/«-3» — другі й треті команди («Металург-2»), але «Дніпро-1» — окремий клуб.
// Назви перевіряємо кожною мовою окремо (суфікс « B» має бути в кінці саме своєї назви).
const NOT_SENIOR = /\bU-?\d{2}\b|under-?\d{2}|\byouth\b|olympic|amateur|reserves?\b|\s(B|C|II|III|Б|В)$|-(2|3)\b|^jong\s|castilla|atlètic|юнацьк|молодіжн|олімпійськ|дубл|кастілья/i;

// Справжні клуби, у назві яких є «II» чи « B» (не другі команди).
const SENIOR_EXCEPTIONS = /^(willem ii|віллем ii|виллем ii)/i;
const notSenior = (n) => NOT_SENIOR.test(n) && !SENIOR_EXCEPTIONS.test(n.replace(/^(fc|фк)\s+/i, ''));

// Регіональні збірні, що не є членами ФІФА (у таблицях стоять поряд зі справжніми: «Basque Country» у Вальверде).
const NOT_FIFA = /basque|catalonia|galicia|andalusia|corsica|brittany|padania|occitania|kurdistan|tibet|sápmi|zanzibar/i;

// Для клубів із категорій — наша коротка назва (як у «Перехресті») і герб.
const OUR_TEAMS = Object.fromEntries(categories.filter((c) => c.qid && c.type === 'club').map((c) => [c.qid, c]));

const num = (v) => (v == null || v === '' ? null : Math.round(Number(v)));
const year = (v) => (v ? Number(String(v).slice(0, 4)) : null);
const api = (params) =>
  getJson('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', redirects: '1', ...params }));

// Відповідь API → функція «запитана назва → сторінка» (з урахуванням нормалізації й перенаправлень).
function pageResolver(q = {}) {
  return (t) => {
    for (const n of q.normalized || []) if (n.from === t) t = n.to;
    for (const r of q.redirects || []) if (r.from === t) t = r.to;
    return (q.pages || []).find((p) => p.title === t);
  };
}

// ── 1. Інфобокси en.wikipedia
async function fetchInfoboxes(titles) {
  const texts = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const j = await api({ titles: chunk.join('|'), prop: 'revisions', rvprop: 'content', rvslots: 'main' });
    const page = pageResolver(j.query);
    for (const t of chunk) {
      const text = page(t)?.revisions?.[0]?.slots?.main?.content;
      if (text) texts.set(t, text);
    }
    if (i % 500 === 0) console.log(`  статті: ${Math.min(i + 50, titles.length)}/${titles.length}`);
    await sleep(300);
  }
  return texts;
}

// Параметри шаблону {{Infobox football biography …}}: ділимо за «|» верхнього рівня (не всередині [[…]] і {{…}}).
function infoboxParams(text) {
  const start = text.search(/\{\{\s*Infobox (football|soccer)/i);
  if (start === -1) return null;
  let depth = 0;
  let link = 0;
  let cur = '';
  const parts = [];
  for (let i = start + 2; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === '{{') { depth++; cur += two; i++; continue; }
    if (two === '}}') {
      if (depth === 0) { parts.push(cur); break; }
      depth--; cur += two; i++; continue;
    }
    if (two === '[[') { link++; cur += two; i++; continue; }
    if (two === ']]') { link = Math.max(0, link - 1); cur += two; i++; continue; }
    if (text[i] === '|' && depth === 0 && link === 0) { parts.push(cur); cur = ''; continue; }
    cur += text[i];
  }
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return params;
}

const stripRefs = (v) => String(v || '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '').replace(/<!--[\s\S]*?-->/g, '');
function cleanNum(v) {
  // посилання — лише підпис: «[[List of … 100 or more caps|208]]» → 208 (а не 100 з назви статті)
  const m = stripRefs(v).replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, '').match(/-?\d+/);
  return m ? Math.abs(Number(m[0])) : null;
}
function parseYears(v) {
  const m = stripRefs(v).match(/(\d{4})\s*(?:[–—-]\s*(\d{4})?)?/);
  if (!m) return null;
  const s = Number(m[1]);
  const open = /[–—-]\s*$/.test(stripRefs(v).trim()) || (m[0].match(/[–—-]/) && !m[2]);
  return { s, e: m[2] ? Number(m[2]) : open ? null : s };
}
function linkOf(v) {
  const m = stripRefs(v).match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/);
  if (!m) return null;
  const title = m[1].trim();
  return { title: title[0].toUpperCase() + title.slice(1), label: (m[2] || m[1]).trim() };
}

function parseCareer(params) {
  const clubs = [];
  for (let i = 1; i <= 40; i++) {
    const club = params[`clubs${i}`];
    if (!club) continue;
    const link = linkOf(club);
    const yrs = parseYears(params[`years${i}`]);
    if (!link || !yrs) continue;
    clubs.push({ ...link, ...yrs, a: cleanNum(params[`caps${i}`]), g: cleanNum(params[`goals${i}`]), loan: /→|\(loan\)/i.test(club) });
  }
  let nation = null;
  for (let i = 1; i <= 15; i++) {
    const link = linkOf(params[`nationalteam${i}`]);
    if (!link || notSenior(link.title) || notSenior(link.label) || NOT_FIFA.test(link.title)) continue;
    const a = cleanNum(params[`nationalcaps${i}`]);
    if (!nation || (a || 0) >= (nation.a || 0)) nation = { ...link, a, g: cleanNum(params[`nationalgoals${i}`]) };
  }
  return { clubs, nation };
}

// ── 2. Посилання таблиць → елементи Wikidata + герби (головне зображення статті клубу)
async function resolveTitles(titles) {
  const out = new Map(); // назва статті → { qid, img }
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const j = await api({
      titles: chunk.join('|'), prop: 'pageprops|pageimages', ppprop: 'wikibase_item',
      piprop: 'thumbnail', pithumbsize: String(CREST_SIZE), pilicense: 'any',
    });
    const page = pageResolver(j.query);
    for (const t of chunk) {
      const p = page(t);
      if (p && !p.missing) out.set(t, { qid: p.pageprops?.wikibase_item || null, img: p.thumbnail?.source || null, title: p.title });
    }
    if (i % 1000 === 0) console.log(`  команди з таблиць: ${Math.min(i + 50, titles.length)}/${titles.length}`);
    await sleep(300);
  }
  return out;
}

// ── 3. Wikidata: періоди (запасне джерело) і дані команд
async function fetchSpells(qids) {
  const spells = [];
  for (let i = 0; i < qids.length; i += 100) {
    const chunk = qids.slice(i, i + 100);
    const rows = await sparql(`SELECT ?p ?team ?start ?end ?apps ?goals ?parent ?nt WHERE {
      VALUES ?p { ${values(chunk)} }
      ?p p:P54 ?st . ?st ps:P54 ?team . FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
      OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end }
      OPTIONAL { ?st pq:P1350 ?apps } OPTIONAL { ?st pq:P1351 ?goals }
      OPTIONAL { ?team wdt:P831 ?parent . ?parent wdt:P31 wd:Q476028 } # дубль — лише якщо «батько» футбольний клуб (у Барселони «батько» — спортивне товариство)
      BIND(EXISTS { ?team wdt:P31/wdt:P279* wd:Q6979593 } AS ?nt) }`);
    spells.push(...rows);
    if (i % 1000 === 0) console.log(`  періоди Wikidata: ${Math.min(i + 100, qids.length)}/${qids.length}`);
  }
  return spells;
}

async function fetchTeams(teamQids) {
  const teams = {};
  for (let i = 0; i < teamQids.length; i += 300) {
    const chunk = teamQids.slice(i, i + 300);
    const rows = await sparql(`SELECT ?team ?uk ?ru ?en ?country ?enwiki ?logo ?flag WHERE {
      VALUES ?team { ${values(chunk)} }
      OPTIONAL { ?team rdfs:label ?uk FILTER(LANG(?uk) = "uk") }
      OPTIONAL { ?team rdfs:label ?ru FILTER(LANG(?ru) = "ru") }
      OPTIONAL { ?team rdfs:label ?en FILTER(LANG(?en) = "en") }
      OPTIONAL { ?team wdt:P17 ?c . ?c rdfs:label ?country FILTER(LANG(?country) = "uk") OPTIONAL { ?c wdt:P41 ?flag } }
      OPTIONAL { ?team wdt:P154 ?logo }
      OPTIONAL { ?a schema:about ?team ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enwiki } }`);
    for (const r of rows) {
      const q = qidOf(r.team);
      if (teams[q]) continue;
      teams[q] = { uk: r.uk, ru: r.ru, en: r.en, country: r.country, enwiki: r.enwiki, logo: r.logo, flag: r.flag };
    }
    if (i % 1500 === 0) console.log(`  команди Wikidata: ${Math.min(i + 300, teamQids.length)}/${teamQids.length}`);
  }
  return teams;
}

// Мініатюра файлу Commons за посиланням Special:FilePath (Wikidata віддає саме такі).
const commonsThumb = (url) => url && `${url.replace(/^http:/, 'https:')}?width=${CREST_SIZE}`;

// «Футбольний клуб Динамо (Київ)» → «Динамо (Київ)»: прибираємо службові слова з назви.
function shortName(t) {
  const name = t.uk || t.ru || t.en || '';
  return name
    .replace(/^(футбольний клуб|футбольный клуб|фк|fc|ак|ac)\s+/i, '')
    .replace(/\s*\((футбольн\S* )?клуб\)$/i, '') // «Динамо Сухуми (футбольный клуб)»
    .replace(/\s*\(\d{4}\)$/, '') // «Алания Владикавказ(2019)»
    .trim();
}

// Один клуб кілька разів поспіль (оренда → викуп, продовжений контракт) — один період.
function mergeRuns(clubs) {
  const merged = [];
  for (const c of clubs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.t === c.t) {
      prev.e = c.e == null || prev.e == null ? null : Math.max(prev.e, c.e);
      prev.a = prev.a != null && c.a != null ? prev.a + c.a : prev.a ?? c.a;
      prev.g = prev.g != null && c.g != null ? prev.g + c.g : prev.g ?? c.g;
      prev.loan = prev.loan && c.loan;
    } else merged.push({ ...c });
  }
  return merged;
}

async function main() {
  const withQid = players.filter((p) => p.qid);
  console.log(`Кар'єри для ${withQid.length} гравців…`);

  console.log('1/4 Таблиці кар\'єри з en.wikipedia…');
  const infoboxes = await fetchInfoboxes(withQid.map((p) => p.wiki).filter(Boolean));
  const parsed = new Map(); // qid гравця → { clubs, nation }
  for (const p of withQid) {
    const params = p.wiki && infoboxes.has(p.wiki) ? infoboxParams(infoboxes.get(p.wiki)) : null;
    if (!params) continue;
    const c = parseCareer(params);
    if (c.clubs.length) parsed.set(p.qid, c);
  }
  console.log(`  таблиця є в ${parsed.size} з ${withQid.length}`);

  console.log('2/4 Клуби з таблиць → Wikidata + герби…');
  const linkTitles = new Set();
  for (const c of parsed.values()) {
    c.clubs.forEach((x) => linkTitles.add(x.title));
    if (c.nation) linkTitles.add(c.nation.title);
  }
  const resolved = await resolveTitles([...linkTitles]);

  console.log('3/4 Запасне джерело — Wikidata…');
  const fallbackQids = withQid.filter((p) => !parsed.has(p.qid)).map((p) => p.qid);
  // для гравців із таблицею без збірної — збірна з Wikidata теж знадобиться
  const nationQids = withQid.filter((p) => parsed.has(p.qid) && !parsed.get(p.qid).nation).map((p) => p.qid);
  const spells = await fetchSpells([...fallbackQids, ...nationQids]);

  const teamQids = new Set(spells.map((r) => qidOf(r.team)));
  for (const r of resolved.values()) if (r.qid) teamQids.add(r.qid);
  console.log('4/4 Назви, країни, прапори команд…');
  const rawTeams = await fetchTeams([...teamQids]);

  const teams = {};
  const isSenior = (key, extra = []) => {
    const t = rawTeams[key] || {};
    return ![t.en, t.uk, t.ru, ...extra].some((n) => n && notSenior(n));
  };
  // Ключ команди — qid Wikidata, а якщо статті немає у Wikidata — «w:назва статті».
  const useTeam = (key, { national = false, label = null, img = null } = {}) => {
    if (teams[key]) return;
    const raw = rawTeams[key] || { en: label };
    const our = OUR_TEAMS[key];
    const country = raw.country || null;
    // збірна — назвою країни («Україна», а не «збірна України з футболу»)
    teams[key] = { name: our ? our.label : national && country ? country : shortName(raw) || label, country };
    if (our) teams[key].cat = our.id;
    if (national) teams[key].national = true;
    const pic = national ? commonsThumb(raw.flag) : img || commonsThumb(raw.logo);
    if (pic && !our) teams[key].img = pic;
  };
  const fromLink = (x) => {
    const r = resolved.get(x.title);
    return { key: r?.qid || `w:${x.title}`, img: r?.img || null };
  };

  const byPlayer = new Map();
  for (const r of spells) {
    const q = qidOf(r.p);
    if (!byPlayer.has(q)) byPlayer.set(q, []);
    byPlayer.get(q).push(r);
  }
  const isGk = new Map(withQid.map((p) => [p.qid, p.tags.includes('GK')]));

  // Wikidata: клуби й збірна гравця (запасний варіант)
  function wikidataCareer(q) {
    const clubs = [];
    let nation = null;
    for (const r of byPlayer.get(q) || []) {
      const team = qidOf(r.team);
      if (r.parent || !isSenior(team)) continue;
      // у воротарів Wikidata часто пише в «голи» пропущені м'ячі — не показуємо
      const spell = { t: team, s: year(r.start), e: year(r.end), a: num(r.apps), g: isGk.get(q) ? null : num(r.goals) };
      if (r.nt === 'true') {
        if (!nation || (spell.a || 0) > (nation.a || 0)) nation = spell;
      } else if (spell.s || spell.e) {
        clubs.push(spell); // без року початку, але з роком кінця — теж (у Wikidata таке буває)
      }
    }
    const key = (c) => c.s ?? c.e;
    clubs.sort((x, y) => key(x) - key(y) || (x.e ?? 9999) - (y.e ?? 9999));
    return { clubs, nation };
  }

  const careers = {};
  let fromWiki = 0;
  for (const p of withQid) {
    const q = p.qid;
    let clubs;
    let nation = null;
    const wiki = parsed.get(q);
    if (wiki) {
      clubs = [];
      for (const x of wiki.clubs) {
        const { key, img } = fromLink(x);
        if (!isSenior(key, [x.title, x.label])) continue;
        useTeam(key, { label: x.label, img });
        clubs.push({ t: key, s: x.s, e: x.e, a: x.a, g: x.g, loan: x.loan || undefined });
      }
      if (wiki.nation) {
        const { key } = fromLink(wiki.nation);
        useTeam(key, { national: true, label: wiki.nation.label });
        nation = { t: key, a: wiki.nation.a, g: wiki.nation.g };
      } else {
        nation = wikidataCareer(q).nation;
      }
      fromWiki++;
    } else {
      ({ clubs, nation } = wikidataCareer(q));
      clubs.forEach((c) => useTeam(c.t));
    }
    if (nation && !teams[nation.t]) useTeam(nation.t, { national: true });
    const merged = mergeRuns(clubs);
    if (merged.length) careers[q] = { clubs: merged, nation, src: wiki ? 'wiki' : 'wd' };
  }

  // герби клубів, що прийшли лише з Wikidata (без статті в таблиці)
  const crestTitles = Object.entries(teams).filter(([k, t]) => !t.img && !t.cat && !t.national && rawTeams[k]?.enwiki).map(([k]) => rawTeams[k].enwiki);
  if (crestTitles.length) {
    const crests = await resolveTitles(crestTitles);
    for (const [k, t] of Object.entries(teams)) {
      const img = rawTeams[k]?.enwiki && crests.get(rawTeams[k].enwiki)?.img;
      if (!t.img && !t.cat && !t.national && img) t.img = img;
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({ teams, careers }) + '\n');
  const counts = Object.values(careers).map((c) => c.clubs.length);
  const withImg = Object.values(teams).filter((t) => t.img || t.cat).length;
  console.log(`Готово: ${Object.keys(careers).length} кар'єр (з таблиць Вікіпедії ${fromWiki}), ${Object.keys(teams).length} команд ` +
    `(із зображенням ${withImg}), 3+ клубів: ${counts.filter((n) => n >= 3).length}`);
}

// Розбір таблиці можна перевірити окремо: require('./build-careers') нічого не завантажує.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { infoboxParams, parseCareer, fetchInfoboxes };
