// «Зараз на сайті»: скільки людей відкрили сайт просто зараз (головна, ігри, «Що нового»).
// Рахуємо унікальних відвідувачів, а не з'єднання: браузер має анонімну мітку vid (localStorage, /shared/presence.js),
// тож кілька вкладок однієї людини — одна людина. З'єднання беремо з усіх просторів імен Socket.IO (кімнати ігор теж),
// а головна слухає /presence і отримує число ('online'). Нікуди нічого не зберігається — лише лічильник у пам'яті.
function setupPresence(io) {
  const visitors = new Map(); // vid → скільки відкритих з'єднань
  const presence = io.of('/presence');
  let timer = null;
  const broadcast = () => {
    if (timer) return;
    timer = setTimeout(() => { // кілька змін поспіль (перехід між сторінками) — одне оновлення
      timer = null;
      presence.emit('online', visitors.size);
    }, 1500);
  };

  function track(socket) {
    const vid = String(socket.handshake.auth?.vid || socket.id).slice(0, 64);
    visitors.set(vid, (visitors.get(vid) || 0) + 1);
    broadcast();
    socket.on('disconnect', () => {
      const n = (visitors.get(vid) || 1) - 1;
      if (n > 0) visitors.set(vid, n);
      else visitors.delete(vid);
      broadcast();
    });
  }

  const watch = (nsp) => nsp.on('connection', track);
  for (const nsp of io._nsps.values()) watch(nsp); // простори імен ігор, створені раніше
  io.on('new_namespace', watch);
  presence.on('connection', (socket) => socket.emit('online', visitors.size)); // одразу — поточне число (track уже врахував)
}

module.exports = { setupPresence };
