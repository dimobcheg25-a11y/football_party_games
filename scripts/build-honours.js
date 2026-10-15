// Збирає трофеї футболістів — скільки разів що виграв — у server/data/honours.json.
//
// Джерело — розділ «Honours» статті en.wikipedia: заголовки команд ('''Barcelona''', '''Cameroon''', ===Individual===)
// і рядки «*[[La Liga]]: 2004–05, 2005–06; runner-up: 2006–07». Рахуємо сезони до «runner-up»/«third place».
// Молодіжні команди пропускаємо (крім олімпійського золота), особисті нагороди — окремо (лише «Золотий м'яч»).
//
// honours.json: { [id гравця]: { league, ucl, uel, cwc, wc, euro, copa, afcon, nl, lib, ballon, cups, total, leagues: { назва: n } } }
//   league — чемпіонства (вищий дивізіон будь-якої країни), cups — внутрішні кубки й суперкубки, total — усі командні трофеї.
//
// Запуск: npm run build-honours   (≈3 хв);  node scripts/build-honours.js Marquinhos "Samuel Eto'o" — перевірка кількох статей

const fs = require('fs');
const path = require('path');
const { getJson, sleep } = require('./lib/wikidata');
const players = require('../server/data/players.json');

const OUT = path.join(__dirname, '..', 'server', 'data', 'honours.json');

const api = (params) =>
  getJson('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', redirects: '1', ...params }));

// Розділ трофеїв: від «==Honours==» до наступного заголовка 2-го рівня.
function honoursSection(text) {
  const m = text.match(/^==\s*(Honou?rs|Honou?rs and (awards|achievements)|Achievements|Titles|Trophies)\s*==\s*$/im);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const end = rest.search(/^==[^=]/m);
  return end === -1 ? rest : rest.slice(0, end);
}

