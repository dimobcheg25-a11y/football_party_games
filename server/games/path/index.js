// «Шлях футболіста»: вгадай гравця за клубами його кар'єри. Сторінка — public/path/, сокети — простір імен /path.
const { createRoomServer } = require('../../core/room-server');
const { PathRoom } = require('./room');
const { T } = require('../../core/i18n');

const meta = {
  id: 'path',
  title: T('Шлях футболіста', 'Footballer’s Path'),
  description: T("Вгадай гравця за клубами його кар'єри: що раніше вгадаєш — то більше очок.", 'Guess the player from the clubs of his career: the sooner you get it, the more points.'),
  solo: true,
  friends: '2–8',
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
      hint: (room, seat, { id } = {}) => room.hint(seat, id),
      pass: (room, seat) => room.pass(seat),
      next: (room, seat) => room.next(seat),
    },
    roomInfo: (room) => ({ solo: room.solo, options: room.options }),
  });
}

module.exports = { meta, register };
