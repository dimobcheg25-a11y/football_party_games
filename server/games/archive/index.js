// «Фотоархів»: матчеве фото під сіткою 5×5 — відкривай квадратики й називай, хто на фото. Сторінка — public/archive/, сокети — /archive.
// Бета: фото ще перевіряються — гравці позначають погані фото й неназваних гравців (reports.js → GitHub Issues).
const express = require('express');
const { createRoomServer } = require('../../core/room-server');
const { ArchiveRoom } = require('./room');
const { shots, shotById, shotsFor, LEVELS, CATEGORIES } = require('./shots');
const { submit, REASONS } = require('./reports');
const { playerById } = require('../../data');
const { T, localize, langOf } = require('../../core/i18n');

const meta = {
  id: 'archive',
  title: T('Фотоархів', 'Photo Archive'),
  description: T('Матчеве фото закрите сіткою 5×5: відкривай квадратики й назви всіх загаданих гравців — що менше відкрив, то більше очок.',
    'A match photo hidden under a 5×5 grid: open tiles and name every player we ask for — the fewer you open, the more points.'),
  solo: true,
  friends: '2–8',
  emoji: '📷',
  beta: true,
};

const UA = 'football-party-games/1.0 (https://github.com/dimobcheg25-a11y/football_party_games; hobby project)';
const IMG_CACHE = 80;

function register({ app, io }) {
  // Скільки фото на кожну категорію й рівень — для підписів на чипах
  app.get('/api/archive/counts', (req, res) => {
    res.json(Object.fromEntries(CATEGORIES.map((c) => [c, Object.fromEntries(LEVELS.map((l) => [l, shotsFor(c, l).length]))])));
  });

  // Фото через наш сервер: у назві файлу Commons часто є імена, а браузеру гравця Commons іноді не віддає сотні картинок поспіль
  const images = new Map(); // id → { type, buf } (останні IMG_CACHE)
  app.get('/api/archive/img/:id', async (req, res) => {
    const shot = shotById.get(req.params.id);
    if (!shot) return res.status(404).end();
    let img = images.get(shot.id);
    if (!img) {
      try {
        const r = await fetch(shot.img, { headers: { 'User-Agent': UA } });
        if (!r.ok) return res.status(502).end();
        img = { type: r.headers.get('content-type') || 'image/jpeg', buf: Buffer.from(await r.arrayBuffer()) };
      } catch {
        return res.status(502).end();
      }
      images.set(shot.id, img);
      if (images.size > IMG_CACHE) images.delete(images.keys().next().value);
    }
    res.set({ 'Content-Type': img.type, 'Cache-Control': 'public, max-age=86400' }).send(img.buf);
  });

  // Звіт гравця після раунду: { shot, kind: 'bad', reason, note } або { shot, kind: 'missing', players: [id] }
  const recent = new Map(); // ip → [час звітів за останню годину]
  const seen = new Set(); // той самий звіт від того самого відвідувача — один раз
  app.post('/api/archive/report', express.json({ limit: '4kb' }), (req, res) => {
    const lang = langOf(req.query.lang);
    const fail = (uk, en) => res.json(localize({ error: T(uk, en) }, lang));
    const { shot: id, kind, reason, note, players: ids, vid } = req.body || {};
    const shot = shotById.get(id);
    if (!shot || !['bad', 'missing'].includes(kind)) return fail('Невідомий звіт', 'Unknown report');
    const players = kind === 'missing' ? [...new Set(Array.isArray(ids) ? ids : [])].slice(0, 5).map((x) => playerById.get(x)).filter(Boolean)
      .filter((p) => !shot.who.includes(p.id)) : [];
    if (kind === 'missing' && !players.length) return fail('Обери гравця, якого немає серед позначених', 'Pick a player who isn’t tagged yet');
    if (kind === 'bad' && !REASONS[reason]) return fail('Обери причину', 'Pick a reason');
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const now = Date.now();
    const times = (recent.get(ip) || []).filter((t) => now - t < 3600e3);
    if (times.length >= 30) return fail('Забагато звітів — спробуй пізніше', 'Too many reports — try again later');
    const key = [vid || ip, shot.id, kind, reason || '', players.map((p) => p.id).sort().join()].join('|');
    if (seen.has(key)) return res.json({ ok: true });
    seen.add(key);
    recent.set(ip, [...times, now]);
    submit({ kind, reason, note: String(note || '').slice(0, 200) }, shot, shot.who.map((x) => playerById.get(x)).filter(Boolean), players);
    res.json({ ok: true });
  });

  createRoomServer({
    app,
    io,
    id: meta.id,
    createRoom: (code, options, broadcast) => new ArchiveRoom(code, broadcast, options),
    actions: {
      start: (room, seat) => room.start(seat),
      open: (room, seat, payload = {}) => room.openTile(seat, payload),
      guess: (room, seat, payload = {}) => room.guess(seat, payload),
      pass: (room, seat) => room.pass(seat),
      finishRound: (room, seat) => room.finishRound(seat),
      skipShot: (room, seat) => room.skipShot(seat),
      next: (room, seat) => room.next(seat),
    },
    roomInfo: (room) => ({ solo: room.solo, options: room.options }),
  });
  if (!shots.length) console.log('[archive] немає server/data/shots.json — запусти npm run build-shots');
}

module.exports = { meta, register };
