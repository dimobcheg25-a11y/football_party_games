// Склади легендарних матчів для гри «Склад матчу» → server/data/lineups.json.
// Два джерела:
//  • статті англійської Вікіпедії про фінали (ЧС, Євро, Копа, Кубок чемпіонів / ЛЧ, Кубок УЄФА / ЛЄ) і окремі знамениті матчі:
//    таблиця складів «|GK ||'''1''' ||{{flagicon|BRA}} [[Dida …|Dida]] || {{yel|..}} || {{suboff|112}}», заміни, тренер, кольори форми, голи;
//  • API УЄФА (match.uefa.com/v5) — вибрані матчі єврокубків і Євро, яких немає окремими статтями (Металіст Маркевича, Динамо,
//    Шахтар, збірна України, легендарні камбеки): склад з координатами на полі, номери, тренер, голи й заміни.
// Гравців зіставляємо з нашою базою: Вікіпедія — посилання (з редиректами) → p.wiki; УЄФА — ім'я + рік народження.
// Кого в базі немає — лишається з іменем (у грі відкритий одразу). Клуби/збірні — qid через Wikidata (за статтею Вікіпедії).
// Запуск: npm run build-lineups (≈3 хв, після build-players і build-careers).

const fs = require('fs');
const path = require('path');
const { getJson, sleep } = require('./lib/wikidata');
const { players, normalize } = require('../server/data');

const OUT = path.join(__dirname, '..', 'server', 'data', 'lineups.json');
const WIKI = 'https://en.wikipedia.org/w/api.php';
const UEFA = 'https://match.uefa.com/v5';

// ── які статті Вікіпедії брати
const range = (a, b, step = 1) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);
const ARTICLES = [
  ...range(1966, 2022, 4).filter((y) => y !== 1942 && y !== 1946).map((y) => ({ title: `${y} FIFA World Cup final`, comp: 'wc', round: 'final' })),
  ...range(1976, 2024, 4).map((y) => ({ title: `UEFA Euro ${y} final`, comp: 'euro', round: 'final' })),
  ...range(1970, 2025).map((y) => ({ title: `${y} ${y <= 1992 ? 'European Cup' : 'UEFA Champions League'} final`, comp: 'ucl', round: 'final' })),
  ...range(1998, 2025).map((y) => ({ title: `${y} ${y <= 2009 ? 'UEFA Cup' : 'UEFA Europa League'} final`, comp: 'uel', round: 'final' })),
  ...['2004 Copa América final', '2007 Copa América final', '2011 Copa América final', '2015 Copa América final', 'Copa América Centenario final',
    '2019 Copa América final', '2021 Copa América final', '2024 Copa América final'].map((title) => ({ title, comp: 'copa', round: 'final' })),
  // окремі знамениті матчі зі своїми статтями
  ...[
    ['Brazil v Germany (2014 FIFA World Cup)', 'wc', 'semi'],
    ['Italy v West Germany (1970 FIFA World Cup)', 'wc', 'semi'],
    ['Brazil v Italy (1982 FIFA World Cup)', 'wc', 'group'],
    ['Argentina v England (1986 FIFA World Cup)', 'wc', 'quarter'],
    ['West Germany v France (1982 FIFA World Cup)', 'wc', 'semi'],
  ].map(([title, comp, round]) => ({ title, comp, round, legend: true })),
];

