// Головна: картки ігор із серверного каталогу (server/games/index.js). У HTML — запасна картка, якщо запит не вдасться.
fetch('/api/games')
  .then((r) => r.json())
  .then((games) => {
    const list = document.getElementById('games');
    list.replaceChildren(...games.map(card), soon());
  })
  .catch(() => {});

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function card(g) {
  const a = el('a', 'game-card');
  a.href = `/${g.id}/`;
  const body = el('span', 'game-body');
  body.append(el('b', '', g.title), el('span', '', g.description), el('small', '', g.players));
  a.append(el('span', 'game-icon', g.emoji), body);
  return a;
}

function soon() {
  const d = el('div', 'game-card soon');
  const body = el('span', 'game-body');
  body.append(el('b', '', 'Скоро нові ігри'), el('span', '', 'Тут з’являтимуться інші футбольні ігри.'));
  d.append(el('span', 'game-icon', '⚽'), body);
  return d;
}
