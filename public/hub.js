// Головна: альбом наліпок. Кожна гра з серверного каталогу (server/games/index.js) — наліпка у стилі свого світу
// (клас s-<id>, картинка — ART[id]); розкладені на дві групи — «можна грати самому» (meta.solo) і «тільки з друзями».
// Наприкінці — порожнє місце «скоро нова гра». У HTML — запасна наліпка, якщо запит не вдасться.
// Мова — /shared/i18n.js: назви й описи ігор сервер віддає мовою з ?lang=, решта — I18n.L.
const { L } = window.I18n;
fetch(`/api/games?lang=${window.I18n.lang}`)
  .then((r) => r.json())
  .then((games) => {
    document.getElementById('solo-games').replaceChildren(...games.filter((g) => g.solo).map(slot));
    document.getElementById('friends-games').replaceChildren(...games.filter((g) => !g.solo).map(slot), soonSlot());
  })
  .catch(() => {});

// Малюнок на наліпці — мотив світу гри (лише CSS і текст, без картинок).
const ART = {
  crossroads: `<span class="a-grid"><i>✕</i><i></i><i>◯</i><i></i><i>✕</i><i></i><i>◯</i><i></i><i>✕</i></span>`,
  path: L(`<span class="a-line"><i><em>Металіст</em></i><i class="ch"><em>Шахтар</em></i><i><em>Дніпро</em></i><i class="q"><em>?</em></i></span>`,
    `<span class="a-line"><i><em>Metalist</em></i><i class="ch"><em>Shakhtar</em></i><i><em>Dnipro</em></i><i class="q"><em>?</em></i></span>`),
  guess: L(`<span class="a-flaps"><i>Х</i><i>Т</i><i>О</i><i class="hot">?</i></span>`, `<span class="a-flaps"><i>W</i><i>H</i><i>O</i><i class="hot">?</i></span>`) + `<span class="a-dots"><i class="g"></i><i class="y"></i><i></i><i class="g"></i><i class="y"></i><i class="g"></i></span>`,
  spy: `<span class="a-file"><span class="a-bar"></span><span class="a-bar short"></span><span class="a-bar"></span><span class="a-stamp">${L('Таємно', 'Secret')}</span></span>`,
  top: `<span class="a-plates"><i><b>1</b><s></s></i><i><b>2</b><s></s></i><i><b>3</b><s></s></i></span>`,
  lineup: `<span class="a-sheet"><span class="as-band"><em>${L('Склад', 'Lineup')}</em><b>3 : 3</b></span><span class="as-col"><i><b>1</b><s style="width:78%"></s></i><i><b>5</b><s style="width:58%"></s></i><i><b>8</b><em>?</em></i><i><b>10</b><s style="width:66%"></s></i></span><span class="as-col b"><i class="b"><b>1</b><s style="width:70%"></s></i><i class="b"><b>4</b><em>?</em></i><i class="b"><b>7</b><s style="width:52%"></s></i><i class="b"><b>9</b><s style="width:76%"></s></i></span></span>`,
  duel: `<span class="a-bout"><i class="r">${L('Червоний', 'Red')}</i><b>VS</b><i class="b">${L('Синій', 'Blue')}</i></span>`,
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
  if (g.solo) row.append(el('span', 'mode solo', L('🎮 Соло', '🎮 Solo')));
  row.append(el('span', 'mode friends', `👥 ${L('З друзями', 'With friends')} · ${g.friends}`));
  return row;
}

// Місце в альбомі (пунктир) і наліпка поверх нього.
function slot(g) {
  const s = el('div', 'slot');
  const a = el('a', `game-card sticker s-${g.id}`);
  a.href = `/${g.id}/`;
  const top = el('span', 'st-top');
  top.append(badges(g));
  const art = el('span', 'st-art');
  art.setAttribute('aria-hidden', 'true');
  art.innerHTML = ART[g.id] || `<span class="a-emoji">${g.emoji}</span>`;
  a.append(top, art, el('span', 'st-name', g.title), el('span', 'st-desc', g.description));
  s.append(a);
  return s;
}

// Порожнє місце в альбомі: наліпку нової гри ще не вклеїли.
function soonSlot() {
  const s = el('div', 'slot soon');
  s.append(el('span', 'soon-mark', '?'), el('b', 'soon-title', L('Скоро нова гра', 'New game coming soon')),
    el('span', 'soon-desc', L('Місце в альбомі вже чекає на наліпку', 'This spot in the album is waiting for its sticker')));
  return s;
}

// Закладка «Що нового»: червона крапка, якщо є версія, новіша за ту, що вже бачили (changes.js запам'ятовує).
try {
  const latest = window.CHANGELOG?.[0]?.date;
  if (latest && localStorage.getItem('changes-seen') !== latest) document.querySelector('#changes-tab .tab-dot').classList.remove('hidden');
} catch { /* без сховища — без крапки */ }
