// «Зараз на сайті»: анонімна мітка браузера (vid) — щоб кілька вкладок рахувались як одна людина.
// Сторінки ігор передають її в auth свого сокета (room-client, crossroads); головна й «Що нового» підключаються до /presence,
// а там, де є [data-online], показуємо число.
window.Presence = (() => {
  let vid = null;
  try {
    vid = localStorage.getItem('vid');
    if (!vid) {
      vid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('vid', vid);
    }
  } catch { /* без сховища — кожна вкладка окремо */ }

  // Підключитись до /presence (сторінки без власного сокета) і показувати число в [data-online].
  function show() {
    if (typeof io !== 'function') return;
    const el = document.querySelector('[data-online]');
    const socket = io('/presence', { auth: { vid } });
    socket.on('online', (n) => {
      if (!el) return;
      el.querySelector('b').textContent = n;
      el.hidden = false;
    });
  }

  return { vid, show };
})();
