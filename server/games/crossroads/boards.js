// Варіанти поля. Розмір, скільки в ряд для перемоги, як рахується результат і скільки може бути гравців.
//   line   — перемагає той, хто першим збере `win` у ряд (горизонталь, вертикаль, діагональ);
//   points — гра йде до кінця, кожна лінія з `win` своїх клітинок поспіль = 1 очко, перемагає той, у кого більше.

const { T } = require('../../core/i18n');

const BOARDS = {
  classic: { size: 3, win: 3, scoring: 'line', maxPlayers: 2, label: T('Класика 3×3', 'Classic 3×3') },
  five: { size: 5, win: 4, scoring: 'line', maxPlayers: 4, label: T('5×5 · 4 в ряд', '5×5 · 4 in a row') },
  six: { size: 6, win: 4, scoring: 'line', maxPlayers: 4, label: T('6×6 · 4 в ряд', '6×6 · 4 in a row') },
  lines: { size: 6, win: 3, scoring: 'points', maxPlayers: 4, label: T('6×6 · збір ліній', '6×6 · line hunt') },
};

// Усі відрізки довжини k на полі n×n (кожен — масив індексів клітинок).
const segmentCache = new Map();
function segments(n, k) {
  const key = `${n}:${k}`;
  if (segmentCache.has(key)) return segmentCache.get(key);
  const result = [];
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      for (const [dr, dc] of dirs) {
        const endR = r + dr * (k - 1);
        const endC = c + dc * (k - 1);
        if (endR < 0 || endR >= n || endC < 0 || endC >= n) continue;
        result.push(Array.from({ length: k }, (_, i) => (r + dr * i) * n + (c + dc * i)));
      }
    }
  }
  segmentCache.set(key, result);
  return result;
}

module.exports = { BOARDS, segments };
