// «Чотири четвірки» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js;
// тут — капсули-гравці, кошики знайдених груп, «Головоломка дня», підсумок.
(() => {
  const { DIFF: DIFF_LABELS } = RoomClient.LABELS;
  const { L, name: pname } = window.I18n;
  const pl = (n, uk, en) => window.I18n.plural(n, uk, en);
  const POINTS = [['очко', 'очки', 'очок'], ['point', 'points']];
  const EMOJI = ['🟨', '🟩', '🟦', '🟪'];
  const LINKS = ['A', 'B', 'C', 'D'];
  const DIFFS = ['easy', 'normal', 'fan'];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state = null;
  let mySeat = -1;
  // вибір і порядок капсул — лише в цьому браузері (перемішування нікому не заважає)
  let selected = new Set();
  let order = [];
  let roundKey = '';
  let shownPots = new Set(); // кошики, які вже «приземлились» (анімація — лише для нового)

  const g = RoomClient.create({
    id: 'fours',
    title: L('Чотири четвірки', 'Four Fours'),
    defaults: { difficulty: 'normal', mistakes: '4', rounds: '3', turnSeconds: '0' },
    fixSetup(setup) {
      if (!DIFFS.includes(setup.difficulty)) setup.difficulty = 'normal';
    },
    hints: {
      difficulty: {
        easy: L('Найвідоміші гравці; групи — клуби, збірні, чемпіонати.', 'The most famous players; groups are clubs, nations, leagues.'),
        normal: L('Відоміші гравці топ-ліг; від клубу до підступної групи — по одній кожного кольору.', 'Well-known players; one group of each colour, from a club to a tricky one.'),
        fan: L('Ширше коло гравців, більше пасток і складних груп: тренери, академії, роки, тезки.', 'A wider circle of players, more traps and hard groups: coaches, academies, years, namesakes.'),
      },
    },
    onSetup() {
      $('#points-rule').textContent = L('25 за кожну групу, −5 за помилку, підказки — −5, −10, −15…; усі чотири без помилок — +10; у кімнаті першому, хто розв\'язав, — ще +10.',
        '25 per group, −5 per mistake, hints −5, −10, −15…; all four without a mistake — +10; in a room the first to solve it gets another +10.');
      renderDaily();
    },
    createOptions: (s) => ({ difficulty: s.difficulty, rounds: Number(s.rounds), mistakes: Number(s.mistakes), turnSeconds: Number(s.turnSeconds) }),
    optionList: (o) => o.daily ? [L('Головоломка дня', 'Puzzle of the day')] : [DIFF_LABELS[o.difficulty],
      o.mistakes ? L(`${o.mistakes} помилки`, `${o.mistakes} mistakes`) : L('помилок без обмеження', 'unlimited mistakes'),
      `${o.rounds} ${pl(o.rounds, ['головоломка', 'головоломки', 'головоломок'], ['puzzle', 'puzzles'])}`,
      o.turnSeconds ? L(`${o.turnSeconds / 60} хв`, `${o.turnSeconds / 60} min`) : L('без таймера', 'no timer')],
    onState(s, prev) {
      state = s;
      mySeat = s.you;
      const key = `${s.code}:${s.round}`;
      if (s.status !== 'playing') roundKey = ''; // «Ще одна гра» знову починається з головоломки 1 — нова дошка
      else if (key !== roundKey) {
        roundKey = key;
        selected = new Set();
        order = s.board.map((p) => p.id);
        shownPots = new Set();
      }
      playSounds(prev, s);
      saveDaily(s);
    },
    renderGame,
    renderFinal,
  });
  const { $, emit, store, toast, ask, escapeHtml, initials, seatName, seatStyle } = g;

  function playSounds(p, s) {
    if (!p) return;
    const sameRound = p.round === s.round;
    if (sameRound && s.myFound.length > p.myFound.length) window.Sound.play(s.myFound.length === 4 ? 'win' : 'capsule');
    else if (sameRound && s.myMistakes > p.myMistakes) window.Sound.play('miss');
    else if (sameRound && s.myHintCost > p.myHintCost) window.Sound.play('pop');
    if (s.phase === 'guess' && (p.phase !== 'guess' || !sameRound)) window.Sound.play('whistle');
  }

  // ── «Головоломка дня»: дата за Києвом, результат — у цьому браузері
  const kyivDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
  const dailyKey = (date) => `fours:daily:${date}`;
  function dailyDone() {
    try { return JSON.parse(store.get(dailyKey(kyivDate())) || 'null'); } catch { return null; }
  }
  function renderDaily() {
    const done = dailyDone();
    $('#daily-note').textContent = done
      ? L(`✓ Сьогодні: ${done.found}/4, помилок — ${done.mistakes}. Можна поділитися або зіграти ще раз.`, `✓ Today: ${done.found}/4, ${done.mistakes} mistakes. Share it or play again.`)
      : L('Однакова для всіх — нова опівночі', 'The same for everyone — a new one at midnight');
    $('#daily-btn').classList.toggle('done', !!done);
  }
  function saveDaily(s) {
    if (!s.daily || !s.myResult || store.get(dailyKey(s.daily.date))) return;
    store.set(dailyKey(s.daily.date), JSON.stringify({ ...s.myResult, text: shareText(s) }));
  }
  $('#daily-btn').addEventListener('click', () => g.createRoom(true, { daily: true }));

  function shareText(s) {
    const title = s.daily ? `${L('Чотири четвірки', 'Four Fours')} №${s.daily.no}` : L('Чотири четвірки', 'Four Fours');
    const rows = s.myTries.filter((t) => t.colors).map((t) => t.colors.map((c) => EMOJI[c]).join(''));
    return `${title} ⚽\n${rows.join('\n')}\n${location.origin}/fours/`;
  }
  async function share(text) {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast(L('Результат скопійовано', 'Result copied'), 'good'); }
    } catch { /* скасовано */ }
  }

  // ── гра
  const photoHtml = (p) => (p.photo ? `<img src="${p.photo}" alt="" loading="lazy" />` : `<span>${escapeHtml(initials(p.name))}</span>`);

  // Кошик знайденої групи: назва ознаки + четверо гравців.
  function potHtml(group, { missed = false, fresh = false } = {}) {
    const icon = group.img ? `<img class="pot-img" src="${group.img}" alt="" loading="lazy" />` : `<span class="pot-icon">${escapeHtml(group.icon || '')}</span>`;
    return `<div class="pot c${group.color} ${missed ? 'missed' : ''} ${fresh ? 'fresh' : ''}">
      <div class="pot-head">${icon}<b>${escapeHtml(group.label)}</b>${missed ? `<small>${L('не знайдено', 'not found')}</small>` : ''}</div>
      <div class="pot-players">${group.players.map((p, i) => `<span class="pot-player" style="--i:${i}"><span class="pot-photo">${photoHtml(p)}</span><span class="pot-name">${escapeHtml(pname(p))}</span></span>`).join('')}</div>
    </div>`;
  }

  function renderGame() {
    const s = state;
    const reveal = s.phase === 'reveal';
    const mine = s.progress[mySeat] || { found: [], mistakes: 0, done: false };
    const over = mine.done || reveal;
    $('#screen-game').classList.toggle('solo', s.solo);
    const title = s.daily ? L(`Головоломка дня №${s.daily.no}`, `Puzzle of the day #${s.daily.no}`)
      : L(`Головоломка ${s.round} з ${s.rounds}`, `Puzzle ${s.round} of ${s.rounds}`);
    $('#round-info').innerHTML = `<b>${title}</b><span>${s.daily ? s.daily.date : DIFF_LABELS[s.options.difficulty]}</span>`;

    // кошики: знайдені — у порядку знаходження; після раунду — ще й незнайдені
    const foundColors = new Set(s.myFound.map((x) => x.color));
    const pots = [...s.myFound.map((x) => ({ group: x, missed: false }))];
    // хто закінчив раніше (помилки, «здатися») — бачить незнайдені лише після раунду: інші ще розв'язують
    if (reveal && s.groups) s.groups.filter((x) => !foundColors.has(x.color)).forEach((x) => pots.push({ group: x, missed: true }));
    $('#pots').innerHTML = pots.map(({ group, missed }) => {
      const fresh = !reduceMotion && !missed && !shownPots.has(group.color);
      shownPots.add(group.color);
      return potHtml(group, { missed, fresh });
    }).join('');

    // капсули: ще не розкладені гравці
    const taken = new Set(s.myFound.flatMap((x) => x.players.map((p) => p.id)));
    const byId = new Map(s.board.map((p) => [p.id, p]));
    const left = order.filter((id) => !taken.has(id) && byId.has(id));
    // підказки: гравці однієї групи — з однаковою літерою (не колір групи — він видав би рівень)
    const linkOf = new Map();
    (s.myHints || []).forEach(({ k, ids }) => ids.forEach((id) => linkOf.set(id, k)));
    for (const id of [...selected]) if (taken.has(id)) selected.delete(id);
    const showCaps = !reveal && !(mine.done && left.length === 0);
    $('#capsules').classList.toggle('hidden', !showCaps || reveal);
    $('#capsules').classList.toggle('locked', over);
    $('#capsules').innerHTML = left.map((id) => {
      const p = byId.get(id);
      const link = linkOf.get(id);
      return `<button type="button" class="capsule ${selected.has(id) ? 'on' : ''} ${link != null ? `linked l${link}` : ''}" data-id="${escapeHtml(id)}" ${over ? 'disabled' : ''}>
        ${link != null ? `<b class="cap-link" title="${L('Підказка: в одній групі', 'Hint: same group')}">${LINKS[link]}</b>` : ''}
        <span class="cap-photo">${photoHtml(p)}</span><span class="cap-name">${escapeHtml(pname(p))}</span></button>`;
    }).join('');

    // панель: помилки, кнопки
    $('#play-bar').classList.toggle('hidden', reveal);
    const max = s.options.mistakes;
    $('#mistakes').innerHTML = max
      ? `<span>${L('Помилки', 'Mistakes')}</span>${Array.from({ length: max }, (_, i) => `<i class="${i < mine.mistakes ? 'used' : ''}"></i>`).join('')}`
      : `<span>${L('Помилок', 'Mistakes')}: <b>${mine.mistakes}</b></span>`;
    $('#check-btn').disabled = over || selected.size !== 4;
    $('#clear-btn').disabled = over || !selected.size;
    $('#shuffle-btn').disabled = over;
    $('#giveup-btn').disabled = over;
    const hb = $('#hint-btn');
    hb.disabled = over || !s.nextHint;
    hb.textContent = s.nextHint ? `💡 ${L('Підказка', 'Hint')} −${s.nextHint}` : `💡 ${L('Підказка', 'Hint')}`;
    hb.title = s.nextHint ? L('Позначить двох гравців з однієї групи', 'Marks two players from the same group')
      : L('Остання група — підказка не потрібна', 'Last group — no hint needed');
    // скільки зараз: знайдені групи − помилки − підказки (+10, якщо досі без помилок і знайдеш усі)
    const now = Math.max(0, mine.found.length * s.points.group - mine.mistakes * s.points.mistake - (s.myHintCost || 0));
    // розклад: «5 = 25 за групи − 5 за помилки − 15 за підказки» — щоб було видно, з чого число
    const nf = mine.found.length;
    const parts = [
      nf ? L(`${nf * s.points.group} за ${nf === 1 ? 'групу' : 'групи'}`, `${nf * s.points.group} for ${nf === 1 ? 'the group' : 'groups'}`) : '',
      mine.mistakes ? `− ${mine.mistakes * s.points.mistake} ${L(`за ${mine.mistakes === 1 ? 'помилку' : 'помилки'}`, mine.mistakes === 1 ? 'for a mistake' : 'for mistakes')}` : '',
      s.myHintCost ? `− ${s.myHintCost} ${L('за підказки', 'for hints')}` : '',
    ].filter(Boolean);
    // ще жодної групи — штрафи віднімуться від майбутніх: «0 · −5 за помилку — віднімуться від груп»
    const sum = nf ? (parts.length > 1 ? ` = ${parts.join(' ')}` : '')
      : parts.length ? ` · ${parts.join(' ')} ${L('— віднімуться від груп', '— taken off your groups')}` : '';
    $('#score-now').innerHTML = over ? '' : L(`Зараз у тебе <b>${now}</b>${sum} · наступна група +${s.points.group}${mine.mistakes ? '' : ` · усі без помилок — ще +${s.points.perfect}`}`,
      `You have <b>${now}</b> now${sum} · next group +${s.points.group}${mine.mistakes ? '' : ` · all without a mistake — another +${s.points.perfect}`}`);
    const r = s.myResult;
    $('#play-hint').textContent = r
      ? (r.found === 4 ? L(`✓ Усі чотири! +${r.points}. Чекаємо інших…`, `✓ All four! +${r.points}. Waiting for others…`)
        : L(`Головоломка закінчилась: ${r.found}/4, +${r.points}. Чекаємо інших…`, `Puzzle over: ${r.found}/4, +${r.points}. Waiting for others…`))
      : L(`Обрано ${selected.size} з 4`, `${selected.size} of 4 selected`);

    // після раунду
    const rv = $('#reveal');
    rv.classList.toggle('hidden', !reveal);
    if (reveal) {
      const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
      const results = seats.map((i) => {
        const res = s.progress[i]?.result;
        return `<li style="${seatStyle(i)}"><span class="dot-p"></span>${escapeHtml(seatName(i))}<b>${res ? `${res.found}/4 · ${L('помилок', 'mistakes')} ${res.mistakes}${res.hints ? ` · 💡${res.hints}` : ''} · +${res.points}${res.first ? ' ⚡' : ''}${res.perfect ? ' ✨' : ''}` : '—'}</b></li>`;
      }).join('');
      const iVoted = s.nextVotes.includes(mySeat);
      rv.innerHTML = `${s.solo ? '' : `<ul class="round-results">${results}</ul>`}
        <div class="reveal-actions">
          <button id="share-btn" class="btn btn-secondary">${L('Поділитися', 'Share')}</button>
          <button id="next-btn" class="btn btn-primary btn-lg" ${iVoted ? 'disabled' : ''}>${s.round >= s.rounds ? L('Підсумки', 'Results') : L('Наступна головоломка →', 'Next puzzle →')}</button>
        </div>`;
      $('#next-btn').addEventListener('click', () => emit('next'));
      $('#share-btn').addEventListener('click', () => share(shareText(s)));
    }

    $('#reactions').classList.toggle('hidden', s.solo);
    renderScoreboard();
    tick();
  }

  // вибір капсул
  $('#capsules').addEventListener('click', (e) => {
    const b = e.target.closest('.capsule');
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    if (selected.has(id)) selected.delete(id);
    else if (selected.size < 4) selected.add(id);
    else return toast(L('Уже обрано чотирьох', 'Four already selected'));
    window.Sound.play('tick');
    renderGame();
  });
  $('#clear-btn').addEventListener('click', () => { selected = new Set(); renderGame(); });
  $('#shuffle-btn').addEventListener('click', () => {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    renderGame();
  });
  $('#check-btn').addEventListener('click', async () => {
    if (selected.size !== 4) return;
    const ids = [...selected];
    const res = await emit('check', { ids });
    if (res.error) return toast(res.error, 'bad');
    if (res.correct) {
      selected = new Set();
      renderGame();
    } else {
      if (res.oneAway) toast(L('Майже! Один зайвий', 'One away!'), 'bad');
      if (!reduceMotion) {
        document.querySelectorAll('.capsule.on').forEach((el) => {
          el.classList.remove('shake');
          void el.offsetWidth;
          el.classList.add('shake');
        });
      }
    }
  });
  $('#hint-btn').addEventListener('click', async () => {
    const res = await emit('hint');
    if (res.error) toast(res.error, 'bad');
  });
  $('#giveup-btn').addEventListener('click', async () => {
    if (await ask(L('Здатися в цій головоломці?', 'Give up this puzzle?'), { note: L('Очки — лише за вже знайдені групи.', 'You keep points only for groups already found.'), ok: L('🏳️ Здатися', '🏳️ Give up'), danger: true })) emit('giveUp');
  });

  // Таблиця: очки + знайдені групи кольорами й помилки (без імен — щоб не підказати).
  let shownScores = {};
  function renderScoreboard() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a] || a - b);
    const top = s.scores[seats[0]];
    const leaders = seats.filter((i) => s.scores[i] === top);
    $('#table-title').textContent = s.solo ? L('Твій рахунок', 'Your score') : L('Таблиця', 'Standings');
    $('#scoreboard').innerHTML = seats.map((i) => {
      const place = seats.findIndex((j) => s.scores[j] === s.scores[i]) + 1;
      const pr = s.progress[i] || { found: [], mistakes: 0 };
      const balls = [0, 1, 2, 3].map((k) => `<i class="${k < pr.found.length ? `c${pr.found[k]}` : ''}"></i>`).join('');
      const crown = !s.solo && top > 0 && leaders.length === 1 && leaders[0] === i ? ' 👑' : '';
      const bump = shownScores[i] != null && s.scores[i] > shownScores[i] ? 'bump' : '';
      return `<li data-seat="${i}" style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'}">
        <div class="sb-line">${s.solo ? '' : `<span class="place">${place}</span>`}<span class="dot-p"></span>
        <span class="nm">${escapeHtml(seatName(i))}${crown}</span><b class="${bump}">${s.scores[i]}</b></div>
        ${s.status === 'playing' ? `<div class="sb-progress"><span class="sb-balls">${balls}</span>${pr.mistakes ? `<span class="sb-miss">✗${pr.mistakes}</span>` : ''}</div>` : ''}</li>`;
    }).join('');
    shownScores = Object.fromEntries(seats.map((i) => [i, s.scores[i]]));
  }

  // ── таймер
  function tick() {
    const el = $('#timer');
    if (!state || state.status !== 'playing' || !state.deadline) { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((state.deadline - g.serverNow()) / 1000));
    el.textContent = state.phase === 'reveal' ? L(`далі через ${left} с`, `next in ${left}s`) : `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    el.classList.toggle('low', state.phase === 'guess' && left <= 15);
  }
  setInterval(tick, 250);

  // ── підсумок
  function renderFinal() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    const max = s.rounds * (4 * s.points.group + s.points.perfect);
    if (s.solo) {
      $('#final-title').textContent = L(`${s.scores[mySeat]} з ${max} очок`, `${s.scores[mySeat]} of ${max} points`);
      if (s.daily) {
        $('#final-standings').innerHTML = `<li><span class="nm">${L(`Головоломка дня №${s.daily.no}`, `Puzzle of the day #${s.daily.no}`)}</span><span class="val">${s.daily.date}</span></li>`;
      } else {
        const key = `fours:best:${s.options.difficulty}:${s.options.mistakes}:${s.rounds}`;
        const best = Number(store.get(key)) || 0;
        if (s.scores[mySeat] > best) store.set(key, s.scores[mySeat]);
        $('#final-standings').innerHTML = `<li><span class="nm">${L('Рекорд', 'Best')} (${DIFF_LABELS[s.options.difficulty]}, ${s.rounds})</span><span class="val">${Math.max(best, s.scores[mySeat])}${s.scores[mySeat] > best && best ? L(' — новий!', ' — new!') : ''}</span></li>`;
      }
    } else {
      const top = s.scores[seats[0]];
      const winners = seats.filter((i) => s.scores[i] === top);
      $('#final-title').textContent = winners.length > 1 ? L('Нічия!', "It's a draw!") : winners[0] === mySeat ? L('Ти переміг! 🏆', 'You won! 🏆') : L(`Переміг ${seatName(winners[0])} 🏆`, `${seatName(winners[0])} won 🏆`);
      $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${s.scores[i] === top ? 'win' : ''}">
        <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))}</span><span class="val">${s.scores[i]} ${pl(s.scores[i], ...POINTS)}</span></li>`).join('');
    }
    $('#final-history').innerHTML = s.history.map((h, n) => {
      const mine = h.results[mySeat];
      return `<li class="fh"><span class="nm">${s.rounds > 1 ? `${n + 1}. ` : ''}${h.groups.map((x) => `<span class="fh-group c${x.color}">${escapeHtml(x.label)}</span>`).join('')}</span><span class="val">${mine ? `+${mine.points}` : '—'}</span></li>`;
    }).join('');
    const daily = s.daily && dailyDone();
    $('#final-share').classList.toggle('hidden', !daily);
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost || !!s.daily);
    $('#again-wait').textContent = isHost || s.solo ? '' : L(`${s.seats[s.host]?.name || 'Господар'} може почати ще одну гру.`, `${s.seats[s.host]?.name || 'The host'} can start another game.`);
  }
  $('#final-share').addEventListener('click', () => { const d = dailyDone(); if (d) share(d.text); });
})();
