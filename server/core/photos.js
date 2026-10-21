// Картинки з Wikimedia через наш сервер: фото гравців /api/photo/:id (≈500 px, картки відповідей) і /api/photo/:id?s=120
// (мініатюра в підказках), герби, прапори, картинки категорій — /api/img?u=<посилання> (функція `viaServer`).
// Wikimedia віддає 429 браузерам, які тягнуть багато картинок напряму (підказки — десятки фото за хвилину), а запити з
// підписаним User-Agent пропускає. Тож сервер бере картинки сам і тримає в пам'яті; браузер кешує на тиждень.
const UA = 'football-party-games/1.0 (https://github.com/dimobcheg25-a11y/football_party_games; hobby project)';
const LIMITS = { 120: 4000, 500: 400, img: 3000 }; // скільки картинок кожного виду тримати в пам'яті (~5 КБ / ~50 КБ / ~3 КБ)
const WIKIMEDIA = /^https:\/\/(upload|thumb|commons)\.wikimedia\.org\//;

// Посилання на Wikimedia → через наш сервер (решту — як є). Повторно не загортає.
function viaServer(url) {
  return url && WIKIMEDIA.test(url) ? `/api/img?u=${encodeURIComponent(url)}` : url;
}

// Посилання на потрібну ширину: «…/thumb/a/ab/F.jpg/500px-F.jpg» → 120px. Посилання без /thumb/ — оригінал, який і так
// не ширший за 500 px (Вікіпедія віддала його «unscaled»), — беремо як є: нову мініатюру Wikimedia генерує неохоче (429).
function sized(url, w) {
  const clean = url.split('?')[0];
  return clean.replace(/(\/thumb\/.+)\/\d+px-([^/]+)$/, `$1/${w}px-$2`);
}

// До Wikimedia — не більше PARALLEL запитів одночасно; на 429 (ще не згенерована мініатюра, забагато разом) — ще дві спроби з паузою.
const PARALLEL = 4;
let active = 0;
const queue = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url, tries = 3) {
  if (active >= PARALLEL) await new Promise((r) => queue.push(r));
  active++;
  let r;
  try {
    r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.ok) return { type: r.headers.get('content-type') || 'image/jpeg', buf: Buffer.from(await r.arrayBuffer()) };
  } finally {
    active--;
    queue.shift()?.();
  }
  if (r.status === 429 && tries > 1) return wait(1500).then(() => download(url, tries - 1));
  const e = new Error(`${r.status}`);
  e.status = r.status;
  throw e;
}

function setupPhotos(app, playerById) {
  const caches = { 120: new Map(), 500: new Map(), img: new Map() };
  const pending = new Map(); // те, що вже завантажується, — не тягнути вдруге

  function load(kind, url, fallback) {
    const key = `${kind}|${url}`;
    const cache = caches[kind];
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (!pending.has(key)) {
      // Мініатюра ширша за оригінал (маленьке фото) — Wikimedia дає 4xx; тоді беремо сам файл.
      const job = download(url).catch((e) => (fallback && e.status && e.status !== 429 ? download(fallback) : Promise.reject(e)))
        .then((img) => {
          cache.set(key, img);
          if (cache.size > LIMITS[kind]) cache.delete(cache.keys().next().value);
          return img;
        })
        .finally(() => pending.delete(key));
      pending.set(key, job);
    }
    return pending.get(key);
  }

  async function send(res, job) {
    try {
      const img = await job;
      res.set({ 'Content-Type': img.type, 'Cache-Control': 'public, max-age=604800' }).send(img.buf);
    } catch {
      res.set('Cache-Control', 'no-store').status(502).end();
    }
  }

  app.get('/api/photo/:id', (req, res) => {
    const src = playerById.get(req.params.id)?.photoSrc;
    if (!src) return res.status(404).end();
    const w = req.query.s === '120' ? 120 : 500;
    send(res, load(w, sized(src, w), src.split('?')[0]));
  });

  app.get('/api/img', (req, res) => {
    const url = String(req.query.u || '');
    if (!WIKIMEDIA.test(url)) return res.status(400).end();
    send(res, load('img', url));
  });
}

module.exports = { setupPhotos, viaServer, UA };
