// «Футбольний шпигун» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js;
// тут — картка ролі, підказки, голосування, вгадування шпигуна, підсумок турніру.
(() => {
  const { ERA: ERA_LABELS, DIFF: DIFF_LABELS } = RoomClient.LABELS;

  let state = null;
  let mySeat = -1;
  let cardOpen = false;
  let stageKey = ''; // що зараз намальовано в #stage

  const { L, name: pname } = window.I18n;
  const g = RoomClient.create({
    id: 'spy',
    title: L('Футбольний шпигун', 'Football Spy'),
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
  const { $, act, toast, ask, escapeHtml, initials, plural, seatName, seatStyle } = g;
  const points = (n) => `${n} ${window.I18n.plural(n, ['бал', 'бали', 'балів'], ['point', 'points'])}`;
  const photoHtml = (p, cls) => `<span class="${cls}">${p.photo ? `<img src="${p.photo}" alt="" />` : `<span>${escapeHtml(initials(p.name))}</span>`}</span>`;

  function optionList(o) {
    return [ERA_LABELS[o.era], DIFF_LABELS[o.difficulty], `${o.circles} ${window.I18n.plural(o.circles, ['коло', 'кола', 'кіл'], ['clue round', 'clue rounds'])}`, L(`до ${points(o.target)}`, `to ${points(o.target)}`)];
  }

  function playSounds(p, s) {
    if (!p) return;
    const newMatch = s.match !== p.match || (s.status === 'playing' && p.status !== 'playing');
    if (newMatch) cardOpen = false;
    if (s.status === 'playing' && s.phase === 'clues' && newMatch) window.Sound.play('whistle');
    else if (s.active === mySeat && p.active !== mySeat) window.Sound.play('pop');
    if (s.phase === 'spyGuess' && p.phase !== 'spyGuess') window.Sound.play(s.gained?.[mySeat] > 0 ? 'win' : 'miss');
    if (s.phase === 'reveal' && p.phase !== 'reveal' && s.spyGuess?.correct) window.Sound.play(s.spy === mySeat ? 'win' : 'miss');
    if (p.card && s.card && p.card.id !== s.card.id) { cardOpen = false; toast(L('Футболіста замінили — відкрий картку', 'The footballer was replaced — open your card'), 'good'); }
  }


  // ── гра
  function renderGame() {
    const s = state;
    const playing = s.players.includes(mySeat);
    const phaseText = { clues: L(`коло ${s.circle} з ${s.options.circles}`, `round ${s.circle} of ${s.options.circles}`), vote: L('голосування', 'vote'),
      spyGuess: L('шпигун вгадує', 'spy is guessing'), reveal: L('підсумок матчу', 'match result') }[s.phase];
    $('#round-info').innerHTML = `<b>${L('Матч', 'Match')} ${s.match}${s.tiebreak ? L(' · додатковий', ' · tiebreak') : ''}</b><span>${DIFF_LABELS[s.options.difficulty]} · ${phaseText} · ${L(`до ${points(s.options.target)}`, `to ${points(s.options.target)}`)}</span>`;

    renderCard(playing);
    // етап перемальовуємо лише коли він змінився — щоб не збивати введення підказки чи відповіді
    const key = JSON.stringify([s.phase, s.match, playing, s.active, s.reroll, s.voted, s.nextVotes, s.spyGuess, s.card?.id,
      s.players.map((i) => s.seats[i]?.connected)]);
    const stage = $('#stage');
    if (key === stageKey) return finishGame();
    stageKey = key;
    if (!playing) stage.innerHTML = `<div class="stage-box"><p>${L('Ти зайшов посеред матчу — граєш з наступного. Поки можна читати підказки 🙂', 'You joined mid-match — you play from the next one. Meanwhile, read the clues 🙂')}</p></div>`;
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
  const STAMP = `<span class="stamp" aria-hidden="true">${L('ЦІЛКОМ<br>ТАЄМНО', 'TOP<br>SECRET')}</span>`;
  function renderCard(playing) {
    const el = $('#role-card');
    el.classList.toggle('hidden', !playing);
    if (!playing) { cardKey = ''; return; }
    const spy = state.role === 'spy';
    const key = JSON.stringify([cardOpen, spy, state.card?.id, state.match]);
    if (key === cardKey) return;
    cardKey = key;
    el.className = `role-card ${cardOpen ? 'open' : ''} ${cardOpen && spy ? 'spy' : ''}`;
    const tab = `<span class="case-tab">${L('СПРАВА', 'CASE')} № ${String(state.match).padStart(2, '0')}</span>`;
    if (!cardOpen) {
      el.innerHTML = `${tab}<span class="rc-closed">🗂</span><span class="rc-text"><b>${L('Твоя справа', 'Your file')}</b><small>${L('Натисни, щоб відкрити (так, щоб ніхто не бачив)', 'Tap to open (make sure nobody is looking)')}</small></span>`;
    } else if (spy) {
      el.innerHTML = `${tab}${STAMP}<span class="rc-icon">🕵️</span><span class="rc-text"><small>${L('Роль: шпигун', 'Role: spy')}</small><small>${L("Об'єкт:", 'Target:')}</small><b class="redacted" aria-label="${L('приховано', 'redacted')}">██████████</b><small>${L('Слухай підказки, не видай себе й спробуй здогадатися, хто це', 'Listen to the clues, don’t give yourself away and try to work out who it is')}</small></span>`;
    } else {
      const c = state.card;
      el.innerHTML = `${tab}${STAMP}<span class="clipped">${photoHtml(c, 'answer-photo rc-photo')}<span class="clip" aria-hidden="true"></span></span><span class="rc-text"><small>${L("Роль: агент · об'єкт:", 'Role: agent · target:')}</small><b>${escapeHtml(pname(c))}</b>${c.uk && c.uk !== c.name ? `<small>${escapeHtml(L(c.name, c.uk))}</small>` : ''}</span>`;
    }
  }
  $('#role-card').addEventListener('click', () => { cardOpen = !cardOpen; renderCard(true); if (cardOpen) window.Sound.play('stamp'); });

  let clueDraft = '';
  function renderClueStage(stage) {
    const s = state;
    if (s.reroll) {
      const voted = s.reroll.voted.includes(mySeat);
      const who = s.reroll.by === mySeat ? L('Ти пропонуєш', 'You propose') : L(`${escapeHtml(seatName(s.reroll.by))} пропонує`, `${escapeHtml(seatName(s.reroll.by))} proposes`);
      stage.innerHTML = `<div class="stage-box reroll">
        <p><b>${who} ${L('замінити футболіста.', 'to replace the footballer.')}</b> ${L('Більшість «за» — буде новий, підказки почнуться спочатку.', 'If the majority agrees, there will be a new one and clues start over.')}</p>
        <div class="row">${voted ? `<span class="hint">${L('Твій голос враховано', 'Your vote is counted')}</span>` : `<button class="btn btn-primary" data-reroll="1">${L('Так, замінити', 'Yes, replace')}</button><button class="btn btn-secondary" data-reroll="0">${L('Ні, граємо далі', 'No, keep playing')}</button>`}</div>
        <p class="hint">${L('За', 'Yes')}: ${s.reroll.yes} · ${L('Проти', 'No')}: ${s.reroll.no}</p></div>`;
      stage.querySelectorAll('[data-reroll]').forEach((b) => b.addEventListener('click', () => act('rerollVote', { yes: b.dataset.reroll === '1' })));
      return;
    }
    const mine = s.active === mySeat;
    const queue = s.order.map((i) => `<li style="${seatStyle(i)}" class="${i === s.active ? 'now' : ''} ${s.seats[i]?.connected ? '' : 'offline'}"><span class="dot-p"></span>${escapeHtml(seatName(i))}</li>`).join('');
    stage.innerHTML = `<div class="stage-box ${mine ? 'my-turn' : ''}">
      <ol class="turn-order">${queue}</ol>
      ${mine
        ? `<p><b>${L('Твій хід!', 'Your turn!')}</b> ${L('Скажи підказку голосом або напиши її тут.', 'Say a clue out loud or type it here.')}</p>
           <form class="clue-form" id="clue-form">
             <input id="clue-input" maxlength="80" placeholder="${L('Підказка про футболіста…', 'A clue about the footballer…')}" autocomplete="off" />
             <button class="btn btn-primary">${L('Надіслати', 'Send')}</button>
           </form>
           <button class="btn btn-secondary" id="voice-btn">${L('🎙 Сказав голосом — далі', '🎙 Said it out loud — next')}</button>`
        : `<p>${L('Хід', 'Turn')}: <b style="${seatStyle(s.active)}" class="pc">${escapeHtml(seatName(s.active))}</b> — ${L('слухай або читай підказку.', 'listen to or read the clue.')}</p>`}
      <button class="btn btn-ghost btn-sm" id="reroll-btn">${L('Не знаю цього футболіста — замінити', 'I don’t know this footballer — replace')}</button>
    </div>`;
    if (mine) {
      const input = $('#clue-input');
      input.value = clueDraft;
      input.addEventListener('input', () => (clueDraft = input.value));
      $('#clue-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!input.value.trim()) return toast(L('Напиши підказку або натисни «Сказав голосом»', 'Type a clue or press “Said it out loud”'), 'bad');
        const res = await act('clue', { text: input.value });
        if (res.ok) clueDraft = '';
      });
      $('#voice-btn').addEventListener('click', () => act('clue', {}));
      if (!('ontouchstart' in window)) input.focus();
    }
    $('#reroll-btn').addEventListener('click', async () => {
      if (await ask(L('Запропонувати замінити футболіста?', 'Propose replacing the footballer?'), { note: L('Усі проголосують.', 'Everyone will vote.'), ok: L('Запропонувати', 'Propose') })) act('requestReroll');
    });
  }

  function renderVoteStage(stage) {
    const s = state;
    const voted = s.voted.includes(mySeat);
    const candidates = s.players.filter((i) => i !== mySeat && s.seats[i]);
    const waiting = s.players.filter((i) => s.seats[i]?.connected && !s.voted.includes(i));
    stage.innerHTML = `<div class="stage-box">
      <p><b>${L('Хто шпигун?', 'Who is the spy?')}</b> ${voted ? L('Твій голос прийнято.', 'Your vote is in.') : L('Обери гравця.', 'Pick a player.')}</p>
      <div class="vote-grid">${candidates.map((i) => `<button class="vote-btn" style="${seatStyle(i)}" data-target="${i}" ${voted ? 'disabled' : ''}><span class="dot-p"></span>${escapeHtml(seatName(i))}</button>`).join('')}</div>
      <p class="hint">${waiting.length ? `${L('Чекаємо', 'Waiting for')}: ${waiting.map((i) => escapeHtml(seatName(i))).join(', ')}` : ''}</p>
    </div>`;
    stage.querySelectorAll('[data-target]').forEach((b) => b.addEventListener('click', async () => {
      const target = Number(b.dataset.target);
      if (await ask(L(`Голосуєш за: ${seatName(target)}?`, `Vote for ${seatName(target)}?`), { note: L('Голос не можна змінити.', 'You can’t change your vote.'), ok: L('Голосую', 'Vote') })) act('vote', { target });
    }));
  }

  // Результат голосування: скільки голосів у кого і хто за кого.
  function votesHtml() {
    const s = state;
    return `<ul class="vote-results">${s.players.filter((i) => s.seats[i]).sort((a, b) => (s.voteCounts[b] || 0) - (s.voteCounts[a] || 0)).map((i) => `
      <li style="${seatStyle(i)}" class="${i === s.spy ? 'spy' : ''}"><span class="dot-p"></span>
        <span class="nm">${escapeHtml(seatName(i))}${i === s.spy ? ' 🕵️' : ''}</span>
        <small>${s.votes[i] != null ? `→ ${escapeHtml(seatName(s.votes[i]))}` : L('не голосував', 'did not vote')}</small>
        <b>${s.voteCounts[i] || 0} 🗳</b>
        <span class="gain">${s.gained?.[i] ? `+${s.gained[i]}` : '0'}</span></li>`).join('')}</ul>`;
  }

  function spyVerdict() {
    const s = state;
    const name = s.spy === mySeat ? L('Тебе', 'You') : escapeHtml(seatName(s.spy));
    return s.spyPoints === 0 ? L(`${name} викрили! Шпигун — 0 балів.`, `${name} got caught! The spy gets 0 points.`)
      : s.spyPoints === 3 ? L(`${s.spy === mySeat ? 'Тебе' : 'Шпигуна'} майже ніхто не запідозрив: +3.`, `Hardly anyone suspected ${s.spy === mySeat ? 'you' : 'the spy'}: +3.`)
        : L(`Шпигуна не викрили напевно: +2.`, `The spy wasn’t clearly caught: +2.`);
  }

  function renderSpyGuessStage(stage) {
    const s = state;
    const spy = s.spy === mySeat;
    stage.innerHTML = `<div class="stage-box">
      <p class="verdict">${L('Шпигун', 'The spy is')} — <b style="${seatStyle(s.spy)}" class="pc">${escapeHtml(seatName(s.spy))}</b>. ${spyVerdict()}</p>
      ${votesHtml()}
      ${spy
        ? `<p><b>${L('Остання спроба:', 'Last chance:')}</b> ${L(`назви футболіста — вгадаєш, ще +${s.spyGuessPoints}. Лише одна спроба.`, `name the footballer — guess right for +${s.spyGuessPoints} more. One try only.`)}</p>
           <div class="search"><input id="guess-input" placeholder="${L('Почни вводити прізвище…', 'Start typing a surname…')}" autocomplete="off" /><ul class="suggestions" id="suggestions"></ul></div>
           <button class="btn btn-ghost btn-sm" id="pass-btn">${L('Не знаю', 'I don’t know')}</button>`
        : `<p class="hint">${L('Шпигун пробує вгадати футболіста…', 'The spy is trying to guess the footballer…')}</p>`}
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
    const guessText = g.skipped ? L('Шпигун не став вгадувати.', 'The spy didn’t guess.')
      : g.correct ? L(`Шпигун вгадав: ${escapeHtml(pname(g.player))} — ще +${s.spyGuessPoints}! 🎯`, `The spy guessed it: ${escapeHtml(pname(g.player))} — +${s.spyGuessPoints} more! 🎯`)
        : L(`Шпигун назвав: ${escapeHtml(pname(g.player) || '?')} — мимо.`, `The spy said ${escapeHtml(pname(g.player) || '?')} — wrong.`);
    const iVoted = s.nextVotes.includes(mySeat);
    const waiting = s.seats.map((x, i) => (x?.connected && !s.nextVotes.includes(i) ? i : -1)).filter((i) => i >= 0);
    const { top } = leaders();
    const last = top >= s.options.target;
    stage.innerHTML = `<div class="stage-box">
      <div class="answer-card">${photoHtml(f, 'answer-photo')}<div><small>${L('Футболіст', 'Footballer')}</small><h2>${escapeHtml(pname(f))}</h2>${f.uk && f.uk !== f.name ? `<small class="muted">${escapeHtml(L(f.name, f.uk))}</small>` : ''}</div></div>
      <p class="verdict">${L('Шпигун', 'The spy is')} — <b style="${seatStyle(s.spy)}" class="pc">${escapeHtml(seatName(s.spy))}</b>. ${spyVerdict()} ${guessText}</p>
      ${votesHtml()}
      <div class="reveal-actions">
        <button id="next-btn" class="btn btn-primary btn-lg" ${iVoted ? 'disabled' : ''}>${last ? L('Далі', 'Next') : L('Наступний матч →', 'Next match →')}</button>
      </div>
      <p class="hint">${iVoted && waiting.length ? `${L('Чекаємо', 'Waiting for')}: ${waiting.map((i) => escapeHtml(seatName(i))).join(', ')}` : ''}</p>
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
          ${c.skipped ? `<i class="muted">${L('хід пропущено', 'turn skipped')}</i>` : c.text ? `<span class="clue-text">${escapeHtml(c.text)}</span>` : `<i class="muted">${L('🎙 сказав голосом', '🎙 said it out loud')}</i>`}</li>`).join('')
      : `<li class="empty">${L('Ще ніхто нічого не сказав.', 'Nobody has said anything yet.')}</li>`;
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
      const status = !s.players.includes(i) ? `<span class="st">${L('з наступного', 'next match')}</span>`
        : s.phase === 'clues' && s.active === i ? `<span class="st thinking">${L('хід', 'turn')}</span>`
          : s.phase === 'vote' ? `<span class="st">${s.voted.includes(i) ? '✓' : '…'}</span>` : '';
      const crown = top > 0 && lead.length === 1 && lead[0] === i ? ' 👑' : '';
      const bump = shownScores[i] != null && s.scores[i] > shownScores[i] ? 'bump' : '';
      return `<li data-seat="${i}" style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'}">
        <span class="place">${place}</span><span class="dot-p"></span><span class="nm">${escapeHtml(seatName(i))}${crown}</span>${status}<b class="${bump}">${s.scores[i]}</b></li>`;
    }).join('');
    shownScores = Object.fromEntries(seats.map((i) => [i, s.scores[i]]));
  }

  $('#skip-btn').addEventListener('click', async () => {
    if (await ask(L(`Пропустити хід гравця ${seatName(state.active)}?`, `Skip ${seatName(state.active)}’s turn?`), { ok: L('Пропустити', 'Skip') })) act('skipTurn');
  });
  $('#force-vote-btn').addEventListener('click', async () => {
    if (await ask(L('Перейти до голосування?', 'Go to the vote?'), { note: L('Не чекаючи всіх підказок.', 'Without waiting for all clues.'), ok: L('До голосування', 'To the vote') })) act('forceVote');
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
            <span class="s-text"><span class="s-main">${escapeHtml(pname(p))}</span><span class="s-sub">${escapeHtml(L(`${p.name}${p.born ? ` · ${p.born}` : ''}`, `${p.born || ''}`))}</span></span></li>`).join('')
        : `<li class="empty">${L('Нікого не знайдено', 'No one found')}</li>`;
    };
    const choose = async (p) => {
      if (!p || !(await ask(L(`Твоя відповідь: ${pname(p)}?`, `Your answer: ${pname(p)}?`), { note: L('Спроба лише одна.', 'One try only.'), ok: L('Відповісти', 'Answer') }))) return;
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
    $('#final-title').textContent = s.winner === mySeat ? L('Ти переміг! 🏆', 'You won! 🏆') : L(`Переміг ${seatName(s.winner)} 🏆`, `${seatName(s.winner)} won 🏆`);
    $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${i === s.winner ? 'win' : ''}">
      <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))} <small class="muted">${L(`· шпигуном ${s.stats[i].spy}, викрили ${s.stats[i].caught}`, `· spy ${s.stats[i].spy}×, caught ${s.stats[i].caught}×`)}</small></span><span class="val">${points(s.scores[i])}</span></li>`).join('');
    $('#final-history').innerHTML = s.history.map((h, k) => `<li><span class="nm">${k + 1}. ${escapeHtml(pname(h.footballer))}</span>
      <span class="val">🕵️ ${escapeHtml(h.spy === mySeat ? L('Ти', 'You') : h.spyName)} · ${h.spyPoints === 0 ? L('викрили', 'caught') : `+${h.spyPoints}`}${h.guessed ? L(' · вгадав 🎯', ' · guessed 🎯') : ''}</span></li>`).join('');
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost);
    $('#again-wait').textContent = isHost ? '' : L(`${s.seats[s.host]?.name || 'Господар'} може почати новий турнір.`, `${s.seats[s.host]?.name || 'The host'} can start a new tournament.`);
  }

})();
