// «All in» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js; тут — питання, оцінка,
// сукно з оцінками-клітинками, маркери й фішки, відповідь, таблиця фішок і підсумок.
(() => {
  const { DIFF: DIFF_LABELS } = RoomClient.LABELS;
  const { L, name: pname } = window.I18n;
  const EN = window.I18n.lang === 'en';
  const pl = (n, uk, en) => window.I18n.plural(n, uk, en);
  const CHIPS = [['фішка', 'фішки', 'фішок'], ['chip', 'chips']];
  const chipsText = (n) => `${fmt(n)} ${pl(Math.abs(n), ...CHIPS)}`;
  const LEVELS = [L('Вузька', 'Narrow'), L('Середня', 'Medium'), L('Широка', 'Wide')];
  const ALL_GROUPS = ['personal', 'career', 'nation', 'money', 'stats', 'trophies', 'fame', 'instagram'];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state = null;
  let mySeat = -1;
  let groups = null; // доступні групи питань з /api/allin/categories

  const secHint = (n) => L(`${n} с на оцінку й 25 с на ставки. Соло — без таймера.`, `${n} s to guess and 25 s to bet. Solo has no timer.`);
  const g = RoomClient.create({
    id: 'allin',
    title: 'All in',
    defaults: { groups: ALL_GROUPS, difficulty: 'normal', rounds: '7', seconds: '30' },
    fixSetup(setup) {
      if (!DIFF_LABELS[setup.difficulty]) setup.difficulty = 'normal';
      if (!Array.isArray(setup.groups) || !setup.groups.length) setup.groups = ALL_GROUPS;
      if (groups) {
        const ok = setup.groups.filter((x) => groups.some((y) => y.id === x));
        setup.groups = ok.length ? ok : groups.map((y) => y.id);
      }
    },
    hints: {
      seconds: { 20: secHint(20), 30: secHint(30), 45: secHint(45), 0: L('Без таймерів: раунд триває, доки всі не зроблять оцінку й ставки.', 'No timers: the round lasts until everyone has guessed and bet.') },
    },
    onSetup: (setup) => renderGroupsHint(setup),
    createOptions: (s) => ({ ...s, rounds: Number(s.rounds), seconds: Number(s.seconds) }),
    optionList: (o, solo) => [
      L(`${o.rounds} раундів`, `${o.rounds} rounds`),
      solo ? '' : o.seconds ? L(`⏱ ${o.seconds} с на оцінку`, `⏱ ${o.seconds} s to guess`) : L('без таймера', 'no timer'),
      DIFF_LABELS[o.difficulty],
      (o.groups || []).map((id) => groups?.find((x) => x.id === id)?.title || id).join(', '),
    ].filter(Boolean),
    onState(s, prev) {
      state = s;
      mySeat = s.you;
      if (s.status !== 'playing') qKey = stageKey = feltKey = null; // нова гра знову починається з роздачі 1 — малюємо все заново
      playSounds(prev, s);
    },
    renderGame,
    renderFinal,
  });
  const { $, emit, store, escapeHtml, initials, seatName, seatStyle } = g;

  fetch(`/api/allin/categories?lang=${window.I18n.lang}`).then((r) => r.json()).then((list) => {
    groups = list;
    document.querySelectorAll('[data-multi="groups"] .chip').forEach((c) => c.classList.toggle('hidden', !list.some((x) => x.id === c.dataset.val)));
    g.renderSetup();
  }).catch(() => {});

  function renderGroupsHint(setup) {
    const el = $('#groups-list');
    if (!el || !groups) return;
    const qs = groups.filter((x) => setup.groups.includes(x.id)).flatMap((x) => x.questions);
    el.textContent = L(`${qs.length} ${pl(qs.length, ['питання', 'питання', 'питань'], [])} у грі`, `${qs.length} ${pl(qs.length, [], ['question', 'questions'])} in play`);
    el.title = qs.join('\n');
  }

  // ── звуки: нове питання, табло з'явилось, чужі фішки лягли на сукно, відповідь
  function playSounds(p, s) {
    if (s.status !== 'playing') return;
    if (s.phase === 'guess' && (!p || p.round !== s.round || p.phase !== 'guess')) window.Sound.play('pop');
    if (s.phase === 'bet' && p?.phase !== 'bet') window.Sound.play('chips', 3);
    if (s.phase === 'bet' && p?.phase === 'bet') {
      const others = (x) => JSON.stringify(Object.entries(x.bets).filter(([k]) => Number(k) !== mySeat));
      if (others(p) !== others(s)) window.Sound.play('chips', 2);
    }
    if (s.phase === 'reveal' && p?.phase !== 'reveal') {
      const r = s.results[mySeat];
      window.Sound.play('chips', 6);
      setTimeout(() => window.Sound.play(r && r.net > 0 ? 'win' : r && r.net < 0 ? 'miss' : 'pop'), reduced ? 0 : 900);
    }
  }

  // ── числа: «1 234», роки без пробілу, гроші з десятою
  const fmt = (n, dec) => Number(n).toLocaleString(EN ? 'en-US' : 'uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: dec ? 1 : 0 });
  const num = (v) => (state.question?.year ? String(v) : fmt(v, state.question?.dec));
  const unitOf = (n, unit, forms) => (forms ? pl(n, forms, forms) : unit); // «1 гол», «3 голи», «5 голів»
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');

  // ── гра
  let qKey = null;
  let stageKey = null;
  let feltKey = null;
  let shownChips = new Set(); // фішки, що вже лежать на сукні (нові — «падають»)
  let myBets = [{ slot: -1, extra: 0 }, { slot: -1, extra: 0 }];
  let sel = 0; // який маркер зараз ставимо
  let soloLevel = 1;
  let soloExtra = 0;

  const bank = () => state.banks[mySeat] || 0;
  // роздача — це питання про конкретного гравця (номер роздачі в новій грі повторюється)
  const handKey = () => `${state.code}:${state.round}:${state.question?.id}:${state.question?.player.id}`;
  const online = () => state.seats.filter((x) => x && x.connected).length;

  function renderGame() {
    const s = state;
    $('#screen-game').classList.toggle('solo', s.solo);
    $('#round-info').innerHTML = `<b>${L(`Роздача ${s.round} з ${s.rounds}`, `Hand ${s.round} of ${s.rounds}`)}</b>`
      + (s.mult > 1 ? `<span class="final-round">${L('Фінальна роздача — виграші ×2', 'Final hand — winnings ×2')}</span>` : `<span class="level">${DIFF_LABELS[s.options.difficulty]}</span>`);
    renderQuestion();
    renderStage();
    $('#reactions').classList.toggle('hidden', s.solo);
    renderScoreboard();
    tick();
  }

  // Картка питання: фото гравця, збірна, питання — перемальовуємо лише для нової роздачі.
  function renderQuestion() {
    const s = state;
    const key = handKey();
    if (qKey === key) return;
    qKey = key;
    const q = s.question;
    const p = q.player;
    const meta = [p.nation ? `${p.nation.img ? `<img src="${p.nation.img}" alt="" loading="lazy" />` : ''}${escapeHtml(p.nation.name)}` : '', p.born ? L(`${p.born} р. н.`, `born ${p.born}`) : '']
      .filter(Boolean).join(' · ');
    $('#q-card').innerHTML = `<span class="q-photo">${p.photo ? `<img src="${p.photo}" alt="" />` : `<span class="q-initials">${escapeHtml(initials(p.name))}</span>`}</span>
      <span class="q-body">
        <b class="q-name">${escapeHtml(pname(p))}</b>
        ${meta ? `<small class="q-meta">${meta}</small>` : ''}
        <span class="q-text">${escapeHtml(q.text)}</span>
        <small class="q-unit">${L('Відповідь', 'Answer')}: ${escapeHtml(q.unit)}</small>
      </span>`;
  }

  // Етап під питанням: скелет — лише коли змінилась фаза (щоб не збивати введення), далі — оновлюємо живі частини.
  function renderStage() {
    const s = state;
    const key = `${handKey()}:${s.phase}`;
    const el = $('#stage');
    if (key !== stageKey) {
      stageKey = key;
      if (s.phase === 'guess') el.innerHTML = guessHtml();
      else if (s.phase === 'bet') {
        el.innerHTML = `<div class="felt" id="felt"></div><div class="bet-panel" id="bet-panel"></div>`;
        const mine = s.bets[mySeat];
        myBets = mine ? mine.map((b) => ({ ...b })) : [{ slot: -1, extra: 0 }, { slot: -1, extra: 0 }];
        sel = myBets[0].slot === -1 ? 0 : myBets[1].slot === -1 ? 1 : 0;
        shownChips = new Set();
      } else if (s.phase === 'reveal') {
        el.innerHTML = `${s.solo ? '' : '<div class="felt" id="felt"></div>'}<div class="reveal-box" id="reveal-box"></div>`;
        renderReveal();
      }
      if (s.phase === 'guess') bindGuess();
    }
    if (s.phase === 'guess') updateGuess();
    if (s.phase === 'bet') { renderFelt(); renderBetPanel(); }
    if (s.phase === 'reveal') { renderFelt(); updateReveal(); }
  }

  // ── оцінка
  function guessHtml() {
    const s = state;
    const q = s.question;
    const levels = s.solo ? `<div class="field"><span class="field-label">${L('Наскільки впевнений?', 'How sure are you?')}</span>
        <div class="chips levels" id="levels">${[0, 1, 2].map((i) => `<button type="button" class="chip" data-level="${i}"><b>${LEVELS[i]}</b> ${escapeHtml(q.ranges[i])} <em>×${s.rules.solo[i] * s.mult}</em></button>`).join('')}</div></div>
      <div class="stake" id="stake"></div>` : '';
    return `<form class="guess-form" id="guess-form" autocomplete="off">
        <label class="field-label" for="guess-input">${s.solo ? L('Твоя оцінка', 'Your guess') : L('Твоя оцінка — таємно', 'Your guess — secret')}</label>
        <div class="guess-row">
          <input id="guess-input" type="number" inputmode="${q.dec ? 'decimal' : 'numeric'}" min="0" step="${q.dec ? '0.1' : '1'}" placeholder="${q.year ? '2005' : '0'}" />
          <span class="g-unit">${escapeHtml(q.unit)}</span>
        </div>
        ${levels}
        <button class="btn btn-primary btn-lg" id="guess-btn">${s.solo ? L('Ставлю', 'Bet') : L('На стіл', 'On the table')}</button>
      </form>
      <p class="hint center" id="guess-status"></p>`;
  }

  function bindGuess() {
    const s = state;
    soloExtra = Math.min(soloExtra, bank());
    $('#guess-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const s = state;
      const value = $('#guess-input').value.trim();
      if (!value) { $('#guess-input').focus(); return; }
      const res = await emit('guess', s.solo ? { value, level: soloLevel, extra: soloExtra } : { value });
      if (res.error) g.toast(res.error, 'bad');
      else if (!s.solo) window.Sound.play('chips', 1);
    });
    if (s.solo) {
      $('#levels').addEventListener('click', (e) => {
        const b = e.target.closest('[data-level]');
        if (!b) return;
        soloLevel = Number(b.dataset.level);
        updateGuess();
      });
      bindStake($('#stake'), () => soloExtra, (v) => { soloExtra = v; updateGuess(); }, () => bank());
    }
    if (!matchMedia('(pointer: coarse)').matches) $('#guess-input').focus();
  }

  function updateGuess() {
    const s = state;
    if (s.solo) {
      document.querySelectorAll('#levels [data-level]').forEach((b) => b.classList.toggle('active', Number(b.dataset.level) === soloLevel));
      renderStake($('#stake'), soloExtra, bank(), L(`До маркера (${s.rules.free}) докласти`, `Add to your marker (${s.rules.free})`));
      $('#guess-status').textContent = L(`Влучиш у вилку — отримаєш ${fmt((s.rules.free + soloExtra) * s.rules.solo[soloLevel] * s.mult)}`, `Hit the range and you get ${fmt((s.rules.free + soloExtra) * s.rules.solo[soloLevel] * s.mult)}`);
      return;
    }
    const mine = s.myGuess;
    const waiting = L(`Оцінили ${s.guessed.length} з ${online()}`, `${s.guessed.length} of ${online()} guessed`);
    $('#guess-status').innerHTML = mine != null
      ? `${L('На столі', 'On the table')}: <b>${escapeHtml(num(mine))}</b> · ${L('можна змінити', 'you can change it')} · ${waiting}`
      : waiting;
    $('#guess-btn').textContent = mine != null ? L('Змінити', 'Change') : L('На стіл', 'On the table');
  }

  // ── ставка: −10 / +10 / +50 / ALL IN / 0
  function renderStake(el, value, max, label) {
    if (!el) return;
    el.innerHTML = `<span class="stake-label">${label}</span>
      <div class="stake-row">
        <button type="button" class="chip" data-d="-10" ${value <= 0 ? 'disabled' : ''}>−10</button>
        <output class="stake-val">${fmt(value)}</output>
        <button type="button" class="chip" data-d="10" ${value + 10 > max ? 'disabled' : ''}>+10</button>
        <button type="button" class="chip" data-d="50" ${value + 50 > max ? 'disabled' : ''}>+50</button>
        <button type="button" class="btn-allin" data-all ${max <= 0 || value === max ? 'disabled' : ''}>ALL IN</button>
        <button type="button" class="chip" data-zero ${value <= 0 ? 'disabled' : ''}>0</button>
      </div>`;
  }
  function bindStake(el, get, set, max) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.all != null) { set(max()); allInFlash(); return; }
      if (b.dataset.zero != null) return set(0);
      set(Math.max(0, Math.min(max(), get() + Number(b.dataset.d))));
      window.Sound.play('chips', 1);
    });
  }
  function allInFlash() {
    window.Sound.play('chips', 8);
    if (reduced) return;
    const f = document.createElement('div');
    f.className = 'allin-flash';
    f.textContent = 'ALL IN';
    document.body.append(f);
    setTimeout(() => f.remove(), 1100);
  }

  // ── сукно: «менше за всіх» + оцінки за зростанням, коефіцієнти, фішки гравців
  function renderFelt() {
    const s = state;
    const el = $('#felt');
    if (!el) return;
    const reveal = s.phase === 'reveal';
    const key = `${handKey()}:${s.phase}:${JSON.stringify(s.bets)}:${JSON.stringify(myBets)}:${s.ready.join()}`;
    if (key === feltKey) return;
    feltKey = key;
    const bets = { ...s.bets };
    if (!reveal && !s.ready.includes(mySeat)) bets[mySeat] = myBets; // свої — одразу, не чекаючи сервера
    const now = new Set();
    el.classList.toggle('revealed', reveal);
    el.classList.toggle('picking', !reveal && !s.ready.includes(mySeat));
    el.innerHTML = s.slots.map((slot, i) => {
      const chips = [];
      for (const [seat, list] of Object.entries(bets)) {
        list.forEach((b, m) => {
          if (b.slot !== i) return;
          const k = `${seat}:${m}:${i}:${b.extra}`;
          now.add(k);
          const amount = s.rules.free + b.extra;
          const big = b.extra >= 100 ? 'big' : b.extra > 0 ? 'mid' : '';
          chips.push(`<i class="token ${big} ${Number(seat) === mySeat ? 'mine' : ''} ${shownChips.has(k) || reveal ? '' : 'drop'}" style="${seatStyle(Number(seat))}" title="${escapeHtml(seatName(Number(seat)))}: ${amount}"><em>${fmt(amount)}</em></i>`);
        });
      }
      const odds = slot.odds * s.mult;
      const cls = [reveal && s.win === i ? 'win' : reveal ? 'lose' : '', !reveal && myBets[sel]?.slot === i ? 'sel' : '', slot.value == null ? 'low' : ''].join(' ');
      const authors = slot.names.map((n, k) => `<span class="author" style="${seatStyle(slot.authors[k])}">${escapeHtml(n)}</span>`).join('');
      const gain = reveal && s.win === i ? Object.entries(s.results).filter(([, r]) => r.win + r.bonus > 0)
        .map(([seat, r]) => `<span class="payout" style="${seatStyle(Number(seat))}">+${fmt(r.win + r.bonus)}</span>`).join('') : '';
      return `<button type="button" class="slot ${cls}" data-slot="${i}" ${reveal || s.ready.includes(mySeat) ? 'disabled' : ''}>
          <span class="s-odds">×${odds}</span>
          <b class="s-val">${slot.value == null ? L('Менше за всіх', 'Lower than all') : escapeHtml(num(slot.value))}</b>
          <span class="s-authors">${authors}</span>
          <span class="s-chips">${chips.join('')}</span>
          ${gain ? `<span class="s-payouts">${gain}</span>` : ''}
        </button>`;
    }).join('');
    shownChips = now;
    el.querySelectorAll('.slot').forEach((b) => b.addEventListener('click', () => placeMarker(Number(b.dataset.slot))));
  }

  function placeMarker(i) {
    if (state.phase !== 'bet' || state.ready.includes(mySeat)) return;
    // обраний маркер уже на сукні, а другий ще ні — ставимо другий; обидва стоять — переносимо обраний.
    // Обраним лишається щойно поставлений: «докласти фішок» стосується саме його.
    if (myBets[sel].slot !== -1 && myBets[1 - sel].slot === -1) sel = 1 - sel;
    myBets[sel].slot = i;
    window.Sound.play('chips', 1);
    sendBets();
  }
  async function sendBets() {
    renderFelt();
    renderBetPanel();
    const res = await emit('bet', { bets: myBets });
    if (res.error) g.toast(res.error, 'bad');
  }

  // Панель ставок: два маркери (який зараз ставимо), скільки докласти, «Готово».
  function renderBetPanel() {
    const s = state;
    const el = $('#bet-panel');
    if (!el) return;
    const locked = s.ready.includes(mySeat);
    const waiting = L(`Готові ${s.ready.length} з ${online()}`, `${s.ready.length} of ${online()} ready`);
    if (locked) {
      el.innerHTML = `<p class="hint center">${L('Ставки зроблено — чекаємо інших…', 'Bets locked — waiting for others…')} · ${waiting}</p>`;
      return;
    }
    const slotText = (b) => (b.slot === -1 ? L('не поставлено', 'not placed') : s.slots[b.slot].value == null ? L('менше за всіх', 'lower than all') : num(s.slots[b.slot].value));
    const other = myBets[1 - sel].extra;
    el.innerHTML = `<p class="hint center">${L('Тисни на оцінку, щоб поставити маркер. Свій чи чужий — неважливо.', 'Tap a guess to place a marker. Yours or someone else’s — it doesn’t matter.')}</p>
      <div class="markers">${myBets.map((b, m) => `<button type="button" class="marker ${m === sel ? 'active' : ''}" data-m="${m}" style="${seatStyle(mySeat)}">
          <i class="token mine"><em>${s.rules.free + b.extra}</em></i><span><b>${L('Маркер', 'Marker')} ${m + 1}</b><small>${escapeHtml(slotText(b))}${b.extra ? ` · +${fmt(b.extra)}` : ''}</small></span></button>`).join('')}</div>
      <div class="stake" id="bet-stake"></div>
      <button type="button" class="btn btn-primary btn-lg" id="done-btn" ${myBets.some((b) => b.slot >= 0) ? '' : 'disabled'}>${L('Ставки зроблено', 'Bets done')}</button>
      <p class="hint center">${L(`У стосі: ${chipsText(bank() - myBets[0].extra - myBets[1].extra)}`, `In your stack: ${chipsText(bank() - myBets[0].extra - myBets[1].extra)}`)} · ${waiting}</p>`;
    el.querySelectorAll('.marker').forEach((b) => b.addEventListener('click', () => { sel = Number(b.dataset.m); feltKey = null; renderFelt(); renderBetPanel(); }));
    const stake = $('#bet-stake');
    if (myBets[sel].slot === -1) stake.innerHTML = `<span class="stake-label">${L('Спершу постав маркер на оцінку — потім можна докласти фішок', 'Place the marker first — then you can add chips')}</span>`;
    else {
      renderStake(stake, myBets[sel].extra, bank() - other, L(`Докласти до маркера ${sel + 1}`, `Add to marker ${sel + 1}`));
      bindStake(stake, () => myBets[sel].extra, (v) => { myBets[sel].extra = v; sendBets(); }, () => bank() - myBets[1 - sel].extra);
    }
    $('#done-btn').addEventListener('click', async () => {
      const res = await emit('done');
      if (res.error) g.toast(res.error, 'bad');
    });
  }

  // ── відповідь
  function renderReveal() {
    const s = state;
    const a = s.answer;
    const r = s.results[mySeat];
    let verdict = '';
    if (s.solo && r) {
      const [lo, hi] = r.range.map((x) => (s.question.dec ? Math.round(x * 10) / 10 : Math.round(x)));
      verdict = `<p class="mine-line">${L('Твоя оцінка', 'Your guess')} <b>${escapeHtml(num(r.guess))}</b> · ${LEVELS[r.level]} ${L('вилка', 'range')} ${escapeHtml(num(lo))}–${escapeHtml(num(hi))}</p>
        <p class="verdict ${r.hit ? 'good' : 'bad'}">${r.hit ? L(`Влучив! ${signed(r.net)}`, `Hit! ${signed(r.net)}`) : r.extra ? L(`Повз вилку ${signed(r.net)}`, `Missed ${signed(r.net)}`) : L('Повз вилку', 'Missed the range')}</p>`;
    } else if (r) {
      const winV = s.slots[s.win].value;
      verdict = `<p class="mine-line">${winV == null ? L('Усі оцінки більші — виграє «менше за всіх»', 'Every guess was too high — “lower than all” wins') : L(`Виграла оцінка ${num(winV)}`, `The winning guess: ${num(winV)}`)}${r.bonus ? L(` — твоя! +${r.bonus}`, ` — yours! +${r.bonus}`) : ''}</p>
        <p class="verdict ${r.net > 0 ? 'good' : r.net < 0 ? 'bad' : ''}">${r.net > 0 ? L(`Виграш ${signed(r.net)}`, `You win ${signed(r.net)}`) : r.net < 0 ? L(`Програш ${signed(r.net)}`, `You lose ${signed(r.net)}`) : L('При своїх', 'Break even')}</p>`;
    }
    $('#reveal-box').innerHTML = `<small class="field-label">${L('Правильна відповідь', 'The answer')}</small>
      <b class="ans-num">${escapeHtml(num(a.value))} <span>${escapeHtml(unitOf(a.value, s.question.unit, s.question.forms))}</span></b>
      ${a.detail ? `<small class="ans-detail">${escapeHtml(a.detail)}</small>` : ''}
      ${verdict}
      <p class="q-note">${escapeHtml(s.question.note)}</p>
      <button id="next-btn" class="btn btn-primary btn-lg">${s.round >= s.rounds ? L('Підсумки', 'Results') : L('Наступна роздача →', 'Next hand →')}</button>`;
    $('#next-btn').addEventListener('click', () => emit('next'));
  }
  function updateReveal() {
    const b = $('#next-btn');
    if (b) b.disabled = state.nextVotes.includes(mySeat);
  }

  // ── таблиця: фішки; під час оцінки — хто вже оцінив, ставок — хто готовий, після — виграш/програш
  let shownBanks = {};
  function renderScoreboard() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.banks[b] - s.banks[a] || a - b);
    const top = s.banks[seats[0]];
    $('#table-title').textContent = s.solo ? L('Твій банк', 'Your bank') : L('Фішки', 'Chip count');
    $('#scoreboard').innerHTML = seats.map((i) => {
      const place = seats.findIndex((j) => s.banks[j] === s.banks[i]) + 1;
      const r = s.results[i];
      const status = s.phase === 'reveal' ? (r ? `<span class="${r.net > 0 ? 'gain' : 'st'}">${signed(r.net)}</span>` : '<span class="st">—</span>')
        : s.phase === 'bet' ? (s.ready.includes(i) ? '<span class="st">✓</span>' : '<span class="st thinking">…</span>')
          : s.guessed.includes(i) ? '<span class="st">✓</span>' : '<span class="st thinking">…</span>';
      const crown = !s.solo && seats.length > 1 && s.banks[i] === top && seats.filter((j) => s.banks[j] === top).length === 1 ? ' 👑' : '';
      const bump = shownBanks[i] != null && s.banks[i] > shownBanks[i] ? 'bump' : '';
      return `<li data-seat="${i}" style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'}">
        ${s.solo ? '' : `<span class="place">${place}</span>`}<span class="dot-p"></span>
        <span class="nm">${escapeHtml(seatName(i))}${crown}</span>${s.solo ? '' : status}<b class="${bump}">${fmt(s.banks[i])}</b></li>`;
    }).join('');
    shownBanks = Object.fromEntries(seats.map((i) => [i, s.banks[i]]));
  }

  // ── таймер
  let lastTick = -1;
  function tick() {
    const el = $('#timer');
    if (!state || state.status !== 'playing' || !state.deadline) { el.textContent = ''; el.classList.remove('low'); return; }
    const left = Math.max(0, Math.ceil((state.deadline - g.serverNow()) / 1000));
    el.textContent = state.phase === 'reveal' ? L(`далі через ${left} с`, `next in ${left}s`) : `⏱ ${left}`;
    el.classList.toggle('soft', state.phase === 'reveal');
    const waiting = state.phase === 'guess' ? state.myGuess == null : state.phase === 'bet' && !state.ready.includes(mySeat);
    const low = state.phase !== 'reveal' && left <= 5;
    el.classList.toggle('low', low);
    if (low && waiting && left !== lastTick && left > 0) window.Sound.play('tick');
    lastTick = left;
  }
  setInterval(tick, 200);

  document.addEventListener('keydown', (e) => {
    if (!state || state.status !== 'playing' || e.target.closest('input, textarea')) return;
    if (e.key === 'Enter' && state.phase === 'reveal' && !$('#next-btn')?.disabled) { e.preventDefault(); emit('next'); }
  });

  // ── підсумок
  const bestKey = () => `allin:best:${state.options.difficulty}:${state.options.rounds}`;
  function renderFinal() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.banks[b] - s.banks[a]);
    if (s.solo) {
      const score = s.banks[mySeat];
      const best = Number(store.get(bestKey())) || 0;
      if (score > best) store.set(bestKey(), score);
      $('#final-title').textContent = L(`Банк: ${chipsText(score)}`, `Bank: ${chipsText(score)}`);
      $('#final-standings').innerHTML = `<li><span class="nm">${L('Рекорд', 'Best')} (${DIFF_LABELS[s.options.difficulty]}, ${L(`${s.options.rounds} роздач`, `${s.options.rounds} hands`)})</span><span class="val">${fmt(Math.max(best, score))}${score > best && best ? L(' — новий!', ' — new!') : ''}</span></li>`;
    } else {
      const top = s.banks[seats[0]];
      const winners = seats.filter((i) => s.banks[i] === top);
      $('#final-title').textContent = winners.length > 1 ? L('Нічия!', "It's a draw!") : winners[0] === mySeat ? L('Ти зірвав банк! 🏆', 'You broke the bank! 🏆') : L(`Банк зірвав ${seatName(winners[0])} 🏆`, `${seatName(winners[0])} broke the bank 🏆`);
      $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${s.banks[i] === top ? 'win' : ''}">
        <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))}</span><span class="val">${chipsText(s.banks[i])}</span></li>`).join('');
    }
    $('#final-history').innerHTML = s.history.map((h) => {
      const r = h.results[mySeat];
      return `<li><span class="nm">${escapeHtml(h.question)}<small>${L('Відповідь', 'Answer')}: <b>${escapeHtml(h.year ? String(h.answer) : fmt(h.answer, true))} ${escapeHtml(unitOf(h.answer, h.unit, h.forms))}</b></small></span><span class="val">${r ? signed(r.net) : '—'}</span></li>`;
    }).join('');
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost);
    $('#again-wait').textContent = isHost || s.solo ? '' : L(`${s.seats[s.host]?.name || 'Господар'} може почати ще одну гру.`, `${s.seats[s.host]?.name || 'The host'} can start another game.`);
  }
})();
