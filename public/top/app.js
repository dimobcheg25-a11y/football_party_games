// «Топ-10» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js; тут — тема, дошка топу, відповіді.
(() => {
  const { L, name: pname } = window.I18n; // мова — /shared/i18n.js; теми й помилки сервер уже шле мовою гравця
  const pl = (n, uk, en) => window.I18n.plural(n, uk, en);
  const CATEGORY_LABELS = {
    transfers: L('💶 Трансфери', '💶 Transfers'), goals: L('⚽ Голи', '⚽ Goals'), assists: L('🎯 Асисти', '🎯 Assists'),
    apps: L('👕 Матчі й кар’єра', '👕 Appearances & career'), cards: L('🟨 Картки', '🟨 Cards'),
    trophies: L('🏆 Трофеї', '🏆 Trophies'), ballon: L('🥇 Золотий м’яч', '🥇 Ballon d’Or'), awards: L('🏅 Нагороди', '🏅 Awards'), height: L('📏 Зріст', '📏 Height'),
  };
  const MODE_LABELS = { own: L('кожен свій топ', 'everyone their own top'), turns: L('спільний топ по черзі', 'one shared top, taking turns') };
  const LEVEL_LABELS = {
    easy: L('🟢 легкі теми', '🟢 easy topics'), normal: L('🟡 середні теми', '🟡 medium topics'), hard: L('🔴 складні теми', '🔴 hard topics'),
    mix: L('🎲 теми будь-якої складності', '🎲 topics of any difficulty'),
  };
  const LEVEL_DOT = { easy: '🟢', normal: '🟡', hard: '🔴' };
  const MODE_HINTS = {
    own: L('Усі заповнюють свій топ одночасно. Чужих відповідей не видно, лише скільки хто знайшов.', 'Everyone fills in their own top at the same time. You don’t see others’ answers, only how many they’ve found.'),
    turns: L('Одна дошка на всіх, називаєте по черзі. За помилку або пас втрачаєш життя.', 'One board for everyone, you take turns naming. A miss or a pass costs you a life.'),
  };

  let state = null;
  let mySeat = -1;

  const g = RoomClient.create({
    id: 'top',
    title: L('Топ-10', 'Top 10'),
    defaults: { categories: Object.keys(CATEGORY_LABELS), size: '10', topicLevel: 'mix', pick: 'random', mode: 'own', lives: '3', roundSeconds: '180', turnSeconds: '30', rounds: '5' },
    fixSetup(setup) {
      if (!Array.isArray(setup.categories) || !setup.categories.length) setup.categories = Object.keys(CATEGORY_LABELS);
      if (setup.mode === 'turns' && setup.lives === '0') setup.lives = '3'; // по черзі без життів раунд не закінчиться
    },
    onSetup(setup) {
      $('#mode-hint').textContent = MODE_HINTS[setup.mode];
      $('#lives-inf').classList.toggle('hidden', setup.mode === 'turns');
      // час на раунд діє і в соло (соло — завжди «кожен свій»), тож поле не ховаємо — лише підписуємо
      const timeLabel = $('#round-time-field .field-label');
      timeLabel.dataset.base ??= timeLabel.textContent;
      timeLabel.textContent = setup.mode === 'turns' ? L(`${timeLabel.dataset.base} у соло`, `${timeLabel.dataset.base} (solo)`) : timeLabel.dataset.base;
      $('#turn-time-field').classList.toggle('hidden', setup.mode !== 'turns');
    },
    hints: {
      topicLevel: {
        easy: L('Теми з найвідомішими гравцями: відповіді знає кожен, хто дивиться футбол.', 'Topics full of famous players: anyone who watches football knows the answers.'),
        normal: L('Середні теми: багато відомих імен, але є й несподівані.', 'Medium topics: plenty of famous names, with a few surprises.'),
        hard: L('Складні теми: менш відомі гравці, ліги й клуби — для справжніх фанатів.', 'Hard topics: lesser-known players, leagues and clubs — for true fans.'),
        mix: L('Теми будь-якої складності впереміш.', 'Topics of any difficulty, mixed.'),
      },
      pick: {
        random: L('Кожен раунд — випадкова тема обраної складності.', 'Each round gets a random topic of the chosen difficulty.'),
        host: L('Перед раундом господар сам обирає тему зі списку (з фільтрами за категорією, країною, клубом).', 'Before each round the host picks a topic from the list (filter by category, country, club).'),
      },
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
  const { $, emit, store, toast, ask, escapeHtml, initials, seatName, seatStyle } = g;
  const hearts = (n) => (n == null ? '' : n ? '♥'.repeat(n) : '💔'); // серця телешоу — колір з CSS

  function optionList(o, solo) {
    return [o.categories.map((c) => CATEGORY_LABELS[c]).join(' '), L(`Топ-${o.size}`, `Top ${o.size}`), solo ? null : MODE_LABELS[o.mode],
      o.lives ? `${o.lives} ${pl(o.lives, ['помилка', 'помилки', 'помилок'], ['mistake', 'mistakes'])}` : L('помилки без обмежень', 'unlimited mistakes'),
      o.mode === 'turns' ? (o.turnSeconds ? L(`${o.turnSeconds} с на хід`, `${o.turnSeconds} s per turn`) : L('хід без таймера', 'no turn timer'))
        : o.roundSeconds ? L(`${o.roundSeconds / 60} хв на раунд`, `${o.roundSeconds / 60} min per round`) : L('без таймера', 'no timer'),
      `${o.rounds} ${pl(o.rounds, ['раунд', 'раунди', 'раундів'], ['round', 'rounds'])}`, o.pick === 'host' ? L('тему обирає господар', 'host picks topics') : L('випадкові теми', 'random topics'),
      LEVEL_LABELS[o.topicLevel || 'mix']].filter(Boolean);
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
    $('#round-info').innerHTML = `<b>${L(`Раунд ${s.round} з ${s.rounds}`, `Round ${s.round} of ${s.rounds}`)}</b><span>${L(`Топ-${s.options.size}`, `Top ${s.options.size}`)}${s.solo ? '' : ` · ${MODE_LABELS[s.options.mode]}`}</span>`;
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

  // Вибір теми господарем: фільтри (категорія, тип, країна) + пошук; список згрупований за клубами / типами.
  const KIND_LABELS = {
    general: L('⭐ Загальні', '⭐ General'), club: L('🏟 Клуби', '🏟 Clubs'), league: L('🏆 Чемпіонати', '🏆 Leagues'), season: L('📅 Рекорди сезону', '📅 Season records'),
    nation: L('🌍 Збірні', '🌍 National teams'), tournament: L('🏅 Турніри', '🏅 Tournaments'), misc: L('🧩 Вік, позиція, переходи', '🧩 Age, position, moves'),
    player: L('👤 Партнери гравця', '👤 A player’s teammates'), year: L('🗓 Окремі роки', '🗓 Single years'),
  };
  let topicList = null;
  let topicKey = '';
  const filter = { level: 'all', category: 'all', kind: 'all', country: 'all' }; // пам'ятаємо між раундами
  async function renderPicker() {
    const box = $('#picker');
    const isHost = mySeat === state.host;
    if (!isHost) {
      const host = escapeHtml(state.seats[state.host]?.name || L('Господар', 'The host'));
      box.innerHTML = `<div class="stage-box"><p>${L(`${host} обирає тему раунду…`, `${host} is picking the round topic…`)}</p></div>`;
      box.dataset.mode = 'wait';
      return;
    }
    if (box.dataset.mode === 'pick') return; // уже намальовано — не збиваємо пошук
    box.dataset.mode = 'pick';
    box.innerHTML = `<div class="stage-box picker-box">
      <div class="picker-head"><p>${L('<b>Обери тему раунду</b> — або довірся випадку.', '<b>Pick the round topic</b> — or leave it to chance.')}</p><button class="btn btn-primary" id="random-topic">${L('🎲 Випадкова', '🎲 Random')}</button></div>
      <input id="topic-filter" placeholder="${L('Пошук: клуб, збірна, країна…', 'Search: club, national team, country…')}" autocomplete="off" />
      <div id="topic-filters" class="topic-filters"></div>
      <p class="hint" id="topic-count"></p>
      <div class="topic-list" id="topic-list"><p class="empty">${L('Завантаження…', 'Loading…')}</p></div></div>`;
    $('#random-topic').addEventListener('click', () => chooseTopic(null));
    $('#topic-filter').addEventListener('input', drawTopics);
    $('#topic-filters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      filter[b.dataset.f] = b.dataset.v;
      drawTopics();
    });
    $('#topic-list').addEventListener('click', (e) => {
      const item = e.target.closest('[data-id]');
      if (item) chooseTopic(item.dataset.id);
    });
    const key = `${state.options.categories.join(',')}|${state.options.size}`;
    if (key !== topicKey) {
      topicKey = key;
      topicList = null;
      try {
        topicList = await (await fetch(`/api/top/topics?categories=${state.options.categories.join(',')}&size=${state.options.size}&lang=${window.I18n.lang}`)).json();
      } catch { topicList = []; }
    }
    drawTopics();
  }

  // Рядок чипів-фільтра: «Усі» + варіанти (у порядку values) з кількістю тем.
  function chipRow(label, field, values, names) {
    const uniq = [...new Set(values)];
    if (uniq.length < 2 && filter[field] === 'all') return '';
    const count = (v) => values.filter((x) => x === v).length;
    return `<div class="f-row"><span class="field-label">${label}</span><div class="chips">
      <button type="button" class="chip ${filter[field] === 'all' ? 'active' : ''}" data-f="${field}" data-v="all">${L('Усі', 'All')}</button>
      ${uniq.map((v) => `<button type="button" class="chip ${filter[field] === v ? 'active' : ''}" data-f="${field}" data-v="${escapeHtml(v)}">${escapeHtml(names?.[v] || v)} <small>${count(v)}</small></button>`).join('')}
    </div></div>`;
  }

  function drawTopics() {
    const list = $('#topic-list');
    if (!list || !topicList) return;
    const norm = window.Players.normalize;
    const q = norm($('#topic-filter').value);
    const byText = topicList.filter((t) => !q || norm(`${t.title} ${t.country || ''}`).includes(q));
    // кожен фільтр рахуємо з урахуванням решти — у чипах лише ті варіанти, що дають теми
    const pass = (t, skip) => (skip === 'level' || filter.level === 'all' || t.level === filter.level)
      && (skip === 'category' || filter.category === 'all' || t.category === filter.category)
      && (skip === 'kind' || filter.kind === 'all' || t.kind === filter.kind)
      && (skip === 'country' || filter.country === 'all' || t.country === filter.country);
    const catOrder = Object.keys(CATEGORY_LABELS);
    const kindOrder = Object.keys(KIND_LABELS);
    const levelOrder = ['easy', 'normal', 'hard'];
    const levels = byText.filter((t) => pass(t, 'level')).map((t) => t.level).sort((a, b) => levelOrder.indexOf(a) - levelOrder.indexOf(b));
    const cats = byText.filter((t) => pass(t, 'category')).map((t) => t.category).sort((a, b) => catOrder.indexOf(a) - catOrder.indexOf(b));
    const kinds = byText.filter((t) => pass(t, 'kind')).map((t) => t.kind).sort((a, b) => kindOrder.indexOf(a) - kindOrder.indexOf(b));
    const countries = byText.filter((t) => pass(t, 'country') && t.country).map((t) => t.country);
    // країни: Україна першою, далі — де більше тем
    const freq = {};
    countries.forEach((c) => (freq[c] = (freq[c] || 0) + 1));
    const ua = L('Україна', 'Ukraine');
    countries.sort((a, b) => (b === ua) - (a === ua) || freq[b] - freq[a] || a.localeCompare(b, window.I18n.lang));
    // вибраний варіант зник (інші фільтри його відсікли) — скидаємо на «Усі»
    for (const [field, values] of [['level', levels], ['category', cats], ['kind', kinds], ['country', countries]]) {
      if (filter[field] !== 'all' && !values.includes(filter[field])) { filter[field] = 'all'; return drawTopics(); }
    }
    $('#topic-filters').innerHTML = chipRow(L('Складність', 'Difficulty'), 'level', levels, { easy: L('🟢 Легкі', '🟢 Easy'), normal: L('🟡 Середні', '🟡 Medium'), hard: L('🔴 Складні', '🔴 Hard') })
      + chipRow(L('Категорія', 'Category'), 'category', cats, CATEGORY_LABELS) + chipRow(L('Тип', 'Type'), 'kind', kinds, KIND_LABELS)
      + (filter.kind === 'general' || filter.kind === 'tournament' ? '' : chipRow(L('Країна', 'Country'), 'country', countries));

    // найпопулярніші теми — зверху (групи — у порядку своєї найпопулярнішої теми)
    const found = byText.filter((t) => pass(t)).sort((a, b) => b.score - a.score);
    $('#topic-count').textContent = `${found.length} ${pl(found.length, ['тема', 'теми', 'тем'], ['topic', 'topics'])}`;
    // групи: клуби — за назвою клубу (усередині — коротка назва теми), решта — за типом
    const groups = new Map();
    for (const t of found) {
      const name = t.kind === 'club' ? `${t.club}${filter.country === 'all' && t.country && !t.club.includes('(') ? ` · ${t.country}` : ''}` : KIND_LABELS[t.kind];
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(t);
    }
    const short = (t) => (t.kind === 'club' ? t.title.replace(/:\s.*$/, '') : t.title);
    list.innerHTML = found.length
      ? [...groups].map(([name, items]) => `<section class="t-group"><h4>${escapeHtml(name)}</h4><div class="t-items">${items
        .map((t) => `<button type="button" class="t-item" data-id="${escapeHtml(t.id)}" title="${escapeHtml(t.title)}"><span>${CATEGORY_LABELS[t.category].split(' ')[0]}</span>${escapeHtml(short(t))}<i class="lvl">${LEVEL_DOT[t.level] || ''}</i></button>`).join('')}</div></section>`).join('')
      : `<p class="empty">${L('Нічого не знайдено — зміни фільтри або пошук', 'Nothing found — change the filters or the search')}</p>`;
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
    // інша тема — господар (у соло — сам), поки в раунді ще ніхто нічого не назвав
    $('#skip-topic-btn').classList.toggle('hidden', !(s.canSkip && s.host === mySeat));
    const lives = turns ? (s.order.includes(mySeat) ? s.lives[mySeat] : null) : s.mine?.livesLeft ?? (s.options.lives || null);
    $('#lives').innerHTML = s.options.lives && lives != null
      ? `<span class="lives-label">${L('Помилок лишилось', 'Mistakes left')}:</span> <b>${hearts(lives)}</b>` : '';
    if (turns) {
      const playing = s.order.includes(mySeat);
      $('#turn-line').innerHTML = s.active === mySeat ? L('<b>Твій хід!</b> Назви когось із топу.', '<b>Your turn!</b> Name someone from the top.')
        : s.active >= 0 ? `${L('Хід', 'Turn')}: <b class="pc" style="${seatStyle(s.active)}">${escapeHtml(seatName(s.active))}</b>` : '';
      $('#answer-hint').textContent = !playing ? L('Ти зайшов посеред раунду — граєш з наступного.', 'You joined mid-round — you’ll play from the next one.')
        : s.lives[mySeat] === 0 ? L('Життя закінчились — ти вибув до кінця раунду.', 'Out of lives — you’re out until the end of the round.') : '';
    } else {
      $('#turn-line').innerHTML = '';
      const found = s.mine?.found.length || 0;
      $('#answer-hint').textContent = s.mine?.done
        ? L(`Твій топ закрито: ${found} з ${s.slots.length}. Чекаємо інших…`, `Your top is closed: ${found} of ${s.slots.length}. Waiting for others…`)
        : found ? L(`Знайдено ${found} з ${s.slots.length}`, `Found ${found} of ${s.slots.length}`) : '';
    }
    const spent = s.hintSpent?.[mySeat] || 0;
    $('#round-sum').innerHTML = spent ? roundSum(mySeat)
      : canHint() ? L('Не знаєш когось? Натисни 💡 біля місця — покажемо першу літеру прізвища. Скільки це коштує, написано на кнопці.',
        'Stuck? Tap 💡 next to a place and we’ll show the first letter of the surname. The cost is on the button.') : '';
  }

  const signed = (n) => (n < 0 ? `−${-n}` : `+${n}`);
  // «За раунд: +7 — 12 за вгаданих, мінус 5 за підказки»
  function roundSum(seat) {
    const net = state.roundPoints[seat] || 0;
    const spent = state.hintSpent?.[seat] || 0;
    const head = `${L('За раунд', 'This round')}: <b>${signed(net)}</b>`;
    return spent ? `${head} — ${L(`${net + spent} за вгаданих, мінус ${spent} за підказки`, `${net + spent} for correct answers, minus ${spent} for hints`)}` : head;
  }

  // Підказку можна взяти, поки сам граєш у раунді (свій топ не закрито / є життя в черзі).
  function canHint() {
    const s = state;
    if (s.phase !== 'guess') return false;
    if (s.options.mode === 'turns') return s.order.includes(mySeat) && s.lives[mySeat] > 0;
    return !(s.mine?.done);
  }
  const ptsWord = (n) => pl(n, ['очко', 'очки', 'очок'], ['point', 'points']);

  function slotHtml(slot, i, extra = '') {
    const by = slot.by?.length && !state.solo
      ? `<span class="by">${slot.by.map((x) => `<i class="dot-p" style="${seatStyle(x)}" title="${escapeHtml(seatName(x))}"></i>`).join('')}</span>` : '';
    const miss = slot.missing ? `<small class="miss-note">${L('гравця немає в нашій базі, тож відкрили одразу', 'not in our database, so it’s shown right away')}</small>` : '';
    if (!slot.player) {
      // порожнє місце: своя підказка — літера; ні — кнопка з ціною саме цього місця
      const letter = myHints.get(i);
      const blank = letter
        ? `<span class="blank hinted" title="${L('Перша літера прізвища', 'First letter of the surname')}">${escapeHtml(letter)}…</span>`
        : '<span class="blank">?</span>';
      let hint = '';
      if (letter) hint = `<small class="hint-paid">${L(`підказка −${slot.hintCost}`, `hint −${slot.hintCost}`)}</small>`;
      else if (slot.hintCost && canHint()) {
        const title = L(`Показати першу літеру прізвища — мінус ${slot.hintCost} ${ptsWord(slot.hintCost)}`, `Show the first letter of the surname — minus ${slot.hintCost} ${ptsWord(slot.hintCost)}`);
        hint = `<button type="button" class="slot-hint" data-hint="${i}" title="${escapeHtml(title)}">💡 −${slot.hintCost}</button>`;
      }
      return `<li class="slot empty-slot ${extra}"><span class="place">${i + 1}</span>${blank}${hint}<span class="pts">+${slot.points}</span></li>`;
    }
    const p = slot.player;
    return `<li class="slot ${extra}"><span class="place">${i + 1}</span>
      <span class="g-photo">${p.photo ? `<img src="${p.photo}" alt="" loading="lazy" />` : escapeHtml(initials(p.name))}</span>
      <span class="who"><b>${escapeHtml(pname(p))}</b>${slot.detail ? `<small>${escapeHtml(slot.detail)}</small>` : ''}${miss}</span>
      <span class="val">${escapeHtml(slot.text)}</span>${by}<span class="pts">${slot.missing ? '' : `+${slot.points}`}</span></li>`;
  }

  let lastFound = new Set();
  let myHints = new Map(); // місце → літера
  function renderBoard(turns) {
    const s = state;
    myHints = new Map((s.myHints || []).map((h) => [h.i, h.letter]));
    const reveal = s.phase === 'reveal';
    const mineFound = new Map((s.mine?.found || []).map((f) => [f.i, f]));
    const nowFound = new Set();
    $('#board').innerHTML = s.slots.map((slot, i) => {
      let shown = slot;
      let cls = '';
      if (!reveal && !turns && mineFound.has(i)) shown = { ...mineFound.get(i), by: [] };
      if (shown.player) nowFound.add(i);
      if (slot.missing) cls = 'missing';
      else if (reveal) cls = (turns ? slot.by.length : slot.by.includes(mySeat)) ? 'got' : 'missed';
      else if (shown.player) cls = 'got';
      if (shown.player && !reveal && !slot.missing && !lastFound.has(i)) cls += ' fresh';
      return slotHtml(shown, i, cls);
    }).join('');
    lastFound = reveal ? new Set() : nowFound;
  }

  function renderMisses(turns) {
    const s = state;
    const list = turns ? s.wrong : (s.mine?.wrong || []).map((player) => ({ seat: mySeat, player }));
    $('#misses').innerHTML = list.length
      ? `<span class="field-label">${L('Мимо', 'Misses')}</span>${list.map((w) => `<span class="miss" style="${seatStyle(w.seat)}">${turns ? `<i class="dot-p"></i>` : ''}${w.player ? escapeHtml(pname(w.player)) : L('пас', 'pass')}</span>`).join('')}`
      : '';
  }

  function renderRevealBar() {
    const s = state;
    const bar = $('#reveal-bar');
    bar.classList.toggle('hidden', s.phase !== 'reveal');
    if (s.phase !== 'reveal') return;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => (s.roundPoints[b] || 0) - (s.roundPoints[a] || 0));
    const iVoted = s.nextVotes.includes(mySeat);
    const spentNote = (i) => (s.hintSpent?.[i] ? `<small class="hint-paid">${L(`підказки −${s.hintSpent[i]}`, `hints −${s.hintSpent[i]}`)}</small>` : '');
    bar.innerHTML = `${s.solo ? `<p class="verdict">${roundSum(mySeat)}</p>`
      : `<ul class="round-results">${seats.map((i) => `<li style="${seatStyle(i)}"><span class="dot-p"></span>${escapeHtml(seatName(i))}${spentNote(i)}<b>${signed(s.roundPoints[i] || 0)}</b></li>`).join('')}</ul>`}
      <div class="reveal-actions"><button id="next-btn" class="btn btn-primary btn-lg" ${iVoted ? 'disabled' : ''}>${s.round >= s.rounds ? L('Підсумки', 'Results') : L('Наступна тема →', 'Next topic →')}</button></div>`;
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
    $('#table-title').textContent = s.solo ? L('Твій рахунок', 'Your score') : L('Таблиця', 'Standings');
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
    const shamed = window.Players.shame(input.value); // росіяни — сірі, вибрати не можна
    list.innerHTML = (suggestions.length
      ? suggestions.map((p, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''}">
          <span class="s-avatar">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy" />` : escapeHtml(initials(p.name))}</span>
          <span class="s-text"><span class="s-main">${escapeHtml(pname(p))}</span><span class="s-sub">${window.I18n.lang === 'en' ? (p.born || '') : `${escapeHtml(p.name)}${p.born ? ` · ${p.born}` : ''}`}</span></span></li>`).join('')
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
    const res = await emit('guess', { playerId: p.id });
    if (res.error) return toast(res.error, 'bad');
    if (res.correct) {
      window.Sound.play('ding');
      toast(L(`${pname(p)} — на ${res.places.map((i) => `${i + 1}-му`).join(' і ')} ${res.places.length > 1 ? 'місцях' : 'місці'}: +${res.points}`,
        `${pname(p)} — #${res.places.map((i) => i + 1).join(', #')}: +${res.points}`), 'good');
    } else {
      window.Sound.play('miss');
      toast(L(`${pname(p)} — немає в топі`, `${pname(p)} — not in the top`), 'bad');
    }
    if (!input.disabled) input.focus();
  }

  $('#board').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-hint]');
    if (!b) return;
    const i = Number(b.dataset.hint);
    const slot = state.slots[i];
    const ok = await ask(L(`Підказка для ${i + 1}-го місця?`, `A hint for #${i + 1}?`), {
      note: L(`Покажемо першу літеру прізвища й одразу знімемо ${slot.hintCost} ${ptsWord(slot.hintCost)}. Якщо потім вгадаєш, отримаєш за це місце ${slot.points} ${ptsWord(slot.points)}, тож разом вийде ${slot.points - slot.hintCost}.`,
        `We’ll show the first letter of the surname and take ${slot.hintCost} ${ptsWord(slot.hintCost)} right away. If you then guess him, you get ${slot.points} ${ptsWord(slot.points)} for this place, so ${slot.points - slot.hintCost} in total.`),
      ok: `💡 −${slot.hintCost}`,
    });
    if (!ok) return;
    const res = await emit('hint', { place: i });
    if (res.error) return toast(res.error, 'bad');
    window.Sound.play('pop');
  });
  $('#skip-topic-btn').addEventListener('click', () => g.act('skipTopic'));
  $('#pass-btn').addEventListener('click', async () => {
    if (await ask(L('Пас?', 'Pass?'), { note: L('Це забере одне життя.', 'It costs one life.'), ok: L('Пас', 'Pass') })) emit('pass');
  });
  $('#giveup-btn').addEventListener('click', async () => {
    const found = state.mine?.found.length || 0;
    const pts = state.roundPoints?.[mySeat] || 0;
    const what = state.solo ? L('Раунд закінчиться, і ти побачиш увесь топ.', 'The round ends and you’ll see the whole top.')
      : L('У цьому раунді ти більше не відповідатимеш, а весь топ побачиш, коли закінчать інші.', 'You won’t answer any more this round, and you’ll see the whole top when the others finish.');
    const kept = found ? ' ' + L(`Ти вже знайшов ${found} з ${state.slots.length}, і ці ${pts} ${ptsWord(pts)} залишаться за тобою.`, `You’ve found ${found} of ${state.slots.length}, and you keep those ${pts} ${ptsWord(pts)}.`) : '';
    if (await ask(L('Здатися й відкрити відповіді?', 'Give up and reveal the answers?'), { note: what + kept, ok: L('🏳️ Здатися', '🏳️ Give up'), danger: true })) emit('giveUp');
  });

  // ── підсумок
  function renderFinal() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    if (s.solo) {
      $('#final-title').textContent = `${s.scores[mySeat]} ${pl(s.scores[mySeat], ['очко', 'очки', 'очок'], ['point', 'points'])}`;
      const key = `top:best:${s.options.categories.join(',')}:${s.options.size}:${s.options.lives}:${s.rounds}`;
      const best = Number(store.get(key)) || 0;
      if (s.scores[mySeat] > best) store.set(key, s.scores[mySeat]);
      const rounds = `${s.rounds} ${pl(s.rounds, ['раунд', 'раунди', 'раундів'], ['round', 'rounds'])}`;
      $('#final-standings').innerHTML = `<li><span class="nm">${L(`Рекорд (Топ-${s.options.size}, ${rounds})`, `Best (Top ${s.options.size}, ${rounds})`)}</span><span class="val">${Math.max(best, s.scores[mySeat])}${s.scores[mySeat] > best && best ? L(' — новий!', ' — new!') : ''}</span></li>`;
    } else {
      const top = s.scores[seats[0]];
      const winners = seats.filter((i) => s.scores[i] === top);
      $('#final-title').textContent = winners.length > 1 ? L('Нічия!', 'It’s a draw!') : winners[0] === mySeat ? L('Ти переміг! 🏆', 'You win! 🏆') : L(`Переміг ${seatName(winners[0])} 🏆`, `${seatName(winners[0])} wins 🏆`);
      $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${s.scores[i] === top ? 'win' : ''}">
        <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))}</span><span class="val">${s.scores[i]} ${pl(s.scores[i], ['очко', 'очки', 'очок'], ['point', 'points'])}</span></li>`).join('');
    }
    $('#final-history').innerHTML = s.history.map((h) => {
      const spent = h.hints?.[mySeat] ? ` <small class="hint-paid">(${L('підказки', 'hints')} −${h.hints[mySeat]})</small>` : '';
      return `<li><span class="nm">${escapeHtml(h.title)}</span><span class="val">${signed(h.results[mySeat] || 0)}${spent}</span></li>`;
    }).join('');
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost);
    const host = s.seats[s.host]?.name || L('Господар', 'The host');
    $('#again-wait').textContent = isHost || s.solo ? '' : L(`${host} може почати ще одну гру.`, `${host} can start another game.`);
  }
})();
