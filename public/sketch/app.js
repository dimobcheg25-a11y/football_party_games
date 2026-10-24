// «Тактичний ескіз» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js; тут — серветка-полотно,
// інструменти художника (пензель, гумка, заливка, лінія, прямокутник, овал), пропуски слова, стрічка відповідей (той самий чат
// кімнати) з підказками слів при введенні, підсумок.
// Малюнок: художник шле 'draw' ({ t: 's' штрих | 'm' точки штриха | 'g' фігура | 'f' заливка | 'u' назад | 'x' стерти }), інші
// отримують те саме; новий хід / перепідключення — повний малюнок дією snapshot. Полотно 1000×750, координати цілі;
// заливку кожен робить у своєму полотні (у тому ж порядку — результат однаковий).
(() => {
  const { DIFF: DIFF_LABELS } = RoomClient.LABELS;
  const { L } = window.I18n;
  const pl = (n, uk, en) => window.I18n.plural(n, uk, en);
  const POINTS = [['очко', 'очки', 'очок'], ['point', 'points']];
  const SHAPES = ['line', 'rect', 'oval'];
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
    hints: {
      difficulty: {
        easy: L('Найвідоміші футболісти (топ-400) і клуби, прості терміни й головні трофеї.',
          'The most famous footballers (top 400) and clubs, simple terms and the main trophies.'),
        normal: L('Футболісти до топ-800, більше клубів, терміни й трофеї для тих, хто дивиться футбол.',
          'Footballers up to the top 800, more clubs, terms and trophies for those who follow football.'),
      },
      drawSeconds: {
        0: L('Без таймера: очки — за порядком (100, 80, 60…). Не знаєш — «🏳️ Не знаю».',
          'No timer: points go by order (100, 80, 60…). Stuck? Press “🏳️ No idea”.'),
      },
    },
    createOptions: (s) => ({ difficulty: s.difficulty, laps: Number(s.laps), drawSeconds: Number(s.drawSeconds) }),
    optionList: (o) => [DIFF_LABELS[o.difficulty],
      `${o.laps} ${pl(o.laps, ['коло', 'кола', 'кіл'], ['lap', 'laps'])}`,
      o.drawSeconds ? L(`${o.drawSeconds} с на малюнок`, `${o.drawSeconds} s to draw`) : L('без таймера', 'no timer')],
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
  const { $, emit, socket, toast, ask, escapeHtml, seatName, seatStyle } = g;

  const amDrawer = () => state?.status === 'playing' && state.drawer === mySeat;
  const canDraw = () => amDrawer() && state.phase === 'draw';
  const iGuessed = () => state?.guessed?.[mySeat] != null;
  const iPassed = () => !!state?.passed?.includes(mySeat);

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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const preview = $('#preview');
  const pctx = preview.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  let items = []; // елементи малюнка: штрих { c, w, p }, фігура { k, c, w, p }, заливка { k: 'fill', c, p }
  let shownTurn = -1;
  let syncing = false;

  function style(c2d, it) {
    c2d.globalCompositeOperation = it.c === state?.erase ? 'destination-out' : 'source-over';
    c2d.strokeStyle = it.c === state?.erase ? '#000' : it.c;
    c2d.fillStyle = c2d.strokeStyle;
    c2d.lineWidth = it.w;
    c2d.lineCap = 'round';
    c2d.lineJoin = 'round';
  }
  function paintShape(c2d, it) {
    const [x1, y1, x2, y2] = it.p;
    c2d.beginPath();
    if (it.k === 'line') { c2d.moveTo(x1, y1); c2d.lineTo(x2, y2); }
    else if (it.k === 'rect') c2d.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    else c2d.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    c2d.stroke();
  }
  function paint(it, from = 0) {
    if (it.k === 'fill') return floodFill(it.p[0], it.p[1], it.c);
    ctx.save();
    style(ctx, it);
    if (it.k) paintShape(ctx, it);
    else if (it.p.length === 2) {
      ctx.beginPath();
      ctx.arc(it.p[0], it.p[1], it.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const start = Math.max(0, from - 2);
      ctx.beginPath();
      ctx.moveTo(it.p[start], it.p[start + 1]);
      for (let i = start + 2; i < it.p.length; i += 2) ctx.lineTo(it.p[i], it.p[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Заливка області схожого кольору (порожнє полотно — прозоре); межу з напівпрозорими пікселями згладжування теж зафарбовуємо.
  function floodFill(x0, y0, hex) {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const fr = parseInt(hex.slice(1, 3), 16), fg = parseInt(hex.slice(3, 5), 16), fb = parseInt(hex.slice(5, 7), 16);
    const start = (Math.min(H - 1, y0) * W + Math.min(W - 1, x0)) * 4;
    const [tr, tg, tb, ta] = [d[start], d[start + 1], d[start + 2], d[start + 3]];
    if (ta === 255 && tr === fr && tg === fg && tb === fb) return;
    const near = (i) => (ta < 40 ? d[i + 3] < 90 : Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) + Math.abs(d[i + 3] - ta) < 120);
    const mask = new Uint8Array(W * H);
    const stack = [start / 4];
    while (stack.length) {
      let n = stack.pop();
      let x = n % W;
      const y = (n - x) / W;
      while (x > 0 && !mask[n - 1] && near((n - 1) * 4)) { n--; x--; }
      let up = false, down = false;
      for (; x < W && !mask[n] && near(n * 4); n++, x++) {
        mask[n] = 1;
        if (y > 0) { const u = n - W; if (!mask[u] && near(u * 4)) { if (!up) { stack.push(u); up = true; } } else up = false; }
        if (y < H - 1) { const v = n + W; if (!mask[v] && near(v * 4)) { if (!down) { stack.push(v); down = true; } } else down = false; }
      }
    }
    const paintPx = (i) => { d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255; };
    for (let n = 0; n < mask.length; n++) {
      if (!mask[n]) continue;
      paintPx(n * 4);
      // згладжування на межі: сусід напівпрозорий — теж фарбуємо (інакше біла облямівка)
      for (const m of [n - 1, n + 1, n - W, n + W]) if (m >= 0 && m < mask.length && !mask[m] && d[m * 4 + 3] < 200) paintPx(m * 4);
    }
    ctx.putImageData(img, 0, 0);
  }

  function repaint() {
    ctx.clearRect(0, 0, W, H);
    items.forEach((it) => paint(it));
  }
  function applyOp(op) {
    if (op.t === 's') { items.push({ c: op.c, w: op.w, p: [...op.p] }); paint(items[items.length - 1]); }
    else if (op.t === 'g') { items.push({ k: op.k, c: op.c, w: op.w, p: [...op.p] }); paint(items[items.length - 1]); }
    else if (op.t === 'f') { items.push({ k: 'fill', c: op.c, p: [...op.p] }); paint(items[items.length - 1]); }
    else if (op.t === 'm') {
      const it = items[items.length - 1];
      if (!it || it.k) return;
      const from = it.p.length;
      it.p.push(...op.p);
      paint(it, from);
    } else if (op.t === 'u') { items.pop(); repaint(); }
    else if (op.t === 'x') { items = []; repaint(); }
  }

  // Новий хід — чисте полотно; посеред ходу (вхід, перепідключення) — повний малюнок із сервера.
  async function sync() {
    syncing = true;
    const res = await emit('snapshot');
    syncing = false;
    if (!res.ok || res.turn !== state?.turn) return;
    items = res.strokes.map((it) => ({ ...it, p: [...it.p] }));
    repaint();
  }
  function syncCanvas(p, s) {
    if (s.status !== 'playing') return;
    if (s.turn !== shownTurn) {
      shownTurn = s.turn;
      items = [];
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
  let tool = 'pen'; // pen | erase | fill | line | rect | oval
  let color = '#1d1d1f';
  let size = 6;
  let drawing = null; // { kind: 'pen' } | { kind: 'shape', p0 }
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
    const x = Math.round(((e.clientX - r.left) / r.width) * W);
    const y = Math.round(((e.clientY - r.top) / r.height) * H);
    return [Math.max(0, Math.min(W, x)), Math.max(0, Math.min(H, y))];
  }
  function act(op) {
    applyOp(op);
    send(op);
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!canDraw()) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = point(e);
    if (tool === 'fill') return act({ t: 'f', c: color, p });
    if (SHAPES.includes(tool)) { drawing = { kind: 'shape', p0: p }; return; }
    drawing = { kind: 'pen' };
    act({ t: 's', c: tool === 'erase' ? state.erase : color, w: size, p });
  });
  canvas.addEventListener('pointermove', (e) => {
    moveBrush(e);
    if (!drawing) return;
    const p = point(e);
    if (drawing.kind === 'shape') {
      pctx.clearRect(0, 0, W, H);
      pctx.save();
      style(pctx, { c: color, w: size });
      paintShape(pctx, { k: tool, p: [...drawing.p0, ...p] });
      pctx.restore();
      return;
    }
    const it = items[items.length - 1];
    if (it && Math.hypot(p[0] - it.p[it.p.length - 2], p[1] - it.p[it.p.length - 1]) < 2) return;
    applyOp({ t: 'm', p });
    buffer.push(...p);
    if (buffer.length >= 300) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 40);
  });
  function stop(e) {
    if (!drawing) return;
    if (drawing.kind === 'shape') {
      pctx.clearRect(0, 0, W, H);
      const p = point(e);
      if (Math.hypot(p[0] - drawing.p0[0], p[1] - drawing.p0[1]) > 4) act({ t: 'g', k: tool, c: color, w: size, p: [...drawing.p0, ...p] });
    } else flush();
    drawing = null;
  }
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  // Курсор-пензлик: коло розміру й кольору пензля (гумка — пунктир, заливка — відро) ще до першого штриха.
  const brush = $('#brush');
  function moveBrush(e) {
    if (!canDraw() || e.pointerType === 'touch') { brush.classList.add('hidden'); return; }
    const r = canvas.getBoundingClientRect();
    const box = $('#napkin').getBoundingClientRect();
    const d = Math.max(6, (size * r.width) / W);
    brush.classList.remove('hidden');
    brush.className = `brush tool-${tool}`;
    brush.style.cssText = `left:${e.clientX - box.left}px;top:${e.clientY - box.top}px;--d:${tool === 'fill' ? 0 : d}px;--c:${color}`;
  }
  canvas.addEventListener('pointerleave', () => brush.classList.add('hidden'));
  // Телефон: дотик до полотна не прокручує й не масштабує сторінку, поки малюєш (touch-action підтримують не всі браузери).
  for (const ev of ['touchstart', 'touchmove']) canvas.addEventListener(ev, (e) => { if (canDraw()) e.preventDefault(); }, { passive: false });

  const TOOLS = [
    ['pen', '✏️', L('Пензель', 'Brush')], ['erase', '🧽', L('Гумка', 'Eraser')], ['fill', '🪣', L('Заливка', 'Fill')],
    ['line', '／', L('Лінія', 'Line')], ['rect', '▭', L('Прямокутник', 'Rectangle')], ['oval', '◯', L('Овал', 'Oval')],
  ];
  function renderTools() {
    $('#tool-btns').innerHTML = TOOLS.map(([id, icon, name]) => `<button type="button" class="tool ${id === tool ? 'on' : ''}" data-tool="${id}" title="${name}" aria-label="${name}">${icon}</button>`).join('');
    $('#colors').innerHTML = state.palette.map((c) => `<button type="button" class="swatch ${c === color && tool !== 'erase' ? 'on' : ''}" data-c="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('');
    renderSize();
  }
  $('#tool-btns').addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (b) { tool = b.dataset.tool; renderTools(); } });
  $('#colors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    color = b.dataset.c;
    if (tool === 'erase') tool = 'pen';
    renderTools();
  });
  // Товщина — повзунком (не перемальовується зі станом, щоб не збивати перетягування); поруч — кружечок справжнього розміру й кольору.
  const range = $('#size-range');
  function renderSize() {
    range.min = state.size.min;
    range.max = state.size.max;
    range.value = size;
    const r = canvas.getBoundingClientRect();
    const d = Math.max(3, (size * (r.width || W)) / W);
    $('#size-dot').style.cssText = `--d:${d}px;--c:${color}`;
    $('#size-dot').classList.toggle('erase', tool === 'erase');
  }
  range.addEventListener('input', () => { size = Number(range.value); renderSize(); });
  $('#undo-btn').addEventListener('click', () => { if (canDraw() && items.length) { flush(); act({ t: 'u' }); } });
  $('#clear-btn').addEventListener('click', () => { if (canDraw() && items.length) { flush(); act({ t: 'x' }); } });
  $('#giveup-btn').addEventListener('click', async () => {
    if (await ask(L('Здатися й показати відповідь?', 'Give up and show the answer?'), { note: L('Очок за цей хід не буде.', 'No points for this turn.'), ok: L('🏳️ Здатися', '🏳️ Give up'), danger: true })) g.act('giveUp');
  });
  document.addEventListener('keydown', (e) => {
    if (!canDraw() || document.activeElement?.tagName === 'INPUT' && document.activeElement !== range) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); $('#undo-btn').click(); }
    if (e.key === '[' || e.key === ']') { // товщина з клавіатури, як у графічних редакторах
      size = Math.max(state.size.min, Math.min(state.size.max, size + (e.key === ']' ? 2 : -2)));
      renderSize();
    }
  });

  // ── гра

  function renderGame() {
    const s = state;
    const drawerName = seatName(s.drawer);
    $('#round-info').innerHTML = `<b>${L(`Коло ${s.lap}/${s.laps}`, `Lap ${s.lap}/${s.laps}`)}</b><span>${amDrawer() ? L('✏️ Малюєш ти', '✏️ You are drawing') : L(`✏️ Малює ${escapeHtml(drawerName)}`, `✏️ ${escapeHtml(drawerName)} is drawing`)}</span>`;

    // категорія; слово — лише художнику, тим, хто вгадав, і після ходу (ні літер, ні їх кількості гравцям не показуємо)
    const cat = s.category ? `<span class="cat">${s.category.icon} ${escapeHtml(s.category.label)}</span>` : '';
    let word = '';
    if (s.phase === 'draw' && s.word) word = `<span class="word known">${escapeHtml(s.word.text)}</span>`;
    else if (s.phase === 'draw') word = `<span class="word guess">${L('Що це?', 'What is it?')}</span>${amDrawer() ? '' : '<span class="worth" id="worth"></span>'}`;
    else if (s.phase === 'reveal' && s.answer) word = `<span class="word known">${escapeHtml(s.answer.text)}</span>`;
    $('#word-bar').innerHTML = cat + word;
    updateWorth();

    // поверх серветки: вибір слова, очікування, відповідь
    const over = $('#over');
    let html = '';
    if (s.phase === 'choose') {
      html = amDrawer() && s.choices
        ? `<div class="pick"><h3>${L('Що малюватимеш?', 'What will you draw?')}</h3>
            <div class="pick-list">${s.choices.map((w) => `<button type="button" class="pick-card" data-key="${escapeHtml(w.key)}">
              <small class="pick-cat">${w.catIcon} ${escapeHtml(w.catLabel)}</small>
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
    else brush.classList.add('hidden');

    const input = $('#feed-input');
    input.placeholder = amDrawer() ? L('Чат (без відповіді!)', 'Chat (no spoilers!)')
      : iGuessed() ? L('Чат для тих, хто вгадав', 'Chat for those who got it') : L('Твоя відповідь…', 'Your guess…');
    $('#pass-btn').classList.toggle('hidden', !(s.phase === 'draw' && !amDrawer() && !iGuessed()));
    $('#pass-btn').disabled = iPassed();
    $('#pass-btn').textContent = iPassed() ? L('🏳️ Чекаємо інших…', '🏳️ Waiting for others…') : L('🏳️ Не знаю', '🏳️ No idea');
    if (amDrawer() || iGuessed()) renderSuggestions();
    renderScoreboard();
    tick();
  }

  $('#over').addEventListener('click', (e) => {
    const b = e.target.closest('.pick-card');
    if (b) g.act('choose', { key: b.dataset.key });
  });
  $('#pass-btn').addEventListener('click', () => g.act('pass'));

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
  async function say(text) {
    const input = $('#feed-input');
    if (!text) return;
    const res = await emit('chat', text);
    if (res.error) return toast(res.error, 'bad');
    input.value = '';
    renderSuggestions();
    if (res.correct) toast(L('✅ Вгадав!', '✅ You got it!'), 'good');
    else if (res.close) toast(L('🔥 Майже! Ще трохи', '🔥 So close!'), '');
  }
  $('#feed-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (active >= 0 && suggestions[active]) return say(suggestions[active].t);
    say($('#feed-input').value.trim());
  });

  // Підказки при введенні: усі можливі відповіді (словник гри), спершу — з категорії цього ходу. Клік / Tab / ↓+Enter — обрати;
  // просто Enter — надіслати як написано (у чаті можна писати й звичайні повідомлення).
  let dict = [];
  fetch(`/api/sketch/words?lang=${window.I18n.lang}`).then((r) => r.json()).then((list) => {
    const norm = window.Players.normalize;
    dict = list.map((w) => {
      const variants = [norm(w.t), ...w.v];
      return { ...w, variants, tokens: variants.flatMap((v) => v.split(' ')) };
    });
  }).catch(() => {});
  let suggestions = [];
  let active = -1;
  function searchWords(query) {
    const q = window.Players.normalize(query);
    if (q.length < 2) return [];
    const parts = q.split(' ');
    const cat = state?.category?.id;
    const scored = [];
    for (const w of dict) {
      if (!parts.every((part) => w.tokens.some((t) => t.startsWith(part)))) continue;
      let score = 0;
      if (w.variants.some((v) => v === q)) score += 100;
      if (w.variants.some((v) => v.startsWith(q))) score += 20;
      if (w.c === cat) score += 50;
      scored.push({ w, score });
    }
    scored.sort((a, b) => b.score - a.score || a.w.t.length - b.w.t.length);
    const seen = new Set();
    return scored.map((x) => x.w).filter((w) => !seen.has(w.t) && seen.add(w.t)).slice(0, 6);
  }
  const ICONS = { players: '⚽', clubs: '🛡️', terms: '📖' };
  function renderSuggestions() {
    const input = $('#feed-input');
    const list = $('#word-suggestions');
    const off = !state || state.phase !== 'draw' || amDrawer() || iGuessed();
    suggestions = off ? [] : searchWords(input.value);
    if (active >= suggestions.length) active = -1;
    const shamed = off ? '' : window.Players.shame(input.value); // росіяни — сірі, вибрати не можна
    list.innerHTML = suggestions.map((w, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''}"><span class="s-icon">${ICONS[w.c] || ''}</span><span class="s-main">${escapeHtml(w.t)}</span></li>`).join('') + shamed;
  }
  const input = $('#feed-input');
  input.addEventListener('input', () => { active = -1; renderSuggestions(); });
  input.addEventListener('keydown', (e) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, suggestions.length - 1); renderSuggestions(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(active - 1, -1); renderSuggestions(); e.preventDefault(); }
    if (e.key === 'Tab') { say(suggestions[Math.max(active, 0)].t); e.preventDefault(); }
    if (e.key === 'Escape') { suggestions = []; $('#word-suggestions').innerHTML = ''; }
  });
  input.addEventListener('blur', () => setTimeout(() => { $('#word-suggestions').innerHTML = ''; }, 200));
  input.addEventListener('focus', renderSuggestions);
  $('#word-suggestions').addEventListener('mousedown', (e) => e.preventDefault()); // фокус лишається в полі
  $('#word-suggestions').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) say(suggestions[Number(li.dataset.i)].t);
  });

  // ── таблиця
  let shownScores = {};
  function renderScoreboard() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a] || a - b);
    $('#scoreboard').innerHTML = seats.map((i) => {
      const got = s.guessed[i];
      const mark = i === s.drawer && s.status === 'playing' ? '<span class="st">✏️</span>'
        : got != null ? `<span class="gain">✓ +${got}</span>` : s.passed?.includes(i) ? '<span class="st">🏳️</span>' : '';
      const bump = shownScores[i] != null && s.scores[i] > shownScores[i] ? 'bump' : '';
      return `<li data-seat="${i}" style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'} ${i === s.drawer ? 'drawer' : ''}">
        <span class="dot-p"></span><span class="nm">${escapeHtml(seatName(i))}</span>${mark}<b class="${bump}">${s.scores[i]}</b></li>`;
    }).join('');
    shownScores = Object.fromEntries(seats.map((i) => [i, s.scores[i]]));
  }

  // Скільки дасть правильна відповідь зараз (як score() на сервері): з таймером — тане з часом, без — за порядком.
  function updateWorth() {
    const el = $('#worth');
    const s = state;
    if (!el || !s || s.phase !== 'draw' || !s.points) return;
    const done = Object.keys(s.guessed).length;
    const ms = s.drawSeconds * 1000;
    let pts = ms && s.deadline
      ? Math.round((s.points.min + (s.points.max - s.points.min) * (Math.max(0, s.deadline - g.serverNow()) / ms)) / 5) * 5
      : Math.max(s.points.min, s.points.max - s.points.step * done);
    if (!done) pts += s.points.first;
    el.textContent = L(`вгадаєш зараз — +${pts}`, `guess now — +${pts}`);
    el.title = done ? '' : L(`разом з +${s.points.first} першому`, `incl. +${s.points.first} for being first`);
  }

  // ── таймер (без таймера — скільки вже малюють)
  function tick() {
    updateWorth();
    const el = $('#timer');
    if (!state || state.status !== 'playing') { el.textContent = ''; return; }
    if (state.phase === 'draw' && !state.deadline && state.startedAt) {
      const sec = Math.max(0, Math.floor((g.serverNow() - state.startedAt) / 1000));
      el.textContent = `∞ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      el.classList.remove('low');
      return;
    }
    if (!state.deadline) { el.textContent = ''; return; }
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
