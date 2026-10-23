// Спільна база футболістів для автодоповнення в будь-якій грі: window.Players.search('шевч') → до 8 гравців.
// Нормалізація — як на сервері (server/data/index.js), щоб «Ґ/Г», «Ё/Е», діакритика й апострофи не заважали.
// Гравці росії й білорусі (banned з /api/players) у search не потрапляють — лише в shame(): сірий рядок підказки
// з випадковою принизливою приміткою, без data-i, тож вибрати його не можна.
window.Players = (() => {
  let players = [];
  let banned = [];

  function normalize(s) {
    return s
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/ё/g, 'е').replace(/ґ/g, 'г')
      .replace(/[’'`ʼ]/g, '')
      .replace(/[^a-zа-яіїєø0-9]+/g, ' ')
      .trim();
  }

  const ready = fetch('/api/players')
    .then((r) => r.json())
    .then((list) => {
      const all = list.map((p, rank) => {
        const variants = [p.uk, p.ru, p.name, ...p.aliases].map(normalize);
        return { ...p, rank, variants, tokens: variants.flatMap((v) => v.split(' ')) };
      });
      players = all.filter((p) => !p.banned);
      banned = all.filter((p) => p.banned);
    });

  function search(query, limit = 8, from = players) {
    const q = normalize(query);
    if (!q) return [];
    const parts = q.split(' ');
    const scored = [];
    for (const p of from) {
      // кожне слово запиту має бути початком якогось слова в імені
      if (!parts.every((part) => p.tokens.some((t) => t.startsWith(part)))) continue;
      let score = 0;
      if (p.variants.some((v) => v === q)) score += 100;
      if (p.variants.some((v) => v.startsWith(q))) score += 20;
      // збіг з прізвищем (останнє слово) — вище
      if (p.variants.some((v) => v.split(' ').pop().startsWith(parts[parts.length - 1]))) score += 10;
      scored.push({ p, score });
    }
    // база відсортована за відомістю — серед рівних вище відоміші
    scored.sort((a, b) => b.score - a.score || a.p.rank - b.p.rank);
    return scored.slice(0, limit).map((s) => s.p);
  }

  const SHAME = [
    ['йде за руським військовим кораблем', 'following the russian warship', '🚢'],
    ['пішов на дно разом із крейсером «Москва»', 'went down with the Moskva cruiser', '⚓'],
    ['червона картка довічно', 'red card for life', '🟥'],
    ['офсайд назавжди', 'offside forever', '🚩'],
    ['з боліт відповіді не приймаємо', 'no answers from the swamps', '🐸'],
    ['рукостискання не буде', 'no handshake', '🙅'],
    ['дискваліфікований УЄФА і нами', 'banned by UEFA and by us', '🚫'],
    ['не загадуємо й не згадуємо', 'not guessed, not remembered', '🤐'],
    ['гра без нього — і так нормально', 'the game is fine without him', '🗑️'],
    ['замінений на бавовну', 'substituted by «cotton»', '💥'],
  ];
  const shameOf = new Map(); // id → примітка (одна на весь візит, щоб не мигтіла під час набору)
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Рядки <li> для підказок: росіяни й білоруси, що підходять під запит (від 3 літер, до 2 рядків).
  function shame(query, limit = 2) {
    if (normalize(query).length < 3) return '';
    const en = window.I18n?.lang === 'en';
    return search(query, limit, banned).map((p) => {
      if (!shameOf.has(p.id)) shameOf.set(p.id, SHAME[Math.floor(Math.random() * SHAME.length)]);
      const [uk, eng, icon] = shameOf.get(p.id);
      return `<li class="shamed" aria-disabled="true"><span class="s-avatar">${icon}</span>
        <span class="s-text"><span class="s-main">${esc(en ? p.name : p.uk || p.name)}</span><span class="s-sub">${en ? eng : uk}</span></span></li>`;
    }).join('');
  }

  return { ready, search, shame, normalize };
})();

// Приклад імені в полі «Твоє ім'я» — щоразу інша легенда (щоб друзі не писали всі одне й те саме ім'я з прикладу 🙂).
(() => {
  const LEGENDS = [
    // світові легенди
    'Пеле', 'Марадона', 'Йохан Кройф', 'Беккенбауер', 'Зідан', 'Роналдіньо', 'Ейсебіо', 'Пушкаш', 'Ді Стефано', 'Гаррінча',
    'Платіні', 'Ван Бастен', 'Мальдіні', 'Роберто Баджо', 'Тотті', 'Ромаріо', 'Роналдо', 'Тьєррі Анрі', 'Джордж Бест',
    'Бобі Чарльтон', 'Буффон', 'Кака', 'Девід Бекхем',
    // наші
    'Олег Блохін', 'Шевченко', 'Ребров', 'Бєланов', 'Лобановський',
    // УПЛ
    'Шовковський', 'Тимощук', 'Ярмоленко', 'Коноплянка', 'Ротань', 'Гусєв', 'Алієв', 'Мілевський', 'Шацьких', 'Воронін',
    'Степаненко', 'Ракіцький', 'Срна', 'Луїс Адріано', 'Фернандінью', 'Вілліан', 'Мхітарян', 'Дуглас Коста',
    // Металіст
    'Едмар', 'Марко Девич', 'Хосе Соса', 'Клейтон Шав’єр', 'Папу Гомес', 'Тайсон', 'Горяїнов', 'Крістальдо',
    'Вільягра', 'Себастьян Бланко', 'Валяєв', 'Шелаєв',
  ];
  const LEGENDS_EN = ['Pelé', 'Maradona', 'Johan Cruyff', 'Beckenbauer', 'Zidane', 'Ronaldinho', 'Eusébio', 'Puskás', 'Di Stéfano',
    'Platini', 'Van Basten', 'Maldini', 'Roberto Baggio', 'Totti', 'Romário', 'Thierry Henry', 'George Best', 'Bobby Charlton',
    'Buffon', 'Kaká', 'David Beckham', 'Oleh Blokhin', 'Shevchenko', 'Rebrov', 'Belanov', 'Shovkovskyi', 'Tymoshchuk', 'Srna'];
  const input = document.getElementById('name-input');
  if (input) input.placeholder = window.I18n?.lang === 'en'
    ? `e.g. ${LEGENDS_EN[Math.floor(Math.random() * LEGENDS_EN.length)]}`
    : `Наприклад, ${LEGENDS[Math.floor(Math.random() * LEGENDS.length)]}`;
})();
