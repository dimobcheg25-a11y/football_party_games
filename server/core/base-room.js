// Спільне для кімнат усіх ігор: місця гравців (за токеном), онлайн/офлайн, чат, активність, голосування «далі», кінець гри.
// Гра наслідує BaseRoom і сама вирішує, що робити при вході/виході (join/leave) і що показувати (publicState).
// Хід гри — у грі: checkProgress() (якщо є) викликається, коли хтось зник чи повернувся, — офлайн не тримає гру.
const { T } = require('./i18n');

class BaseRoom {
  constructor(code, onChange, capacity) {
    this.code = code;
    this.onChange = onChange;
    this.capacity = capacity;
    this.seats = Array(capacity).fill(null); // { token, name, connected, offlineSince }
    this.lastActivity = Date.now();
    this.chat = []; // останні повідомлення чату (живуть, поки існує кімната)
    this.chatSeq = 0;
    this.timer = null;
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

  // Повернення того, хто вже має місце (перепідключення, друга вкладка). -1 — місця немає.
  rejoin(token, name) {
    const seat = this.seatOf(token);
    if (seat !== -1) {
      Object.assign(this.seats[seat], { connected: true, offlineSince: null });
      if (name) this.seats[seat].name = name;
    }
    return seat;
  }

  // Нове місце (перше вільне). -1 — кімната заповнена.
  takeSeat(token, name) {
    const seat = this.seats.findIndex((s) => s === null);
    if (seat !== -1) this.seats[seat] = { token, name, connected: true, offlineSince: null };
    return seat;
  }

  // Онлайн серед місць (типово — серед усіх зайнятих).
  online(list = this.presentSeats()) {
    return list.filter((i) => this.seats[i]?.connected);
  }

  setConnected(token, connected) {
    const seat = this.seatOf(token);
    if (seat === -1) return;
    Object.assign(this.seats[seat], { connected, offlineSince: connected ? null : Date.now() });
    this.touch();
    if (this.status === 'playing') this.checkProgress?.();
    this.changed();
  }

  publicSeats() {
    return this.seats.map((s) => (s ? { name: s.name, connected: s.connected, offlineSince: s.offlineSince } : null));
  }

  // ── чат
  // keep: false — повідомлення не потрапляє в історію (бачать лише ті, кому його розіслали зараз).
  addChat(seat, text, { keep = true } = {}) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!clean) return null;
    const msg = { id: ++this.chatSeq, seat, name: this.seats[seat]?.name || 'Гравець', text: clean, t: Date.now() };
    if (keep) this.keepChat(msg);
    this.touch();
    return msg;
  }

  // Повідомлення від гри (текст — T(uk, en)): розіслати — this.postChat(msg) (ставить room-server).
  addSystemChat(text) {
    const msg = { id: ++this.chatSeq, seat: -1, system: true, text, t: Date.now() };
    this.keepChat(msg);
    return msg;
  }

  keepChat(msg) {
    this.chat.push(msg);
    if (this.chat.length > 100) this.chat.shift();
  }

  // ── раунди: після раунду (phase 'reveal') кожен тисне «далі» (this.nextVotes — Set, гра очищує на новому раунді);
  // коли натиснули всі онлайн (allVotedNext) — гра в checkProgress переходить далі.
  next(seat) {
    if (this.status !== 'playing' || this.phase !== 'reveal') return { error: this.busyText?.() || T('Раунд ще йде', 'The round is still on') };
    this.nextVotes.add(seat);
    this.checkProgress();
    if (this.phase === 'reveal') this.changed();
    return { ok: true };
  }

  allVotedNext(list) {
    const online = this.online(list);
    return online.length > 0 && online.every((i) => this.nextVotes.has(i));
  }

  // Кінець серії (гра з підсумком на кшталт «Трансферного вікна» перевизначає).
  finish() {
    clearTimeout(this.timer);
    this.status = 'finished';
    this.phase = null;
    this.deadline = null;
    this.changed();
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
}

module.exports = { BaseRoom };
