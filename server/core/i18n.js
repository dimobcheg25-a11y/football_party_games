// Дві мови сайту: українська (основна) й англійська. Кожен гравець бачить свою — мову сокета передає клієнт
// (`io('/<id>', { auth: { lang } })`), для /api — `?lang=en`.
//
// Сервер пише тексти парами: T('Кімнату не знайдено', 'Room not found') — і кладе їх у стан, помилки, відповіді.
// Перед відправкою room-server викликає localize(value, lang): кожна пара стає рядком потрібної мови.
// Пари не склеюються через «+» — будуйте обидва рядки: T(`Раунд ${n}`, `Round ${n}`).
class Tr {
  constructor(uk, en) { this.uk = uk; this.en = en ?? uk; }
  toString() { return this.uk; } // на випадок, якщо пара потрапила в рядок — хоч українською
  toJSON() { return this.uk; }    // без localize — українською
}
const T = (uk, en) => new Tr(uk, en);
const isTr = (x) => x instanceof Tr;
const LANGS = ['uk', 'en'];
const langOf = (x) => (LANGS.includes(x) ? x : 'uk');
const pick = (x, lang) => (x instanceof Tr ? x[lang] : x);

// Глибока копія з заміною пар на рядки обраної мови. Решту (числа, рядки, масиви, об'єкти) лишає як є.
function localize(value, lang) {
  if (value instanceof Tr) return value[lang];
  if (Array.isArray(value)) return value.map((v) => localize(v, lang));
  if (value && typeof value === 'object' && (value.constructor === Object || value.constructor == null)) {
    const out = {};
    for (const k in value) out[k] = localize(value[k], lang);
    return out;
  }
  return value;
}

module.exports = { Tr, T, isTr, pick, localize, langOf, LANGS };
