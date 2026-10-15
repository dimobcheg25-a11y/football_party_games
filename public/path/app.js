// «Шлях футболіста» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js; тут — етапи кар'єри, підказки, підсумок.
(() => {
  const { ERA: ERA_LABELS, DIFF: DIFF_LABELS } = RoomClient.LABELS;
  const TOGGLE_LABELS = { showYears: 'Роки', showStats: 'Матчі й голи' };

  let state = null;
  let mySeat = -1;

  const g = RoomClient.create({
    id: 'path',
    title: 'Шлях футболіста',
    defaults: { era: 'all', difficulty: 'normal', start: 'first', rounds: '10', turnSeconds: '30', showYears: true, showStats: true },
    fixSetup(setup) {
      if (!ERA_LABELS[setup.era]) setup.era = 'all';
      if (!DIFF_LABELS[setup.difficulty]) setup.difficulty = 'normal';
    },
    onSetup(setup) {
      document.querySelectorAll('[data-toggle]').forEach((chip) => {
        chip.textContent = `${setup[chip.dataset.toggle] ? '✓ ' : ''}${TOGGLE_LABELS[chip.dataset.toggle]}`;
      });
    },
    createOptions: (s) => ({ ...s, rounds: Number(s.rounds), turnSeconds: Number(s.turnSeconds) }),
    optionList: (o) => [ERA_LABELS[o.era], DIFF_LABELS[o.difficulty], o.start === 'first' ? 'з першого клубу' : 'з останнього клубу',
      `${o.rounds} ${plural(o.rounds, 'раунд', 'раунди', 'раундів')}`, o.turnSeconds ? `${o.turnSeconds} с на етап` : 'без таймера',
      !o.showYears && 'без років', !o.showStats && 'без матчів і голів'].filter(Boolean),
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
    const mineNow = s.solved[mySeat];
    if (mineNow && !p.solved[mySeat]) window.Sound.play('win');
    if (s.phase === 'guess' && p.phase === 'guess' && s.stage > p.stage) window.Sound.play('station');
    if (s.phase === 'guess' && (p.phase !== 'guess' || p.round !== s.round)) window.Sound.play('whistle');
  }

  $('#points-rule').textContent = '100 за перший клуб, далі рівномірно менше — до 10 за останній (скільки клубів у кар’єрі, видно одразу)';

  // ── гра
  function stageHtml(st, i, current) {
    const assists = st.assists != null ? ` · ${st.assists} ${plural(st.assists, 'асист', 'асисти', 'асистів')}` : '';
    const stats = st.apps != null || st.goals != null
      ? `<span class="st-stats">${st.apps ?? '—'} ${plural(st.apps ?? 0, 'матч', 'матчі', 'матчів')} · ${st.goals ?? '—'} ${plural(st.goals ?? 0, 'гол', 'голи', 'голів')}${assists}</span>`
      : st.apps === null && st.kind === 'club' ? '<span class="st-stats muted">матчі й голи невідомі</span>' : '';
    const icon = st.img ? `<img src="${st.img}" alt="" loading="lazy" />` : `<span>${escapeHtml(initials(st.name))}</span>`;
    const title = escapeHtml(st.name);
    const sub = [st.country, st.years].filter(Boolean).map(escapeHtml).join(' · ') + (st.loan ? ' · <span class="loan">оренда</span>' : '')
      + (st.fee ? ` · <span class="fee">перехід за ${escapeHtml(st.fee)}</span>` : '');
    // transfer/on-loan — для схеми метро: платний перехід = «пересадка», оренда — пунктир лінії
    return `<li class="stage ${st.kind} ${current ? 'current' : ''} ${st.fee ? 'transfer' : ''} ${st.loan ? 'on-loan' : ''}">
      <div class="st-num">${i + 1}</div>
      <div class="st-icon ${st.img ? 'crest' : ''}">${icon}</div>
      <div class="st-body"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}${stats}</div>
    </li>`;
  }

  function renderGame() {
    const s = state;
    const reveal = s.phase === 'reveal';
    $('#round-info').innerHTML = `<b>Раунд ${s.round} з ${s.rounds}</b><span>${DIFF_LABELS[s.options.difficulty]} · ${reveal ? 'відповідь' : `клуб ${s.stage + 1} з ${s.totalStages}${s.stage === s.totalStages - 1 ? ' — останній' : ''}`}</span>`;
    // смужка кар'єри: скільки всього клубів, скільки вже відкрито — щоб знати, до чого готуватися
    $('#career-bar').innerHTML = Array.from({ length: s.totalStages }, (_, i) =>
      `<span class="${i < s.stages.length ? 'open' : ''} ${!reveal && i === s.stage ? 'now' : ''}" title="Клуб ${i + 1}: ${s.points[i]} очок"></span>`).join('');
    $('#career-bar').setAttribute('aria-label', `Кар'єра: ${s.totalStages} ${plural(s.totalStages, 'клуб', 'клуби', 'клубів')}`);

    const shown = s.stages.map((st, i) => stageHtml(st, i, !reveal && i === s.stage)).join('');
    const left = s.totalStages - s.stages.length;
    const hidden = left > 0
      ? `<li class="stage locked"><div class="st-num">…</div><div class="st-icon ghost"></div><div class="st-body"><b>Ще ${left} ${plural(left, 'клуб', 'клуби', 'клубів')} попереду</b></div></li>`
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
      : done ? 'Відповідь на цьому етапі вже є — чекай наступного клубу.' : '';
    renderHints(solved);

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
          <div><small>Це був</small><h2>${escapeHtml(a.uk || a.name)}</h2>${a.uk && a.uk !== a.name ? `<small class="muted">${escapeHtml(a.name)}</small>` : ''}
            <div class="facts">${a.facts.map((f) => `<span>${f.img ? `<img src="${f.img}" alt="" />` : ''}${escapeHtml(f.text)}${f.apps != null ? ` · ${f.apps} / ${f.goals ?? '—'}` : ''}</span>`).join('')}</div></div>
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

  // ── підказки: свої (privateState), з ціною; «можна заробити» — за етап мінус взяті підказки
  function renderHints(solved) {
    const s = state;
    const taken = new Set(s.myHints.map((h) => h.id));
    const stagePts = s.points[s.stage];
    const next = s.points[s.stage + 1];
    $('#earn').innerHTML = solved || s.potential == null ? '' : `Вгадаєш зараз — <b>+${s.potential}</b> ${plural(s.potential, 'очко', 'очки', 'очок')}` +
      (s.potential < stagePts ? ` <small>(${stagePts} за клуб − підказки)</small>` : '') +
      `<small class="next">${next != null ? `на наступному клубі — ${next}` : 'це останній клуб'}</small>`;
    $('#hints').innerHTML = solved ? '' : s.hintCosts.map((h) => `<button type="button" class="hint-btn" data-hint="${h.id}" ${taken.has(h.id) ? 'disabled' : ''}>
        💡 ${escapeHtml(h.label)} <b>−${h.cost}</b></button>`).join('');
    $('#my-hints').innerHTML = s.myHints.map((h) => `<li>${h.img ? `<img src="${h.img}" alt="" />` : ''}<span>${escapeHtml(h.label)}:</span>
        <b>${escapeHtml(h.text)}</b>${h.apps != null ? ` <small>${h.apps} ${plural(h.apps, 'матч', 'матчі', 'матчів')} · ${h.goals ?? '—'} ${plural(h.goals ?? 0, 'гол', 'голи', 'голів')}</small>` : ''}</li>`).join('');
  }
  $('#hints').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-hint]');
    if (!b) return;
    const res = await emit('hint', { id: b.dataset.hint });
    if (res.error) toast(res.error, 'bad');
  });

  // Турнірна таблиця наживо: місце, хто лідирує, що кожен робить у цьому раунді, загальний рахунок.
  let shownScores = {};
  function renderScoreboard() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
      .sort((a, b) => s.scores[b] - s.scores[a] || a - b);
    const top = s.scores[seats[0]];
    const leaders = seats.filter((i) => s.scores[i] === top);
    $('#table-title').textContent = s.solo ? 'Твій рахунок' : 'Таблиця';
    $('#scoreboard').innerHTML = seats.map((i) => {
      const place = seats.findIndex((j) => s.scores[j] === s.scores[i]) + 1; // однакові очки — однакове місце
      const solved = s.solved[i];
      const status = solved
        ? `<span class="gain">+${solved.points}</span>`
        : s.phase === 'guess' ? (s.stageDone.includes(i) ? '<span class="st">відповів</span>' : '<span class="st thinking">думає…</span>') : '';
      const hints = s.hintsUsed[i] ? `<span class="hn" title="Підказок">💡${s.hintsUsed[i]}</span>` : '';
      const crown = !s.solo && top > 0 && leaders.length === 1 && leaders[0] === i ? ' 👑' : '';
      const bump = shownScores[i] != null && s.scores[i] > shownScores[i] ? 'bump' : '';
      return `<li data-seat="${i}" style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'}">
        ${s.solo ? '' : `<span class="place">${place}</span>`}<span class="dot-p"></span>
        <span class="nm">${escapeHtml(seatName(i))}${crown}</span>${status}${hints}<b class="${bump}">${s.scores[i]}</b></li>`;
    }).join('');
    shownScores = Object.fromEntries(seats.map((i) => [i, s.scores[i]]));
  }

  // Свої відповіді — з іменами; чужі — лише «помилився/вгадав», щоб не підказати іншим.
  function renderFeed() {
    const s = state;
    const mine = s.myGuesses.filter((g) => !g.correct).map((g) =>
      `<li class="bad">✗ ${escapeHtml(g.player.uk || g.player.name)} <small>клуб ${g.stage + 1}</small></li>`);
    const others = s.solo ? [] : [...s.guesses].filter((g) => g.seat !== mySeat).reverse().map((g) =>
      `<li class="${g.correct ? 'good' : 'bad'}"><b style="${seatStyle(g.seat)}">${escapeHtml(seatName(g.seat))}</b> ${g.correct ? 'вгадав ✓' : 'помилився ✗'} <small>клуб ${g.stage + 1}</small></li>`);
    $('#guess-feed').innerHTML = [...mine.reverse(), ...others].join('');
  }

  // ── таймер етапу
  function tick() {
    const el = $('#timer');
    if (!state || state.status !== 'playing' || !state.deadline) { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((state.deadline - g.serverNow()) / 1000));
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
    const wrong = new Set(state.myGuesses.filter((g) => !g.correct).map((g) => g.player.id));
    list.innerHTML = suggestions.length
      ? suggestions.map((p, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''} ${wrong.has(p.id) ? 'used' : ''}">
          <span class="s-avatar">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy" />` : escapeHtml(initials(p.name))}</span>
          <span class="s-text"><span class="s-main">${escapeHtml(p.uk || p.name)}</span><span class="s-sub">${escapeHtml(p.name)}${p.born ? ` · ${p.born}` : ''}</span></span>
          ${wrong.has(p.id) ? '<span class="s-flag">уже був</span>' : ''}</li>`).join('')
      : '<li class="empty">Нікого не знайдено</li>';
  }

  input.addEventListener('input', () => { active = 0; renderSuggestions(); });
  // список підказок відкривається вниз — піднімаємо поле вгору екрана, щоб його було видно цілком (і над клавіатурою)
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
    if (!res.correct) {
      window.Sound.play('miss');
      toast(`Ні, це не ${p.uk || p.name}`, 'bad');
    }
  }

  $('#pass-btn').addEventListener('click', () => emit('pass'));

  // ── підсумок
  function renderFinal() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    const max = s.rounds * s.maxPoints;
    if (s.solo) {
      $('#final-title').textContent = `${s.scores[mySeat]} з ${max} очок`;
      const key = `path:best2:${s.options.era}:${s.options.difficulty}:${s.rounds}`;
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
