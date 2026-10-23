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
const { viaServer } = require('../core/photos'); // картинки Wikimedia — через наш сервер
for (const c of categories) c.img = viaServer(categoryImages[c.id] || (c.imageOf && categoryImages[c.imageOf]) || null);

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

// Хто працював тренером (npm run build-coaches): їхні статті у Вікіпедії — значною мірою за тренерську кар'єру,
// тож для складності «відомість як гравця» (fame) у них знижена — інакше Анчелотті чи Куман траплялися б у легкому рівні.
let coaches = new Set();
try {
  coaches = new Set(require('./coaches.json'));
} catch {
  // список тренерів ще не зібраний
}
const COACH_FAME = 0.6;

// fame — у скількох мовних розділах Вікіпедії є стаття (грубий показник світової відомості); rawFame — без знижки тренерам.
// Гравців росії й білорусі в базі немає (server/data/banned.js) — жодна гра їх не загадує й не приймає як відповідь.
const { EXCLUDED } = require('./derived-tags');
const { isBanned } = require('./banned');
const bannedPlayers = rawPlayers.filter((p) => !EXCLUDED.has(p.qid) && isBanned(p));
const players = rawPlayers.filter((p) => !EXCLUDED.has(p.qid) && !isBanned(p)).map((p) => ({
  // photo — через наш сервер (server/core/photos.js), photoSrc — посилання на Wikimedia.
  ...p, tags: new Set(p.tags), photoSrc: photos[p.id] || null, photo: photos[p.id] ? `/api/photo/${p.id}` : null,
  rawFame: p.fame, coach: coaches.has(p.qid), fame: coaches.has(p.qid) ? Math.round(p.fame * COACH_FAME) : p.fame,
}));
require('./derived-tags').addDerivedTags(players); // 100+ асистів, 30+ голів у ЛЧ, трансфер 80+ млн, мандрівник
const playerById = new Map(players.map((p) => [p.id, p]));
const { nicknameVariants } = require('./nicknames');

function matches(player, categoryId) {
  return player.tags.has(categoryId);
}

// Публічний список для автодоповнення — імена, рік народження й мініатюра фото, без клубів/трофеїв
// (фото допомагає впізнати тезку і не підказує відповідь).
const publicPlayers = players.map((p) => ({
  id: p.id,
  name: p.name,
  ru: p.ru,
  uk: p.uk,
  born: p.born,
  thumb: p.photo ? `${p.photo}?s=120` : null, // мініатюра 120 px
  aliases: [...(p.aliases || []), ...nicknameVariants(p)], // і прізвиська: «Шева», «Kun» теж знаходять гравця
})).concat(bannedPlayers.map((p) => ({ // лише для підказок: сірі, з принизливою приміткою, вибрати не можна
  id: p.id, name: p.name, ru: p.ru, uk: p.uk, born: p.born, thumb: null, aliases: p.aliases, banned: true,
})));

module.exports = { players, playerById, categories, categoryById, matches, normalize, publicPlayers };
