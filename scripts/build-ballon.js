// Рейтинги «Золотого м'яча» по роках (1956–…, без 2020-го — не вручали) — з таблиць статей англійської Вікіпедії
// («2008 Ballon d'Or», «2012 FIFA Ballon d'Or») → server/data/ballon.json:
//   { [рік]: [[id гравця | null, місце, очки | null, (ім'я, якщо гравця немає в базі)], …] } за місцем.
// Очки: до 2009 і з 2016 — бали голосування; 2010–2015 (FIFA Ballon d'Or) — відсотки голосів, тому очки null (місце є).
// Беремо лише чоловічий рейтинг — таблиці в розділах про жінок, тренерів, Кубок Копа, Яшина тощо пропускаємо.
// Гравців росії й білорусі не пишемо зовсім. Гравців зіставляємо через посилання → Wikidata → база (як build-tournaments).
// Запуск: npm run build-ballon (≈1 хв, після build-players).

const fs = require('fs');
const path = require('path');
const { text, grid, qidsOf, fetchHtml } = require('./lib/wikipedia');
const { sleep, sparql, values, qidOf } = require('./lib/wikidata');
const { players, normalize } = require('../server/data');
const { isBanned } = require('../server/data/banned');
const rawPlayers = require('../server/data/players.json');

const OUT = path.join(__dirname, '..', 'server', 'data', 'ballon.json');
const FIRST = 1956;
const LAST = new Date().getFullYear();
// розділи з іншими нагородами в тих самих статтях
const OTHER = /women|féminin|feminin|coach|puskás|puskas|kopa|yashin|müller|muller|sócrates|socrates|world xi|club of the year|striker|fair play|presidential|references|nominees by|see also/i;

const pageOf = (y) => (y >= 2010 && y <= 2015 ? `${y}_FIFA_Ballon_d%27Or` : `${y}_Ballon_d%27Or`);

// Таблиці основного рейтингу: [{ title, rank, points, nation }].
function parsePage(html) {
  const rows = [];
  // заголовок, під яким стоїть таблиця, — останній перед нею
  const parts = html.split(/(?=<h[2-4][\s>])/);
  for (const part of parts) {
    const heading = text((part.match(/^<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/) || [])[1] || '');
    if (OTHER.test(heading)) continue;
    for (const tb of part.split('<table').slice(1)) {
      const body = tb.split('</table>')[0];
      const lines = grid(body.match(/<tr[\s\S]*?<\/tr>/g) || []);
      if (lines.length < 3) continue;
      const head = lines[0].map((c) => text(c || ''));
      const rc = head.findIndex((h) => /^(Rank|Pos|Place)/i.test(h));
      const pc = head.findIndex((h) => /^(Player|Name)/i.test(h));
      const sc = head.findIndex((h) => /^(Points|Pts|Votes)/i.test(h));
      const nc = head.findIndex((h) => /^(Nationality|National team|Country)/i.test(h));
      if (rc === -1 || pc === -1) continue;
      let last = null;
      for (const line of lines.slice(1)) {
        const clean = (line[pc] || '').replace(/<span[^>]*class="[^"]*flagicon[\s\S]*?<\/span>/g, '');
        const m = clean.match(/<a[^>]*rel="mw:WikiLink"[^>]*title="([^"]+)"/);
        if (!m) continue;
        const r = Number((text(line[rc] || '').match(/\d+/) || [])[0]) || last;
        if (!r) continue;
        last = r;
        const pts = sc === -1 ? null : Number(text(line[sc] || '').replace(/[^\d]/g, '')) || null;
        rows.push({ title: m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'"), rank: r, points: pts, nation: nc === -1 ? '' : text(line[nc] || '') });
      }
    }
  }
  return rows;
}

async function main() {
  const byQid = new Map(players.filter((p) => p.qid).map((p) => [p.qid, p]));
  const banned = new Set(rawPlayers.filter((p) => isBanned(p)).map((p) => p.qid));
  const byName = new Map();
  for (const p of players) {
    const k = normalize(p.name);
    byName.set(k, byName.has(k) ? null : p);
  }
  const result = {};
  for (let y = FIRST; y <= LAST; y++) {
    if (y === 2020) continue;
    let html;
    try {
      html = await fetchHtml(pageOf(y));
    } catch (e) {
      if (/HTTP 404/.test(e.message)) { console.log(`${y}: статті немає`); continue; }
      throw e;
    }
    const rows = parsePage(html);
    if (!rows.length) { console.log(`${y}: таблиці рейтингу немає`); continue; }
    const qids = await qidsOf([...new Set(rows.map((r) => r.title))]);
    // кого немає в базі (радянські гравці тощо) — за Wikidata: громадянство росії/білорусі без України, або лише радянське
    // громадянство й народився на території росії/білорусі (Яшин) — не пишемо
    const outside = [...new Set(rows.map((r) => qids.get(r.title)).filter((q) => q && !byQid.has(q) && !banned.has(q)))];
    if (outside.length) {
      const cit = new Map();
      const add = (q, c) => (cit.get(q) || cit.set(q, new Set()).get(q)).add(c);
      for (const r of await sparql(`SELECT ?p ?c ?b WHERE { VALUES ?p { ${values(outside)} }
        { ?p wdt:P27 ?c } UNION { ?p wdt:P19 ?place . ?place wdt:P17 ?b } }`)) {
        if (r.c) add(qidOf(r.p), qidOf(r.c));
        if (r.b) add(qidOf(r.p), 'born:' + qidOf(r.b));
      }
      const HOSTILE = ['Q159', 'Q184'];
      for (const [q, set] of cit) {
        if (set.has('Q212') || set.has('born:Q212')) continue;
        if (HOSTILE.some((c) => set.has(c)) || (set.has('Q15180') && HOSTILE.some((c) => set.has('born:' + c)))) banned.add(q);
      }
    }
    const list = [];
    const seen = new Set();
    const missing = [];
    for (const r of rows) {
      const qid = qids.get(r.title);
      if (banned.has(qid) || /^(Russia|Belarus)\b/i.test(r.nation)) continue;
      const p = byQid.get(qid) || byName.get(normalize(r.title.replace(/\s*\(.*\)$/, ''))) || null;
      const key = p ? p.id : r.title;
      if (seen.has(key)) continue; // 2012: перша трійка й решта — у двох таблицях
      seen.add(key);
      if (p) list.push([p.id, r.rank, r.points]);
      else { list.push([null, r.rank, r.points, r.title.replace(/\s*\(.*\)$/, '')]); missing.push(r.title); }
    }
    list.sort((a, b) => a[1] - b[1]);
    result[y] = list;
    console.log(`${y}: ${list.length} у рейтингу, немає в базі ${missing.length}${missing.length ? `: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}` : ''}`);
    await sleep(300);
  }
  fs.writeFileSync(OUT, JSON.stringify(result));
  console.log(`Готово: ${Object.keys(result).length} років → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
