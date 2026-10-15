// Трофеї гравців — скільки разів що виграв (scripts/build-honours.js → honours.json, з розділу «Honours» статей en.wikipedia).
// honoursOf(p) → { league, ucl, uel, uecl, usc, cwc, wc, euro, copa, afcon, nl, lib, olympic, intl, cont, cups, total, leagues: { назва: n } }
// (нулі — відсутні поля) або null — розділу трофеїв у статті немає, тобто невідомо (не «нуль»).
// Золотий м'яч звідси не беремо — у статтях його часто плутають з номінаціями; він лишається тегом BALLON.
const { T } = require('../core/i18n');

let data = {};
try {
  data = require('./honours.json');
} catch {
  // трофеї ще не зібрані (npm run build-honours) — питання й теми про трофеї просто недоступні
}

const honoursOf = (p) => (p && data[p.id]) || null;
const count = (h, key) => (h ? h[key] || 0 : null);

// Що показувати в підсумку: [ключ, укр., англ.] — у порядку ваги.
const PARTS = [
  ['league', 'чемпіонати', 'league titles'], ['ucl', 'ЛЧ', 'UCL'], ['uel', 'ЛЄ', 'UEL'], ['uecl', 'ЛК', 'UECL'],
  ['wc', 'ЧС', 'World Cup'], ['euro', 'Євро', 'Euro'], ['copa', 'Копа Америка', 'Copa América'], ['afcon', 'КАН', 'AFCON'],
  ['nl', 'Ліга націй', 'Nations League'], ['lib', 'Лібертадорес', 'Libertadores'], ['cwc', 'клубний ЧС', 'Club World Cup'],
  ['usc', 'Суперкубок УЄФА', 'UEFA Super Cup'], ['olympic', 'Олімпіада', 'Olympics'], ['intl', 'інші турніри збірних', 'other international'],
  ['cont', 'інші континентальні', 'other continental'], ['cups', 'кубки й суперкубки', 'domestic cups'],
];
// Турніри збірних (дорослих): ЧС, Євро, Копа, КАН, Ліга націй, Кубок конфедерацій/Золотий кубок/Кубок Азії тощо.
const NATION_KEYS = ['wc', 'euro', 'copa', 'afcon', 'nl', 'intl'];
const nationTitles = (h) => (h ? NATION_KEYS.reduce((s, k) => s + (h[k] || 0), 0) : null);

// «чемпіонати 11 · ЛЧ 2 · кубки й суперкубки 24» — лише ненульові, keys — які частини брати.
function summary(h, keys = PARTS.map((x) => x[0])) {
  const parts = PARTS.filter(([k]) => keys.includes(k) && h?.[k]);
  if (!parts.length) return T('жодного', 'none');
  return T(parts.map(([k, uk]) => `${uk} ${h[k]}`).join(' · '), parts.map(([k, , en]) => `${en} ${h[k]}`).join(' · '));
}
// Чемпіонства за лігами: «Ligue 1 ×11, La Liga ×2» (назви ліг — як у Вікіпедії, без уточнень у дужках).
const leagueName = (n) => n.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
function leaguesText(h) {
  const list = Object.entries(h?.leagues || {}).sort((a, b) => b[1] - a[1]);
  if (!list.length) return T('жодного', 'none');
  const s = list.map(([n, c]) => `${leagueName(n)} ×${c}`).join(', ');
  return T(s, s);
}

module.exports = { honoursOf, count, nationTitles, summary, leaguesText, leagueName, PARTS, NATION_KEYS };
