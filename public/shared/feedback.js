// Кнопка «💬 Відгук про гру» на сторінці кожної гри: підписана, закріплена внизу ліворуч (справа — чат), ставиться сама; відкриває вікно (вид відгуку, текст, контакт за бажанням)
// і шле POST /api/feedback → GitHub Issues (server/core/feedback.js). Гра — з адреси сторінки (/top/ → top).
// window.Feedback.open() — відкрити вікно з коду гри. Підключати після /shared/i18n.js.
window.Feedback = (() => {
  const { L } = window.I18n;
  const game = location.pathname.split('/')[1];
  const KINDS = [
    ['like', L('👍 Подобається', '👍 I like it')],
    ['idea', L('💡 Ідея', '💡 Idea')],
    ['bug', L('🐞 Щось не так', '🐞 Something’s wrong')],
  ];
  const PLACEHOLDER = {
    like: L('Що саме сподобалось?', 'What did you like?'),
    idea: L('Що додати чи змінити? Новий режим, тема, гравці…', 'What should we add or change? A new mode, topic, players…'),
    bug: L('Що сталося і де? Що ти робив перед тим?', 'What happened and where? What were you doing just before?'),
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function open() {
    if (document.querySelector('.fb-overlay')) return;
    let kind = 'idea';
    const box = document.createElement('div');
    box.className = 'overlay fb-overlay';
    box.innerHTML = `<div class="overlay-backdrop"></div>
      <form class="sheet ask-sheet fb-sheet" role="dialog" aria-modal="true" aria-labelledby="fb-title">
        <div class="sheet-head"><h3 id="fb-title">${L('💬 Відгук про гру', '💬 Feedback')}</h3>
          <button type="button" class="round-btn" data-fb-close aria-label="${L('Закрити', 'Close')}">✕</button></div>
        <p class="fb-lead">${L('Що подобається, чого бракує, що зламалось? Ми читаємо кожен відгук: саме з них беруться нові режими й виправлення.',
          'What do you like, what’s missing, what’s broken? We read every message — that’s where new modes and fixes come from.')}</p>
        <div class="chips fb-kinds" role="radiogroup">${KINDS.map(([k, t]) => `<button type="button" class="chip${k === kind ? ' active' : ''}" data-kind="${k}" aria-pressed="${k === kind}">${t}</button>`).join('')}</div>
        <textarea id="fb-text" rows="5" maxlength="2000" placeholder="${esc(PLACEHOLDER[kind])}"></textarea>
        <input id="fb-contact" maxlength="100" autocomplete="off" placeholder="${L('Ім’я чи контакт, якщо хочеш відповіді', 'Your name or contact, if you’d like a reply')}" />
        <p class="fb-error hidden" role="alert"></p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-secondary" data-fb-close>${L('Скасувати', 'Cancel')}</button>
          <button type="submit" class="btn btn-primary" id="fb-send" disabled>${L('Надіслати', 'Send')}</button>
        </div>
      </form>`;
    const $ = (sel) => box.querySelector(sel);
    const close = () => {
      document.removeEventListener('keydown', onKey);
      box.remove();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    box.addEventListener('click', (e) => {
      if (e.target.classList.contains('overlay-backdrop') || e.target.closest('[data-fb-close]')) return close();
      const chip = e.target.closest('[data-kind]');
      if (!chip) return;
      kind = chip.dataset.kind;
      box.querySelectorAll('[data-kind]').forEach((c) => {
        c.classList.toggle('active', c === chip);
        c.setAttribute('aria-pressed', c === chip);
      });
      $('#fb-text').placeholder = PLACEHOLDER[kind];
      $('#fb-text').focus();
    });
    $('#fb-text').addEventListener('input', () => { $('#fb-send').disabled = $('#fb-text').value.trim().length < 3; });
    $('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.fb-error');
      $('#fb-send').disabled = true;
      try {
        const r = await fetch(`/api/feedback?lang=${window.I18n.lang}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ game, kind, text: $('#fb-text').value, contact: $('#fb-contact').value }),
        });
        const res = await r.json();
        if (res.error) throw new Error(res.error);
      } catch (x) {
        err.textContent = x.message && !/fetch|JSON/i.test(x.message) ? x.message : L('Не вдалося надіслати. Спробуй ще раз.', 'Couldn’t send it. Please try again.');
        err.classList.remove('hidden');
        $('#fb-send').disabled = false;
        return;
      }
      $('form').innerHTML = `<p class="fb-thanks">${L('Дякуємо! 💛', 'Thank you! 💛')}</p>
        <small class="ask-note">${L('Ми отримали відгук і скоро його подивимось.', 'We got it and will take a look soon.')}</small>
        <div class="confirm-actions"><button type="button" class="btn btn-primary" data-fb-close>${L('Грати далі', 'Back to the game')}</button></div>`;
      $('[data-fb-close]').focus();
    });
    document.body.append(box);
    $('#fb-text').focus();
  }

  function mount() {
    if (document.querySelector('.fb-fab')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fb-fab';
    btn.innerHTML = `<span aria-hidden="true">💬</span> <span class="fb-long">${L('Відгук про гру', 'Feedback')}</span><span class="fb-short">${L('Відгук', 'Feedback')}</span>`;
    btn.setAttribute('aria-label', L('Залишити відгук про гру', 'Leave feedback about the game'));
    btn.addEventListener('click', open);
    document.body.append(btn);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  return { open };
})();
