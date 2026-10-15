// «Один на один»: два футболісти й питання («Хто забив більше голів у чемпіонатах?») — обираєш одного, відкриваються обидва числа.
// Сторінка — public/duel/, сокети — простір імен /duel.
const { createRoomServer } = require('../../core/room-server');
const { DuelRoom } = require('./room');
const { groupList } = require('./questions');
const { T, localize, langOf } = require('../../core/i18n');

const meta = {
  id: 'duel',
  title: T('Один на один', 'One on One'),
  description: T('Два футболісти й одне питання: хто забив більше, хто дорожчий, хто старший? Обери — і подивись на цифри.',
    'Two footballers, one question: who scored more, who cost more, who is older? Pick one and see the numbers.'),
  solo: true,
  friends: '2–10',
  emoji: '🥊',
};

function register({ app, io }) {
  // Групи питань, для яких є дані (без facts.json чи Instagram відповідні групи просто відсутні): /api/duel/categories?lang=en
  const groups = groupList();
  app.get('/api/duel/categories', (req, res) => {
    res.json(localize(groups, langOf(req.query.lang)));
  });

  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, options, broadcast) => new DuelRoom(code, broadcast, options),
    actions: {
      start: (room, seat) => room.start(seat),
      answer: (room, seat, { side } = {}) => room.answer(seat, side),
      next: (room, seat) => room.next(seat),
    },
    roomInfo: (room) => ({ solo: room.solo, options: room.options }),
  });
}

module.exports = { meta, register };
