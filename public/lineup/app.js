// «Склад матчу» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js;
// тут — шапка матчу, дві команди на полі (футболки з номерами), підказки на обрану футболку, відповіді, «Досить».
(() => {
  const { L, name: pname } = window.I18n;
  const pl = (n, uk, en) => window.I18n.plural(n, uk, en);
  const CATEGORY_LABELS = {
    wc: L('🌍 ЧС', '🌍 World Cups'), euro: L('🇪🇺 Євро', '🇪🇺 Euros'), copa: L('🌎 Копа', '🌎 Copa'), ucl: L('⭐ ЛЧ', '⭐ UCL'),
    uel: L('🟠 Кубок УЄФА / ЛЄ', '🟠 UEFA Cup / UEL'), legend: L('🔥 Легендарні', '🔥 Legendary'), ua: L('🇺🇦 Українські', '🇺🇦 Ukrainian'),
    metalist: L('💛💙 Металіст', '💛💙 Metalist'),
  };
  const MODE_LABELS = { own: L('кожен свій склад', 'everyone their own sheet'), turns: L('спільний склад по черзі', 'one shared sheet, taking turns') };
  const LEVEL_LABELS = { easy: L('🟢 легкі матчі', '🟢 easy matches'), normal: L('🟡 середні матчі', '🟡 medium matches'), hard: L('🔴 складні матчі', '🔴 hard matches'), mix: L('🎲 матчі будь-якої складності', '🎲 matches of any difficulty') };
  const LEVEL_DOT = { easy: '🟢', normal: '🟡', hard: '🔴' };
  const HINT_LABELS = { age: L('🎂 Вік', '🎂 Age'), letters: L('🔤 Літер у прізвищі', '🔤 Letters in surname'), first: L('🅰 Перша літера', '🅰 First letter') };
  const POS = {
    GK: L('ВР', 'GK'), SW: L('ЛБ', 'SW'), CB: L('ЦЗ', 'CB'), LB: L('ЛЗ', 'LB'), RB: L('ПЗ', 'RB'), LWB: L('ЛФЗ', 'LWB'), RWB: L('ПФЗ', 'RWB'),
    DM: L('ОП', 'DM'), CM: L('ЦП', 'CM'), LM: L('ЛП', 'LM'), RM: L('ПП', 'RM'), AM: L('АП', 'AM'), LW: L('ЛВ', 'LW'), RW: L('ПВ', 'RW'),
    LF: L('ЛН', 'LF'), RF: L('ПН', 'RF'), SS: L('ДН', 'SS'), CF: L('ЦН', 'CF'), ST: L('ЦН', 'ST'), DF: L('З', 'DF'), MF: L('П', 'MF'), FW: L('Н', 'FW'),
  };

  let state = null;
  let mySeat = -1;
  let selected = null; // ключ футболки, для якої показуємо підказки
  let coaches = [];
  fetch(`/api/lineup/coaches?lang=${window.I18n.lang}`).then((r) => r.json()).then((list) => { coaches = list; }).catch(() => {});

  const g = RoomClient.create({
    id: 'lineup',
    title: L('Склад матчу', 'Match Lineup'),
    defaults: { categories: Object.keys(CATEGORY_LABELS), level: 'mix', subs: true, mode: 'own', lives: '5', roundSeconds: '300', turnSeconds: '30', rounds: '5' },
    fixSetup(setup) {
      if (!Array.isArray(setup.categories) || !setup.categories.length) setup.categories = Object.keys(CATEGORY_LABELS);
      if (setup.mode === 'turns' && setup.lives === '0') setup.lives = '5';
    },
    onSetup(setup) {
      $('#mode-hint').textContent = setup.mode === 'turns'
        ? L('Одне поле на всіх, називаєте по черзі. За помилку чи пас втрачаєш життя.', 'One sheet for everyone, you take turns naming players. A miss or a pass costs you a life.')
        : L('Кожен заповнює свій склад, усі водночас. Чужих відповідей не видно — лише скільки хто знайшов.', 'Everyone fills in their own sheet at the same time. You can’t see others’ answers — only how many they’ve found.');
      $('#lives-inf').classList.toggle('hidden', setup.mode === 'turns');
      // час на раунд діє і в соло (соло — завжди «кожен свій»), тож поле не ховаємо — лише підписуємо
      const timeLabel = $('#round-time-field .field-label');
      timeLabel.dataset.base ??= timeLabel.textContent;
      timeLabel.textContent = setup.mode === 'turns' ? L(`${timeLabel.dataset.base} у соло`, `${timeLabel.dataset.base} (solo)`) : timeLabel.dataset.base;
      $('#turn-time-field').classList.toggle('hidden', setup.mode !== 'turns');
      $('#categories-hint').textContent = setup.categories.includes('metalist') && setup.categories.length === 1
        ? L('Єврокубкові вечори Металіста 2008–2013: Бешикташ, Сампдорія, Динамо, Олімпіакос, Зальцбург, Спортінг, Леверкузен…', 'Metalist’s European nights 2008–2013: Beşiktaş, Sampdoria, Dynamo, Olympiacos, Salzburg, Sporting, Leverkusen…')
        : '';
    },
    hints: {
      level: {
        easy: L('Матчі з найвідомішими гравцями — фінали, які пам’ятає кожен.', 'Matches full of famous players — finals everyone remembers.'),
        normal: L('Відомі матчі, але в складі вже є несподівані імена.', 'Well-known matches with a few surprising names in the lineups.'),
        hard: L('Давні фінали й єврокубкові вечори — для справжніх фанатів.', 'Old finals and European nights — for true fans.'),
        mix: L('Матчі будь-якої складності впереміш.', 'Matches of any difficulty, mixed.'),
      },
    },
    createOptions: (s) => ({ ...s, subs: !!s.subs, lives: Number(s.lives), roundSeconds: Number(s.roundSeconds), turnSeconds: Number(s.turnSeconds), rounds: Number(s.rounds) }),
    optionList,
    onState(s, prev) {
      if (s.match?.id !== prev?.match?.id) { selected = null; shown = new Set(); }
      state = s;
      mySeat = s.you;
      playSounds(prev, s);
    },
    renderGame,
    renderFinal,
  });
  const { $, emit, store, toast, ask, escapeHtml, initials, seatName, seatStyle } = g;
  const hearts = (n) => (n == null ? '' : n ? '♥'.repeat(n) : '💔');

  function optionList(o, solo) {
    return [o.categories.map((c) => CATEGORY_LABELS[c]).join(' '), LEVEL_LABELS[o.level || 'mix'],
      o.subs ? L('із замінами', 'with substitutes') : L('без замін', 'no substitutes'), solo ? null : MODE_LABELS[o.mode],
      o.lives ? `${o.lives} ${pl(o.lives, ['помилка', 'помилки', 'помилок'], ['mistake', 'mistakes'])}` : L('помилки без обмежень', 'unlimited mistakes'),
      o.mode === 'turns' ? (o.turnSeconds ? L(`${o.turnSeconds} с на хід`, `${o.turnSeconds} s per turn`) : L('хід без таймера', 'no turn timer'))
        : o.roundSeconds ? L(`${o.roundSeconds / 60} хв на матч`, `${o.roundSeconds / 60} min per match`) : L('без таймера', 'no timer'),
      `${o.rounds} ${pl(o.rounds, ['матч', 'матчі', 'матчів'], ['match', 'matches'])}`].filter(Boolean);
  }

  function playSounds(p, s) {
    if (!p) return;
    if (s.phase === 'guess' && (p.phase !== 'guess' || p.round !== s.round || p.match?.id !== s.match?.id)) window.Sound.play('whistle');
    else if (s.phase === 'guess' && s.active === mySeat && p.active !== mySeat) window.Sound.play('pop');
    else if (s.options.mode === 'turns' && s.found > (p.found || 0)) window.Sound.play('crowd');
  }

  // ── хто вже відкритий для мене: свої знайдені (own), спільні (turns), кого немає в базі, усі — після раунду
  function answerOf(slot) {
    if (slot.answer) return slot.answer;
    const mine = state.mine?.found.find((f) => f.key === slot.key);
    return mine || null;
  }
  const hintsOf = (slot) => (state.options.mode === 'turns' ? slot.hints : state.mine?.hints?.[slot.key]) || {};
  const allSlots = () => state.match.teams.flatMap((t) => [...t.xi, ...t.bench, ...(t.coach ? [t.coach] : [])]);

  // ── гра
  function renderGame() {
    const s = state;
    $('#round-info').innerHTML = `<b>${L(`Матч ${s.round} з ${s.rounds}`, `Match ${s.round} of ${s.rounds}`)}</b><span>${LEVEL_DOT[s.match.level] || ''} ${s.solo ? '' : MODE_LABELS[s.options.mode]}</span>`;
    renderHead();
    renderAnswerBox();
    renderTeams();
    renderMisses();
    renderRevealBar();
    renderHintBar();
    $('#reactions').classList.toggle('hidden', s.solo);
    renderScoreboard();
    tick();
  }

  function crest(img, name) {
    return img ? `<img class="crest" src="${escapeHtml(img)}" alt="" loading="lazy" />` : `<span class="crest crest-empty">${escapeHtml(initials(name || '?'))}</span>`;
  }

  function renderHead() {
    const m = state.match;
    const [a, b] = m.teams;
    const date = m.date ? new Date(`${m.date}T12:00:00`).toLocaleDateString(window.I18n.lang === 'en' ? 'en-GB' : 'uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const extra = [m.aet ? L('після додаткового часу', 'after extra time') : null, m.pens ? L(`пенальті ${m.pens[0]}:${m.pens[1]}`, `penalties ${m.pens[0]}–${m.pens[1]}`) : null,
      m.aggregate ? L(`за сумою двох матчів ${m.aggregate[0]}:${m.aggregate[1]}`, `aggregate ${m.aggregate[0]}–${m.aggregate[1]}`) : null].filter(Boolean).join(' · ');
    $('#match-head').innerHTML = `
      <p class="mh-comp">${escapeHtml(m.title)}</p>
      <div class="mh-score">
        <span class="mh-team">${crest(a.img, a.name)}<b>${escapeHtml(a.name)}</b></span>
        <span class="mh-result">${m.score[0]}<i>:</i>${m.score[1]}</span>
        <span class="mh-team away"><b>${escapeHtml(b.name)}</b>${crest(b.img, b.name)}</span>
      </div>
      <p class="mh-meta">${[date, m.venue].filter(Boolean).map(escapeHtml).join(' · ')}${extra ? `<br><small>${escapeHtml(extra)}</small>` : ''}</p>`;
  }

  function canAnswer() {
    const s = state;
    if (s.phase !== 'guess') return false;
    if (s.options.mode === 'turns') return s.active === mySeat;
    return !s.mine?.done && !s.finishVotes.includes(mySeat);
  }

  function renderAnswerBox() {
    const s = state;
    const turns = s.options.mode === 'turns';
    const reveal = s.phase === 'reveal';
    $('#answer-box').classList.toggle('hidden', reveal);
    if (reveal) return;
    const can = canAnswer();
    const input = $('#guess-input');
    input.disabled = !can;
    if (!can) picker.clear();
    $('#pass-btn').classList.toggle('hidden', !turns);
    $('#pass-btn').disabled = !can;
    $('#skip-btn').classList.toggle('hidden', !(s.canSkip && s.host === mySeat));
    const voted = s.finishVotes.includes(mySeat);
    const online = s.seats.map((x, i) => (x && x.connected ? i : -1)).filter((i) => i >= 0);
    const fin = $('#finish-btn');
    fin.disabled = voted || (!turns && s.mine?.done);
    fin.textContent = voted || s.mine?.done ? L(`🏁 Чекаємо інших (${s.finishVotes.length}/${online.length})`, `🏁 Waiting for others (${s.finishVotes.length}/${online.length})`) : L('🏁 Досить', '🏁 That’s it');
    const lives = turns ? (s.order.includes(mySeat) ? s.lives[mySeat] : null) : s.mine?.livesLeft ?? (s.options.lives || null);
    $('#lives').innerHTML = s.options.lives && lives != null
      ? `<span class="lives-label">${L('Помилок лишилось', 'Mistakes left')}:</span> <b>${lives ? '♥'.repeat(lives) : '💔'}</b>` : '';
    const found = turns ? s.found : s.mine?.found.length || 0;
    if (turns) {
      $('#turn-line').innerHTML = s.active === mySeat ? L('<b>Твій хід!</b> Назви когось зі складу.', '<b>Your turn!</b> Name someone from the lineups.')
        : s.active >= 0 ? `${L('Хід', 'Turn')}: <b class="pc" style="${seatStyle(s.active)}">${escapeHtml(seatName(s.active))}</b>` : '';
    } else $('#turn-line').innerHTML = '';
    $('#answer-hint').textContent = s.mine?.done && !voted
      ? L(`Твій склад закрито: ${found} з ${s.total}. Чекаємо інших…`, `Your sheet is closed: ${found} of ${s.total}. Waiting for others…`)
      : L(`Знайдено ${found} з ${s.total}. Натисни на футболку, щоб узяти підказку.`, `Found ${found} of ${s.total}. Tap a shirt to get a hint.`);
  }

  // ── дві команди: поле з футболками, заміни, тренер
  // світла футболка (біла, жовта) — номер темний
  const light = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return false; const n = parseInt(m[1], 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 170; };
  // на полі — лише прізвище (з часткою: «Ді Марія», «ван Дейк»), щоб підписи не налазили на сусідів; повне ім'я — у підказці
  const PARTICLES = /^(ді|де|да|ду|дель|ван|фон|ле|ла|ель|аль|di|de|da|do|del|van|von|le|la|el|al|dos|das)$/i;
  function shortName(name) {
    const w = String(name || '').trim().split(/\s+/);
    if (w.length < 2) return w[0] || '';
    return PARTICLES.test(w[w.length - 2]) ? w.slice(-2).join(' ') : w[w.length - 1];
  }
  // форма: колір тулуба й рукавів + малюнок з Вікіпедії (смуги, «шахи», окантовка) поверх кольору
  function kitStyle(t, k) {
    const body = t.kit || (k ? '#1d3f8f' : '#b3121d');
    const url = (u) => (u ? `url("${u}")` : 'none');
    return escapeHtml(`--kit:${body};--kit-arms:${t.kitArms || body};--kit-ink:${light(t.kit) && !t.kitPattern ? '#1b2a4a' : '#fff'};`
      + `--kit-pat:${url(t.kitPattern)}`);
  }
  let shown = new Set(); // кого вже показали відкритим — анімацію перевороту лише для нових
  function renderTeams() {
    const s = state;
    $('#teams').innerHTML = s.match.teams.map((t, k) => `
      <section class="team-sheet${t.kitPattern ? ' patterned' : ''}" style="${kitStyle(t, k)}">
        <header class="ts-head">${crest(t.img, t.name)}<b>${escapeHtml(t.name)}</b></header>
        <div class="pitch">
          <i class="pl-box"></i><i class="pl-arc"></i><i class="pl-half"></i>
          ${t.xi.map((sl) => shirtHtml(sl, t)).join('')}
        </div>
        ${t.bench.length ? `<div class="bench"><span class="bench-title">${L('Вийшли на заміну', 'Came on')}</span>${t.bench.map((sl) => shirtHtml(sl, t, true)).join('')}</div>` : ''}
        ${t.coach ? `<div class="coach-row"><span class="bench-title">${L('Тренер', 'Coach')}</span>${shirtHtml(t.coach, t, true)}</div>` : ''}
      </section>`).join('');
    for (const sl of allSlots()) if (answerOf(sl)) shown.add(sl.key);
  }

  function shirtHtml(sl, t, inline = false) {
    const ans = answerOf(sl);
    const fresh = ans && !shown.has(sl.key) && !sl.missing;
    const hints = hintsOf(sl);
    const hintChips = !ans ? [hints.age != null ? L(`${hints.age} р.`, `age ${hints.age}`) : null, hints.letters ? L(`${hints.letters} літ.`, `${hints.letters} letters`) : null,
      hints.first ? `${hints.first}…` : null].filter(Boolean).map((h) => `<i>${escapeHtml(h)}</i>`).join('') : '';
    const badges = [
      sl.capt ? `<span class="b-capt" title="${L('Капітан', 'Captain')}">C</span>` : '',
      ...(sl.goals || []).map((m) => `<span class="b-goal" title="${L('Гол', 'Goal')} ${escapeHtml(m)}'">⚽<small>${escapeHtml(String(m).replace(' пен.', L(' п.', ' p')))}'</small></span>`),
      sl.off ? `<span class="b-off">↓${escapeHtml(sl.off)}'</span>` : '',
      sl.on ? `<span class="b-on">↑${escapeHtml(sl.on)}'${sl.for != null ? L(` за №${sl.for}`, ` for #${sl.for}`) : ''}</span>` : '',
    ].join('');
    const by = ans && sl.by?.length && !state.solo ? sl.by.map((i) => `<i class="dot-p" style="${seatStyle(i)}" title="${escapeHtml(seatName(i))}"></i>`).join('') : '';
    const id = sl.club ? `<span class="s-club ${sl.club.img ? 'has-img' : ''}" title="${escapeHtml(sl.club.name)}">${sl.club.img ? `<img src="${escapeHtml(sl.club.img)}" alt="" loading="lazy" />` : ''}<span>${escapeHtml(sl.club.name)}</span></span>`
      : sl.flag ? `<img class="s-flag" src="${escapeHtml(sl.flag)}" alt="" loading="lazy" />` : '';
    const face = ans
      ? `<span class="s-face">${ans.photo ? `<img src="${escapeHtml(ans.photo)}" alt="" loading="lazy" />` : `<b>${escapeHtml(initials(ans.name || '?'))}</b>`}</span>`
      : sl.coach ? `<span class="s-coach">${L('ТРЕНЕР', 'COACH')}</span>` : `<span class="s-num">${sl.num ?? ''}</span>`;
    const style = inline ? '' : `style="left:${(sl.x / 10).toFixed(1)}%;bottom:${(sl.y / 10 * 0.92 + 3).toFixed(1)}%"`;
    const cls = ['shirt', inline ? 'inline' : '', !inline && sl.x != null && sl.x < 260 ? 'edge-l' : '', ans ? 'open' : '', fresh ? 'flip' : '', sl.missing ? 'missing' : '', selected === sl.key ? 'sel' : '', sl.coach ? 'coach' : ''].join(' ');
    return `<button type="button" class="${cls}" data-key="${sl.key}" ${style} ${ans ? 'tabindex="-1"' : ''}>
      <span class="s-shirt">${face}</span>${!ans && state.phase === 'guess' ? '<span class="s-tip" aria-hidden="true">💡</span>' : ''}
      <span class="s-name" ${ans ? `title="${escapeHtml(ans.name)}"` : ''}>${ans ? escapeHtml(inline ? ans.name : shortName(ans.name)) : `${sl.pos && !sl.coach ? `<em>${escapeHtml(POS[sl.pos] || sl.pos)}</em>` : ''}${id}`}</span>
      ${hintChips ? `<span class="s-hints">${hintChips}</span>` : ''}
      ${badges ? `<span class="s-badges">${badges}</span>` : ''}${by ? `<span class="s-by">${by}</span>` : ''}
    </button>`;
  }

  $('#teams').addEventListener('click', (e) => {
    const b = e.target.closest('.shirt');
    if (!b || b.classList.contains('open') || state?.phase !== 'guess') return;
    selected = selected === b.dataset.key ? null : b.dataset.key;
    renderTeams();
    renderHintBar();
  });

  function renderHintBar() {
    const bar = $('#hint-bar');
    const s = state;
    const sl = selected && s.phase === 'guess' ? allSlots().find((x) => x.key === selected) : null;
    if (s.phase !== 'guess') { bar.innerHTML = ''; bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    if (!sl || answerOf(sl)) {
      bar.classList.add('idle');
      bar.innerHTML = `<span class="hb-title">💡 ${L('<b>Не знаєш когось?</b> Натисни на його футболку (або на тренера) — покажемо вік, кількість літер у прізвищі чи першу літеру. Кожна підказка забирає 1 очко за цього гравця.',
        '<b>Stuck on someone?</b> Tap his shirt (or the coach) — we’ll show his age, the number of letters in his surname or the first letter. Each hint takes 1 point off that player.')}</span>`;
      return;
    }
    bar.classList.remove('idle');
    const team = s.match.teams.find((t) => [...t.xi, ...t.bench, t.coach].includes(sl));
    const hints = hintsOf(sl);
    const value = Math.max(1, s.points - Object.keys(hints).length);
    const can = s.options.mode === 'turns' ? s.active === mySeat : canAnswer();
    const where = sl.club ? ` · ${sl.club.name}` : '';
    const who = sl.coach ? L(`тренера (${team.name})`, `the coach (${team.name})`) : L(`№${sl.num} (${team.name}${where})`, `#${sl.num} (${team.name}${where})`);
    bar.innerHTML = `<span class="hb-title">${L('Підказка для', 'Hint for')} <b>${escapeHtml(who)}</b> · ${L('вгадаєш зараз —', 'guess now —')} <b>+${value}</b></span>
      <span class="hb-btns">${['age', 'letters', 'first'].filter((k) => k !== 'age' || sl.canAge).map((k) => hints[k] != null
        ? `<span class="hb-got">${HINT_LABELS[k]}: <b>${escapeHtml(String(hints[k]))}</b></span>`
        : `<button type="button" class="hint-btn" data-hint="${k}" ${can ? '' : 'disabled'}>💡 ${HINT_LABELS[k]} <b>−1</b></button>`).join('')}</span>`;
  }

  $('#hint-bar').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-hint]');
    if (!b || !selected) return;
    const res = await emit('hint', { key: selected, kind: b.dataset.hint });
    if (res.error) toast(res.error, 'bad');
  });

  function renderMisses() {
    const s = state;
    const turns = s.options.mode === 'turns';
    const list = turns ? s.wrong : (s.mine?.wrong || []).map((p) => ({ player: p }));
    $('#misses').innerHTML = list.length
      ? `<span class="field-label">${L('Мимо', 'Misses')}</span>${list.map((w) => `<span class="miss" style="${turns ? seatStyle(w.seat) : ''}">${turns ? '<i class="dot-p"></i>' : ''}${w.player ? escapeHtml(w.player.coach ? w.player.name : pname(w.player)) : L('пас', 'pass')}</span>`).join('')}`
      : '';
  }

  function renderRevealBar() {
    const s = state;
    const bar = $('#reveal-bar');
    bar.classList.toggle('hidden', s.phase !== 'reveal');
    if (s.phase !== 'reveal') return;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => (s.roundPoints[b] || 0) - (s.roundPoints[a] || 0));
    const iVoted = s.nextVotes.includes(mySeat);
    bar.innerHTML = `${s.solo ? `<p class="verdict">${L('За матч', 'This match')}: <b>+${s.roundPoints[mySeat] || 0}</b></p>`
      : `<ul class="round-results">${seats.map((i) => `<li style="${seatStyle(i)}"><span class="dot-p"></span>${escapeHtml(seatName(i))}<b>+${s.roundPoints[i] || 0}</b></li>`).join('')}</ul>`}
      <div class="reveal-actions"><button id="next-btn" class="btn btn-primary btn-lg" ${iVoted ? 'disabled' : ''}>${s.round >= s.rounds ? L('Підсумки', 'Results') : L('Наступний матч →', 'Next match →')}</button></div>`;
    $('#next-btn').addEventListener('click', () => emit('next'));
  }

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
        const fin = s.finishVotes.includes(i) ? ' 🏁' : '';
        if (turns) status = s.order.includes(i) ? `<span class="st ${s.active === i ? 'thinking' : ''}">${s.active === i ? '✍️ ' : ''}${s.options.lives ? hearts(s.lives[i]) : ''}${fin}</span>` : '';
        else { const pr = s.progress[i]; status = pr ? `<span class="st">${pr.found}/${s.total}${pr.done ? ' ✓' : ''}${fin}</span>` : ''; }
      }
      const crown = top > 0 && leaders.length === 1 && leaders[0] === i ? ' 👑' : '';
      const bump = shownScores[i] != null && s.scores[i] > shownScores[i] ? 'bump' : '';
      return `<li style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'}">
        <span class="place">${place}</span><span class="dot-p"></span><span class="nm">${escapeHtml(seatName(i))}${crown}</span>${status}<b class="${bump}">${s.scores[i]}</b></li>`;
    }).join('');
    shownScores = Object.fromEntries(seats.map((i) => [i, s.scores[i]]));
  }

  function tick() {
    const el = $('#timer');
    if (!state || state.status !== 'playing' || !state.deadline || state.phase !== 'guess') { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((state.deadline - g.serverNow()) / 1000));
    el.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    el.classList.toggle('low', left <= 10);
  }
  setInterval(tick, 250);

  // ── пошук: футболісти бази + тренери матчів
  const input = $('#guess-input');
  const picker = window.Players.attach(input, { choose,
    // тренери матчу — перед футболістами (вибір шле coachKey)
    extra: (q) => {
      const nq = window.Players.normalize(q);
      return coaches.filter((c) => window.Players.normalize(c.name).split(' ').some((w) => w.startsWith(nq)) || window.Players.normalize(c.name).includes(nq)).slice(0, 3)
        .map((c) => ({ coach: true, key: c.key, name: c.name, thumb: c.photo, sub: L('тренер', 'coach') }));
    },
  });

  async function choose(p) {
    const res = await emit('guess', p.coach ? { coachKey: p.key } : { playerId: p.id });
    if (res.error) return toast(res.error, 'bad');
    const nm = p.coach ? p.name : pname(p);
    if (res.correct) {
      window.Sound.play('crowd');
      if (res.keys?.includes(selected)) selected = null;
      toast(L(`${nm} — є! +${res.points}`, `${nm} — yes! +${res.points}`), 'good');
    } else {
      window.Sound.play('miss');
      toast(L(`${nm} — не грав у цьому матчі`, `${nm} — didn’t play in this match`), 'bad');
    }
    if (!input.disabled) input.focus();
  }

  $('#skip-btn').addEventListener('click', () => g.act('skipMatch'));
  $('#pass-btn').addEventListener('click', async () => {
    if (await ask(L('Пас?', 'Pass?'), { note: L('Це забере одне життя.', 'It costs one life.'), ok: L('Пас', 'Pass') })) emit('pass');
  });
  $('#finish-btn').addEventListener('click', async () => {
    const s = state;
    const found = s.options.mode === 'turns' ? s.found : s.mine?.found.length || 0;
    const note = s.solo ? L(`Покажемо весь склад. Ти знайшов ${found} з ${s.total} — ці очки залишаться.`, `We’ll show the full lineups. You found ${found} of ${s.total} — you keep those points.`)
      : L('Коли «Досить» натиснуть усі, покажемо весь склад, а набрані очки залишаться.', 'Once everyone presses “That’s it”, we show the full lineups, and you keep the points you’ve earned.');
    if (await ask(L('Більше нікого не згадаєш?', 'Can’t remember anyone else?'), { note, ok: L('🏁 Досить', '🏁 That’s it') })) g.act('finishRound');
  });

  // ── підсумок
  function renderFinal() {
    const s = state;
    const seats = s.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).sort((a, b) => s.scores[b] - s.scores[a]);
    if (s.solo) {
      $('#final-title').textContent = `${s.scores[mySeat]} ${pl(s.scores[mySeat], ['очко', 'очки', 'очок'], ['point', 'points'])}`;
      const key = `lineup:best:${s.options.categories.join(',')}:${s.options.subs ? 1 : 0}:${s.rounds}`;
      const best = Number(store.get(key)) || 0;
      if (s.scores[mySeat] > best) store.set(key, s.scores[mySeat]);
      $('#final-standings').innerHTML = `<li><span class="nm">${L(`Рекорд (${s.rounds} матчів)`, `Best (${s.rounds} matches)`)}</span><span class="val">${Math.max(best, s.scores[mySeat])}${s.scores[mySeat] > best && best ? L(' — новий!', ' — new!') : ''}</span></li>`;
    } else {
      const top = s.scores[seats[0]];
      const winners = seats.filter((i) => s.scores[i] === top);
      $('#final-title').textContent = winners.length > 1 ? L('Нічия!', 'It’s a draw!') : winners[0] === mySeat ? L('Ти переміг! 🏆', 'You win! 🏆') : L(`Переміг ${seatName(winners[0])} 🏆`, `${seatName(winners[0])} wins 🏆`);
      $('#final-standings').innerHTML = seats.map((i, k) => `<li style="${seatStyle(i)}" class="${s.scores[i] === top ? 'win' : ''}">
        <span class="place">${k + 1}</span><span class="nm">${escapeHtml(seatName(i))}</span><span class="val">${s.scores[i]} ${pl(s.scores[i], ['очко', 'очки', 'очок'], ['point', 'points'])}</span></li>`).join('');
    }
    $('#final-history').innerHTML = s.history.map((h) => `<li><span class="nm">${escapeHtml(h.title)}</span><span class="val">+${h.results[mySeat] || 0}</span></li>`).join('');
    const isHost = mySeat === s.host;
    $('#again-btn').classList.toggle('hidden', !isHost);
    const host = s.seats[s.host]?.name || L('Господар', 'The host');
    $('#again-wait').textContent = isHost || s.solo ? '' : L(`${host} може почати ще одну гру.`, `${host} can start another game.`);
  }
})();
