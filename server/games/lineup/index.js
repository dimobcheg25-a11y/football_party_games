// «Склад матчу»: схема легендарного матчу без прізвищ — назви, хто грав (і тренерів). Сторінка — public/lineup/, сокети — /lineup.
const { createRoomServer } = require('../../core/room-server');
const { LineupRoom } = require('./room');
const { matches, coaches, CATEGORIES } = require('./matches');
const { T, localize, langOf } = require('../../core/i18n');

const meta = {
  id: 'lineup',
  title: T('Склад матчу', 'Match Lineup'),
  description: T('Склад легендарного матчу без прізвищ — лише номери, прапори й клуби. Згадай, хто вийшов на поле і хто тренував.',
    'The team sheet of a legendary match without names — just numbers, flags and clubs. Remember who played and who managed.'),
  solo: true,
  friends: '2–8',
  emoji: '📋',
};

function register({ app, io }) {
  // Тренери для пошуку (у пошуку гравців їх може не бути): /api/lineup/coaches?lang=en
  app.get('/api/lineup/coaches', (req, res) => {
    res.json(localize(coaches.map((c) => ({ key: c.key, name: c.name, photo: c.photo || null })), langOf(req.query.lang)));
  });
  // Скільки матчів у кожній категорії — для підписів на чипах
  app.get('/api/lineup/categories', (req, res) => {
    res.json(localize(Object.entries(CATEGORIES).map(([id, title]) => ({ id, title, count: matches.filter((m) => m.tags.includes(id)).length })), langOf(req.query.lang)));
  });

  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, options, broadcast) => new LineupRoom(code, broadcast, options),
    actions: {
      start: (room, seat) => room.start(seat),
      guess: (room, seat, payload = {}) => room.guess(seat, payload),
      hint: (room, seat, payload = {}) => room.hint(seat, payload),
      pass: (room, seat) => room.pass(seat),
      finishRound: (room, seat) => room.finishRound(seat),
      skipMatch: (room, seat) => room.skipMatch(seat),
      next: (room, seat) => room.next(seat),
    },
    roomInfo: (room) => ({ solo: room.solo, options: room.options }),
  });
}

module.exports = { meta, register };
