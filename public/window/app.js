// «Трансферне вікно» — клієнт. Спільне (налаштування, вхід, лобі, чат, вихід) — /shared/room-client.js; тут — схема в лобі,
// лот і таємна ставка, суперники, своє поле за схемою, стрічка BREAKING, а після вікна — склади з силою, матчі й таблиця.
(() => {
  const { L, name: pname } = window.I18n;
  const EN = window.I18n.lang === 'en';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FORMATIONS = { 433: '4-3-3', 442: '4-4-2', 4231: '4-2-3-1', 352: '3-5-2', 4312: '4-3-1-2', mini: L('Міні 2-2-2', 'Mini 2-2-2') };
  const BASES = {
    overall: L('⭐ Загальний рейтинг', '⭐ Overall rating'), value: L('💶 Пікова вартість', '💶 Peak value'), goals: L('⚽ Голи', '⚽ Goals'),
    assists: L('🎯 Асисти', '🎯 Assists'), trophies: L('🏆 Трофеї й нагороди', '🏆 Trophies & awards'),
  };
  const BASIS_VISIBLE = false; // режими «Сила за» (вартість/голи/асисти/трофеї) приховано, поки переробляються; показати — true і прибрати hidden з #basis-field
  const MODERN_ONLY = L(' Лише сучасні гравці: у легенд цих даних немає.', ' Modern players only: legends lack this data.');
  const MODES = { all: L('🕰 Усі епохи', '🕰 All eras'), modern: L('📊 Сучасні', '📊 Modern') };
  // лінія поля для типу місця (0 — ворота … 3 — атака); крайні — по краях ряду
  const LINE_OF = { GK: 0, CB: 1, LB: 1, RB: 1, D: 1, DM: 2, CM: 2, AM: 2, M: 2, LW: 3, RW: 3, ST: 3, F: 3 };
  const LEFT = new Set(['LB', 'LW']);
  const RIGHT = new Set(['RB', 'RW']);
  const ROMANO = `/api/img?u=${encodeURIComponent('https://commons.wikimedia.org/wiki/Special:FilePath/Fabrizio_Romano,_2020_(cropped).jpg?width=200')}`;

  let state = null;
  let mySeat = -1;

  const g = RoomClient.create({
    id: 'window',
    title: L('Трансферне вікно', 'Transfer Window'),
    defaults: { formation: '433', mode: 'all', seconds: '15', basis: 'overall' },
    fixSetup(setup) {
      if (!FORMATIONS[setup.formation]) setup.formation = '433';
      if (!MODES[setup.mode]) setup.mode = 'all';
      if (!BASES[setup.basis] || !BASIS_VISIBLE) setup.basis = 'overall'; // вибір «Сила за» поки приховано — лише загальний рейтинг
    },
    hints: {
      formation: {
        mini: L('7 місць: воротар, 2 захисники, 2 півзахисники, 2 нападники чи вінгери — будь-хто зі своєї лінії. Вікно коротше.', '7 slots: a keeper, 2 defenders, 2 midfielders, 2 forwards or wingers — anyone from that line. A shorter window.'),
      },
      basis: {
        overall: L('Сила з усієї кар’єри: голи, асисти, сухі матчі, картки, трофеї, нагороди, рівень ліг — з вагами під позицію.', 'Strength from the whole career: goals, assists, clean sheets, cards, trophies, awards, league level — weighted by position.'),
        value: L('Сила — лише за піковою ринковою вартістю (Transfermarkt).', 'Strength by peak market value only (Transfermarkt).') + MODERN_ONLY,
        goals: L('Сила — лише за голами за кар’єру: клуби й збірна. Воротарі й захисники тут слабкі.', 'Strength by career goals only: clubs and country. Keepers and defenders are weak here.'),
        assists: L('Сила — лише за асистами з 2012/13 (усі змагання).', 'Strength by assists since 2012/13 only (all competitions).') + MODERN_ONLY,
        trophies: L('Сила — за кількістю командних трофеїв плюс особистих нагород рівня ліги й вище.', 'Strength by team trophies plus individual awards of league level and above.'),
      },
      mode: {
        all: L('500 найвідоміших за всю історію. У легенд до 2012 частини статистики немає — сила рахується з того, що є.', 'The 500 most famous of all time. Legends before 2012 lack some stats — strength uses what there is.'),
        modern: L('500 найвідоміших серед тих, хто грав з 2012: сила рахується з повних даних — голи, асисти, сухі матчі, картки.', 'The 500 most famous who played since 2012: strength from complete data — goals, assists, clean sheets, cards.'),
      },
    },
    createOptions: (s) => ({ ...s, seconds: Number(s.seconds) }),
    optionList: (o) => [
      ...(o.basis && o.basis !== 'overall' ? [BASES[o.basis]] : []),
      o.basis === 'value' || o.basis === 'assists' ? MODES.modern : MODES[o.mode],
      o.seconds ? L(`⏱ ${o.seconds} с на лот`, `⏱ ${o.seconds} s per lot`) : L('без таймера', 'no timer'),
      L('100 млн у кожного', '€100M each'),
    ],
    onState(s, prev) {
      state = s;
      mySeat = s.you;
      if (s.status !== 'playing') stageKey = null;
      if (s.status !== 'finished') resultKey = null;
      renderFormationPicker();
      playSounds(prev, s);
    },
    renderGame,
    renderFinal,
  });
  const { $, emit, escapeHtml, initials, seatName, seatStyle } = g;

  const money = (n) => (EN ? `€${n}M` : `${n} млн`);
  const nameOf = (p) => (p ? pname(p) : '');
  const surname = (p) => {
    const n = nameOf(p);
    const parts = n.split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(' ') : n;
  };
  const photo = (p, cls = '') => `<span class="ph ${cls}">${p?.photo ? `<img src="${p.photo}" alt="" loading="lazy" />` : `<span>${escapeHtml(initials(nameOf(p) || '?'))}</span>`}</span>`;
  const present = () => state.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);

  // ── схема в лобі: господар міняє (домовились у чаті), інші бачать
  function renderFormationPicker() {
    const el = $('#lobby-formation');
    if (!el || state.status !== 'waiting') return;
    const isHost = mySeat === state.host;
    el.innerHTML = `<span class="field-label">${isHost ? L('Схема — домовтеся в чаті й обери', 'Formation — agree in the chat and pick') : L('Схема (обирає господар)', 'Formation (the host picks)')}</span>
      <div class="chips">${Object.entries(FORMATIONS).map(([k, v]) => `<button type="button" class="chip ${state.options.formation === k ? 'active' : ''}" data-f="${k}" ${isHost ? '' : 'disabled'}>${v}</button>`).join('')}</div>`;
    el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => g.act('formation', { formation: b.dataset.f })));
  }

  // ── звуки: новий лот, торги закрито, хтось обрав, молоток продажу, свій трансфер
  function playSounds(p, s) {
    if (s.status === 'finished' && p?.status === 'playing') { window.Sound.play('gavel'); setTimeout(() => window.Sound.play('win'), reduced ? 0 : 500); return; }
    if (s.status !== 'playing') return;
    if (s.phase === 'bid' && (p?.phase !== 'bid' || p.lotNo !== s.lotNo)) window.Sound.play('pop');
    if (s.phase === 'pick' && p?.phase !== 'pick') window.Sound.play('gavel');
    if (s.phase === 'pick' && p?.phase === 'pick' && s.pick.picks.length > p.pick.picks.length) {
      const last = s.pick.picks[s.pick.picks.length - 1];
      window.Sound.play(last.seat === mySeat ? 'win' : 'pop');
    }
    if (s.phase === 'pick' && s.pick.picker === mySeat && (p?.phase !== 'pick' || p.pick.picker !== mySeat)) window.Sound.play('ding');
  }

  // ── гра
  let stageKey = null;
  let draft = 2; // поточна сума в полі ставки

  function renderGame() {
    const s = state;
    const lotsLeft = s.slots.length * present().length;
    $('#round-info').innerHTML = `<span class="live-tag"><i class="live-dot"></i>LIVE</span><b>${L('Лот', 'Lot')} ${String(s.lotNo).padStart(2, '0')}</b><span class="level">${FORMATIONS[s.options.formation]} · ${L(`${lotsLeft} місць`, `${lotsLeft} slots`)}</span>`;
    $('#tw-lines').innerHTML = s.lines.map((n, i) => `<li class="${i === s.line ? 'now' : i < s.line ? 'done' : ''}">${escapeHtml(n)}</li>`).join('');
    renderStage();
    renderRivals();
    renderPitch();
    renderTicker();
    $('#reactions').classList.remove('hidden');
    tick();
  }

  const myMax = () => state.maxBids[mySeat] || 0;
  const canTake = (i) => state.lot && state.lot.eligible[i]?.includes(mySeat); // під i-го з лоту є місце
  const eligible = () => state.lot && state.lot.people.includes(mySeat);

  function renderStage() {
    const s = state;
    const ids = s.lot ? s.lot.players.map((p) => p.id) : (s.lastLot?.items || []).map((it) => it.id);
    const key = `${s.code}:${s.lotNo}:${s.phase}:${ids.join()}`;
    const el = $('#stage');
    if (key !== stageKey) {
      stageKey = key;
      if (s.phase === 'bid') {
        draft = Math.min(Math.max(s.rules.min, s.myBid || s.rules.min), myMax() || s.rules.min);
        el.innerHTML = `<div class="lot-row n${s.lot.players.length}" id="lot-row"></div><div class="bid-panel" id="bid-panel">${eligible() ? bidFormHtml() : ''}</div>`;
        if (eligible()) bindBid();
      } else if (s.phase === 'pick') {
        el.innerHTML = `<div class="lot-row n${s.lot.players.length}" id="lot-row"></div><div class="bid-panel pick-panel" id="pick-panel"></div>`;
      } else if (s.phase === 'sold') {
        el.innerHTML = soldHtml();
      }
    }
    if (s.phase === 'bid') { renderCards(); updateBid(); }
    if (s.phase === 'pick') { renderCards(); renderPickPanel(); }
  }

  // Картки гравців лоту; на вибір — кнопка «Забрати за N» (своя черга) або хто вже забрав
  function renderCards() {
    const s = state;
    const taken = new Map((s.pick?.picks || []).map((x) => [x.i, x]));
    const myTurn = s.phase === 'pick' && s.pick.picker === mySeat;
    $('#lot-row').innerHTML = s.lot.players.map((p, i) => {
      const t = taken.get(i);
      const meta = [
        p.nation ? `${p.nation.img ? `<img src="${p.nation.img}" alt="" loading="lazy" />` : ''}${escapeHtml(p.nation.name)}` : '',
        p.club ? `${p.club.img ? `<img src="${p.club.img}" alt="" loading="lazy" />` : ''}${escapeHtml(p.club.name)}` : '',
        p.born ? L(`${p.born} р. н.`, `born ${p.born}`) : '',
      ].filter(Boolean).map((x) => `<span>${x}</span>`).join('');
      let foot = '';
      if (t) foot = `<p class="taken"><span class="dot-p" style="${seatStyle(t.seat)}"></span>${escapeHtml(seatName(t.seat))} · <b>${money(t.price)}</b></p>`;
      else if (myTurn && s.pick.options.includes(i)) foot = `<button type="button" class="btn btn-primary take-btn" data-take="${i}">${L(`Забрати за ${money(s.pick.price)}`, `Take for ${money(s.pick.price)}`)}</button>`;
      else if (s.phase === 'bid' && eligible() && !canTake(i)) foot = `<p class="hint">${L('Під нього в тебе немає місця', 'You have no slot for him')}</p>`;
      return `<article class="lot-card mini-card ${t ? 'is-taken' : ''} ${s.phase === 'bid' && !reduced ? 'enter' : ''}">
          ${photo(p, 'lot-photo')}
          <div class="lot-body">
            <small class="lot-kicker">${escapeHtml(p.pos || '')} · ${s.lot.types[i].map(escapeHtml).join(' / ')}</small>
            <b class="lot-name">${escapeHtml(nameOf(p))}</b>
            <div class="lot-meta">${meta}</div>
          </div>
          ${foot ? `<div class="lot-foot">${foot}</div>` : ''}
          ${t ? `<b class="stamp-sold ${reduced ? '' : 'hit'}">HERE WE GO</b>` : ''}
        </article>`;
    }).join('');
    document.querySelectorAll('[data-take]').forEach((b) => b.addEventListener('click', async () => {
      const res = await emit('pick', { i: Number(b.dataset.take) });
      if (res.error) g.toast(res.error, 'bad');
    }));
  }

  function bidFormHtml() {
    const s = state;
    const n = s.lot.players.length;
    return `<form class="bid-form" id="bid-form" autocomplete="off">
        <p class="bid-rule">${L(`Скільки даси за право <b>обрати першим</b> з ${n}? Найбільша ставка обирає будь-кого й платить свою ставку. Решта обирають по черзі ставок із тих, що лишились, — по <b>${money(s.rules.pick)}</b>. Хто нікому не дістанеться — повернеться в пул.`,
    `How much is the <b>first pick</b> of ${n} worth to you? The highest bid takes anyone and pays its bid. The rest pick in bid order from who is left — <b>${money(s.rules.pick)}</b> each. Whoever is left over goes back to the pool.`)}</p>
        <div class="bid-row">
          <span class="bid-box"><input id="bid-input" type="number" inputmode="numeric" min="${s.rules.min}" step="1" aria-label="${L('Ставка за право першого вибору', 'Bid for the first pick')}" /><span>${EN ? 'M' : 'млн'}</span></span>
          <button type="button" class="chip" data-d="1">+1</button>
          <button type="button" class="chip" data-d="5">+5</button>
          <button type="button" class="chip" data-d="10">+10</button>
          <span class="grow"></span>
          <button class="btn btn-primary btn-lg" id="bid-btn">${L('Ставлю', 'Bid')}</button>
        </div>
        <div class="tie-box" id="bid-tie"></div>
        <div class="bid-notes"><p class="hint" id="bid-max"></p><p class="hint" id="bid-status"></p></div>
      </form>`;
  }

  function bindBid() {
    const input = $('#bid-input');
    input.value = draft;
    input.addEventListener('input', () => { draft = Math.floor(Number(input.value) || 0); });
    document.querySelectorAll('#bid-form [data-d]').forEach((b) => b.addEventListener('click', () => {
      draft = Math.min(myMax(), Math.max(state.rules.min, (Math.floor(Number(input.value)) || 0) + Number(b.dataset.d)));
      input.value = draft;
      window.Sound.play('pop');
    }));
    $('#bid-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Math.floor(Number(input.value));
      if (!amount) { input.focus(); return; }
      const res = await emit('bid', { amount });
      if (res.error) g.toast(res.error, 'bad');
    });
    if (!matchMedia('(pointer: coarse)').matches) input.focus();
  }

  function updateBid() {
    const s = state;
    const panel = $('#bid-panel');
    const waiting = s.lot.people.filter((i) => !s.bidders.includes(i) && s.seats[i]?.connected).length;
    const others = L(`Чекаємо ставок: ${waiting}`, `Waiting for ${waiting} more`);
    if (!eligible()) {
      panel.innerHTML = `<p class="hint center">${L('Під цих гравців у тебе немає вільного місця — торгуються інші.', 'You have no free slot for these players — the others are bidding.')} ${others}</p>`;
      return;
    }
    const empty = s.slots.length - s.squads[mySeat].length;
    $('#bid-max').innerHTML = L(`Можна до <b>${money(myMax())}</b> = ${money(s.budgets[mySeat])} у бюджеті − ${empty - 1} ${window.I18n.plural(empty - 1, ['порожнє місце', 'порожні місця', 'порожніх місць'], [])} після цього × ${money(s.rules.pick)}`,
      `Up to <b>${money(myMax())}</b> = ${money(s.budgets[mySeat])} budget − ${empty - 1} empty ${empty - 1 === 1 ? 'slot' : 'slots'} after this × ${money(s.rules.pick)}`);
    const tw = s.lot.tieWinner;
    // хто виграє при рівних ставках — помітною плашкою в кольорі гравця
    const tie = $('#bid-tie');
    tie.setAttribute('style', seatStyle(tw));
    tie.classList.toggle('mine', tw === mySeat);
    tie.innerHTML = `<span class="tie-icon" aria-hidden="true">⚖</span><span>${L('Рівні ставки — першим обирає', 'Tied bids — first pick goes to')}</span>
      <b class="tie-who"><span class="dot-p"></span>${tw === mySeat ? L('ти', 'you') : escapeHtml(seatName(tw))}</b>
      <small>${L('пріоритет цього лоту, далі переходить до наступного', 'this lot’s priority, then it moves on')}</small>`;
    const mine = s.myBid;
    $('#bid-status').innerHTML = mine == null ? `${L(`Пасу немає: не поставиш до кінця часу — ставка ${money(s.rules.min)}.`, `No passing: no bid by the end of the timer means ${money(s.rules.min)}.`)} ${others}`
      : `${L('Твоя ставка', 'Your bid')}: <b>${money(mine)}</b> · ${L('можна змінити', 'you can change it')} · ${others}`;
    $('#bid-btn').textContent = mine ? L('Змінити', 'Change') : L('Ставлю', 'Bid');
  }

  // Вибір: черга за ставками (усі ставки вже відкриті), хто зараз обирає і за скільки
  function renderPickPanel() {
    const s = state;
    const pk = s.pick;
    if (pk.auto) {
      // позиція потрібна лише одному: торгів немає, обирає сам за фіксовану ціну
      $('#pick-panel').innerHTML = `<p class="bid-rule">${pk.picker === mySeat
        ? L(`<b>Ця позиція потрібна лише тобі</b> — торгів немає. Обери одного з ${s.lot.players.length} за ${money(pk.price)}: тисни «Забрати» на картці.`, `<b>Only you need this position</b> — no auction. Pick one of ${s.lot.players.length} for ${money(pk.price)}: press “Take” on a card.`)
        : L(`<b>${escapeHtml(seatName(pk.picker))}</b> обирає без торгів — ця позиція потрібна лише йому (${money(pk.price)}).`, `<b>${escapeHtml(seatName(pk.picker))}</b> picks without an auction — only they need this position (${money(pk.price)}).`)}</p>
        <p class="hint">${L('Не встиг обрати до кінця часу — візьметься випадковий.', 'Run out of time — a random one is taken.')}</p>`;
      return;
    }
    const queue = pk.order.map((seat, n) => {
      const done = pk.picks.find((x) => x.seat === seat);
      const now = seat === pk.picker;
      return `<li style="${seatStyle(seat)}" class="${now ? 'now' : ''} ${done ? 'done' : ''}"><span class="q-n">${n + 1}</span><span class="dot-p"></span>
        <span>${escapeHtml(seatName(seat))}</span><b>${money(pk.bids[seat])}</b>
        <small>${done ? `${L('взяв', 'took')} ${escapeHtml(surname(s.lot.players[done.i]))} ${L('за', 'for')} ${money(done.price)}` : now ? L('обирає…', 'picking…') : n === 0 ? L(`платить ${money(pk.bids[seat])}`, `pays ${money(pk.bids[seat])}`) : L(`по ${money(s.rules.pick)}`, `${money(s.rules.pick)}`)}</small></li>`;
    }).join('');
    const head = pk.picker === mySeat
      ? L(`<b>Твоя черга обирати</b> — ${pk.picks.length ? `з тих, що лишились, за ${money(pk.price)}` : `будь-кого, за свою ставку ${money(pk.price)}`}. Тисни «Забрати» на картці.`,
        `<b>Your pick</b> — ${pk.picks.length ? `from who is left, for ${money(pk.price)}` : `anyone, for your bid of ${money(pk.price)}`}. Press “Take” on a card.`)
      : L(`Обирає <b>${escapeHtml(seatName(pk.picker))}</b>…`, `<b>${escapeHtml(seatName(pk.picker))}</b> is picking…`);
    $('#pick-panel').innerHTML = `<p class="bid-rule">${head}</p><ol class="pick-queue">${queue}</ol>
      <p class="hint">${L('Черга — за ставками від найбільшої. Не встиг обрати — візьметься випадковий.', 'The order follows the bids, highest first. Run out of time — a random one is taken.')}</p>`;
  }

  // Після лоту: хто кого взяв і за скільки, усі ставки, хто повернувся в пул
  function soldHtml() {
    const lot = state.lastLot;
    const cards = lot.items.map((it) => `<article class="lot-card mini-card sold">
        ${photo(it.player, 'lot-photo')}
        <div class="lot-body">
          <small class="lot-kicker">${escapeHtml(it.player.pos || '')}</small>
          <b class="lot-name">${escapeHtml(nameOf(it.player))}</b>
          <p class="sold-who"><span class="dot-p" style="${seatStyle(it.winner)}"></span>${escapeHtml(seatName(it.winner))} · <b>${money(it.price)}</b></p>
          ${lot.auto ? `<small class="hint">${L('позиція потрібна лише йому — обрав без торгів', 'only they needed this position — picked without an auction')}</small>` : ''}
        </div>
        <b class="stamp-sold ${reduced ? '' : 'hit'}">${lot.auto ? L('Без торгів', 'No contest') : 'HERE WE GO'}</b>
      </article>`);
    const back = lot.leftover.map((p) => `<article class="lot-card mini-card back">
        ${photo(p, 'lot-photo')}
        <div class="lot-body"><small class="lot-kicker">${escapeHtml(p.pos || '')}</small><b class="lot-name">${escapeHtml(nameOf(p))}</b>
          <p class="sold-who">${L('нікому — назад у пул', 'nobody — back to the pool')}</p></div>
      </article>`);
    const bids = Object.entries(lot.bids).map(([k, v]) => [Number(k), v]).sort((a, b) => b[1] - a[1]);
    const rows = lot.auto ? '' : `<div class="bid-panel"><p class="field-label">${L('Ставки за право першого вибору', 'Bids for the first pick')}</p>
      <ul class="bids">${bids.map(([seat, v]) => `<li style="${seatStyle(seat)}" class="${lot.items[0]?.winner === seat ? 'win' : ''}"><span class="dot-p"></span><span>${escapeHtml(seatName(seat))}</span><b>${money(v)}</b></li>`).join('')}</ul></div>`;
    return `<div class="lot-row n${cards.length + back.length}">${cards.join('')}${back.join('')}</div>${rows}`;
  }

  // ── суперники: гроші, скільки місць заповнено; на торгах — чи поставили, на виборі — ставка й черга, після — кого взяли
  function renderRivals() {
    const s = state;
    $('#scoreboard').innerHTML = present().map((i) => {
      let st = '';
      const prio = s.phase === 'bid' && s.lot.tieWinner === i ? `<em class="prio" title="${L('Виграє при рівних ставках', 'Wins on tied bids')}">⚖ ${L('пріоритет', 'priority')}</em>` : '';
      if (s.phase === 'bid') st = !s.lot.people.includes(i) ? `<span class="st">${L('не потрібен', 'no slot')}</span>` : s.bidders.includes(i) ? `<span class="st ok">${L('ставку зроблено', 'bid in')}</span>` : `<span class="st thinking">${L('думає…', 'thinking…')}</span>`;
      if (s.phase === 'pick' && (s.pick.bids[i] != null || s.pick.picker === i)) st = `<span class="st ${s.pick.picker === i ? 'ok' : ''}">${s.pick.bids[i] != null ? money(s.pick.bids[i]) : ''}${s.pick.bids[i] != null && s.pick.picker === i ? ' · ' : ''}${s.pick.picker === i ? L('обирає', 'picking') : ''}</span>`;
      if (s.phase === 'sold') {
        const it = s.lastLot.items.find((x) => x.winner === i);
        if (it) st = `<span class="st ok">${escapeHtml(surname(it.player))} · ${money(it.price)}</span>`;
      }
      if (prio) st = st.replace('<span class="st', `<span class="st">${prio}</span><span class="st`); // окремим рядком — не обрізається з іменем
      return `<li style="${seatStyle(i)}" class="${i === mySeat ? 'me' : ''} ${s.seats[i].connected ? '' : 'offline'} ${i === (viewSeat ?? mySeat) ? 'viewing' : ''}" data-seat="${i}" title="${L('Показати склад', 'Show squad')}">
        <span class="dot-p"></span><span class="nm">${escapeHtml(seatName(i))}<small>${s.squads[i].length} ${L('з', 'of')} ${s.slots.length}</small></span>${st}<b>${money(s.budgets[i])}</b></li>`;
    }).join('');
    $('#scoreboard').querySelectorAll('[data-seat]').forEach((li) => li.addEventListener('click', () => { showSquad(Number(li.dataset.seat)); renderRivals(); }));
  }

  // ── поле: свій склад або будь-якого суперника (вкладки над полем або клік у списку «У кімнаті»);
  // ряди від атаки до воріт, на місці — фото, прізвище й ціна; на своєму — місця під гравців лоту світяться
  let viewSeat = null; // чий склад на полі (null — свій)
  function arrange(idx) { // ліві — зліва, праві — справа, решта посередині
    const side = (i) => (LEFT.has(state.slots[i]) ? 0 : RIGHT.has(state.slots[i]) ? 2 : 1);
    return [...idx].sort((a, b) => side(a) - side(b));
  }
  function renderPitch() {
    const s = state;
    if (viewSeat != null && !s.seats[viewSeat]) viewSeat = null;
    const seat = viewSeat ?? mySeat;
    const own = seat === mySeat;
    const tabs = [mySeat, ...present().filter((i) => i !== mySeat)];
    $('#squad-tabs').innerHTML = tabs.map((i) => `<button type="button" role="tab" class="sq-tab ${i === seat ? 'active' : ''}" aria-selected="${i === seat}" data-seat="${i}" style="${seatStyle(i)}">
        <span class="dot-p"></span>${i === mySeat ? L('Твій склад', 'Your squad') : escapeHtml(seatName(i))}</button>`).join('');
    $('#squad-tabs').querySelectorAll('[data-seat]').forEach((b) => b.addEventListener('click', () => showSquad(Number(b.dataset.seat))));
    const mine = s.squads[seat] || [];
    const bySlot = new Map(mine.map((x) => [x.slot, x]));
    const targets = new Set();
    if (own && s.lot && (s.phase === 'bid' || s.phase === 'pick') && !(s.pick?.picks || []).some((x) => x.seat === mySeat)) {
      s.lot.types.forEach((names, k) => {
        if (!canTake(k)) return;
        const i = s.slots.map((t, j) => j).find((j) => !bySlot.has(j) && names.includes(s.slotNames[s.slots[j]]));
        if (i != null) targets.add(i);
      });
    }
    $('#my-budget').textContent = money(s.budgets[seat] ?? 0);
    $('#my-pitch').classList.toggle('rival', !own);
    $('#my-pitch').innerHTML = [3, 2, 1, 0].map((line) => {
      const idx = arrange(s.slots.map((t, i) => i).filter((i) => LINE_OF[s.slots[i]] === line));
      return `<div class="p-row">${idx.map((i) => {
        const x = bySlot.get(i);
        const cls = x ? 'filled' : targets.has(i) ? 'now' : '';
        return `<div class="p-slot ${cls}">
            ${x ? photo(x, 'p-ph') : `<span class="p-ph empty">${escapeHtml(s.slotNames[s.slots[i]])}</span>`}
            <small>${x ? escapeHtml(surname(x)) : targets.has(i) ? L('сюди', 'here') : ''}</small>
            ${x ? `<em>${money(x.price)}</em>` : ''}
          </div>`;
      }).join('')}</div>`;
    }).join('');
  }

  function showSquad(seat) {
    viewSeat = seat === mySeat ? null : seat;
    renderPitch();
  }

  // ── стрічка BREAKING: останні трансфери
  function renderTicker() {
    const s = state;
    const items = s.news.map((n) => `<span>${escapeHtml(L(`${seatName(n.winner)} забирає ${nameOf(n)} за ${money(n.price)}`, `${seatName(n.winner)} signs ${nameOf(n)} for ${money(n.price)}`))}</span>`);
    $('#ticker').innerHTML = `<b class="breaking">BREAKING</b><div class="ticker-run">${items.join('<i class="tick-dot" aria-hidden="true"></i>') || `<span>${L('Вікно відкрито. Перший лот — на торгах.', 'The window is open. First lot on the block.')}</span>`}</div>`;
  }

  // ── таймер
  let lastTick = -1;
  function tick() {
    const el = $('#timer');
    if (!state || state.status !== 'playing' || !state.deadline) { el.textContent = ''; el.classList.remove('low'); return; }
    const left = Math.max(0, Math.ceil((state.deadline - g.serverNow()) / 1000));
    el.textContent = state.phase === 'sold' ? L(`далі через ${left} с`, `next in ${left}s`) : `⏱ ${left}`;
    el.classList.toggle('soft', state.phase === 'sold');
    const low = (state.phase === 'bid' || state.phase === 'pick') && left <= 5;
    el.classList.toggle('low', low);
    const waiting = state.phase === 'bid' ? eligible() && state.myBid == null : state.phase === 'pick' && state.pick.picker === mySeat;
    if (low && waiting && left !== lastTick && left > 0) window.Sound.play('tick');
    lastTick = left;
  }
  setInterval(tick, 200);

  // ── підсумок: склади з силою, матчі, таблиця
  let resultKey = null;
  let tab = 'squads';
  let matchNo = 0;

  const ratingCls = (r) => (r >= 90 ? 'r-elite' : r >= 82 ? 'r-good' : r >= 72 ? 'r-mid' : 'r-low');
  function renderFinal() {
    const s = state;
    const r = s.result;
    const key = JSON.stringify(r.table);
    if (key !== resultKey) { resultKey = key; tab = 'squads'; matchNo = r.matches.findIndex((m) => m.a === mySeat || m.b === mySeat); if (matchNo < 0) matchNo = 0; }
    const champ = r.table[0];
    $('#final-title').textContent = !champ ? L('Вікно закрито', 'The window has shut')
      : champ.seat === mySeat ? L('Ти виграв трансферне вікно! 🏆', 'You won the transfer window! 🏆') : L(`${seatName(champ.seat)} виграє трансферне вікно 🏆`, `${seatName(champ.seat)} wins the transfer window 🏆`);
    $('#final-sub').textContent = L(`Вікно закрито · схема ${FORMATIONS[s.options.formation]} · ${BASES[s.options.basis] || BASES.overall} · сила відкрита`, `Window shut · ${FORMATIONS[s.options.formation]} · ${BASES[s.options.basis] || BASES.overall} · strength revealed`);
    const img = $('#romano');
    if (img.getAttribute('src') !== ROMANO) { img.src = ROMANO; img.alt = L('Фабріціо Романо', 'Fabrizio Romano'); }
    const tabs = [['squads', L('Склади й сила', 'Squads & strength')], ['matches', L('Матчі й таблиця', 'Matches & table')]];
    $('#final-tabs').innerHTML = tabs.map(([k, t]) => `<button type="button" role="tab" class="tw-tab ${tab === k ? 'active' : ''}" aria-selected="${tab === k}" data-tab="${k}">${t}</button>`).join('');
    $('#final-tabs').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; renderFinal(); }));
    $('#final-body').innerHTML = tab === 'squads' ? squadsHtml() : matchesHtml();
    $('#final-body').querySelectorAll('[data-match]').forEach((b) => b.addEventListener('click', () => { matchNo = Number(b.dataset.match); renderFinal(); }));
    const isHost = mySeat === s.host;
    $('#again-wait').textContent = isHost ? '' : L(`${s.seats[s.host]?.name || 'Господар'} може відкрити нове вікно.`, `${s.seats[s.host]?.name || 'The host'} can open a new window.`);
  }

  function squadsHtml() {
    const r = state.result;
    const order = r.table.length ? r.table.map((x) => x.seat) : r.teams.map((t) => t.seat);
    const teams = order.map((seat) => r.teams.find((t) => t.seat === seat)).filter(Boolean);
    const cards = teams.map((t) => `<article class="team-card" style="${seatStyle(t.seat)}">
        <header><span class="dot-p"></span><b class="tc-name">${escapeHtml(seatName(t.seat))}</b><b class="tc-avg" title="${L('Середня сила складу', 'Average squad strength')}">${t.strength.total.toFixed(1)}</b></header>
        <div class="tc-lines"><span>${L('Оборона', 'Defence')} ${t.strength.def.toFixed(1)}</span><span>${L('Середина', 'Midfield')} ${t.strength.mid.toFixed(1)}</span><span>${L('Атака', 'Attack')} ${t.strength.att.toFixed(1)}</span></div>
        <ol class="tc-list">${t.players.map((x) => `<li>
            ${photo(x.player, 'tc-ph')}<span class="tc-pos">${escapeHtml(state.slotNames[x.type])}</span>
            <span class="tc-pl">${escapeHtml(nameOf(x.player))}${x.value != null ? `<small>${escapeHtml(basisValue(x.value))}</small>` : ''}</span><span class="tc-price">${money(x.price)}</span>
            <b class="tc-r ${ratingCls(x.rating)}">${x.rating}</b></li>`).join('')}</ol>
        <small class="tc-spent">${L(`Витрачено ${money(t.spent)} з ${money(state.rules.budget)}`, `Spent ${money(t.spent)} of ${money(state.rules.budget)}`)}</small>
      </article>`).join('');
    const find = (id) => r.teams.flatMap((t) => t.players).find((x) => x.player.id === id)?.player;
    const deal = (d, cls, title) => (d ? `<div class="deal ${cls}"><small>${title}</small>${photo(find(d.id), 'deal-ph')}<span><b>${escapeHtml(nameOf(find(d.id)))}</b> · ${escapeHtml(seatName(d.seat))} · ${money(d.price)} → ${L('сила', 'strength')} ${d.rating}</span></div>` : '');
    return `<div class="team-grid">${cards}</div>
      <div class="deals">${deal(r.bargain, 'good', L('Знахідка вікна', 'Bargain of the window'))}${deal(r.overpay, 'bad', L('Переплата', 'Overpay'))}</div>
      <p class="hint center">${r.basis && r.basis !== 'overall'
    ? L(`Сила за режимом «${BASES[r.basis]}»: місце гравця за цим показником серед усіх гравців вікна → 40–99 (число під іменем).`, `Strength by “${BASES[r.basis]}”: the player’s place by this stat among all players in the window → 40–99 (the number under the name).`)
    : L('Сила 40–99 рахується з реальної кар’єри: голи, асисти, сухі матчі й картки (з 2012), трофеї, особисті нагороди з урахуванням сили ліги того року, «Золотий м’яч», рівень клубів, пікова вартість — з вагами під позицію.', 'Strength 40–99 comes from the real career: goals, assists, clean sheets and cards (since 2012), trophies, individual awards weighted by the strength of that league that year, the Ballon d’Or, club level, peak value — weighted by position.')}</p>`;
  }

  function matchesHtml() {
    const r = state.result;
    if (!r.matches.length) return `<p class="hint center">${L('Матчів немає — у вікні лишився один склад.', 'No matches — only one squad was left.')}</p>`;
    const m = r.matches[matchNo] || r.matches[0];
    const players = new Map(r.teams.flatMap((t) => t.players.map((x) => [x.player.id, x.player])));
    const pn = (id) => escapeHtml(nameOf(players.get(id)));
    const tabs = r.matches.map((x, i) => `<button type="button" class="m-tab ${i === matchNo ? 'active' : ''}" data-match="${i}">${escapeHtml(seatName(x.a))} ${x.score[0]}:${x.score[1]} ${escapeHtml(seatName(x.b))}</button>`).join('');
    const ev = m.events.map((e) => {
      const what = e.type === 'goal' ? `<b>${pn(e.player)}</b>${e.assist ? ` <small>${L('пас', 'assist')}: ${pn(e.assist)}</small>` : ''}`
        : `<b>${pn(e.player)}</b>${e.second ? ` <small>${L('друга жовта', 'second yellow')}</small>` : ''}`;
      const icon = `<i class="ev ev-${e.type}" aria-label="${e.type === 'goal' ? L('гол', 'goal') : e.type === 'yellow' ? L('жовта', 'yellow') : L('червона', 'red')}"></i>`;
      return `<li class="${e.team ? 'right' : 'left'}"><span class="ev-side">${e.team ? '' : what}</span><span class="ev-mid">${icon}<em>${e.min}'</em></span><span class="ev-side">${e.team ? what : ''}</span></li>`;
    }).join('') || `<li class="none">${L('Без голів і карток', 'No goals, no cards')}</li>`;
    const stat = (label, a, b) => `<div class="m-stat"><div><b>${a}</b><span>${label}</span><b>${b}</b></div><div class="bar"><i style="width:${a + b ? Math.round((a / (a + b)) * 100) : 50}%"></i></div></div>`;
    const st = m.stats;
    const table = r.table.map((x, i) => `<li style="${seatStyle(x.seat)}" class="${x.seat === mySeat ? 'me' : ''}"><span class="place">${i + 1}</span><span class="dot-p"></span><span class="nm">${escapeHtml(seatName(x.seat))}</span>
        <span class="t-n">${x.played}</span><span class="t-n">${x.w}-${x.d}-${x.l}</span><span class="t-n">${x.gf}:${x.ga}</span><b>${x.pts}</b></li>`).join('');
    return `<div class="m-tabs">${tabs}</div>
      <div class="m-board" style="--pa:${seatColor(m.a)};--pb:${seatColor(m.b)}">
        <div class="m-team"><b>${escapeHtml(seatName(m.a))}</b><small>${L('сила', 'strength')} ${m.strength[0].total}</small></div>
        <div class="m-score"><span>${m.score[0]}</span><i>:</i><span>${m.score[1]}</span></div>
        <div class="m-team right"><b>${escapeHtml(seatName(m.b))}</b><small>${L('сила', 'strength')} ${m.strength[1].total}</small></div>
      </div>
      <div class="m-grid">
        <ol class="m-events">${ev}</ol>
        <div class="m-side">
          <div class="m-stats">${stat(L('Володіння, %', 'Possession, %'), st.possession[0], st.possession[1])}${stat(L('Удари', 'Shots'), st.shots[0], st.shots[1])}${stat(L('У площину', 'On target'), st.onTarget[0], st.onTarget[1])}${stat(L('Кутові', 'Corners'), st.corners[0], st.corners[1])}${stat(L('Жовті', 'Yellows'), st.yellow[0], st.yellow[1])}${stat(L('Червоні', 'Reds'), st.red[0], st.red[1])}</div>
          <div class="league">
            <div class="lg-head"><span>${L('Таблиця', 'Table')}</span><span class="t-n">${L('І', 'P')}</span><span class="t-n">${L('В-Н-П', 'W-D-L')}</span><span class="t-n">${L('М', 'G')}</span><span>${L('О', 'Pts')}</span></div>
            <ol class="standings">${table}</ol>
          </div>
        </div>
      </div>
      <p class="hint center">${L('Рахунок — від сили ліній: атака проти оборони суперника, середина дає моменти. Хто забиває й отримує картки — за реальною частотою гравця. Трохи випадковості лишається, як у футболі.', 'The score comes from line strength: attack against the opponent’s defence, midfield creates chances. Who scores and gets booked follows each player’s real rate. A little luck remains, as in football.')}</p>`;
  }
  const seatColor = (i) => g.SEAT_COLORS[i % g.SEAT_COLORS.length];
  // показник режиму «Сила за» словами: «€180M», «672 голи», «45 трофеїв і нагород»
  function basisValue(v) {
    const b = state.result.basis;
    const pl = (n, uk, en) => `${n} ${window.I18n.plural(n, uk, en)}`;
    if (b === 'value') return money(Math.round(v / 1e6));
    if (b === 'goals') return pl(v, ['гол', 'голи', 'голів'], ['goal', 'goals']);
    if (b === 'assists') return pl(v, ['асист', 'асисти', 'асистів'], ['assist', 'assists']);
    if (b === 'trophies') return L(`${v} трофеїв і нагород`, `${v} trophies & awards`);
    return String(v);
  }
})();
