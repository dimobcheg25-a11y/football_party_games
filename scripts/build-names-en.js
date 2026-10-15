// Англійські назви клубів для англійської версії сайту → server/data/team-names-en.json ({ qid: 'назва' }).
// Беремо англійську мітку Wikidata і прибираємо службові «FC», «F.C.», «CF»…; збірні беруть назву країни (names-en.js).
// Запускати після build-careers (≈1 хв). Ручні правки — TEAM_FIX у server/data/names-en.js.
const fs = require('fs');
const path = require('path');
const { getJson, sleep } = require('./lib/wikidata');

const OUT = path.join(__dirname, '..', 'server', 'data', 'team-names-en.json');
const { teams } = require('../server/data/careers.json');

// «FC Barcelona» → «Barcelona», «Arsenal F.C.» → «Arsenal», «Valencia CF» → «Valencia»
function short(label) {
  return label
    .replace(/\s*\((?:football club|association football club|men's team|football)\)$/i, '')
    .replace(/^(?:U\.C\.|UC|LOSC|OSC|SSD|S\.S\.D\.|FC|F\.C\.|FK|SC|SK|AFC|AC|A\.C\.|AS|A\.S\.|SS|S\.S\.|SSC|S\.S\.C\.|US|U\.S\.|ACF|SV|VfL|VfB|TSG|RC|RCD|CD|CF|Club|NK|HNK|GNK|PFC|FK|KS|CA|SE|CR|RSC|KRC|KAA|KV|SL|SD|UD|CA)\s+/i, '')
    .replace(/\s+(?:F\.C\.|FC|CF|C\.F\.|AFC|A\.F\.C\.|SC|S\.C\.|FK|SK|BK|IF|CFC|F\.K\.|S\.A\.D\.|SAD|Calcio|OSC|1907|1909|1913)$/i, '')
    .trim();
}

// Один неіснуючий/видалений qid валить увесь запит — тоді ділимо пачку навпіл.
async function fetchLabels(ids, out) {
  const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels&languages=en&format=json`);
  if (j.error) {
    if (ids.length === 1) return;
    const half = Math.ceil(ids.length / 2);
    await fetchLabels(ids.slice(0, half), out);
    await fetchLabels(ids.slice(half), out);
    return;
  }
  for (const [q, e] of Object.entries(j.entities || {})) {
    const label = e.labels?.en?.value;
    if (label) out[q] = short(label) || label;
  }
}

(async () => {
  const qids = Object.keys(teams).filter((q) => !teams[q].national);
  const out = {};
  for (let i = 0; i < qids.length; i += 50) {
    await fetchLabels(qids.slice(i, i + 50), out);
    if (i % 500 === 0) console.log(`  ${i + 50}/${qids.length}`);
    await sleep(150);
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Готово: ${Object.keys(out).length} з ${qids.length} клубів → ${path.relative(process.cwd(), OUT)}`);
})();