// ── вибрані матчі з API УЄФА: competitionId (1 — ЛЧ/Кубок чемпіонів, 14 — Кубок УЄФА/ЛЄ, 3 — Євро) і id матчу.
// Як знайти id: GET /v5/matches?competitionId=..&seasonYear=..&limit=100 і пошук за назвами команд.
const UEFA_MATCHES = [
  // Металіст Мирона Маркевича
  ...[303957, 304203, 304243, 304798, 304814, 304839, 2002977, 2007242, 2007423, 2007460, 2007474, 2010008, 2011721]
    .map((id) => ({ id, tags: ['ua', 'metalist'] })),
];
// Ще матчі УЄФА, які шукаємо за командами (id знайде збирач): { comp, season (рік завершення сезону), home, away, tags }.
const UEFA_FIND = [
  // Динамо Київ і Шахтар
  { comp: 1, season: 1998, home: 'Barcelona', away: 'Dynamo Kyiv', tags: ['ua'] },
  { comp: 1, season: 1998, home: 'Dynamo Kyiv', away: 'Barcelona', tags: ['ua'] },
  { comp: 1, season: 1999, home: 'Dynamo Kyiv', away: 'Real Madrid', tags: ['ua'] },
  { comp: 1, season: 1999, home: 'Dynamo Kyiv', away: 'Bayern', tags: ['ua'] },
  { comp: 1, season: 2011, home: 'Shakhtar', away: 'Roma', tags: ['ua'] },
  { comp: 1, season: 2018, home: 'Shakhtar', away: 'Man City', tags: ['ua'] },
  // збірна України на Євро
  { comp: 3, season: 2012, home: 'Ukraine', away: 'Sweden', tags: ['ua'] },
  { comp: 3, season: 2021, home: 'Sweden', away: 'Ukraine', tags: ['ua'] },
  { comp: 3, season: 2024, home: 'Slovakia', away: 'Ukraine', tags: ['ua'] },
  // легендарні матчі Ліги чемпіонів і Євро
  { comp: 1, season: 2017, home: 'Barcelona', away: 'Paris', tags: ['legend'] },
  { comp: 1, season: 2019, home: 'Liverpool', away: 'Barcelona', tags: ['legend'] },
  { comp: 1, season: 2019, home: 'Ajax', away: 'Tottenham', tags: ['legend'] },
  { comp: 1, season: 2018, home: 'Roma', away: 'Barcelona', tags: ['legend'] },
  { comp: 1, season: 2004, home: 'Deportivo', away: 'Milan', tags: ['legend'] },
  { comp: 1, season: 2020, home: 'Barcelona', away: 'Bayern', tags: ['legend'] },
  { comp: 1, season: 2022, home: 'Real Madrid', away: 'Man City', tags: ['legend'] },
  { comp: 1, season: 2010, home: 'Inter', away: 'Barcelona', tags: ['legend'] },
  { comp: 1, season: 2012, home: 'Barcelona', away: 'Chelsea', tags: ['legend'] },
  { comp: 1, season: 1999, home: 'Juventus', away: 'Man Utd', tags: ['legend'] },
  { comp: 3, season: 2016, home: 'England', away: 'Iceland', tags: ['legend'] },
  { comp: 3, season: 2021, home: 'France', away: 'Switzerland', tags: ['legend'] },
];

// коди збірних у шаблонах {{fb|ARG}} → стаття Вікіпедії (звідти qid)
const NATION_CODES = {
  ARG: 'Argentina', FRA: 'France', GER: 'Germany', FRG: 'Germany', NED: 'Netherlands', ITA: 'Italy', BRA: 'Brazil', ESP: 'Spain',
  ENG: 'England', POR: 'Portugal', CRO: 'Croatia', URU: 'Uruguay', DEN: 'Denmark', GRE: 'Greece', BEL: 'Belgium', CZE: 'Czech Republic',
  TCH: 'Czechoslovakia', URS: 'Soviet Union', YUG: 'Yugoslavia', SWE: 'Sweden', CHI: 'Chile', COL: 'Colombia', MEX: 'Mexico',
  HUN: 'Hungary', UKR: 'Ukraine', PER: 'Peru', PAR: 'Paraguay', BOL: 'Bolivia', ECU: 'Ecuador', USA: 'United States', CAN: 'Canada',
  SUI: 'Switzerland', AUT: 'Austria', POL: 'Poland', SCO: 'Scotland', WAL: 'Wales', IRL: 'Republic of Ireland', TUR: 'Turkey',
  KOR: 'South Korea', JPN: 'Japan', ISL: 'Iceland', SVK: 'Slovakia',
};

