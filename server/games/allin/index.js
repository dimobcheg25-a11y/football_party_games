// «All in»: питання з числовою відповіддю про футболіста — оцінки гравців стають на сукно, і всі ставлять фішки на найближчу (не більшу).
// Сторінка — public/allin/, сокети — простір імен /allin.
const { createRoomServer } = require('../../core/room-server');
const { AllinRoom } = require('./room');
const { groupList } = require('./questions');
const { T, localize, langOf } = require('../../core/i18n');

const meta = {
  id: 'allin',
  title: T('All in', 'All in'),
  description: T('Скільки голів забив, за скільки продали, у якому році перейшов? Назви число — і став фішки на того, хто найближче.',
    'How many goals, how much was the fee, what year was the move? Name a number — then bet your chips on whoever is closest.'),
  solo: true,
  friends: '2–8',
  emoji: '🎰',
};

function register({ app, io }) {
  // Групи питань, для яких є дані: /api/allin/categories?lang=en
  const groups = groupList();
  app.get('/api/allin/categories', (req, res) => {
    res.json(localize(groups, langOf(req.query.lang)));
  });

  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, options, broadcast) => new AllinRoom(code, broadcast, options),
    actions: {
      start: (room, seat) => room.start(seat),
      guess: (room, seat, payload) => room.guess(seat, payload),
      bet: (room, seat, payload) => room.bet(seat, payload),
      done: (room, seat) => room.done(seat),
      next: (room, seat) => room.next(seat),
    },
    roomInfo: (room) => ({ solo: room.solo, options: room.options }),
  });
}

module.exports = { meta, register };
