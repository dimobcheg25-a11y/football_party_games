// Кандидати в прізвиська гравців → .cache/nickname-candidates.json: { [id гравця]: ['El Niño', 'CR7', …] } — як написано в джерелі.
// Джерела: Wikidata (P1449 «прізвисько», усі мови) і текст статті en.wikipedia — «nicknamed / dubbed / known as» + прізвисько
// жирним курсивом або в лапках. Ім'я, прізвище чи скорочення імені (Leo, Cristiano) прізвиськом не вважаємо.
// У джерелах багато сміття (назви тріо «MSN», події «La Remontada», фільми), тож у гру йде лише перевірене вручну —
// server/data/manual-nicknames.js (з українським перекладом); цей файл — щоб було з чого вибирати.
// Продовжує з перерваного (прогрес — у nicknames.progress.json поруч); --fresh — заново.
// Запуск: npm run build-nicknames (≈10 хв: статті Вікіпедії — по одній, щоб не ловити 429).

const fs = require('fs');
const path = require('path');
const { getJson, sparql, sleep, qidOf, values } = require('./lib/wikidata');
const { players, normalize } = require('../server/data');
const { poolFor } = require('../server/games/path/careers');

const DIR = path.join(__dirname, '..', '.cache');
const OUT = path.join(DIR, 'nickname-candidates.json');
const PROGRESS = path.join(DIR, 'nickname-candidates.progress.json');
// статті читаємо лише для впізнаваних (топ-1900): у решти прізвиськ, які хтось знає, практично немає
const ARTICLE_POOL = new Set(poolFor('all', 'expert').map((p) => p.id));

// Прізвисько не повинно бути просто ім'ям: усі слова — частини імені гравця (англ., укр., інші написання)
function isJustName(nick, p) {
  const words = new Set([p.name, p.uk, ...(p.aliases || [])].flatMap((s) => normalize(String(s || '')).split(' ')).filter(Boolean));
  const n = normalize(nick).split(' ').filter(Boolean);
  return !n.length || n.every((w) => words.has(w));
}

const clean = (s) => s.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1').replace(/<[^>]+>/g, '').replace(/'{2,}/g, '').replace(/\s+/g, ' ').trim();

// Прізвиська з тексту статті: після «nicknamed», «dubbed», «known as», «nickname», «moniker» (до 60 знаків) — жирний курсив
// '''''X''''' або курсив ''X'' чи лапки "X". Шаблони {{lang|…|X}} розгортаємо.
const LEAD = /(nicknamed|nicknames?|dubbed|known as|moniker|referred to as|called him|earned (?:him )?the name)/i;
function fromArticle(text) {
  const out = [];
  const t = text.replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '').replace(/\{\{(?:lang|lang-[a-z]+|transl)\|(?:[a-z-]+\|)?([^}|]+)[^}]*\}\}/gi, "''$1''");
  const re = new RegExp(LEAD.source + `[^.\\n]{0,60}?(?:'{2,5}([^'\\n]{2,40}?)'{2,5}|"([^"\\n]{2,40}?)")`, 'gi');
  for (const m of t.matchAll(re)) {
    const nick = clean(m[2] || m[3] || '');
    if (!nick || /^(the )?(club|team|side|squad|player|stadium)$/i.test(nick) || /\d{4}/.test(nick)) continue;
    // назва клубу чи збірної — ні: прізвисько людини починається з великої літери або «El/La/O/Il/Der…»
    if (!/^[A-ZÀ-ÝĀ-ſ"]/.test(nick) && !/^(el|la|il|o|le|der|die|de)\s/i.test(nick)) continue;
    out.push(nick);
  }
  return out;
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const fresh = process.argv.includes('--fresh');
  let out = {};
  let progress = { wd: false, done: [] };
  if (!fresh) {
    try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* немає файлу */ }
    try { progress = JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch { /* немає */ }
  }
  const done = new Set(progress.done);
  const save = () => {
    fs.writeFileSync(OUT, JSON.stringify(out));
    fs.writeFileSync(PROGRESS, JSON.stringify({ wd: progress.wd, done: [...done] }));
  };
  const add = (p, nick) => {
    if (isJustName(nick, p)) return;
    const list = (out[p.id] ||= []);
    if (!list.some((x) => normalize(x) === normalize(nick))) list.push(nick);
  };
  const byQid = new Map(players.filter((p) => p.qid).map((p) => [p.qid, p]));

  // 1. Wikidata P1449
  if (!progress.wd) {
    const qids = [...byQid.keys()];
    for (let i = 0; i < qids.length; i += 300) {
      const rows = await sparql(`SELECT ?p ?n WHERE { VALUES ?p { ${values(qids.slice(i, i + 300))} } ?p wdt:P1449 ?n }`);
      for (const r of rows) add(byQid.get(qidOf(r.p)), r.n.trim());
      console.log(`  Wikidata ${Math.min(i + 300, qids.length)}/${qids.length}`);
      await sleep(1000);
    }
    progress.wd = true;
    save();
  }

  // 2. Статті en.wikipedia
  const todo = players.filter((p) => p.wiki && ARTICLE_POOL.has(p.id) && !done.has(p.id));
  console.log(`Статті: лишилось ${todo.length}`);
  for (let i = 0; i < todo.length; i++) {
    const p = todo[i];
    const t0 = Date.now();
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=revisions&rvprop=content&rvslots=main&redirects=1&titles=${encodeURIComponent(p.wiki)}`;
    const j = await getJson(url);
    const page = Object.values(j.query?.pages || {})[0];
    const text = page?.revisions?.[0]?.slots?.main?.['*'] || '';
    for (const nick of fromArticle(text)) add(p, nick);
    done.add(p.id);
    if (i % 100 === 0) { save(); console.log(`  ${i + 1}/${todo.length}`); }
    const wait = 200 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  save();
  fs.unlinkSync(PROGRESS);
  console.log(`Готово: кандидати є в ${Object.keys(out).length} гравців → ${path.relative(process.cwd(), OUT)}`);
})().catch((e) => { console.error(e); process.exit(1); });
