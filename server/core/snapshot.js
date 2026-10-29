// Знімок стану кімнати для відгуку гравця (server/core/feedback.js): що за гра, налаштування, раунд, що загадано, хто що назвав.
// Загальний для всіх ігор — обходить поля кімнати; технічне (таймери, функції, токени, чат) пропускає,
// гравців бази показує як «id (ім'я)», тексти T — українською. Розмір обмежений, щоб влізти в задачу GitHub.
const { isTr } = require('./i18n');

const SKIP = new Set(['onChange', 'broadcast', 'timer', 'chat', 'chatLog', 'reactions', 'decks', 'fameCache']); // decks — усі слова «Ескізу», fameCache — службове «Вікна»
const MAX_ITEMS = 30;
const MAX_DEPTH = 4;
const MAX_CHARS = 20000;

function plain(v, depth = 0) {
  if (v == null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'string') return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  if (typeof v === 'function' || typeof v === 'symbol') return undefined;
  if (isTr(v)) return v.uk;
  if (v.id && v.tags instanceof Set) return `${v.id} (${v.uk || v.name})`; // гравець бази — не весь об'єкт
  if (v.constructor?.name === 'Timeout') return undefined;
  if (depth >= MAX_DEPTH) return '…';
  if (v instanceof Map) v = Object.fromEntries(v);
  if (v instanceof Set) v = [...v];
  if (Array.isArray(v)) {
    const list = v.slice(0, MAX_ITEMS).map((x) => plain(x, depth + 1));
    if (v.length > MAX_ITEMS) list.push(`… ще ${v.length - MAX_ITEMS}`);
    return list;
  }
  const out = {};
  const entries = Object.entries(v).filter(([k]) => !SKIP.has(k) && k !== 'token');
  // великі таблиці (відстані до фінішу, штрихи малюнка) — лише початок, інакше знімок не влізе
  for (const [k, x] of depth ? entries.slice(0, MAX_ITEMS) : entries) { // поля самої кімнати — усі
    const p = plain(x, depth + 1);
    if (p !== undefined) out[k] = p;
  }
  if (entries.length > MAX_ITEMS && depth > 0) out['…'] = `ще ${entries.length - MAX_ITEMS}`;
  return out;
}

// seat — місце того, хто пише відгук (за токеном), щоб було видно, з чийого боку проблема.
function roomSnapshot(room, seat = -1) {
  const data = {
    seat,
    players: room.seats.map((s) => (s ? `${s.name}${s.connected ? '' : ' (офлайн)'}` : null)),
    ...plain(Object.fromEntries(Object.entries(room).filter(([k]) => k !== 'seats'))),
  };
  let json = JSON.stringify(data, null, 1);
  if (json.length > MAX_CHARS) json = `${json.slice(0, MAX_CHARS)}\n… (обрізано)`;
  return json;
}

module.exports = { roomSnapshot };
