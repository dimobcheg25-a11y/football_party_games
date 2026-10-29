// Відгуки гравців про гру (кнопка 💬 на сторінці кожної гри — public/shared/feedback.js): кожен відгук — окрема задача (issue)
// у GitHub з міткою feedback і міткою виду (feedback-like / feedback-idea / feedback-bug). Без GITHUB_TOKEN — лише в консоль.
const express = require('express');
const { gh, hasToken } = require('./github');
const { T, localize, langOf } = require('./i18n');
const { findRoom } = require('./room-server');
const { roomSnapshot } = require('./snapshot');

const KINDS = { like: '👍 Подобається', idea: '💡 Ідея', bug: '🐞 Щось не так' };

function setupFeedback(app, games) {
  const titles = Object.fromEntries(games.map((g) => [g.meta.id, localize(g.meta.title, 'uk')]));
  const recent = new Map(); // ip → час відгуків за останню годину
  let chain = Promise.resolve(); // по одному, щоб не впертися в обмеження GitHub

  app.post('/api/feedback', express.json({ limit: '8kb' }), (req, res) => {
    const lang = langOf(req.query.lang);
    const fail = (uk, en) => res.json(localize({ error: T(uk, en) }, lang));
    const { game, kind, text, contact, room: code, token } = req.body || {};
    const body = String(text || '').trim().slice(0, 2000);
    if (!titles[game] || !KINDS[kind]) return fail('Невідомий відгук', 'Unknown feedback');
    if (body.length < 3) return fail('Напиши кілька слів', 'Write a few words');
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const now = Date.now();
    const times = (recent.get(ip) || []).filter((t) => now - t < 3600e3);
    if (times.length >= 10) return fail('Забагато відгуків поспіль. Спробуй трохи пізніше.', 'That’s a lot of feedback in a row. Try again a bit later.');
    recent.set(ip, [...times, now]);

    const who = String(contact || '').trim().slice(0, 100);
    // гравець у кімнаті — знімок його гри: раунд, що загадано, хто що назвав (щоб легше знайти баг)
    const room = code ? findRoom(game, code) : null;
    let snapshot = '';
    try {
      if (room) snapshot = roomSnapshot(room, token ? room.seatOf(String(token)) : -1);
    } catch (e) { snapshot = `не вдалося зняти: ${e.message}`; }
    const first = body.split('\n')[0];
    const issue = {
      title: `${KINDS[kind].split(' ')[0]} ${titles[game]}: ${first.length > 70 ? first.slice(0, 70) + '…' : first}`,
      body: [
        `**Гра:** ${titles[game]} (\`${game}\`) · **Вид:** ${KINDS[kind]} · **Мова:** ${lang}${who ? ` · **Контакт:** ${who}` : ''}`,
        '',
        body.split('\n').map((l) => `> ${l}`).join('\n'),
        '',
        ...(snapshot ? [`<details><summary>Стан гри (кімната ${room.code})</summary>`, '', '```json', snapshot, '```', '</details>', ''] : []),
        `<sub>${String(req.headers['user-agent'] || '').slice(0, 200)}</sub>`,
      ].join('\n'),
      labels: ['feedback', `feedback-${kind}`],
    };
    if (!hasToken) console.log('[feedback] (без GITHUB_TOKEN — лише в консоль):', issue.title);
    else chain = chain.then(() => gh('POST', '/issues', issue)).catch((e) => console.log('[feedback] не відправлено:', e.message));
    res.json({ ok: true });
  });
}

module.exports = { setupFeedback };
