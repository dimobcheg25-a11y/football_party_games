// Прізвиська гравців (перевірені вручну — manual-nicknames.js): для підказок, пошуку й відповідей у грах.
const { T } = require('../core/i18n');
const manual = require('./manual-nicknames');

// Головне прізвисько парою T(«Блоха (La Pulga)», «La Pulga») або null; однакові написання (CR7) — одне.
function nicknameOf(p) {
  const n = manual[p?.id]?.[0];
  if (!n) return null;
  return T(n[0] === n[1] ? n[0] : `${n[0]} (${n[1]})`, n[1]);
}
// Усі написання всіх прізвиськ — для пошуку («Шева», «Kun») і як правильні відповіді.
const nicknameVariants = (p) => [...new Set((manual[p?.id] || []).flat())];

module.exports = { nicknameOf, nicknameVariants };
