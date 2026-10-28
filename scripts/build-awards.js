// Нагороди з таблиць статей англійської Вікіпедії → server/data/awards.json:
//   fifpro:    { [рік]: [[id гравця | null, 'GK'|'DF'|'MF'|'FW', (ім'я, якщо гравця немає в базі)], …] } — FIFPRO Men's World 11 (з 2005;
//              «FIFA FIFPRO World 11», символічна збірна року за голосуванням футболістів), стаття «FIFA FIFPRO World 11», таблиця чоловіків;
//   goldenBoy: { [рік]: [id гравця | null, (ім'я)] } — Golden Boy (Tuttosport, найкращий гравець Європи до 21 року, з 2003), стаття «Golden Boy (award)».
// Гравців росії й білорусі не пишемо. Гравців зіставляємо через посилання → Wikidata → база (як build-ballon).
// Запуск: npm run build-awards (≈20 с, після build-players).

const fs = require('fs');
const path = require('path');
const { text, grid, qidsOf, fetchHtml } = require('./lib/wikipedia');
const { players, normalize } = require('../server/data');
const { isBanned } = require('../server/data/banned');
const rawPlayers = require('../server/data/players.json');

const OUT = path.join(__dirname, '..', 'server', 'data', 'awards.json');
const POS = [[/goalkeeper/i, 'GK'], [/defender/i, 'DF'], [/midfielder/i, 'MF'], [/forward/i, 'FW']];

const tables = (html) => html.split('<table').slice(1).map((tb) => grid(tb.split('</table>')[0].match(/<tr[\s\S]*?<\/tr>/g) || []));
const year = (cell) => Number((text(cell || '').match(/\b(19|20)\d\d\b/) || [])[0]) || null;
const title = (t) => t.replace(/&amp;/g, '&').replace(/&#39;/g, "'");
const plain = (t) => t.replace(/\s*\(.*\)$/, '');

// Посилання на гравців у клітинці «Гравець (клуб) Гравець (клуб/клуб)»: лише ті, що не в дужках (у дужках — клуби).
function playerLinks(cell) {
  const out = [];
  let depth = 0;
  for (const tok of (cell || '').replace(/<sup[\s\S]*?<\/sup>/g, '').match(/<[^>]+>|[^<]+/g) || []) {
    if (tok[0] === '<') {
      const m = depth === 0 && tok.match(/^<a[^>]*rel="mw:WikiLink"[^>]*title="([^"]+)"/);
      if (m) out.push(title(m[1]));
      continue;
    }
    for (const ch of tok) depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
    depth = Math.max(0, depth);
  }
  return out;
}

async function main() {
  const byQid = new Map(players.filter((p) => p.qid).map((p) => [p.qid, p]));
  const banned = new Set(rawPlayers.filter((p) => isBanned(p)).map((p) => p.qid));
  const byName = new Map();
  for (const p of players) {
    const k = normalize(p.name);
    byName.set(k, byName.has(k) ? null : p);
  }
  const missing = [];
  const resolve = (t, qids) => {
    const qid = qids.get(t);
    if (banned.has(qid)) return undefined;
    const p = byQid.get(qid) || byName.get(normalize(plain(t))) || null;
    if (!p) missing.push(t);
    return p ? [p.id] : [null, plain(t)];
  };

  // FIFPRO Men's World 11 — перша таблиця з колонкою воротаря (друга така ж — жіноча)
  const fifpro = {};
  const fp = tables(await fetchHtml('FIFA_FIFPRO_World_11')).find((rows) => rows[0] && /goalkeeper/i.test(text(rows[0].join(' '))));
  const head = fp[0].map((c) => text(c || ''));
  const cols = POS.map(([re, pos]) => [head.findIndex((h) => re.test(h)), pos]).filter(([i]) => i !== -1);
  const fpRows = fp.slice(1).map((line) => ({ y: year(line[0]), line })).filter((r) => r.y);
  const fpQids = await qidsOf([...new Set(fpRows.flatMap(({ line }) => cols.flatMap(([i]) => playerLinks(line[i]))))]);
  for (const { y, line } of fpRows) {
    const team = [];
    for (const [i, pos] of cols) {
      for (const t of playerLinks(line[i])) {
        const r = resolve(t, fpQids);
        if (r) team.push(r[0] ? [r[0], pos] : [null, pos, r[1]]);
      }
    }
    fifpro[y] = team;
  }
  console.log(`FIFPRO World 11: ${Object.keys(fifpro).length} років (${Object.keys(fifpro)[0]}–${Object.keys(fifpro).pop()}), ${Object.values(fifpro).flat().length} місць`);

  // Golden Boy — таблиця переможців (колонки Year, Winner)
  const goldenBoy = {};
  const gb = tables(await fetchHtml('Golden_Boy_(award)')).find((rows) => rows[0] && /winner/i.test(text(rows[0].join(' '))) && /year/i.test(text(rows[0].join(' '))));
  const wc = gb[0].findIndex((c) => /winner/i.test(text(c || '')));
  const gbRows = gb.slice(1).map((line) => ({ y: year(line[0]), t: playerLinks(line[wc])[0] })).filter((r) => r.y && r.t);
  const gbQids = await qidsOf([...new Set(gbRows.map((r) => r.t))]);
  for (const { y, t } of gbRows) {
    const r = resolve(t, gbQids);
    if (r) goldenBoy[y] = r;
  }
  console.log(`Golden Boy: ${Object.keys(goldenBoy).length} переможців (${Object.keys(goldenBoy)[0]}–${Object.keys(goldenBoy).pop()})`);
  if (missing.length) console.log(`Немає в базі (${new Set(missing).size}): ${[...new Set(missing)].join(', ')}`);

  fs.writeFileSync(OUT, JSON.stringify({ fifpro, goldenBoy }));
  console.log(`Готово → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
