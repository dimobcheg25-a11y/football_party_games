(() => {
  const $ = (sel) => document.querySelector(sel);
  const socket = io('/guess');

  // ── локальне сховище (може бути недоступне в приватному режимі)
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  const DIFFICULTY_HINTS = {
    easy: 'Лише зірки — володарі великих трофеїв, лідери збірних, роки у великих клубах.',
    normal: 'Відомі гравці топ-клубів і збірних (українців — трохи більше).',
    fan: 'Для тих, хто дивиться футбол щотижня: міцні гравці топ-ліг і збірних.',
    hard: 'Майже всі, включно з гравцями УПЛ 2000-х і середняками топ-ліг.',
    expert: 'Уся база — включно з тими, кого пам’ятають лише справжні фанати.',
  };
  const ERA_LABELS = { all: 'Усі гравці', modern: 'Сучасні', retired: 'Завершили кар’єру' };
  const DIFF_LABELS = { easy: '🟢 Легкий', normal: '🟡 Звичайний', fan: '🟣 Фанат', hard: '🔴 Складний', expert: '⚫ Експерт' };
  const SEAT_COLORS = ['#4fb3ff', '#ff6b8b', '#ffb547', '#a98bff', '#5fe0b5', '#ff8a4c', '#e0e86a', '#f08fe0'];
  const ARROWS = { up: '↑', down: '↓' };
  const EMOJI = { green: '🟩', yellow: '🟨', grey: '⬜' };

  const defaults = { era: 'all', difficulty: 'normal', attempts: '8', rounds: '5', turnSeconds: '120' };
  let setup = { ...defaults };
  try { setup = { ...defaults, ...JSON.parse(store.get('guess:setup') || '{}') }; } catch { /* ignore */ }
  if (!ERA_LABELS[setup.era]) setup.era = 'all';
  if (!DIFF_LABELS[setup.difficulty]) setup.difficulty = 'normal';

  let session = null; // { code, token }
  try { session = JSON.parse(store.get('guess:session') || 'null'); } catch { /* ignore */ }
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
    $('#difficulty-hint').textContent = DIFFICULTY_HINTS[setup.difficulty];
    $('#points-rule').textContent = `з першої спроби — 100, далі рівномірно менше — до 10 за останню (${setup.attempts})`;
    store.set('guess:setup', JSON.stringify(setup));
  }

  document.querySelectorAll('[data-opt] .chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      setup[chip.parentElement.dataset.opt] = chip.dataset.val;
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
    return { ...setup, rounds: Number(setup.rounds), attempts: Number(setup.attempts), turnSeconds: Number(setup.turnSeconds) };
  }

  async function create(solo) {
    const name = requireName();
    if (!name) return;
    onEntered(await emit('create', { ...options(), solo, name }));
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
      store.del('guess:session');
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
    store.set('guess:session', JSON.stringify(session));
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
      const info = await (await fetch(`/api/guess/room/${encodeURIComponent(inviteCode)}`)).json();
      const note = $('#invite-note');
      note.classList.remove('hidden');
      if (!info.found) {
        note.textContent = 'Цієї кімнати вже немає — створи свою гру.';
        inviteCode = null;
        history.replaceState(null, '', location.pathname);
        return renderHome();
      }
      const o = info.options;
      note.innerHTML = `${escapeHtml(info.players[0] || 'Друг')} кличе грати!<br><small>${ERA_LABELS[o.era]} · ${DIFF_LABELS[o.difficulty]} · ${o.rounds} ${plural(o.rounds, 'раунд', 'раунди', 'раундів')}</small>`;
    } catch { /* мережа — просто без опису */ }
  }

  // ── стан кімнати
  socket.on('connect', () => {
    if (state && session) emit('join', { code: session.code, token: session.token });
  });

  socket.on('state', (s) => {
    const prev = state;
    state = s;
    mySeat = s.you;
    clockOffset = s.serverNow - Date.now();
    playSounds(prev, s);
    render();
  });

  function playSounds(p, s) {
    if (!p) return;
    const was = p.progress[mySeat]?.solved, now = s.progress[mySeat]?.solved;
    if (now && !was) window.Sound.play('win');
    if (s.phase === 'guess' && (p.phase !== 'guess' || p.round !== s.round)) window.Sound.play('whistle');
  }

  function render() {
    if (!state) return showScreen('home');
    if (state.status === 'waiting') return renderLobby();
    if (state.status === 'finished') return renderFinal();
    renderGame();
  }

  function optionChips(o) {
    return [ERA_LABELS[o.era], DIFF_LABELS[o.difficulty], `${o.attempts} спроб`, `${o.rounds} ${plural(o.rounds, 'раунд', 'раунди', 'раундів')}`,
      o.turnSeconds ? `${o.turnSeconds / 60} хв на раунд` : 'без таймера']
      .map((t) => `<span>${escapeHtml(t)}</span>`).join('');
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
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Вгадай гравця', url: link });
      else { await navigator.clipboard.writeText(link); toast('Посилання скопійовано', 'good'); }
    } catch { /* скасовано */ }
  });
  $('#start-btn').addEventListener('click', async () => {
    const res = await emit('start');
    if (res.error) toast(res.error, 'bad');
  });

  // ── гра
  // Клітинка: значення + пояснення словами (note). Клуби й трофеї — списком (переносяться, не вилазять за рамку).
  function cellHtml(c, label) {
    const img = c.img ? `<img src="${c.img}" alt="" loading="lazy" />` : '';
    const arrow = c.arrow ? `<span class="arrow">${ARROWS[c.arrow]}</span>` : '';
    let body = `<b>${escapeHtml(c.text)}</b>`;
    if (c.clubs?.length) {
      body = `<span class="list">${c.clubs.map((x) => `<span class="item" title="${escapeHtml(x.name)}${x.together ? ' — грали разом' : ''}">${x.img ? `<img src="${x.img}" alt="" loading="lazy" />` : ''}${x.together ? '🤝 ' : ''}${escapeHtml(x.name)}</span>`).join('')}</span>`;
    } else if (c.items?.length) {
      body = `<span class="list">${c.items.map((x) => `<span class="item ${x.match ? 'match' : ''}">${x.match ? '✓ ' : ''}${escapeHtml(x.label)}</span>`).join('')}</span>`;
    }
    return `<div class="cell ${c.color} c-${c.id}">
      <span class="lbl">${escapeHtml(label)}</span>${img}${body}${arrow}${c.note ? `<small>${escapeHtml(c.note)}</small>` : ''}</div>`;
  }

  function rowHtml(player, cells, extraClass = '') {
    const labels = Object.fromEntries(state.columns.map((c) => [c.id, c.label]));
    return `<div class="g-row ${extraClass}">
      <div class="g-player">
        <span class="g-photo">${player.photo ? `<img src="${player.photo}" alt="" loading="lazy" />` : escapeHtml(initials(player.name))}</span>
        <span class="g-name">${escapeHtml(player.uk || player.name)}</span>
      </div>
      ${cells.map((c) => cellHtml(c, labels[c.id])).join('')}
    </div>`;
  }

  function renderGame() {
    showScreen('game');
    const s = state;
    const reveal = s.phase === 'reveal';
    const mine = s.progress[mySeat] || { colors: [], solved: null, done: false };
    const used = s.myTries.length;
    $('#round-info').innerHTML = `<b>Раунд ${s.round} з ${s.rounds}</b><span>${reveal ? 'відповідь' : `спроба ${Math.min(used + 1, s.options.attempts)} з ${s.options.attempts}`}</span>`;

    // поле відповіді
    $('#answer-box').classList.toggle('hidden', reveal);
    const input = $('#guess-input');
    input.disabled = mine.done;
    $('#giveup-btn').disabled = mine.done;
    if (input.disabled) { input.value = ''; renderSuggestions(); }
    $('#earn').innerHTML = s.potential == null ? '' : `Вгадаєш зараз — <b>+${s.potential}</b> ${plural(s.potential, 'очко', 'очки', 'очок')}` +
      `<small class="next">залишилось ${s.options.attempts - used} ${plural(s.options.attempts - used, 'спроба', 'спроби', 'спроб')}</small>`;
    $('#answer-hint').textContent = mine.solved
      ? `✓ Вгадав з ${mine.solved.attempts}-ї спроби: +${mine.solved.points}. Чекаємо інших…`
      : mine.done ? 'Спроби закінчились — чекаємо інших…' : '';

    // таблиця спроб: заголовки колонок (на широкому екрані) + рядки, нові — зверху
    const head = `<div class="g-row g-head"><div class="g-player"></div>${s.columns.map((c) => `<div class="cell-h">${escapeHtml(c.label)}</div>`).join('')}</div>`;
    const rows = [...s.myTries].reverse().map((t, i) => rowHtml(t.player, t.cells, `${t.correct ? 'win' : ''} ${i === 0 ? 'fresh' : ''}`)).join('');
    $('#board').innerHTML = s.myTries.length || reveal ? head + rows : '<p class="board-empty">Назви першого футболіста — і побачиш, у чому він схожий на загаданого.</p>';

    // відповідь після раунду
    const rv = $('#reveal');
    rv.classList.toggle('hidden', !reveal);
    if (reveal && s.answer) {
      const a = s.answer;
      const results = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
        .map((i) => { const r = s.progress[i]?.solved; return `<li style="${seatStyle(i)}"><span class="dot-p"></span>${escapeHtml(seatName(i))}<b>${r ? `+${r.points} · ${r.attempts}-а спроба` : 'не вгадав'}</b></li>`; }).join('');
      const iVoted = s.nextVotes.includes(mySeat);
      rv.innerHTML = `<div class="answer-card">
          <div class="answer-photo">${a.photo ? `<img src="${a.photo}" alt="" />` : `<span>${escapeHtml(initials(a.name))}</span>`}</div>
          <div><small>Це був</small><h2>${escapeHtml(a.uk || a.name)}</h2>${a.uk && a.uk !== a.name ? `<small class="muted">${escapeHtml(a.name)}</small>` : ''}</div>
        </div>
        <div class="board answer-board">${rowHtml(a, a.cells, 'win')}</div>
        ${s.solo ? '' : `<ul class="round-results">${results}</ul>`}
        <div class="reveal-actions">
          <button id="share-btn" class="btn btn-secondary">Поділитися</button>
          <button id="next-btn" class="btn btn-primary btn-lg" ${iVoted ? 'disabled' : ''}>${s.round >= s.rounds ? 'Підсумки' : 'Наступний гравець →'}</button>
        </div>`;
      $('#next-btn').addEventListener('click', () => emit('next'));
      $('#share-btn').addEventListener('click', share);
    }

    $('#reactions').classList.toggle('hidden', s.solo);
    renderScoreboard();
    tick();
  }

  // Результат раунду смайликами, як у Wordle.
  async function share() {
    const mine = state.progress[mySeat];
    const text = `Вгадай гравця ⚽ ${mine.solved ? `${mine.solved.attempts}/${state.options.attempts}` : `X/${state.options.attempts}`}\n` +
      mine.colors.map((row) => row.map((c) => EMOJI[c]).join('')).join('\n') + `\n${location.origin}/guess/`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Результат скопійовано', 'good'); }
    } catch { /* скасовано */ }
  }

  // Турнірна таблиця: очки + кольори чужих спроб (лише кольори — без імен).
  let shownScores = {};
  function renderScoreboard() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
      .sort((a, b) => s.scores[b] - s.scores[a] || a - b);
    const top = s.scores[seats[0]];
    const leaders = seats.filter((i) => s.scores[i] === top);
    $('#table-title').textContent = s.solo ? 'Твій рахунок' : 'Таблиця';
    $('#scoreboard').innerHTML = seats.map((i) => {
      const place = seats.findIndex((j) => s.scores[j] === s.scores[i]) + 1;
      const pr = s.progress[i] || { colors: [], solved: null, done: false };
      const status = pr.solved
        ? `<span class="gain">+${pr.solved.points}</span>`
        : s.phase === 'guess' ? (pr.done ? '<span class="st">✗</span>' : `<span class="st thinking">${pr.colors.length}/${s.options.attempts}</span>`) : '';
      const crown = !s.solo && top > 0 && leaders.length === 1 && leaders[0] === i ? ' 👑' : '';
      const bump = shownScores[i] != null && s.scores[i] > shownScores[i] ? 'bump' : '';
      const mini = !s.solo && i !== mySeat && pr.colors.length
        ? `<span class="mini">${pr.colors.slice(-3).map((row) => `<span>${row.map((c) => `<i class="${c}"></i>`).join('')}</span>`).join('')}</span>`
        : '';
      return `<li data-seat="${i}" style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'}">
        <div class="sb-line">${s.solo ? '' : `<span class="place">${place}</span>`}<span class="dot-p"></span>
        <span class="nm">${escapeHtml(seatName(i))}${crown}</span>${status}<b class="${bump}">${s.scores[i]}</b></div>${mini}</li>`;
    }).join('');
    shownScores = Object.fromEntries(seats.map((i) => [i, s.scores[i]]));
  }

  // ── таймер раунду
  function tick() {
    const el = $('#timer');
    if (!state || state.status !== 'playing' || !state.deadline) { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((state.deadline - (Date.now() + clockOffset)) / 1000));
    const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    el.textContent = state.phase === 'reveal' ? `далі через ${left} с` : `⏱ ${mmss}`;
    el.classList.toggle('low', state.phase === 'guess' && left <= 15);
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
    const used = new Set((state?.myTries || []).map((t) => t.player.id));
    list.innerHTML = suggestions.length
      ? suggestions.map((p, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''} ${used.has(p.id) ? 'used' : ''}">
          <span class="s-avatar">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy" />` : escapeHtml(initials(p.name))}</span>
          <span class="s-text"><span class="s-main">${escapeHtml(p.uk || p.name)}</span><span class="s-sub">${escapeHtml(p.name)}${p.born ? ` · ${p.born}` : ''}</span></span>
          ${used.has(p.id) ? '<span class="s-flag">уже був</span>' : ''}</li>`).join('')
      : '<li class="empty">Нікого не знайдено</li>';
  }

  input.addEventListener('input', () => { active = 0; renderSuggestions(); });
  input.addEventListener('focus', () => setTimeout(() => input.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250));
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
    if (!res.correct) window.Sound.play('miss');
    input.focus();
  }

  $('#giveup-btn').addEventListener('click', () => {
    if (confirm('Здатися в цьому раунді? Очок за нього не буде.')) emit('giveUp');
  });

  // ── підсумок
  function renderFinal() {
    showScreen('final');
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    const max = s.rounds * s.maxPoints;
    if (s.solo) {
      $('#final-title').textContent = `${s.scores[mySeat]} з ${max} очок`;
      const key = `guess:best:${s.options.era}:${s.options.difficulty}:${s.options.attempts}:${s.rounds}`;
      const best = Number(store.get(key)) || 0;
      if (s.scores[mySeat] > best) store.set(key, s.scores[mySeat]);
      $('#final-standings').innerHTML = `<li><span class="nm">Рекорд (${ERA_LABELS[s.options.era]}, ${DIFF_LABELS[s.options.difficulty]}, ${s.rounds})</span><span class="val">${Math.max(best, s.scores[mySeat])}${s.scores[mySeat] > best && best ? ' — новий!' : ''}</span></li>`;
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
    store.del('guess:session');
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
    const li = $(`#scoreboard li[data-seat="${seat}"]`);
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
  renderSetup();
  renderHome();
  showScreen('home');
  if (session && (!inviteCode || inviteCode === session.code)) {
    emit('join', { code: session.code, token: session.token, name: nameInput.value.trim() }).then((res) => {
      if (res.error) {
        store.del('guess:session');
        session = null;
        renderHome();
      } else {
        inviteCode = null;
        history.replaceState(null, '', `?room=${res.code}`);
      }
    });
  }
})();
