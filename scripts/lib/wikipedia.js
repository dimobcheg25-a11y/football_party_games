// Таблиці англійської Вікіпедії (HTML Parsoid): текст клітинки, сітка з rowspan/colspan, сторінка → qid. Спільне для
// build-tournaments і build-ballon.
const { getJson, sleep } = require('./wikidata');

const UA = 'football-games-grid9/1.0 (hobby project)';
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

module.exports = { text, grid, qidsOf, fetchHtml };
