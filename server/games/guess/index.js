// «Вгадай гравця»: як Wordle — називаєш будь-якого футболіста й бачиш, у чому він збігається із загаданим.
// Сторінка — public/guess/, сокети — простір імен /guess.
const { createRoomServer } = require('../../core/room-server');
const { GuessRoom } = require('./room');
const { T } = require('../../core/i18n');

const meta = {
  id: 'guess',
  title: T('Вгадай гравця', 'Guess the Player'),
  description: T('Називай футболістів — і за збігами (збірна, клуби, роки, голи, трофеї) вийди на загаданого.',
    'Name footballers and use the matches (nation, clubs, age, goals, trophies) to track down the mystery player.'),
  solo: true,
  friends: '2–8',
  emoji: '?',
};

function register({ app, io }) {
  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, options, broadcast) => new GuessRoom(code, broadcast, options),
    actions: {
      start: (room, seat) => room.start(seat),
      guess: (room, seat, { playerId } = {}) => room.guess(seat, playerId),
      giveUp: (room, seat) => room.giveUp(seat),
      next: (room, seat) => room.next(seat),
    },
    roomInfo: (room) => ({ solo: room.solo, options: room.options }),
  });
}

module.exports = { meta, register };
