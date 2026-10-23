(() => {
  const $ = (sel) => document.querySelector(sel);
  const { L } = window.I18n; // мова — /shared/i18n.js; сервер отримує її через auth.lang
  const pname = (p) => window.I18n.name(p);
  const pl = (n, uk, en) => window.I18n.plural(n, uk, en);
  const TITLE = L('Футбольне перехрестя', 'Football Crossroads');
  const socket = io('/crossroads', { auth: { lang: window.I18n.lang, vid: window.Presence?.vid } });
  const { SYMBOLS, BOARDS, MODES } = window.Rules;

  // ── локальне сховище (може бути недоступне в приватному режимі)
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  const session = { code: null, token: null };
  let state = null;
  let mySeat = null; // приходить від сервера з кожним станом (поле you)
  let clockOffset = 0; // serverNow - Date.now()
  let usedIds = new Set();
  let lastEventKey = null;
  let resultDismissed = false;

  // налаштування нової гри
  const setup = {
    board: BOARDS[store.get('g9:board')] ? store.get('g9:board') : 'classic',
    players: Number(store.get('g9:players')) || 2,
    mode: MODES[store.get('g9:mode')] ? store.get('g9:mode') : 'normal',
    timer: Number(store.get('g9:timer') ?? 20),
  };

  // ── пошук гравців — спільний для всіх ігор (public/shared/players.js)
  const search = (query) => window.Players.search(query);

  // ── дрібниці
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => {
    const parts = name.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase();
  };
  const roomLink = (code) => `${location.origin}${location.pathname}?room=${code}`;
  const seatName = (i) => (i === mySeat ? L('Ти', 'You') : state?.seats[i]?.name || L('Гравець', 'Player'));
  const YOU_MARK = L(' (ти)', ' (you)');
  const symHtml = (i) => `<span class="sym seat-${i}">${SYMBOLS[i]}</span>`;
  // Позначка гравця крейдою на зайнятій клітинці (✕ ◯ △ □); у щойно зайнятої — «дописується» (клас draw).
  const CHALK = [
    '<path pathLength="100" d="M8 8 L32 32"/><path pathLength="100" d="M32 8 L8 32"/>',
    '<circle pathLength="100" cx="20" cy="20" r="13"/>',
    '<path pathLength="100" d="M20 6 L34 32 L6 32 Z"/>',
    '<path pathLength="100" d="M8 8 H32 V32 H8 Z"/>',
  ];
  const chalkMark = (seat, draw) =>
    `<svg class="chalk-mark ${draw ? 'draw' : ''}" viewBox="0 0 40 40" aria-label="${SYMBOLS[seat]}">${CHALK[seat]}</svg>`;

  function showScreen(name) {
    for (const id of ['home', 'invite', 'lobby', 'game']) $(`#screen-${id}`).classList.toggle('hidden', id !== name);
    $('#chat-btn').classList.toggle('hidden', name === 'home' || name === 'invite');
    if (name === 'home' || name === 'invite') $('#chat-panel').classList.add('hidden');
  }

  function toast(text, kind = '', ms = 2600) {
    const el = $('#toast');
    el.textContent = text;
    el.className = `toast show ${kind}`;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.className = 'toast'), ms);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast(L('Посилання скопійовано ✓', 'Link copied ✓'), 'good');
    } catch {
      window.prompt(L('Скопіюй посилання:', 'Copy the link:'), text);
    }
  }

  // Своє вікно підтвердження (замість браузерного confirm)
  let confirmResolve = null;
  function askConfirm(text, yes = L('Так', 'Yes')) {
    $('#confirm-text').textContent = text;
    $('#confirm-yes').textContent = yes;
    $('#confirm').classList.remove('hidden');
    return new Promise((resolve) => (confirmResolve = resolve));
  }
  function closeConfirm(answer) {
    $('#confirm').classList.add('hidden');
    confirmResolve?.(answer);
    confirmResolve = null;
  }

  function configChips(cfg) {
    const b = BOARDS[cfg.board];
    const m = MODES[cfg.mode];
    return [
      `<span>▦ ${b.title} · ${b.sub}</span>`,
      `<span>👥 ${cfg.capacity} ${pl(cfg.capacity, ['гравець', 'гравці', 'гравців'], ['player', 'players'])}</span>`,
      `<span><i class="dot ${m.dot}"></i>${m.label}</span>`,
      `<span>⏱ ${cfg.turnSeconds ? `${cfg.turnSeconds} ${L('с', 's')}` : L('без ліміту', 'no limit')}</span>`,
    ].join('');
  }
  const roomCfg = () => ({ board: state.board.key, mode: state.mode, capacity: state.capacity, turnSeconds: state.turnSeconds });

  function openRules(cfg) {
    $('#rules-modal-body').innerHTML = window.Rules.forRoom(cfg);
    $('#rules-modal').classList.remove('hidden');
  }

  // ── головний екран: налаштування гри
  const nameInput = $('#name-input');
  nameInput.value = store.get('g9:name') || '';
  $('#rules-home').innerHTML = window.Rules.overview();

  function miniBoard(b) {
    const cells = Array.from({ length: b.size * b.size }, (_, i) => `<i class="${b.sample.includes(i) ? 'on' : ''}"></i>`).join('');
    return `<span class="mini" style="grid-template-columns:repeat(${b.size},1fr)">${cells}</span>`;
  }

  function renderSetup() {
    $('#board-cards').innerHTML = Object.entries(BOARDS)
      .map(([key, b]) => `<button type="button" class="board-opt ${key === setup.board ? 'active' : ''}" data-board="${key}" role="radio" aria-checked="${key === setup.board}">
          ${miniBoard(b)}<b>${b.title}</b><span class="sub">${b.sub}</span><small>${b.short}</small>
        </button>`)
      .join('');
    const max = BOARDS[setup.board].maxPlayers;
    if (setup.players > max) setup.players = max;
    document.querySelectorAll('#players-chips button').forEach((btn) => {
      const n = Number(btn.dataset.players);
      btn.disabled = n > max;
      btn.classList.toggle('active', n === setup.players);
      btn.setAttribute('aria-checked', n === setup.players);
    });
    $('#players-hint').textContent = max === 2
      ? L('Класика — лише вдвох. Утрьох і вчотирьох — на великих полях.', 'Classic is for two only. Three or four players — on the bigger boards.')
      : L(`Можна грати вдвох, утрьох або вчотирьох. ${SYMBOLS.join(' ')} — у кожного свій колір.`, `Play with two, three or four. ${SYMBOLS.join(' ')} — everyone has their own colour.`);
    // порядок: від легкого до складного, «Мікс» — окремим рядком унизу
    $('#mode-chips').innerHTML = ['easy', 'normal', 'fan', 'hard', 'mix']
      .map((key) => [key, MODES[key]])
      .map(([key, m]) => `<button type="button" class="mode ${key === setup.mode ? 'active' : ''}" data-mode="${key}" role="radio" aria-checked="${key === setup.mode}">
          <b><i class="dot ${m.dot}"></i>${m.label}</b><small>${m.short}</small>
        </button>`)
      .join('');
    document.querySelectorAll('#timer-chips .chip').forEach((chip) => {
      const active = Number(chip.dataset.sec) === setup.timer;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-checked', active);
    });
  }
  renderSetup();

  $('#screen-home').addEventListener('click', (e) => {
    const board = e.target.closest('[data-board]')?.dataset.board;
    const pl = e.target.closest('[data-players]')?.dataset.players;
    const mode = e.target.closest('[data-mode]')?.dataset.mode;
    const sec = e.target.closest('[data-sec]')?.dataset.sec;
    if (board) { setup.board = board; store.set('g9:board', board); }
    if (pl) { setup.players = Number(pl); store.set('g9:players', pl); }
    if (mode) { setup.mode = mode; store.set('g9:mode', mode); }
    if (sec !== undefined) { setup.timer = Number(sec); store.set('g9:timer', sec); }
    if (board || pl || mode || sec !== undefined) renderSetup();
  });

  // «Продовжити гру» — якщо закрив вкладку посеред гри
  function renderResume() {
    const last = store.get('g9:last-room');
    const btn = $('#resume-btn');
    btn.classList.toggle('hidden', !last || !!session.code);
    if (last) btn.textContent = L(`↩ Повернутися до гри ${last}`, `↩ Back to game ${last}`);
  }
  renderResume();
  $('#resume-btn').addEventListener('click', () => joinRoom(store.get('g9:last-room')));

  function requireName() {
    const name = nameInput.value.trim();
    if (!name) {
      $('#home-error').textContent = L("Введи своє ім'я", 'Enter your name');
      nameInput.focus();
      return null;
    }
    store.set('g9:name', name);
    return name;
  }

  $('#create-btn').addEventListener('click', () => {
    const name = requireName();
    if (!name) return;
    socket.emit('create', { name, turnSeconds: setup.timer, mode: setup.mode, board: setup.board, players: setup.players }, onEntered);
  });

  function joinRoom(code) {
    const name = requireName();
    if (!name) return;
    code = (code || '').toUpperCase().trim();
    if (!code) {
      $('#home-error').textContent = L('Введи код кімнати', 'Enter the room code');
      return;
    }
    socket.emit('join', { code, name, token: store.get(`g9:token:${code}`) }, onEntered);
  }

  $('#join-btn').addEventListener('click', () => joinRoom($('#code-input').value));
  $('#code-input').addEventListener('keydown', (e) => e.key === 'Enter' && joinRoom(e.target.value));
  nameInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const code = $('#code-input').value.trim();
    code ? joinRoom(code) : $('#create-btn').click();
  });

  function onEntered(res) {
    if (!res || res.error) {
      // кімнати вже нема (сервер перезапускався / всі вийшли) — забуваємо її
      if (session.code && store.get('g9:last-room') === session.code) store.del('g9:last-room');
      $('#home-error').textContent = res?.error || L('Помилка з’єднання', 'Connection error');
      goHome();
      return;
    }
    $('#home-error').textContent = '';
    $('#invite-note').classList.add('hidden');
    Object.assign(session, { code: res.code, token: res.token });
    store.set(`g9:token:${res.code}`, res.token);
    store.set('g9:last-room', res.code);
    history.replaceState(null, '', `?room=${res.code}`);
  }

  function goHome() {
    chatMessages = [];
    setUnread(0);
    session.code = null;
    session.token = null;
    state = null;
    mySeat = null;
    resultDismissed = false;
    closePicker();
    $('#result').classList.add('hidden');
    document.title = TITLE;
    history.replaceState(null, '', location.pathname);
    showScreen('home');
    renderResume();
  }

  function leaveRoom() {
    const code = session.code;
    socket.emit('leave', null, () => {});
    if (code) {
      store.del(`g9:token:${code}`);
      if (store.get('g9:last-room') === code) store.del('g9:last-room');
    }
    goHome();
  }

  // Перепідключення: сервер пам'ятає нас за токеном.
  socket.on('connect', () => {
    if (session.code) {
      socket.emit('join', { code: session.code, name: store.get('g9:name'), token: session.token }, onEntered);
    }
  });

  // ── стан гри
  socket.on('state', (s) => {
    if (!session.code || s.code !== session.code) return; // запізнілий стан кімнати, з якої вже вийшли
    const prev = state;
    state = s;
    mySeat = s.you;
    clockOffset = s.serverNow - Date.now();
    usedIds = new Set(s.usedIds);
    playStateSounds(prev, s);
    render();
  });

  const activeSeats = () => state.seats.map((x, i) => (x && !state.out.includes(i) ? i : -1)).filter((i) => i >= 0);
  const amActive = () => activeSeats().includes(mySeat);
  const isMyTurn = () => state.status === 'playing' && state.turn === mySeat;

  // ── звуки на зміни стану
  function playStateSounds(prev, s) {
    const wasPlaying = prev?.status === 'playing';
    if (s.status === 'playing' && !wasPlaying) {
      Sound.play('whistle'); // початок гри / реванш
      return;
    }
    if (s.status === 'finished' && prev?.status !== 'finished') {
      Sound.play(!s.winners.length ? 'draw' : s.winners.includes(s.you) ? 'win' : 'lose');
      return;
    }
    if (s.status === 'playing' && s.turn === s.you && prev?.turn !== s.you) {
      // невелика пауза, щоб «дзинь» не накладався на звук ходу попереднього гравця
      setTimeout(() => Sound.play('myTurn'), 450);
      try { navigator.vibrate?.(60); } catch { /* ignore */ }
    }
    const offered = (st) => st?.drawVotes?.some((v) => v !== st.you);
    if (s.status === 'playing' && offered(s) && !offered(prev)) Sound.play('pop');
    const othersVoted = (st) => st?.rematchVotes?.some((v) => v !== st.you);
    if (s.status === 'finished' && othersVoted(s) && !othersVoted(prev)) Sound.play('pop');
  }

  function render() {
    if (!state) return;
    if (state.status === 'waiting') {
      renderLobby();
      return;
    }
    showScreen('game');
    $('#screen-game').classList.toggle('wide', state.board.size > 3);
    $('#game-code').textContent = state.code;
    $('#game-config').innerHTML = configChips(roomCfg());
    renderTurn();
    renderPlayers();
    renderBoard();
    renderActions();
    renderEvent();
    renderLastMove();
    renderBanner();
    renderResult();
    tick();
  }

  // «Останній хід»: хто, куди (рядок × стовпець), кого поставив і чи вийшло — тримається до наступного ходу
  function renderLastMove() {
    const el = $('#last-move');
    const ev = state.lastEvent;
    const n = state.grid.size;
    if (!ev || !['hit', 'miss', 'timeout', 'skip'].includes(ev.type)) {
      el.classList.add('hidden');
      return;
    }
    const who = `<span class="lm-sym seat-${ev.seat}">${SYMBOLS[ev.seat]}</span> <b>${escapeHtml(seatName(ev.seat))}</b>`;
    const where = Number.isInteger(ev.cell)
      ? `<span class="lm-where">${escapeHtml(state.grid.rows[Math.floor(ev.cell / n)].label)} × ${escapeHtml(state.grid.cols[ev.cell % n].label)}</span>`
      : '';
    let what = '';
    const pts = (k) => `${k} ${pl(k, ['очко', 'очки', 'очок'], ['point', 'points'])}`;
    if (ev.type === 'hit') what = `${L('поставив', 'played')} <b>${escapeHtml(pname(ev.player))}</b>${ev.gained ? ` · +${pts(ev.gained)}` : ''}`;
    if (ev.type === 'miss') {
      what = `<b>${escapeHtml(pname(ev.player))}</b> — <span class="lm-bad">${L(`не «${ev.failed.map(escapeHtml).join('» і не «')}»`, `not “${ev.failed.map(escapeHtml).join('” and not “')}”`)}</span>`;
    }
    if (ev.type === 'timeout') what = `<span class="lm-bad">${L('не встиг — час вийшов', 'ran out of time')}</span>`;
    if (ev.type === 'skip') what = L('пропустив хід', 'skipped the turn');
    el.className = `last-move ${ev.type === 'hit' ? 'ok' : 'bad'}`;
    el.dataset.cell = Number.isInteger(ev.cell) ? ev.cell : '';
    el.innerHTML = `<span class="lm-label">${L('Останній хід', 'Last move')}</span><span class="lm-text">${who}: ${what}</span>${where}`;
  }

  function renderLobby() {
    closePicker();
    $('#result').classList.add('hidden');
    showScreen('lobby');
    document.title = `${L('Чекаємо гравців', 'Waiting for players')} · ${TITLE}`;
    $('#lobby-code').textContent = state.code;
    $('#share-link').value = roomLink(state.code);
    $('#lobby-config').innerHTML = configChips(roomCfg());
    const joined = state.seats.filter(Boolean).length;
    const need = state.capacity - joined;
    $('#lobby-slots').innerHTML = state.seats
      .map((s, i) => s
        ? `<li class="seat-${i}">${symHtml(i)}<span>${escapeHtml(s.name)}${i === mySeat ? YOU_MARK : ''}</span></li>`
        : `<li class="empty">${symHtml(i)}<span>${L('Чекаємо гравця…', 'Waiting for a player…')}</span></li>`)
      .join('');
    const wait = L(`Чекаємо ще ${need} ${pl(need, ['гравця', 'гравців', 'гравців'], [])} — гра почнеться автоматично.`,
      `Waiting for ${need} more ${need === 1 ? 'player' : 'players'} — the game starts automatically.`);
    if (state.notice?.type === 'left') {
      $('#lobby-title').textContent = L(`${state.notice.name || 'Гравець'} вийшов з гри`, `${state.notice.name || 'A player'} left the game`);
      $('#lobby-sub').textContent = L(`Кімната лишилась за вами. Надішли посилання іншому другу. ${wait}`, `The room is still yours. Send the link to another friend. ${wait}`);
    } else {
      $('#lobby-title').textContent = L('Кімната створена', 'Room created');
      $('#lobby-sub').textContent = L(`Надішли посилання друзям. ${wait}`, `Send the link to your friends. ${wait}`);
    }
  }

  // Плашка «чий хід» — головний акцент
  function renderTurn() {
    const stage = $('#turn-stage');
    const playing = state.status === 'playing';
    const t = state.turn;
    const color = playing ? `var(--p${t})` : 'var(--muted)';
    stage.style.setProperty('--tc', color);
    $('#board-wrap').style.setProperty('--tc', color);
    $('#board-wrap').classList.toggle('idle', !playing);
    stage.classList.toggle('mine', isMyTurn());
    stage.classList.toggle('over', !playing);
    $('#turn-symbol').textContent = playing ? SYMBOLS[t] : '🏁';
    if (!playing) {
      $('#turn-title').textContent = L('Гру завершено', 'Game over');
      $('#turn-sub').textContent = L('Реванш або нова гра — у вікні результату', 'Rematch or a new game — in the result window');
      document.title = TITLE;
      return;
    }
    if (isMyTurn()) {
      $('#turn-title').textContent = L('Твій хід!', 'Your turn!');
      $('#turn-sub').textContent = L('Обери клітинку й назви футболіста', 'Pick a cell and name a footballer');
      document.title = `🟢 ${L('Твій хід', 'Your turn')} · ${TITLE}`;
    } else {
      $('#turn-title').textContent = L(`Ходить ${state.seats[t]?.name || 'гравець'}`, `${state.seats[t]?.name || 'Player'}'s turn`);
      const active = activeSeats();
      let sub = amActive() ? L('Чекай свого ходу', 'Wait for your turn') : L('Ти вибув з цієї партії — можна спостерігати', 'You are out of this game — you can watch');
      if (amActive() && active.length > 2) {
        // скільки ходів до мене
        const order = state.order;
        const pos = order.indexOf(t);
        let k = 0;
        for (let step = 1; step <= order.length; step++) {
          const i = order[(pos + step) % order.length];
          if (!active.includes(i)) continue;
          k++;
          if (i === mySeat) break;
        }
        sub = k === 1 ? L('Ти ходиш наступним', 'You are next') : L(`Твій хід через ${k} ${pl(k, ['хід', 'ходи', 'ходів'], [])}`, `Your turn in ${k} moves`);
      }
      $('#turn-sub').textContent = sub;
      document.title = `${L('Хід', 'Turn')}: ${state.seats[t]?.name || ''} · ${TITLE}`;
    }
  }

  function renderPlayers() {
    const pointsMode = state.board.scoring === 'points';
    const order = state.order?.length ? state.order : state.seats.map((_, i) => i);
    const rest = state.seats.map((_, i) => i).filter((i) => !order.includes(i));
    $('#players').innerHTML = [...order, ...rest]
      .map((i) => {
        const s = state.seats[i];
        const turnNo = order.indexOf(i) + 1;
        const out = !s || state.out.includes(i);
        const active = state.status === 'playing' && state.turn === i;
        const status = !s ? L('вийшов', 'left') : state.out.includes(i) ? L('вибув', 'out') : s.connected ? L('онлайн', 'online') : L('офлайн', 'offline');
        const series = state.scores[i] ? ` · ${L('серія', 'series')} ${state.scores[i]}` : '';
        const score = pointsMode
          ? `<div class="pscore" title="${L('Очки в цій партії', 'Points this game')}">${state.points[i]}<small>${pl(state.points[i], ['очко', 'очки', 'очок'], ['point', 'points'])}</small></div>`
          : `<div class="pscore" title="${L('Перемоги в серії', 'Wins in the series')}">${state.scores[i]}<small>${pl(state.scores[i], ['перемога', 'перемоги', 'перемог'], ['win', 'wins'])}</small></div>`;
        return `<div class="pcard seat-${i} ${active ? 'active' : ''} ${out ? 'is-out' : ''}" id="pcard-${i}">
          <span class="sym">${SYMBOLS[i]}</span>
          <div class="pinfo"><div class="pname">${escapeHtml(s?.name || '—')}${i === mySeat ? YOU_MARK : ''}</div>
            <div class="pstatus ${s && !s.connected ? 'off' : ''}">${turnNo ? `${L('хід', 'turn')} ${turnNo} · ` : ''}${status}${pointsMode ? series : ''}</div></div>
          ${score}
        </div>`;
      })
      .join('');
  }

  function categoryHtml(cat) {
    const typeLabel = L(
      { club: 'клуб', nation: 'збірна', award: 'трофей', stat: 'рекорд', position: 'позиція', league: 'ліга', coach: 'тренер', academy: 'академія', partner: 'партнер' },
      { club: 'club', nation: 'national team', award: 'trophy', stat: 'record', position: 'position', league: 'league', coach: 'manager', academy: 'academy', partner: 'teammate' },
    )[cat.type];
    let crest;
    if (cat.img) {
      crest = `<div class="crest img ${cat.type}"><img src="${escapeHtml(cat.img)}" alt="" loading="lazy">${cat.type === 'academy' ? '<i class="crest-badge">🎓</i>' : ''}</div>`;
    } else {
      const [c1, c2] = cat.colors;
      const bg = cat.type === 'nation'
        ? `linear-gradient(180deg, ${c1} 0 50%, ${c2} 50% 100%)`
        : `linear-gradient(135deg, ${c1} 0 50%, ${c2} 50% 100%)`;
      crest = `<div class="crest ${cat.type}" style="background:${bg}">${cat.icon || ''}</div>`;
    }
    return `<div class="cat cat-${cat.type}" title="${escapeHtml(cat.label)}" data-label="${escapeHtml(cat.label)}">
      ${crest}
      <div class="cat-label">${escapeHtml(state.board.size > 3 && cat.short ? cat.short : cat.label)}</div>
      <div class="cat-type">${typeLabel}</div>
    </div>`;
  }

  function playerVisual(player) {
    const fallback = `<div class="avatar">${escapeHtml(initials(pname(player)))}</div>`;
    if (!player.photo) return fallback;
    return `${fallback}<img class="photo" src="${escapeHtml(player.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
  }

  function renderBoard() {
    const { grid, cells } = state;
    const n = grid.size;
    const myTurn = isMyTurn();
    const board = $('#board');
    board.style.setProperty('--n', n);
    board.style.setProperty('--cols', n + 1);
    board.classList.toggle('big', n > 3);
    board.classList.toggle('waiting', state.status === 'playing' && !myTurn);
    const scored = new Set(state.scoredLines.flatMap((l) => l.cells));
    const justCell = state.status === 'playing' && state.lastEvent?.type === 'hit' ? state.lastEvent.cell : -1;

    let html = `<div class="corner">${SYMBOLS.slice(0, state.capacity).join(' ')}</div>`;
    html += grid.cols.map(categoryHtml).join('');
    for (let r = 0; r < n; r++) {
      html += categoryHtml(grid.rows[r]);
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const b = cells[i];
        if (b) {
          const cls = [
            state.winLine?.includes(i) ? 'win' : '',
            scored.has(i) ? 'scored' : '',
            i === justCell ? 'just' : '',
          ].join(' ');
          const isNew = i === justCell ? `<span class="new-tag">${L('НОВЕ', 'NEW')}</span>` : '';
          html += `<div class="cell filled seat-${b.seat} ${cls}" data-cell="${i}" title="${escapeHtml(pname(b.player))}">
            ${playerVisual(b.player)}
            <div class="seat-badge">${chalkMark(b.seat, i === justCell)}</div>${isNew}
            <div class="pname-tag">${escapeHtml(pname(b.player))}</div>
          </div>`;
        } else {
          // скільки гравців ще доступно для цієї клітинки (зменшується, коли підходящого поставили деінде)
          // велике число — відомі гравці, мале — усі, кого зарахує гра
          const cnt = grid.answerCounts[i];
          const fam = grid.famousCounts?.[i] ?? cnt;
          const count = `<span class="count" title="${L(`Відомих гравців: ${fam}, усього правильних відповідей: ${cnt}`, `Well-known players: ${fam}, correct answers in total: ${cnt}`)}"><b>${fam}</b><span class="w"> ${pl(fam, ['відомий', 'відомі', 'відомих'], ['well-known', 'well-known'])}</span><span class="all"> / ${cnt}</span></span>`;
          html += `<button class="cell ${myTurn ? 'playable' : ''}" data-cell="${i}" ${myTurn ? '' : 'disabled'} aria-label="${L('Клітинка', 'Cell')} ${r + 1}×${c + 1}">
            <span class="plus">+</span>${count}
          </button>`;
        }
      }
    }
    board.innerHTML = html;
    fitLabels(board);
  }

  // Назва категорії має вміститися в заголовок (на телефоні й великих полях він крихітний):
  // зменшуємо шрифт, поки текст не перестане обрізатися, але не дрібніше 6,5 px. Повна назва — ще й по тапу.
  function fitLabels(root) {
    for (const label of root.querySelectorAll('.cat-label')) {
      const cat = label.closest('.cat');
      label.style.fontSize = '';
      if (!label.offsetParent) continue; // підпис схований (герби на великих полях)
      let size = parseFloat(getComputedStyle(label).fontSize);
      const overflows = () => label.scrollHeight > label.clientHeight + 1 || cat.scrollHeight > cat.clientHeight + 1;
      while (overflows() && size > 6.5) {
        size -= 0.5;
        label.style.fontSize = `${size}px`;
      }
    }
  }
  let fitTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => fitLabels($('#board')), 150);
  });

  function renderActions() {
    const playing = state.status === 'playing';
    const active = amActive();
    document.querySelector('[data-action="skip"]').disabled = !isMyTurn();
    const surrender = $('#surrender-btn');
    surrender.disabled = !playing || !active;
    surrender.textContent = state.capacity > 2 ? L('🏳️ Вийти з партії', '🏳️ Leave the game') : L('🏳️ Здатися', '🏳️ Resign');
    const drawBtn = $('#draw-btn');
    const iOffered = state.drawVotes.includes(mySeat);
    drawBtn.disabled = !playing || !active || iOffered;
    const pointsMode = state.board.scoring === 'points';
    drawBtn.textContent = iOffered
      ? (pointsMode ? L('Чекаємо згоди…', 'Waiting for agreement…') : L('Нічию запропоновано…', 'Draw offered…'))
      : (pointsMode ? L('Завершити гру', 'End game') : L('Запропонувати нічию', 'Offer a draw'));
    $('#reactions').classList.toggle('hidden', state.seats.filter(Boolean).length < 2);
    if (!isMyTurn()) closePicker();
  }

  // Банер над полем: нічия, хтось зник, гра завершена.
  function renderBanner() {
    const el = $('#banner');
    let html = '';
    const playing = state.status === 'playing';
    const voters = state.drawVotes;
    const totalActive = activeSeats().length;
    const absent = activeSeats().filter((i) => i !== mySeat && !state.seats[i].connected);
    if (playing && voters.length && amActive()) {
      const names = voters.map((i) => escapeHtml(seatName(i))).join(', ');
      const progress = totalActive > 2 ? ` (${voters.length}/${totalActive})` : '';
      const what = state.board.scoring === 'points' ? L('завершити гру й порахувати очки', 'to end the game and count the points') : L('нічию', 'a draw');
      html = voters.includes(mySeat)
        ? `<span>🤝 ${L(`Ти запропонував ${what} — чекаємо інших`, `You offered ${what} — waiting for the others`)}${progress}</span>`
        : `<span>🤝 <b>${names}</b> ${voters.length > 1 ? L('пропонують', 'offer') : L('пропонує', 'offers')} ${what}${progress}</span>
           <span class="banner-actions">
             <button class="btn btn-primary" data-action="draw">${L('Прийняти', 'Accept')}</button>
             <button class="btn btn-secondary" data-action="decline-draw">${L('Відхилити', 'Decline')}</button>
           </span>`;
    } else if (playing && absent.length && amActive()) {
      // виключити можна лише того, хто офлайн ≥ 2 хв і заважає грі: зараз його хід або пропустив кілька ходів поспіль
      const now = Date.now() + clockOffset;
      const waitLeft = (i) => state.claimWinAfterMs - (now - (state.seats[i].offlineSince || now));
      const blocking = (i) => state.turn === i || state.missed[i] >= state.missedToKick;
      const kickable = absent.filter((i) => waitLeft(i) <= 0 && blocking(i));
      const names = absent.map((i) => `<b>${escapeHtml(state.seats[i].name)}</b>`).join(', ');
      const verb = absent.length > 1 ? L('втратили', 'lost') : L('втратив', 'lost');
      if (kickable.length) {
        const label = totalActive - kickable.length <= 1 ? L('Забрати перемогу', 'Claim the win') : L('Виключити з партії', 'Remove from the game');
        html = `<span>📡 ${kickable.map((i) => `<b>${escapeHtml(state.seats[i].name)}</b>`).join(', ')} ${L('не повертається і заважає грі', (kickable.length > 1 ? 'are' : 'is') + ' not coming back and holding up the game')}</span>
           <span class="banner-actions"><button class="btn btn-primary" data-action="claim-win">${label}</button></span>`;
      } else if (absent.some(blocking)) {
        const sec = Math.max(1, Math.ceil(Math.min(...absent.filter(blocking).map(waitLeft)) / 1000));
        const t = sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec} ${L('с', 's')}`;
        html = `<span>📡 ${names} ${verb} ${L(`з'єднання. Чекаємо… ${t}`, `connection. Waiting… ${t}`)}</span>`;
      } else {
        html = `<span>📡 ${names} ${verb} ${L("з'єднання — граємо далі, чекаємо, поки повернеться", 'connection — playing on, waiting for them to return')}</span>`;
      }
    } else if (state.status === 'finished' && resultDismissed) {
      html = `<span>${L('Гру завершено', 'Game over')}</span>
        <span class="banner-actions"><button class="btn btn-primary" data-action="show-result">${L('Реванш / вихід', 'Rematch / leave')}</button></span>`;
    }
    el.innerHTML = html;
    el.classList.toggle('hidden', !html);
  }

  function renderEvent() {
    const ev = state.lastEvent;
    if (!ev) return;
    const key = `${state.code}:${ev.id}`;
    if (key === lastEventKey) return;
    lastEventKey = key;
    const mine = ev.seat === mySeat;
    const who = seatName(ev.seat);
    switch (ev.type) {
      case 'miss': {
        const why = ev.failed?.length
          ? L(` — не «${ev.failed.join('» і не «')}»`, ` — not “${ev.failed.join('” and not “')}”`)
          : L(' не підходить', " doesn't fit");
        toast(`✗ ${who}: ${pname(ev.player)}${why}`, 'bad', 8000);
        Sound.play('miss');
        document.querySelector(`[data-cell="${ev.cell}"]`)?.classList.add('flash-miss');
        break;
      }
      case 'start': {
        const names = ev.order.map((i) => `${SYMBOLS[i]} ${seatName(i)}`);
        const first = ev.order[0] === mySeat ? L('ти', 'you') : state.seats[ev.order[0]]?.name || L('гравець', 'player');
        toast(ev.order.length > 2 ? `🎲 ${L('Жереб', 'Draw')}: ${names.join(' → ')}` : L(`🎲 Жереб: першим ходить ${first}`, `🎲 Draw: ${first} ${ev.order[0] === mySeat ? 'go' : 'goes'} first`), 'good', 5000);
        break;
      }
      case 'timeout':
        toast(`⏱ ${who}: ${L('час вийшов — хід переходить', 'time is up — the turn passes')}`, 'bad');
        Sound.play('miss');
        break;
      case 'skip':
        toast(`${who}: ${L('пропуск ходу', 'turn skipped')}`);
        break;
      case 'hit':
        if (state.status !== 'playing') break;
        Sound.play('hit');
        if (ev.gained) toast(`🎯 ${who}: +${ev.gained} ${pl(ev.gained, ['очко', 'очки', 'очок'], ['point', 'points'])}!`, 'good');
        else if (!mine) toast(`✓ ${who}: ${pname(ev.player)}`, 'good');
        break;
      case 'drawDeclined':
        if (!mine) toast(L(`${who} відхилив пропозицію — граємо далі`, `${who} declined the offer — playing on`));
        break;
      case 'surrender':
        toast(`🏳 ${who} ${mine ? L('вибув з партії', 'are out of the game') : L('вибуває з партії', 'is out of the game')}`);
        break;
      case 'left':
        toast(L(`🚪 ${ev.name || 'Гравець'} вийшов з кімнати — граємо далі`, `🚪 ${ev.name || 'A player'} left the room — playing on`));
        break;
      case 'kicked':
        toast(`📡 ${ev.seats.map(seatName).join(', ')} — ${L('виключено з партії', 'removed from the game')}`);
        break;
    }
  }

  function renderResult() {
    const el = $('#result');
    if (state.status !== 'finished') {
      el.classList.add('hidden');
      resultDismissed = false;
      return;
    }
    const { winners } = state;
    const pointsMode = state.board.scoring === 'points';
    const iWon = winners.includes(mySeat);
    const draw = !winners.length;
    const names = winners.map((i) => state.seats[i]?.name || L('Гравець', 'Player')).join(L(' і ', ' and '));
    const reasons = {
      line: L(`${state.board.win} в ряд!`, `${state.board.win} in a row!`),
      surrender: iWon
        ? (state.capacity > 2 ? L('Інші гравці вибули.', 'The other players are out.') : L('Суперник здався.', 'Your opponent resigned.'))
        : state.out.includes(mySeat) ? L('Ти здався.', 'You resigned.') : L('Гравці вибули.', 'Players are out.'),
      abandoned: iWon
        ? (state.capacity > 2 ? L('Інші гравці вийшли або зникли.', 'The other players left or disappeared.') : L('Суперник вийшов або зник.', 'Your opponent left or disappeared.'))
        : L('Ти надовго зник — перемогу віддано іншим.', 'You were gone too long — the win went to the others.'),
      agreed: pointsMode ? L('Гру завершено за згодою — рахуємо очки.', 'Game ended by agreement — counting the points.') : L('Усі погодились на нічию.', 'Everyone agreed to a draw.'),
      full: pointsMode ? L('Поле заповнене — рахуємо очки.', 'The board is full — counting the points.') : L('Поле заповнене.', 'The board is full.'),
      stuck: pointsMode ? L('Більше нема кого ставити — рахуємо очки.', 'No more players fit — counting the points.') : L('Більше нема кого ставити у вільні клітинки.', 'No more players fit the free cells.'),
    };
    $('#result-emoji').textContent = draw ? '🤝' : iWon ? '🏆' : '😔';
    $('#result-title').textContent = draw ? L('Нічия', 'Draw') : iWon ? (winners.length > 1 ? L('Ділиш перемогу!', 'Shared win!') : L('Перемога!', 'Victory!')) : L(`Переміг ${names}`, `${names} won`);
    $('#result-sub').textContent = reasons[state.endReason] || '';

    // таблиця місць
    const seats = state.seats.map((s, i) => i).filter((i) => state.seats[i] || state.points[i] || winners.includes(i));
    seats.sort((a, b) =>
      (pointsMode ? state.points[b] - state.points[a] : 0) ||
      (winners.includes(b) - winners.includes(a)) ||
      (state.out.includes(a) - state.out.includes(b)) || a - b);
    $('#standings').innerHTML = seats
      .map((i, k) => {
        const val = pointsMode
          ? `${state.points[i]} ${pl(state.points[i], ['очко', 'очки', 'очок'], ['point', 'points'])} · ${L('серія', 'series')} ${state.scores[i]}`
          : `${L('серія', 'series')} ${state.scores[i]}`;
        return `<li class="seat-${i} ${winners.includes(i) ? 'win' : ''}">
          <span class="place">${k + 1}</span><span class="sym">${SYMBOLS[i]}</span>
          <span class="nm">${escapeHtml(state.seats[i]?.name || L('вийшов', 'left'))}${i === mySeat ? YOU_MARK : ''}</span>
          <span class="val">${val}</span></li>`;
      })
      .join('');

    const present = state.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    const full = present.length === state.capacity;
    const votes = state.rematchVotes;
    const voted = votes.includes(mySeat);
    const note = $('#result-rematch');
    const btn = $('#rematch-btn');
    if (!full) {
      note.textContent = L('Хтось вийшов з кімнати — для реваншу дочекайтесь нового гравця або почніть нову гру.', 'Someone left the room — wait for a new player for a rematch, or start a new game.');
      note.classList.remove('hidden');
      btn.disabled = true;
      btn.textContent = L('Реванш', 'Rematch');
    } else {
      const others = votes.filter((v) => v !== mySeat).map((v) => state.seats[v]?.name).filter(Boolean);
      note.classList.toggle('hidden', !votes.length);
      note.textContent = others.length
        ? `🔁 ${others.join(', ')} ${others.length > 1 ? L('хочуть реванш', 'want a rematch') : L('хоче реванш', 'wants a rematch')} (${votes.length}/${state.capacity})`
        : `${L('Чекаємо відповіді інших…', 'Waiting for the others…')} (${votes.length}/${state.capacity})`;
      btn.disabled = voted;
      btn.textContent = voted ? L('Чекаємо інших…', 'Waiting for the others…') : others.length ? L('Прийняти реванш', 'Accept rematch') : L('Реванш', 'Rematch');
    }
    el.classList.toggle('hidden', resultDismissed);
    closePicker();
  }

  // ── таймер: кільце навколо символу того, хто ходить
  const RING = 125.66;
  function tick() {
    if (!state || state.status === 'waiting') return;
    const stage = $('#turn-stage');
    if (state.status === 'playing' && state.seats.some((s) => s && !s.connected)) renderBanner();
    if (state.status !== 'playing' || !state.deadline) {
      stage.classList.remove('low');
      $('#ring-fg').style.strokeDashoffset = state.status === 'playing' ? 0 : RING;
      $('#turn-time').textContent = state.status === 'playing' ? '∞' : '';
      return;
    }
    const left = Math.max(0, state.deadline - (Date.now() + clockOffset));
    const total = state.turnSeconds * 1000;
    $('#ring-fg').style.strokeDashoffset = RING * (1 - left / total);
    const sec = Math.ceil(left / 1000);
    $('#turn-time').textContent = `${sec}`;
    stage.classList.toggle('low', left < 5000);
    if (state.turn === mySeat && sec <= 5 && sec > 0 && sec !== tick.lastSec) Sound.play('tick');
    tick.lastSec = sec;
  }
  setInterval(tick, 250);

  // ── чат
  const chatPanel = $('#chat-panel');
  const chatList = $('#chat-list');
  const chatBtn = $('#chat-btn');
  let unread = 0;
  let chatMessages = [];
  const chatOpen = () => !chatPanel.classList.contains('hidden');

  function renderChat() {
    if (!chatMessages.length) {
      chatList.innerHTML = `<li class="chat-empty">${L('Тут поки тихо. Напиши першим 🙂', 'Quiet so far. Say something first 🙂')}</li>`;
      return;
    }
    chatList.innerHTML = chatMessages
      .map((m) => `<li class="seat-${m.seat} ${m.seat === mySeat ? 'mine' : ''}">
        <span class="chat-who"><span class="lm-sym">${SYMBOLS[m.seat] || ''}</span> ${escapeHtml(m.seat === mySeat ? L('Ти', 'You') : m.name)}</span>
        <span class="chat-text">${escapeHtml(m.text)}</span></li>`)
      .join('');
    chatList.scrollTop = chatList.scrollHeight;
  }
  function setUnread(n) {
    unread = n;
    $('#chat-badge').textContent = n > 9 ? '9+' : n;
    $('#chat-badge').classList.toggle('hidden', !n);
  }
  function toggleChat(open) {
    chatPanel.classList.toggle('hidden', !open);
    chatBtn.setAttribute('aria-expanded', open);
    if (open) {
      setUnread(0);
      renderChat();
      $('#chat-input').focus();
    }
  }
  chatBtn.addEventListener('click', () => toggleChat(!chatOpen()));
  socket.on('chatHistory', (list) => {
    chatMessages = list;
    renderChat();
  });
  socket.on('chat', (m) => {
    chatMessages.push(m);
    if (chatMessages.length > 100) chatMessages.shift();
    if (chatOpen()) {
      renderChat();
    } else if (m.seat !== mySeat) {
      setUnread(unread + 1);
      toast(`💬 ${m.name}: ${m.text.length > 60 ? m.text.slice(0, 60) + '…' : m.text}`, '', 4000);
      Sound.play('pop');
    }
  });
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat', text, (res) => {
      if (res?.error) toast(res.error, 'bad');
      else input.value = '';
    });
  });

  // ── «Останній хід» → підсвітити клітинку
  const lastMoveEl = $('#last-move');
  const spot = (on) => {
    const cell = lastMoveEl.dataset.cell;
    if (cell === '') return;
    document.querySelector(`#board [data-cell="${cell}"]`)?.classList.toggle('spot', on);
  };
  lastMoveEl.addEventListener('mouseenter', () => spot(true));
  lastMoveEl.addEventListener('mouseleave', () => spot(false));
  lastMoveEl.addEventListener('click', () => {
    const cell = lastMoveEl.dataset.cell;
    if (cell === '') return;
    const el = document.querySelector(`#board [data-cell="${cell}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    spot(true);
    setTimeout(() => spot(false), 1600);
  });

  // ── реакції
  $('#reactions').addEventListener('click', (e) => {
    const emoji = e.target.closest('[data-emoji]')?.dataset.emoji;
    if (emoji) socket.emit('react', emoji);
  });
  socket.on('reaction', ({ seat, emoji }) => {
    const card = $(`#pcard-${seat}`);
    if (!card) return;
    const bubble = document.createElement('div');
    bubble.className = 'reaction-bubble';
    bubble.textContent = emoji;
    card.appendChild(bubble);
    setTimeout(() => bubble.remove(), 1800);
    if (seat !== mySeat) Sound.play('pop');
  });

  // ── вибір гравця
  let pickerCell = null;
  let suggestionIdx = 0;
  let currentSuggestions = [];
  const pickerInput = $('#picker-input');

  function openPicker(cell) {
    const n = state.grid.size;
    pickerCell = cell;
    const row = state.grid.rows[Math.floor(cell / n)];
    const col = state.grid.cols[cell % n];
    $('#picker-title').innerHTML = `<span class="tag">${escapeHtml(row.label)}</span><span class="x">×</span><span class="tag">${escapeHtml(col.label)}</span>`;
    pickerInput.value = '';
    renderSuggestions();
    $('#picker').classList.remove('hidden');
    pickerInput.focus();
  }

  function closePicker() {
    pickerCell = null;
    $('#picker').classList.add('hidden');
  }

  function renderSuggestions() {
    currentSuggestions = search(pickerInput.value);
    suggestionIdx = currentSuggestions.findIndex((p) => !usedIds.has(p.id));
    const ul = $('#suggestions');
    if (!pickerInput.value.trim()) {
      ul.innerHTML = '';
      return;
    }
    const shamed = window.Players.shame(pickerInput.value); // росіяни — сірі, вибрати не можна
    if (!currentSuggestions.length) {
      ul.innerHTML = shamed || `<li class="empty">${L('Нікого не знайдено', 'No one found')}</li>`;
      return;
    }
    ul.innerHTML = currentSuggestions
      .map((p, i) => {
        const used = usedIds.has(p.id);
        // підпис — ім'я латиницею (в українській версії) і рік народження
        const other = window.I18n.lang === 'en' ? null : p.name;
        const sub = [other, p.born && L(`${p.born} р.н.`, `b. ${p.born}`)].filter(Boolean).join(' · ');
        const avatar = `<span class="s-avatar"><span>${escapeHtml(initials(pname(p)))}</span>${
          p.thumb ? `<img src="${escapeHtml(p.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''
        }</span>`;
        return `<li role="option" data-idx="${i}" class="${used ? 'used' : ''} ${i === suggestionIdx ? 'active' : ''}">
          ${avatar}
          <div class="s-text"><div class="s-main">${escapeHtml(pname(p))}</div><div class="s-sub">${escapeHtml(sub)}</div></div>
          ${used ? `<span class="s-flag">${L('вже був у грі', 'already used')}</span>` : ''}
        </li>`;
      })
      .join('') + shamed;
  }

  function highlight(idx) {
    suggestionIdx = idx;
    document.querySelectorAll('#suggestions li').forEach((li) => li.classList.toggle('active', Number(li.dataset.idx) === idx));
    document.querySelector('#suggestions li.active')?.scrollIntoView({ block: 'nearest' });
  }

  function choose(idx) {
    const p = currentSuggestions[idx];
    if (!p || pickerCell === null) return;
    if (usedIds.has(p.id)) {
      toast(L(`${p.uk} вже був у цій грі — обери іншого`, `${pname(p)} has already been used — pick someone else`), 'bad');
      return;
    }
    const cell = pickerCell;
    socket.emit('move', { cell, playerId: p.id }, (res) => {
      if (res?.error) {
        toast(res.error, 'bad');
        return;
      }
      closePicker();
      if (res.correct && state.board.scoring !== 'points') toast(`✓ ${pname(p)} — ${L('є!', 'correct!')}`, 'good');
    });
  }

  pickerInput.addEventListener('input', renderSuggestions);
  pickerInput.addEventListener('keydown', (e) => {
    const n = currentSuggestions.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      highlight((suggestionIdx + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      highlight((suggestionIdx - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestionIdx >= 0) choose(suggestionIdx);
    } else if (e.key === 'Escape') {
      closePicker();
    }
  });
  $('#suggestions').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-idx]');
    if (li) choose(Number(li.dataset.idx));
  });

  // ── дії
  $('#board').addEventListener('click', (e) => {
    const cell = e.target.closest('.cell.playable');
    if (cell) return openPicker(Number(cell.dataset.cell));
    // на великому полі назви категорій обрізані — по тапу показуємо повністю
    const cat = e.target.closest('.cat');
    if (cat && state?.board.size > 3) toast(cat.dataset.label);
  });

  document.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (target.tagName === 'A') e.preventDefault();
    const ack = (res) => res?.error && toast(res.error, 'bad');
    switch (action) {
      case 'close-picker': closePicker(); break;
      case 'close-rules': $('#rules-modal').classList.add('hidden'); break;
      case 'close-chat': toggleChat(false); break;
      case 'rules': if (state) openRules(roomCfg()); break;
      case 'rules-invite':
        if (inviteInfo) openRules({ board: inviteInfo.board, mode: inviteInfo.mode, capacity: inviteInfo.capacity, turnSeconds: inviteInfo.turnSeconds });
        break;
      case 'go-home':
        inviteCode = null;
        history.replaceState(null, '', location.pathname);
        showScreen('home');
        break;
      case 'confirm-yes': closeConfirm(true); break;
      case 'confirm-no': closeConfirm(false); break;
      case 'skip': socket.emit('skip', null, ack); break;
      case 'draw': socket.emit('offerDraw', null, ack); break;
      case 'decline-draw': socket.emit('declineDraw', null, ack); break;
      case 'claim-win': socket.emit('claimWin', null, ack); break;
      case 'surrender': {
        const multi = state.capacity > 2 && activeSeats().length > 2;
        const text = multi ? L('Вийти з цієї партії? Гра триватиме без тебе.', 'Leave this game? It will go on without you.') : L('Здатися? Перемогу отримає суперник.', 'Resign? Your opponent gets the win.');
        if (await askConfirm(text, multi ? L('Вийти з партії', 'Leave the game') : L('Здатися', 'Resign'))) socket.emit('surrender', null, ack);
        break;
      }
      case 'rematch': socket.emit('rematch', null, ack); break;
      case 'view-board':
        resultDismissed = true;
        $('#result').classList.add('hidden');
        renderBanner();
        break;
      case 'show-result':
        resultDismissed = false;
        renderResult();
        renderBanner();
        break;
      case 'leave-confirm':
        if (state?.status === 'playing' && !(await askConfirm(L('Вийти з кімнати? Ти покинеш поточну гру.', 'Leave the room? You will quit the current game.'), L('Вийти', 'Leave')))) break;
        leaveRoom();
        break;
      case 'leave':
        leaveRoom();
        break;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closePicker();
    $('#rules-modal').classList.add('hidden');
    if (!$('#confirm').classList.contains('hidden')) closeConfirm(false);
  });

  // ── звук: повзунок гучності + вимкнення
  const muteBtn = $('#mute-btn');
  const soundPanel = $('#sound-panel');
  const volumeInput = $('#volume');
  const renderSound = () => {
    const vol = Math.round(Sound.getVolume() * 100);
    const off = Sound.isMuted() || vol === 0;
    muteBtn.textContent = off ? '🔇' : vol < 40 ? '🔉' : '🔊';
    volumeInput.value = vol;
    $('#volume-val').textContent = `${vol}%`;
    $('#mute-toggle').textContent = Sound.isMuted() ? L('🔊 Увімкнути звук', '🔊 Sound on') : L('🔇 Вимкнути звук', '🔇 Sound off');
    volumeInput.disabled = Sound.isMuted();
  };
  renderSound();
  muteBtn.addEventListener('click', () => {
    const open = soundPanel.classList.toggle('hidden') === false;
    muteBtn.setAttribute('aria-expanded', open);
  });
  volumeInput.addEventListener('input', () => {
    Sound.setVolume(volumeInput.value / 100);
    renderSound();
  });
  volumeInput.addEventListener('change', () => Sound.play('hit')); // приклад звуку на новій гучності
  $('#mute-toggle').addEventListener('click', () => {
    Sound.setMuted(!Sound.isMuted());
    renderSound();
    Sound.play('pop');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sound-ctl')) {
      soundPanel.classList.add('hidden');
      muteBtn.setAttribute('aria-expanded', 'false');
    }
  });

  $('#copy-btn').addEventListener('click', () => copy($('#share-link').value));
  $('#game-copy').addEventListener('click', (e) => {
    e.preventDefault();
    copy(roomLink(session.code));
  });

  // ── екран запрошення
  let inviteCode = null;
  let inviteInfo = null;
  async function showInvite(code) {
    inviteCode = code;
    showScreen('invite');
    const nameEl = $('#invite-name');
    nameEl.value = nameInput.value || '';
    $('#invite-error').textContent = '';
    $('#invite-sub').textContent = L('Завантажуємо кімнату…', 'Loading the room…');
    $('#invite-config').innerHTML = '';
    $('#invite-slots').innerHTML = '';
    $('#invite-join').disabled = true;
    let info = null;
    try {
      const res = await fetch(`/api/crossroads/room/${encodeURIComponent(code)}?lang=${window.I18n.lang}`);
      if (res.ok) info = await res.json();
      if (!info?.found) info = null;
    } catch { /* мережа */ }
    inviteInfo = info;
    if (!info) {
      $('#invite-title').textContent = L('Кімнату не знайдено', 'Room not found');
      $('#invite-sub').textContent = L(`Кімнати ${code} вже немає — можливо, гра закінчилась або сервер перезапускався. Попроси друга створити нову і надіслати свіже посилання, або створи свою гру.`,
        `Room ${code} no longer exists — maybe the game ended or the server restarted. Ask your friend to create a new one and send a fresh link, or start your own game.`);
      $('#invite-join').classList.add('hidden');
      $('#invite-name').closest('.field').classList.add('hidden');
      $('[data-action="rules-invite"]').classList.add('hidden');
      $('[data-action="go-home"]').className = 'btn btn-primary';
      $('[data-action="go-home"]').textContent = L('Створити свою гру', 'Start your own game');
      return;
    }
    $('[data-action="rules-invite"]').classList.remove('hidden');
    $('[data-action="go-home"]').className = 'btn btn-ghost btn-sm';
    $('[data-action="go-home"]').textContent = L('Або створити свою гру', 'Or start your own game');
    const joined = info.players.length;
    const full = joined >= info.capacity;
    $('#invite-join').classList.remove('hidden');
    $('#invite-name').closest('.field').classList.remove('hidden');
    $('#invite-title').textContent = info.players[0] ? L(`${info.players[0]} кличе тебе в гру`, `${info.players[0]} invites you to play`) : L('Тебе запросили в гру', "You've been invited to a game");
    $('#invite-config').innerHTML = configChips(info);
    $('#invite-slots').innerHTML = Array.from({ length: info.capacity }, (_, i) => info.players[i]
      ? `<li class="seat-${i}"><span class="sym">${SYMBOLS[i]}</span><span>${escapeHtml(info.players[i])}</span></li>`
      : `<li class="empty"><span class="sym">${SYMBOLS[i]}</span><span>${i === joined ? L('Тут будеш ти', "That's you") : L('Вільне місце', 'Free seat')}</span></li>`).join('');
    if (full || info.status !== 'waiting') {
      $('#invite-sub').textContent = info.status !== 'waiting'
        ? L('Гра в цій кімнаті вже почалась — дочекайся кінця партії або створи свою гру.', 'The game in this room has already started — wait for it to finish or start your own.')
        : L('Кімната вже заповнена — створи свою гру.', 'The room is full — start your own game.');
      $('#invite-join').disabled = true;
      return;
    }
    $('#invite-sub').textContent = info.capacity - joined === 1
      ? L('Залишилось одне місце — твоє. Гра почнеться, щойно ти зайдеш.', 'One seat left — yours. The game starts as soon as you join.')
      : L(`Вільних місць: ${info.capacity - joined}. Гра почнеться, коли зберуться всі.`, `Free seats: ${info.capacity - joined}. The game starts when everyone is in.`);
    $('#invite-join').disabled = false;
    if (!nameEl.value.trim()) nameEl.focus();
  }

  function joinFromInvite() {
    const name = $('#invite-name').value.trim();
    if (!name) {
      $('#invite-error').textContent = L("Введи своє ім'я — так тебе бачитимуть інші", 'Enter your name — this is how others will see you');
      $('#invite-name').focus();
      return;
    }
    nameInput.value = name;
    store.set('g9:name', name);
    $('#invite-error').textContent = '';
    socket.emit('join', { code: inviteCode, name, token: store.get(`g9:token:${inviteCode}`) }, (res) => {
      if (res?.error) {
        $('#invite-error').textContent = res.error;
        return;
      }
      onEntered(res);
    });
  }
  $('#invite-join').addEventListener('click', joinFromInvite);
  $('#invite-name').addEventListener('keydown', (e) => e.key === 'Enter' && joinFromInvite());

  // ── вхід за посиланням ?room=CODE
  const urlCode = new URLSearchParams(location.search).get('room');
  if (urlCode) {
    const code = urlCode.toUpperCase();
    $('#code-input').value = code;
    const token = store.get(`g9:token:${code}`);
    if (token && nameInput.value.trim()) {
      // повернення у свою ж кімнату (оновив сторінку, перепідключення) — заходимо одразу
      session.code = code;
      session.token = token;
      renderResume();
      if (socket.connected) socket.emit('join', { code, name: nameInput.value.trim(), token }, onEntered);
      // інакше join надішле обробник 'connect'
    } else {
      // нове запрошення — окремий простий екран: хто в кімнаті, ім'я й одна кнопка
      showInvite(code);
    }
  }
})();