const wikiTitle = (t) => t.replace(/_/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());

async function wiki(params) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  return getJson(`${WIKI}?${qs}`);
}

// тексти статей (з редиректами) пачками по 50
async function fetchTexts(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const j = await wiki({ action: 'query', titles: chunk.join('|'), prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1' });
    const q = j.query || {};
    const back = new Map((q.redirects || []).map((r) => [r.to, r.from]));
    const norm = new Map((q.normalized || []).map((r) => [r.to, r.from]));
    for (const p of q.pages || []) {
      if (p.missing || !p.revisions) continue;
      let from = back.get(p.title) || p.title;
      from = norm.get(from) || from;
      out.set(from, p.revisions[0].slots.main.content);
    }
    await sleep(300);
  }
  return out;
}

// куди ведуть посилання (редиректи): назва → справжня стаття
async function resolveTitles(titles) {
  const out = new Map();
  const list = [...new Set(titles)];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const j = await wiki({ action: 'query', titles: chunk.join('|'), redirects: '1' });
    const q = j.query || {};
    const norm = new Map((q.normalized || []).map((r) => [r.from, r.to]));
    const redir = new Map((q.redirects || []).map((r) => [r.from, r.to]));
    for (const t of chunk) {
      const n = norm.get(t) || t;
      out.set(t, redir.get(n) || n);
    }
    await sleep(200);
  }
  return out;
}

// qid за статтею англійської Вікіпедії
async function qidsOf(titles) {
  const out = new Map();
  const list = [...new Set(titles)];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&sites=enwiki&props=info&format=json&titles=${encodeURIComponent(chunk.join('|'))}`);
    for (const e of Object.values(j.entities || {})) if (e.id && e.sitelinks !== undefined || e.title) out.set(e.title, e.id);
    // wbgetentities без sitelinks не повертає назву — запитуємо ще раз із sitelinks/enwiki
    const k = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&sites=enwiki&props=sitelinks&sitefilter=enwiki&format=json&titles=${encodeURIComponent(chunk.join('|'))}`);
    for (const e of Object.values(k.entities || {})) if (e.id && e.sitelinks?.enwiki) out.set(e.sitelinks.enwiki.title, e.id);
    await sleep(300);
  }
  return out;
}

