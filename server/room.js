const { playerById, categoryById, matches } = require('./data');
const { generateGrid, cellCandidates } = require('./grid');
const { BOARDS, segments } = require('./boards');

const ALLOWED_TIMERS = [0, 15, 20, 30, 45, 60]; // 0 — без обмеження
const MODES = ['easy', 'normal', 'fan', 'hard', 'mix'];
const CLAIM_WIN_AFTER_MS = Number(process.env.CLAIM_WIN_MS) || 2 * 60 * 1000; // гравець офлайн стільки — можна виключити
const MISSED_TURNS_TO_KICK = 2; // …але лише якщо зараз його хід або він уже пропустив стільки ходів поспіль

function publicCategory(id) {
  const c = categoryById.get(id);
  return { id: c.id, type: c.type, label: c.label, short: c.short || null, colors: c.colors, icon: c.icon || null, img: c.img || null };
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, uk: p.uk, photo: p.photo };
}

class Room {
  constructor(code, turnSeconds, onChange, mode = 'normal', boardKey = 'classic', capacity = 2) {
    this.code = code;
    this.turnSeconds = ALLOWED_TIMERS.includes(turnSeconds) ? turnSeconds : 20;
    this.mode = MODES.includes(mode) ? mode : 'normal';
    this.boardKey = BOARDS[boardKey] ? boardKey : 'classic';
    this.cfg = BOARDS[this.boardKey];
    const cap = Number(capacity);
    this.capacity = Number.isInteger(cap) && cap >= 2 && cap <= this.cfg.maxPlayers ? cap : 2;
    this.onChange = onChange;
    this.seats = Array(this.capacity).fill(null); // { token, name, connected, offlineSince }
    this.scores = Array(this.capacity).fill(0); // перемоги в серії
    this.starter = 0;
    this.status = 'waiting'; // waiting | playing | finished
    this.timer = null;
    this.notice = null; // { type: 'left', name } — показуємо тим, хто лишився
    this.lastActivity = Date.now();
    this.eventSeq = 0; // номер події — клієнт по ньому розуміє, що подія нова
    this.chat = []; // останні повідомлення чату (живуть, поки існує кімната)
    this.chatSeq = 0;
    this.resetGameState();
  }

