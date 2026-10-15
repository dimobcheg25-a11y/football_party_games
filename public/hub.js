// Головна: альбом наліпок. Кожна гра з серверного каталогу (server/games/index.js) — наліпка у стилі свого світу
// (клас s-<id>, картинка — ART[id]); розкладені на дві групи — «можна грати самому» (meta.solo) і «тільки з друзями».
// Номер наліпки — місце гри в каталозі. У HTML — запасна наліпка, якщо запит не вдасться.
fetch('/api/games')
  .then((r) => r.json())
  .then((games) => {
    const no = new Map(games.map((g, i) => [g.id, `№ ${String(i + 1).padStart(2, '0')}`]));
    document.getElementById('solo-games').replaceChildren(...games.filter((g) => g.solo).map((g) => slot(g, no.get(g.id))));
    document.getElementById('friends-games').replaceChildren(...games.filter((g) => !g.solo).map((g) => slot(g, no.get(g.id))));
    document.querySelector('#hub-count b').textContent = games.length;
  })
  .catch(() => {});

// Малюнок на наліпці — мотив світу гри (лише CSS і текст, без картинок).
const ART = {
  crossroads: `<span class="a-grid"><i>✕</i><i></i><i>◯</i><i></i><i>✕</i><i></i><i>◯</i><i></i><i>✕</i></span>`,
  path: `<span class="a-line"><i><em>Металіст</em></i><i class="ch"><em>Шахтар</em></i><i><em>Дніпро</em></i><i class="q"><em>?</em></i></span>`,
  guess: `<span class="a-flaps"><i>Х</i><i>Т</i><i>О</i><i class="hot">?</i></span><span class="a-dots"><i class="g"></i><i class="y"></i><i></i><i class="g"></i><i class="y"></i><i class="g"></i></span>`,
  spy: `<span class="a-file"><span class="a-bar"></span><span class="a-bar short"></span><span class="a-bar"></span><span class="a-stamp">Таємно</span></span>`,
  top: `<span class="a-plates"><i><b>1</b><s></s></i><i><b>2</b><s></s></i><i><b>3</b><s></s></i></span>`,
};

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

// Місце в альбомі (пунктир з номером) і наліпка поверх нього.
function slot(g, no) {
  const s = el('div', 'slot');
  s.dataset.no = no;
  const a = el('a', `game-card sticker s-${g.id}`);
  a.href = `/${g.id}/`;
  const top = el('span', 'st-top');
  top.append(el('span', 'st-no', no), badges(g));
  const art = el('span', 'st-art');
  art.setAttribute('aria-hidden', 'true');
  art.innerHTML = ART[g.id] || `<span class="a-emoji">${g.emoji}</span>`;
  a.append(top, art, el('span', 'st-name', g.title), el('span', 'st-desc', g.description));
  s.append(a);
  return s;
}
