// Збирає кар'єри футболістів для «Шляху футболіста» у server/data/careers.json.
//
// Джерело — Wikidata: періоди в командах (P54) з роками (P580/P582), матчами (P1350) і голами (P1351).
// Матчі й голи там — лише чемпіонат (як в інфобоксі Вікіпедії). Гравці беруться з уже зібраної players.json,
// тож теги «Перехрестя» цей скрипт не змінює.
//
// Запуск: npm run build-careers   (≈2–4 хв)

const fs = require('fs');
const path = require('path');
const { sparql, qidOf, values } = require('./lib/wikidata');
const { categories } = require('../server/data/categories');
const players = require('../server/data/players.json');

const OUT = path.join(__dirname, '..', 'server', 'data', 'careers.json');

// Молодіжні/олімпійські/другі команди не показуємо — у кар'єрі лише дорослі клуби і головна збірна.
// «-2»/«-3» — другі й треті команди («Динамо-2»), але «Дніпро-1» — окремий клуб
// (другі команди здебільшого відсіюються ще раніше — у Wikidata в них є «батьківський клуб» P831)
const NOT_SENIOR = /\bU-?\d{2}\b|under-?\d{2}|\byouth\b|olympic|amateur|reserves?\b|\s(B|II|III)$|-(2|3)\b|^jong\s|юнацьк|молодіжн|олімпійськ|дубл/i;

// Для клубів із категорій — наша коротка назва (як у «Перехресті») і герб.
const OUR_TEAMS = Object.fromEntries(categories.filter((c) => c.qid && c.type === 'club').map((c) => [c.qid, c]));

const num = (v) => (v == null || v === '' ? null : Math.round(Number(v)));
const year = (v) => (v ? Number(String(v).slice(0, 4)) : null);

async function fetchSpells(qids) {
  const spells = [];
  for (let i = 0; i < qids.length; i += 100) {
    const chunk = qids.slice(i, i + 100);
    const rows = await sparql(`SELECT ?p ?team ?start ?end ?apps ?goals ?parent ?nt WHERE {
      VALUES ?p { ${values(chunk)} }
      ?p p:P54 ?st . ?st ps:P54 ?team . FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
      OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end }
      OPTIONAL { ?st pq:P1350 ?apps } OPTIONAL { ?st pq:P1351 ?goals }
      OPTIONAL { ?team wdt:P831 ?parent }
      BIND(EXISTS { ?team wdt:P31/wdt:P279* wd:Q6979593 } AS ?nt) }`);
    spells.push(...rows);
    console.log(`  періоди: ${Math.min(i + 100, qids.length)}/${qids.length}`);
  }
  return spells;
}

async function fetchTeams(teamQids) {
  const teams = {};
  for (let i = 0; i < teamQids.length; i += 300) {
    const chunk = teamQids.slice(i, i + 300);
    const rows = await sparql(`SELECT ?team ?uk ?ru ?en ?country WHERE {
      VALUES ?team { ${values(chunk)} }
      OPTIONAL { ?team rdfs:label ?uk FILTER(LANG(?uk) = "uk") }
      OPTIONAL { ?team rdfs:label ?ru FILTER(LANG(?ru) = "ru") }
      OPTIONAL { ?team rdfs:label ?en FILTER(LANG(?en) = "en") }
      OPTIONAL { ?team wdt:P17 ?c . ?c rdfs:label ?country FILTER(LANG(?country) = "uk") } }`);
    for (const r of rows) {
      const q = qidOf(r.team);
      if (teams[q]) continue;
      teams[q] = { uk: r.uk, ru: r.ru, en: r.en, country: r.country };
    }
    console.log(`  команди: ${Math.min(i + 300, teamQids.length)}/${teamQids.length}`);
  }
  return teams;
}

// «Футбольний клуб Динамо (Київ)» → «Динамо (Київ)»: прибираємо службові слова з назви.
function shortName(t) {
  const name = t.uk || t.ru || t.en || '';
  return name.replace(/^(футбольний клуб|фк|fc|ак|ac)\s+/i, '').replace(/\s+\((футбольний )?клуб\)$/i, '').trim();
}

async function main() {
  const qids = players.map((p) => p.qid).filter(Boolean);
  console.log(`Кар'єри для ${qids.length} гравців…`);
  const spells = await fetchSpells(qids);
  const teamQids = [...new Set(spells.map((r) => qidOf(r.team)))];
  const rawTeams = await fetchTeams(teamQids);

  const teams = {};
  const isSenior = (q) => {
    const t = rawTeams[q];
    return t && !NOT_SENIOR.test(`${t.en || ''} ${t.uk || ''}`);
  };
  // збірна — назвою країни («Україна», а не «збірна України з футболу»)
  const useTeam = (q, national = false) => {
    if (teams[q]) return;
    const our = OUR_TEAMS[q];
    const country = rawTeams[q].country || null;
    teams[q] = { name: our ? our.label : national && country ? country : shortName(rawTeams[q]), country };
    if (our) teams[q].cat = our.id;
  };

  const byPlayer = new Map();
  for (const r of spells) {
    const q = qidOf(r.p);
    if (!byPlayer.has(q)) byPlayer.set(q, []);
    byPlayer.get(q).push(r);
  }

  const careers = {};
  for (const [q, rows] of byPlayer) {
    const clubs = [];
    let nation = null;
    for (const r of rows) {
      const team = qidOf(r.team);
      if (r.parent || !isSenior(team)) continue;
      const spell = { t: team, s: year(r.start), e: year(r.end), a: num(r.apps), g: num(r.goals) };
      if (r.nt === 'true') {
        if (!nation || (spell.a || 0) > (nation.a || 0)) nation = spell;
      } else if (spell.s) {
        clubs.push(spell);
      }
    }
    clubs.sort((x, y) => x.s - y.s || (x.e ?? 9999) - (y.e ?? 9999));
    // один клуб двома записами поспіль (продовжили контракт) — один період
    const merged = [];
    for (const c of clubs) {
      const prev = merged[merged.length - 1];
      if (prev && prev.t === c.t && (prev.e == null || prev.e >= c.s - 1)) {
        prev.e = c.e == null || prev.e == null ? null : Math.max(prev.e, c.e);
        prev.a = prev.a != null && c.a != null ? prev.a + c.a : prev.a ?? c.a;
        prev.g = prev.g != null && c.g != null ? prev.g + c.g : prev.g ?? c.g;
      } else merged.push({ ...c });
    }
    if (!merged.length) continue;
    merged.forEach((c) => useTeam(c.t));
    if (nation) useTeam(nation.t, true);
    careers[q] = { clubs: merged, nation };
  }

  fs.writeFileSync(OUT, JSON.stringify({ teams, careers }) + '\n');
  const counts = Object.values(careers).map((c) => c.clubs.length);
  console.log(`Готово: ${Object.keys(careers).length} кар'єр, ${Object.keys(teams).length} команд, ` +
    `3+ клубів: ${counts.filter((n) => n >= 3).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
