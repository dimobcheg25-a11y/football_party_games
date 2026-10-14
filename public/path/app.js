(() => {
  const $ = (sel) => document.querySelector(sel);
  const socket = io('/path');

  // ── локальне сховище (може бути недоступне в приватному режимі)
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  const DIFFICULTY_HINTS = {
    easy: 'Лише зірки — гравці, яких знають усі.',
    normal: 'Відомі гравці топ-ліг і збірних (і трохи менше відомі українці).',
    hard: 'Уся база — включно з тими, кого пам’ятають лише справжні фанати.',
  };
  const SET_LABELS = { all: 'Усі гравці', upl: 'УПЛ 2000–2014' };
  const DIFF_LABELS = { easy: '🟢 Легкий', normal: '🟡 Звичайний', hard: '🔴 Складний' };
  const SEAT_COLORS = ['#4fb3ff', '#ff6b8b', '#ffb547', '#a98bff', '#5fe0b5', '#ff8a4c', '#e0e86a', '#f08fe0'];

  // налаштування нової гри (запам'ятовуємо між візитами)
  const defaults = { set: 'all', difficulty: 'normal', start: 'first', rounds: '10', turnSeconds: '30', showYears: true, showStats: true };
  let setup = { ...defaults };
  try { setup = { ...defaults, ...JSON.parse(store.get('path:setup') || '{}') }; } catch { /* ignore */ }

  let session = null; // { code, token }
  try { session = JSON.parse(store.get('path:session') || 'null'); } catch { /* ignore */ }
  let state = null;
  let mySeat = -1;
  let clockOffset = 0;
  let inviteCode = new URLSearchParams(location.search).get('room');

  // ── дрібниці
  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => {
    const parts = String(name).split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : String(name).slice(0, 2)).toUpperCase();
  };
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  const seatName = (i) => (i === mySeat ? 'Ти' : state?.seats[i]?.name || 'Гравець');
  const seatStyle = (i) => `--pc:${SEAT_COLORS[i % SEAT_COLORS.length]}`;
  const roomLink = (code) => `${location.origin}${location.pathname}?room=${code}`;
  const emit = (event, data) => new Promise((res) => socket.emit(event, data, (r) => res(r || {})));

  function showScreen(name) {
    for (const s of ['home', 'lobby', 'game', 'final']) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
    const inRoom = name !== 'home' && state && !state.solo;
    $('#chat-fab').classList.toggle('hidden', !inRoom);
    if (!inRoom) toggleChat(false);
  }

  let toastTimer = null;
  function toast(text, kind = '') {
    const el = $('#toast');
    el.textContent = text;
    el.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 2600);
  }

  // ── головний екран
  function renderSetup() {
    document.querySelectorAll('[data-opt]').forEach((group) => {
      const key = group.dataset.opt;
      group.querySelectorAll('.chip').forEach((chip) => {
        const on = String(setup[key]) === chip.dataset.val;
        chip.classList.toggle('active', on);
        chip.setAttribute('role', 'radio');
        chip.setAttribute('aria-checked', on);
      });
    });
    document.querySelectorAll('[data-toggle]').forEach((chip) => {
      const on = !!setup[chip.dataset.toggle];
      chip.classList.toggle('active', on);
      chip.setAttribute('aria-pressed', on);
      chip.textContent = `${on ? '✓ ' : ''}${chip.dataset.toggle === 'showYears' ? 'Роки' : 'Матчі й голи'}`;
    });
    $('#difficulty-hint').textContent = DIFFICULTY_HINTS[setup.difficulty];
    store.set('path:setup', JSON.stringify(setup));
  }

  document.querySelectorAll('[data-opt] .chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      setup[chip.parentElement.dataset.opt] = chip.dataset.val;
      renderSetup();
    }),
  );
  document.querySelectorAll('[data-toggle]').forEach((chip) =>
    chip.addEventListener('click', () => {
      setup[chip.dataset.toggle] = !setup[chip.dataset.toggle];
      renderSetup();
    }),
  );

  const nameInput = $('#name-input');
  nameInput.value = store.get('games:name') || store.get('g9:name') || '';

  function requireName() {
    const name = nameInput.value.trim();
    if (!name) {
      $('#home-error').textContent = 'Введи ім’я';
      nameInput.focus();
      return null;
    }
    $('#home-error').textContent = '';
    store.set('games:name', name);
    return name;
  }

  function options() {
    return { ...setup, rounds: Number(setup.rounds), turnSeconds: Number(setup.turnSeconds) };
  }

  async function create(solo) {
    const name = requireName();
    if (!name) return;
    const res = await emit('create', { ...options(), solo, name });
    onEntered(res);
  }
  $('#solo-btn').addEventListener('click', () => create(true));
  $('#create-btn').addEventListener('click', () => create(false));

  $('#join-btn').addEventListener('click', async () => {
    const name = requireName();
    if (!name) return;
    const token = session?.code === inviteCode ? session.token : undefined;
    onEntered(await emit('join', { code: inviteCode, name, token }));
  });

  $('#resume-btn').addEventListener('click', async () => {
    const res = await emit('join', { code: session.code, token: session.token, name: nameInput.value.trim() });
    if (res.error) {
      store.del('path:session');
      session = null;
      renderHome();
      return toast(res.error, 'bad');
    }
    onEntered(res);
  });

  function onEntered(res) {
    if (res.error) {
      $('#home-error').textContent = res.error;
      return;
    }
    session = { code: res.code, token: res.token };
    store.set('path:session', JSON.stringify(session));
    inviteCode = null;
    history.replaceState(null, '', `?room=${res.code}`);
  }

  // Запрошення за посиланням: лише ім'я і «Приєднатися»; налаштування — від того, хто створив кімнату.
  async function renderHome() {
    const invite = !!inviteCode;
    $('#setup-options').classList.toggle('hidden', invite);
    $('#start-buttons').classList.toggle('hidden', invite);
    $('#join-btn').classList.toggle('hidden', !invite);
    $('#invite-note').classList.add('hidden');
    $('#resume-btn').classList.toggle('hidden', invite || !session);
    if (session && !invite) $('#resume-btn').textContent = 'Повернутися до своєї гри';
    if (!invite) return;
    try {
      const info = await (await fetch(`/api/path/room/${encodeURIComponent(inviteCode)}`)).json();
      const note = $('#invite-note');
      note.classList.remove('hidden');
      if (!info.found) {
        note.textContent = 'Цієї кімнати вже немає — створи свою гру.';
        inviteCode = null;
        history.replaceState(null, '', location.pathname);
        return renderHome();
      }
      const o = info.options;
      note.innerHTML = `${escapeHtml(info.players[0] || 'Друг')} кличе грати!<br><small>${SET_LABELS[o.set]} · ${DIFF_LABELS[o.difficulty]} · ${o.rounds} ${plural(o.rounds, 'раунд', 'раунди', 'раундів')}</small>`;
    } catch { /* мережа — просто без опису */ }
  }

  // ── стан кімнати
  socket.on('connect', () => {
    // перепідключення: сервер пам'ятає нас за токеном
    if (state && session) emit('join', { code: session.code, token: session.token });
  });

  let prev = null;
  socket.on('state', (s) => {
    prev = state;
    state = s;
    mySeat = s.you;
    clockOffset = s.serverNow - Date.now();
    playSounds(prev, s);
    render();
  });

  function playSounds(p, s) {
    if (!p) return;
    const mineNow = s.solved[mySeat];
    if (mineNow && !p.solved[mySeat]) window.Sound.play('win');
    if (s.phase === 'guess' && p.phase === 'guess' && s.stage > p.stage) window.Sound.play('pop');
    if (s.phase === 'guess' && (p.phase !== 'guess' || p.round !== s.round)) window.Sound.play('whistle');
  }

  function render() {
    if (!state) return showScreen('home');
    if (state.status === 'waiting') return renderLobby();
    if (state.status === 'finished') return renderFinal();
    renderGame();
  }

  function optionChips(o) {
    return [SET_LABELS[o.set], DIFF_LABELS[o.difficulty], o.start === 'first' ? 'з першого клубу' : 'з останнього клубу',
      `${o.rounds} ${plural(o.rounds, 'раунд', 'раунди', 'раундів')}`, o.turnSeconds ? `${o.turnSeconds} с на етап` : 'без таймера',
      !o.showYears && 'без років', !o.showStats && 'без матчів і голів']
      .filter(Boolean).map((t) => `<span>${escapeHtml(t)}</span>`).join('');
  }

  function renderLobby() {
    showScreen('lobby');
    $('#lobby-code').textContent = state.code;
    $('#lobby-options').innerHTML = optionChips(state.options);
    $('#lobby-players').innerHTML = state.seats
      .map((s, i) => (s ? `<li style="${seatStyle(i)}"><span class="dot-p"></span>${escapeHtml(s.name)}${i === mySeat ? ' <small>(ти)</small>' : ''}${i === state.host ? ' <small>· створив гру</small>' : ''}${s.connected ? '' : ' <small class="muted">· офлайн</small>'}</li>` : ''))
      .join('');
    const isHost = mySeat === state.host;
    const count = state.seats.filter(Boolean).length;
    $('#start-btn').classList.toggle('hidden', !isHost);
    $('#start-btn').textContent = count > 1 ? `Почати гру (${count} ${plural(count, 'гравець', 'гравці', 'гравців')})` : 'Почати гру';
    $('#lobby-wait').textContent = isHost
      ? count > 1 ? 'Можна починати — або дочекайтесь ще когось.' : 'Надішли запрошення друзям. Хто зайде пізніше — приєднається до гри, що вже йде.'
      : `Чекаємо, поки ${state.seats[state.host]?.name || 'господар'} почне гру.`;
  }

  $('#copy-link').addEventListener('click', async () => {
    const link = roomLink(state.code);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Шлях футболіста', url: link });
      else { await navigator.clipboard.writeText(link); toast('Посилання скопійовано', 'good'); }
    } catch { /* скасовано */ }
  });
  $('#start-btn').addEventListener('click', async () => {
    const res = await emit('start');
    if (res.error) toast(res.error, 'bad');
  });

  // ── гра
  function stageHtml(st, i, current) {
    const stats = st.apps != null || st.goals != null
      ? `<span class="st-stats">${st.apps ?? '—'} ${plural(st.apps ?? 0, 'матч', 'матчі', 'матчів')} · ${st.goals ?? '—'} ${plural(st.goals ?? 0, 'гол', 'голи', 'голів')}</span>`
      : st.apps === null && st.kind === 'club' ? '<span class="st-stats muted">матчі й голи невідомі</span>' : '';
    let icon;
    let title = escapeHtml(st.name);
    let sub = '';
    if (st.kind === 'club') {
      icon = st.img ? `<img src="${st.img}" alt="" loading="lazy" />` : `<span>${escapeHtml(initials(st.name))}</span>`;
      sub = [st.country, st.years].filter(Boolean).map(escapeHtml).join(' · ');
    } else if (st.kind === 'nation') {
      icon = '<span>🏳️</span>';
      sub = 'збірна';
    } else if (st.kind === 'position') {
      icon = '<span>🧭</span>';
      sub = 'позиція';
    } else {
      icon = '<span>🎂</span>';
      sub = 'рік народження';
    }
    return `<li class="stage ${st.kind} ${current ? 'current' : ''}">
      <div class="st-num">${i + 1}</div>
      <div class="st-icon">${icon}</div>
      <div class="st-body"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}${stats}</div>
    </li>`;
  }

  function renderGame() {
    showScreen('game');
    const s = state;
    const reveal = s.phase === 'reveal';
    $('#round-info').innerHTML = `<b>Раунд ${s.round} з ${s.rounds}</b><span>${reveal ? 'відповідь' : `етап ${s.stage + 1} з ${s.totalStages} · ${pointsNow()} ${plural(pointsNow(), 'очко', 'очки', 'очок')} за вгадування`}</span>`;

    const shown = s.stages.map((st, i) => stageHtml(st, i, !reveal && i === s.stage)).join('');
    const left = s.totalStages - s.stages.length;
    const hidden = left > 0
      ? `<li class="stage locked"><div class="st-num">…</div><div class="st-body"><b>Ще ${left} ${plural(left, 'підказка', 'підказки', 'підказок')} попереду</b></div></li>`
      : '';
    $('#path').innerHTML = shown + hidden;

    // поле відповіді
    const solved = s.solved[mySeat];
    const done = s.stageDone.includes(mySeat);
    $('#answer-box').classList.toggle('hidden', reveal);
    const input = $('#guess-input');
    input.disabled = !!solved || done;
    $('#pass-btn').disabled = !!solved || done;
    if (input.disabled) { input.value = ''; renderSuggestions(); }
    $('#answer-hint').textContent = solved
      ? `✓ Вгадав на етапі ${solved.stage + 1}: +${solved.points}. Чекаємо інших…`
      : done ? 'Відповідь на цьому етапі вже є — чекай наступної підказки.' : '';

    // відповідь після раунду
    const rv = $('#reveal');
    rv.classList.toggle('hidden', !reveal);
    if (reveal && s.answer) {
      const a = s.answer;
      const results = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
        .map((i) => { const r = s.solved[i]; return `<li style="${seatStyle(i)}"><span class="dot-p"></span>${escapeHtml(seatName(i))}<b>${r ? `+${r.points} · етап ${r.stage + 1}` : 'не вгадав'}</b></li>`; }).join('');
      const iVoted = s.nextVotes.includes(mySeat);
      rv.innerHTML = `<div class="answer-card">
          <div class="answer-photo">${a.photo ? `<img src="${a.photo}" alt="" />` : `<span>${escapeHtml(initials(a.name))}</span>`}</div>
          <div><small>Це був</small><h2>${escapeHtml(a.uk || a.name)}</h2>${a.uk && a.uk !== a.name ? `<small class="muted">${escapeHtml(a.name)}</small>` : ''}</div>
        </div>
        ${s.solo ? '' : `<ul class="round-results">${results}</ul>`}
        <button id="next-btn" class="btn btn-primary btn-lg" ${iVoted ? 'disabled' : ''}>${s.round >= s.rounds ? 'Підсумки' : 'Наступний гравець →'}</button>`;
      $('#next-btn').addEventListener('click', () => emit('next'));
    }

    $('#reactions').classList.toggle('hidden', s.solo);
    renderScoreboard();
    renderFeed();
    tick();
  }

  const pointsNow = () => state.points[state.stage] ?? 1;

  function renderScoreboard() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    $('#scoreboard').innerHTML = seats.map((i) => {
      const st = s.solved[i] ? '✓' : s.stageDone.includes(i) ? '•' : '';
      return `<li style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'}">
        <span class="dot-p"></span><span class="nm">${escapeHtml(seatName(i))}</span><span class="mark">${st}</span><b>${s.scores[i]}</b></li>`;
    }).join('');
  }

  function renderFeed() {
    const s = state;
    if (s.solo) {
      $('#guess-feed').innerHTML = s.guesses.filter((g) => !g.correct).map((g) => `<li class="bad">✗ ${escapeHtml(g.player.uk || g.player.name)} <small>етап ${g.stage + 1}</small></li>`).join('');
      return;
    }
    $('#guess-feed').innerHTML = [...s.guesses].reverse().map((g) => {
      const who = `<b style="${seatStyle(g.seat)}">${escapeHtml(seatName(g.seat))}</b>`;
      if (g.correct) return `<li class="good">${who} вгадав${g.player ? `: ${escapeHtml(g.player.uk || g.player.name)}` : ''} ✓ <small>етап ${g.stage + 1}</small></li>`;
      return `<li class="bad">${who}: ${escapeHtml(g.player.uk || g.player.name)} ✗ <small>етап ${g.stage + 1}</small></li>`;
    }).join('');
  }

  // ── таймер етапу
  function tick() {
    const el = $('#timer');
    if (!state || state.status !== 'playing' || !state.deadline) { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((state.deadline - (Date.now() + clockOffset)) / 1000));
    el.textContent = state.phase === 'reveal' ? `далі через ${left} с` : `⏱ ${left} с`;
    el.classList.toggle('low', state.phase === 'guess' && left <= 5);
  }
  setInterval(tick, 250);

  // ── вибір гравця
  const input = $('#guess-input');
  let suggestions = [];
  let active = 0;

  function renderSuggestions() {
    const list = $('#suggestions');
    if (!input.value.trim() || input.disabled) { list.innerHTML = ''; suggestions = []; return; }
    suggestions = window.Players.search(input.value);
    const wrong = new Set(state.guesses.filter((g) => g.seat === mySeat && !g.correct).map((g) => g.player.id));
    list.innerHTML = suggestions.length
      ? suggestions.map((p, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''} ${wrong.has(p.id) ? 'used' : ''}">
          <span class="s-avatar">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy" />` : escapeHtml(initials(p.name))}</span>
          <span class="s-text"><span class="s-main">${escapeHtml(p.uk || p.name)}</span><span class="s-sub">${escapeHtml(p.name)}${p.born ? ` · ${p.born}` : ''}</span></span>
          ${wrong.has(p.id) ? '<span class="s-flag">уже був</span>' : ''}</li>`).join('')
      : '<li class="empty">Нікого не знайдено</li>';
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
    if (!res.correct) {
      window.Sound.play('miss');
      toast(`Ні, це не ${p.uk || p.name}`, 'bad');
    }
  }

  $('#pass-btn').addEventListener('click', () => emit('pass'));

  // ── підсумок
  function renderFinal() {
    showScreen('final');
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    const max = s.rounds * s.points[0];
    if (s.solo) {
      $('#final-title').textContent = `${s.scores[mySeat]} з ${max} очок`;
      const key = `path:best:${s.options.set}:${s.options.difficulty}:${s.rounds}`;
      const best = Number(store.get(key)) || 0;
      if (s.scores[mySeat] > best) store.set(key, s.scores[mySeat]);
      $('#final-standings').innerHTML = `<li><span class="nm">Рекорд (${SET_LABELS[s.options.set]}, ${DIFF_LABELS[s.options.difficulty]}, ${s.rounds})</span><span class="val">${Math.max(best, s.scores[mySeat])}${s.scores[mySeat] > best && best ? ' — новий!' : ''}</span></li>`;
    } else {
      const top = s.scores[seats[0]];
      const winners = seats.filter((i) => s.scores[i] === top);
      $('#final-title').textContent = winners.length > 1 ? 'Нічия!' : winners[0] === mySeat ? 'Ти переміг! 🏆' : `Переміг ${seatName(winners[0])} 🏆`;
      $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${s.scores[i] === top ? 'win' : ''}">
        <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))}</span><span class="val">${s.scores[i]} ${plural(s.scores[i], 'очко', 'очки', 'очок')}</span></li>`).join('');
    }
    $('#final-history').innerHTML = s.history.map((h) => {
      const mine = h.results[mySeat];
      return `<li><span class="nm">${escapeHtml(h.answer.uk || h.answer.name)}</span><span class="val">${mine ? `+${mine.points}` : '—'}</span></li>`;
    }).join('');
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost);
    $('#again-wait').textContent = isHost || s.solo ? '' : `${s.seats[s.host]?.name || 'Господар'} може почати ще одну гру.`;
  }

  $('#again-btn').addEventListener('click', async () => {
    const res = await emit('start');
    if (res.error) toast(res.error, 'bad');
  });

  // ── вихід
  document.querySelectorAll('[data-action="leave"]').forEach((b) => b.addEventListener('click', leave));
  async function leave() {
    if (state?.status === 'playing' && !state.solo && !confirm('Вийти з гри? Твої очки пропадуть.')) return;
    await emit('leave');
    state = null;
    session = null;
    store.del('path:session');
    history.replaceState(null, '', location.pathname);
    showScreen('home');
    renderHome();
  }

  // ── чат і реакції
  const chatPanel = $('#chat-panel');
  let chat = [];
  let unread = 0;
  function toggleChat(open) {
    chatPanel.classList.toggle('hidden', !open);
    if (open) { unread = 0; renderChat(); $('#chat-input').focus(); }
    $('#chat-badge').classList.toggle('hidden', !unread);
    $('#chat-badge').textContent = unread;
  }
  function renderChat() {
    $('#chat-list').innerHTML = chat.length
      ? chat.map((m) => `<li class="${m.seat === mySeat ? 'mine' : ''}" style="${seatStyle(m.seat)}"><span class="chat-who">${escapeHtml(m.seat === mySeat ? 'Ти' : m.name)}</span><span class="chat-text">${escapeHtml(m.text)}</span></li>`).join('')
      : '<li class="chat-empty">Тут ще тихо</li>';
    $('#chat-list').scrollTop = 1e6;
  }
  socket.on('chatHistory', (list) => { chat = list; renderChat(); });
  socket.on('chat', (m) => {
    chat.push(m);
    if (chatPanel.classList.contains('hidden') && m.seat !== mySeat) unread++;
    renderChat();
    toggleChat(!chatPanel.classList.contains('hidden'));
  });
  $('#chat-fab').addEventListener('click', () => toggleChat(chatPanel.classList.contains('hidden')));
  $('#chat-close').addEventListener('click', () => toggleChat(false));
  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#chat-input').value.trim();
    if (!text) return;
    const res = await emit('chat', text);
    if (res.error) return toast(res.error, 'bad');
    $('#chat-input').value = '';
  });

  const REACTIONS = ['👍', '😂', '😮', '😡', '🔥', '👏'];
  $('#reactions').innerHTML = REACTIONS.map((r) => `<button type="button" data-r="${r}">${r}</button>`).join('');
  $('#reactions').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-r]');
    if (b) socket.emit('react', b.dataset.r);
  });
  socket.on('reaction', ({ seat, emoji }) => {
    const li = [...$('#scoreboard').children].find((x) => x.getAttribute('style')?.includes(SEAT_COLORS[seat % SEAT_COLORS.length]));
    const bubble = document.createElement('span');
    bubble.className = 'reaction-bubble';
    bubble.textContent = emoji;
    (li || $('#scoreboard')).appendChild(bubble);
    setTimeout(() => bubble.remove(), 1800);
  });

  // ── звук
  const muteBtn = $('#mute-btn');
  const renderMute = () => (muteBtn.textContent = window.Sound.isMuted() ? '🔇' : '🔊');
  muteBtn.addEventListener('click', () => { window.Sound.setMuted(!window.Sound.isMuted()); renderMute(); });
  renderMute();

  // ── старт сторінки
  $('#points-rule').textContent = '10 за перший етап, далі 8, 6, 4, 3, 2 і по 1';
  renderSetup();
  renderHome();
  showScreen('home');
  // повернення після перезавантаження сторінки посеред гри
  if (session && (!inviteCode || inviteCode === session.code)) {
    emit('join', { code: session.code, token: session.token, name: nameInput.value.trim() }).then((res) => {
      if (res.error) {
        store.del('path:session');
        session = null;
        renderHome();
      } else {
        inviteCode = null;
        history.replaceState(null, '', `?room=${res.code}`);
      }
    });
  }
})();
