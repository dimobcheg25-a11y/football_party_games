// Мова сайту: українська (за замовчуванням) або англійська. Вибір пам'ятаємо (localStorage 'lang'), можна й ?lang=en.
// Підключати ПЕРШИМ зі скриптів сторінки (до players.js / room-client.js).
//
// Статичний HTML: український текст лишається в розмітці, англійський — поруч в атрибутах:
//   <span data-en="Your name">Твоє ім'я</span>          — заміна тексту
//   <li data-en-html="Name <b>any</b> player">…</li>    — заміна з розміткою
//   data-en-placeholder / data-en-title / data-en-aria-label / data-en-content — атрибути
// JS:  I18n.L('Раунд', 'Round') — рядок поточною мовою; I18n.name(p) — ім'я гравця (uk або англійське);
//      I18n.plural(n, ['очко','очки','очок'], ['point','points']); I18n.lang — 'uk' | 'en'.
// Сервер отримує мову через сокет (auth.lang, див. room-client.js) і для /api — ?lang=.
// Перемикач UA/EN ставиться сам у .sound-ctl (сторінки ігор) або в [data-lang-switch] (головна).
window.I18n = (() => {
  const LANGS = ['uk', 'en'];
  let lang = 'uk';
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(q)) localStorage.setItem('lang', q);
    const saved = localStorage.getItem('lang');
    if (LANGS.includes(saved)) lang = saved;
  } catch { /* приватний режим — українська */ }
  document.documentElement.lang = lang;

  const en = lang === 'en';
  const L = (uk, enText) => (en ? enText : uk);
  const name = (p) => (en ? p?.name || p?.uk : p?.uk || p?.name) || '';
  function plural(n, ukForms, enForms) {
    if (en) return Math.abs(n) === 1 ? enForms[0] : enForms[1] ?? enForms[0];
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return ukForms[2];
    if (b === 1) return ukForms[0];
    if (b >= 2 && b <= 4) return ukForms[1];
    return ukForms[2];
  }

  const ATTRS = ['placeholder', 'title', 'aria-label', 'content', 'alt'];
  function apply(root = document) {
    if (!en) return;
    root.querySelectorAll('[data-en]').forEach((el) => { el.textContent = el.dataset.en; });
    root.querySelectorAll('[data-en-html]').forEach((el) => { el.innerHTML = el.dataset.enHtml; });
    for (const attr of ATTRS) {
      root.querySelectorAll(`[data-en-${attr}]`).forEach((el) => el.setAttribute(attr, el.getAttribute(`data-en-${attr}`)));
    }
  }

  function setLang(next) {
    try { localStorage.setItem('lang', next); } catch { /* ignore */ }
    // прибираємо ?lang= з адреси, інакше він перебив би вибір; кімнату (?room=) лишаємо
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    location.replace(url.toString());
  }

  function mountSwitch() {
    const host = document.querySelector('[data-lang-switch]') || document.querySelector('.sound-ctl');
    if (!host || host.querySelector('.lang-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'round-btn lang-btn';
    btn.textContent = en ? 'UA' : 'EN';
    btn.title = en ? 'Українською' : 'In English';
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', () => setLang(en ? 'uk' : 'en'));
    host.prepend(btn);
  }

  const init = () => { apply(); mountSwitch(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { lang, LANGS, L, name, plural, apply, setLang };
})();
