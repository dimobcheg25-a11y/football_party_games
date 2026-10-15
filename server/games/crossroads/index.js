// «Футбольне перехрестя»: футбольні хрестики-нулики. Сторінка — public/crossroads/, сокети — простір імен /crossroads.
const { createRoomServer } = require('../../core/room-server');
const { Room } = require('./room');
const { T } = require('../../core/i18n');

const meta = {
  id: 'crossroads',
  title: T('Футбольне перехрестя', 'Football Crossroads'),
  description: T('Хрестики-нулики футболістами: клітинка — гравець, який підходить і рядку, і стовпцю.',
    'Tic-tac-toe with footballers: each cell needs a player who fits both the row and the column.'),
  solo: false,
  friends: '2–4',
  emoji: '✕',
};

function register({ app, io }) {
  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, { turnSeconds, mode, board, players }, broadcast) =>
      new Room(code, Number(turnSeconds), broadcast, mode, board, players),
    actions: {
      move: (room, seat, { cell, playerId } = {}) => room.move(seat, cell, playerId),
      skip: (room, seat) => room.skip(seat),
      offerDraw: (room, seat) => room.offerDraw(seat),
      declineDraw: (room, seat) => room.declineDraw(seat),
      claimWin: (room, seat) => room.claimWin(seat),
      surrender: (room, seat) => room.surrender(seat),
      rematch: (room, seat) => room.voteRematch(seat),
    },
    roomInfo: (room) => ({ board: room.boardKey, mode: room.mode, turnSeconds: room.turnSeconds }),
  });
}

module.exports = { meta, register };
