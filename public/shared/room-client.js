// Спільна частина клієнта ігор із кімнатами (усі, крім «Перехрестя»): налаштування на головному екрані, вхід/перепідключення,
// запрошення за посиланням, лобі, вихід, чат, реакції, звук. Гра дає лише свою частину — renderGame, renderFinal, звуки.
//
//   const g = RoomClient.create({
//     id: 'top', title: 'Топ-10',
//     defaults: { size: '10', … },             // налаштування нової гри (чипи [data-opt], [data-multi], [data-toggle] на головному екрані)
//     fixSetup(setup),                         // необов'язково: виправити збережене (невідомі значення → типові)
//     onSetup(setup),                          // необов'язково: дорисувати головний екран (підказки, приховані поля)
//     hints: { опція: { значення: 'текст' } }, // необов'язково: підказка під вибором — у #<опція>-hint, змінюється разом із вибором
//                                              // (#difficulty-hint для difficulty — сама, з LABELS.DIFFICULTY_HINTS)
//     createOptions(setup) → {…},              // що надіслати серверу в 'create' (числа — Number)
//     optionList(options, solo) → [рядки],     // налаштування кімнати словами (лобі, запрошення)
//     onState(state, prev),                    // новий стан: свої змінні гри, звуки
//     renderGame(), renderFinal(),             // екрани гри й підсумку (state — g.state)
//     lobbyExtra(seat) → html,                 // необов'язково: дописати до гравця в лобі
//     onChat(list, нове?),                     // необов'язково: чат кімнати змінився (своя стрічка в грі; m.system — повідомлення гри)
//   });
//   g.$, g.emit, g.act (emit + тост помилки), g.toast, g.escapeHtml, g.initials, g.plural, g.seatName, g.seatStyle, g.SEAT_COLORS,
//   g.state, g.mySeat, g.serverNow(), g.showScreen, g.store, g.socket, g.setup, g.renderSetup(),
//   g.ask(питання, { note, ok, cancel, danger }) → Promise<true|false> — підтвердження у вікні в стилі гри (замість confirm()),
//   g.createRoom(solo, extra) — створити гру з додатковими налаштуваннями (своя кнопка старту, як «Головоломка дня»).
// Розмітка сторінки — як у public/top/index.html (id елементів ті самі).
window.RoomClient = (() => {
  const { L } = window.I18n; // мова сторінки — /shared/i18n.js (підключати раніше за цей файл)
  const LABELS = {
    ERA: { all: L('Усі гравці', 'All players'), modern: L('Сучасні', 'Current'), retired: L('Завершили кар’єру', 'Retired') },
    DIFF: { easy: L('🟢 Легкий', '🟢 Easy'), normal: L('🟡 Звичайний', '🟡 Normal'), fan: L('🟣 Фанат', '🟣 Fan'), hard: L('🔴 Складний', '🔴 Hard'), expert: L('⚫ Експерт', '⚫ Expert') },
    DIFFICULTY_HINTS: {
      easy: L('400 найвідоміших футболістів: зірки й основні гравці топ-клубів.', 'The 400 most famous footballers: stars and regulars of top clubs.'),
      normal: L('800 найвідоміших: гравці топ-ліг і збірних, а українців трохи більше.', 'The 800 most famous: players from top leagues and national teams, with a few more Ukrainians.'),
      fan: L('1300 найвідоміших — для тих, хто дивиться футбол щотижня.', 'The 1300 most famous — for those who watch football every week.'),
      hard: L('1900 найвідоміших, серед них гравці УПЛ 2000-х і середняки топ-ліг.', 'The 1900 most famous, including Ukrainian league players of the 2000s and mid-table regulars.'),
      expert: L('Усі гравці з нашої бази, навіть ті, кого пам’ятають лише справжні фанати.', 'Everyone in our database, even players only true fans remember.'),
    },
  };
  const SEAT_COLORS = ['#4fb3ff', '#ff6b8b', '#ffb547', '#a98bff', '#5fe0b5', '#ff8a4c', '#e0e86a', '#f08fe0', '#7fd4ff', '#c7a6ff'];
  const REACTIONS = ['👍', '😂', '😮', '😡', '🔥', '👏'];

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };
  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => {
    const parts = String(name).split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : String(name).slice(0, 2)).toUpperCase();
  };
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  const $ = (sel) => document.querySelector(sel);

  // Підтвердження у вікні сторінки (системний confirm() виглядає чужим): кольори й шрифт — токени гри (--surface-solid, --display…).
  // Esc або клік повз вікно — «ні».
  function ask(text, { note = '', ok = L('Так', 'Yes'), cancel = L('Скасувати', 'Cancel'), danger = false } = {}) {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'overlay ask-overlay';
      box.innerHTML = `<div class="overlay-backdrop"></div>
        <div class="sheet confirm-sheet ask-sheet" role="alertdialog" aria-modal="true">
          <p class="ask-text">${escapeHtml(text)}</p>${note ? `<small class="ask-note">${escapeHtml(note)}</small>` : ''}
          <div class="confirm-actions">
            <button class="btn btn-secondary" data-ask="0">${escapeHtml(cancel)}</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ask="1">${escapeHtml(ok)}</button>
          </div>
        </div>`;
      const done = (yes) => {
        document.removeEventListener('keydown', onKey);
        box.remove();
        resolve(yes);
      };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      box.addEventListener('click', (e) => {
        if (e.target.classList.contains('overlay-backdrop')) return done(false);
        const b = e.target.closest('[data-ask]');
        if (b) done(b.dataset.ask === '1');
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(box);
      box.querySelector('[data-ask="1"]').focus();
    });
  }

  function create(cfg) {
    const { id } = cfg;
    const socket = io(`/${id}`, { auth: { lang: window.I18n.lang, vid: window.Presence?.vid } }); // vid — «зараз на сайті» (/shared/presence.js)
    const emit = (event, data) => new Promise((res) => socket.emit(event, data, (r) => res(r || {})));

    let setup = { ...cfg.defaults };
    try { setup = { ...cfg.defaults, ...JSON.parse(store.get(`${id}:setup`) || '{}') }; } catch { /* ignore */ }
    cfg.fixSetup?.(setup);
    let session = null; // { code, token }
    try { session = JSON.parse(store.get(`${id}:session`) || 'null'); } catch { /* ignore */ }
    let inviteCode = new URLSearchParams(location.search).get('room');

    const g = {
      $, socket, store, emit, escapeHtml, initials, plural, SEAT_COLORS, LABELS,
      state: null,
      mySeat: -1,
      clockOffset: 0,
      setup,
      serverNow: () => Date.now() + g.clockOffset,
      seatName: (i) => (i === g.mySeat ? L('Ти', 'You') : g.state?.seats[i]?.name || L('Гравець', 'Player')),
      seatStyle: (i) => `--pc:${SEAT_COLORS[i % SEAT_COLORS.length]}`,
      async act(event, data) {
        const res = await emit(event, data);
        if (res.error) toast(res.error, 'bad');
        return res;
      },
      toast,
      ask,
      showScreen,
      render,
      renderSetup, // перемалювати чипи налаштувань (напр., коли гра довантажила, які варіанти доступні)
    };

    function showScreen(name) {
      for (const s of ['home', 'lobby', 'game', 'final']) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
      const inRoom = name !== 'home' && g.state && !g.state.solo;
      $('#chat-fab').classList.toggle('hidden', !inRoom);
      if (!inRoom) toggleChat(false);
    }

    let toastTimer = null;
    function toast(text, kind = '') {
      const el = $('#toast');
      el.textContent = text;
      el.className = `toast show ${kind}`;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (el.className = 'toast'), 2600);
    }

    // ── головний екран: чипи-налаштування (один варіант / кілька / вмикач)
    function renderSetup() {
      cfg.fixSetup?.(setup);
      document.querySelectorAll('[data-opt]').forEach((group) => {
        const key = group.dataset.opt;
        group.querySelectorAll('.chip').forEach((chip) => {
          const on = String(setup[key]) === chip.dataset.val;
          chip.classList.toggle('active', on);
          chip.setAttribute('role', 'radio');
          chip.setAttribute('aria-checked', on);
        });
      });
      document.querySelectorAll('[data-multi]').forEach((group) => {
        const list = setup[group.dataset.multi] || [];
        group.querySelectorAll('.chip').forEach((chip) => {
          const on = list.includes(chip.dataset.val);
          chip.classList.toggle('active', on);
          chip.setAttribute('aria-pressed', on);
        });
      });
      document.querySelectorAll('[data-toggle]').forEach((chip) => {
        const on = !!setup[chip.dataset.toggle];
        chip.classList.toggle('active', on);
        chip.setAttribute('aria-pressed', on);
      });
      const hint = $('#difficulty-hint');
      if (hint && setup.difficulty) hint.textContent = LABELS.DIFFICULTY_HINTS[setup.difficulty] || '';
      for (const [opt, texts] of Object.entries(cfg.hints || {})) {
        const el = document.getElementById(`${opt}-hint`);
        if (el) el.textContent = texts[setup[opt]] || '';
      }
      cfg.onSetup?.(setup);
      store.set(`${id}:setup`, JSON.stringify(setup));
    }

    document.querySelectorAll('[data-opt] .chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        setup[chip.parentElement.dataset.opt] = chip.dataset.val;
        renderSetup();
      }),
    );
    // кілька варіантів — але хоча б один
    document.querySelectorAll('[data-multi] .chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        const key = chip.parentElement.dataset.multi;
        const list = setup[key] || [];
        const has = list.includes(chip.dataset.val);
        if (has && list.length === 1) return toast(L('Потрібен хоча б один варіант', 'Pick at least one option'), 'bad');
        setup[key] = has ? list.filter((x) => x !== chip.dataset.val) : [...list, chip.dataset.val];
        renderSetup();
      }),
    );
    document.querySelectorAll('[data-toggle]').forEach((chip) =>
      chip.addEventListener('click', () => {
        setup[chip.dataset.toggle] = !setup[chip.dataset.toggle];
        renderSetup();
      }),
    );

    const nameInput = $('#name-input');
    nameInput.value = store.get('games:name') || store.get('g9:name') || '';

    function requireName() {
      const name = nameInput.value.trim();
      if (!name) {
        $('#home-error').textContent = L('Введи ім’я', 'Enter your name');
        nameInput.focus();
        return null;
      }
      $('#home-error').textContent = '';
      store.set('games:name', name);
      return name;
    }

    // extra — додаткові налаштування поверх вибраних (напр., «Головоломка дня» у «Чотирьох четвірках»: g.createRoom(true, { daily: true }))
    async function createRoom(solo, extra = {}) {
      const name = requireName();
      if (!name) return;
      onEntered(await emit('create', { ...cfg.createOptions(setup), ...extra, solo, name }));
    }
    g.createRoom = createRoom;
    $('#solo-btn')?.addEventListener('click', () => createRoom(true));
    $('#create-btn').addEventListener('click', () => createRoom(false));

    $('#join-btn').addEventListener('click', async () => {
      const name = requireName();
      if (!name) return;
      const token = session?.code === inviteCode ? session.token : undefined;
      onEntered(await emit('join', { code: inviteCode, name, token }));
    });

    $('#resume-btn').addEventListener('click', async () => {
      const res = await emit('join', { code: session.code, token: session.token, name: nameInput.value.trim() });
      if (res.error) {
        forgetSession();
        renderHome();
        return toast(res.error, 'bad');
      }
      onEntered(res);
    });

    function onEntered(res) {
      if (res.error) {
        $('#home-error').textContent = res.error;
        return;
      }
      session = { code: res.code, token: res.token };
      store.set(`${id}:session`, JSON.stringify(session));
      inviteCode = null;
      history.replaceState(null, '', `?room=${res.code}`);
    }

    function forgetSession() {
      store.del(`${id}:session`);
      session = null;
    }

    // Запрошення за посиланням: лише ім'я і «Приєднатися»; налаштування — від того, хто створив кімнату.
    async function renderHome() {
      const invite = !!inviteCode;
      $('#setup-options').classList.toggle('hidden', invite);
      ($('#start-buttons') || $('#create-btn')).classList.toggle('hidden', invite);
      $('#join-btn').classList.toggle('hidden', !invite);
      $('#invite-note').classList.add('hidden');
      $('#resume-btn').classList.toggle('hidden', invite || !session);
      if (session && !invite) $('#resume-btn').textContent = L('Повернутися до своєї гри', 'Back to your game');
      if (!invite) return;
      try {
        const info = await (await fetch(`/api/${id}/room/${encodeURIComponent(inviteCode)}?lang=${window.I18n.lang}`)).json();
        const note = $('#invite-note');
        note.classList.remove('hidden');
        if (!info.found) {
          note.textContent = L('Цієї кімнати вже немає. Створи свою гру.', 'This room no longer exists. Start your own game.');
          inviteCode = null;
          history.replaceState(null, '', location.pathname);
          return renderHome();
        }
        note.innerHTML = `${escapeHtml(info.players[0] || L('Друг', 'A friend'))} ${L('кличе грати!', 'invites you to play!')}<br><small>${escapeHtml(cfg.optionList(info.options, info.solo).join(' · '))}</small>`;
      } catch { /* мережа — просто без опису */ }
    }

    // ── стан кімнати
    socket.on('connect', () => {
      // перепідключення: сервер пам'ятає нас за токеном
      if (g.state && session) emit('join', { code: session.code, token: session.token });
    });

    socket.on('state', (s) => {
      const prev = g.state;
      g.state = s;
      g.mySeat = s.you;
      g.clockOffset = s.serverNow ? s.serverNow - Date.now() : 0;
      cfg.onState?.(s, prev);
      render();
    });

    function render() {
      if (!g.state) return showScreen('home');
      if (g.state.status === 'waiting') return renderLobby();
      if (g.state.status === 'finished') {
        showScreen('final');
        const isHost = g.mySeat === g.state.host;
        $('#again-btn').classList.toggle('hidden', !isHost);
        cfg.renderFinal();
        return;
      }
      showScreen('game');
      cfg.renderGame();
    }

    function renderLobby() {
      showScreen('lobby');
      const s = g.state;
      $('#lobby-code').textContent = s.code;
      $('#lobby-options').innerHTML = cfg.optionList(s.options, s.solo).map((t) => `<span>${escapeHtml(t)}</span>`).join('');
      const notice = $('#lobby-notice');
      if (notice) {
        notice.classList.toggle('hidden', !s.notice);
        notice.textContent = s.notice || '';
      }
      $('#lobby-players').innerHTML = s.seats
        .map((x, i) => (x ? `<li style="${g.seatStyle(i)}"><span class="dot-p"></span>${escapeHtml(x.name)}${i === g.mySeat ? ` <small>${L('(ти)', '(you)')}</small>` : ''}${i === s.host ? ` <small>${L('· господар', '· host')}</small>` : ''}${x.connected ? '' : ` <small class="muted">${L('· офлайн', '· offline')}</small>`}${cfg.lobbyExtra?.(i) || ''}</li>` : ''))
        .join('');
      const isHost = g.mySeat === s.host;
      const count = s.seats.filter(Boolean).length;
      const min = s.minPlayers || 1;
      const enough = count >= min;
      const btn = $('#start-btn');
      btn.classList.toggle('hidden', !isHost);
      btn.disabled = !enough;
      const players = (n) => window.I18n.plural(n, ['гравець', 'гравці', 'гравців'], ['player', 'players']);
      btn.textContent = !enough ? L(`Потрібно щонайменше ${min} ${players(min)}`, `At least ${min} ${players(min)} needed`)
        : count > 1 ? L(`Почати гру (${count} ${players(count)})`, `Start game (${count} ${players(count)})`) : L('Почати гру', 'Start game');
      $('#lobby-wait').textContent = !isHost ? L(`Чекаємо, поки ${s.seats[s.host]?.name || 'господар'} почне гру.`, `Waiting for ${s.seats[s.host]?.name || 'the host'} to start.`)
        : !enough ? L(`Надішли запрошення друзям: зараз ${count} з ${min}.`, `Send the invite to friends: ${count} of ${min} so far.`)
          : count > 1 ? L('Можна починати або дочекатися ще когось.', 'You can start now or wait for more friends.')
            : L('Надішли запрошення друзям. Хто зайде пізніше, приєднається до гри, яка вже йде.', 'Send the invite to friends. Anyone who joins later will jump into the game in progress.');
    }

    $('#copy-link').addEventListener('click', async () => {
      const link = `${location.origin}${location.pathname}?room=${g.state.code}`;
      try {
        if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: cfg.title, url: link });
        else { await navigator.clipboard.writeText(link); toast(L('Посилання скопійовано', 'Link copied'), 'good'); }
      } catch { /* скасовано */ }
    });
    $('#start-btn').addEventListener('click', () => g.act('start'));
    $('#again-btn').addEventListener('click', () => g.act('start'));

    // ── вихід
    document.querySelectorAll('[data-action="leave"]').forEach((b) => b.addEventListener('click', leave));
    async function leave() {
      if (g.state?.status === 'playing' && !g.state.solo
        && !(await ask(L('Вийти з гри?', 'Leave the game?'), { note: L('Твої очки пропадуть.', 'Your points will be lost.'), ok: L('Вийти', 'Leave'), danger: true }))) return;
      await emit('leave');
      g.state = null;
      forgetSession();
      history.replaceState(null, '', location.pathname);
      showScreen('home');
      renderHome();
    }

    // ── чат і реакції
    const chatPanel = $('#chat-panel');
    let chat = [];
    let unread = 0;
    function toggleChat(open) {
      chatPanel.classList.toggle('hidden', !open);
      if (open) { unread = 0; renderChat(); $('#chat-input').focus(); }
      $('#chat-badge').classList.toggle('hidden', !unread);
      $('#chat-badge').textContent = unread;
    }
    function renderChat() {
      $('#chat-list').innerHTML = chat.length
        ? chat.map((m) => m.system ? `<li class="chat-system">${escapeHtml(m.text)}</li>` : `<li class="${m.seat === g.mySeat ? 'mine' : ''}" style="${g.seatStyle(m.seat)}"><span class="chat-who">${escapeHtml(m.seat === g.mySeat ? L('Ти', 'You') : m.name)}</span><span class="chat-text">${escapeHtml(m.text)}</span></li>`).join('')
        : `<li class="chat-empty">${L('Тут ще тихо', 'Nothing here yet')}</li>`;
      $('#chat-list').scrollTop = 1e6;
    }
    socket.on('chatHistory', (list) => { chat = list; renderChat(); cfg.onChat?.(chat); });
    socket.on('chat', (m) => {
      cfg.onChat?.([...chat, m], m);
      chat.push(m);
      if (chatPanel.classList.contains('hidden') && m.seat !== g.mySeat) unread++;
      renderChat();
      toggleChat(!chatPanel.classList.contains('hidden'));
    });
    $('#chat-fab').addEventListener('click', () => toggleChat(chatPanel.classList.contains('hidden')));
    $('#chat-close').addEventListener('click', () => toggleChat(false));
    $('#chat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = $('#chat-input').value.trim();
      if (!text) return;
      const res = await emit('chat', text);
      if (res.error) return toast(res.error, 'bad');
      $('#chat-input').value = '';
    });

    const reactions = $('#reactions');
    if (reactions) {
      reactions.innerHTML = REACTIONS.map((r) => `<button type="button" data-r="${r}">${r}</button>`).join('');
      reactions.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-r]');
        if (b) socket.emit('react', b.dataset.r);
      });
    }
    // бульбашка з реакцією — біля гравця в таблиці
    socket.on('reaction', ({ seat, emoji }) => {
      const li = $(`#scoreboard li[data-seat="${seat}"]`);
      const bubble = document.createElement('span');
      bubble.className = 'reaction-bubble';
      bubble.textContent = emoji;
      (li || $('#scoreboard'))?.appendChild(bubble);
      setTimeout(() => bubble.remove(), 1800);
    });

    // ── звук
    const muteBtn = $('#mute-btn');
    const renderMute = () => (muteBtn.textContent = window.Sound.isMuted() ? '🔇' : '🔊');
    muteBtn.addEventListener('click', () => { window.Sound.setMuted(!window.Sound.isMuted()); renderMute(); });
    renderMute();

    // ── старт сторінки (після того, як гра підключила свої обробники — тому в мікрозадачі)
    queueMicrotask(() => {
      renderSetup();
      renderHome();
      showScreen('home');
      // повернення після перезавантаження сторінки посеред гри
      if (session && (!inviteCode || inviteCode === session.code)) {
        emit('join', { code: session.code, token: session.token, name: nameInput.value.trim() }).then((res) => {
          if (res.error) {
            forgetSession();
            renderHome();
          } else {
            inviteCode = null;
            history.replaceState(null, '', `?room=${res.code}`);
          }
        });
      }
    });

    return g;
  }

  return { create, ask, LABELS, escapeHtml, initials, plural };
})();
