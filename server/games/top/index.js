// «Топ-10»: назви футболістів із топу (найдорожчі трансфери, бомбардири клубу чи збірної…) — що нижче місце, то більше очок.
// Сторінка — public/top/, сокети — простір імен /top.
const { createRoomServer } = require('../../core/room-server');
const { TopRoom } = require('./room');
const { topicsFor, CATEGORIES, SIZES } = require('./tops');

const meta = {
  id: 'top',
  title: 'Топ-10',
  description: 'Найдорожчі трансфери, бомбардири клубів і збірних, рекордсмени за матчами — назви всіх із топу.',
  solo: true,
  friends: '2–8',
  emoji: '10',
};

function register({ app, io }) {
  // Список тем для вибору господарем: /api/top/topics?categories=transfers,goals&size=10
  app.get('/api/top/topics', (req, res) => {
    const categories = String(req.query.categories || '').split(',').filter((c) => CATEGORIES[c]);
    const size = SIZES.includes(Number(req.query.size)) ? Number(req.query.size) : 10;
    res.json(topicsFor(categories.length ? categories : Object.keys(CATEGORIES), size).map((t) => ({ id: t.id, title: t.title, category: t.category })));
  });

  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, options, broadcast) => new TopRoom(code, broadcast, options),
    actions: {
      start: (room, seat) => room.start(seat),
      pickTopic: (room, seat, { topicId } = {}) => room.pickTopic(seat, topicId),
      guess: (room, seat, { playerId } = {}) => room.guess(seat, playerId),
      pass: (room, seat) => room.pass(seat),
      giveUp: (room, seat) => room.giveUp(seat),
      next: (room, seat) => room.next(seat),
    },
    roomInfo: (room) => ({ solo: room.solo, options: room.options }),
  });
}

module.exports = { meta, register };
