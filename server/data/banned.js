// Гравці росії й білорусі — не загадуються в жодній грі: їх немає в базі (server/data/index.js), а в підказках пошуку
// вони сірі з принизливою приміткою і вибрати їх не можна (public/shared/players.js).
// Хто відсіюється: грав за збірну росії/білорусі, або без іншої збірної (СРСР не рахується) має їхнє громадянство (citizenship.json,
// npm run build-citizenship). Українців (збірна, громадянство, тег UKR) не чіпаємо — у Вікідаті багатьом записано радянське «росія».
// Ручні винятки — ALLOW (лишити) і BAN (прибрати).

let careers = { teams: {}, careers: {} };
try {
  careers = require('./careers.json');
} catch {
  // кар'єри ще не зібрані — відсів лише за громадянством
}
let citizenship = {};
try {
  citizenship = require('./citizenship.json');
} catch {
  // громадянство ще не зібране (npm run build-citizenship)
}

const HOSTILE = new Set(['Росія', 'Білорусь']);
const SOVIET = new Set(['Союз Радянських Соціалістичних Республік', 'СРСР', 'СНД']);
const ALLOW = new Set([
  'Q295746', // Олег Саленко — грав і за Україну, живе в Києві
  'Q370119', // Валентин Бєлькевич — легенда «Динамо» Київ
]);
const BAN = new Set([]);

function isBanned(p) {
  if (ALLOW.has(p.qid)) return false;
  if (BAN.has(p.qid)) return true;
  const nation = careers.teams[careers.careers[p.qid]?.nation?.t]?.name || null;
  if (HOSTILE.has(nation)) return true;
  if (nation && !SOVIET.has(nation)) return false; // грав за іншу збірну (Єременко — Фінляндія)
  const cit = citizenship[p.qid] || [];
  if (cit.includes('UA') || p.tags.includes('UKR')) return false;
  return cit.includes('RU') || cit.includes('BY');
}

module.exports = { isBanned };
