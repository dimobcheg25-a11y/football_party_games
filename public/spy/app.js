// «Футбольний шпигун» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js;
// тут — картка ролі, підказки, голосування, вгадування шпигуна, підсумок турніру.
(() => {
  const { ERA: ERA_LABELS, DIFF: DIFF_LABELS } = RoomClient.LABELS;

  let state = null;
  let mySeat = -1;
  let cardOpen = false;
  let stageKey = ''; // що зараз намальовано в #stage

  const g = RoomClient.create({
    id: 'spy',
    title: 'Футбольний шпигун',
    defaults: { era: 'all', difficulty: 'easy', circles: '2', target: '11' },
    fixSetup(setup) {
      if (!ERA_LABELS[setup.era]) setup.era = 'all';
      if (!DIFF_LABELS[setup.difficulty]) setup.difficulty = 'easy';
    },
    createOptions: (s) => ({ ...s, circles: Number(s.circles), target: Number(s.target) }),
    optionList,
    lobbyExtra: (i) => (state?.scores[i] ? ` <small>· ${points(state.scores[i])}</small>` : ''),
    onState(s, prev) {
      state = s;
      mySeat = s.you;
      if (s.status !== 'playing') stageKey = '';
      playSounds(prev, s);
    },
    renderGame,
    renderFinal,
  });
  const { $, act, toast, escapeHtml, initials, plural, seatName, seatStyle } = g;
  const points = (n) => `${n} ${plural(n, 'бал', 'бали', 'балів')}`;
  const photoHtml = (p, cls) => `<span class="${cls}">${p.photo ? `<img src="${p.photo}" alt="" />` : `<span>${escapeHtml(initials(p.name))}</span>`}</span>`;

  function optionList(o) {
    return [ERA_LABELS[o.era], DIFF_LABELS[o.difficulty], `${o.circles} ${plural(o.circles, 'коло', 'кола', 'кіл')}`, `до ${points(o.target)}`];
  }

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


  // ── гра
  function renderGame() {
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

  // Картка ролі — тека «справи»: закрита за замовчуванням (щоб ніхто не підгледів), натиск — відкрити/закрити.
  // Перемальовуємо лише коли змінився вміст — інакше печатка «гупала» б на кожне оновлення стану.
  let cardKey = '';
  const STAMP = '<span class="stamp" aria-hidden="true">ЦІЛКОМ<br>ТАЄМНО</span>';
  function renderCard(playing) {
    const el = $('#role-card');
    el.classList.toggle('hidden', !playing);
    if (!playing) { cardKey = ''; return; }
    const spy = state.role === 'spy';
    const key = JSON.stringify([cardOpen, spy, state.card?.id, state.match]);
    if (key === cardKey) return;
    cardKey = key;
    el.className = `role-card ${cardOpen ? 'open' : ''} ${cardOpen && spy ? 'spy' : ''}`;
    const tab = `<span class="case-tab">СПРАВА № ${String(state.match).padStart(2, '0')}</span>`;
    if (!cardOpen) {
      el.innerHTML = `${tab}<span class="rc-closed">🗂</span><span class="rc-text"><b>Твоя справа</b><small>Натисни, щоб відкрити (так, щоб ніхто не бачив)</small></span>`;
    } else if (spy) {
      el.innerHTML = `${tab}${STAMP}<span class="rc-icon">🕵️</span><span class="rc-text"><small>Роль: шпигун</small><small>Об'єкт:</small><b class="redacted" aria-label="приховано">██████████</b><small>Слухай підказки, не видай себе й спробуй здогадатися, хто це</small></span>`;
    } else {
      const c = state.card;
      el.innerHTML = `${tab}${STAMP}<span class="clipped">${photoHtml(c, 'answer-photo rc-photo')}<span class="clip" aria-hidden="true"></span></span><span class="rc-text"><small>Роль: агент · об'єкт:</small><b>${escapeHtml(c.uk || c.name)}</b>${c.uk && c.uk !== c.name ? `<small>${escapeHtml(c.name)}</small>` : ''}</span>`;
    }
  }
  $('#role-card').addEventListener('click', () => { cardOpen = !cardOpen; renderCard(true); if (cardOpen) window.Sound.play('stamp'); });

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

})();
