// «Футбольний шпигун»: усі, крім шпигуна, знають футболіста; по черзі підказки (голосом або текстом), потім пошук шпигуна.
// Сторінка — public/spy/, сокети — простір імен /spy.
const { createRoomServer } = require('../../core/room-server');
const { SpyRoom } = require('./room');
const { T } = require('../../core/i18n');

const meta = {
  id: 'spy',
  title: T('Футбольний шпигун', 'Football Spy'),
  description: T('Усі знають футболіста, крім одного. Давайте підказки по черзі й викрийте шпигуна, поки він не здогадався, про кого мова.',
    'Everyone knows the footballer except one. Take turns giving clues and unmask the spy before they figure out who it is.'),
  solo: false,
  friends: '3–10',
  emoji: '🕵️',
};

function register({ app, io }) {
  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, options, broadcast) => new SpyRoom(code, broadcast, options),
    actions: {
      start: (room, seat) => room.start(seat),
      clue: (room, seat, { text } = {}) => room.clue(seat, text),
      skipTurn: (room, seat) => room.skipTurn(seat),
      forceVote: (room, seat) => room.forceVote(seat),
      requestReroll: (room, seat) => room.requestReroll(seat),
      rerollVote: (room, seat, payload) => room.rerollVote(seat, payload),
      vote: (room, seat, payload) => room.vote(seat, payload),
      spyGuess: (room, seat, payload) => room.spyGuessAction(seat, payload),
      next: (room, seat) => room.next(seat),
    },
    roomInfo: (room) => ({ options: room.options }),
  });
}

module.exports = { meta, register };
