// «Чотири четвірки»: 16 футболістів — розклади на 4 групи по 4 за спільною ознакою (клуб, збірна, трофей, тренер, рік…).
// Сторінка — public/fours/, сокети — простір імен /fours.
const { createRoomServer } = require('../../core/room-server');
const { FoursRoom } = require('./room');
const { T } = require('../../core/i18n');

const meta = {
  id: 'fours',
  title: T('Чотири четвірки', 'Four Fours'),
  description: T('16 футболістів — знайди чотири четвірки зі спільною ознакою: клуб, збірна, трофей, тренер. Є «Головоломка дня».',
    'Sixteen footballers — find four groups of four that share something: a club, a nation, a trophy, a coach. With a daily puzzle.'),
  solo: true,
  friends: '2–8',
  emoji: '4️⃣',
};

function register({ app, io }) {
  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, options, broadcast) => new FoursRoom(code, broadcast, options),
    actions: {
      start: (room, seat) => room.start(seat),
      check: (room, seat, { ids } = {}) => room.check(seat, ids),
      giveUp: (room, seat) => room.giveUp(seat),
      next: (room, seat) => room.next(seat),
    },
    roomInfo: (room) => ({ solo: room.solo, options: room.options }),
  });
}

module.exports = { meta, register };
