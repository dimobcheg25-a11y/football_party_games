// Категорії, які рахуються з уже зібраних даних (а не з Вікіпедії при build-players) — додаються гравцям при завантаженні бази:
//   A100  — 100+ асистів: ручний список (manual-tags) + за Transfermarkt з 2012/13 (stats.json, усі змагання)
//   UCL30 — 30+ голів у Лізі чемпіонів (tournaments.json, з Вікіпедії)
//   T80   — трансфер за €80+ млн (transfers.json)
//   JOURNEY — «мандрівник»: 10+ різних клубів у кар'єрі (повернення в той самий клуб — один клуб; careers.json)
const load = (file) => {
  try {
    return require(file);
  } catch {
    return null; // дані ще не зібрані — категорія просто порожня
  }
};

const JOURNEY_CLUBS = 10;

// Клуби, де гравець не зіграв жодного матчу (підписав, але не грав; оренда без матчів) — це не етап кар'єри.
// Лишаємо лише поточний клуб (ще без матчів). Той самий об'єкт careers.json бачать усі ігри (кеш require), тож чистимо один раз.
// Футболістки, що потрапили в базу до фільтра статі в build-players (за P21) — прибираються з бази й кар'єр;
// після наступного npm run build-players їх там не буде й без цього списку.
const EXCLUDED = new Set(['Q27995553', 'Q266873', 'Q273530', 'Q6698219']);

function cleanCareers(careers) {
  if (!careers || careers.cleaned) return;
  for (const q of EXCLUDED) delete careers.careers?.[q];
  for (const c of Object.values(careers.careers || {})) {
    const kept = c.clubs.filter((x, i) => x.a !== 0 || (i === c.clubs.length - 1 && x.e == null));
    if (kept.length) c.clubs = kept;
    // Клуб, з якого гравець їздив в оренди, у таблиці Вікіпедії стоїть перед орендами (Сімеоне: Атлетіко 2022–, потім оренди
    // в Сарагосу й Алавес; Кʼєлліні: Ювентус 2004–2022, потім Фіорентина 2004–05) — ставимо його після оренд у межах його років,
    // щоб порядок етапів і «останній клуб» були справжні. Якщо гравець і зараз в оренді (оренда без року завершення) — лишаємо як є.
    for (let i = 0; i < c.clubs.length; i++) {
      const x = c.clubs[i];
      if (x.loan) continue;
      let j = i + 1;
      while (j < c.clubs.length && c.clubs[j].loan && c.clubs[j].e != null && c.clubs[j].s >= x.s && (x.e == null || c.clubs[j].e <= x.e)) j++;
      if (j > i + 1) {
        c.clubs.splice(j - 1, 0, c.clubs.splice(i, 1)[0]);
        i = j - 1;
      }
    }
    // Той самий клуб двічі поспіль (Саліба: «Сент-Етьєн», потім оренда з «Арсенала» назад у «Сент-Етьєн») — один етап.
    c.clubs = c.clubs.reduce((out, x) => {
      const prev = out[out.length - 1];
      if (prev && prev.t === x.t) {
        Object.assign(prev, { s: Math.min(prev.s ?? x.s, x.s ?? prev.s), e: prev.e == null || x.e == null ? null : Math.max(prev.e, x.e),
          a: (prev.a || 0) + (x.a || 0), g: (prev.g || 0) + (x.g || 0) });
        if (!x.loan) delete prev.loan;
      } else out.push(x);
      return out;
    }, []);
  }
  careers.cleaned = true;
}

function addDerivedTags(players) {
  const transfers = load('./transfers.json') || {};
  // позиція, за якою гравця знають (той самий об'єкт transfers.json бачать усі ігри)
  for (const [id, pos] of Object.entries(require('./manual-positions'))) (transfers[id] ||= {}).pos = pos;
  const stats = load('./stats.json');
  const tournaments = load('./tournaments.json');
  const careers = load('./careers.json');
  cleanCareers(careers);
  const byId = new Map(players.map((p) => [p.id, p]));

  for (const p of players) {
    const t = transfers[p.id];
    if (t?.topFee >= 80e6) p.tags.add('T80');
    if (t?.tm && stats?.players?.[t.tm]?.t[1] >= 100) p.tags.add('A100');
    const career = careers?.careers?.[p.qid];
    if (career) {
      const clubs = new Set(career.clubs.map((x) => x.t).filter((q) => !careers.teams[q]?.national));
      if (clubs.size >= JOURNEY_CLUBS) p.tags.add('JOURNEY');
    }
  }
  for (const [id, goals] of tournaments?.ucl || []) {
    if (id && goals >= 30) byId.get(id)?.tags.add('UCL30');
  }
}

module.exports = { addDerivedTags, cleanCareers, EXCLUDED };
