const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');
const { publicPlayers } = require('./data');
const { Room } = require('./room');

const PORT = process.env.PORT || 3000;
const ROOM_TTL_MS = 60 * 60 * 1000; // кімнату без активності видаляємо через годину

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(compression()); // список гравців ~400 КБ → ~100 КБ
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/api/players', (req, res) => {
  res.set('Cache-Control', 'public, max-age=600');
  res.json(publicPlayers);
});

const rooms = new Map();

// Короткий опис кімнати для екрана запрошення (до входу): хто вже там і які налаштування.
app.get('/api/room/:code', (req, res) => {
  const room = rooms.get(String(req.params.code || '').toUpperCase());
  // «не знайдено» — звичайна відповідь (не 404), щоб у консолі браузера не було помилки
  if (!room) return res.json({ found: false });
  res.json({
    found: true,
    code: room.code,
    board: room.boardKey,
    mode: room.mode,
    capacity: room.capacity,
    turnSeconds: room.turnSeconds,
    status: room.status,
    players: room.seats.filter(Boolean).map((s) => s.name),
  });
});

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без схожих символів 0/O, 1/I
  let code;
  do {
    code = Array.from(crypto.randomBytes(5), (b) => alphabet[b % alphabet.length]).join('');
  } while (rooms.has(code));
  return code;
}

// Кожному сокету — стан кімнати + його власне місце (воно може змінитися, коли суперник виходить).
function broadcast(room) {
  const state = room.publicState();
  for (const id of io.sockets.adapter.rooms.get(room.code) || []) {
    const s = io.sockets.sockets.get(id);
    if (s) s.emit('state', { ...state, you: room.seatOf(s.data.token) });
  }
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 20) || 'Гравець';
}

io.on('connection', (socket) => {
  // socket.data: { code, token, seat }

  function currentRoom() {
    return socket.data.code ? rooms.get(socket.data.code) : null;
  }

  function enter(room, token, name, cb) {
    const res = room.join(token, cleanName(name));
    if (res.error) return cb?.({ error: res.error });
    socket.join(room.code);
    socket.data = { code: room.code, token, seat: res.seat };
    cb?.({ ok: true, code: room.code, token, seat: res.seat });
    socket.emit('state', { ...room.publicState(), you: res.seat });
    socket.emit('chatHistory', room.chat);
  }

  socket.on('create', ({ name, turnSeconds, mode, board, players } = {}, cb) => {
    const code = makeCode();
    const room = new Room(code, Number(turnSeconds), broadcast, mode, board, players);
    rooms.set(code, room);
    enter(room, crypto.randomUUID(), name, cb);
  });

  socket.on('join', ({ code, name, token } = {}, cb) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return cb?.({ error: 'Кімнату не знайдено' });
    enter(room, token || crypto.randomUUID(), name, cb);
  });

  // Усі ігрові дії: перевіряємо кімнату і місце гравця на сервері.
  const actions = {
    move: (room, seat, { cell, playerId } = {}) => room.move(seat, cell, playerId),
    skip: (room, seat) => room.skip(seat),
    offerDraw: (room, seat) => room.offerDraw(seat),
    declineDraw: (room, seat) => room.declineDraw(seat),
    claimWin: (room, seat) => room.claimWin(seat),
    surrender: (room, seat) => room.surrender(seat),
    rematch: (room, seat) => room.voteRematch(seat),
  };
  for (const [event, handler] of Object.entries(actions)) {
    socket.on(event, (payload, cb) => {
      const room = currentRoom();
      if (!room) return cb?.({ error: 'Ви не в кімнаті' });
      const seat = room.seatOf(socket.data.token);
      if (seat === -1) return cb?.({ error: 'Ви не гравець цієї кімнати' });
      cb?.(handler(room, seat, payload));
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
    if (!room) return cb?.({ error: 'Ви не в кімнаті' });
    const seat = room.seatOf(socket.data.token);
    if (seat === -1) return cb?.({ error: 'Ви не гравець цієї кімнати' });
    if (Date.now() - lastChat < 700) return cb?.({ error: 'Не так швидко 🙂' });
    const msg = room.addChat(seat, text);
    if (!msg) return cb?.({ error: 'Порожнє повідомлення' });
    lastChat = Date.now();
    io.to(room.code).emit('chat', msg);
    cb?.({ ok: true });
  });

  // Швидкі реакції-емодзі: не частіше ніж раз на секунду.
  const REACTIONS = ['👍', '😂', '😮', '😡', '🔥', '👏'];
  let lastReaction = 0;
  socket.on('react', (emoji) => {
    const room = currentRoom();
    if (!room || !REACTIONS.includes(emoji) || Date.now() - lastReaction < 1000) return;
    const seat = room.seatOf(socket.data.token);
    if (seat === -1) return;
    lastReaction = Date.now();
    io.to(room.code).emit('reaction', { seat, emoji });
  });

  socket.on('disconnect', () => {
    const room = currentRoom();
    if (!room) return;
    // Гравець міг відкрити кілька вкладок — офлайн, лише якщо не лишилось жодного сокета.
    const stillHere = [...(io.sockets.adapter.rooms.get(room.code) || [])].some(
      (id) => io.sockets.sockets.get(id)?.data.token === socket.data.token,
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

server.listen(PORT, () => {
  console.log(`Гра «Футбольне перехрестя» запущена: http://localhost:${PORT}`);
});
