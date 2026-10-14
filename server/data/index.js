const rawPlayers = require('./players.json'); // збирається scripts/build-players.js
const { categories, categoryById } = require('./categories');

let photos = {};
try {
  photos = require('./photos.json');
} catch {
  // фото ще не скачані (npm run fetch-photos) — будуть аватари з ініціалами
}

let categoryImages = {};
try {
  categoryImages = require('./category-images.json');
} catch {
  // картинки категорій ще не скачані (npm run fetch-category-images) — будуть кольорові значки
}
for (const c of categories) c.img = categoryImages[c.id] || (c.imageOf && categoryImages[c.imageOf]) || null;

// Приводимо ім'я до вигляду для пошуку: нижній регістр, без діакритики, ё→е, ґ→г.
function normalize(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/ґ/g, 'г')
    .replace(/[’'`ʼ]/g, '')
    .replace(/[^a-zа-яіїєø0-9]+/g, ' ')
    .trim();
}

const players = rawPlayers.map((p) => ({ ...p, tags: new Set(p.tags), photo: photos[p.id] || null }));
const playerById = new Map(players.map((p) => [p.id, p]));

function matches(player, categoryId) {
  return player.tags.has(categoryId);
}

// Маленька мініатюра для підказок: у посиланнях Wikimedia розмір задано як «/500px-», беремо 120px.
function smallPhoto(url) {
  if (!url) return null;
  return url.split('?')[0].replace(/\/\d+px-([^/]+)$/, '/120px-$1');
}

// Публічний список для автодоповнення — імена, рік народження й мініатюра фото, без клубів/трофеїв
// (фото допомагає впізнати тезку і не підказує відповідь).
const publicPlayers = players.map((p) => ({
  id: p.id,
  name: p.name,
  ru: p.ru,
  uk: p.uk,
  born: p.born,
  thumb: smallPhoto(p.photo),
  aliases: p.aliases,
}));

module.exports = { players, playerById, categories, categoryById, matches, normalize, publicPlayers };
