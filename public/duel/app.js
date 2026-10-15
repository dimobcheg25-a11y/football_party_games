// «Один на один» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js; тут — ринг із двома кутами,
// відповідь, лічильники чисел, таблиця й підсумок.
(() => {
  const { DIFF: DIFF_LABELS } = RoomClient.LABELS;
  const { L, name: pname } = window.I18n;
  const EN = window.I18n.lang === 'en';
  const pl = (n, uk, en) => window.I18n.plural(n, uk, en);
  const POINTS = [['очко', 'очки', 'очок'], ['point', 'points']];
  const LEVEL_LABELS = { easy: L('🟢 Пари легкі', '🟢 Clear gaps'), hard: L('🔴 Пари складні', '🔴 Close calls'), mix: L('🎲 Пари мікс', '🎲 Mixed pairs') };
  const CORNERS = [L('Червоний кут', 'Red corner'), L('Синій кут', 'Blue corner')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state = null;
  let mySeat = -1;
  let groups = null; // доступні групи питань з /api/duel/categories

  const g = RoomClient.create({
    id: 'duel',
    title: L('Один на один', 'One on One'),
    defaults: { groups: ['personal', 'career', 'nation', 'money', 'stats', 'trophies', 'fame', 'instagram'], difficulty: 'normal', level: 'mix', mode: 'streak', lives: '1', rounds: '10', seconds: '10' },
    fixSetup(setup) {
      if (!DIFF_LABELS[setup.difficulty]) setup.difficulty = 'normal';
      if (!LEVEL_LABELS[setup.level]) setup.level = 'mix';
      if (!Array.isArray(setup.groups) || !setup.groups.length) setup.groups = ['career', 'nation', 'money'];
      if (groups) {
        const ok = setup.groups.filter((x) => groups.some((y) => y.id === x));
        setup.groups = ok.length ? ok : groups.map((y) => y.id);
      }
    },
    hints: {
      level: {
        easy: L('Числа сильно різняться — щонайменше в півтора раза.', 'The numbers are far apart — at least one and a half times.'),
        hard: L('Числа близькі — різниця до 20 %. Тут вирішують деталі.', 'The numbers are close — within 20%. Details decide.'),
        mix: L('І очевидні пари, і майже рівні.', 'Both obvious pairs and near ties.'),
      },
      mode: {
        streak: L('Переможець пари лишається на рингу, приходить новий суперник. Грай, доки не закінчаться помилки.', 'The winner stays in the ring and a new challenger steps in. Keep going until you run out of mistakes.'),
        rounds: L('10 або 20 пар, очко за кожну правильну відповідь.', '10 or 20 pairs, a point for each right answer.'),
      },
    },
    onSetup(setup) {
      $('#lives-field').classList.toggle('hidden', setup.mode !== 'streak');
      renderGroupsHint(setup);
    },
    createOptions: (s) => ({ ...s, rounds: Number(s.rounds), lives: Number(s.lives), seconds: Number(s.seconds) }),
    optionList: (o, solo) => [
      solo ? (o.mode === 'streak' ? L(`🔥 Серія · ${o.lives} ${pl(o.lives, ['помилка', 'помилки', 'помилок'], [])}`, `🔥 Streak · ${o.lives} ${pl(o.lives, [], ['mistake', 'mistakes'])}`)
        : L(`${o.rounds} пар`, `${o.rounds} pairs`)) : L(`${o.rounds} пар · ${o.seconds} с на відповідь`, `${o.rounds} pairs · ${o.seconds} s to answer`),
      DIFF_LABELS[o.difficulty], LEVEL_LABELS[o.level],
      (o.groups || []).map((id) => groups?.find((x) => x.id === id)?.title || id).join(', '),
    ],
    onState(s, prev) {
      state = s;
      mySeat = s.you;
      playSounds(prev, s);
    },
    renderGame,
    renderFinal,
  });
  const { $, emit, store, escapeHtml, initials, seatName, seatStyle } = g;

  // Групи, для яких на сервері є дані: недоступні чипи ховаємо; під чипами — які питання ввійдуть.
  fetch(`/api/duel/categories?lang=${window.I18n.lang}`).then((r) => r.json()).then((list) => {
    groups = list;
    document.querySelectorAll('[data-multi="groups"] .chip').forEach((c) => c.classList.toggle('hidden', !list.some((x) => x.id === c.dataset.val)));
    g.renderSetup(); // fixSetup прибере з вибору недоступні групи
  }).catch(() => {});

  function renderGroupsHint(setup) {
    const el = $('#groups-list');
    if (!el || !groups) return;
    const n = groups.filter((x) => setup.groups.includes(x.id)).reduce((s, x) => s + x.questions.length, 0);
    el.textContent = L(`${n} ${pl(n, ['питання', 'питання', 'питань'], [])} у грі`, `${n} ${pl(n, [], ['question', 'questions'])} in play`);
    el.title = groups.filter((x) => setup.groups.includes(x.id)).flatMap((x) => x.questions).join('\n');
  }

  function playSounds(p, s) {
    if (s.status !== 'playing') return;
    const newPair = s.phase === 'guess' && (!p || p.round !== s.round || p.phase !== 'guess');
    if (newPair) window.Sound.play('gong');
    if (s.phase === 'reveal' && p?.phase === 'guess') {
      const r = s.results[mySeat];
      setTimeout(() => window.Sound.play(r ? (r.correct ? 'hit' : 'miss') : 'pop'), reduced ? 0 : 950);
    }
  }

  // ── числа: «€180 млн», «1,5», «12 345»
  const fmt = (n, dec) => Number(n).toLocaleString(EN ? 'en-US' : 'uk-UA', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  const valueHtml = (v, to) => `${v.pre ? `<span class="v-aff pre">${escapeHtml(v.pre.trim())}</span>` : ''}<span class="num" data-to="${v.num}" data-dec="${v.dec || 0}">${fmt(to ?? v.num, v.dec)}</span>${v.post ? `<span class="v-aff">${escapeHtml(v.post.trim())}</span>` : ''}`;

  // Лічильник: обидва числа крутяться від нуля до свого; коли зупинились — половина переможця спалахує, іншого тьмяніє.
  function spin(ring) {
    const nums = [...ring.querySelectorAll('.num')];
    const done = () => ring.classList.add('settled');
    if (reduced) { nums.forEach((n) => (n.textContent = fmt(n.dataset.to, Number(n.dataset.dec)))); return done(); }
    const t0 = performance.now(), dur = 900;
    // рік народження крутиться від «круглої» дати, а не від нуля
    const from = nums.map((n) => (Number(n.dataset.to) > 1800 && Number(n.dataset.to) < 2100 ? Math.floor(Number(n.dataset.to) / 100) * 100 - 30 : 0));
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      nums.forEach((n, i) => {
        const to = Number(n.dataset.to), dec = Number(n.dataset.dec);
        const v = from[i] + (to - from[i]) * e;
        n.textContent = fmt(k < 1 ? (dec ? v : Math.round(v)) : to, dec);
      });
      if (k < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  }

  // ── гра
  let pairKey = null;
  let revealKey = null;

  function cornerHtml(s, i) {
    const p = s.pair[i];
    const meta = [p.nation ? `${p.nation.img ? `<img src="${p.nation.img}" alt="" loading="lazy" />` : ''}${escapeHtml(p.nation.name)}` : '', p.born ? `${p.born}` : '']
      .filter(Boolean).join(' · ');
    return `<span class="c-label">${CORNERS[i]}</span>
      ${s.champion === i ? `<span class="c-champ">🏆 ${L('Чемпіон', 'Champion')}</span>` : ''}
      <span class="c-photo">${p.photo ? `<img src="${p.photo}" alt="" />` : `<span class="c-initials">${escapeHtml(initials(p.name))}</span>`}</span>
      <span class="c-info">
        <b class="c-name">${escapeHtml(pname(p))}</b>
        <small class="c-meta">${meta}</small>
        <span class="c-value" id="value-${i}"></span>
      </span>
      <span class="c-picks" id="picks-${i}"></span>
      <span class="c-mine">${L('Твій вибір', 'Your pick')}</span>`;
  }

  function renderGame() {
    const s = state;
    const reveal = s.phase === 'reveal';
    $('#screen-game').classList.toggle('solo', s.solo);
    // верхній рядок: серія / пара N з M
    const info = s.options.mode === 'streak' && s.solo
      ? `<b>${L('Серія', 'Streak')}: <em class="run">${s.run}</em></b><span>${'🥊'.repeat(Math.max(0, s.lives))}${'<i class="lost">🥊</i>'.repeat(Math.max(0, s.options.lives - s.lives))} · ${L('рекорд', 'best')} ${Math.max(s.best, bestStored())}</span>`
      : `<b>${L(`Пара ${s.round} з ${s.rounds}`, `Pair ${s.round} of ${s.rounds}`)}</b><span>${s.solo ? L(`Рахунок: ${s.scores[mySeat]}`, `Score: ${s.scores[mySeat]}`) : `${DIFF_LABELS[s.options.difficulty]} · ${LEVEL_LABELS[s.options.level]}`}</span>`;
    $('#round-info').innerHTML = info;
    $('#question').textContent = s.question?.title || '';

    // кути перемальовуємо лише для нової пари (щоб не збивати анімацію)
    const ring = $('#ring');
    const key = `${s.round}:${s.pair.map((p) => p.id).join('|')}`;
    if (key !== pairKey) {
      pairKey = key;
      revealKey = null;
      ring.className = 'ring fresh';
      for (const i of [0, 1]) $(`#corner-${i}`).innerHTML = cornerHtml(s, i);
    }
    const mine = s.myPick ?? s.results[mySeat]?.side ?? null;
    for (const i of [0, 1]) {
      const c = $(`#corner-${i}`);
      c.disabled = reveal || mine != null;
      c.classList.toggle('mine', mine === i);
      c.classList.toggle('win', reveal && s.winner === i);
      c.classList.toggle('lose', reveal && s.winner !== i);
      c.setAttribute('aria-label', `${CORNERS[i]}: ${pname(s.pair[i])}`);
    }
    ring.classList.toggle('picked', mine != null);
    ring.classList.toggle('revealed', reveal);

    if (reveal && revealKey !== key) {
      revealKey = key;
      for (const i of [0, 1]) {
        const v = s.values[i];
        $(`#value-${i}`).innerHTML = `<span class="v-num">${valueHtml(v, reduced ? null : 0)}</span><small class="v-unit">${escapeHtml(s.question.unit)}</small>${v.detail ? `<small class="v-detail">${escapeHtml(v.detail)}</small>` : ''}`;
        // хто кого обрав (кімната)
        if (!s.solo) {
          $(`#picks-${i}`).innerHTML = Object.entries(s.results).filter(([, r]) => r.side === i)
            .map(([seat, r]) => `<span class="pick" style="${seatStyle(Number(seat))}">${escapeHtml(seatName(Number(seat)))}${r.fastest ? ' ⚡' : ''}${r.points ? ` +${r.points}` : ''}</span>`).join('');
        }
      }
      ring.classList.remove('settled');
      spin(ring);
    }

    renderAfter();
    $('#reactions').classList.toggle('hidden', s.solo);
    renderScoreboard();
    tick();
  }

  // Під рингом: під час пари — підказка; після — вердикт, пояснення даних і «далі».
  function renderAfter() {
    const s = state;
    const el = $('#after');
    if (s.phase === 'guess') {
      const mine = s.myPick;
      const waiting = s.solo ? '' : L(`Відповіли ${s.answered.length} з ${s.seats.filter((x) => x && x.connected).length}`, `${s.answered.length} of ${s.seats.filter((x) => x && x.connected).length} answered`);
      el.innerHTML = `<p class="hint center">${mine != null ? L('Відповідь прийнято — чекаємо інших…', 'Answer locked in — waiting for others…')
        : L('Тисни на того, хто переможе', 'Tap the one who wins')}${waiting ? ` · ${waiting}` : ''}</p>`;
      return;
    }
    if (s.phase !== 'reveal') { el.innerHTML = ''; return; }
    const r = s.results[mySeat];
    const verdict = !r ? L('Ти не встиг відповісти', 'You didn’t answer in time')
      : r.correct ? L(`Правильно!${r.points ? ` +${r.points}` : ''}${r.fastest ? ' ⚡ найшвидший' : ''}`, `Correct!${r.points ? ` +${r.points}` : ''}${r.fastest ? ' ⚡ fastest' : ''}`)
        : L('Ні — переміг інший кут', 'No — the other corner wins');
    const last = s.options.mode === 'streak' && s.solo ? s.lives <= 0 : s.round >= s.rounds;
    const iVoted = s.nextVotes.includes(mySeat);
    el.innerHTML = `<p class="verdict ${r?.correct ? 'good' : 'bad'}">${verdict}</p>
      <p class="q-note">${escapeHtml(s.question.note)}</p>
      <button id="next-btn" class="btn btn-primary btn-lg" ${iVoted ? 'disabled' : ''}>${last ? L('Підсумки', 'Results') : L('Наступна пара →', 'Next pair →')}</button>`;
    $('#next-btn').addEventListener('click', () => emit('next'));
  }

  const bestKey = () => `duel:best:${state.options.difficulty}:${state.options.level}:${state.options.lives}`;
  const bestStored = () => Number(store.get(bestKey())) || 0;

  // Таблиця кімнати: очки; під час пари — хто вже відповів, після — скільки отримав.
  let shownScores = {};
  function renderScoreboard() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a] || a - b);
    const top = s.scores[seats[0]];
    const leaders = seats.filter((i) => s.scores[i] === top);
    $('#table-title').textContent = s.solo ? L('Твій рахунок', 'Your score') : L('Таблиця', 'Standings');
    $('#scoreboard').innerHTML = seats.map((i) => {
      const place = seats.findIndex((j) => s.scores[j] === s.scores[i]) + 1;
      const r = s.results[i];
      const status = s.phase === 'reveal' ? (r ? `<span class="${r.correct ? 'gain' : 'st'}">${r.correct ? `+${r.points}${r.fastest ? '⚡' : ''}` : '✗'}</span>` : '<span class="st">—</span>')
        : s.answered.includes(i) ? '<span class="st">✓</span>' : '<span class="st thinking">…</span>';
      const crown = !s.solo && top > 0 && leaders.length === 1 && leaders[0] === i ? ' 👑' : '';
      const bump = shownScores[i] != null && s.scores[i] > shownScores[i] ? 'bump' : '';
      return `<li data-seat="${i}" style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'}">
        ${s.solo ? '' : `<span class="place">${place}</span>`}<span class="dot-p"></span>
        <span class="nm">${escapeHtml(seatName(i))}${crown}</span>${status}<b class="${bump}">${s.scores[i]}</b></li>`;
    }).join('');
    shownScores = Object.fromEntries(seats.map((i) => [i, s.scores[i]]));
  }

  // ── таймер відповіді (кімната) і «далі через…»
  let lastTick = -1;
  function tick() {
    const el = $('#timer');
    if (!state || state.status !== 'playing' || !state.deadline) { el.textContent = ''; el.classList.remove('low'); return; }
    const left = Math.max(0, Math.ceil((state.deadline - g.serverNow()) / 1000));
    el.textContent = state.phase === 'reveal' ? L(`далі через ${left} с`, `next in ${left}s`) : `⏱ ${left}`;
    el.classList.toggle('soft', state.phase === 'reveal');
    const low = state.phase === 'guess' && left <= 3;
    el.classList.toggle('low', low);
    if (low && left !== lastTick && left > 0 && state.myPick == null) window.Sound.play('tick');
    lastTick = left;
  }
  setInterval(tick, 250);

  // ── відповідь: клік по куту або клавіші ← → (1 / 2); Enter — далі
  async function answer(side) {
    if (!state || state.phase !== 'guess' || state.myPick != null) return;
    const res = await emit('answer', { side });
    if (res.error) g.toast(res.error, 'bad');
  }
  for (const i of [0, 1]) $(`#corner-${i}`).addEventListener('click', () => answer(i));
  document.addEventListener('keydown', (e) => {
    if (!state || state.status !== 'playing' || e.target.closest('input, textarea')) return;
    if (['ArrowLeft', '1'].includes(e.key)) answer(0);
    else if (['ArrowRight', '2'].includes(e.key)) answer(1);
    else if (e.key === 'Enter' && state.phase === 'reveal' && !$('#next-btn')?.disabled) { e.preventDefault(); emit('next'); }
  });

  // ── підсумок
  function renderFinal() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    const score = s.scores[mySeat];
    if (s.solo && s.options.mode === 'streak') {
      const best = bestStored();
      if (score > best) store.set(bestKey(), score);
      $('#final-title').textContent = L(`Серія: ${score} ${pl(score, ['перемога', 'перемоги', 'перемог'], [])}`, `Streak: ${score} ${pl(score, [], ['win', 'wins'])}`);
      $('#final-standings').innerHTML = `<li><span class="nm">${L('Рекорд', 'Best')} (${DIFF_LABELS[s.options.difficulty]}, ${LEVEL_LABELS[s.options.level]}, ${s.options.lives} ${L('пом.', 'mist.')})</span><span class="val">${Math.max(best, score)}${score > best && best ? L(' — новий!', ' — new!') : ''}</span></li>`;
    } else if (s.solo) {
      $('#final-title').textContent = L(`${score} з ${s.rounds}`, `${score} of ${s.rounds}`);
      $('#final-standings').innerHTML = '';
    } else {
      const top = s.scores[seats[0]];
      const winners = seats.filter((i) => s.scores[i] === top);
      $('#final-title').textContent = winners.length > 1 ? L('Нічия!', "It's a draw!") : winners[0] === mySeat ? L('Ти переміг! 🏆', 'You won! 🏆') : L(`Переміг ${seatName(winners[0])} 🏆`, `${seatName(winners[0])} won 🏆`);
      $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${s.scores[i] === top ? 'win' : ''}">
        <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))}</span><span class="val">${s.scores[i]} ${pl(s.scores[i], ...POINTS)}</span></li>`).join('');
    }
    $('#final-history').innerHTML = s.history.map((h) => {
      const r = h.results[mySeat];
      const names = h.players.map((p, i) => (i === h.winner ? `<b>${escapeHtml(pname(p))}</b>` : escapeHtml(pname(p)))).join(' — ');
      return `<li><span class="nm">${escapeHtml(h.question)}<small>${names}</small></span><span class="val">${r ? (r.correct ? `✓${r.points > 1 ? ` +${r.points}` : ''}` : '✗') : '—'}</span></li>`;
    }).join('');
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost);
    $('#again-wait').textContent = isHost || s.solo ? '' : L(`${s.seats[s.host]?.name || 'Господар'} може почати ще одну гру.`, `${s.seats[s.host]?.name || 'The host'} can start another game.`);
  }
})();
