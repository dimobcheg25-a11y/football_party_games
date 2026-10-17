// «Що нового»: версії з changelog.js — аркуші-вкладки альбому, пункти з позначкою гри.
// Відкриття сторінки запам'ятовує останню дату (localStorage changes-seen) — на головній гасне червона крапка.
const { L } = window.I18n;
const GAMES = {
  crossroads: ['✕', L('Перехрестя', 'Crossroads')],
  path: ['→', L('Шлях', 'Path')],
  guess: ['?', L('Вгадай', 'Guess')],
  spy: ['🕵️', L('Шпигун', 'Spy')],
  top: ['10', L('Топ-10', 'Top 10')],
  duel: ['🥊', L('Один на один', 'One on One')],
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateText = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(window.I18n.lang === 'en' ? 'en-GB' : 'uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });

const list = window.CHANGELOG || [];
document.getElementById('changes').innerHTML = list.map((v, k) => `
  <section class="change-sheet">
    <h2 class="change-date">${esc(dateText(v.date))}${k === 0 ? ` <span class="change-new">${L('найновіше', 'latest')}</span>` : ''}</h2>
    <ul class="change-list">${v.items.map((it) => {
      const g = it.game && GAMES[it.game];
      const tag = g ? `<span class="change-game g-${it.game}"><i>${g[0]}</i>${esc(g[1])}</span>` : `<span class="change-game g-site">${L('Сайт', 'Site')}</span>`;
      return `<li>${tag}<span>${esc(L(it.uk, it.en))}</span></li>`;
    }).join('')}</ul>
  </section>`).join('');

try { if (list[0]) localStorage.setItem('changes-seen', list[0].date); } catch { /* без сховища — крапка просто лишиться */ }
