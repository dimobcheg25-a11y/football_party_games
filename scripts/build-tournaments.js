// Бомбардири турнірів (ЧС, Євро, Ліга чемпіонів, Ліга Європи) — з таблиць англійської Вікіпедії
// → server/data/tournaments.json: { [турнір]: [[id гравця | null, голи, (назва, якщо гравця немає в базі)], …] } за спаданням.
// Гравців зіставляємо через посилання в таблиці → Wikidata (qid) → наша база; кого в базі немає — пишемо в консоль.
// Запуск: npm run build-tournaments (після build-players).

const fs = require('fs');
const path = require('path');
const { getJson, sleep } = require('./lib/wikidata');
const { players, normalize } = require('../server/data');

const OUT = path.join(__dirname, '..', 'server', 'data', 'tournaments.json');
const UA = 'football-games-grid9/1.0 (hobby project)';
// турнір → сторінка і як упізнати потрібну таблицю (за підписом)
const SOURCES = {
  wc: { page: 'List_of_FIFA_World_Cup_top_goalscorers', caption: /at least \d+ goals/i },
  euro: { page: 'UEFA_European_Championship_top_goalscorers' },
  ucl: { page: 'List_of_European_Cup_and_UEFA_Champions_League_top_scorers' },
  uel: { page: 'List_of_UEFA_Cup_and_Europa_League_top_scorers', goals: /^Goal$/i },
};

const text = (html) => html.replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim();

// Рядки таблиці як сітка: клітинки з rowspan/colspan повторюються в наступних рядках (нічиї в рейтингу об'єднують «Голи»).
function grid(rows) {
  const out = [];
  const carry = []; // колонка → { html, left }
  for (const row of rows) {
    const cells = row.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || [];
    const line = [];
    let col = 0;
    const fill = () => {
      while (carry[col]?.left > 0) { line[col] = carry[col].html; carry[col].left--; col++; }
    };
    for (const c of cells) {
      fill();
      const rs = Number((c.match(/rowspan="(\d+)"/) || [])[1] || 1);
      const cs = Number((c.match(/colspan="(\d+)"/) || [])[1] || 1);
      for (let k = 0; k < cs; k++) {
        line[col] = c;
        if (rs > 1) carry[col] = { html: c, left: rs - 1 };
        col++;
      }
    }
    fill();
    out.push(line);
  }
  return out;
}

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

// Сторінки Вікіпедії → qid (з урахуванням перенаправлень).
async function qidsOf(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=${encodeURIComponent(chunk.join('|'))}`;
    const json = await getJson(url);
    const redirect = new Map((json.query.redirects || []).map((r) => [r.to, r.from]));
    const normalized = new Map((json.query.normalized || []).map((r) => [r.to, r.from]));
    for (const p of Object.values(json.query.pages || {})) {
      const qid = p.pageprops?.wikibase_item;
      if (!qid) continue;
      let t = p.title;
      out.set(t, qid);
      if (redirect.has(t)) { t = redirect.get(t); out.set(t, qid); }
      if (normalized.has(t)) out.set(normalized.get(t), qid);
    }
    await sleep(300);
  }
  return out;
}

// HTML сторінки з повторами (Вікіпедія часом відповідає 429 — забагато запитів).
async function fetchHtml(page) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${page}`, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.text();
    if ((res.status !== 429 && res.status < 500) || attempt >= 6) throw new Error(`HTTP ${res.status} ${page}`);
    console.log(`  (HTTP ${res.status}, чекаю)`);
    await sleep(5000 * (attempt + 1));
  }
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