  resetGameState() {
    const n = this.cfg.size;
    this.grid = null;
    this.board = Array(n * n).fill(null); // { seat, playerId }
    this.used = new Set();
    this.out = new Set(); // місця, що вибули з поточної партії (здався / виключений / вийшов)
    this.points = Array(this.capacity).fill(0); // очки в режимі «збір ліній»
    this.missed = Array(this.capacity).fill(0); // пропущені поспіль ходи (час вийшов)
    this.scoredLines = []; // [{ seat, cells }] — зібрані лінії (для підсвічування)
    this.turn = 0;
    this.deadline = null;
    this.winners = []; // місця переможців; порожньо + finished = нічия
    this.winLine = null;
    this.endReason = null;
    this.lastEvent = null;
    this.drawVotes = new Set(); // хто погодився на нічию
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

  presentSeats() {
    return this.seats.map((s, i) => (s ? i : -1)).filter((i) => i !== -1);
  }

  // Ті, хто ще бере участь у поточній партії.
  activeSeats() {
    return this.presentSeats().filter((i) => !this.out.has(i));
  }

  event(data) {
    this.lastEvent = { id: ++this.eventSeq, ...data };
  }

  join(token, name) {
    let seat = this.seatOf(token);
    if (seat === -1) {
      if (this.status !== 'waiting') return { error: 'Гра вже йде — дочекайся кінця або створи свою' };
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

  // Повернення в лобі: ті, хто лишився, займають перші місця й чекають нових гравців за тим самим посиланням.
  backToLobby(notice) {
    clearTimeout(this.timer);
    const left = this.seats.filter(Boolean);
    this.seats = [...left, ...Array(this.capacity - left.length).fill(null)];
    this.resetGameState();
    this.status = 'waiting';
    this.scores = Array(this.capacity).fill(0);
    this.starter = 0;
    this.notice = notice;
  }

  leave(seat) {
    const name = this.seats[seat]?.name;
    this.seats[seat] = null;
    this.touch();
    const present = this.presentSeats();
    if (this.status === 'playing' && present.length >= 2) {
      // утрьох/вчотирьох гра триває без того, хто вийшов (його клітинки лишаються на полі)
      this.out.add(seat);
      this.drawVotes.delete(seat);
      this.event({ type: 'left', seat, name });
      if (this.activeSeats().length < 2) this.finish(this.activeSeats(), 'abandoned');
      else if (this.turn === seat) this.passTurn();
      else this.changed();
    } else {
      this.backToLobby({ type: 'left', name });
      this.changed();
    }
    return { ok: true };
  }

  // ── партія
  newGame() {
    this.resetGameState();
    this.grid = generateGrid(this.mode, this.cfg.size);
    this.status = 'playing';
    this.turn = this.starter;
    this.starter = (this.starter + 1) % this.capacity; // у наступній партії починає наступний
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
    this.missed[this.turn]++;
    this.event({ type: 'timeout', seat: this.turn });
    this.passTurn();
  }

  // Хід переходить до наступного активного гравця по колу.
  passTurn() {
    const active = this.activeSeats();
    for (let step = 1; step <= this.capacity; step++) {
      const next = (this.turn + step) % this.capacity;
      if (active.includes(next)) {
        this.turn = next;
        break;
      }
    }
    this.startTurn();
  }

  move(seat, cell, playerId) {
    const n = this.cfg.size;
    if (this.status !== 'playing') return { error: 'Гра не йде' };
    if (seat !== this.turn) return { error: 'Зараз не ваш хід' };
    if (!Number.isInteger(cell) || cell < 0 || cell >= n * n) return { error: 'Невірна клітинка' };
    if (this.board[cell]) return { error: 'Клітинка вже зайнята' };
    const player = playerById.get(playerId);
    if (!player) return { error: 'Такого футболіста немає в базі' };
    // Правило: один футболіст — один раз за гру. Хід не втрачається, просто треба обрати іншого.
    if (this.used.has(player.id)) return { error: `${player.uk} вже був у цій грі` };

    this.touch();
    this.drawVotes.clear();
    this.missed[seat] = 0;
    const row = this.grid.rows[Math.floor(cell / n)];
    const col = this.grid.cols[cell % n];
    const correct = matches(player, row) && matches(player, col);

    if (!correct) {
      // яку саме умову не виконано — показуємо після ходу, щоб було зрозуміло «чому»
      const failed = [row, col].filter((id) => !matches(player, id)).map((id) => categoryById.get(id).label);
      this.event({ type: 'miss', seat, cell, player: publicPlayer(player), failed });
      this.passTurn();
      return { ok: true, correct: false };
    }

    this.board[cell] = { seat, playerId: player.id };
    this.used.add(player.id);
    const mine = (i) => this.board[i] && this.board[i].seat === seat;
    const completed = segments(n, this.cfg.win).filter((s) => s.includes(cell) && s.every(mine));

    if (this.cfg.scoring === 'points') {
      this.points[seat] += completed.length;
      completed.forEach((cells) => this.scoredLines.push({ seat, cells }));
      this.event({ type: 'hit', seat, cell, player: publicPlayer(player), gained: completed.length });
      if (!this.hasPossibleMoves()) this.finishByPoints(this.board.every(Boolean) ? 'full' : 'stuck');
      else this.passTurn();
      return { ok: true, correct: true };
    }

    this.event({ type: 'hit', seat, cell, player: publicPlayer(player) });
    if (completed.length) this.finish([seat], 'line', completed[0]);
    else if (!this.hasPossibleMoves()) this.finish([], this.board.every(Boolean) ? 'full' : 'stuck');
    else this.passTurn();
    return { ok: true, correct: true };
  }

  skip(seat) {
    if (this.status !== 'playing' || seat !== this.turn) return { error: 'Зараз не ваш хід' };
    this.touch();
    this.missed[seat] = 0;
    this.event({ type: 'skip', seat });
    this.passTurn();
    return { ok: true };
  }

  // Нічия — коли погодились усі, хто ще в грі.
  offerDraw(seat) {
    if (this.status !== 'playing') return { error: 'Гра не йде' };
    if (!this.activeSeats().includes(seat)) return { error: 'Ти вже не в цій партії' };
    this.touch();
    this.drawVotes.add(seat);
    if (this.activeSeats().every((s) => this.drawVotes.has(s))) {
      if (this.cfg.scoring === 'points') this.finishByPoints('agreed');
      else this.finish([], 'agreed');
    } else {
      this.event({ type: 'drawOffer', seat });
      this.changed();
    }
    return { ok: true };
  }

  declineDraw(seat) {
    if (this.status !== 'playing' || !this.drawVotes.size || this.drawVotes.has(seat)) {
      return { error: 'Немає пропозиції нічиєї' };
    }
    this.drawVotes.clear();
    this.event({ type: 'drawDeclined', seat });
    this.changed();
    return { ok: true };
  }

  // Здатися: удвох — перемога супернику; утрьох/вчотирьох — вибуваєш, гра триває.
  surrender(seat) {
    if (this.status !== 'playing') return { error: 'Гра не йде' };
    if (!this.activeSeats().includes(seat)) return { error: 'Ти вже не в цій партії' };
    this.touch();
    this.out.add(seat);
    this.drawVotes.delete(seat);
    const active = this.activeSeats();
    if (active.length < 2) {
      this.finish(active, 'surrender');
    } else {
      this.event({ type: 'surrender', seat });
      if (this.turn === seat) this.passTurn();
      else this.changed();
    }
    return { ok: true };
  }

  // Чи можна виключити гравця, що зник: офлайн щонайменше 2 хв І заважає грі
  // (зараз його хід або він уже пропустив кілька ходів поспіль). Поки ходять інші — його відсутність нікому не шкодить.
  canKick(i) {
    const s = this.seats[i];
    if (!s || s.connected || Date.now() - s.offlineSince < CLAIM_WIN_AFTER_MS) return false;
    return this.turn === i || this.missed[i] >= MISSED_TURNS_TO_KICK;
  }

  // Хтось надовго зник і заважає грі — решта може не чекати: він вибуває з партії.
  claimWin(seat) {
    if (this.status !== 'playing') return { error: 'Гра не йде' };
    const absent = this.activeSeats().filter((i) => i !== seat && this.canKick(i));
    if (!absent.length) return { error: 'Поки нікого не можна виключити' };
    absent.forEach((i) => this.out.add(i));
    const active = this.activeSeats();
    if (active.length < 2) {
      this.finish(active, 'abandoned');
    } else {
      this.event({ type: 'kicked', seats: absent });
      if (absent.includes(this.turn)) this.passTurn();
      else this.changed();
    }
    return { ok: true };
  }

  hasPossibleMoves() {
    const candidates = cellCandidates(this.grid.rows, this.grid.cols, this.used);
    return this.board.some((b, i) => !b && candidates[i].length > 0);
  }

  // «Збір ліній»: перемагає той, у кого більше очок серед тих, хто ще в грі.
  finishByPoints(reason) {
    const active = this.activeSeats();
    const best = Math.max(...active.map((s) => this.points[s]));
    const winners = best > 0 ? active.filter((s) => this.points[s] === best) : [];
    this.finish(winners.length === active.length ? [] : winners, reason);
  }

  finish(winners, reason, line = null) {
    clearTimeout(this.timer);
    this.status = 'finished';
    this.winners = winners;
    this.endReason = reason;
    this.winLine = line;
    this.deadline = null;
    this.drawVotes.clear();
    winners.forEach((s) => this.scores[s]++);
    this.changed();
  }

  // Реванш — коли погодились усі, хто в кімнаті.
  voteRematch(seat) {
    if (this.status !== 'finished') return { error: 'Гра ще не завершена' };
    if (this.presentSeats().length < this.capacity) return { error: 'Хтось вийшов — зачекайте нового гравця' };
    this.rematchVotes.add(seat);
    if (this.presentSeats().every((s) => this.rematchVotes.has(s))) this.newGame();
    else this.changed();
    return { ok: true };
  }

  // ── чат
  addChat(seat, text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!clean) return null;
    const msg = { id: ++this.chatSeq, seat, name: this.seats[seat]?.name || 'Гравець', text: clean, t: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > 100) this.chat.shift();
    this.touch();
    return msg;
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

  // Стан для клієнтів. Правильні відповіді не відправляємо ніколи — ні під час гри, ні після.
  publicState() {
    const state = {
      code: this.code,
      turnSeconds: this.turnSeconds,
      mode: this.mode,
      board: { key: this.boardKey, ...this.cfg },
      capacity: this.capacity,
      seats: this.seats.map((s) =>
        s ? { name: s.name, connected: s.connected, offlineSince: s.offlineSince } : null,
      ),
      out: [...this.out],
      claimWinAfterMs: CLAIM_WIN_AFTER_MS,
      missed: this.missed,
      missedToKick: MISSED_TURNS_TO_KICK,
      scores: this.scores,
      points: this.points,
      scoredLines: this.scoredLines,
      status: this.status,
      notice: this.notice,
      turn: this.turn,
      deadline: this.deadline,
      serverNow: Date.now(),
      winners: this.winners,
      winLine: this.winLine,
      endReason: this.endReason,
      lastEvent: this.lastEvent,
      drawVotes: [...this.drawVotes],
      rematchVotes: [...this.rematchVotes],
      usedIds: [...this.used],
      grid: null,
      cells: this.board.map((b) => (b ? { seat: b.seat, player: publicPlayer(playerById.get(b.playerId)) } : null)),
    };
    if (this.grid) {
      state.grid = {
        size: this.cfg.size,
        rows: this.grid.rows.map(publicCategory),
        cols: this.grid.cols.map(publicCategory),
        // скільки гравців ще можна поставити в кожну клітинку: ті, хто вже на полі, не рахуються
        answerCounts: cellCandidates(this.grid.rows, this.grid.cols, this.used).map((l) => l.length),
      };
    }
    return state;
  }
}

module.exports = { Room, ALLOWED_TIMERS };
