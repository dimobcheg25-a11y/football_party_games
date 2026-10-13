(() => {
  const $ = (sel) => document.querySelector(sel);
  const socket = io();

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
  let players = [];
  let usedIds = new Set();
  let selectedTimer = Number(store.get('g9:timer') ?? 20);
  const MODE_LABEL = { easy: '🟢 Легкий', normal: '🟡 Звичайний', hard: '🔴 Складний' };
  let selectedMode = MODE_LABEL[store.get('g9:mode')] ? store.get('g9:mode') : 'normal';
  let lastEventKey = null;
  let resultDismissed = false;

  // ── пошук: нормалізація як на сервері
  function normalize(s) {
    return s
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/ё/g, 'е').replace(/ґ/g, 'г')
      .replace(/[’'`ʼ]/g, '')
      .replace(/[^a-zа-яіїєø0-9]+/g, ' ')
      .trim();
  }

  fetch('/api/players')
    .then((r) => r.json())
    .then((list) => {
      players = list.map((p, rank) => {
        const variants = [p.uk, p.ru, p.name, ...p.aliases].map(normalize);
        return { ...p, rank, variants, tokens: variants.flatMap((v) => v.split(' ')) };
      });
    });

  function search(query) {
    const q = normalize(query);
    if (!q) return [];
    const parts = q.split(' ');
    const scored = [];
    for (const p of players) {
      // кожне слово запиту має бути початком якогось слова в імені
      if (!parts.every((part) => p.tokens.some((t) => t.startsWith(part)))) continue;
      let score = 0;
      if (p.variants.some((v) => v === q)) score += 100;
      if (p.variants.some((v) => v.startsWith(q))) score += 20;
      // збіг з прізвищем (останнє слово) — вище
      if (p.variants.some((v) => v.split(' ').pop().startsWith(parts[parts.length - 1]))) score += 10;
      scored.push({ p, score });
    }
    // база відсортована за відомістю — серед рівних вище відоміші
    scored.sort((a, b) => b.score - a.score || a.p.rank - b.p.rank);
    return scored.slice(0, 8).map((s) => s.p);
  }

  // ── екрани
  function showScreen(name) {
    for (const id of ['home', 'lobby', 'game']) $(`#screen-${id}`).classList.toggle('hidden', id !== name);
  }

  function roomLink(code) {
    return `${location.origin}${location.pathname}?room=${code}`;
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
      toast('Посилання скопійовано ✓', 'good');
    } catch {
      prompt('Скопіюй посилання:', text);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function initials(name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase();
  }

  const opponentName = () => state?.seats[1 - mySeat]?.name || 'Суперник';

  // ── головний екран
  const nameInput = $('#name-input');
  nameInput.value = store.get('g9:name') || '';

  function renderTimerChips() {
    document.querySelectorAll('#timer-chips .chip').forEach((chip) => {
      const active = Number(chip.dataset.sec) === selectedTimer;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-checked', active);
    });
  }
  renderTimerChips();

  function renderModeChips() {
    document.querySelectorAll('#mode-chips .mode').forEach((el) => {
      const active = el.dataset.mode === selectedMode;
      el.classList.toggle('active', active);
      el.setAttribute('aria-checked', active);
    });
  }
  renderModeChips();
  $('#mode-chips').addEventListener('click', (e) => {
    const el = e.target.closest('.mode');
    if (!el) return;
    selectedMode = el.dataset.mode;
    store.set('g9:mode', selectedMode);
    renderModeChips();
  });

  $('#timer-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    selectedTimer = Number(chip.dataset.sec);
    store.set('g9:timer', selectedTimer);
    renderTimerChips();
  });

  // «Продовжити гру» — якщо закрив вкладку посеред гри
  function renderResume() {
    const last = store.get('g9:last-room');
    const btn = $('#resume-btn');
    btn.classList.toggle('hidden', !last || !!session.code);
    if (last) btn.textContent = `↩ Повернутися до гри ${last}`;
  }
  renderResume();
  $('#resume-btn').addEventListener('click', () => joinRoom(store.get('g9:last-room')));

  function requireName() {
    const name = nameInput.value.trim();
    if (!name) {
      $('#home-error').textContent = "Введи своє ім'я";
      nameInput.focus();
      return null;
    }
    store.set('g9:name', name);
    return name;
  }

  $('#create-btn').addEventListener('click', () => {
    const name = requireName();
    if (!name) return;
    socket.emit('create', { name, turnSeconds: selectedTimer, mode: selectedMode }, onEntered);
  });

  function joinRoom(code) {
    const name = requireName();
    if (!name) return;
    code = (code || '').toUpperCase().trim();
    if (!code) {
      $('#home-error').textContent = 'Введи код кімнати';
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
      $('#home-error').textContent = res?.error || 'Помилка з’єднання';
      goHome();
      return;
    }
    $('#home-error').textContent = '';
    Object.assign(session, { code: res.code, token: res.token });
    store.set(`g9:token:${res.code}`, res.token);
    store.set('g9:last-room', res.code);
    history.replaceState(null, '', `?room=${res.code}`);
  }

  function goHome() {
    session.code = null;
    session.token = null;
    state = null;
    mySeat = null;
    resultDismissed = false;
    closePicker();
    $('#result').classList.add('hidden');
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

  // ── звуки на зміни стану
  function playStateSounds(prev, s) {
    const wasPlaying = prev?.status === 'playing';
    if (s.status === 'playing' && !wasPlaying) {
      Sound.play('whistle'); // початок гри / реванш
      return;
    }
    if (s.status === 'finished' && prev?.status !== 'finished') {
      Sound.play(s.winner === 'draw' ? 'draw' : s.winner === s.you ? 'win' : 'lose');
      return;
    }
    if (s.status === 'playing' && s.turn === s.you && prev?.turn !== s.you) {
      // невелика пауза, щоб «дзинь» не накладався на звук влучання/помилки суперника
      setTimeout(() => Sound.play('myTurn'), 450);
    }
    if (s.status === 'playing' && s.drawOffer === 1 - s.you && prev?.drawOffer !== 1 - s.you) Sound.play('pop');
    if (s.status === 'finished' && s.rematchVotes.includes(1 - s.you) && !prev?.rematchVotes.includes(1 - s.you)) Sound.play('pop');
  }

  function render() {
    if (!state) return;
    if (state.status === 'waiting') {
      renderLobby();
      return;
    }
    showScreen('game');
    $('#game-code').textContent = state.code;
    $('#mode-badge').textContent = MODE_LABEL[state.mode];
    $('#mode-badge').className = `mode-badge ${state.mode}`;
    renderPlayers();
    renderBoard();
    renderActions();
    renderEvent();
    renderBanner();
    renderResult();
    tick();
  }

  function renderLobby() {
    closePicker();
    $('#result').classList.add('hidden');
    showScreen('lobby');
    $('#lobby-code').textContent = state.code;
    $('#share-link').value = roomLink(state.code);
    const timerText = state.turnSeconds ? `час на хід ${state.turnSeconds} с` : 'час на хід без обмеження';
    $('#lobby-timer').textContent = `Режим ${MODE_LABEL[state.mode]} · ${timerText}`;
    if (state.notice?.type === 'left') {
      $('#lobby-title').textContent = `${state.notice.name || 'Суперник'} вийшов з гри`;
      $('#lobby-sub').textContent = 'Кімната лишилась за тобою. Надішли посилання іншому другу — або скасуй кімнату.';
    } else {
      $('#lobby-title').textContent = 'Кімната створена';
      $('#lobby-sub').textContent = 'Надішли посилання другу — гра почнеться, щойно він зайде.';
    }
  }

  function renderPlayers() {
    [0, 1].forEach((seat) => {
      const el = $(`#seat-${seat}`);
      const info = state.seats[seat];
      const me = seat === mySeat;
      el.querySelector('.pname').textContent = (info?.name || '—') + (me ? ' (ти)' : '');
      const status = el.querySelector('.pstatus');
      status.textContent = info?.connected ? 'онлайн' : 'офлайн';
      status.classList.toggle('off', !info?.connected);
      el.querySelector('.pscore').textContent = state.scores[seat];
      el.classList.toggle('active', state.status === 'playing' && state.turn === seat);
    });
    const label = $('#turn-label');
    if (state.status === 'playing') {
      const mine = state.turn === mySeat;
      label.textContent = mine ? 'Твій хід' : `Хід: ${state.seats[state.turn]?.name || 'суперник'}`;
      label.classList.toggle('mine', mine);
    } else {
      label.textContent = 'Гру завершено';
      label.classList.remove('mine');
    }
  }

  function categoryHtml(cat) {
    const typeLabel = { club: 'клуб', nation: 'збірна', award: 'трофей', stat: 'рекорд', position: 'позиція' }[cat.type];
    let crest;
    if (cat.img) {
      crest = `<div class="crest img ${cat.type}"><img src="${escapeHtml(cat.img)}" alt="" loading="lazy"></div>`;
    } else {
      const [c1, c2] = cat.colors;
      const bg = cat.type === 'nation'
        ? `linear-gradient(180deg, ${c1} 0 50%, ${c2} 50% 100%)`
        : `linear-gradient(135deg, ${c1} 0 50%, ${c2} 50% 100%)`;
      crest = `<div class="crest ${cat.type}" style="background:${bg}">${cat.icon || ''}</div>`;
    }
    return `<div class="cat cat-${cat.type}">
      ${crest}
      <div class="cat-label">${escapeHtml(cat.label)}</div>
      <div class="cat-type">${typeLabel}</div>
    </div>`;
  }

  function playerVisual(player) {
    const fallback = `<div class="avatar">${escapeHtml(initials(player.uk))}</div>`;
    if (!player.photo) return fallback;
    return `${fallback}<img class="photo" src="${escapeHtml(player.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
  }

  function renderBoard() {
    const { grid, board } = state;
    const myTurn = state.status === 'playing' && state.turn === mySeat;
    let html = `<div class="corner">✕ ◯</div>`;
    html += grid.cols.map(categoryHtml).join('');
    for (let r = 0; r < 3; r++) {
      html += categoryHtml(grid.rows[r]);
      for (let c = 0; c < 3; c++) {
        const i = r * 3 + c;
        const b = board[i];
        if (b) {
          const win = state.winLine?.includes(i) ? ' win' : '';
          html += `<div class="cell filled seat-${b.seat}${win}" data-cell="${i}" title="${escapeHtml(b.player.uk)}">
            ${playerVisual(b.player)}
            <div class="seat-badge">${b.seat === 0 ? '✕' : '◯'}</div>
            <div class="pname-tag">${escapeHtml(b.player.uk)}</div>
          </div>`;
        } else if (state.status === 'finished' && state.reveal?.[i]) {
          const names = state.reveal[i].map((p) => escapeHtml(p.uk)).join('<br>');
          html += `<div class="cell"><div class="reveal"><b>Можна було</b>${names || 'нікого не лишилось'}</div></div>`;
        } else {
          const n = grid.answerCounts[i];
          // у складному режимі кількість варіантів не показуємо
          const count = state.mode === 'hard' ? '' : `<span class="count">${n} ${plural(n, 'варіант', 'варіанти', 'варіантів')}</span>`;
          html += `<button class="cell ${myTurn ? 'playable' : ''}" data-cell="${i}" ${myTurn ? '' : 'disabled'} aria-label="Клітинка ${i + 1}">
            <span class="plus">+</span>
            ${count}
          </button>`;
        }
      }
    }
    $('#board').innerHTML = html;
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function renderActions() {
    const playing = state.status === 'playing';
    const myTurn = playing && state.turn === mySeat;
    document.querySelector('[data-action="skip"]').disabled = !myTurn;
    document.querySelector('[data-action="surrender"]').disabled = !playing;
    const drawBtn = $('#draw-btn');
    const iOffered = state.drawOffer === mySeat;
    drawBtn.disabled = !playing || iOffered;
    drawBtn.textContent = iOffered ? 'Нічию запропоновано…' : 'Запропонувати нічию';
    $('#reactions').classList.toggle('hidden', !state.seats.every(Boolean));
    if (!myTurn) closePicker();
  }

  // Банер над полем: пропозиція нічиєї, суперник офлайн, гра завершена.
  function renderBanner() {
    const el = $('#banner');
    const opp = state.seats[1 - mySeat];
    let html = '';
    if (state.status === 'playing' && state.drawOffer === 1 - mySeat) {
      html = `<span>🤝 <b>${escapeHtml(opponentName())}</b> пропонує нічию</span>
        <span class="banner-actions">
          <button class="btn btn-primary" data-action="draw">Прийняти</button>
          <button class="btn btn-secondary" data-action="decline-draw">Відхилити</button>
        </span>`;
    } else if (state.status === 'playing' && opp && !opp.connected) {
      const waited = Date.now() + clockOffset - (opp.offlineSince || Date.now());
      const left = Math.ceil((state.claimWinAfterMs - waited) / 1000);
      html = left > 0
        ? `<span>📡 <b>${escapeHtml(opponentName())}</b> втратив з'єднання. Чекаємо… ${left} с</span>`
        : `<span>📡 <b>${escapeHtml(opponentName())}</b> не повертається</span>
           <span class="banner-actions"><button class="btn btn-primary" data-action="claim-win">Забрати перемогу</button></span>`;
    } else if (state.status === 'finished' && resultDismissed) {
      html = `<span>Гру завершено · рахунок ${state.scores[0]} : ${state.scores[1]}</span>
        <span class="banner-actions">
          <button class="btn btn-primary" data-action="show-result">Реванш / вихід</button>
        </span>`;
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
    const who = mine ? 'Ти' : state.seats[ev.seat]?.name || 'Суперник';
    if (ev.type === 'miss') {
      const why = ev.failed?.length ? ` — не «${ev.failed.join('» і не «')}»` : ' не підходить';
      toast(`✗ ${who}: ${ev.player.uk}${why}`, 'bad', 4500);
      Sound.play('miss');
      document.querySelector(`[data-cell="${ev.cell}"]`)?.classList.add('flash-miss');
    } else if (ev.type === 'timeout') {
      toast(`⏱ ${who}: час вийшов — хід переходить`, 'bad');
      Sound.play('miss');
    } else if (ev.type === 'skip') {
      toast(`${who}: пропуск ходу`);
    } else if (ev.type === 'hit' && state.status === 'playing') {
      Sound.play('hit');
      if (!mine) toast(`✓ ${who}: ${ev.player.uk}`, 'good');
    } else if (ev.type === 'drawDeclined' && !mine) {
      toast(`${who} відхилив нічию — граємо далі`);
    }
  }

  function renderResult() {
    const el = $('#result');
    if (state.status !== 'finished') {
      el.classList.add('hidden');
      resultDismissed = false;
      return;
    }
    const iWon = state.winner === mySeat;
    const draw = state.winner === 'draw';
    const reasons = {
      line: draw ? '' : iWon ? 'Три в ряд!' : 'Суперник зібрав три в ряд.',
      surrender: iWon ? 'Суперник здався.' : 'Ти здався.',
      abandoned: iWon ? 'Суперник не повернувся.' : 'Ти надовго зник — перемогу віддано супернику.',
      agreed: 'Нічия за згодою.',
      full: 'Поле заповнене.',
      stuck: 'Більше нема кого ставити у вільні клітинки.',
    };
    $('#result-emoji').textContent = draw ? '🤝' : iWon ? '🏆' : '😔';
    $('#result-title').textContent = draw ? 'Нічия' : iWon ? 'Перемога!' : 'Поразка';
    $('#result-sub').textContent = `${reasons[state.endReason] || ''} Рахунок ${state.scores[0]} : ${state.scores[1]}`;

    const voted = state.rematchVotes.includes(mySeat);
    const opponentVoted = state.rematchVotes.includes(1 - mySeat);
    const note = $('#result-rematch');
    note.classList.toggle('hidden', !opponentVoted && !voted);
    note.textContent = opponentVoted
      ? `🔁 ${opponentName()} хоче реванш`
      : `Чекаємо, що відповість ${opponentName()}…`;
    const btn = $('#rematch-btn');
    btn.disabled = voted;
    btn.textContent = voted ? 'Чекаємо суперника…' : opponentVoted ? 'Прийняти реванш' : 'Реванш';
    el.classList.toggle('hidden', resultDismissed);
    closePicker();
  }

  // ── таймер (і відлік у банері «суперник офлайн»)
  function tick() {
    const timer = $('#timer');
    if (state && state.status === 'playing' && state.seats.some((s) => s && !s.connected)) renderBanner();
    if (!state || state.status !== 'playing' || !state.deadline) {
      timer.classList.remove('low');
      $('#timer-bar').style.width = '0%';
      $('#timer-text').textContent = state?.status === 'playing' ? '∞' : '';
      return;
    }
    const left = Math.max(0, state.deadline - (Date.now() + clockOffset));
    const total = state.turnSeconds * 1000;
    $('#timer-bar').style.width = `${(left / total) * 100}%`;
    $('#timer-text').textContent = `${Math.ceil(left / 1000)} с`;
    timer.classList.toggle('low', left < 5000);
    const sec = Math.ceil(left / 1000);
    if (state.turn === mySeat && sec <= 5 && sec > 0 && sec !== tick.lastSec) Sound.play('tick');
    tick.lastSec = sec;
  }
  setInterval(tick, 250);

  // ── реакції
  $('#reactions').addEventListener('click', (e) => {
    const emoji = e.target.closest('[data-emoji]')?.dataset.emoji;
    if (emoji) socket.emit('react', emoji);
  });
  socket.on('reaction', ({ seat, emoji }) => {
    const card = $(`#seat-${seat}`);
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
    pickerCell = cell;
    const row = state.grid.rows[Math.floor(cell / 3)];
    const col = state.grid.cols[cell % 3];
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
    if (!currentSuggestions.length) {
      ul.innerHTML = '<li class="empty">Нікого не знайдено</li>';
      return;
    }
    ul.innerHTML = currentSuggestions
      .map((p, i) => {
        const used = usedIds.has(p.id);
        const sub = [p.name, p.born && `${p.born} р.н.`].filter(Boolean).join(' · ');
        const avatar = `<span class="s-avatar"><span>${escapeHtml(initials(p.uk))}</span>${
          p.thumb ? `<img src="${escapeHtml(p.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''
        }</span>`;
        return `<li role="option" data-idx="${i}" class="${used ? 'used' : ''} ${i === suggestionIdx ? 'active' : ''}">
          ${avatar}
          <div class="s-text"><div class="s-main">${escapeHtml(p.uk)}</div><div class="s-sub">${escapeHtml(sub)}</div></div>
          ${used ? '<span class="s-flag">вже був у грі</span>' : ''}
        </li>`;
      })
      .join('');
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
      toast(`${p.uk} вже був у цій грі — обери іншого`, 'bad');
      return;
    }
    const cell = pickerCell;
    socket.emit('move', { cell, playerId: p.id }, (res) => {
      if (res?.error) {
        toast(res.error, 'bad');
        return;
      }
      closePicker();
      if (res.correct) toast(`✓ ${p.uk} — є!`, 'good');
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
    if (cell) openPicker(Number(cell.dataset.cell));
  });

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (target.tagName === 'A') e.preventDefault();
    const ack = (res) => res?.error && toast(res.error, 'bad');
    switch (action) {
      case 'close-picker': closePicker(); break;
      case 'skip': socket.emit('skip', null, ack); break;
      case 'draw': socket.emit('offerDraw', null, ack); break;
      case 'decline-draw': socket.emit('declineDraw', null, ack); break;
      case 'claim-win': socket.emit('claimWin', null, ack); break;
      case 'surrender':
        if (confirm('Точно здатися? Перемогу отримає суперник.')) socket.emit('surrender', null, ack);
        break;
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
        if (state?.status === 'playing' && !confirm('Вийти з кімнати? Поточна гра завершиться.')) break;
        leaveRoom();
        break;
      case 'leave':
        leaveRoom();
        break;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePicker();
  });

  // ── налаштування звуку: повзунок гучності + вимкнення
  const muteBtn = $('#mute-btn');
  const soundPanel = $('#sound-panel');
  const volumeInput = $('#volume');
  const renderSound = () => {
    const vol = Math.round(Sound.getVolume() * 100);
    const off = Sound.isMuted() || vol === 0;
    muteBtn.textContent = off ? '🔇' : vol < 40 ? '🔉' : '🔊';
    volumeInput.value = vol;
    $('#volume-val').textContent = `${vol}%`;
    $('#mute-toggle').textContent = Sound.isMuted() ? '🔊 Увімкнути звук' : '🔇 Вимкнути звук';
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
      // нове запрошення — спершу даємо перевірити/змінити ім'я
      $('#home-error').textContent = '';
      $('#invite-note').textContent = `Тебе запросили в кімнату ${code}. Перевір ім'я і натисни «Приєднатися».`;
      $('#invite-note').classList.remove('hidden');
      $('#join-btn').classList.replace('btn-secondary', 'btn-primary');
      nameInput.focus();
      nameInput.select();
    }
  }
})();
