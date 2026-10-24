// Кімнати гри поверх Socket.IO: код-запрошення, вхід/перепідключення за токеном, ігрові дії, чат, реакції,
// вихід і прибирання покинутих кімнат. Кожна гра — свій простір імен /<id> і свій /api/<id>/room/:code.
//
//   createRoomServer({ app, io, id, createRoom, actions, roomInfo })
//     createRoom(code, options, broadcast) → кімната (наслідує BaseRoom; має join, leave, publicState;
//                                           необов'язково privateState(seat) — те, що бачить лише цей гравець)
//     actions   — { подія: (room, seat, payload) => відповідь } — ігрові дії гравця
//     roomInfo  — (room) => поля для екрана запрошення (налаштування гри)
//     streams   — { подія: (room, seat, payload) => дані | null } — часті дрібні події (штрихи малюнка): дані йдуть
//                 іншим гравцям кімнати цією ж подією, без розсилки всього стану
//   Кімната може мати screenChat(seat, text) → null (звичайне повідомлення) | { hide, only: [місця], reply } —
//   перевірка чату (відповідь у «Тактичному ескізі»): hide — нікому не показувати, only — лише цим місцям (без історії),
//   reply — що отримає автор. room.postChat(msg, seats?) — розіслати повідомлення гри (addSystemChat) мовою кожного.
//   Тексти — парами T(uk, en) (server/core/i18n.js); кожен сокет отримує стан і відповіді своєю мовою.
const crypto = require('crypto');
const { T, localize, langOf } = require('./i18n');

const NOT_IN_ROOM = T('Ви не в кімнаті', 'You are not in a room');
const NOT_PLAYER = T('Ви не гравець цієї кімнати', 'You are not a player in this room');
const ROOM_TTL_MS = 60 * 60 * 1000; // кімнату без активності видаляємо через годину
const REACTIONS = ['👍', '😂', '😮', '😡', '🔥', '👏'];

function cleanName(name, lang) {
  return String(name || '').trim().slice(0, 20) || (lang === 'en' ? 'Player' : 'Гравець');
}

