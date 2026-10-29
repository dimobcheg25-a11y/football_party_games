// Коли гравець з'явився в клубі академії (дубль, молодіжка або основа) → server/data/academy.json: { qid: { AC_BEN: 2010, … } }.
// build-players ставить «вихованця» кожному, хто грав за дубль (Wikidata P54 / категорія en.wikipedia «… B players»), — а туди
// потрапляють і дорослі новачки (Облак: «Олімпія» 2009, Бенфіка 2010, дубль Бенфіки 2013). derived-tags прибирає тег, якщо до цього
// року гравець уже грав дорослим за інший клуб (careers.json). Немає року — тег лишається.
// Запуск: npm run build-academy (≈20 с, після build-players).

const fs = require('fs');
const path = require('path');
const { sparql, qidOf, values } = require('./lib/wikidata');
const { categories } = require('../server/data/categories');
const rawPlayers = require('../server/data/players.json');

const OUT = path.join(__dirname, '..', 'server', 'data', 'academy.json');
const ACADEMIES = categories.filter((c) => c.type === 'academy');
// дубль чи молодіжка клубу, у якої немає «батька» P831 у Wikidata (S.L. Benfica B) — за назвою
const NAME = {
  AC_BAR: /barcelona/i, AC_RMA: /real madrid/i, AC_AJX: /ajax/i, AC_MUN: /manchester united/i, AC_DYN: /dynamo|dinamo/i,
  AC_BEN: /benfica/i, AC_SCP: /sporting/i, AC_OL: /lyon/i, AC_BAY: /bayern/i,
};
const RESERVE = /\bU-?\d{2}\b|under-?\d{2}|\byouth\b|academy|reserves?\b|\s(B|C|II|III)$|-(2|3)\b|^jong\s|castilla|atlètic/i;

async function main() {
  const tagged = rawPlayers.filter((p) => p.qid && p.tags.some((t) => t.startsWith('AC_')));
  const out = {};
  for (let i = 0; i < tagged.length; i += 150) {
    const chunk = tagged.slice(i, i + 150);
    const rows = await sparql(`SELECT ?p ?team ?label ?start ?parent WHERE { VALUES ?p { ${values(chunk.map((p) => p.qid))} }
      ?p p:P54 ?st . ?st ps:P54 ?team . FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
      ?st pq:P580 ?start . OPTIONAL { ?team wdt:P831 ?parent }
      OPTIONAL { ?team rdfs:label ?label FILTER(LANG(?label) = "en") } }`);
    for (const r of rows) {
      const qid = qidOf(r.p);
      const p = chunk.find((x) => x.qid === qid);
      const year = Number(String(r.start).slice(0, 4));
      if (!year) continue;
      for (const a of ACADEMIES) {
        if (!p.tags.includes(a.id)) continue;
        const team = qidOf(r.team);
        const own = team === a.clubQid || (r.parent && qidOf(r.parent) === a.clubQid)
          || (RESERVE.test(r.label || '') && NAME[a.id].test(r.label || ''));
        if (!own) continue;
        const was = out[qid]?.[a.id];
        if (was == null || year < was) (out[qid] ||= {})[a.id] = year;
      }
    }
    console.log(`${Math.min(i + 150, tagged.length)} / ${tagged.length}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 0).replace(/\},"/g, '},\n"') + '\n');
  console.log(`гравців з роком приходу в академію: ${Object.keys(out).length} з ${tagged.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