// ── розбір вікітексту
const firstLink = (s) => {
  for (const m of s.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g)) {
    if (/^(Captain|File:|Image:)/i.test(m[1]) || /\(association football\)$/.test(m[1]) && /Captain/.test(m[1])) continue;
    return { target: wikiTitle(m[1]), text: (m[2] || m[1]).replace(/\s*\(.*?\)\s*$/, '').trim() };
  }
  return null;
};
const flagOf = (s) => (s.match(/\{\{(?:flagicon|flagdeco|flag icon|#invoke:flag\|(?:icon|fbaicon))\|([A-Z]{3})/i) || [])[1]?.toUpperCase() || null;
const minuteOf = (s, tpl) => (s.match(new RegExp(`\\{\\{${tpl}\\|([0-9+]+)`, 'i')) || [])[1] || null;
const field = (box, name) => {
  const m = box.match(new RegExp(`\\|\\s*${name}\\s*=([\\s\\S]*?)(?=\\n\\s*\\|\\s*[a-z_0-9]+\\s*=|\\n\\}\\})`, 'i'));
  return m ? m[1].trim() : '';
};

// голи з {{goal|39||44}} / {{goal|90+2|pen}} — [{ target, minutes }]
function parseGoals(text) {
  const out = [];
  for (const line of text.split(/\n|<br\s*\/?>/i)) {
    const l = line.replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '');
    const link = firstLink(l);
    const g = l.match(/\{\{goal\|([^}]*)\}\}/i);
    if (!link || !g) continue;
    const parts = g[1].split('|');
    const mins = [];
    for (let i = 0; i < parts.length; i++) {
      if (!/^[0-9+]+$/.test(parts[i].trim())) continue;
      const kind = (parts[i + 1] || '').trim().toLowerCase();
      if (/o\.?g/.test(kind)) continue; // автогол — не відзначаємо гравця
      mins.push(parts[i].trim() + (/pen/.test(kind) ? ' пен.' : ''));
    }
    if (mins.length) out.push({ target: link.target, minutes: mins });
  }
  return out;
}

function teamFromBox(s) {
  // {{fb|ARG}}, {{fb-rt|ARG}} або {{#invoke:flagg|main|unpre|avar=fb|ARG}}
  const fb = s.match(/\{\{\s*(?:fb|fb-rt|fbw|fb-big)\|([A-Z]{3})/i) || (!/\[\[/.test(s) && s.match(/\|([A-Z]{3})\s*\}\}/));
  if (fb) return { nation: fb[1].toUpperCase() };
  const link = firstLink(s);
  return link ? { title: link.target, text: link.text } : null;
}

function parseLineupRows(text) {
  // рядки таблиці складу й маркери розділів
  const teams = [];
  let cur = null;
  let section = 'xi';
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '').replace(/\{\{refn[\s\S]*$/i, '')
      .replace(/\{\{abbr\|([A-Z]{2,3})\|[^}]*\}\}/gi, '$1'); // {{abbr|RB|Right-back}} → RB
    const row = line.match(/^\s*\|\s*([A-Z]{2,3})\s*\|\|\s*'''(\d+)'''\s*\|\|(.*)$/);
    if (row) {
      if (!cur || (section === 'coach' && row[1] === 'GK') || (section === 'done' && row[1] === 'GK')) {
        if (cur && teams.length >= 2) break;
        cur = { xi: [], bench: [], coach: null };
        teams.push(cur);
        section = 'xi';
      }
      const rest = row[3];
      const link = firstLink(rest);
      if (!link) continue;
      const p = {
        pos: row[1], num: Number(row[2]), target: link.target, name: link.text, flag: flagOf(rest),
        capt: /Captain[^\]]*\|\s*c\s*\]\]/i.test(rest) || /\(c\)/.test(rest),
        off: minuteOf(rest, 'suboff'), on: minuteOf(rest, 'subon'),
      };
      if (section === 'xi') cur.xi.push(p);
      else if (section === 'subs') cur.bench.push(p);
      continue;
    }
    if (!cur) continue;
    if (/'''\s*Substitut/i.test(line)) section = 'subs';
    else if (/'''\s*(Manager|Head coach|Coach|Trainer)/i.test(line)) {
      section = 'coach';
      // ім'я тренера — в цьому ж рядку або в наступних (до наступного складу)
      for (let k = i; k < Math.min(lines.length, i + 6); k++) {
        const s = lines[k].replace(/'''\s*(Manager|Head coach|Coach|Trainer)s?:?\s*'''/i, '');
        const link = firstLink(s);
        if (link) { cur.coach = { target: link.target, name: link.text, flag: flagOf(s) }; break; }
      }
      section = 'done';
    }
  }
  return teams.filter((t) => t.xi.length >= 10);
}

function parseArticle(text, spec) {
  const boxes = text.split(/\{\{\s*(?:#invoke:football box\|main|Football box)\s*\n?/i).slice(1);
  if (boxes.length !== 1) return { error: `Football box: ${boxes.length}` }; // переграванння / два матчі — пропускаємо
  const box = boxes[0];
  const t1 = teamFromBox(field(box, 'team1'));
  const t2 = teamFromBox(field(box, 'team2'));
  // рахунок буває і в {{score link|…|3–3|…}}
  const score = field(box, 'score').replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '').match(/(?:^|[|\]\s])(\d{1,2})\s*[–-]\s*(\d{1,2})(?!\d)/);
  if (!t1 || !t2 || !score) return { error: 'немає команд або рахунку' };
  const rawDate = field(box, 'date');
  let date = rawDate.match(/(\d{4})\|(\d{1,2})\|(\d{1,2})/);
  if (!date) { // «6 May 1970»
    const d = new Date(`${rawDate.replace(/\{\{[^}]*\}\}|<[^>]+>/g, '').trim()} 12:00 UTC`);
    if (!Number.isNaN(d.getTime())) date = [null, String(d.getUTCFullYear()), String(d.getUTCMonth() + 1), String(d.getUTCDate())];
  }
  const pens = field(box, 'penaltyscore').match(/(\d+)\s*[–-]\s*(\d+)/);
  const stadium = field(box, 'stadium').replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, '').trim();
  const teams = parseLineupRows(text);
  if (teams.length !== 2) return { error: `складів: ${teams.length}` };
  const kits = [...text.matchAll(/\{\{\s*Football kit[\s\S]*?\|\s*body\s*=\s*([0-9A-Fa-f]{6})/g)].map((m) => '#' + m[1]);
  const g1 = parseGoals(field(box, 'goals1'));
  const g2 = parseGoals(field(box, 'goals2'));
  return {
    match: {
      src: 'wiki', article: spec.title, comp: spec.comp, round: spec.round,
      date: date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : null,
      venue: stadium || null, score: [Number(score[1]), Number(score[2])],
      aet: /yes|y/i.test(field(box, 'aet')), pens: pens ? [Number(pens[1]), Number(pens[2])] : null,
      teams: [t1, t2].map((t, k) => ({ ...t, kit: kits[k] || null, ...teams[k], goals: k ? g2 : g1 })),
    },
  };
}

// ── API УЄФА
const uefaCache = new Map();
async function uefaList(comp, season) {
  const key = `${comp}:${season}`;
  if (uefaCache.has(key)) return uefaCache.get(key);
  let all = [];
  for (const y of [season - 1, season]) {
    for (let off = 0; off < 2000; off += 100) {
      const r = await getJson(`${UEFA}/matches?competitionId=${comp}&seasonYear=${y}&limit=100&offset=${off}&order=ASC`);
      if (!Array.isArray(r) || !r.length) break;
      all = all.concat(r);
      if (r.length < 100) break;
    }
  }
  uefaCache.set(key, all);
  return all;
}

const POS_BY_FIELD = { GOALKEEPER: 'GK', DEFENDER: 'DF', MIDFIELDER: 'MF', FORWARD: 'FW' };
const COMP_BY_UEFA = { 1: 'ucl', 14: 'uel', 3: 'euro' };

async function uefaMatch(id, tags) {
  const m = await getJson(`${UEFA}/matches/${id}`);
  const l = await getJson(`${UEFA}/matches/${id}/lineups`);
  let ev = [];
  try { ev = await getJson(`${UEFA}/matches/${id}/events?filter=LINEUP&offset=0&limit=200`); } catch { /* без подій */ }
  if (!l.homeTeam?.field?.length || !l.awayTeam?.field?.length) return null;
  const side = (t, k) => {
    const team = k ? m.awayTeam : m.homeTeam;
    const person = (pl) => ({
      num: pl.jerseyNumber, name: pl.player.internationalName, uefa: pl.player.id, born: pl.player.birthDate || null,
      country: pl.player.countryCode || null, pos: POS_BY_FIELD[pl.player.fieldPosition] || null,
      x: pl.fieldCoordinate?.x >= 0 ? pl.fieldCoordinate.x : null, y: pl.fieldCoordinate?.y >= 0 ? pl.fieldCoordinate.y : null,
      capt: !!pl.isCaptain,
    });
    const coach = t.coaches?.[0]?.person;
    return {
      uefaTeam: team.internationalName, logo: team.bigLogoUrl || team.logoUrl || null, national: !!team.typeIsNational,
      kit: null,
      xi: t.field.map(person), bench: (t.bench || []).map(person),
      coach: coach ? { name: coach.translations?.name?.EN || coach.internationalName, born: coach.birthDate || null, country: coach.countryCode || null } : null,
      teamId: team.id,
    };
  };
  const teams = [side(l.homeTeam, 0), side(l.awayTeam, 1)];
  // голи й заміни з подій
  for (const e of Array.isArray(ev) ? ev : []) {
    const min = e.time ? String(e.time.minute) + (e.time.injuryMinute ? '+' + e.time.injuryMinute : '') : null;
    const t = teams.find((x) => x.teamId === e.teamId) || teams.find((x) => [...x.xi, ...x.bench].some((p) => p.uefa === e.primaryActor?.person?.id));
    if (!t) continue;
    const who = (pid) => [...t.xi, ...t.bench].find((p) => p.uefa === pid);
    if (e.type === 'GOAL' || e.type === 'PENALTY_GOAL' || (e.type === 'PENALTY' && e.phase !== 'PENALTY')) {
      const p = who(e.primaryActor?.person?.id);
      if (p && e.type !== 'PENALTY' || p && /SCORED/.test(e.penaltyType || '')) (p.goals ||= []).push(min + (e.type !== 'GOAL' ? ' пен.' : ''));
    }
    if (e.type === 'SUBSTITUTION') {
      // primaryActor — хто пішов з поля, secondaryActor — хто вийшов на заміну
      const outP = who(e.primaryActor?.person?.id);
      const inP = who(e.secondaryActor?.person?.id);
      if (inP) { inP.on = min; inP.for = outP?.num ?? null; }
      if (outP) outP.off = min;
    }
  }
  const s = m.score || {};
  return {
    src: 'uefa', uefa: id, comp: COMP_BY_UEFA[m.competition?.id] || 'ucl', round: m.round?.metaData?.name || '', tags,
    date: m.kickOffTime?.date || null, venue: m.stadium?.translations?.name?.EN || null,
    score: [s.total?.home ?? s.regular?.home, s.total?.away ?? s.regular?.away],
    aet: m.winner?.match?.reason === 'WIN_ON_EXTRA_TIME' || !!s.extraTime, pens: s.penalty ? [s.penalty.home, s.penalty.away] : null,
    leg: m.leg?.number || null, aggregate: s.aggregate ? [s.aggregate.home, s.aggregate.away] : null,
    teams: teams.map(({ teamId, ...t }) => ({ ...t, bench: t.bench.filter((p) => p.on) })),
  };
}

// ── зіставлення з нашою базою
const byWiki = new Map(players.filter((p) => p.wiki).map((p) => [wikiTitle(p.wiki), p]));
// УЄФА пише імена по-своєму (Mikhalik / Mykhalyk, Nesmachniy / Nesmachnyi): ім'я й аліаси + рік народження,
// потім частина імені, потім схоже прізвище (відстань редагування ≤ 2) серед ровесників — якщо кандидат один.
const byNameBorn = new Map();
const bySurnameBorn = new Map();
const byBorn = new Map();
const latin = (s) => /^[\x00-\x7FÀ-ɏ\s.'-]+$/.test(s);
for (const p of players) {
  if (!p.born) continue;
  const names = [p.name, ...(p.aliases || []).filter(latin)];
  for (const nm of names) byNameBorn.set(`${normalize(nm)}|${p.born}`, p);
  for (const part of normalize(p.name).split(' ')) {
    if (part.length < 3) continue;
    const key = `${part}|${p.born}`;
    bySurnameBorn.set(key, bySurnameBorn.has(key) ? null : p); // null — неоднозначно
  }
  if (!byBorn.has(p.born)) byBorn.set(p.born, []);
  byBorn.get(p.born).push(p);
}
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
function uefaPlayer(name, born) {
  const year = born ? Number(born.slice(0, 4)) : null;
  if (!year) return null;
  const n = normalize(name);
  if (byNameBorn.has(`${n}|${year}`)) return byNameBorn.get(`${n}|${year}`);
  const parts = n.split(' ').filter((x) => x.length >= 3);
  for (const part of [...parts].reverse()) {
    const p = bySurnameBorn.get(`${part}|${year}`);
    if (p) return p;
  }
  const last = parts[parts.length - 1];
  if (!last || last.length < 5) return null;
  const near = (byBorn.get(year) || []).filter((p) => normalize(p.name).split(' ').some((x) => x.length >= 5 && editDistance(x, last) <= 2));
  return near.length === 1 ? near[0] : null;
}

async function main() {
  const out = [];
  // Вікіпедія
  console.log(`Статті Вікіпедії: ${ARTICLES.length}`);
  const texts = await fetchTexts(ARTICLES.map((a) => a.title));
  const parsed = [];
  for (const spec of ARTICLES) {
    const text = texts.get(spec.title);
    if (!text) { console.log(`  — немає статті: ${spec.title}`); continue; }
    const r = parseArticle(text, spec);
    if (r.error) { console.log(`  — ${spec.title}: ${r.error}`); continue; }
    if (spec.legend) r.match.tags = ['legend'];
    parsed.push(r.match);
  }
  // посилання на гравців/тренерів/клуби → справжні статті → наша база і qid
  const links = [];
  for (const m of parsed) for (const t of m.teams) {
    if (t.title) links.push(t.title);
    if (t.coach) links.push(t.coach.target);
    for (const p of [...t.xi, ...t.bench]) links.push(p.target);
    for (const g of t.goals) links.push(g.target);
  }
  const real = await resolveTitles(links);
  const teamTitles = parsed.flatMap((m) => m.teams.map((t) => (t.nation ? `${NATION_CODES[t.nation] || t.nation} national football team` : real.get(t.title) || t.title)));
  const qids = await qidsOf(teamTitles);
  for (const m of parsed) {
    for (const t of m.teams) {
      const title = t.nation ? `${NATION_CODES[t.nation] || t.nation} national football team` : real.get(t.title) || t.title;
      t.qid = qids.get(title) || null;
      t.name = t.nation ? NATION_CODES[t.nation] || t.nation : t.text || title;
      t.national = !!t.nation || / national (football|soccer) team$/.test(title);
      const goals = new Map();
      for (const g of t.goals) goals.set(real.get(g.target) || g.target, g.minutes);
      const fix = (p) => {
        const target = real.get(p.target) || p.target;
        const pl = byWiki.get(target);
        const o = { num: p.num, pos: p.pos, name: pl ? pl.name : p.name, pid: pl?.id || null, flag: p.flag, capt: p.capt || undefined };
        if (p.off) o.off = p.off;
        if (p.on) o.on = p.on;
        if (goals.has(target)) o.goals = goals.get(target);
        return o;
      };
      t.xi = t.xi.map(fix);
      t.bench = t.bench.map(fix).filter((p) => p.on);
      // хто кого замінив: хвилина виходу = хвилина заміни (по черзі, якщо кілька одночасно)
      const offs = t.xi.filter((p) => p.off);
      for (const s of t.bench) {
        const k = offs.findIndex((p) => p.off === s.on);
        if (k >= 0) { s.for = offs[k].num; offs.splice(k, 1); }
      }
      if (t.coach) {
        const target = real.get(t.coach.target) || t.coach.target;
        const pl = byWiki.get(target);
        t.coach = { name: pl ? pl.name : t.coach.name, wiki: target, pid: pl?.id || null, flag: t.coach.flag };
      }
      delete t.title; delete t.text; delete t.nation; delete t.goals;
    }
    out.push({ id: `${m.comp}-${m.round}-${m.date || m.article}`.replace(/\s+/g, '-'), ...m });
  }
  console.log(`  з Вікіпедії: ${out.length} матчів`);

  // УЄФА
  const ids = [...UEFA_MATCHES];
  for (const f of UEFA_FIND) {
    const list = await uefaList(f.comp, f.season);
    const has = (team, name) => normalize(team?.internationalName || '').includes(normalize(name));
    const found = list.filter((x) => has(x.homeTeam, f.home) && has(x.awayTeam, f.away));
    if (!found.length) { console.log(`  — УЄФА: не знайдено ${f.home} — ${f.away} (${f.season})`); continue; }
    // кілька (дві зустрічі групи) — беремо останню
    ids.push({ id: Number(found[found.length - 1].id), tags: f.tags });
    await sleep(200);
  }
  let uefaCount = 0;
  for (const { id, tags } of ids) {
    try {
      const m = await uefaMatch(id, tags);
      if (!m) { console.log(`  — УЄФА ${id}: немає складу`); continue; }
      for (const t of m.teams) {
        const fix = (p) => {
          const pl = uefaPlayer(p.name, p.born);
          const o = { num: p.num, pos: p.pos, name: pl ? pl.name : p.name, pid: pl?.id || null, flag: p.country, born: p.born ? Number(p.born.slice(0, 4)) : undefined };
          for (const k of ['x', 'y', 'capt', 'off', 'on', 'for', 'goals']) if (p[k] != null && p[k] !== false) o[k] = p[k];
          return o;
        };
        t.xi = t.xi.map(fix);
        t.bench = t.bench.map(fix);
        if (t.coach) {
          const pl = uefaPlayer(t.coach.name, t.coach.born);
          t.coach = { name: pl ? pl.name : t.coach.name, pid: pl?.id || null, flag: t.coach.country, born: t.coach.born ? Number(t.coach.born.slice(0, 4)) : undefined };
        }
      }
      out.push({ id: `uefa-${id}`, ...m });
      uefaCount++;
      await sleep(250);
    } catch (e) {
      console.log(`  — УЄФА ${id}: ${e.message}`);
    }
  }
  console.log(`  з УЄФА: ${uefaCount} матчів`);

  // тренери, яких немає в базі гравців (Ліппі, Маркевич), — українське ім'я з Вікідати:
  // за статтею Вікіпедії (фінали) або пошуком за іменем серед футбольних тренерів (матчі УЄФА)
  const noPid = out.flatMap((m) => m.teams.map((t) => t.coach)).filter((c) => c && !c.pid);
  const byTitle = await qidsOf(noPid.filter((c) => c.wiki).map((c) => c.wiki));
  const qidOfCoach = new Map();
  for (const c of noPid) {
    if (c.wiki && byTitle.get(c.wiki)) { qidOfCoach.set(c, byTitle.get(c.wiki)); continue; }
    const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&language=en&type=item&limit=5&format=json&search=${encodeURIComponent(c.name)}`);
    const hit = (j.search || []).find((e) => /football|soccer/i.test(e.description || ''));
    if (hit) qidOfCoach.set(c, hit.id);
    await sleep(150);
  }
  const coachIds = [...new Set(qidOfCoach.values())];
  const labels = new Map();
  for (let i = 0; i < coachIds.length; i += 50) {
    const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels&languages=uk&format=json&ids=${coachIds.slice(i, i + 50).join('|')}`);
    for (const [id, e] of Object.entries(j.entities || {})) if (e.labels?.uk) labels.set(id, e.labels.uk.value);
    await sleep(200);
  }
  for (const [c, q] of qidOfCoach) if (labels.has(q)) c.uk = labels.get(q);
  console.log(`Тренери поза базою: ${noPid.length}, українських імен: ${noPid.filter((c) => c.uk).length}`);

  // скільки гравців основи знайдено в базі
  for (const m of out) {
    const xi = m.teams.flatMap((t) => t.xi);
    m.known = Math.round((100 * xi.filter((p) => p.pid).length) / xi.length);
  }
  const weak = out.filter((m) => m.known < 60);
  console.log(`Матчів: ${out.length}; із них менше 60 % основи в базі: ${weak.length} (${weak.map((m) => m.id).slice(0, 15).join(', ')}…)`);
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`→ ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