function createRoomServer({ app, io, id, createRoom, actions, streams = {}, roomInfo = () => ({}) }) {
  const nsp = io.of(`/${id}`);
  const rooms = new Map();

  // Короткий опис кімнати для екрана запрошення (до входу): хто вже там і які налаштування.
  app.get(`/api/${id}/room/:code`, (req, res) => {
    const room = rooms.get(String(req.params.code || '').toUpperCase());
    // «не знайдено» — звичайна відповідь (не 404), щоб у консолі браузера не було помилки
    if (!room) return res.json({ found: false });
    res.json(localize({
      found: true,
      code: room.code,
      capacity: room.capacity,
      status: room.status,
      players: room.seats.filter(Boolean).map((s) => s.name),
      ...roomInfo(room),
    }, langOf(req.query.lang)));
  });

  function makeCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без схожих символів 0/O, 1/I
    let code;
    do {
      code = Array.from(crypto.randomBytes(5), (b) => alphabet[b % alphabet.length]).join('');
    } while (rooms.has(code));
    return code;
  }

  // Стан для одного гравця: спільне + його місце + його особисте (підказки, свої відповіді).
  const stateFor = (room, state, seat, lang) =>
    localize({ ...state, you: seat, ...(room.privateState && seat !== -1 ? room.privateState(seat) : {}) }, lang);

  // Повідомлення чату — кожному сокету кімнати його мовою (seats — лише цим місцям).
  function sendChat(room, msg, seats = null) {
    for (const sid of nsp.adapter.rooms.get(room.code) || []) {
      const s = nsp.sockets.get(sid);
      if (s && (!seats || seats.includes(room.seatOf(s.data.token)))) s.emit('chat', localize(msg, s.lang));
    }
  }

  // Кожному сокету — стан кімнати + його власне місце (воно може змінитися, коли хтось виходить).
  function broadcast(room) {
    const state = room.publicState();
    for (const sid of nsp.adapter.rooms.get(room.code) || []) {
      const s = nsp.sockets.get(sid);
      if (s) s.emit('state', stateFor(room, state, room.seatOf(s.data.token), s.lang));
    }
  }

  nsp.on('connection', (socket) => {
    // socket.data: { code, token, seat }; socket.lang — мова гравця ('uk' | 'en')
    socket.lang = langOf(socket.handshake.auth?.lang);
    const reply = (cb, res) => cb?.(localize(res, socket.lang));

    function currentRoom() {
      return socket.data.code ? rooms.get(socket.data.code) : null;
    }

    function enter(room, token, name, cb) {
      const res = room.join(token, cleanName(name, socket.lang));
      if (res.error) return reply(cb, { error: res.error });
      socket.join(room.code);
      socket.data = { code: room.code, token, seat: res.seat };
      cb?.({ ok: true, code: room.code, token, seat: res.seat });
      socket.emit('state', stateFor(room, room.publicState(), res.seat, socket.lang));
      socket.emit('chatHistory', localize(room.chat, socket.lang));
    }

    socket.on('create', (options = {}, cb) => {
      const code = makeCode();
      const room = createRoom(code, options || {}, broadcast);
      room.postChat = (msg, seats) => sendChat(room, msg, seats);
      rooms.set(code, room);
      enter(room, crypto.randomUUID(), options?.name, cb);
    });

    socket.on('join', ({ code, name, token } = {}, cb) => {
      const room = rooms.get(String(code || '').toUpperCase().trim());
      if (!room) return reply(cb, { error: T('Кімнату не знайдено', 'Room not found') });
      enter(room, token || crypto.randomUUID(), name, cb);
    });

    // Усі ігрові дії: перевіряємо кімнату і місце гравця на сервері.
    for (const [event, handler] of Object.entries(actions)) {
      socket.on(event, (payload, cb) => {
        // emit('hint', cb) — без даних; null / не об'єкт → {} (деструктуризація `{ kind } = {}` на null падає)
        if (typeof payload === 'function') [payload, cb] = [{}, payload];
        if (payload == null || typeof payload !== 'object') payload = {};
        const room = currentRoom();
        if (!room) return reply(cb, { error: NOT_IN_ROOM });
        const seat = room.seatOf(socket.data.token);
        if (seat === -1) return reply(cb, { error: NOT_PLAYER });
        try {
          reply(cb, handler(room, seat, payload, socket.lang));
        } catch (e) {
          console.error(`[${id}] ${event}:`, e); // одна зламана дія не кладе весь сервер
          reply(cb, { error: T('Щось пішло не так', 'Something went wrong') });
        }
      });
    }

    // Часті події без відповіді (штрихи): перевіряє кімната, решті кімнати — як є.
    for (const [event, handler] of Object.entries(streams)) {
      socket.on(event, (payload) => {
        const room = currentRoom();
        const seat = room ? room.seatOf(socket.data.token) : -1;
        if (seat === -1) return;
        const data = handler(room, seat, payload);
        if (data != null) socket.to(room.code).emit(event, data);
      });
    }

    socket.on('leave', (_, cb) => {
      const room = currentRoom();
      if (room) {
        const seat = room.seatOf(socket.data.token);
        socket.leave(room.code);
        if (seat !== -1) room.leave(seat);
        if (room.isEmpty()) {
          room.destroy();
          rooms.delete(room.code);
        }
      }
      socket.data = {};
      cb?.({ ok: true });
    });

    // Чат кімнати: до 200 символів, не частіше ніж раз на 0,7 с.
    let lastChat = 0;
    socket.on('chat', (text, cb) => {
      const room = currentRoom();
      if (!room) return reply(cb, { error: NOT_IN_ROOM });
      const seat = room.seatOf(socket.data.token);
      if (seat === -1) return reply(cb, { error: NOT_PLAYER });
      if (Date.now() - lastChat < 700) return reply(cb, { error: T('Не так швидко 🙂', 'Not so fast 🙂') });
      if (!String(text || '').trim()) return reply(cb, { error: T('Порожнє повідомлення', 'Empty message') });
      lastChat = Date.now();
      const verdict = room.screenChat?.(seat, String(text)) || null;
      if (verdict?.hide) return reply(cb, verdict.reply || { ok: true });
      const msg = room.addChat(seat, text, { keep: !verdict?.only });
      if (verdict?.only) sendChat(room, msg, verdict.only);
      else nsp.to(room.code).emit('chat', msg);
      reply(cb, verdict?.reply || { ok: true });
    });

    // Швидкі реакції-емодзі: не частіше ніж раз на секунду.
    let lastReaction = 0;
    socket.on('react', (emoji) => {
      const room = currentRoom();
      if (!room || !REACTIONS.includes(emoji) || Date.now() - lastReaction < 1000) return;
      const seat = room.seatOf(socket.data.token);
      if (seat === -1) return;
      lastReaction = Date.now();
      nsp.to(room.code).emit('reaction', { seat, emoji });
    });

    socket.on('disconnect', () => {
      const room = currentRoom();
      if (!room) return;
      // Гравець міг відкрити кілька вкладок — офлайн, лише якщо не лишилось жодного сокета.
      const stillHere = [...(nsp.adapter.rooms.get(room.code) || [])].some(
        (sid) => nsp.sockets.get(sid)?.data.token === socket.data.token,
      );
      if (!stillHere) room.setConnected(socket.data.token, false);
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const someoneOnline = room.seats.some((s) => s && s.connected);
      if (room.isEmpty() || (!someoneOnline && now - room.lastActivity > ROOM_TTL_MS)) {
        room.destroy();
        rooms.delete(code);
      }
    }
  }, 5 * 60 * 1000).unref();

  return { rooms };
}

module.exports = { createRoomServer, cleanName };
