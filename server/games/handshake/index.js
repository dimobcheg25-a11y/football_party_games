// «Правило рукостискань»: від одного футболіста до іншого — ланцюжком одноклубників (хто з ким грав разом).
// Сторінка — public/handshake/, сокети — простір імен /handshake.
const { createRoomServer } = require('../../core/room-server');
const { HandshakeRoom } = require('./room');
const { T } = require('../../core/i18n');

const meta = {
  id: 'handshake',
  title: T('Правило рукостискань', 'Handshake Rule'),
  description: T("З'єднай двох футболістів ланцюжком тих, хто грав разом в одному клубі. Що коротший ланцюжок — то більше очок.",
    'Connect two footballers through a chain of club teammates. The shorter the chain, the more you score.'),
  solo: true,
  friends: '2–8',
  emoji: '🤝',
};

function register({ app, io }) {
  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, options, broadcast) => new HandshakeRoom(code, broadcast, options),
    actions: {
      start: (room, seat) => room.start(seat),
      add: (room, seat, { playerId } = {}) => room.add(seat, playerId),
      hint: (room, seat, { kind } = {}) => room.hint(seat, kind),
      giveUp: (room, seat) => room.giveUp(seat),
      next: (room, seat) => room.next(seat),
    },
    roomInfo: (room) => ({ solo: room.solo, options: room.options }),
  });
}

module.exports = { meta, register };
