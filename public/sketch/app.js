// «Тактичний ескіз» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js; тут — серветка-полотно,
// інструменти художника, пропуски слова, стрічка відповідей (той самий чат кімнати), підсумок.
// Штрихи: художник шле 'draw' ({ t: 's' початок | 'm' точки | 'u' назад | 'x' стерти }), інші отримують їх тією ж подією;
// новий хід / перепідключення — повний малюнок дією snapshot. Полотно 1000×750, координати цілі.
(() => {
  const { DIFF: DIFF_LABELS } = RoomClient.LABELS;
  const { L } = window.I18n;
  const pl = (n, uk, en) => window.I18n.plural(n, uk, en);
  const POINTS = [['очко', 'очки', 'очок'], ['point', 'points']];
  const ERASER = '#ffffff'; // «білий» у палітрі — гумка
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state = null;
  let mySeat = -1;

  const g = RoomClient.create({
    id: 'sketch',
    title: L('Тактичний ескіз', 'Tactical Sketch'),
    defaults: { difficulty: 'normal', laps: '2', drawSeconds: '80' },
    fixSetup(setup) {
      if (!['easy', 'normal'].includes(setup.difficulty)) setup.difficulty = 'normal';
    },
    createOptions: (s) => ({ difficulty: s.difficulty, laps: Number(s.laps), drawSeconds: Number(s.drawSeconds) }),
    optionList: (o) => [L('Футболісти: ', 'Footballers: ') + DIFF_LABELS[o.difficulty],
      `${o.laps} ${pl(o.laps, ['коло', 'кола', 'кіл'], ['lap', 'laps'])}`, L(`${o.drawSeconds} с на малюнок`, `${o.drawSeconds} s to draw`)],
    onState(s, prev) {
      state = s;
      mySeat = s.you;
      document.body.classList.toggle('sketching', s.status === 'playing');
      playSounds(prev, s);
      syncCanvas(prev, s);
    },
    onChat: renderFeed,
    renderGame,
    renderFinal,
  });
  const { $, emit, socket, toast, escapeHtml, seatName, seatStyle } = g;

  const amDrawer = () => state?.status === 'playing' && state.drawer === mySeat;
  const canDraw = () => amDrawer() && state.phase === 'draw';

  function playSounds(p, s) {
    if (!p || s.status !== 'playing') return;
    const newTurn = p.turn !== s.turn;
    if (s.phase === 'draw' && (p.phase !== 'draw' || newTurn)) window.Sound.play('whistle');
    const before = newTurn ? 0 : Object.keys(p.guessed || {}).length;
    const now = Object.keys(s.guessed || {}).length;
    if (now > before) {
      window.Sound.play('clink');
      showCoasters(p, s);
    }
    if (s.phase === 'reveal' && p.phase !== 'reveal' && !newTurn) window.Sound.play(s.guessed[mySeat] != null || (amDrawer() && now) ? 'win' : 'miss');
  }

  // ── полотно
  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  let strokes = [];
  let shownTurn = -1;
  let syncing = false;

  function paintStroke(st, from = 0) {
    const p = st.p;
    ctx.save();
    ctx.globalCompositeOperation = st.c === ERASER ? 'destination-out' : 'source-over';
    ctx.strokeStyle = st.c;
    ctx.fillStyle = st.c;
    ctx.lineWidth = st.w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (p.length === 2) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], st.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const start = Math.max(0, from - 2);
      ctx.beginPath();
      ctx.moveTo(p[start], p[start + 1]);
      for (let i = start + 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  function repaint() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach((st) => paintStroke(st));
  }
  function applyOp(op) {
    if (op.t === 's') { strokes.push({ c: op.c, w: op.w, p: [...op.p] }); paintStroke(strokes[strokes.length - 1]); }
    else if (op.t === 'm') {
      const st = strokes[strokes.length - 1];
      if (!st) return;
      const from = st.p.length;
      st.p.push(...op.p);
      paintStroke(st, from);
    } else if (op.t === 'u') { strokes.pop(); repaint(); }
    else if (op.t === 'x') { strokes = []; repaint(); }
  }

  // Новий хід — чисте полотно; посеред ходу (вхід, перепідключення) — повний малюнок із сервера.
  async function sync() {
    syncing = true;
    const res = await emit('snapshot');
    syncing = false;
    if (!res.ok || res.turn !== state?.turn) return;
    strokes = res.strokes.map((st) => ({ ...st, p: [...st.p] }));
    repaint();
  }
  function syncCanvas(p, s) {
    if (s.status !== 'playing') return;
    if (s.turn !== shownTurn) {
      shownTurn = s.turn;
      strokes = [];
      repaint();
      if (p && p.turn === s.turn - 1 && s.phase === 'choose') return; // звичайний перехід ходу — малюнка ще немає
      sync();
    }
  }
  socket.on('draw', (op) => {
    if (syncing || !state || op.turn !== state.turn || amDrawer()) return;
    applyOp(op);
  });
  socket.on('connect', () => { if (state?.status === 'playing') sync(); });

  // ── малює художник
  let color = '#1d1d1f';
  let size = 9;
  let drawing = false;
  let buffer = [];
  let flushTimer = null;
  const send = (op) => socket.emit('draw', op);
  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!buffer.length) return;
    send({ t: 'm', p: buffer });
    buffer = [];
  }
  function point(e) {
    const r = canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * canvas.width), Math.round(((e.clientY - r.top) / r.height) * canvas.height)];
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!canDraw()) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    const p = point(e);
    applyOp({ t: 's', c: color, w: size, p });
    send({ t: 's', c: color, w: size, p });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const st = strokes[strokes.length - 1];
    const p = point(e);
    if (st && Math.hypot(p[0] - st.p[st.p.length - 2], p[1] - st.p[st.p.length - 1]) < 2) return;
    applyOp({ t: 'm', p });
    buffer.push(...p);
    if (buffer.length >= 300) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 40);
  });
  const stop = () => { if (drawing) { drawing = false; flush(); } };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  function renderTools() {
    $('#colors').innerHTML = state.palette.map((c) => `<button type="button" class="swatch ${c === color ? 'on' : ''} ${c === ERASER ? 'eraser' : ''}" data-c="${c}" style="--c:${c}" aria-label="${c === ERASER ? L('Гумка', 'Eraser') : c}" title="${c === ERASER ? L('Гумка', 'Eraser') : ''}">${c === ERASER ? '🧽' : ''}</button>`).join('');
    $('#sizes').innerHTML = state.sizes.map((w) => `<button type="button" class="size ${w === size ? 'on' : ''}" data-w="${w}" aria-label="${w}"><i style="--w:${Math.min(w, 26)}px"></i></button>`).join('');
  }
  $('#colors').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { color = b.dataset.c; renderTools(); } });
  $('#sizes').addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (b) { size = Number(b.dataset.w); renderTools(); } });
  $('#undo-btn').addEventListener('click', () => { if (canDraw() && strokes.length) { flush(); applyOp({ t: 'u' }); send({ t: 'u' }); } });
  $('#clear-btn').addEventListener('click', () => { if (canDraw() && strokes.length) { flush(); applyOp({ t: 'x' }); send({ t: 'x' }); } });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && canDraw() && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); $('#undo-btn').click(); }
  });

  // ── гра
  function wordHtml(text) {
    // пропуски: кожна літера — клітинка; слова — групами (переносяться цілими)
    return text.split(' ').map((w) => `<span class="w">${[...w].map((ch) => (ch === '_' ? '<i></i>' : `<i class="o">${escapeHtml(ch)}</i>`)).join('')}</span>`).join('');
  }
  const letters = (t) => [...t].filter((ch) => ch === '_' || /[\p{L}\p{N}]/u.test(ch)).length;

  function renderGame() {
    const s = state;
    const drawerName = seatName(s.drawer);
    $('#round-info').innerHTML = `<b>${L(`Коло ${s.lap}/${s.laps}`, `Lap ${s.lap}/${s.laps}`)}</b><span>${amDrawer() ? L('✏️ Малюєш ти', '✏️ You are drawing') : L(`✏️ Малює ${escapeHtml(drawerName)}`, `✏️ ${escapeHtml(drawerName)} is drawing`)}</span>`;

    // слово / пропуски
    const cat = s.category ? `<span class="cat">${s.category.icon} ${escapeHtml(s.category.label)}</span>` : '';
    let word = '';
    if (s.phase === 'draw') {
      word = s.word ? `<span class="word known">${escapeHtml(s.word.text)}</span>`
        : `<span class="word">${wordHtml(s.hint)}</span><small class="count">${letters(s.hint)}</small>`;
    } else if (s.phase === 'reveal' && s.answer) word = `<span class="word known">${escapeHtml(s.answer.text)}</span>`;
    $('#word-bar').innerHTML = cat + word;

    // поверх серветки: вибір слова, очікування, відповідь
    const over = $('#over');
    let html = '';
    if (s.phase === 'choose') {
      html = amDrawer() && s.choices
        ? `<div class="pick"><h3>${L('Що малюватимеш?', 'What will you draw?')}</h3>
            <div class="pick-list">${s.choices.map((w) => `<button type="button" class="pick-card" data-key="${escapeHtml(w.key)}">
              ${w.img ? `<span class="pick-img ${w.cat}"><img src="${escapeHtml(w.img)}" alt="" /></span>` : ''}<b>${escapeHtml(w.text)}</b></button>`).join('')}</div>
            <p class="rule">${L('🚫 Без літер і слів, без прапорів — лише малюнок.', '🚫 No letters or words, no flags — just a drawing.')}</p></div>`
        : `<div class="wait">${L(`<b>${escapeHtml(drawerName)}</b> обирає, що малювати…`, `<b>${escapeHtml(drawerName)}</b> is choosing what to draw…`)}</div>`;
    } else if (s.phase === 'reveal' && s.answer) {
      const a = s.answer;
      const got = Object.entries(s.guessed).sort((x, y) => y[1] - x[1]);
      html = `<div class="reveal-card">
          ${a.img ? `<span class="reveal-img ${a.cat}"><img src="${escapeHtml(a.img)}" alt="" /></span>` : ''}
          <small>${L('Це було', 'It was')}</small><h2>${escapeHtml(a.text)}</h2>
          ${s.notice ? `<p class="muted">${escapeHtml(s.notice)}</p>` : ''}
          <ul class="round-results">${got.map(([i, pts]) => `<li style="${seatStyle(Number(i))}"><span class="dot-p"></span>${escapeHtml(seatName(Number(i)))}<b>+${pts}</b></li>`).join('')
            || `<li>${L('Ніхто не вгадав', 'Nobody got it')}</li>`}
            ${s.drawerGain ? `<li style="${seatStyle(s.drawer)}"><span class="dot-p"></span>✏️ ${escapeHtml(drawerName)}<b>+${s.drawerGain}</b></li>` : ''}</ul></div>`;
    }
    over.classList.toggle('hidden', !html);
    if (over.dataset.key !== `${s.turn}:${s.phase}:${Object.keys(s.guessed).length}`) {
      over.dataset.key = `${s.turn}:${s.phase}:${Object.keys(s.guessed).length}`;
      over.innerHTML = html;
    }

    $('#napkin').classList.toggle('can-draw', canDraw());
    $('#tools').classList.toggle('hidden', !canDraw());
    if (canDraw()) renderTools();

    const input = $('#feed-input');
    const done = s.guessed[mySeat] != null;
    input.placeholder = amDrawer() ? L('Чат (без відповіді!)', 'Chat (no spoilers!)')
      : done ? L('Чат для тих, хто вгадав', 'Chat for those who got it') : L('Твоя відповідь…', 'Your guess…');
    $('#reactions').classList.toggle('hidden', false);
    renderScoreboard();
    tick();
  }

  $('#over').addEventListener('click', (e) => {
    const b = e.target.closest('.pick-card');
    if (b) g.act('choose', { key: b.dataset.key });
  });

  // «Підставка під пиво» з очками — фірмова анімація: летить на серветку, коли хтось вгадав.
  function showCoasters(p, s) {
    if (reduced) return;
    const box = $('#coasters');
    for (const [seat, pts] of Object.entries(s.guessed)) {
      if (p.turn === s.turn && p.guessed?.[seat] != null) continue;
      const el = document.createElement('div');
      el.className = 'coaster';
      el.style.cssText = `${seatStyle(Number(seat))};--x:${8 + Math.random() * 70}%;--r:${Math.round(Math.random() * 40 - 20)}deg`;
      el.innerHTML = `<b>+${pts}</b><span>${escapeHtml(seatName(Number(seat)))}</span>`;
      box.appendChild(el);
      setTimeout(() => el.remove(), 2600);
    }
  }

  // ── стрічка відповідей (чат кімнати)
  function renderFeed(list) {
    const feed = $('#feed');
    feed.innerHTML = list.slice(-60).map((m) => (m.system
      ? `<li class="sys">${escapeHtml(m.text)}</li>`
      : `<li style="${seatStyle(m.seat)}" class="${m.seat === mySeat ? 'mine' : ''}"><b>${escapeHtml(m.seat === mySeat ? L('Ти', 'You') : m.name)}:</b> ${escapeHtml(m.text)}</li>`)).join('');
    feed.scrollTop = 1e6;
  }
  $('#feed-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#feed-input');
    const text = input.value.trim();
    if (!text) return;
    const res = await emit('chat', text);
    if (res.error) return toast(res.error, 'bad');
    input.value = '';
    if (res.correct) toast(L('✅ Вгадав!', '✅ You got it!'), 'good');
    else if (res.close) toast(L('🔥 Майже! Ще трохи', '🔥 So close!'), '');
  });

  // ── таблиця
  let shownScores = {};
  function renderScoreboard() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a] || a - b);
    $('#scoreboard').innerHTML = seats.map((i) => {
      const got = s.guessed[i];
      const mark = i === s.drawer && s.status === 'playing' ? '<span class="st">✏️</span>' : got != null ? `<span class="gain">✓ +${got}</span>` : '';
      const bump = shownScores[i] != null && s.scores[i] > shownScores[i] ? 'bump' : '';
      return `<li data-seat="${i}" style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'} ${i === s.drawer ? 'drawer' : ''}">
        <span class="dot-p"></span><span class="nm">${escapeHtml(seatName(i))}</span>${mark}<b class="${bump}">${s.scores[i]}</b></li>`;
    }).join('');
    shownScores = Object.fromEntries(seats.map((i) => [i, s.scores[i]]));
  }

  // ── таймер
  function tick() {
    const el = $('#timer');
    if (!state || state.status !== 'playing' || !state.deadline) { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((state.deadline - g.serverNow()) / 1000));
    el.textContent = state.phase === 'reveal' ? L(`далі через ${left} с`, `next in ${left}s`)
      : state.phase === 'choose' ? L(`вибір · ${left} с`, `choosing · ${left}s`) : `⏱ ${left}`;
    el.classList.toggle('low', state.phase === 'draw' && left <= 10);
  }
  setInterval(tick, 250);

  // ── підсумок
  function renderFinal() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    const top = s.scores[seats[0]];
    const winners = seats.filter((i) => s.scores[i] === top);
    $('#final-title').textContent = winners.length > 1 ? L('Нічия!', "It's a draw!") : winners[0] === mySeat ? L('Ти переміг! 🏆', 'You won! 🏆') : L(`Переміг ${seatName(winners[0])} 🏆`, `${seatName(winners[0])} won 🏆`);
    $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${s.scores[i] === top ? 'win' : ''}">
      <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))}</span><span class="val">${s.scores[i]} ${pl(s.scores[i], ...POINTS)}</span></li>`).join('');
    $('#final-history').innerHTML = s.history.map((h) => {
      const n = Object.keys(h.guessed).length;
      return `<li><span class="nm">${escapeHtml(h.word.text)}</span><small>✏️ ${escapeHtml(h.drawer === mySeat ? L('ти', 'you') : h.drawerName)}</small><span class="val">${n ? `✓ ${n}` : '—'}</span></li>`;
    }).join('');
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost);
    $('#again-wait').textContent = isHost ? '' : L(`${s.seats[s.host]?.name || 'Господар'} може почати ще одну гру.`, `${s.seats[s.host]?.name || 'The host'} can start another game.`);
  }

})();
