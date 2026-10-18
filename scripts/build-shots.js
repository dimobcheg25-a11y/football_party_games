// Збирає server/data/shots.json — матчеві фото для «Фотоархіву» з Wikimedia Commons.
// Хто на фото — зі структурованих даних Commons («зображено», P180 = qid гравця), а не розпізнаванням облич.
// Беремо верхні 1300 гравців за recognition, для кожного — файли `haswbstatement:P180=<qid>`; лишаємо горизонтальні великі
// кадри з матчів (без портретів, статуй, марок, тренувань, розминок, молодіжних збірних).
// Ручні правки — server/data/manual-shots.js (викинуті фото, доданi гравці, легендарні кадри; їх поповнює apply-shot-reports).
// Відповіді Commons кешуються в .cache/shots-depicts.json — повторний запуск докачує лише нове (`--refresh` — усе заново).
// Запуск: npm run build-shots (≈20 хв уперше, з кешем — секунди).
const fs = require('fs');
const path = require('path');
const { players } = require('../server/data');
const { recognition } = require('../server/games/path/careers');
const { getJson, sleep } = require('./lib/wikidata');
const manual = require('../server/data/manual-shots');

const TOP = 1300;
const PER_PLAYER = 4; // сучасних кадрів, де гравець — найвідоміший на фото
const MAX_FILES = 200; // файлів на гравця з Commons
const CACHE = path.join(__dirname, '..', '.cache', 'shots-depicts.json');
const OUT = path.join(__dirname, '..', 'server', 'data', 'shots.json');
const API = 'https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&';

const BAD = /portrait|portret|headshot|\(cropped\)|cropped|signing|autograph|handtekening|statue|standbeeld|beeld|mural|graffiti|wax|press ?conference|persconferentie|pressekonferenz|пресс|grave|stamp|colnect|banknote|sticker|figurita|panini|painting|drawing|coin|award|gala|bambi|wedding|huwelijk|museum|selfie|politic|president|minister|presidente|prefeito|мэр/i;
const ACTION = /\b(vs\.?|v|versus|tegen|gegen|contre|contra|against|match|матч|wedstrijd|spiel|final|finale|duel|goal|doelpunt|world cup|wereldkampioenschap|weltmeisterschaft|copa|mundial|europacup|champions league|euro ?\d{4}|in action|celebrat|scor|penalty|strafschop|header|kopbal|tackle|game|partido|jogo|partita|elftal|league|liga|cup|kampioen|campe)/i;
const NO = /training|entrenamiento|treino|warm|aufwärm|opwarm|riscaldamento|calentamiento|stretch|bench|banquillo|tunnel|arriv|bus|airport|aeroporto|fans|supporters|stand|tribune|tribuna|sub ?2\d|u-?2\d|u-?1\d|youth|jeugd/i;

const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const yearOf = (f) => Number(((f.date + ' ' + f.t + ' ' + f.d).match(/\b(19[3-9]\d|20[0-2]\d)\b/) || [])[0] || 0);
// коротка стабільна мітка фото (для посилань і звітів)
const shotId = (title) => {
  let h = 2166136261;
  for (const c of title) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h.toString(36);
};

function loadCache() {
  if (process.argv.includes('--refresh')) return { done: {}, files: {} };
  try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return { done: {}, files: {} }; }
}
function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
}

