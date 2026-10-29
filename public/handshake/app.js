// «Правило рукостискань» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js;
// тут — комутатор: ланцюжок від старту до фінішу, введення наступної ланки, підказки, підсумок.
(() => {
  const { DIFF: DIFF_LABELS } = RoomClient.LABELS;
  const { L, name: pname } = window.I18n;
  const EN = window.I18n.lang === 'en';
  const pl = (n, uk, en) => window.I18n.plural(n, uk, en);
  const POINTS = [['очко', 'очки', 'очок'], ['point', 'points']];
  const STEPS = [['крок', 'кроки', 'кроків'], ['step', 'steps']];
  const DIFFS = ['easy', 'normal', 'fan'];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state = null;
  let mySeat = -1;
  let shownLinks = { key: '', n: 0 }; // скільки ланок уже «підключено» (анімація кабелю — лише для нової)

  const g = RoomClient.create({
    id: 'handshake',
    title: L('Правило рукостискань', 'Handshake Rule'),
    defaults: { difficulty: 'normal', mistakes: '3', rounds: '5', turnSeconds: '0' },
    fixSetup(setup) {
      if (!DIFFS.includes(setup.difficulty)) setup.difficulty = 'normal';
    },
    hints: {
      difficulty: {
        easy: L('Двоє найвідоміших гравців, а між ними треба знайти одного: хто грав і з тим, і з тим?', 'Two of the most famous players, and you need one in between: who played with both?'),
        normal: L('Двоє найвідоміших гравців, а між ними треба знайти двох.', 'Two of the most famous players, and you need two in between.'),
        fan: L('Старт і фініш — відомі гравці топ-ліг і збірних, між ними три-чотири кроки.', 'Start and finish are well-known players from top leagues and national teams, three or four steps apart.'),
      },
    },
    onSetup() {
      $('#points-rule').textContent = L('за найкоротший ланцюжок — 100. Кожна зайва ланка забирає 20, помилка — 10, підказка з клубом — 15, перша літера — 25. Якщо дійшов до фінішу, отримаєш щонайменше 10. У кімнаті той, хто першим дійде найкоротшим шляхом, отримує ще 10.',
        '100 for the shortest chain. Each extra link costs 20, a mistake 10, the club hint 15, the initial 25. If you reach the finish, you get at least 10. In a room, the first to finish by the shortest way gets 10 more.');
    },
    createOptions: (s) => ({ difficulty: s.difficulty, rounds: Number(s.rounds), mistakes: Number(s.mistakes), turnSeconds: Number(s.turnSeconds) }),
    optionList: (o) => [DIFF_LABELS[o.difficulty],
      o.mistakes ? L(`${o.mistakes} помилки`, `${o.mistakes} mistakes`) : L('помилок без обмеження', 'unlimited mistakes'),
      `${o.rounds} ${pl(o.rounds, ['раунд', 'раунди', 'раундів'], ['round', 'rounds'])}`,
      o.turnSeconds ? L(`${o.turnSeconds / 60} хв на раунд`, `${o.turnSeconds / 60} min per round`) : L('без таймера', 'no timer')],
    onState(s, prev) {
      state = s;
      mySeat = s.you;
      playSounds(prev, s);
    },
    renderGame,
    renderFinal,
  });
  const { $, emit, store, toast, ask, escapeHtml, initials, seatName, seatStyle } = g;

  function playSounds(p, s) {
    if (!p) return;
    const sameRound = p.round === s.round;
    if (sameRound && s.myResult?.done && !p.myResult) window.Sound.play('win');
    else if (sameRound && s.myChain.length > p.myChain.length) window.Sound.play('plug');
    else if (sameRound && s.myMistakes > p.myMistakes) window.Sound.play('miss');
    if (s.phase === 'guess' && (p.phase !== 'guess' || !sameRound)) window.Sound.play('whistle');
  }

  // ── комутатор
  const photoHtml = (p) => (p.photo ? `<img src="${p.photo}" alt="" loading="lazy" />` : `<span>${escapeHtml(initials(p.name))}</span>`);
  const linkTag = (l) => (l ? `<span class="cable-tag">${l.img ? `<img src="${l.img}" alt="" loading="lazy" />` : ''}<b>${escapeHtml(l.club)}</b><small>${escapeHtml(l.years)}</small></span>` : '');

  function jackHtml(p, { role = '', link = null, fresh = false, i = 0 } = {}) {
    const label = role === 'start' ? L('Старт', 'Start') : role.startsWith('finish') ? L('Фініш', 'Finish') : `${i}`;
    return `<li class="jack ${role} ${fresh ? 'fresh' : ''}">
      ${link ? `<span class="cable" aria-hidden="true"></span>${linkTag(link)}` : ''}
      <span class="plate"><span class="lamp"></span><small>${escapeHtml(label)}</small></span>
      <span class="j-photo">${photoHtml(p)}</span>
      <span class="j-name">${escapeHtml(pname(p))}</span></li>`;
  }

  // Ланцюжок у підсумку — компактно, одним рядком з клубами.
  function chainLine(chain) {
    return `<span class="chain-line">${chain.map((x, i) => `${i ? `<span class="cl-link">${x.link?.img ? `<img src="${x.link.img}" alt="" loading="lazy" />` : ''}${escapeHtml(x.link?.club || '')}</span>` : ''}<span class="cl-player"><span class="cl-photo">${photoHtml(x.player)}</span>${escapeHtml(pname(x.player))}</span>`).join('')}</span>`;
  }

  function renderGame() {
    const s = state;
    const reveal = s.phase === 'reveal';
    const r = s.myResult;
    const over = !!r || reveal;
    $('#screen-game').classList.toggle('solo', s.solo);
    $('#round-info').innerHTML = `<b>${L(`Раунд ${s.round} з ${s.rounds}`, `Round ${s.round} of ${s.rounds}`)}</b><span>${DIFF_LABELS[s.options.difficulty]} · ${L(`найкоротший — ${s.steps} ${pl(s.steps, ...STEPS)}`, `shortest — ${s.steps} ${pl(s.steps, ...STEPS)}`)}</span>`;

    // ланцюжок: старт, ланки; фініш — унизу (підключений, коли дійшов)
    const key = `${s.code}:${s.round}`;
    if (shownLinks.key !== key) shownLinks = { key, n: 1 };
    const chain = s.myChain;
    const reached = r?.done;
    const body = reached ? chain.slice(0, -1) : chain;
    $('#chain').innerHTML = body.map((x, i) => jackHtml(x.player, { role: i ? '' : 'start', link: x.link, i, fresh: !reduceMotion && i >= shownLinks.n })).join('');
    const finLink = reached ? chain[chain.length - 1].link : null;
    $('#finish').innerHTML = `<ol class="chain">${jackHtml(s.finish, { role: `finish ${reached ? 'on' : ''}`, link: finLink, fresh: !reduceMotion && reached && chain.length > shownLinks.n })}</ol>`;
    shownLinks.n = chain.length;

    // введення наступної ланки
    $('#answer-box').classList.toggle('hidden', over);
    const input = $('#link-input');
    input.disabled = over;
    if (over) { input.value = ''; renderSuggestions(); }
    const lastName = pname(chain[chain.length - 1].player);
    input.placeholder = L(`Хто грав разом з ним? (${lastName})`, `Who played with him? (${lastName})`); // імена не відмінюємо
    const max = s.options.mistakes;
    $('#lamps').innerHTML = max
      ? `<span>${L('Помилки', 'Mistakes')}</span>${Array.from({ length: max }, (_, i) => `<i class="${i < s.myMistakes ? 'burnt' : ''}"></i>`).join('')}`
      : `<span>${L('Помилок', 'Mistakes')}: <b>${s.myMistakes}</b></span>`;
    const last = chain[chain.length - 1].player.id;
    const hinted = s.myHints.find((h) => h.after === last && (h.kind || 'club') === 'club');
    const lettered = s.myHints.find((h) => h.after === last && h.kind === 'letter');
    $('#hint-btn').textContent = L(`💡 Через який клуб? −${s.points.hint}`, `💡 Which club? −${s.points.hint}`);
    $('#hint-btn').disabled = over || !!hinted;
    $('#letter-btn').textContent = L(`🔤 Перша літера прізвища −${s.points.letter}`, `🔤 Surname initial −${s.points.letter}`);
    $('#letter-btn').disabled = over || !!lettered;
    $('#hint-list').innerHTML = (hinted
      ? `<li>${hinted.img ? `<img src="${hinted.img}" alt="" />` : ''}${L(`Наступного гравця шукай у клубі <b>${escapeHtml(hinted.club)}</b>`, `Look for the next player at <b>${escapeHtml(hinted.club)}</b>`)}</li>` : '')
      + (lettered ? `<li><span class="hint-letter">${escapeHtml(lettered.letter)}</span>${L(`Прізвище наступного гравця починається на <b>${escapeHtml(lettered.letter)}</b>`, `The next player’s surname starts with <b>${escapeHtml(lettered.letter)}</b>`)}</li>` : '');
    // скільки буде, якщо дійти звідси найкоротшим шляхом — змінюється після помилки, підказки, зайвої ланки
    $('#score-now').innerHTML = !over && s.myPotential != null
      ? L(`Дійдеш звідси найкоротшим шляхом — <b>+${s.myPotential}</b>`, `Reach the finish by the shortest way from here — <b>+${s.myPotential}</b>`) : '';
    $('#giveup-btn').disabled = over;
    $('#answer-hint').textContent = r
      ? (r.done ? L(`✓ З'єднано за ${r.links} ${pl(r.links, ...STEPS)}: +${r.points}. Чекаємо інших…`, `✓ Connected in ${r.links} ${pl(r.links, ...STEPS)}: +${r.points}. Waiting for others…`)
        : L('Цей раунд для тебе закінчився — чекаємо інших…', 'This round is over for you — waiting for others…'))
      : '';
    $('#switchboard').classList.toggle('done', over);

    // після раунду: найкоротший ланцюжок і ланцюжки всіх
    const rv = $('#reveal');
    rv.classList.toggle('hidden', !reveal);
    if (reveal) {
      const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
      const others = !s.solo
        ? `<ul class="round-results">${seats.map((i) => {
          const res = s.progress[i]?.result;
          return `<li style="${seatStyle(i)}"><span class="rr-head"><span class="dot-p"></span>${escapeHtml(seatName(i))}<b>${res?.done ? `${res.links} ${pl(res.links, ...STEPS)} · +${res.points}${res.first ? ' ⚡' : ''}` : L('не дійшов', "didn't make it")}</b></span>${res?.done && i !== mySeat ? chainLine(s.progress[i].chain) : ''}</li>`;
        }).join('')}</ul>` : '';
      const iVoted = s.nextVotes.includes(mySeat);
      rv.innerHTML = (s.best ? `<div class="best"><small>${L('Найкоротший ланцюжок', 'The shortest chain')}</small>${chainLine(s.best)}</div>` : '')
        + others
        + `<div class="reveal-actions"><button id="next-btn" class="btn btn-primary btn-lg" ${iVoted ? 'disabled' : ''}>${s.round >= s.rounds ? L('Підсумки', 'Results') : L('Наступна пара →', 'Next pair →')}</button></div>`;
      $('#next-btn').addEventListener('click', () => emit('next'));
    }

    $('#reactions').classList.toggle('hidden', s.solo);
    renderScoreboard();
    tick();
  }

  $('#hint-btn').addEventListener('click', () => g.act('hint', { kind: 'club' }));
  $('#letter-btn').addEventListener('click', () => g.act('hint', { kind: 'letter' }));
  $('#giveup-btn').addEventListener('click', async () => {
    if (await ask(L('Здатися в цьому раунді?', 'Give up this round?'), { note: L('Очок за нього не буде.', 'You will get no points for it.'), ok: L('🏳️ Здатися', '🏳️ Give up'), danger: true })) emit('giveUp');
  });

  // ── вибір гравця
  const input = $('#link-input');
  let suggestions = [];
  let active = 0;

  function renderSuggestions() {
    const list = $('#suggestions');
    if (!input.value.trim() || input.disabled) { list.innerHTML = ''; suggestions = []; return; }
    suggestions = window.Players.search(input.value);
    const used = new Set((state?.myChain || []).map((x) => x.player.id));
    const shamed = window.Players.shame(input.value); // росіяни — сірі, вибрати не можна
    list.innerHTML = (suggestions.length
      ? suggestions.map((p, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''} ${used.has(p.id) ? 'used' : ''}">
          <span class="s-avatar">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy" />` : escapeHtml(initials(p.name))}</span>
          <span class="s-text"><span class="s-main">${escapeHtml(pname(p))}</span><span class="s-sub">${EN ? (p.born || '') : `${escapeHtml(p.name)}${p.born ? ` · ${p.born}` : ''}`}</span></span>
          ${used.has(p.id) ? `<span class="s-flag">${L('уже в ланцюжку', 'already in the chain')}</span>` : ''}</li>`).join('')
      : shamed ? '' : `<li class="empty">${L('Нікого не знайдено', 'No one found')}</li>`) + shamed;
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
    const last = state.myChain[state.myChain.length - 1].player;
    const res = await emit('add', { playerId: p.id });
    if (res.error) return toast(res.error, 'bad');
    if (!res.linked) toast(L(`${pname(p)} і ${pname(last)} разом не грали`, `${pname(p)} and ${pname(last)} never played together`), 'bad');
    if (!input.disabled) input.focus();
  }

  // ── таблиця: очки + кількість ланок (без імен — щоб не підказати)
  let shownScores = {};
  function renderScoreboard() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a] || a - b);
    const top = s.scores[seats[0]];
    const leaders = seats.filter((i) => s.scores[i] === top);
    $('#table-title').textContent = s.solo ? L('Твій рахунок', 'Your score') : L('Таблиця', 'Standings');
    $('#scoreboard').innerHTML = seats.map((i) => {
      const place = seats.findIndex((j) => s.scores[j] === s.scores[i]) + 1;
      const pr = s.progress[i] || { links: 0, mistakes: 0 };
      const res = pr.result;
      const status = res ? (res.done ? `<span class="gain">+${res.points}</span>` : '<span class="st">✗</span>')
        : s.phase === 'guess' ? `<span class="st thinking">🔌 ${pr.links}${pr.mistakes ? ` · ✗${pr.mistakes}` : ''}</span>` : '';
      const crown = !s.solo && top > 0 && leaders.length === 1 && leaders[0] === i ? ' 👑' : '';
      const bump = shownScores[i] != null && s.scores[i] > shownScores[i] ? 'bump' : '';
      return `<li data-seat="${i}" style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'}">
        ${s.solo ? '' : `<span class="place">${place}</span>`}<span class="dot-p"></span>
        <span class="nm">${escapeHtml(seatName(i))}${crown}</span>${status}<b class="${bump}">${s.scores[i]}</b></li>`;
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
    const max = s.rounds * s.points.max;
    if (s.solo) {
      $('#final-title').textContent = L(`${s.scores[mySeat]} з ${max} очок`, `${s.scores[mySeat]} of ${max} points`);
      const key = `handshake:best:${s.options.difficulty}:${s.options.mistakes}:${s.rounds}`;
      const best = Number(store.get(key)) || 0;
      if (s.scores[mySeat] > best) store.set(key, s.scores[mySeat]);
      $('#final-standings').innerHTML = `<li><span class="nm">${L('Рекорд', 'Best')} (${DIFF_LABELS[s.options.difficulty]}, ${s.rounds})</span><span class="val">${Math.max(best, s.scores[mySeat])}${s.scores[mySeat] > best && best ? L(' — новий!', ' — new!') : ''}</span></li>`;
    } else {
      const top = s.scores[seats[0]];
      const winners = seats.filter((i) => s.scores[i] === top);
      $('#final-title').textContent = winners.length > 1 ? L('Нічия!', "It's a draw!") : winners[0] === mySeat ? L('Ти переміг! 🏆', 'You won! 🏆') : L(`Переміг ${seatName(winners[0])} 🏆`, `${seatName(winners[0])} won 🏆`);
      $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${s.scores[i] === top ? 'win' : ''}">
        <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))}</span><span class="val">${s.scores[i]} ${pl(s.scores[i], ...POINTS)}</span></li>`).join('');
    }
    $('#final-history').innerHTML = s.history.map((h) => {
      const mine = h.results[mySeat];
      return `<li class="fh">${chainLine(h.best)}<span class="val">${mine?.done ? `+${mine.points}` : '—'}</span></li>`;
    }).join('');
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost);
    $('#again-wait').textContent = isHost || s.solo ? '' : L(`${s.seats[s.host]?.name || 'Господар'} може почати ще одну гру.`, `${s.seats[s.host]?.name || 'The host'} can start another game.`);
  }
})();
