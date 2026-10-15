// Хто з гравців бази працював тренером (Wikidata: професія P106 = футбольний тренер Q628099) → server/data/coaches.json (список qid).
// Потрібно для рейтингу відомості (server/games/path/careers.js): у тренерів кількість мовних статей Вікіпедії (fame)
// роздута тренерською кар'єрою — Анчелотті чи Куман як гравці набагато складніші, ніж їхня відомість.
// Запуск: npm run build-coaches (після build-players, ≈1 хв).

const fs = require('fs');
const path = require('path');
const { sparql, values, qidOf, sleep } = require('./lib/wikidata');
const { players } = require('../server/data');

const OUT = path.join(__dirname, '..', 'server', 'data', 'coaches.json');

async function main() {
  const qids = players.map((p) => p.qid).filter(Boolean);
  const coaches = new Set();
  for (let i = 0; i < qids.length; i += 300) {
    const rows = await sparql(`SELECT ?p WHERE { VALUES ?p { ${values(qids.slice(i, i + 300))} } ?p wdt:P106 wd:Q628099 }`);
    for (const r of rows) coaches.add(qidOf(r.p));
    process.stdout.write(`\r  Wikidata: ${Math.min(i + 300, qids.length)}/${qids.length}`);
    await sleep(300);
  }
  fs.writeFileSync(OUT, JSON.stringify([...coaches].sort()));
  console.log(`\nТренерів серед гравців бази: ${coaches.size} → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
