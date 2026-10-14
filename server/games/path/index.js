// «Шлях футболіста»: вгадай гравця за клубами його кар'єри. Сторінка — public/path/, сокети — простір імен /path.
const { createRoomServer } = require('../../core/room-server');
const { PathRoom } = require('./room');

const meta = {
  id: 'path',
  title: 'Шлях футболіста',
  description: "Вгадай гравця за клубами його кар'єри: що раніше вгадаєш — то більше очок.",
  players: 'соло або до 8 гравців',
  emoji: '→',
};

function register({ app, io }) {
  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, options, broadcast) => new PathRoom(code, broadcast, options),
    actions: {
      start: (room, seat) => room.start(seat),
      guess: (room, seat, { playerId } = {}) => room.guess(seat, playerId),
      pass: (room, seat) => room.pass(seat),
      next: (room, seat) => room.next(seat),
    },
    roomInfo: (room) => ({ solo: room.solo, options: room.options }),
  });
}

module.exports = { meta, register };
