// Бомбардири турнірів (ЧС, Євро, Копа Америка, Ліга чемпіонів, Ліга Європи) — з таблиць англійської Вікіпедії
// → server/data/tournaments.json: { [турнір]: [[id гравця | null, голи, (назва, якщо гравця немає в базі)], …] } за спаданням.
// Гравців зіставляємо через посилання в таблиці → Wikidata (qid) → наша база; кого в базі немає — пишемо в консоль.
// Запуск: npm run build-tournaments (після build-players).

const fs = require('fs');
const path = require('path');
const { text, grid, qidsOf, fetchHtml } = require('./lib/wikipedia');
const { players, normalize } = require('../server/data');

const OUT = path.join(__dirname, '..', 'server', 'data', 'tournaments.json');
// турнір → сторінка і як упізнати потрібну таблицю (за підписом)
const SOURCES = {
  wc: { page: 'List_of_FIFA_World_Cup_top_goalscorers', caption: /at least \d+ goals/i },
  euro: { page: 'UEFA_European_Championship_top_goalscorers' },
  copa: { page: 'Copa_América_records_and_statistics' },
  ucl: { page: 'List_of_European_Cup_and_UEFA_Champions_League_top_scorers' },
  uel: { page: 'List_of_UEFA_Cup_and_Europa_League_top_scorers', goals: /^Goal$/i },
};

// Перша таблиця з колонками Player і Goals (і потрібним підписом): [{ title, goals }].
function parseTable(html, caption, goalsCol = /^Goals/i) {
  for (const tb of html.split('<table').slice(1)) {
    const cap = text((tb.match(/<caption[^>]*>([\s\S]*?)<\/caption>/) || [])[1] || '');
    const body = tb.split('</table>')[0];
    if (caption && !caption.test(cap)) continue;
    const lines = grid(body.match(/<tr[\s\S]*?<\/tr>/g) || []);
    if (!lines.length) continue;
    const head = lines[0].map((c) => text(c || ''));
    const pc = head.findIndex((h) => /^Player/i.test(h));
    const gc = head.findIndex((h) => goalsCol.test(h));
    if (pc === -1 || gc === -1) continue;
    const out = [];
    for (const line of lines.slice(1)) {
      const clean = (line[pc] || '').replace(/<span[^>]*class="[^"]*flagicon[\s\S]*?<\/span>/g, '');
      const m = clean.match(/<a[^>]*rel="mw:WikiLink"[^>]*title="([^"]+)"/);
      const goals = text(line[gc] || '');
      if (m && /^\d+$/.test(goals)) out.push({ title: m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'"), goals: Number(goals) });
    }
    if (out.length >= 10) return out;
  }
  return [];
}

async function main() {
  const byQid = new Map(players.filter((p) => p.qid).map((p) => [p.qid, p]));
  // запасний варіант (у частини гравців бази немає qid): англійське ім'я, якщо такий гравець один
  const byName = new Map();
  for (const p of players) {
    const k = normalize(p.name);
    byName.set(k, byName.has(k) ? null : p);
  }
  const find = (title, qid) => byQid.get(qid) || byName.get(normalize(title.replace(/\s*\(.*\)$/, ''))) || null;
  const result = {};
  for (const [key, { page, caption, goals }] of Object.entries(SOURCES)) {
    const rows = parseTable(await fetchHtml(page), caption, goals);
    const qids = await qidsOf([...new Set(rows.map((r) => r.title))]);
    const list = [];
    const missing = [];
    const seen = new Set();
    for (const r of rows) {
      const p = find(r.title, qids.get(r.title));
      if (!p) {
        // кого немає в базі, лишаємо порожнім місцем: топ обріжеться перед ним (інакше він був би неправильним)
        missing.push(`${r.title} (${r.goals})`);
        list.push([null, r.goals, r.title]);
        continue;
      }
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      list.push([p.id, r.goals]);
    }
    list.sort((a, b) => b[1] - a[1]);
    result[key] = list;
    console.log(`${key}: ${rows.length} у таблиці, у базі ${list.length}; немає в базі: ${missing.slice(0, 15).join(', ')}${missing.length > 15 ? '…' : ''}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(result));
  console.log(`→ ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