// Вікірозмітка → простий текст: без приміток, шаблонів, файлів; посилання — їхній видимий текст.
function plain(s) {
  return s
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{(?:nowrap|small|sort|ill)\|([^{}|]*)[^{}]*\}\}/gi, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}
// Назва змагання — ціль першого посилання (вона однозначніша за видимий текст), інакше текст до двокрапки.
function compName(raw) {
  const head = raw.split(':')[0];
  const link = head.match(/\[\[([^\]|]+)/);
  return plain(link ? link[1] : head).replace(/\s*\(\d+\)\s*$/, '').trim();
}

const YOUTH = /state team|selection|select xi|\bU-?\d{2}\b|under-?\d{2}|\byouth\b|olympic|reserves?\b|\sB$|\sII$|castilla|primavera|academy|juniors?\b/i;
const PERSONAL = /individual|orders?\b|records?\b|decorations?|awards?|personal|special/i;

// Що це за трофей (за назвою змагання). null — не командний трофей або не перемога.
function kind(name) {
  const n = name.toLowerCase();
  if (/runner|finalist|third|fourth|bronze|silver|second place|play-?off/.test(n)) return null;
  if (/youth|u-?\d{2}\b|under-?\d{2}|reserve|primavera|next gen|junior/.test(n)) return null;
  // особисті нагороди й службові посилання, що трапляються в командних списках
  if (/team of the|awards?\b|dream team|top ?scorer|golden|player of|of the year|of the season|of the tournament|best |all-star|hall of fame|\bxi\b|pichichi|capocannoniere|coefficient|ranking| final\b|regular season|conference\b|(eastern|western|northern|southern|central|atlantic|pacific) division/.test(n)) return null;
  if (/olympic/.test(n)) return /gold|football at the|olympic games|summer olympics|olympic medal/.test(n) ? 'olympic' : null;
  if (/winners'? cup|intertoto|super ?cup|supercup/.test(n)) return /uefa super|european super/.test(n) ? 'usc' : 'cup';
  if (/champions league|european cup\b/.test(n) && !/afc|caf|concacaf|ofc|asian|african|arab|women/.test(n)) return 'ucl';
  if (/europa league|uefa cup\b/.test(n)) return 'uel';
  if (/conference league/.test(n)) return 'uecl';
  if (/club world cup|intercontinental cup/.test(n)) return 'cwc';
  if (/nations league/.test(n)) return /uefa/.test(n) ? 'nl' : 'intl';
  if (/fifa world cup|^world cup/.test(n)) return /club|confederations/.test(n) ? 'intl' : 'wc';
  if (/european championship|^euro \d{4}|uefa euro/.test(n)) return 'euro';
  if (/copa américa|copa america/.test(n)) return 'copa';
  if (/africa(n)? cup of nations|african nations cup/.test(n)) return 'afcon';
  if (/libertadores/.test(n)) return 'lib';
  if (/confederations cup|gold cup|asian cup|finalissima|artemio franchi|cup of nations|nations cup|olympic/.test(n)) return 'intl';
  if (/sudamericana|recopa|concacaf|afc |caf |arab|asian champions|cup winners/.test(n)) return 'cont';
  // внутрішні: кубки, суперкубки, ліга-кубки
  if (/mls cup|soccer bowl/.test(n)) return 'league'; // чемпіонство в MLS і старій NASL — фінал плей-оф
  if (/cup|copa|coppa|coupe|pokal|taça|trophée|troph|shield|supercopa|supercoppa|beker|kupa|kupası|puchar|pohár|kubok/.test(n)) return 'cup';
  // нижчі дивізіони й регіональні ліги — не чемпіонства
  if (/second|segunda|serie b|série b|ligue 2|2\. |3\. |division two|division 2|championship$|efl championship|football league championship|liga 2|primera b|regionalliga|oberliga|tweede|eerste divisie|1\. lig|lig 1|seleç|paulista|carioca|mineiro|gaúcho|gaucho|baiano|estadual|state championship|segunda|third|fourth|national league|lower|amateur|ukrainian first league|russian first|b(i|ii|iii|iv|v) liga|liga (ii|iii)b|okręgowa|league one|league two|lega pro|j2|1st division|série c|serie c|first division league|serbian first league|league 2|liga leumit|paranaense|catarinense|södra|norra|serbian league|women|beach|most |fastest|longest|central division|baltic|china league one|list of|russian football national|persha liha|druha liha/.test(n)) return 'other';
  if (/league|liga|lig\b|serie a|série a|bundesliga|eredivisie|division|primera|premiership|superliga|super league|ekstraklasa|allsvenskan|eliteserien|veikkausliiga|top league|vyshcha|championnat|campeonato brasileiro|brasileirão|pro league|first league|1\. hnl|prva|nb i|fortuna|chance liga|úrvalsdeild|meistriliiga|virslīga|a lyga|ligue 1|scudetto|torneo|apertura|clausura|mls cup|major league soccer|j1|k league|csl|super lig|süper lig|stars league|uae pro|saudi|botola|ligi/.test(n)) return 'league';
  return 'other';
}

// Скільки сезонів у частині рядка (до «runner-up»): «2004–05», «1999–2000», «2010».
function countSeasons(s) {
  const winners = s.split(/;|\brunners?[- ]up\b|\bfinalist|\bthird place|\bsecond place/i)[0];
  return (winners.match(/\b(18|19|20)\d{2}(\s*[–\-\/]\s*\d{2,4})?\b/g) || []).length;
}

function parseHonours(section) {
  const out = { league: 0, ucl: 0, uel: 0, uecl: 0, usc: 0, cwc: 0, wc: 0, euro: 0, copa: 0, afcon: 0, nl: 0, lib: 0, olympic: 0, intl: 0, cont: 0, cups: 0, ballon: 0, total: 0, leagues: {} };
  let team = '', personal = false, youth = false, manager = false;
  for (const line of section.split('\n')) {
    // заголовки бувають з примітками й коментарями: '''Individual'''<!--…-->, '''AC Milan'''<ref …>
    const t = line.replace(/<!--.*?(-->|$)/g, '').replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>.*?(<\/ref>|$)/gi, '').trim();
    if (!t) continue;
    const head = t.match(/^={3,}\s*(.+?)\s*={3,}$/) || t.match(/^'''([^*'].*?)'''$/) || t.match(/^;\s*(.+)$/);
    if (head) {
      const h = plain(head[1]);
      // трофеї тренера (Райкард з «Барселоною») — не рахуємо, доки не почнеться знову розділ гравця
      if (/^(as )?(a )?(manager|managerial|coach|head coach|assistant|director)/i.test(h)) { manager = true; continue; }
      if (/^(as )?(a )?player|^playing/i.test(h)) { manager = false; personal = false; continue; }
      if (PERSONAL.test(h)) { personal = true; youth = false; team = h; continue; }
      if (/^(club|international|national team|team|senior)$/i.test(h)) { personal = false; youth = false; continue; }
      // особисте й рекорди йдуть у кінці; підзаголовки в них ('''Overall''', ;Sweden) — теж не командні трофеї
      if (personal) continue;
      team = h; youth = YOUTH.test(h) && !/olympic/i.test(h);
      continue;
    }
    if (!/^\*/.test(t) || /^\*\*/.test(t)) continue;
    const body = t.replace(/^\*+\s*/, '');
    if (!body.includes(':')) continue;
    const name = compName(body);
    const label = name + ' | ' + plain(body.split(':')[0]); // «[[UEFA Euro]] runner-up» — ознака не в посиланні
    const n = countSeasons(plain(body.slice(body.indexOf(':') + 1)));
    if (!n) continue;
    if (manager) continue;
    if (personal) { if (/^ballon d'or$/i.test(name.split('#')[0]) && !/runner|third|second|silver|bronze|place|century|prix|winners|nomin|shortlist|dream/i.test(plain(body))) out.ballon += n; continue; }
    const k = kind(label);
    if (youth && k !== 'olympic') continue;
    if (!k || k === 'other') continue;
    if (k === 'olympic') out.olympic += n;
    else if (k === 'cup') out.cups += n;
    else out[k] += n;
    if (process.env.DEBUG) console.log(`   [${team}] ${k} +${n}  ${name}`);
    if (k === 'league') out.leagues[name] = (out.leagues[name] || 0) + n;
    out.total += n;
  }
  return out;
}

async function fetchTexts(titles) {
  const texts = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const j = await api({ titles: chunk.join('|'), prop: 'revisions', rvprop: 'content', rvslots: 'main' });
    const q = j.query || {};
    for (let t of chunk) {
      const want = t;
      for (const n of q.normalized || []) if (n.from === t) t = n.to;
      for (const r of q.redirects || []) if (r.from === t) t = r.to;
      const text = (q.pages || []).find((p) => p.title === t)?.revisions?.[0]?.slots?.main?.content;
      if (text) texts.set(want, text);
    }
    if (i % 500 === 0) console.log(`  статті: ${Math.min(i + 50, titles.length)}/${titles.length}`);
    await sleep(300);
  }
  return texts;
}

async function main() {
  const list = Array.isArray(players) ? players : Object.values(players);
  const only = process.argv.slice(2);
  const chosen = only.length ? list.filter((p) => only.includes(p.wiki) || only.includes(p.id)) : list.filter((p) => p.wiki);
  console.log(`Гравців зі статтями: ${chosen.length}`);
  const texts = await fetchTexts(chosen.map((p) => p.wiki));
  const result = {};
  let found = 0;
  for (const p of chosen) {
    const sec = texts.get(p.wiki) && honoursSection(texts.get(p.wiki));
    if (!sec) continue;
    const h = parseHonours(sec);
    found++;
    // нулі не зберігаємо — менший файл; гравець без запису — розділу трофеїв немає (невідомо), {} — трофеїв немає
    result[p.id] = Object.fromEntries(Object.entries(h).filter(([, v]) => (typeof v === 'object' ? Object.keys(v).length : v)));
  }
  if (only.length) { for (const [id, h] of Object.entries(result)) console.log(id, JSON.stringify(h)); return; }
  fs.writeFileSync(OUT, JSON.stringify(result));
  console.log(`Розділ трофеїв знайдено: ${found}; з трофеями: ${Object.values(result).filter((h) => h.total).length} → ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { parseHonours, honoursSection, kind };
