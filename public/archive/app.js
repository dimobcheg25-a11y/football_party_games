// «Фотоархів» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js;
// тут — фото під сіткою 5×5, слоти загаданих гравців, відповіді, а після кадру — звіти 🚩 / ➕ (бета: фото ще перевіряються).
(() => {
  const { L, name: pname } = window.I18n;
  const pl = (n, uk, en) => window.I18n.plural(n, uk, en);
  const CATEGORY_LABELS = { all: L('🎞 усі фото', '🎞 all photos'), modern: L('📸 сучасні', '📸 modern'), legends: L('🕰 легенди', '🕰 legends') };
  const DIFF_LABELS = { easy: L('🟢 легкий', '🟢 easy'), normal: L('🟡 звичайний', '🟡 normal'), fan: L('🟣 фанат', '🟣 fan') };
  const MODE_LABELS = { own: L('кожен свою сітку', 'everyone their own grid'), turns: L('спільна сітка по черзі', 'one shared grid, taking turns') };
  const REASONS = {
    hidden: L('Загаданих не видно / дрібні', 'Can’t see the players / too small'),
    wrong: L('На фото не ті люди', 'Wrong people in the photo'),
    boring: L('Не матч: тренування, натовп', 'Not a match: training, crowd'),
    other: L('Інше', 'Other'),
  };
  const ROWS = 'ABCDE';

  let state = null;
  let mySeat = -1;
  let counts = null;
  fetch('/api/archive/counts').then((r) => r.json()).then((c) => { counts = c; g.renderSetup(); }).catch(() => {});

  const g = RoomClient.create({
    id: 'archive',
    title: L('Фотоархів', 'Photo Archive'),
    defaults: { category: 'all', difficulty: 'easy', mode: 'own', roundSeconds: '120', turnSeconds: '30', rounds: '10' },
    onSetup(setup) {
      $('#mode-hint').textContent = setup.mode === 'turns'
        ? L('Одна сітка на всіх: у свій хід відкрий квадратик і назви гравця. Хто назвав — той і отримав очки.', 'One grid for everyone: on your turn open a tile and name a player. Whoever names him gets the points.')
        : L('У кожного своя сітка на тому самому фото; хто відкрив менше — набрав більше.', 'Everyone has their own grid on the same photo; open fewer tiles to score more.');
      $('#round-time-field').classList.toggle('hidden', setup.mode === 'turns');
      $('#turn-time-field').classList.toggle('hidden', setup.mode !== 'turns');
      const n = counts?.[setup.category]?.[setup.difficulty];
      $('#category-hint').textContent = n != null ? L(`Фото для цих налаштувань: ${n}`, `Photos for these settings: ${n}`) : '';
    },
    createOptions: (s) => ({ category: s.category, level: s.difficulty, mode: s.mode, roundSeconds: Number(s.roundSeconds), turnSeconds: Number(s.turnSeconds), rounds: Number(s.rounds) }),
    optionList,
    onState(s, prev) {
      state = s;
      mySeat = s.you;
      playSounds(prev, s);
    },
    renderGame,
    renderFinal,
  });
  const { $, emit, store, toast, ask, escapeHtml, initials, seatName, seatStyle } = g;

  function optionList(o, solo) {
    return [CATEGORY_LABELS[o.category], DIFF_LABELS[o.level], solo ? null : MODE_LABELS[o.mode],
      o.mode === 'turns' ? (o.turnSeconds ? L(`${o.turnSeconds} с на хід`, `${o.turnSeconds} s per turn`) : L('хід без таймера', 'no turn timer'))
        : o.roundSeconds ? L(`${o.roundSeconds / 60} хв на фото`, `${o.roundSeconds / 60} min per photo`) : L('без таймера', 'no timer'),
      `${o.rounds} ${pl(o.rounds, ['фото', 'фото', 'фото'], ['photo', 'photos'])}`].filter(Boolean);
  }

  const turns = () => state.options.mode === 'turns';
  const openSet = () => new Set(state.phase === 'reveal' ? Array.from({ length: state.tiles }, (_, i) => i) : turns() ? state.open : state.mine?.open || []);
  const foundList = () => (turns() ? state.found : state.mine?.found) || [];

  function playSounds(p, s) {
    if (!p) return;
    if (s.phase === 'guess' && (p.phase !== 'guess' || p.shot?.id !== s.shot?.id)) window.Sound.play('whistle');
    else if (s.options.mode === 'turns' && s.phase === 'guess') {
      if (s.active === mySeat && p.active !== mySeat) window.Sound.play('myTurn');
      else if (s.open.length > p.open?.length) window.Sound.play('shutter');
      if (s.found.length > (p.found?.length || 0)) window.Sound.play('hit');
    }
  }

  // ── гра
  function renderGame() {
    const s = state;
    $('#round-info').innerHTML = `<b>${L(`Кадр ${s.round} з ${s.rounds}`, `Shot ${s.round} of ${s.rounds}`)}</b><span>${s.shot.legend ? L('🕰 легенда', '🕰 legend') : ''} ${s.solo ? '' : MODE_LABELS[s.options.mode]}</span>`;
    renderPrint();
    renderSlots();
    renderAnswerBox();
    renderMisses();
    renderRevealBar();
    renderReport();
    $('#reactions').classList.toggle('hidden', s.solo);
    renderScoreboard();
    tick();
  }

  // фото й сітка: квадратики будуємо раз на фото, далі лише перемикаємо класи — щоб відкриття анімувалось лише для нових
  let builtFor = null;
  function renderPrint() {
    const s = state;
    const frame = $('#frame');
    if (builtFor !== s.shot.id) {
      builtFor = s.shot.id;
      frame.style.aspectRatio = `${s.shot.w} / ${s.shot.h}`;
      const img = $('#shot-img');
      img.src = s.shot.img;
      $('#tiles').innerHTML = Array.from({ length: s.tiles }, (_, i) => `<button type="button" class="tile" data-tile="${i}" aria-label="${L('Відкрити квадратик', 'Open tile')} ${ROWS[Math.floor(i / 5)]}${(i % 5) + 1}"><span>${ROWS[Math.floor(i / 5)]}${(i % 5) + 1}</span></button>`).join('');
      $('#edge-right').textContent = `▸ ${String(s.round).padStart(2, '0')}A`;
    }
    const open = openSet();
    const can = canOpen();
    for (const b of $('#tiles').children) {
      const i = Number(b.dataset.tile);
      b.classList.toggle('open', open.has(i));
      b.disabled = open.has(i) || !can;
    }
    $('#edge-open').textContent = L(`ВІДКРИТО ${open.size} / ${s.tiles}`, `OPEN ${open.size} / ${s.tiles}`);
    const sh = s.shot;
    $('#credit').innerHTML = s.phase === 'reveal'
      ? `<span>${sh.year || ''}</span><a href="${escapeHtml(sh.page)}" target="_blank" rel="noopener">${L('Фото', 'Photo')}: ${escapeHtml(sh.author || L('автор невідомий', 'unknown author'))} · ${escapeHtml(sh.license || '')} · Wikimedia Commons</a>`
      : `<span>${L('Підпис — після відгадування', 'Caption after guessing')}</span><span>Wikimedia Commons</span>`;
  }

  function canOpen() {
    const s = state;
    if (s.phase !== 'guess') return false;
    if (turns()) return s.active === mySeat && !s.turnOpened;
    return !s.mine?.done;
  }

  $('#tiles').addEventListener('click', async (e) => {
    const b = e.target.closest('.tile');
    if (!b || b.disabled) return;
    b.classList.add('open'); // одразу, не чекаючи сервера
    window.Sound.play('shutter');
    const res = await emit('open', { tile: Number(b.dataset.tile) });
    if (res.error) { b.classList.remove('open'); toast(res.error, 'bad'); }
  });

  function face(p) {
    return p.photo ? `<img src="${escapeHtml(p.photo)}" alt="" loading="lazy" />` : `<b>${escapeHtml(initials(p.name || '?'))}</b>`;
  }

  let shownFound = new Set(); // кого вже показали — «проявлення» лише для нових
  function renderSlots() {
    const s = state;
    const n = s.shot.count;
    const reveal = s.phase === 'reveal';
    $('#ask-head').innerHTML = `<h2>${L(`На фото ${n} ${pl(n, ['гравець', 'гравці', 'гравців'], ['player', 'players'])}`, `${n} ${n === 1 ? 'player' : 'players'} in this shot`)}</h2>
      <p>${n === 1 ? L('Загадано лише його. На кадрі можуть бути й інші: за них ні очок, ні штрафу.', 'Only he counts. Others may be in the shot too: no points and no penalty for them.')
    : L('Загадано лише цих — у будь-якому порядку. На кадрі можуть бути й інші: за них ні очок, ні штрафу.', 'Only these count — any order. Others may be in the shot too: no points and no penalty for them.')}</p>`;
    const found = foundList();
    const cards = reveal
      ? s.shot.targets.map((p) => {
        const mine = turns() ? p.by.length : found.find((f) => f.id === p.id);
        return slotCard(p, mine ? (turns() ? `+${s.found.find((f) => f.id === p.id)?.points ?? ''}` : `+${mine.points}`) : L('не відгадано', 'not guessed'), !mine, p.by);
      })
      : [...found.map((f) => slotCard(f, `+${f.points}`, false, turns() ? [f.seat] : [])),
        ...Array.from({ length: Math.max(0, n - found.length) }, (_, k) => `<div class="slot-card empty"><span class="sc-face">?</span><span class="sc-text"><b>${L('Гравець', 'Player')} ${found.length + k + 1}</b></span></div>`)];
    $('#slots').innerHTML = cards.join('');
    for (const f of found) shownFound.add(`${s.shot.id}:${f.id}`);
    if (reveal) for (const p of s.shot.targets) shownFound.add(`${s.shot.id}:${p.id}`);
    const worth = turns() ? s.worth : s.mine?.worth;
    $('#worth').innerHTML = reveal ? (s.shot.others.length
      ? `<span class="also">${L('Також на фото', 'Also in the shot')}: ${s.shot.others.map((p) => escapeHtml(pname(p))).join(', ')}</span>` : '')
      : `<span>${L('Зараз за гравця', 'Now per player')}:</span><b>${worth}</b><small>100 − 4 × ${openSet().size}</small>`;
  }

  function slotCard(p, pts, miss, by = []) {
    const fresh = !shownFound.has(`${state.shot.id}:${p.id}`);
    const dots = !state.solo && by?.length ? `<span class="sc-by">${by.map((i) => `<i class="dot-p" style="${seatStyle(i)}" title="${escapeHtml(seatName(i))}"></i>`).join('')}</span>` : '';
    return `<div class="slot-card ${fresh ? 'develop' : ''} ${miss ? 'miss' : ''}"><span class="sc-face">${face(p)}</span>
      <span class="sc-text"><b>${escapeHtml(pname(p))}</b><small>${escapeHtml(pts)}</small></span>${dots}</div>`;
  }

  function canAnswer() {
    const s = state;
    if (s.phase !== 'guess') return false;
    if (turns()) return s.active === mySeat && (s.turnOpened || s.open.length >= s.tiles);
    return !s.mine?.done;
  }

  function renderAnswerBox() {
    const s = state;
    const reveal = s.phase === 'reveal';
    $('#answer-box').classList.toggle('hidden', reveal);
    if (reveal) return;
    const can = canAnswer();
    const input = $('#guess-input');
    input.disabled = !can;
    if (!can) { input.value = ''; renderSuggestions(); }
    $('#pass-btn').classList.toggle('hidden', !turns());
    $('#pass-btn').disabled = s.active !== mySeat;
    $('#skip-btn').classList.toggle('hidden', !(s.canSkip && s.host === mySeat));
    const fin = $('#finish-btn');
    const online = s.seats.filter((x) => x && x.connected).length;
    if (turns()) {
      const voted = s.finishVotes.includes(mySeat);
      fin.disabled = voted;
      fin.textContent = voted ? L(`🏁 Чекаємо інших (${s.finishVotes.length}/${online})`, `🏁 Waiting for others (${s.finishVotes.length}/${online})`) : L('🏁 Досить', '🏁 That’s it');
      const name = s.active >= 0 ? `<b class="pc" style="${seatStyle(s.active)}">${escapeHtml(seatName(s.active))}</b>` : '';
      $('#turn-line').innerHTML = s.active !== mySeat ? `${L('Хід', 'Turn')}: ${name}`
        : !s.turnOpened && s.open.length < s.tiles ? L('<b>Твій хід!</b> Відкрий один квадратик.', '<b>Your turn!</b> Open one tile.')
          : L('<b>Твій хід!</b> Назви гравця — або пас.', '<b>Your turn!</b> Name a player — or pass.');
      $('#free-left').textContent = '';
      $('#answer-hint').textContent = '';
    } else {
      fin.disabled = !!s.mine?.done;
      fin.textContent = s.mine?.done ? L('Чекаємо інших…', 'Waiting for others…') : L('Здаюсь', 'Give up');
      $('#turn-line').innerHTML = '';
      $('#free-left').innerHTML = `${L('Без штрафу', 'Free')}: <b>${s.mine?.freeLeft ?? s.freeNeutral}</b> / ${s.freeNeutral}`;
      $('#free-left').title = L('Скільки ще разів можна назвати того, хто міг бути на кадрі, без штрафу', 'How many more times you can name someone who may be in the shot without a penalty');
      $('#answer-hint').textContent = s.mine?.done ? L('Твоє фото закрито. Чекаємо інших…', 'Your photo is done. Waiting for others…')
        : L('Натискай квадратики, щоб відкрити фото. Хибне ім’я відкриває ще один.', 'Tap tiles to reveal the photo. A wrong name opens one more.');
    }
  }

  function renderMisses() {
    const s = state;
    const list = turns()
      ? s.named.map((n) => ({ ...n }))
      : [...(s.mine?.neutral || []).map((p) => ({ kind: 'neutral', player: p })), ...(s.mine?.wrong || []).map((p) => ({ kind: 'wrong', player: p }))];
    $('#misses').innerHTML = list.length && s.phase === 'guess'
      ? `<span class="field-label">${L('Названі', 'Named')}</span>${list.map((n) => `<span class="miss ${n.kind}" style="${turns() ? seatStyle(n.seat) : ''}" title="${n.kind === 'neutral' ? L('міг бути на кадрі — не загаданий', 'may be in the shot — not asked for') : ''}">${turns() ? '<i class="dot-p"></i>' : ''}${n.kind === 'neutral' ? '⚪ ' : n.kind === 'wrong' ? '✕ ' : ''}${n.player ? escapeHtml(pname(n.player)) : L('пас', 'pass')}</span>`).join('')}`
      : '';
  }

  function renderRevealBar() {
    const s = state;
    const bar = $('#reveal-bar');
    bar.classList.toggle('hidden', s.phase !== 'reveal');
    if (s.phase !== 'reveal') return;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => (s.roundPoints[b] || 0) - (s.roundPoints[a] || 0));
    const iVoted = s.nextVotes.includes(mySeat);
    bar.innerHTML = `${s.solo ? `<p class="verdict">${L('За кадр', 'This shot')}: <b>+${s.roundPoints[mySeat] || 0}</b></p>`
      : `<ul class="round-results">${seats.map((i) => `<li style="${seatStyle(i)}"><span class="dot-p"></span>${escapeHtml(seatName(i))}<b>+${s.roundPoints[i] || 0}</b></li>`).join('')}</ul>`}
      <div class="reveal-actions"><button id="next-btn" class="btn btn-primary btn-lg" ${iVoted ? 'disabled' : ''}>${s.round >= s.rounds ? L('Підсумки', 'Results') : L('Наступне фото →', 'Next photo →')}</button></div>`;
    $('#next-btn').addEventListener('click', () => emit('next'));
  }

  // ── звіти після кадру (бета): 🚩 погане фото з причиною, ➕ хто ще є на фото. Перемальовуємо лише для нового фото — щоб не збити введення.
  let reportKey = null;
  let extra = [];
  function renderReport() {
    const s = state;
    const box = $('#report');
    box.classList.toggle('hidden', s.phase !== 'reveal');
    if (s.phase !== 'reveal') { reportKey = null; return; }
    if (reportKey === s.shot.id) return;
    reportKey = s.shot.id;
    extra = [];
    const done = JSON.parse(store.get('archive:reported') || '{}')[s.shot.id] || {};
    box.innerHTML = `<p class="rp-title">β ${L('Допоможи перевірити фото', 'Help us check the photos')}</p>
      <div class="rp-row">
        <button type="button" class="btn btn-secondary btn-sm" id="rp-bad" ${done.bad ? 'disabled' : ''}>${done.bad ? L('🚩 Дякуємо!', '🚩 Thanks!') : L('🚩 Погане фото', '🚩 Bad photo')}</button>
        <button type="button" class="btn btn-secondary btn-sm" id="rp-missing">${L('➕ Тут є ще гравець', '➕ Someone else is here')}</button>
      </div>
      <div class="rp-panel hidden" id="rp-bad-panel">${Object.entries(REASONS).map(([k, t]) => `<button type="button" class="chip" data-reason="${k}">${escapeHtml(t)}</button>`).join('')}</div>
      <div class="rp-panel hidden" id="rp-missing-panel">
        <p class="hint">${L('Кого з наших гравців видно на фото, але його не підписано? Перевіримо й додамо.', 'Which player can you see in the photo who isn’t tagged? We’ll check and add him.')}</p>
        <div class="search"><input id="rp-input" placeholder="${L('Ім’я гравця…', 'Player name…')}" autocomplete="off" /><ul class="suggestions" id="rp-suggestions"></ul></div>
        <div class="rp-picked" id="rp-picked"></div>
        <button type="button" class="btn btn-primary btn-sm" id="rp-send" disabled>${L('Надіслати', 'Send')}</button>
      </div>`;
    $('#rp-bad').addEventListener('click', () => { $('#rp-bad-panel').classList.toggle('hidden'); $('#rp-missing-panel').classList.add('hidden'); });
    $('#rp-missing').addEventListener('click', () => { $('#rp-missing-panel').classList.toggle('hidden'); $('#rp-bad-panel').classList.add('hidden'); $('#rp-input').focus(); });
    $('#rp-bad-panel').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-reason]');
      if (!b) return;
      if (await send({ kind: 'bad', reason: b.dataset.reason })) {
        $('#rp-bad-panel').classList.add('hidden');
        $('#rp-bad').disabled = true;
        $('#rp-bad').textContent = L('🚩 Дякуємо!', '🚩 Thanks!');
      }
    });
    const input = $('#rp-input');
    const tagged = new Set([...s.shot.targets, ...s.shot.others].map((p) => p.id));
    let list = [];
    const draw = () => {
      const q = input.value.trim();
      list = q ? window.Players.search(q).filter((p) => !tagged.has(p.id) && !extra.some((x) => x.id === p.id)).slice(0, 6) : [];
      $('#rp-suggestions').innerHTML = list.map((p, i) => `<li data-i="${i}"><span class="s-avatar">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy" />` : escapeHtml(initials(p.name))}</span>
        <span class="s-text"><span class="s-main">${escapeHtml(pname(p))}</span><span class="s-sub">${p.born || ''}</span></span></li>`).join('');
      $('#rp-picked').innerHTML = extra.map((p) => `<span class="miss">${escapeHtml(pname(p))}</span>`).join('');
      $('#rp-send').disabled = !extra.length;
    };
    const add = (p) => { if (p && extra.length < 5) extra.push(p); input.value = ''; draw(); input.focus(); };
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && list[0]) { add(list[0]); e.preventDefault(); } });
    $('#rp-suggestions').addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) add(list[Number(li.dataset.i)]); });
    $('#rp-send').addEventListener('click', async () => {
      if (await send({ kind: 'missing', players: extra.map((p) => p.id) })) {
        extra = [];
        draw();
        $('#rp-missing-panel').classList.add('hidden');
      }
    });
  }

  async function send(body) {
    const shot = state.shot.id;
    let vid = '';
    try { vid = localStorage.getItem('vid') || ''; } catch { /* без мітки */ }
    try {
      const r = await fetch(`/api/archive/report?lang=${window.I18n.lang}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shot, vid, ...body }) });
      const res = await r.json();
      if (res.error) { toast(res.error, 'bad'); return false; }
    } catch {
      toast(L('Не вдалося надіслати — спробуй ще раз', 'Couldn’t send — try again'), 'bad');
      return false;
    }
    const all = JSON.parse(store.get('archive:reported') || '{}');
    all[shot] = { ...all[shot], [body.kind]: true };
    store.set('archive:reported', JSON.stringify(all));
    toast(L('Дякуємо! Перевіримо й виправимо 🙌', 'Thanks! We’ll check and fix it 🙌'), 'good');
    return true;
  }

  let shownScores = {};
  function renderScoreboard() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a] || a - b);
    const top = s.scores[seats[0]];
    const leaders = seats.filter((i) => s.scores[i] === top);
    $('#table-title').textContent = s.solo ? L('Твій рахунок', 'Your score') : L('Таблиця', 'Standings');
    $('#scoreboard').innerHTML = seats.map((i) => {
      const place = seats.findIndex((j) => s.scores[j] === s.scores[i]) + 1;
      let status = '';
      if (s.phase === 'guess' && !s.solo) {
        if (turns()) status = s.order.includes(i) ? `<span class="st ${s.active === i ? 'thinking' : ''}">${s.active === i ? '✍️' : ''}${s.finishVotes.includes(i) ? ' 🏁' : ''}</span>` : '';
        else {
          const pr = s.progress[i];
          status = pr ? `<span class="st" title="${L('відгадано · відкрито квадратиків', 'guessed · tiles open')}">${pr.found}/${s.shot.count} · ▦${pr.open}${pr.done ? ' ✓' : ''}</span>` : '';
        }
      }
      const crown = top > 0 && leaders.length === 1 && leaders[0] === i ? ' 👑' : '';
      const bump = shownScores[i] != null && s.scores[i] > shownScores[i] ? 'bump' : '';
      return `<li style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'}">
        <span class="place">${place}</span><span class="dot-p"></span><span class="nm">${escapeHtml(seatName(i))}${crown}</span>${status}<b class="${bump}">${s.scores[i]}</b></li>`;
    }).join('');
    shownScores = Object.fromEntries(seats.map((i) => [i, s.scores[i]]));
  }

  function tick() {
    const el = $('#timer');
    if (!state || state.status !== 'playing' || !state.deadline || state.phase !== 'guess') { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((state.deadline - g.serverNow()) / 1000));
    el.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    el.classList.toggle('low', left <= 10);
  }
  setInterval(tick, 250);

  // ── пошук гравця
  const input = $('#guess-input');
  let suggestions = [];
  let active = 0;

  function renderSuggestions() {
    const list = $('#suggestions');
    const q = input.value.trim();
    if (!q || input.disabled) { list.innerHTML = ''; suggestions = []; return; }
    suggestions = window.Players.search(q).slice(0, 8);
    list.innerHTML = suggestions.length
      ? suggestions.map((p, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''}">
          <span class="s-avatar">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy" />` : escapeHtml(initials(p.name))}</span>
          <span class="s-text"><span class="s-main">${escapeHtml(pname(p))}</span><span class="s-sub">${window.I18n.lang === 'en' ? (p.born || '') : `${escapeHtml(p.name)}${p.born ? ` · ${p.born}` : ''}`}</span></span></li>`).join('')
      : `<li class="empty">${L('Нікого не знайдено', 'No one found')}</li>`;
  }

  input.addEventListener('input', () => { active = 0; renderSuggestions(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, suggestions.length - 1); renderSuggestions(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); renderSuggestions(); e.preventDefault(); }
    if (e.key === 'Enter' && suggestions[active]) { choose(suggestions[active]); e.preventDefault(); }
    if (e.key === 'Escape') { input.value = ''; renderSuggestions(); }
  });
  $('#suggestions').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) choose(suggestions[Number(li.dataset.i)]);
  });

  async function choose(p) {
    if (!p) return;
    input.value = '';
    renderSuggestions();
    const res = await emit('guess', { playerId: p.id });
    if (res.error) return toast(res.error, 'bad');
    const nm = pname(p);
    if (res.result === 'hit') {
      window.Sound.play('hit');
      toast(L(`${nm} — так! +${res.points}`, `${nm} — yes! +${res.points}`), 'good');
    } else if (res.result === 'neutral') {
      window.Sound.play('pop');
      toast(res.free
        ? L(`${nm} — можливо, він і є на кадрі, але його не загадано. Без штрафу (лишилось ${res.left}).`, `${nm} — he may be in the shot, but he isn’t one we ask for. No penalty (${res.left} left).`)
        : L(`${nm} не загаданий, а безкоштовні відповіді скінчились — відкрито ще квадратик`, `${nm} isn’t asked for, and free answers are used up — one more tile opened`));
    } else {
      window.Sound.play('miss');
      toast(turns() ? L(`${nm} — мимо`, `${nm} — miss`) : L(`${nm} — його тут бути не могло. Відкрито ще квадратик`, `${nm} — he can’t be in this shot. One more tile opened`), 'bad');
    }
    if (!input.disabled) input.focus();
  }

  $('#skip-btn').addEventListener('click', () => g.act('skipShot'));
  $('#pass-btn').addEventListener('click', () => g.act('pass'));
  $('#finish-btn').addEventListener('click', async () => {
    const s = state;
    if (turns()) {
      if (await ask(L('Більше нікого не впізнаєте?', 'Can’t recognise anyone else?'), { note: L('Коли «Досить» натиснуть усі, фото відкриється.', 'When everyone presses “That’s it”, the photo is revealed.'), ok: L('🏁 Досить', '🏁 That’s it') })) g.act('finishRound');
      return;
    }
    const found = s.mine?.found.length || 0;
    if (await ask(L('Здаєшся?', 'Give up?'), { note: L(`Фото відкриється. Відгадано ${found} з ${s.shot.count} — ці очки лишаться.`, `The photo will be revealed. You got ${found} of ${s.shot.count} — you keep those points.`), ok: L('Здаюсь', 'Give up') })) g.act('finishRound');
  });

  // ── підсумок
  function renderFinal() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    if (s.solo) {
      $('#final-title').textContent = `${s.scores[mySeat]} ${pl(s.scores[mySeat], ['очко', 'очки', 'очок'], ['point', 'points'])}`;
      const key = `archive:best:${s.options.category}:${s.options.level}:${s.rounds}`;
      const best = Number(store.get(key)) || 0;
      if (s.scores[mySeat] > best) store.set(key, s.scores[mySeat]);
      $('#final-standings').innerHTML = `<li><span class="nm">${L(`Рекорд (${s.rounds} фото)`, `Best (${s.rounds} photos)`)}</span><span class="val">${Math.max(best, s.scores[mySeat])}${s.scores[mySeat] > best && best ? L(' — новий!', ' — new!') : ''}</span></li>`;
    } else {
      const top = s.scores[seats[0]];
      const winners = seats.filter((i) => s.scores[i] === top);
      $('#final-title').textContent = winners.length > 1 ? L('Нічия!', 'It’s a draw!') : winners[0] === mySeat ? L('Ти переміг! 🏆', 'You win! 🏆') : L(`Переміг ${seatName(winners[0])} 🏆`, `${seatName(winners[0])} wins 🏆`);
      $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${s.scores[i] === top ? 'win' : ''}">
        <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))}</span><span class="val">${s.scores[i]} ${pl(s.scores[i], ['очко', 'очки', 'очок'], ['point', 'points'])}</span></li>`).join('');
    }
    $('#final-history').innerHTML = s.history.map((h) => `<li><span class="nm">${escapeHtml(h.title)}</span><span class="val">+${h.results[mySeat] || 0}</span></li>`).join('');
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost);
    const host = s.seats[s.host]?.name || L('Господар', 'The host');
    $('#again-wait').textContent = isHost || s.solo ? '' : L(`${host} може почати ще одну гру.`, `${host} can start another game.`);
  }

  // ── вікно «бета» при першому вході: гра нова, фото ще перевіряються — просимо спільноту допомогти звітами 🚩 / ➕.
  // Показуємо один раз (localStorage); на головному екрані лишається коротка .beta-note.
  function betaIntro() {
    if (store.get('archive:betaIntro')) return;
    const box = document.createElement('div');
    box.className = 'overlay beta-overlay';
    box.innerHTML = `<div class="overlay-backdrop"></div>
      <div class="sheet ask-sheet beta-sheet" role="dialog" aria-modal="true" aria-labelledby="beta-title">
        <p class="beta-kicker"><span class="beta-tag">β</span> ${L('Бета-версія', 'Beta version')}</p>
        <h3 id="beta-title">${L('«Фотоархів» ще проявляється', 'The Photo Archive is still developing')}</h3>
        <p>${L('Гра зовсім нова, і не кожен кадр у ній поки ідеальний: десь загаданих ледве видно, а десь ми когось не підписали.',
          'The game is brand new and not every shot is perfect yet: sometimes the players are barely visible, sometimes we’ve missed someone.')}</p>
        <p>${L('Разом зробимо архів кращим! Після кожного фото:', 'Let’s make the archive better together! After each photo:')}</p>
        <ul class="beta-list">
          <li><b>🚩</b><span>${L('позначайте неякісні кадри й ті, на яких неможливо вгадати;', 'flag poor-quality shots and ones that are impossible to guess;')}</span></li>
          <li><b>➕</b><span>${L('додавайте футболістів, яких видно на фото, але не підписано.', 'add footballers who are in the photo but not tagged.')}</span></li>
        </ul>
        <p class="beta-foot">${L('Кожен звіт ми переглядаємо й оновлюємо архів. А ідеї та враження від гри — кнопка 💬 угорі.',
          'We review every report and update the archive. Ideas and thoughts about the game — the 💬 button at the top.')}</p>
        <div class="confirm-actions"><button type="button" class="btn btn-primary" data-beta-ok>${L('Зрозуміло, до гри!', 'Got it — let’s play!')}</button></div>
      </div>`;
    const close = () => {
      store.set('archive:betaIntro', '1');
      document.removeEventListener('keydown', onKey);
      box.remove();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    box.addEventListener('click', (e) => { if (e.target.classList.contains('overlay-backdrop') || e.target.closest('[data-beta-ok]')) close(); });
    document.body.append(box);
    box.querySelector('[data-beta-ok]').focus();
  }
  betaIntro();
})();
