// Головна: картки ігор із серверного каталогу (server/games/index.js), розкладені на дві групи —
// «можна грати самому» (meta.solo) і «тільки з друзями». У HTML — запасна картка, якщо запит не вдасться.
fetch('/api/games')
  .then((r) => r.json())
  .then((games) => {
    document.getElementById('solo-games').replaceChildren(...games.filter((g) => g.solo).map(card));
    document.getElementById('friends-games').replaceChildren(...games.filter((g) => !g.solo).map(card));
  })
  .catch(() => {});

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

// Значки режимів — одразу видно, чи можна грати самому і скільки людей потрібно.
function badges(g) {
  const row = el('span', 'game-modes');
  if (g.solo) row.append(el('span', 'mode solo', '🎮 Соло'));
  row.append(el('span', 'mode friends', `👥 З друзями · ${g.friends}`));
  return row;
}

function card(g) {
  const a = el('a', 'game-card');
  a.href = `/${g.id}/`;
  const body = el('span', 'game-body');
  body.append(badges(g), el('b', '', g.title), el('span', '', g.description));
  a.append(el('span', 'game-icon', g.emoji), body);
  return a;
}
