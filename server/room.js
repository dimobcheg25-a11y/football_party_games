const { playerById, categoryById, matches } = require('./data');
const { generateGrid, cellCandidates } = require('./grid');

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const ALLOWED_TIMERS = [0, 15, 20, 30, 45, 60]; // 0 — без обмеження
const MODES = ['easy', 'normal', 'hard'];
const CLAIM_WIN_AFTER_MS = Number(process.env.CLAIM_WIN_MS) || 30 * 1000; // суперник офлайн стільки — можна забрати перемогу

function publicCategory(id) {
  const c = categoryById.get(id);
  return { id: c.id, type: c.type, label: c.label, colors: c.colors, icon: c.icon || null, img: c.img || null };
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, uk: p.uk, photo: p.photo };
}

class Room {
  constructor(code, turnSeconds, onChange, mode = 'normal') {
    this.code = code;
    this.turnSeconds = ALLOWED_TIMERS.includes(turnSeconds) ? turnSeconds : 20;
    this.mode = MODES.includes(mode) ? mode : 'normal';
    this.onChange = onChange;
    this.seats = [null, null]; // { token, name, connected, offlineSince }
    this.scores = [0, 0];
    this.starter = 0;
    this.status = 'waiting'; // waiting | playing | finished
    this.timer = null;
    this.notice = null; // повідомлення для того, хто лишився: { type: 'left', name }
    this.lastActivity = Date.now();
    this.eventSeq = 0; // номер події — клієнт по ньому розуміє, що подія нова (а не повтор при зміні стану)
    this.resetGameState();
  }

  resetGameState() {
    this.grid = null;
    this.board = Array(9).fill(null); // { seat, playerId }
    this.used = new Set();
    this.turn = 0;
    this.deadline = null;
    this.winner = null; // 0 | 1 | 'draw'
    this.winLine = null;
    this.endReason = null;
    this.lastEvent = null;
    this.drawOffer = null; // місце, яке запропонувало нічию
    this.rematchVotes = new Set();
    this.moveNo = 0;
  }

  // ── місця гравців
  seatOf(token) {
    return this.seats.findIndex((s) => s && s.token === token);
  }

  isEmpty() {
    return this.seats.every((s) => s === null);
  }

  join(token, name) {
    let seat = this.seatOf(token);
    if (seat === -1) {
      seat = this.seats.findIndex((s) => s === null);
      if (seat === -1) return { error: 'Кімната вже заповнена — створи свою гру' };
      this.seats[seat] = { token, name, connected: true, offlineSince: null };
    } else {
      Object.assign(this.seats[seat], { connected: true, offlineSince: null });
      if (name) this.seats[seat].name = name;
    }
    this.touch();
    if (this.status === 'waiting' && this.seats.every(Boolean)) {
      this.notice = null;
      this.newGame();
    } else {
      this.changed();
    }
    return { seat };
  }

  setConnected(token, connected) {
    const seat = this.seatOf(token);
    if (seat === -1) return;
    Object.assign(this.seats[seat], { connected, offlineSince: connected ? null : Date.now() });
    this.touch();
    this.changed();
  }

  // Гравець вийшов з кімнати. Хто лишився — чекає нового суперника за тим самим посиланням.
  leave(seat) {
    const name = this.seats[seat]?.name;
    this.seats[seat] = null;
    this.touch();
    clearTimeout(this.timer);
    this.resetGameState();
    this.status = 'waiting';
    this.scores = [0, 0];
    this.starter = 0;
    this.notice = { type: 'left', name };
    // той, хто лишився, переїжджає на місце 0, щоб новий гравець сів на 1
    if (!this.seats[0] && this.seats[1]) this.seats = [this.seats[1], null];
    this.changed();
    return { ok: true };
  }

  // ── партія
  newGame() {
    this.resetGameState();
    this.grid = generateGrid(this.mode);
    this.status = 'playing';
    this.turn = this.starter;
    this.starter = 1 - this.starter; // у наступній партії починає інший
    this.startTurn();
  }

  startTurn() {
    clearTimeout(this.timer);
    this.moveNo++;
    if (this.turnSeconds > 0) {
      const ms = this.turnSeconds * 1000;
      this.deadline = Date.now() + ms;
      const moveNo = this.moveNo;
      this.timer = setTimeout(() => this.onTimeout(moveNo), ms + 300); // невеликий запас на мережу
    } else {
      this.deadline = null;
    }
    this.changed();
  }

  onTimeout(moveNo) {
    if (this.status !== 'playing' || moveNo !== this.moveNo) return;
    this.lastEvent = { id: ++this.eventSeq, type: 'timeout', seat: this.turn };
    this.passTurn();
  }

  passTurn() {
    this.drawOffer = null;
    this.turn = 1 - this.turn;
    this.startTurn();
  }

