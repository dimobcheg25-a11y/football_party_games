// «Топ-10» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js; тут — тема, дошка топу, відповіді.
(() => {
  const CATEGORY_LABELS = { transfers: '💶 Трансфери', goals: '⚽ Голи', apps: '👕 Матчі' };
  const MODE_LABELS = { own: 'кожен свій топ', turns: 'спільний топ по черзі' };
  const MODE_HINTS = {
    own: 'Усі заповнюють свій топ одночасно; чужих відповідей не видно — лише скільки знайшли.',
    turns: 'Одна дошка на всіх, називаєте по черзі. Помилка або пас — мінус життя.',
  };

  let state = null;
  let mySeat = -1;

  const g = RoomClient.create({
    id: 'top',
    title: 'Топ-10',
    defaults: { categories: Object.keys(CATEGORY_LABELS), size: '10', pick: 'random', mode: 'own', lives: '3', roundSeconds: '180', turnSeconds: '30', rounds: '5' },
    fixSetup(setup) {
      if (!Array.isArray(setup.categories) || !setup.categories.length) setup.categories = Object.keys(CATEGORY_LABELS);
      if (setup.mode === 'turns' && setup.lives === '0') setup.lives = '3'; // по черзі без життів раунд не закінчиться
    },
    onSetup(setup) {
      $('#mode-hint').textContent = MODE_HINTS[setup.mode];
      $('#lives-inf').classList.toggle('hidden', setup.mode === 'turns');
      $('#round-time-field').classList.toggle('hidden', setup.mode === 'turns');
      $('#turn-time-field').classList.toggle('hidden', setup.mode !== 'turns');
    },
    createOptions: (s) => ({ ...s, size: Number(s.size), lives: Number(s.lives), roundSeconds: Number(s.roundSeconds), turnSeconds: Number(s.turnSeconds), rounds: Number(s.rounds) }),
    optionList,
    onState(s, prev) {
      state = s;
      mySeat = s.you;
      playSounds(prev, s);
    },
    renderGame,
    renderFinal,
  });
  const { $, emit, store, toast, escapeHtml, initials, plural, seatName, seatStyle } = g;
  const hearts = (n) => (n == null ? '' : n ? '❤️'.repeat(n) : '💔');

  function optionList(o, solo) {
    return [o.categories.map((c) => CATEGORY_LABELS[c]).join(' '), `Топ-${o.size}`, solo ? null : MODE_LABELS[o.mode],
      o.lives ? `${o.lives} ${plural(o.lives, 'помилка', 'помилки', 'помилок')}` : 'помилки без обмежень',
      o.mode === 'turns' ? (o.turnSeconds ? `${o.turnSeconds} с на хід` : 'хід без таймера') : o.roundSeconds ? `${o.roundSeconds / 60} хв на раунд` : 'без таймера',
      `${o.rounds} ${plural(o.rounds, 'раунд', 'раунди', 'раундів')}`, o.pick === 'host' ? 'тему обирає господар' : 'випадкові теми'].filter(Boolean);
  }

  function playSounds(p, s) {
    if (!p) return;
    if (s.phase === 'guess' && (p.phase !== 'guess' || p.round !== s.round)) window.Sound.play('whistle');
    else if (s.phase === 'guess' && s.active === mySeat && p.active !== mySeat) window.Sound.play('pop');
  }

  // ── гра
  function renderGame() {
    const s = state;
    const turns = s.options.mode === 'turns';
    $('#round-info').innerHTML = `<b>Раунд ${s.round} з ${s.rounds}</b><span>Топ-${s.options.size}${s.solo ? '' : ` · ${MODE_LABELS[s.options.mode]}`}</span>`;
    $('#picker').classList.toggle('hidden', s.phase !== 'pick');
    $('#round-box').classList.toggle('hidden', s.phase === 'pick');
    if (s.phase === 'pick') renderPicker();
    else {
      $('#topic-title').textContent = s.topic.title;
      $('#topic-note').textContent = s.topic.note || '';
      renderAnswerBox(turns);
      renderBoard(turns);
      renderMisses(turns);
      renderRevealBar();
    }
    $('#reactions').classList.toggle('hidden', s.solo);
    renderScoreboard();
    tick();
  }

  // Вибір теми господарем: пошук за назвою + випадкова.
  let topicList = null;
  let topicKey = '';
  async function renderPicker() {
    const box = $('#picker');
    const isHost = mySeat === state.host;
    if (!isHost) {
      box.innerHTML = `<div class="stage-box"><p>${escapeHtml(state.seats[state.host]?.name || 'Господар')} обирає тему раунду…</p></div>`;
      box.dataset.mode = 'wait';
      return;
    }
    if (box.dataset.mode === 'pick') return; // уже намальовано — не збиваємо пошук
    box.dataset.mode = 'pick';
    box.innerHTML = `<div class="stage-box">
      <p><b>Обери тему раунду</b> — або довірся випадку.</p>
      <div class="row"><input id="topic-filter" placeholder="Пошук: клуб, збірна, «трансфери»…" autocomplete="off" /><button class="btn btn-primary" id="random-topic">🎲 Випадкова</button></div>
      <ul class="topic-list" id="topic-list"><li class="empty">Завантаження…</li></ul></div>`;
    $('#random-topic').addEventListener('click', () => chooseTopic(null));
    $('#topic-filter').addEventListener('input', drawTopics);
    $('#topic-list').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (li) chooseTopic(li.dataset.id);
    });
    const key = `${state.options.categories.join(',')}|${state.options.size}`;
    if (key !== topicKey) {
      topicKey = key;
      topicList = null;
      try {
        topicList = await (await fetch(`/api/top/topics?categories=${state.options.categories.join(',')}&size=${state.options.size}`)).json();
      } catch { topicList = []; }
    }
    drawTopics();
  }
  function drawTopics() {
    const list = $('#topic-list');
    if (!list || !topicList) return;
    const q = window.Players.normalize ? window.Players.normalize($('#topic-filter').value) : $('#topic-filter').value.toLowerCase();
    const norm = (t) => (window.Players.normalize ? window.Players.normalize(t) : t.toLowerCase());
    const found = topicList.filter((t) => !q || norm(t.title).includes(q)).slice(0, 60);
    list.innerHTML = found.length
      ? found.map((t) => `<li data-id="${escapeHtml(t.id)}"><span>${CATEGORY_LABELS[t.category].split(' ')[0]}</span>${escapeHtml(t.title)}</li>`).join('')
      : '<li class="empty">Нічого не знайдено</li>';
  }
  async function chooseTopic(id) {
    const res = await emit('pickTopic', { topicId: id });
    if (res.error) toast(res.error, 'bad');
  }

  function canAnswer(turns) {
    const s = state;
    if (s.phase !== 'guess') return false;
    if (turns) return s.active === mySeat;
    return !(s.mine?.done);
  }

  function renderAnswerBox(turns) {
    const s = state;
    $('#picker').dataset.mode = '';
    const reveal = s.phase === 'reveal';
    $('#answer-box').classList.toggle('hidden', reveal);
    if (reveal) return;
    const can = canAnswer(turns);
    const input = $('#guess-input');
    input.disabled = !can;
    if (!can) { input.value = ''; renderSuggestions(); }
    $('#pass-btn').classList.toggle('hidden', !turns);
    $('#pass-btn').disabled = !can;
    $('#giveup-btn').classList.toggle('hidden', turns);
    $('#giveup-btn').disabled = !can;
    const lives = turns ? (s.order.includes(mySeat) ? s.lives[mySeat] : null) : s.mine?.livesLeft ?? (s.options.lives || null);
    $('#lives').textContent = s.options.lives ? hearts(lives) : '';
    if (turns) {
      const playing = s.order.includes(mySeat);
      $('#turn-line').innerHTML = s.active === mySeat ? '<b>Твій хід!</b> Назви когось із топу.'
        : s.active >= 0 ? `Хід: <b class="pc" style="${seatStyle(s.active)}">${escapeHtml(seatName(s.active))}</b>` : '';
      $('#answer-hint').textContent = !playing ? 'Ти зайшов посеред раунду — граєш з наступного.' : s.lives[mySeat] === 0 ? 'Життя закінчились — ти вибув до кінця раунду.' : '';
    } else {
      $('#turn-line').innerHTML = '';
      const found = s.mine?.found.length || 0;
      $('#answer-hint').textContent = s.mine?.done
        ? `Твій топ закрито: ${found} з ${s.slots.length}. Чекаємо інших…`
        : found ? `Знайдено ${found} з ${s.slots.length}` : '';
    }
  }

  function slotHtml(slot, i, extra = '') {
    const by = slot.by?.length && !state.solo
      ? `<span class="by">${slot.by.map((x) => `<i class="dot-p" style="${seatStyle(x)}" title="${escapeHtml(seatName(x))}"></i>`).join('')}</span>` : '';
    if (!slot.player) {
      return `<li class="slot empty-slot ${extra}"><span class="place">${i + 1}</span><span class="blank">?</span><span class="pts">+${slot.points}</span></li>`;
    }
    const p = slot.player;
    return `<li class="slot ${extra}"><span class="place">${i + 1}</span>
      <span class="g-photo">${p.photo ? `<img src="${p.photo}" alt="" loading="lazy" />` : escapeHtml(initials(p.name))}</span>
      <span class="who"><b>${escapeHtml(p.uk || p.name)}</b>${slot.detail ? `<small>${escapeHtml(slot.detail)}</small>` : ''}</span>
      <span class="val">${escapeHtml(slot.text)}</span>${by}<span class="pts">+${slot.points}</span></li>`;
  }

  let lastFound = new Set();
  function renderBoard(turns) {
    const s = state;
    const reveal = s.phase === 'reveal';
    const mineFound = new Map((s.mine?.found || []).map((f) => [f.i, f]));
    const nowFound = new Set();
    $('#board').innerHTML = s.slots.map((slot, i) => {
      let shown = slot;
      let cls = '';
      if (!reveal && !turns && mineFound.has(i)) shown = { ...mineFound.get(i), by: [] };
      if (shown.player) nowFound.add(i);
      if (reveal) cls = (turns ? slot.by.length : slot.by.includes(mySeat)) ? 'got' : 'missed';
      else if (shown.player) cls = 'got';
      if (shown.player && !reveal && !lastFound.has(i)) cls += ' fresh';
      return slotHtml(shown, i, cls);
    }).join('');
    lastFound = reveal ? new Set() : nowFound;
  }

  function renderMisses(turns) {
    const s = state;
    const list = turns ? s.wrong : (s.mine?.wrong || []).map((player) => ({ seat: mySeat, player }));
    $('#misses').innerHTML = list.length
      ? `<span class="field-label">Мимо</span>${list.map((w) => `<span class="miss" style="${seatStyle(w.seat)}">${turns ? `<i class="dot-p"></i>` : ''}${w.player ? escapeHtml(w.player.uk || w.player.name) : 'пас'}</span>`).join('')}`
      : '';
  }

  function renderRevealBar() {
    const s = state;
    const bar = $('#reveal-bar');
    bar.classList.toggle('hidden', s.phase !== 'reveal');
    if (s.phase !== 'reveal') return;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => (s.roundPoints[b] || 0) - (s.roundPoints[a] || 0));
    const iVoted = s.nextVotes.includes(mySeat);
    bar.innerHTML = `${s.solo ? `<p class="verdict">За раунд: <b>+${s.roundPoints[mySeat] || 0}</b></p>`
      : `<ul class="round-results">${seats.map((i) => `<li style="${seatStyle(i)}"><span class="dot-p"></span>${escapeHtml(seatName(i))}<b>+${s.roundPoints[i] || 0}</b></li>`).join('')}</ul>`}
      <div class="reveal-actions"><button id="next-btn" class="btn btn-primary btn-lg" ${iVoted ? 'disabled' : ''}>${s.round >= s.rounds ? 'Підсумки' : 'Наступна тема →'}</button></div>`;
    $('#next-btn').addEventListener('click', () => emit('next'));
  }

  // Таблиця: очки + прогрес (свій топ — скільки знайшов; по черзі — життя).
  let shownScores = {};
  function renderScoreboard() {
    const s = state;
    const turns = s.options.mode === 'turns';
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a] || a - b);
    const top = s.scores[seats[0]];
    const leaders = seats.filter((i) => s.scores[i] === top);
    $('#table-title').textContent = s.solo ? 'Твій рахунок' : 'Таблиця';
    $('#scoreboard').innerHTML = seats.map((i) => {
      const place = seats.findIndex((j) => s.scores[j] === s.scores[i]) + 1;
      let status = '';
      if (s.phase === 'guess' && !s.solo) {
        if (turns) status = s.order.includes(i) ? `<span class="st ${s.active === i ? 'thinking' : ''}">${s.active === i ? '✍️ ' : ''}${s.options.lives ? hearts(s.lives[i]) : ''}</span>` : '';
        else { const pr = s.progress[i]; status = pr ? `<span class="st">${pr.found}/${s.slots.length}${pr.done ? ' ✓' : ''}</span>` : ''; }
      }
      const crown = !s.solo && top > 0 && leaders.length === 1 && leaders[0] === i ? ' 👑' : '';
      const bump = shownScores[i] != null && s.scores[i] > shownScores[i] ? 'bump' : '';
      return `<li data-seat="${i}" style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'}">
        ${s.solo ? '' : `<span class="place">${place}</span>`}<span class="dot-p"></span>
        <span class="nm">${escapeHtml(seatName(i))}${crown}</span>${status}<b class="${bump}">${s.scores[i]}</b></li>`;
    }).join('');
    shownScores = Object.fromEntries(seats.map((i) => [i, s.scores[i]]));
  }

  // ── таймер (раунду або ходу)
  function tick() {
    const el = $('#timer');
    if (!state || state.status !== 'playing' || !state.deadline || state.phase !== 'guess') { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((state.deadline - g.serverNow()) / 1000));
    el.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    el.classList.toggle('low', left <= 10);
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
    list.innerHTML = suggestions.length
      ? suggestions.map((p, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''}">
          <span class="s-avatar">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy" />` : escapeHtml(initials(p.name))}</span>
          <span class="s-text"><span class="s-main">${escapeHtml(p.uk || p.name)}</span><span class="s-sub">${escapeHtml(p.name)}${p.born ? ` · ${p.born}` : ''}</span></span></li>`).join('')
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
    if (res.correct) {
      window.Sound.play('win');
      toast(`${p.uk || p.name} — ${res.places.map((i) => `${i + 1}-е`).join(', ')} місце: +${res.points}`, 'good');
    } else {
      window.Sound.play('miss');
      toast(`${p.uk || p.name} — немає в топі`, 'bad');
    }
    if (!input.disabled) input.focus();
  }

  $('#pass-btn').addEventListener('click', () => {
    if (confirm('Пас? Це забере одне життя.')) emit('pass');
  });
  $('#giveup-btn').addEventListener('click', () => {
    if (confirm('Здатися в цьому раунді? Знайдені очки залишаться.')) emit('giveUp');
  });

  // ── підсумок
  function renderFinal() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    if (s.solo) {
      $('#final-title').textContent = `${s.scores[mySeat]} ${plural(s.scores[mySeat], 'очко', 'очки', 'очок')}`;
      const key = `top:best:${s.options.categories.join(',')}:${s.options.size}:${s.options.lives}:${s.rounds}`;
      const best = Number(store.get(key)) || 0;
      if (s.scores[mySeat] > best) store.set(key, s.scores[mySeat]);
      $('#final-standings').innerHTML = `<li><span class="nm">Рекорд (Топ-${s.options.size}, ${s.rounds} ${plural(s.rounds, 'раунд', 'раунди', 'раундів')})</span><span class="val">${Math.max(best, s.scores[mySeat])}${s.scores[mySeat] > best && best ? ' — новий!' : ''}</span></li>`;
    } else {
      const top = s.scores[seats[0]];
      const winners = seats.filter((i) => s.scores[i] === top);
      $('#final-title').textContent = winners.length > 1 ? 'Нічия!' : winners[0] === mySeat ? 'Ти переміг! 🏆' : `Переміг ${seatName(winners[0])} 🏆`;
      $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${s.scores[i] === top ? 'win' : ''}">
        <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))}</span><span class="val">${s.scores[i]} ${plural(s.scores[i], 'очко', 'очки', 'очок')}</span></li>`).join('');
    }
    $('#final-history').innerHTML = s.history.map((h) => `<li><span class="nm">${escapeHtml(h.title)}</span><span class="val">+${h.results[mySeat] || 0}</span></li>`).join('');
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost);
    $('#again-wait').textContent = isHost || s.solo ? '' : `${s.seats[s.host]?.name || 'Господар'} може почати ще одну гру.`;
  }
})();
