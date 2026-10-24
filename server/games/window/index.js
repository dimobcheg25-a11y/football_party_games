// «Трансферне вікно»: аукціон із таємними ставками за випадкових гравців по лініях, прихована сила складів і міні-ліга умовних матчів.
// Сторінка — public/window/, сокети — простір імен /window.
const { createRoomServer } = require('../../core/room-server');
const { WindowRoom } = require('./room');
const { T } = require('../../core/i18n');

const meta = {
  id: 'window',
  title: T('Трансферне вікно', 'Transfer Window'),
  description: T('100 мільйонів, таємні ставки, гравці випадають по лініях. Збери склад — а сили гравців ніхто не знає до кінця вікна. Потім — матчі.',
    '100 million, sealed bids, players drawn line by line. Build your XI — nobody knows how strong anyone is until the window shuts. Then the matches.'),
  solo: false,
  friends: '2–8',
  emoji: '💸',
};

function register({ app, io }) {
  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, options, broadcast) => new WindowRoom(code, broadcast, options),
    actions: {
      start: (room, seat) => room.start(seat),
      formation: (room, seat, payload) => room.setFormation(seat, payload),
      bid: (room, seat, payload) => room.bid(seat, payload),
      pick: (room, seat, payload) => room.choose(seat, payload),
    },
    roomInfo: (room) => ({ solo: false, options: room.options }),
  });
}

module.exports = { meta, register };
