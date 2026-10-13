// Знаходить фото футболістів у Вікіпедії і зберігає посилання в server/data/photos.json.
// Запуск: npm run fetch-photos            — лише для тих, у кого ще немає фото
//         npm run fetch-photos -- --all   — оновити всіх
// Фото — з Wikimedia Commons (вільні ліцензії), сайт показує їх напряму з upload.wikimedia.org.

const fs = require('fs');
const path = require('path');
const rawPlayers = require('../server/data/players.json');
const { normalize } = require('../server/data');

const OUT = path.join(__dirname, '..', 'server', 'data', 'photos.json');
const API = 'https://en.wikipedia.org/w/api.php';
const HEADERS = { 'User-Agent': 'football-games-grid9/1.0 (hobby project; https://github.com/)' };

// Точні назви статей там, де ім'я неоднозначне.
const TITLE_OVERRIDES = {
  'Ronaldo Nazário': 'Ronaldo (Brazilian footballer)',
  'Pedro Rodríguez': 'Pedro (footballer, born 1987)',
  'Rodri': 'Rodri (footballer, born 1996)',
  'Pepe': 'Pepe (footballer, born 1983)',
  'Marcelo': 'Marcelo (footballer, born 1988)',
  'Fernandinho': 'Fernandinho (footballer, born 1985)',
  'Ederson': 'Ederson (footballer, born 1993)',
  'Jorginho': 'Jorginho (footballer, born 1991)',
  'Vitinha': 'Vitinha (footballer, born 2000)',
  'Raúl González': 'Raúl (footballer)',
  'Xavi Hernández': 'Xavi (footballer, born 1980)',
  'George Weah': 'George Weah',
  'Luis Díaz': 'Luis Díaz (Colombian footballer)',
  'Reece James': 'Reece James (footballer, born 1999)',
  'Andy Robertson': 'Andrew Robertson',
  'Kyle Walker': 'Kyle Walker',
  'Lucas Hernández': 'Lucas Hernandez',
  'Theo Hernández': 'Theo Hernandez',
  'Isco': 'Isco',
  'Koke': 'Koke',
  'Deco': 'Deco',
  'Rodrygo': 'Rodrygo',
  'Casemiro': 'Casemiro',
  'Marquinhos': 'Marquinhos',
  'Raphinha': 'Raphinha',
  'Pedri': 'Pedri',
  'Cafu': 'Cafu',
  'Kaká': 'Kaká',
  'Rivaldo': 'Rivaldo',
  'Neymar': 'Neymar',
  'Ronaldinho': 'Ronaldinho',
  'Gabriel Jesus': 'Gabriel Jesus',
  'Diego Costa': 'Diego Costa',
  'Luis Enrique': 'Luis Enrique',
  'Rui Costa': 'Rui Costa',
};

const isFootballer = (p) => /football|soccer/i.test(p?.description || '') && !/rivalry|family|son of/i.test(p?.description || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params, attempt = 0) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 429 && attempt < 5) {
    const wait = 5000 * (attempt + 1);
    console.log(`  (ліміт запитів, чекаю ${wait / 1000} с)`);
    await sleep(wait);
    return api(params, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const PAGE_PARAMS = { prop: 'pageimages|description', piprop: 'thumbnail', pithumbsize: '360', redirects: '1' };

// Крок 1: точні назви статей пачками по 50.
async function byTitles(list) {
  const found = new Map();
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const titles = chunk.map((p) => p.wiki || TITLE_OVERRIDES[p.name] || p.name);
    const data = await api({ action: 'query', titles: titles.join('|'), ...PAGE_PARAMS });
    const q = data.query || {};
    // ланцюжок: запитана назва → нормалізована → редирект → сторінка
    const resolve = (t) => {
      for (const n of q.normalized || []) if (n.from === t) t = n.to;
      for (const r of q.redirects || []) if (r.from === t) t = r.to;
      return (q.pages || []).find((p) => p.title === t);
    };
    chunk.forEach((player, k) => {
      const page = resolve(titles[k]);
      // для точних назв з TITLE_OVERRIDES опису довіряємо (напр. Веа зараз описаний як президент)
      // точним назвам (з TITLE_OVERRIDES або з Wikidata) довіряємо — напр. Веа зараз описаний як президент
      if (page && !page.missing && (TITLE_OVERRIDES[player.name] || player.wiki || isFootballer(page))) found.set(player.id, page);
    });
    await sleep(1000);
  }
  return found;
}

// Крок 2: для решти — пошук «ім'я footballer».
async function bySearch(player) {
  const data = await api({ action: 'query', generator: 'search', gsrsearch: `${player.name} footballer`, gsrlimit: '5', ...PAGE_PARAMS });
  const pages = (data.query?.pages || []).sort((a, b) => a.index - b.index);
  const surname = normalize(player.name).split(' ').pop();
  return pages.find((p) => isFootballer(p) && normalize(p.title).includes(surname)) || null;
}

async function main() {
  const all = process.argv.includes('--all');
  let photos = {};
  try { photos = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* перший запуск */ }
  if (all) photos = {};

  const todo = rawPlayers.filter((p) => !photos[p.id]);
  console.log(`Шукаю фото для ${todo.length} гравців…`);

  const pages = await byTitles(todo);
  // пошук — лише для ручних гравців без точної назви статті
  for (const player of todo.filter((p) => !pages.has(p.id) && !p.wiki)) {
    const page = await bySearch(player).catch(() => null);
    if (page) pages.set(player.id, page);
    await sleep(1500);
  }

  const misses = [];
  for (const player of todo) {
    const page = pages.get(player.id);
    if (page?.thumbnail?.source) {
      photos[player.id] = page.thumbnail.source;
      console.log(`✓ ${player.name.padEnd(28)} → ${page.title}`);
    } else {
      misses.push(player.name);
      console.log(`✗ ${player.name.padEnd(28)} → ${page ? page.title + ' (без фото)' : 'не знайдено'}`);
    }
  }

  const sorted = Object.fromEntries(Object.entries(photos).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`\nГотово: ${Object.keys(sorted).length} фото. Без фото: ${misses.length}${misses.length ? ' — ' + misses.join(', ') : ''}`);
}

main();
