const { playerById, categoryById, matches } = require('../../data');
const { generateGrid, cellCandidates, isFamous } = require('./grid');
const { BOARDS, segments } = require('./boards');
const { BaseRoom } = require('../../core/base-room');
const { T } = require('../../core/i18n');

const ALLOWED_TIMERS = [0, 15, 20, 30, 45, 60]; // 0 — без обмеження
const MODES = ['easy', 'normal', 'fan', 'hard', 'mix'];
const CLAIM_WIN_AFTER_MS = Number(process.env.CLAIM_WIN_MS) || 2 * 60 * 1000; // гравець офлайн стільки — можна виключити
const MISSED_TURNS_TO_KICK = 2; // …але лише якщо зараз його хід або він уже пропустив стільки ходів поспіль

// Назва категорії парою мов (англійська — c.en / c.enShort з categories.js)
const catLabel = (c) => T(c.label, c.en);
const catShort = (c) => (c.short || c.enShort ? T(c.short || c.label, c.enShort || c.en) : null);

function publicCategory(id) {
  const c = categoryById.get(id);
  return { id: c.id, type: c.type, label: catLabel(c), short: catShort(c), colors: c.colors, icon: c.icon || null, img: c.img || null };
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, uk: p.uk, photo: p.photo };
}

class Room extends BaseRoom {
  constructor(code, turnSeconds, onChange, mode = 'normal', boardKey = 'classic', capacity = 2) {
    const board = BOARDS[boardKey] ? boardKey : 'classic';
    const cap = Number(capacity);
    super(code, onChange, Number.isInteger(cap) && cap >= 2 && cap <= BOARDS[board].maxPlayers ? cap : 2);
    this.turnSeconds = ALLOWED_TIMERS.includes(turnSeconds) ? turnSeconds : 20;
    this.mode = MODES.includes(mode) ? mode : 'normal';
    this.boardKey = board;
    this.cfg = BOARDS[board];
    this.scores = Array(this.capacity).fill(0); // перемоги в серії
    this.status = 'waiting'; // waiting | playing | finished
    this.notice = null; // { type: 'left', name } — показуємо тим, хто лишився
    this.eventSeq = 0; // номер події — клієнт по ньому розуміє, що подія нова
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
    this.order = []; // черговість ходів (місця), визначена жеребом
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
  // Ті, хто ще бере участь у поточній партії.
  activeSeats() {
    return this.presentSeats().filter((i) => !this.out.has(i));
  }

  event(data) {
    this.lastEvent = { id: ++this.eventSeq, ...data };
  }

  join(token, name) {
    let seat = this.rejoin(token, name);
    if (seat === -1) {
      if (this.status !== 'waiting') return { error: T('Гра вже йде — дочекайся кінця або створи свою', 'The game is already on — wait for it to end or start your own') };
      seat = this.takeSeat(token, name);
      if (seat === -1) return { error: T('Кімната вже заповнена — створи свою гру', 'The room is full — start your own game') };
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

  // Повернення в лобі: ті, хто лишився, займають перші місця й чекають нових гравців за тим самим посиланням.
  backToLobby(notice) {
    clearTimeout(this.timer);
    const left = this.seats.filter(Boolean);
    this.seats = [...left, ...Array(this.capacity - left.length).fill(null)];
    this.resetGameState();
    this.status = 'waiting';
    this.scores = Array(this.capacity).fill(0);
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
    // Жереб: черговість ходів випадкова на кожну партію (а не «хто створив кімнату — той і перший»).
    // FIXED_ORDER=1 — передбачуваний порядок для автотестів: за місцями, з зсувом на кожну наступну партію.
    this.order = this.presentSeats();
    this.gameNo = (this.gameNo || 0) + 1;
    if (process.env.FIXED_ORDER === '1') {
      const k = (this.gameNo - 1) % this.order.length;
      this.order = [...this.order.slice(k), ...this.order.slice(0, k)];
    } else {
      for (let i = this.order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
      }
    }
    this.turn = this.order[0];
    this.event({ type: 'start', order: [...this.order] });
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

  // Хід переходить до наступного активного гравця за чергою, визначеною жеребом.
  passTurn() {
    const active = this.activeSeats();
    const pos = this.order.indexOf(this.turn);
    for (let step = 1; step <= this.order.length; step++) {
      const next = this.order[(pos + step) % this.order.length];
      if (active.includes(next)) {
        this.turn = next;
        break;
      }
    }
    this.startTurn();
  }

  move(seat, cell, playerId) {
    const n = this.cfg.size;
    if (this.status !== 'playing') return { error: T('Гра не йде', 'The game is not in progress') };
    if (seat !== this.turn) return { error: T('Зараз не ваш хід', "It's not your turn") };
    if (!Number.isInteger(cell) || cell < 0 || cell >= n * n) return { error: T('Невірна клітинка', 'Invalid cell') };
    if (this.board[cell]) return { error: T('Клітинка вже зайнята', 'That cell is already taken') };
    const player = playerById.get(playerId);
    if (!player) return { error: T('Такого футболіста немає в базі', 'No such footballer in the database') };
    // Правило: один футболіст — один раз за гру. Хід не втрачається, просто треба обрати іншого.
    if (this.used.has(player.id)) return { error: T(`${player.uk} вже був у цій грі`, `${player.name} has already been used in this game`) };

    this.touch();
    this.drawVotes.clear();
    this.missed[seat] = 0;
    const row = this.grid.rows[Math.floor(cell / n)];
    const col = this.grid.cols[cell % n];
    const correct = matches(player, row) && matches(player, col);

    if (!correct) {
      // яку саме умову не виконано — показуємо після ходу, щоб було зрозуміло «чому»
      const failed = [row, col].filter((id) => !matches(player, id)).map((id) => catLabel(categoryById.get(id)));
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
    if (this.status !== 'playing' || seat !== this.turn) return { error: T('Зараз не ваш хід', "It's not your turn") };
    this.touch();
    this.missed[seat] = 0;
    this.event({ type: 'skip', seat });
    this.passTurn();
    return { ok: true };
  }

  // Нічия — коли погодились усі, хто ще в грі.
  offerDraw(seat) {
    if (this.status !== 'playing') return { error: T('Гра не йде', 'The game is not in progress') };
    if (!this.activeSeats().includes(seat)) return { error: T('Ти вже не в цій партії', 'You are no longer in this game') };
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
      return { error: T('Немає пропозиції нічиєї', 'There is no draw offer') };
    }
    this.drawVotes.clear();
    this.event({ type: 'drawDeclined', seat });
    this.changed();
    return { ok: true };
  }

  // Здатися: удвох — перемога супернику; утрьох/вчотирьох — вибуваєш, гра триває.
  surrender(seat) {
    if (this.status !== 'playing') return { error: T('Гра не йде', 'The game is not in progress') };
    if (!this.activeSeats().includes(seat)) return { error: T('Ти вже не в цій партії', 'You are no longer in this game') };
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
    if (this.status !== 'playing') return { error: T('Гра не йде', 'The game is not in progress') };
    const absent = this.activeSeats().filter((i) => i !== seat && this.canKick(i));
    if (!absent.length) return { error: T('Поки нікого не можна виключити', 'No one can be removed yet') };
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
    if (this.status !== 'finished') return { error: T('Гра ще не завершена', 'The game is not over yet') };
    if (this.presentSeats().length < this.capacity) return { error: T('Хтось вийшов — зачекайте нового гравця', 'Someone left — wait for a new player') };
    this.rematchVotes.add(seat);
    if (this.presentSeats().every((s) => this.rematchVotes.has(s))) this.newGame();
    else this.changed();
    return { ok: true };
  }

  // Стан для клієнтів. Правильні відповіді не відправляємо ніколи — ні під час гри, ні після.
  publicState() {
    const state = {
      code: this.code,
      turnSeconds: this.turnSeconds,
      mode: this.mode,
      board: { key: this.boardKey, ...this.cfg },
      capacity: this.capacity,
      seats: this.publicSeats(),
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
      order: this.order,
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
        // з них відомих (див. isFamous) — щоб було видно, чи є в клітинці кого згадати
        famousCounts: cellCandidates(this.grid.rows, this.grid.cols, this.used, isFamous).map((l) => l.length),
      };
    }
    return state;
  }
}

module.exports = { Room, ALLOWED_TIMERS };
