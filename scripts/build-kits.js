// Форми команд для «Складу матчу» — з шаблону {{Football kit}} англійської Вікіпедії → server/data/kits.json:
//   { match: { [id матчу]: [форма, форма] } — у якій формі команди грали саме цей матч (статті про фінали),
//     team:  { [qid]: форма + away: виїзна } — з інфобоксу статті команди (для матчів з API УЄФА та запасна;
//            виїзна — коли обидві команди в однаковому кольорі) }.
// Форма: { body: '#rrggbb' — колір тулуба, arms: '#rrggbb' — рукави, pattern: посилання на малюнок тулуба (смуги, «шахи»…)
//   або null }. Малюнок — файл Commons «Kit body_<pattern>.png», накладається поверх кольору так само, як у Вікіпедії;
//   файлу немає — лише колір. Малюнків рукавів не беремо: вони для довгого рукава й на коротку футболку не лягають.
// Запуск: npm run build-kits (≈1 хв; після build-lineups).

const fs = require('fs');
const path = require('path');
const { getJson, sparql, sleep, qidOf, values } = require('./lib/wikidata');

const OUT = path.join(__dirname, '..', 'server', 'data', 'kits.json');
const lineups = require('../server/data/lineups.json');
const { categories } = require('../server/data');
const { UEFA_QIDS } = require('../server/games/lineup/matches');

const hex = (s) => (/^[0-9A-Fa-f]{6}$/.test(String(s || '').trim()) ? '#' + String(s).trim().toLowerCase() : null);

// Параметри шаблону: «| body1 = FFFFFF» → { body1: 'FFFFFF' }
function params(text) {
  const out = {};
  for (const m of text.matchAll(/\|\s*([a-z_]+\d?)\s*=\s*([^|\n}]*)/gi)) out[m[1].toLowerCase()] = m[2].replace(/<!--[\s\S]*?-->/g, '').trim();
  return out;
}
// Форма з параметрів (suffix — '' для {{Football kit}}, '1' для першої форми в інфобоксі)
function kitOf(p, suffix) {
  const body = hex(p['body' + suffix]);
  const pattern = p['pattern_b' + suffix] || '';
  if (!body && !pattern) return null;
  // колір не вказано — у Вікіпедії під малюнком білий
  return { body: body || '#ffffff', arms: hex(p['leftarm' + suffix]) || body || '#ffffff', pattern: pattern || null };
}

async function wikitext(title) {
  const j = await getJson(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=revisions&rvprop=content&rvslots=main&redirects=1&titles=${encodeURIComponent(title)}`);
  return Object.values(j.query?.pages || {})[0]?.revisions?.[0]?.slots?.main?.['*'] || '';
}

// Які файли малюнків справді є на Commons: назва → посилання
async function existing(files) {
  const out = new Map();
  for (let i = 0; i < files.length; i += 50) {
    const chunk = files.slice(i, i + 50);
    const j = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(chunk.map((f) => 'File:' + f).join('|'))}`);
    const norm = new Map((j.query?.normalized || []).map((n) => [n.to, n.from]));
    for (const p of Object.values(j.query?.pages || {})) {
      const url = p.imageinfo?.[0]?.url;
      if (url) out.set((norm.get(p.title) || p.title).replace(/^File:/, ''), url.split('?')[0]);
    }
    await sleep(300);
  }
  return out;
}

async function main() {
  const result = { match: {}, team: {} };

  // 1. Форма в самому матчі — статті Вікіпедії (по шаблону на команду, у порядку команд)
  for (const m of lineups.filter((x) => x.src === 'wiki' && x.article)) {
    const text = await wikitext(m.article);
    const kits = [...text.matchAll(/\{\{\s*Football kit([\s\S]*?)\}\}/gi)].map((x) => kitOf(params(x[1]), ''));
    if (kits.length >= 2) result.match[m.id] = [kits[0], kits[1]];
    await sleep(150);
  }
  console.log(`Матчі: форма є в ${Object.keys(result.match).length}`);

  // 2. Основна форма команди — інфобокс статті (команди матчів і клуби/збірні категорій бази)
  const qids = new Set(categories.filter((c) => c.qid && (c.type === 'club' || c.type === 'nation')).map((c) => c.qid));
  for (const m of lineups) for (const t of m.teams) { const q = t.qid || UEFA_QIDS[t.uefaTeam]; if (q) qids.add(q); }
  const list = [...qids];
  const titles = new Map();
  for (let i = 0; i < list.length; i += 200) {
    const rows = await sparql(`SELECT ?t ?title WHERE { VALUES ?t { ${values(list.slice(i, i + 200))} }
      ?a schema:about ?t ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title }`);
    for (const r of rows) titles.set(qidOf(r.t), r.title);
  }
  for (const [q, title] of titles) {
    const text = await wikitext(title);
    // інфобокс клубу — body1/pattern_b1; у збірних так само
    const p = params(text.slice(0, 40000));
    const k = kitOf(p, '1');
    if (k) result.team[q] = { ...k, away: kitOf(p, '2') };
    await sleep(150);
  }
  console.log(`Команди: форма є в ${Object.keys(result.team).length} з ${titles.size}`);

  // 3. Малюнки: лишаємо посилання лише на ті файли, що є
  const all = [...Object.values(result.match).flat(), ...Object.values(result.team), ...Object.values(result.team).map((k) => k.away)].filter(Boolean);
  const files = new Set();
  for (const k of all) if (k.pattern) files.add(`Kit body${k.pattern}.png`);
  const have = await existing([...files]);
  for (const k of all) k.pattern = k.pattern ? have.get(`Kit body${k.pattern}.png`) || null : null;
  console.log(`Малюнки: ${have.size} з ${files.size} файлів є на Commons`);
  fs.writeFileSync(OUT, JSON.stringify(result));
  console.log(`→ ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
