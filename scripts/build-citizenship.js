// Громадянство гравців бази (Wikidata P27): лише росія, білорусь і Україна → server/data/citizenship.json ({ qid: ['RU', 'UA'] }).
// Потрібно для server/data/banned.js: громадян росії й білорусі не загадуємо (українців — ні, хоч би що писала Вікідата).
// Запуск: npm run build-citizenship (після build-players, ≈1 хв).

const fs = require('fs');
const path = require('path');
const { sparql, values, qidOf, sleep } = require('./lib/wikidata');
const players = require('../server/data/players.json'); // уся база, ще без відсіву

const OUT = path.join(__dirname, '..', 'server', 'data', 'citizenship.json');
const CODES = { Q159: 'RU', Q184: 'BY', Q212: 'UA' };

async function main() {
  const qids = players.map((p) => p.qid).filter(Boolean);
  const out = {};
  for (let i = 0; i < qids.length; i += 300) {
    const rows = await sparql(`SELECT ?p ?c WHERE { VALUES ?p { ${values(qids.slice(i, i + 300))} }
      ?p wdt:P27 ?c . VALUES ?c { ${values(Object.keys(CODES))} } }`);
    for (const r of rows) (out[qidOf(r.p)] ??= []).push(CODES[qidOf(r.c)]);
    process.stdout.write(`\r  Wikidata: ${Math.min(i + 300, qids.length)}/${qids.length}`);
    await sleep(300);
  }
  const sorted = Object.fromEntries(Object.keys(out).sort().map((q) => [q, [...new Set(out[q])].sort()]));
  fs.writeFileSync(OUT, JSON.stringify(sorted));
  console.log(`\nГравців з громадянством росії/білорусі/України: ${Object.keys(sorted).length} → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
