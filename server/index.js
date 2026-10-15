const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');
const { publicPlayers } = require('./data');
const games = require('./games');

const { localize, langOf } = require('./core/i18n');
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(compression()); // список гравців ~400 КБ → ~100 КБ

// Старі посилання-запрошення «/?room=КОД» з часів, коли сайт був однією грою.
app.get('/', (req, res, next) => {
  if (!req.query.room) return next();
  res.redirect(302, `/crossroads/?room=${encodeURIComponent(String(req.query.room))}`);
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// Спільна база футболістів — для автодоповнення в будь-якій грі.
app.get('/api/players', (req, res) => {
  res.set('Cache-Control', 'public, max-age=600');
  res.json(publicPlayers);
});

// Список ігор для головної сторінки.
app.get('/api/games', (req, res) => {
  res.json(localize(games.map((g) => g.meta), langOf(req.query.lang))); // meta.title / description — пари T(uk, en)
});

for (const game of games) game.register({ app, io });

server.listen(PORT, () => {
  console.log(`Сайт футбольних ігор запущено: http://localhost:${PORT}`);
});