async function fetchPlayer(p, cache) {
  let off = 0;
  let got = 0;
  while (got < MAX_FILES) {
    const j = await getJson(API + 'action=query&generator=search&gsrnamespace=6&gsrlimit=50&gsroffset=' + off
      + '&gsrsearch=' + encodeURIComponent(`haswbstatement:P180=${p.qid} filetype:bitmap`)
      + '&prop=imageinfo&iiprop=size|url|extmetadata&iiurlwidth=960&iiextmetadatafilter=ImageDescription|LicenseShortName|DateTimeOriginal|Artist');
    const pages = (j.query && j.query.pages) || [];
    for (const pg of pages) {
      const ii = pg.imageinfo && pg.imageinfo[0];
      if (!ii) continue;
      const m = ii.extmetadata || {};
      const f = cache.files[pg.title] || (cache.files[pg.title] = {
        t: pg.title.slice(5), w: ii.width, h: ii.height, thumb: ii.thumburl, url: ii.descriptionurl,
        d: strip(m.ImageDescription && m.ImageDescription.value).slice(0, 250), lic: m.LicenseShortName && m.LicenseShortName.value,
        date: strip(m.DateTimeOriginal && m.DateTimeOriginal.value).slice(0, 25), a: strip(m.Artist && m.Artist.value).slice(0, 60), who: [],
      });
      if (!f.who.includes(p.id)) f.who.push(p.id);
    }
    got += pages.length;
    if (!j.continue) break;
    off = j.continue.gsroffset;
  }
  cache.done[p.id] = true;
}

(async () => {
  const byId = new Map(players.map((p) => [p.id, p]));
  const ranked = players.slice().sort((a, b) => recognition(b) - recognition(a));
  const rank = new Map(ranked.map((p, i) => [p.id, i]));
  const cache = loadCache();
  const todo = ranked.slice(0, TOP).filter((p) => !cache.done[p.id]);
  console.log(`Гравців: ${TOP}, докачати з Commons: ${todo.length}`);
  for (let i = 0; i < todo.length; i++) {
    try { await fetchPlayer(todo[i], cache); } catch (e) { console.log('  помилка', todo[i].name, e.message); }
    if ((i + 1) % 50 === 0) { saveCache(cache); console.log(`  ${i + 1}/${todo.length} ${todo[i].name}`); }
    await sleep(80);
  }
  saveCache(cache);

  // дописані вручну гравці (зі звітів) — ще до фільтрів, щоб рахувалися в «хто на фото»
  for (const [t, ids] of Object.entries(manual.extra)) {
    const f = cache.files['File:' + t];
    if (f) for (const id of ids) if (!f.who.includes(id)) f.who.push(id);
  }

  const all = Object.values(cache.files).map((f) => ({ ...f, who: f.who.filter((id) => byId.has(id) && rank.has(id)) }));
  const cand = all
    .filter((f) => f.who.length && f.w >= 1000 && f.w >= f.h * 1.1 && !BAD.test(f.t + ' ' + f.d) && ACTION.test(f.t + ' ' + f.d) && !NO.test(f.t + ' ' + f.d))
    .map((f) => ({ ...f, best: Math.min(...f.who.map((id) => rank.get(id))), year: yearOf(f) }))
    .filter((f) => f.best < TOP);
  const legendSet = new Set(manual.legends);
  const legends = cand.filter((f) => (f.year && f.year < 2000) || legendSet.has(f.t));
  const per = {};
  const modern = cand.filter((f) => !legends.includes(f))
    .sort((a, b) => (b.who.length > 1) - (a.who.length > 1) || a.best - b.best)
    .filter((f) => {
      const main = f.who.find((id) => rank.get(id) === f.best);
      per[main] = (per[main] || 0) + 1;
      return per[main] <= PER_PLAYER;
    });
  const rejected = new Set(manual.rejected);
  const shots = [...legends.map((f) => ({ ...f, legend: true })), ...modern]
    .filter((f) => !rejected.has(f.t))
    .map((f) => ({
      id: shotId(f.t), file: f.t, img: f.thumb.split('?')[0], page: f.url, w: f.w, h: f.h,
      who: f.who, year: f.year || null, legend: !!f.legend, desc: f.d, author: f.a || null, license: f.lic || null,
    }));
  fs.writeFileSync(OUT, JSON.stringify(shots));
  console.log(`Готово: ${shots.length} фото (легенди ${shots.filter((s) => s.legend).length}), викинуто вручну ${rejected.size} → ${path.relative(process.cwd(), OUT)}`);
})();
