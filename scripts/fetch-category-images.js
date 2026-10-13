// Завантажує герби клубів, прапори збірних і фото трофеїв у public/img/categories/
// та записує відповідність у server/data/category-images.json.
// Запуск: npm run fetch-category-images
//
// Клуби й трофеї — головне зображення статті en.wikipedia (pilicense=any, бо герби — не вільні файли),
// прапори — файли з Wikimedia Commons. Картинки зберігаються локально, щоб не залежати від чужих серверів.

const fs = require('fs');
const path = require('path');
const { categories } = require('../server/data/categories');

const DIR = path.join(__dirname, '..', 'public', 'img', 'categories');
const OUT = path.join(__dirname, '..', 'server', 'data', 'category-images.json');
const UA = { 'User-Agent': 'football-games-grid9/1.0 (hobby project)' };
const SIZE = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(host, params, attempt = 0) {
  const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const res = await fetch(url, { headers: UA });
  if (res.status === 429 && attempt < 5) {
    await sleep(4000 * (attempt + 1));
    return api(host, params, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Повертає Map<назва з categories.js → URL мініатюри>
async function resolveImages() {
  const urls = new Map();
  const files = categories.filter((c) => c.image?.startsWith('File:')).map((c) => c.image);
  const pages = categories.filter((c) => c.image && !c.image.startsWith('File:')).map((c) => c.image);

  for (let i = 0; i < files.length; i += 50) {
    const j = await api('commons.wikimedia.org', {
      action: 'query', titles: files.slice(i, i + 50).join('|'), prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(SIZE),
    });
    for (const p of j.query.pages) if (p.imageinfo) urls.set(p.title, p.imageinfo[0].thumburl);
    // Commons нормалізує назви (пробіли/регістр) — зіставляємо через normalized
    for (const n of j.query.normalized || []) if (urls.has(n.to)) urls.set(n.from, urls.get(n.to));
    await sleep(800);
  }

  for (let i = 0; i < pages.length; i += 50) {
    const chunk = pages.slice(i, i + 50);
    const j = await api('en.wikipedia.org', {
      action: 'query', titles: chunk.join('|'), prop: 'pageimages', piprop: 'thumbnail', pithumbsize: String(SIZE), pilicense: 'any', redirects: '1',
    });
    const q = j.query;
    const resolve = (t) => {
      for (const n of q.normalized || []) if (n.from === t) t = n.to;
      for (const r of q.redirects || []) if (r.from === t) t = r.to;
      return q.pages.find((p) => p.title === t);
    };
    for (const t of chunk) {
      const page = resolve(t);
      if (page?.thumbnail) urls.set(t, page.thumbnail.source);
    }
    await sleep(800);
  }
  return urls;
}

async function download(url, file, attempt = 0) {
  const res = await fetch(url, { headers: UA });
  if (res.status === 429 && attempt < 5) {
    await sleep(4000 * (attempt + 1));
    return download(url, file, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const urls = await resolveImages();
  const map = {};
  for (const c of categories) {
    if (!c.image) continue;
    const url = urls.get(c.image);
    if (!url) {
      console.log(`✗ ${c.id.padEnd(8)} ${c.image} — зображення не знайдено`);
      continue;
    }
    const ext = (url.split('?')[0].match(/\.(png|jpe?g|gif|webp)$/i)?.[1] || 'png').toLowerCase();
    const name = `${c.id.toLowerCase()}.${ext}`;
    try {
      await download(url, path.join(DIR, name));
      map[c.id] = `/img/categories/${name}`;
      console.log(`✓ ${c.id.padEnd(8)} ${c.image}`);
    } catch (e) {
      console.log(`✗ ${c.id.padEnd(8)} ${c.image} — ${e.message}`);
    }
    await sleep(500);
  }
  fs.writeFileSync(OUT, JSON.stringify(map, null, 2) + '\n');
  console.log(`\nГотово: ${Object.keys(map).length} картинок → ${path.relative(process.cwd(), DIR)}`);
}

main();
