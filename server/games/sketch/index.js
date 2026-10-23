// «Тактичний ескіз»: один малює загадане (футболіста, клуб, термін чи трофей), решта вгадує в чаті.
// Сторінка — public/sketch/, сокети — простір імен /sketch; штрихи — подія 'draw' (без розсилки всього стану).
const { createRoomServer } = require('../../core/room-server');
const { SketchRoom } = require('./room');
const { T, localize, langOf } = require('../../core/i18n');
const { dictionary } = require('./words');

const meta = {
  id: 'sketch',
  title: T('Тактичний ескіз', 'Tactical Sketch'),
  description: T('Малюй футболіста, клуб чи термін на серветці — друзі вгадують у чаті. Хто швидше, той більше.',
    'Sketch a footballer, a club or a term on a napkin — friends guess in the chat. The faster, the more points.'),
  solo: false,
  friends: '2–10',
  emoji: '✏️',
};

function register({ app, io }) {
  // Словник для підказок при введенні відповіді (усі можливі слова; браузер кешує)
  app.get('/api/sketch/words', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(localize(dictionary, langOf(req.query.lang)));
  });

  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, options, broadcast) => new SketchRoom(code, broadcast, options),
    actions: {
      start: (room, seat) => room.start(seat),
      choose: (room, seat, { key } = {}) => room.choose(seat, key),
      snapshot: (room) => room.snapshot(),
      pass: (room, seat) => room.pass(seat),
      giveUp: (room, seat) => room.giveUp(seat),
    },
    streams: {
      draw: (room, seat, op) => room.drawOp(seat, op),
    },
    roomInfo: (room) => ({ solo: false, options: room.options }),
  });
}

module.exports = { meta, register };
