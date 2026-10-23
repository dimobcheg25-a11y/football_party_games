// Додаткові факти про гравців (для гри «Один на один») → server/data/facts.json:
// { qid: { h: зріст у см, dob: 'YYYY-MM-DD', views: перегляди статті en.wikipedia за останні 12 повних місяців } }.
// Зріст (P2048) і дата народження (P569, лише з точністю до дня) — з Wikidata пачками; перегляди — Wikimedia REST API.
// Зріст, якого немає у Wikidata, — з таблиці гравців transfermarkt-datasets (CC0; за tm id з transfers.json).
// Поля, яких немає, пропускаються. Продовжує з перерваного (прогрес — у facts.progress.json поруч); --fresh — заново;
// --tm — лише дописати зріст з Transfermarkt (≈10 с).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');
const { getJson, sparql, sleep, qidOf, values } = require('./lib/wikidata');

const DIR = path.join(__dirname, '..', 'server', 'data');
const OUT = path.join(DIR, 'facts.json');
const PROGRESS = path.join(DIR, 'facts.progress.json');
const players = require('../server/data/players.json');

// Одиниці зросту → см
const UNIT_CM = {
  Q11573: 100, // метр
  Q174728: 1, // сантиметр
  Q218593: 2.54, // дюйм
  Q3710: 30.48, // фут
};
const RANK = { 'http://wikiba.se/ontology#PreferredRank': 2, 'http://wikiba.se/ontology#NormalRank': 1 };

// Останні 12 повних місяців: від першого числа місяця рік тому до останнього дня минулого місяця
function monthsRange(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // останній день минулого місяця
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '') + '00';
  return [fmt(start), fmt(end)];
}

async function fetchWikidata(qids, out) {
  const rows = await sparql(`SELECT ?p ?kind ?a ?u ?t ?pr ?rank WHERE {
    VALUES ?p { ${values(qids)} }
    { ?p p:P2048 ?st . ?st psv:P2048 ?v . ?v wikibase:quantityAmount ?a ; wikibase:quantityUnit ?u . ?st wikibase:rank ?rank . BIND('h' AS ?kind) }
    UNION
    { ?p p:P569 ?st . ?st psv:P569 ?v . ?v wikibase:timeValue ?t ; wikibase:timePrecision ?pr . ?st wikibase:rank ?rank . BIND('d' AS ?kind) }
  }`);
  const best = {}; // qid → { h: [rank, см], d: [rank, дата] }
  for (const r of rows) {
    const rank = RANK[r.rank];
    if (!rank) continue; // застарілі (deprecated) значення не беремо
    const q = qidOf(r.p);
    const b = (best[q] ||= {});
    if (r.kind === 'h') {
      const k = UNIT_CM[qidOf(r.u)];
      if (!k) continue;
      const cm = Math.round(parseFloat(r.a) * k);
      if (cm < 150 || cm > 215) continue; // явні помилки
      if (!b.h || rank > b.h[0]) b.h = [rank, cm];
    } else {
      if (r.pr !== '11') continue; // лише з точністю до дня
      const m = /^\+?(\d{4})-(\d\d)-(\d\d)/.exec(r.t);
      if (!m) continue;
      if (!b.d || rank > b.d[0]) b.d = [rank, `${m[1]}-${m[2]}-${m[3]}`];
    }
  }
  for (const [q, b] of Object.entries(best)) {
    const o = (out[q] ||= {});
    if (b.h) o.h = b.h[1];
    if (b.d) o.dob = b.d[1];
  }
}