  move(seat, cell, playerId) {
    if (this.status !== 'playing') return { error: 'Гра не йде' };
    if (seat !== this.turn) return { error: 'Зараз не ваш хід' };
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { error: 'Невірна клітинка' };
    if (this.board[cell]) return { error: 'Клітинка вже зайнята' };
    const player = playerById.get(playerId);
    if (!player) return { error: 'Такого футболіста немає в базі' };
    // Правило: один футболіст — один раз за гру. Хід не втрачається, просто треба обрати іншого.
    if (this.used.has(player.id)) return { error: `${player.uk} вже був у цій грі` };

    this.touch();
    const row = this.grid.rows[Math.floor(cell / 3)];
    const col = this.grid.cols[cell % 3];
    const correct = matches(player, row) && matches(player, col);

    if (!correct) {
      // яку саме умову не виконано — показуємо після ходу, щоб було зрозуміло «чому»
      const failed = [row, col].filter((id) => !matches(player, id)).map((id) => categoryById.get(id).label);
      this.lastEvent = { id: ++this.eventSeq, type: 'miss', seat, cell, player: publicPlayer(player), failed };
      this.passTurn();
      return { ok: true, correct: false };
    }

    this.board[cell] = { seat, playerId: player.id };
    this.used.add(player.id);
    this.lastEvent = { id: ++this.eventSeq, type: 'hit', seat, cell, player: publicPlayer(player) };

    const line = LINES.find((l) => l.every((i) => this.board[i] && this.board[i].seat === seat));
    if (line) {
      this.finish(seat, 'line', line);
    } else if (!this.hasPossibleMoves()) {
      this.finish('draw', this.board.every(Boolean) ? 'full' : 'stuck');
    } else {
      this.passTurn();
    }
    return { ok: true, correct: true };
  }

  skip(seat) {
    if (this.status !== 'playing' || seat !== this.turn) return { error: 'Зараз не ваш хід' };
    this.touch();
    this.lastEvent = { id: ++this.eventSeq, type: 'skip', seat };
    this.passTurn();
    return { ok: true };
  }

  offerDraw(seat) {
    if (this.status !== 'playing') return { error: 'Гра не йде' };
    this.touch();
    if (this.drawOffer === 1 - seat) {
      this.finish('draw', 'agreed');
    } else {
      this.drawOffer = seat;
      this.lastEvent = { id: ++this.eventSeq, type: 'drawOffer', seat };
      this.changed();
    }
    return { ok: true };
  }

  declineDraw(seat) {
    if (this.status !== 'playing' || this.drawOffer !== 1 - seat) return { error: 'Немає пропозиції нічиєї' };
    this.drawOffer = null;
    this.lastEvent = { id: ++this.eventSeq, type: 'drawDeclined', seat };
    this.changed();
    return { ok: true };
  }

  surrender(seat) {
    if (this.status !== 'playing') return { error: 'Гра не йде' };
    this.touch();
    this.finish(1 - seat, 'surrender');
    return { ok: true };
  }

  // Суперник надовго зник — можна не чекати і забрати перемогу.
  claimWin(seat) {
    if (this.status !== 'playing') return { error: 'Гра не йде' };
    const opp = this.seats[1 - seat];
    if (!opp || opp.connected || Date.now() - opp.offlineSince < CLAIM_WIN_AFTER_MS) {
      return { error: 'Суперник ще в грі' };
    }
    this.finish(seat, 'abandoned');
    return { ok: true };
  }

  hasPossibleMoves() {
    const candidates = cellCandidates(this.grid.rows, this.grid.cols, this.used);
    return this.board.some((b, i) => !b && candidates[i].length > 0);
  }

  finish(winner, reason, line = null) {
    clearTimeout(this.timer);
    this.status = 'finished';
    this.winner = winner;
    this.endReason = reason;
    this.winLine = line;
    this.deadline = null;
    this.drawOffer = null;
    if (winner === 0 || winner === 1) this.scores[winner]++;
    this.changed();
  }

  voteRematch(seat) {
    if (this.status !== 'finished') return { error: 'Гра ще не завершена' };
    if (!this.seats[1 - seat]) return { error: 'Суперник вийшов' };
    this.rematchVotes.add(seat);
    if (this.rematchVotes.size === 2) this.newGame();
    else this.changed();
    return { ok: true };
  }

  // ── сервісне
  touch() {
    this.lastActivity = Date.now();
  }

  changed() {
    this.onChange(this);
  }

  destroy() {
    clearTimeout(this.timer);
  }

  // Стан для клієнтів. Правильні відповіді не відправляємо, поки гра йде.
  publicState() {
    const state = {
      code: this.code,
      turnSeconds: this.turnSeconds,
      mode: this.mode,
      seats: this.seats.map((s) =>
        s ? { name: s.name, connected: s.connected, offlineSince: s.offlineSince } : null,
      ),
      claimWinAfterMs: CLAIM_WIN_AFTER_MS,
      scores: this.scores,
      status: this.status,
      notice: this.notice,
      turn: this.turn,
      deadline: this.deadline,
      serverNow: Date.now(),
      winner: this.winner,
      winLine: this.winLine,
      endReason: this.endReason,
      lastEvent: this.lastEvent,
      drawOffer: this.drawOffer,
      rematchVotes: [...this.rematchVotes],
      usedIds: [...this.used],
      grid: null,
      board: this.board.map((b) => (b ? { seat: b.seat, player: publicPlayer(playerById.get(b.playerId)) } : null)),
      reveal: null,
    };
    if (this.grid) {
      state.grid = {
        rows: this.grid.rows.map(publicCategory),
        cols: this.grid.cols.map(publicCategory),
        answerCounts: this.grid.answerCounts,
      };
    }
    if (this.status === 'finished' && this.grid) {
      // Після гри показуємо, кого можна було поставити у порожні клітинки (найвідоміших).
      const candidates = cellCandidates(this.grid.rows, this.grid.cols, this.used);
      state.reveal = candidates.map((ids, i) =>
        this.board[i] ? null : ids.slice(0, 3).map((id) => publicPlayer(playerById.get(id))),
      );
    }
    return state;
  }
}

module.exports = { Room, ALLOWED_TIMERS };
