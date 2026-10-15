// «Вгадай гравця» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js; тут — дошка спроб, відповідь, підсумок.
(() => {
  const { ERA: ERA_LABELS, DIFF: DIFF_LABELS } = RoomClient.LABELS;
  const ARROWS = { up: '↑', down: '↓' };
  const EMOJI = { green: '🟩', yellow: '🟨', grey: '⬜' };

  let state = null;
  let mySeat = -1;

  const g = RoomClient.create({
    id: 'guess',
    title: 'Вгадай гравця',
    defaults: { era: 'all', difficulty: 'normal', attempts: '8', rounds: '5', turnSeconds: '120' },
    fixSetup(setup) {
      if (!ERA_LABELS[setup.era]) setup.era = 'all';
      if (!DIFF_LABELS[setup.difficulty]) setup.difficulty = 'normal';
    },
    onSetup(setup) {
      $('#points-rule').textContent = `з першої спроби — 100, далі рівномірно менше — до 10 за останню (${setup.attempts})`;
    },
    createOptions: (s) => ({ ...s, rounds: Number(s.rounds), attempts: Number(s.attempts), turnSeconds: Number(s.turnSeconds) }),
    optionList: (o) => [ERA_LABELS[o.era], DIFF_LABELS[o.difficulty], `${o.attempts} спроб`, `${o.rounds} ${plural(o.rounds, 'раунд', 'раунди', 'раундів')}`,
      o.turnSeconds ? `${o.turnSeconds / 60} хв на раунд` : 'без таймера'],
    onState(s, prev) {
      state = s;
      mySeat = s.you;
      playSounds(prev, s);
    },
    renderGame,
    renderFinal,
  });
  const { $, emit, store, toast, escapeHtml, initials, plural, seatName, seatStyle } = g;

  function playSounds(p, s) {
    if (!p) return;
    const was = p.progress[mySeat]?.solved, now = s.progress[mySeat]?.solved;
    if (now && !was) window.Sound.play('win');
    if (s.phase === 'guess' && (p.phase !== 'guess' || p.round !== s.round)) window.Sound.play('whistle');
  }

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
    const s = state;
    const reveal = s.phase === 'reveal';
    const mine = s.progress[mySeat] || { colors: [], solved: null, done: false };
    const used = s.myTries.length;
    $('#round-info').innerHTML = `<b>Раунд ${s.round} з ${s.rounds}</b><span>${DIFF_LABELS[s.options.difficulty]} · ${reveal ? 'відповідь' : `спроба ${Math.min(used + 1, s.options.attempts)} з ${s.options.attempts}`}</span>`;

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
    $('#board').style.setProperty('--n', s.columns.length - 2); // звичайних клітинок: 9, з асистами — 10
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
        <div class="board answer-board" style="--n:${s.columns.length - 2}">${rowHtml(a, a.cells, 'win')}</div>
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
    const left = Math.max(0, Math.ceil((state.deadline - g.serverNow()) / 1000));
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

})();
