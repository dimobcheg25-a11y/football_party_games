// «Шлях футболіста» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js; тут — етапи кар'єри, підказки, підсумок.
(() => {
  const LABELED = new Set(['partner', 'nickname']); // на картці відповіді — з підписом (інакше незрозуміло, що це за ім'я)
  const { ERA: ERA_LABELS, DIFF: DIFF_LABELS } = RoomClient.LABELS;
  const { L, name: pname } = window.I18n;
  const pl = window.I18n.plural;
  const TOGGLE_LABELS = { showYears: L('Роки', 'Years'), showStats: L('Матчі й голи', 'Apps & goals') };
  // слова з числом: n + форма
  const W = {
    round: (n) => pl(n, ['раунд', 'раунди', 'раундів'], ['round', 'rounds']),
    club: (n) => pl(n, ['клуб', 'клуби', 'клубів'], ['club', 'clubs']),
    match: (n) => pl(n, ['матч', 'матчі', 'матчів'], ['app', 'apps']),
    goal: (n) => pl(n, ['гол', 'голи', 'голів'], ['goal', 'goals']),
    assist: (n) => pl(n, ['асист', 'асисти', 'асистів'], ['assist', 'assists']),
    point: (n) => pl(n, ['очко', 'очки', 'очок'], ['point', 'points']),
  };

  let state = null;
  let mySeat = -1;

  const g = RoomClient.create({
    id: 'path',
    title: L('Шлях футболіста', 'Footballer’s Path'),
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
    optionList: (o) => [ERA_LABELS[o.era], DIFF_LABELS[o.difficulty],
      o.start === 'first' ? L('з першого клубу', 'from the first club') : L('з останнього клубу', 'from the last club'),
      `${o.rounds} ${W.round(o.rounds)}`, o.turnSeconds ? L(`${o.turnSeconds} с на етап`, `${o.turnSeconds}s per club`) : L('без таймера', 'no timer'),
      !o.showYears && L('без років', 'no years'), !o.showStats && L('без матчів і голів', 'no apps & goals')].filter(Boolean),
    onState(s, prev) {
      state = s;
      mySeat = s.you;
      playSounds(prev, s);
    },
    renderGame,
    renderFinal,
  });
  const { $, emit, store, toast, escapeHtml, initials, seatName, seatStyle } = g;

  function playSounds(p, s) {
    if (!p) return;
    const mineNow = s.solved[mySeat];
    if (mineNow && !p.solved[mySeat]) window.Sound.play('win');
    if (s.phase === 'guess' && p.phase === 'guess' && s.stage > p.stage) window.Sound.play('station');
    if (s.phase === 'guess' && (p.phase !== 'guess' || p.round !== s.round)) window.Sound.play('whistle');
  }

  $('#points-rule').textContent = L('100 за перший клуб, далі рівномірно менше — до 10 за останній (скільки клубів у кар’єрі, видно одразу)',
    '100 for the first club, then evenly less — down to 10 for the last one (you see how many clubs the career has from the start)');

  // ── гра
  function stageHtml(st, i, current) {
    const assists = st.assists != null ? ` · ${st.assists} ${W.assist(st.assists)}` : '';
    const stats = st.apps != null || st.goals != null
      ? `<span class="st-stats">${st.apps ?? '—'} ${W.match(st.apps ?? 0)} · ${st.goals ?? '—'} ${W.goal(st.goals ?? 0)}${assists}</span>`
      : st.apps === null && st.kind === 'club' ? `<span class="st-stats muted">${L('матчі й голи невідомі', 'apps & goals unknown')}</span>` : '';
    const icon = st.img ? `<img src="${st.img}" alt="" loading="lazy" />` : `<span>${escapeHtml(initials(st.name))}</span>`;
    const title = escapeHtml(st.name);
    const sub = [st.country, st.years].filter(Boolean).map(escapeHtml).join(' · ') + (st.loan ? ` · <span class="loan">${L('оренда', 'loan')}</span>` : '')
      + (st.fee ? ` · <span class="fee">${L('перехід за', 'transfer fee')} ${escapeHtml(st.fee)}</span>` : '');
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
    $('#round-info').innerHTML = `<b>${L(`Раунд ${s.round} з ${s.rounds}`, `Round ${s.round} of ${s.rounds}`)}</b><span>${DIFF_LABELS[s.options.difficulty]} · ${reveal ? L('відповідь', 'answer')
      : L(`клуб ${s.stage + 1} з ${s.totalStages}${s.stage === s.totalStages - 1 ? ' — останній' : ''}`, `club ${s.stage + 1} of ${s.totalStages}${s.stage === s.totalStages - 1 ? ' — the last one' : ''}`)}</span>`;
    // смужка кар'єри: скільки всього клубів, скільки вже відкрито — щоб знати, до чого готуватися
    $('#career-bar').innerHTML = Array.from({ length: s.totalStages }, (_, i) =>
      `<span class="${i < s.stages.length ? 'open' : ''} ${!reveal && i === s.stage ? 'now' : ''}" title="${L(`Клуб ${i + 1}: ${s.points[i]} очок`, `Club ${i + 1}: ${s.points[i]} points`)}"></span>`).join('');
    $('#career-bar').setAttribute('aria-label', `${L('Кар’єра', 'Career')}: ${s.totalStages} ${W.club(s.totalStages)}`);

    const shown = s.stages.map((st, i) => stageHtml(st, i, !reveal && i === s.stage)).join('');
    const left = s.totalStages - s.stages.length;
    const hidden = left > 0
      ? `<li class="stage locked"><div class="st-num">…</div><div class="st-icon ghost"></div><div class="st-body"><b>${L(`Ще ${left} ${W.club(left)} попереду`, `${left} more ${W.club(left)} ahead`)}</b></div></li>`
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
      ? L(`✓ Вгадав на етапі ${solved.stage + 1}: +${solved.points}. Чекаємо інших…`, `✓ Got it at club ${solved.stage + 1}: +${solved.points}. Waiting for the others…`)
      : done ? L('Відповідь на цьому етапі вже є — чекай наступного клубу.', 'You’ve answered at this club — wait for the next one.') : '';
    renderHints(solved);

    // відповідь після раунду
    const rv = $('#reveal');
    rv.classList.toggle('hidden', !reveal);
    if (reveal && s.answer) {
      const a = s.answer;
      const results = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
        .map((i) => { const r = s.solved[i]; return `<li style="${seatStyle(i)}"><span class="dot-p"></span>${escapeHtml(seatName(i))}<b>${r ? `+${r.points} · ${L('етап', 'club')} ${r.stage + 1}` : L('не вгадав', 'missed')}</b></li>`; }).join('');
      const iVoted = s.nextVotes.includes(mySeat);
      rv.innerHTML = `<div class="answer-card">
          <div class="answer-photo">${a.photo ? `<img src="${a.photo}" alt="" />` : `<span>${escapeHtml(initials(a.name))}</span>`}</div>
          <div><small>${L('Це був', 'It was')}</small><h2>${escapeHtml(pname(a))}</h2>${a.uk && a.uk !== a.name && window.I18n.lang === 'uk' ? `<small class="muted">${escapeHtml(a.name)}</small>` : ''}
            <div class="facts">${a.facts.map((f) => `<span>${f.img ? `<img src="${f.img}" alt="" />` : ''}${LABELED.has(f.id) ? `${escapeHtml(f.label)}: ` : ''}${escapeHtml(f.text)}${f.apps != null ? ` · ${f.apps} / ${f.goals ?? '—'}` : ''}</span>`).join('')}</div></div>
        </div>
        ${s.solo ? '' : `<ul class="round-results">${results}</ul>`}
        <button id="next-btn" class="btn btn-primary btn-lg" ${iVoted ? 'disabled' : ''}>${s.round >= s.rounds ? L('Підсумки', 'Results') : L('Наступний гравець →', 'Next player →')}</button>`;
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
    $('#earn').innerHTML = solved || s.potential == null ? '' : `${L('Вгадаєш зараз —', 'Guess now —')} <b>+${s.potential}</b> ${W.point(s.potential)}` +
      (s.potential < stagePts ? ` <small>(${L(`${stagePts} за клуб − підказки`, `${stagePts} for the club − hints`)})</small>` : '') +
      `<small class="next">${next != null ? L(`на наступному клубі — ${next}`, `at the next club — ${next}`) : L('це останній клуб', 'this is the last club')}</small>`;
    // справжня ціна: очок за відповідь не менше minPoints, тож на останніх клубах підказка знімає менше (або нічого)
    const room = Math.max(0, (s.potential ?? stagePts) - (s.minPoints ?? 0));
    $('#hints').innerHTML = solved ? '' : s.hintCosts.map((h) => {
      const real = Math.min(h.cost, room);
      const price = real === h.cost ? `<b>−${h.cost}</b>` : `<s>−${h.cost}</s> <b>${real ? `−${real}` : L('безкоштовно', 'free')}</b>`;
      return `<button type="button" class="hint-btn" data-hint="${h.id}" ${taken.has(h.id) ? 'disabled' : ''}>💡 ${escapeHtml(h.label)} ${price}</button>`;
    }).join('');
    $('#my-hints').innerHTML = s.myHints.map((h) => `<li>${h.img ? `<img src="${h.img}" alt="" />` : ''}<span>${escapeHtml(h.label)}:</span>
        <b>${escapeHtml(h.text)}</b>${h.apps != null ? ` <small>${h.apps} ${W.match(h.apps)} · ${h.goals ?? '—'} ${W.goal(h.goals ?? 0)}</small>` : ''}</li>`).join('');
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
    $('#table-title').textContent = s.solo ? L('Твій рахунок', 'Your score') : L('Таблиця', 'Standings');
    $('#scoreboard').innerHTML = seats.map((i) => {
      const place = seats.findIndex((j) => s.scores[j] === s.scores[i]) + 1; // однакові очки — однакове місце
      const solved = s.solved[i];
      const status = solved
        ? `<span class="gain">+${solved.points}</span>`
        : s.phase === 'guess' ? (s.stageDone.includes(i) ? `<span class="st">${L('відповів', 'answered')}</span>` : `<span class="st thinking">${L('думає…', 'thinking…')}</span>`) : '';
      const hints = s.hintsUsed[i] ? `<span class="hn" title="${L('Підказок', 'Hints')}">💡${s.hintsUsed[i]}</span>` : '';
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
      `<li class="bad">✗ ${escapeHtml(pname(g.player))} <small>${L('клуб', 'club')} ${g.stage + 1}</small></li>`);
    const others = s.solo ? [] : [...s.guesses].filter((g) => g.seat !== mySeat).reverse().map((g) =>
      `<li class="${g.correct ? 'good' : 'bad'}"><b style="${seatStyle(g.seat)}">${escapeHtml(seatName(g.seat))}</b> ${g.correct ? L('вгадав ✓', 'got it ✓') : L('помилився ✗', 'missed ✗')} <small>${L('клуб', 'club')} ${g.stage + 1}</small></li>`);
    $('#guess-feed').innerHTML = [...mine.reverse(), ...others].join('');
  }

  // ── таймер етапу
  function tick() {
    const el = $('#timer');
    if (!state || state.status !== 'playing' || !state.deadline) { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((state.deadline - g.serverNow()) / 1000));
    el.textContent = state.phase === 'reveal' ? L(`далі через ${left} с`, `next in ${left}s`) : L(`⏱ ${left} с`, `⏱ ${left}s`);
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
    const shamed = window.Players.shame(input.value); // росіяни — сірі, вибрати не можна
    list.innerHTML = (suggestions.length
      ? suggestions.map((p, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''} ${wrong.has(p.id) ? 'used' : ''}">
          <span class="s-avatar">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy" />` : escapeHtml(initials(p.name))}</span>
          <span class="s-text"><span class="s-main">${escapeHtml(pname(p))}</span><span class="s-sub">${window.I18n.lang === 'en' ? (p.born || '') : `${escapeHtml(p.name)}${p.born ? ` · ${p.born}` : ''}`}</span></span>
          ${wrong.has(p.id) ? `<span class="s-flag">${L('уже був', 'already tried')}</span>` : ''}</li>`).join('')
      : shamed ? '' : `<li class="empty">${L('Нікого не знайдено', 'No one found')}</li>`) + shamed;
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
      toast(L(`Ні, це не ${pname(p)}`, `No, it’s not ${pname(p)}`), 'bad');
    }
  }

  $('#pass-btn').addEventListener('click', () => emit('pass'));

  // ── підсумок
  function renderFinal() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    const max = s.rounds * s.maxPoints;
    if (s.solo) {
      $('#final-title').textContent = L(`${s.scores[mySeat]} з ${max} очок`, `${s.scores[mySeat]} of ${max} points`);
      const key = `path:best2:${s.options.era}:${s.options.difficulty}:${s.rounds}`;
      const best = Number(store.get(key)) || 0;
      if (s.scores[mySeat] > best) store.set(key, s.scores[mySeat]);
      $('#final-standings').innerHTML = `<li><span class="nm">${L('Рекорд', 'Best')} (${ERA_LABELS[s.options.era]}, ${DIFF_LABELS[s.options.difficulty]}, ${s.rounds})</span><span class="val">${Math.max(best, s.scores[mySeat])}${s.scores[mySeat] > best && best ? L(' — новий!', ' — new record!') : ''}</span></li>`;
    } else {
      const top = s.scores[seats[0]];
      const winners = seats.filter((i) => s.scores[i] === top);
      $('#final-title').textContent = winners.length > 1 ? L('Нічия!', 'It’s a draw!') : winners[0] === mySeat ? L('Ти переміг! 🏆', 'You won! 🏆') : L(`Переміг ${seatName(winners[0])} 🏆`, `${seatName(winners[0])} wins 🏆`);
      $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${s.scores[i] === top ? 'win' : ''}">
        <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))}</span><span class="val">${s.scores[i]} ${W.point(s.scores[i])}</span></li>`).join('');
    }
    $('#final-history').innerHTML = s.history.map((h) => {
      const mine = h.results[mySeat];
      return `<li><span class="nm">${escapeHtml(pname(h.answer))}</span><span class="val">${mine ? `+${mine.points}` : '—'}</span></li>`;
    }).join('');
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost);
    $('#again-wait').textContent = isHost || s.solo ? '' : L(`${s.seats[s.host]?.name || 'Господар'} може почати ще одну гру.`, `${s.seats[s.host]?.name || 'The host'} can start another game.`);
  }
})();