async function fetchViews(p, range, out) {
  const title = encodeURIComponent(p.wiki.replace(/ /g, '_'));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${title}/monthly/${range[0]}/${range[1]}`;
  try {
    const j = await getJson(url);
    const views = (j.items || []).reduce((s, it) => s + (it.views || 0), 0);
    if (views > 0) (out[p.qid] ||= {}).views = views;
  } catch (e) {
    if (!/HTTP 404/.test(e.message)) throw e; // 404 — статті немає або без переглядів
  }
}

// Рядок CSV з лапками → масив полів.
function csvFields(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Зріст з Transfermarkt тим, у кого його немає (Wikidata має перевагу).
async function fillHeightsFromTm(out) {
  let transfers = {};
  try { transfers = require('../server/data/transfers.json'); } catch { return 0; }
  const byTm = new Map();
  for (const p of players) if (p.qid && transfers[p.id]?.tm) byTm.set(String(transfers[p.id].tm), p.qid);
  const res = await fetch('https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/players.csv.gz');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rl = readline.createInterface({ input: Readable.fromWeb(res.body).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let head = null, n = 0;
  for await (const line of rl) {
    if (!line) continue;
    const f = csvFields(line);
    if (!head) { head = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
    const qid = byTm.get(f[head.player_id]);
    if (!qid || out[qid]?.h) continue;
    const cm = Number(f[head.height_in_cm]);
    if (cm >= 150 && cm <= 215) { (out[qid] ||= {}).h = cm; n++; }
  }
  return n;
}

(async () => {
  if (process.argv.includes('--tm')) {
    const out = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const n = await fillHeightsFromTm(out);
    fs.writeFileSync(OUT, JSON.stringify(out));
    console.log(`Зріст з Transfermarkt: +${n} гравців → ${path.relative(process.cwd(), OUT)}`);
    return;
  }
  const fresh = process.argv.includes('--fresh');
  let out = {};
  let progress = { wd: [], views: [] };
  if (!fresh) {
    try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* немає файлу */ }
    try { progress = JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch { /* немає */ }
  }
  const done = { wd: new Set(progress.wd), views: new Set(progress.views) };
  const save = () => {
    fs.writeFileSync(OUT, JSON.stringify(out));
    fs.writeFileSync(PROGRESS, JSON.stringify({ wd: [...done.wd], views: [...done.views] }));
  };

  // 1. Wikidata: зріст і дата народження
  const qids = [...new Set(players.map((p) => p.qid).filter(Boolean))].filter((q) => !done.wd.has(q));
  console.log(`Wikidata: лишилось ${qids.length}`);
  for (let i = 0; i < qids.length; i += 300) {
    const batch = qids.slice(i, i + 300);
    await fetchWikidata(batch, out);
    batch.forEach((q) => done.wd.add(q));
    save();
    console.log(`  ${Math.min(i + 300, qids.length)}/${qids.length}`);
    await sleep(1000); // Wikidata швидко відповідає 429 на часті запити
  }

  // 2. Перегляди англійської статті — по одному запиту, не частіше ~6 за секунду
  // (на паралельні пачки по 10 API відповідає 429)
  const range = monthsRange();
  const todo = players.filter((p) => p.qid && p.wiki && !done.views.has(p.qid));
  console.log(`Перегляди ${range[0]}–${range[1]}: лишилось ${todo.length}`);
  for (let i = 0; i < todo.length; i++) {
    const t0 = Date.now();
    await fetchViews(todo[i], range, out);
    done.views.add(todo[i].qid);
    if (i % 200 === 0) {
      save();
      console.log(`  ${i + 1}/${todo.length}`);
    }
    const wait = 160 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  save();
  console.log(`Зріст з Transfermarkt: +${await fillHeightsFromTm(out)}`);
  fs.writeFileSync(OUT, JSON.stringify(out));
  fs.unlinkSync(PROGRESS); // усе зібрано
  const vals = Object.values(out);
  console.log(`Готово: ${vals.length} гравців; зріст ${vals.filter((o) => o.h).length}, дата ${vals.filter((o) => o.dob).length}, перегляди ${vals.filter((o) => o.views).length} → ${path.relative(process.cwd(), OUT)}`);
})().catch((e) => { console.error(e); process.exit(1); });
