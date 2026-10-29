// Статистика сайту — Umami Cloud (без cookies, банер згоди не потрібен). Відвідування й час на сторінках Umami рахує сам;
// ігрові події — Track(назва, дані) з room-client.js, feedback.js і crossroads/app.js.
// Лише на справжньому сайті: локальний сервер, автотести й ui-check статистику не засмічують.
(() => {
  const HOST = 'football-party-games.onrender.com';
  const live = location.hostname === HOST;
  if (live) {
    const s = document.createElement('script');
    s.defer = true;
    s.src = 'https://cloud.umami.is/script.js';
    s.dataset.websiteId = '22569490-349a-47b9-b7d3-ee01214d1b69';
    s.dataset.domains = HOST;
    document.head.appendChild(s);
  }
  window.Track = (name, data) => {
    try { if (live) window.umami?.track(name, data); } catch { /* статистика ніколи не ламає гру */ }
  };
})();
