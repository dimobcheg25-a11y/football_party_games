(() => {
  const $ = (sel) => document.querySelector(sel);
  const socket = io('/spy');

  // ── локальне сховище (може бути недоступне в приватному режимі)
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  const DIFFICULTY_HINTS = {
    easy: 'Топ-400 найвідоміших: зірки й основні гравці топ-клубів.',
    normal: 'Топ-800: відомі гравці топ-ліг і збірних (українців — трохи більше).',
    fan: 'Топ-1300: для тих, хто дивиться футбол щотижня.',
    hard: 'Топ-1900: включно з гравцями УПЛ 2000-х і середняками топ-ліг.',
    expert: 'Уся база — включно з тими, кого пам’ятають лише справжні фанати.',
  };
  const ERA_LABELS = { all: 'Усі гравці', modern: 'Сучасні', retired: 'Завершили кар’єру' };
  const DIFF_LABELS = { easy: '🟢 Легкий', normal: '🟡 Звичайний', fan: '🟣 Фанат', hard: '🔴 Складний', expert: '⚫ Експерт' };
  const SEAT_COLORS = ['#4fb3ff', '#ff6b8b', '#ffb547', '#a98bff', '#5fe0b5', '#ff8a4c', '#e0e86a', '#f08fe0', '#7fd4ff', '#c7a6ff'];

  const defaults = { era: 'all', difficulty: 'easy', circles: '2', target: '11' };
  let setup = { ...defaults };
  try { setup = { ...defaults, ...JSON.parse(store.get('spy:setup') || '{}') }; } catch { /* ignore */ }
  if (!ERA_LABELS[setup.era]) setup.era = 'all';
  if (!DIFF_LABELS[setup.difficulty]) setup.difficulty = 'easy';

  let session = null; // { code, token }
  try { session = JSON.parse(store.get('spy:session') || 'null'); } catch { /* ignore */ }
  let state = null;
  let mySeat = -1;
  let inviteCode = new URLSearchParams(location.search).get('room');
  let cardOpen = false;
  let stageKey = ''; // що зараз намальовано в #stage

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
  const points = (n) => `${n} ${plural(n, 'бал', 'бали', 'балів')}`;
  const seatName = (i) => (i === mySeat ? 'Ти' : state?.seats[i]?.name || 'Гравець');
  const seatStyle = (i) => `--pc:${SEAT_COLORS[i % SEAT_COLORS.length]}`;
  const roomLink = (code) => `${location.origin}${location.pathname}?room=${code}`;
  const emit = (event, data) => new Promise((res) => socket.emit(event, data, (r) => res(r || {})));
  const photoHtml = (p, cls) => `<span class="${cls}">${p.photo ? `<img src="${p.photo}" alt="" />` : `<span>${escapeHtml(initials(p.name))}</span>`}</span>`;

  async function act(event, data) {
    const res = await emit(event, data);
    if (res.error) toast(res.error, 'bad');
    return res;
  }

  function showScreen(name) {
    for (const s of ['home', 'lobby', 'game', 'final']) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
    const inRoom = name !== 'home' && state;
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
    store.set('spy:setup', JSON.stringify(setup));
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

  $('#create-btn').addEventListener('click', async () => {
    const name = requireName();
    if (!name) return;
    onEntered(await emit('create', { ...setup, circles: Number(setup.circles), target: Number(setup.target), name }));
  });

  $('#join-btn').addEventListener('click', async () => {
    const name = requireName();
    if (!name) return;
    const token = session?.code === inviteCode ? session.token : undefined;
    onEntered(await emit('join', { code: inviteCode, name, token }));
  });

  $('#resume-btn').addEventListener('click', async () => {
    const res = await emit('join', { code: session.code, token: session.token, name: nameInput.value.trim() });
    if (res.error) {
      store.del('spy:session');
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
    store.set('spy:session', JSON.stringify(session));
    inviteCode = null;
    history.replaceState(null, '', `?room=${res.code}`);
  }

  // Запрошення за посиланням: лише ім'я і «Приєднатися»; налаштування — від того, хто створив кімнату.
  async function renderHome() {
    const invite = !!inviteCode;
    $('#setup-options').classList.toggle('hidden', invite);
    $('#create-btn').classList.toggle('hidden', invite);
    $('#join-btn').classList.toggle('hidden', !invite);
    $('#invite-note').classList.add('hidden');
    $('#resume-btn').classList.toggle('hidden', invite || !session);
    if (session && !invite) $('#resume-btn').textContent = 'Повернутися до своєї гри';
    if (!invite) return;
    try {
      const info = await (await fetch(`/api/spy/room/${encodeURIComponent(inviteCode)}`)).json();
      const note = $('#invite-note');
      note.classList.remove('hidden');
      if (!info.found) {
        note.textContent = 'Цієї кімнати вже немає — створи свою гру.';
        inviteCode = null;
        history.replaceState(null, '', location.pathname);
        return renderHome();
      }
      note.innerHTML = `${escapeHtml(info.players[0] || 'Друг')} кличе грати!<br><small>${optionList(info.options).join(' · ')}</small>`;
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
    playSounds(prev, s);
    render();
  });

  function playSounds(p, s) {
    if (!p) return;
    const newMatch = s.match !== p.match || (s.status === 'playing' && p.status !== 'playing');
    if (newMatch) cardOpen = false;
    if (s.status === 'playing' && s.phase === 'clues' && newMatch) window.Sound.play('whistle');
    else if (s.active === mySeat && p.active !== mySeat) window.Sound.play('pop');
    if (s.phase === 'spyGuess' && p.phase !== 'spyGuess') window.Sound.play(s.gained?.[mySeat] > 0 ? 'win' : 'miss');
    if (s.phase === 'reveal' && p.phase !== 'reveal' && s.spyGuess?.correct) window.Sound.play(s.spy === mySeat ? 'win' : 'miss');
    if (p.card && s.card && p.card.id !== s.card.id) { cardOpen = false; toast('Футболіста замінили — відкрий картку', 'good'); }
  }

  function render() {
    if (!state) return showScreen('home');
    if (state.status !== 'playing') stageKey = '';
    if (state.status === 'waiting') return renderLobby();
    if (state.status === 'finished') return renderFinal();
    renderGame();
  }

  function optionList(o) {
    return [ERA_LABELS[o.era], DIFF_LABELS[o.difficulty], `${o.circles} ${plural(o.circles, 'коло', 'кола', 'кіл')}`, `до ${points(o.target)}`];
  }

  function renderLobby() {
    showScreen('lobby');
    $('#lobby-code').textContent = state.code;
    $('#lobby-options').innerHTML = optionList(state.options).map((t) => `<span>${escapeHtml(t)}</span>`).join('');
    $('#lobby-notice').classList.toggle('hidden', !state.notice);
    $('#lobby-notice').textContent = state.notice || '';
    $('#lobby-players').innerHTML = state.seats
      .map((s, i) => (s ? `<li style="${seatStyle(i)}"><span class="dot-p"></span>${escapeHtml(s.name)}${i === mySeat ? ' <small>(ти)</small>' : ''}${i === state.host ? ' <small>· створив гру</small>' : ''}${s.connected ? '' : ' <small class="muted">· офлайн</small>'}${state.scores[i] ? ` <small>· ${points(state.scores[i])}</small>` : ''}</li>` : ''))
      .join('');
    const isHost = mySeat === state.host;
    const count = state.seats.filter(Boolean).length;
    const enough = count >= state.minPlayers;
    $('#start-btn').classList.toggle('hidden', !isHost);
    $('#start-btn').disabled = !enough;
    $('#start-btn').textContent = enough ? `Почати гру (${count} ${plural(count, 'гравець', 'гравці', 'гравців')})` : `Потрібно щонайменше ${state.minPlayers} гравці`;
    $('#lobby-wait').textContent = isHost
      ? enough ? 'Можна починати — або дочекайтесь ще когось.' : `Надішли запрошення друзям: зараз ${count} з ${state.minPlayers}.`
      : `Чекаємо, поки ${state.seats[state.host]?.name || 'господар'} почне гру.`;
  }

  $('#copy-link').addEventListener('click', async () => {
    const link = roomLink(state.code);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Футбольний шпигун', url: link });
      else { await navigator.clipboard.writeText(link); toast('Посилання скопійовано', 'good'); }
    } catch { /* скасовано */ }
  });
  $('#start-btn').addEventListener('click', () => act('start'));

  // ── гра
  function renderGame() {
    showScreen('game');
    const s = state;
    const playing = s.players.includes(mySeat);
    const phaseText = { clues: `коло ${s.circle} з ${s.options.circles}`, vote: 'голосування', spyGuess: 'шпигун вгадує', reveal: 'підсумок матчу' }[s.phase];
    $('#round-info').innerHTML = `<b>Матч ${s.match}${s.tiebreak ? ' · додатковий' : ''}</b><span>${DIFF_LABELS[s.options.difficulty]} · ${phaseText} · до ${points(s.options.target)}</span>`;

    renderCard(playing);
    // етап перемальовуємо лише коли він змінився — щоб не збивати введення підказки чи відповіді
    const key = JSON.stringify([s.phase, s.match, playing, s.active, s.reroll, s.voted, s.nextVotes, s.spyGuess, s.card?.id,
      s.players.map((i) => s.seats[i]?.connected)]);
    const stage = $('#stage');
    if (key === stageKey) return finishGame();
    stageKey = key;
    if (!playing) stage.innerHTML = '<div class="stage-box"><p>Ти зайшов посеред матчу — граєш з наступного. Поки можна читати підказки 🙂</p></div>';
    else if (s.phase === 'clues') renderClueStage(stage);
    else if (s.phase === 'vote') renderVoteStage(stage);
    else if (s.phase === 'spyGuess') renderSpyGuessStage(stage);
    else if (s.phase === 'reveal') renderRevealStage(stage);
    finishGame();
  }

  function finishGame() {
    const s = state;
    renderClues();
    renderScoreboard();
    const isHost = mySeat === s.host;
    $('#host-tools').classList.toggle('hidden', !isHost || s.phase !== 'clues');
  }

  // Картка ролі: закрита за замовчуванням (щоб ніхто не підгледів), натиск — відкрити/закрити.
  function renderCard(playing) {
    const el = $('#role-card');
    el.classList.toggle('hidden', !playing);
    if (!playing) return;
    const spy = state.role === 'spy';
    el.className = `role-card ${cardOpen ? 'open' : ''} ${cardOpen && spy ? 'spy' : ''}`;
    if (!cardOpen) {
      el.innerHTML = '<span class="rc-closed">🂠</span><span class="rc-text"><b>Твоя картка</b><small>Натисни, щоб подивитись (так, щоб ніхто не бачив)</small></span>';
    } else if (spy) {
      el.innerHTML = '<span class="rc-icon">🕵️</span><span class="rc-text"><small>Твоя роль</small><b>Ти — шпигун</b><small>Слухай підказки, не видай себе й спробуй здогадатися, хто це</small></span>';
    } else {
      const c = state.card;
      el.innerHTML = `${photoHtml(c, 'answer-photo rc-photo')}<span class="rc-text"><small>Ти — агент. Футболіст:</small><b>${escapeHtml(c.uk || c.name)}</b>${c.uk && c.uk !== c.name ? `<small>${escapeHtml(c.name)}</small>` : ''}</span>`;
    }
  }
  $('#role-card').addEventListener('click', () => { cardOpen = !cardOpen; renderCard(true); });

  let clueDraft = '';
  function renderClueStage(stage) {
    const s = state;
    if (s.reroll) {
      const voted = s.reroll.voted.includes(mySeat);
      const who = s.reroll.by === mySeat ? 'Ти пропонуєш' : `${escapeHtml(seatName(s.reroll.by))} пропонує`;
      stage.innerHTML = `<div class="stage-box reroll">
        <p><b>${who} замінити футболіста.</b> Більшість «за» — буде новий, підказки почнуться спочатку.</p>
        <div class="row">${voted ? '<span class="hint">Твій голос враховано</span>' : '<button class="btn btn-primary" data-reroll="1">Так, замінити</button><button class="btn btn-secondary" data-reroll="0">Ні, граємо далі</button>'}</div>
        <p class="hint">За: ${s.reroll.yes} · Проти: ${s.reroll.no}</p></div>`;
      stage.querySelectorAll('[data-reroll]').forEach((b) => b.addEventListener('click', () => act('rerollVote', { yes: b.dataset.reroll === '1' })));
      return;
    }
    const mine = s.active === mySeat;
    const queue = s.order.map((i) => `<li style="${seatStyle(i)}" class="${i === s.active ? 'now' : ''} ${s.seats[i]?.connected ? '' : 'offline'}"><span class="dot-p"></span>${escapeHtml(seatName(i))}</li>`).join('');
    stage.innerHTML = `<div class="stage-box ${mine ? 'my-turn' : ''}">
      <ol class="turn-order">${queue}</ol>
      ${mine
        ? `<p><b>Твій хід!</b> Скажи підказку голосом або напиши її тут.</p>
           <form class="clue-form" id="clue-form">
             <input id="clue-input" maxlength="80" placeholder="Підказка про футболіста…" autocomplete="off" />
             <button class="btn btn-primary">Надіслати</button>
           </form>
           <button class="btn btn-secondary" id="voice-btn">🎙 Сказав голосом — далі</button>`
        : `<p>Хід: <b style="${seatStyle(s.active)}" class="pc">${escapeHtml(seatName(s.active))}</b> — слухай або читай підказку.</p>`}
      <button class="btn btn-ghost btn-sm" id="reroll-btn">Не знаю цього футболіста — замінити</button>
    </div>`;
    if (mine) {
      const input = $('#clue-input');
      input.value = clueDraft;
      input.addEventListener('input', () => (clueDraft = input.value));
      $('#clue-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!input.value.trim()) return toast('Напиши підказку або натисни «Сказав голосом»', 'bad');
        const res = await act('clue', { text: input.value });
        if (res.ok) clueDraft = '';
      });
      $('#voice-btn').addEventListener('click', () => act('clue', {}));
      if (!('ontouchstart' in window)) input.focus();
    }
    $('#reroll-btn').addEventListener('click', () => {
      if (confirm('Запропонувати замінити футболіста? Усі проголосують.')) act('requestReroll');
    });
  }

  function renderVoteStage(stage) {
    const s = state;
    const voted = s.voted.includes(mySeat);
    const candidates = s.players.filter((i) => i !== mySeat && s.seats[i]);
    const waiting = s.players.filter((i) => s.seats[i]?.connected && !s.voted.includes(i));
    stage.innerHTML = `<div class="stage-box">
      <p><b>Хто шпигун?</b> ${voted ? 'Твій голос прийнято.' : 'Обери гравця.'}</p>
      <div class="vote-grid">${candidates.map((i) => `<button class="vote-btn" style="${seatStyle(i)}" data-target="${i}" ${voted ? 'disabled' : ''}><span class="dot-p"></span>${escapeHtml(seatName(i))}</button>`).join('')}</div>
      <p class="hint">${waiting.length ? `Чекаємо: ${waiting.map((i) => escapeHtml(seatName(i))).join(', ')}` : ''}</p>
    </div>`;
    stage.querySelectorAll('[data-target]').forEach((b) => b.addEventListener('click', () => {
      if (confirm(`Голосуєш за: ${seatName(Number(b.dataset.target))}?`)) act('vote', { target: Number(b.dataset.target) });
    }));
  }

  // Результат голосування: скільки голосів у кого і хто за кого.
  function votesHtml() {
    const s = state;
    return `<ul class="vote-results">${s.players.filter((i) => s.seats[i]).sort((a, b) => (s.voteCounts[b] || 0) - (s.voteCounts[a] || 0)).map((i) => `
      <li style="${seatStyle(i)}" class="${i === s.spy ? 'spy' : ''}"><span class="dot-p"></span>
        <span class="nm">${escapeHtml(seatName(i))}${i === s.spy ? ' 🕵️' : ''}</span>
        <small>${s.votes[i] != null ? `→ ${escapeHtml(seatName(s.votes[i]))}` : 'не голосував'}</small>
        <b>${s.voteCounts[i] || 0} 🗳</b>
        <span class="gain">${s.gained?.[i] ? `+${s.gained[i]}` : '0'}</span></li>`).join('')}</ul>`;
  }

  function spyVerdict() {
    const s = state;
    const name = s.spy === mySeat ? 'Тебе' : escapeHtml(seatName(s.spy));
    return s.spyPoints === 0 ? `${name} викрили! Шпигун — 0 балів.` : s.spyPoints === 3 ? `${s.spy === mySeat ? 'Тебе' : 'Шпигуна'} майже ніхто не запідозрив: +3.` : `Шпигуна не викрили напевно: +2.`;
  }

  function renderSpyGuessStage(stage) {
    const s = state;
    const spy = s.spy === mySeat;
    stage.innerHTML = `<div class="stage-box">
      <p class="verdict">Шпигун — <b style="${seatStyle(s.spy)}" class="pc">${escapeHtml(seatName(s.spy))}</b>. ${spyVerdict()}</p>
      ${votesHtml()}
      ${spy
        ? `<p><b>Остання спроба:</b> назви футболіста — вгадаєш, ще +${s.spyGuessPoints}. Лише одна спроба.</p>
           <div class="search"><input id="guess-input" placeholder="Почни вводити прізвище…" autocomplete="off" /><ul class="suggestions" id="suggestions"></ul></div>
           <button class="btn btn-ghost btn-sm" id="pass-btn">Не знаю</button>`
        : `<p class="hint">Шпигун пробує вгадати футболіста…</p>`}
    </div>`;
    if (spy) {
      setupSearch();
      $('#pass-btn').addEventListener('click', () => act('spyGuess', {}));
    }
  }

  function renderRevealStage(stage) {
    const s = state;
    const f = s.footballer;
    const g = s.spyGuess || {};
    const guessText = g.skipped ? 'Шпигун не став вгадувати.'
      : g.correct ? `Шпигун вгадав: ${escapeHtml(g.player.uk || g.player.name)} — ще +${s.spyGuessPoints}! 🎯`
        : `Шпигун назвав: ${escapeHtml(g.player?.uk || g.player?.name || '?')} — мимо.`;
    const iVoted = s.nextVotes.includes(mySeat);
    const waiting = s.seats.map((x, i) => (x?.connected && !s.nextVotes.includes(i) ? i : -1)).filter((i) => i >= 0);
    const { top } = leaders();
    const last = top >= s.options.target;
    stage.innerHTML = `<div class="stage-box">
      <div class="answer-card">${photoHtml(f, 'answer-photo')}<div><small>Футболіст</small><h2>${escapeHtml(f.uk || f.name)}</h2>${f.uk && f.uk !== f.name ? `<small class="muted">${escapeHtml(f.name)}</small>` : ''}</div></div>
      <p class="verdict">Шпигун — <b style="${seatStyle(s.spy)}" class="pc">${escapeHtml(seatName(s.spy))}</b>. ${spyVerdict()} ${guessText}</p>
      ${votesHtml()}
      <div class="reveal-actions">
        <button id="next-btn" class="btn btn-primary btn-lg" ${iVoted ? 'disabled' : ''}>${last ? 'Далі' : 'Наступний матч →'}</button>
      </div>
      <p class="hint">${iVoted && waiting.length ? `Чекаємо: ${waiting.map((i) => escapeHtml(seatName(i))).join(', ')}` : ''}</p>
    </div>`;
    $('#next-btn').addEventListener('click', () => act('next'));
  }

  function leaders() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    const top = Math.max(0, ...seats.map((i) => s.scores[i]));
    return { top, seats: seats.filter((i) => s.scores[i] === top) };
  }

  function renderClues() {
    const s = state;
    const list = $('#clues');
    list.innerHTML = s.clues.length
      ? s.clues.map((c) => `<li style="${seatStyle(c.seat)}"><span class="dot-p"></span><span class="nm">${escapeHtml(seatName(c.seat))}</span>
          ${c.skipped ? '<i class="muted">хід пропущено</i>' : c.text ? `<span class="clue-text">${escapeHtml(c.text)}</span>` : '<i class="muted">🎙 сказав голосом</i>'}</li>`).join('')
      : '<li class="empty">Ще ніхто нічого не сказав.</li>';
    list.scrollTop = 1e6;
  }

  // Таблиця: бали + хто вже проголосував / чий хід.
  let shownScores = {};
  function renderScoreboard() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a] || a - b);
    const { top, seats: lead } = leaders();
    $('#scoreboard').innerHTML = seats.map((i) => {
      const place = seats.findIndex((j) => s.scores[j] === s.scores[i]) + 1;
      const status = !s.players.includes(i) ? '<span class="st">з наступного</span>'
        : s.phase === 'clues' && s.active === i ? '<span class="st thinking">хід</span>'
          : s.phase === 'vote' ? `<span class="st">${s.voted.includes(i) ? '✓' : '…'}</span>` : '';
      const crown = top > 0 && lead.length === 1 && lead[0] === i ? ' 👑' : '';
      const bump = shownScores[i] != null && s.scores[i] > shownScores[i] ? 'bump' : '';
      return `<li data-seat="${i}" style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'}">
        <span class="place">${place}</span><span class="dot-p"></span><span class="nm">${escapeHtml(seatName(i))}${crown}</span>${status}<b class="${bump}">${s.scores[i]}</b></li>`;
    }).join('');
    shownScores = Object.fromEntries(seats.map((i) => [i, s.scores[i]]));
  }

  $('#skip-btn').addEventListener('click', () => {
    if (confirm(`Пропустити хід гравця ${seatName(state.active)}?`)) act('skipTurn');
  });
  $('#force-vote-btn').addEventListener('click', () => {
    if (confirm('Перейти до голосування, не чекаючи всіх підказок?')) act('forceVote');
  });

  // ── шпигун вгадує: автодоповнення
  function setupSearch() {
    const input = $('#guess-input');
    const list = $('#suggestions');
    let suggestions = [];
    let active = 0;
    const draw = () => {
      if (!input.value.trim()) { list.innerHTML = ''; suggestions = []; return; }
      suggestions = window.Players.search(input.value);
      list.innerHTML = suggestions.length
        ? suggestions.map((p, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''}">
            <span class="s-avatar">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy" />` : escapeHtml(initials(p.name))}</span>
            <span class="s-text"><span class="s-main">${escapeHtml(p.uk || p.name)}</span><span class="s-sub">${escapeHtml(p.name)}${p.born ? ` · ${p.born}` : ''}</span></span></li>`).join('')
        : '<li class="empty">Нікого не знайдено</li>';
    };
    const choose = (p) => {
      if (!p || !confirm(`Твоя відповідь: ${p.uk || p.name}? Спроба лише одна.`)) return;
      act('spyGuess', { playerId: p.id });
    };
    input.addEventListener('input', () => { active = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, suggestions.length - 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && suggestions[active]) { choose(suggestions[active]); e.preventDefault(); }
    });
    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) choose(suggestions[Number(li.dataset.i)]);
    });
  }

  // ── підсумок турніру
  function renderFinal() {
    showScreen('final');
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    $('#final-title').textContent = s.winner === mySeat ? 'Ти переміг! 🏆' : `Переміг ${seatName(s.winner)} 🏆`;
    $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${i === s.winner ? 'win' : ''}">
      <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))} <small class="muted">· шпигуном ${s.stats[i].spy}, викрили ${s.stats[i].caught}</small></span><span class="val">${points(s.scores[i])}</span></li>`).join('');
    $('#final-history').innerHTML = s.history.map((h, k) => `<li><span class="nm">${k + 1}. ${escapeHtml(h.footballer.uk || h.footballer.name)}</span>
      <span class="val">🕵️ ${escapeHtml(h.spy === mySeat ? 'Ти' : h.spyName)} · ${h.spyPoints === 0 ? 'викрили' : `+${h.spyPoints}`}${h.guessed ? ' · вгадав 🎯' : ''}</span></li>`).join('');
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost);
    $('#again-wait').textContent = isHost ? '' : `${s.seats[s.host]?.name || 'Господар'} може почати новий турнір.`;
  }

  $('#again-btn').addEventListener('click', () => act('start'));

  // ── вихід
  document.querySelectorAll('[data-action="leave"]').forEach((b) => b.addEventListener('click', leave));
  async function leave() {
    if (state?.status === 'playing' && !confirm('Вийти з гри? Твої бали пропадуть.')) return;
    await emit('leave');
    state = null;
    session = null;
    store.del('spy:session');
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
        store.del('spy:session');
        session = null;
        renderHome();
      } else {
        inviteCode = null;
        history.replaceState(null, '', `?room=${res.code}`);
      }
    });
  }
})();
