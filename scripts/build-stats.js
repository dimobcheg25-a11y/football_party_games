// Асисти, гол+пас, рекорди сезону й картки — з таблиці виходів на поле transfermarkt-datasets (CC0; кожен матч з 2012/13:
// голи, асисти, картки) → server/data/stats.json з уже готовими топами (до TOP рядків), щоб не тримати сирі дані:
//   { names: { [tm id]: ім'я }, comp: { [змагання]: { assists, ga, yellow, red, seasonGoals, seasonAssists } },
//     club: { [tm id клубу]: { assists, ga } },
//     players: { [tm id гравця з нашої бази]: { t: [голи, асисти, матчі, жовті картки] — усі змагання, c: { [tm id клубу]: [голи, асисти, матчі] — лише чемпіонат },
//       x: { min — хвилини, red — червоні, full — матчі від 60 хв, cs — з них «сухі» (команда не пропустила), conc — пропущено в них,
//            win — перемоги команди (будь-які хвилини), clG/clA — голи й асисти в ЛЧ, top — сезонів з 900+ хв у топ-5 лігах або ЛЧ } } } };
//   рахунок матчу — з таблиці games того ж набору (для «Трансферного вікна»).
//   рядок топу — [tm id гравця, значення] або [tm id, значення, сезон «22/23»]. players — усі клубні змагання й турніри збірних з 2012/13.
// Гравців зіставляє з базою server/games/top/tops.js (за tm у transfers.json); кого в базі немає — показується з іменем звідси.
// Запуск: npm run build-stats (≈2 хв; файл ~45 МБ читається потоком, щоб не забивати пам'ять).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');

const BASE = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/';
const URL = BASE + 'appearances.csv.gz';
const GAMES = BASE + 'games.csv.gz';
const TOP_LEVEL = ['GB1', 'ES1', 'IT1', 'L1', 'FR1', 'CL'];
const OUT = path.join(__dirname, '..', 'server', 'data', 'stats.json');
const COMPS = ['GB1', 'ES1', 'IT1', 'L1', 'FR1', 'UKR1', 'PO1', 'NL1', 'TR1', 'BE1', 'SC1', 'CL', 'EL'];
const TOP = 25;

let clubs = {};
let ourTm = new Set();
try { ourTm = new Set(Object.values(require('../server/data/transfers.json')).map((v) => String(v.tm)).filter((x) => x !== 'null')); } catch { /* без підсумків гравців */ }
try { clubs = require('../server/data/transfer-clubs.json'); } catch { /* без клубних топів */ }
// клуби, для яких робимо топи: зіставлені з нашою базою і з ліги зі списку
const CLUB_IDS = new Set(Object.entries(clubs).filter(([, c]) => c.team && COMPS.includes(c.league)).map(([id]) => id));

// «2022-08-14» → сезон «22/23» (сезон починається в липні)
function seasonOf(date) {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 7 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}/${String((start + 1) % 100).padStart(2, '0')}`;
}

// Рядок CSV з лапками → масив полів.
function fields(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const bump = (map, key, d) => {
  const cur = map.get(key) || { g: 0, a: 0, y: 0, r: 0 };
  cur.g += d.g; cur.a += d.a; cur.y += d.y; cur.r += d.r;
  map.set(key, cur);
};
// Топ з Map(ключ → значення): [[ключ…, значення]] за спаданням.
function top(map, pick, split = (k) => [k]) {
  return [...map].map(([k, v]) => [...split(k), pick(v)]).filter((r) => r[r.length - 1] > 0)
    .sort((a, b) => b[b.length - 1] - a[a.length - 1]).slice(0, TOP)
    // значення — другим, сезон (якщо є) — третім: [tm, значення, сезон]
    .map((r) => (r.length === 3 ? [Number(r[0]), r[2], r[1]] : [Number(r[0]), r[1]]));
}

// Рядки CSV.gz з мережі потоком.
async function lines(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return readline.createInterface({ input: Readable.fromWeb(res.body).pipe(zlib.createGunzip()), crlfDelay: Infinity });
}

// game_id → [господарі, гості, голи господарів, голи гостей]
async function loadGames() {
  const games = new Map();
  let head = null;
  for await (const line of await lines(GAMES)) {
    if (!line) continue;
    const f = fields(line);
    if (!head) { head = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
    games.set(f[head.game_id], [f[head.home_club_id], f[head.away_club_id], Number(f[head.home_club_goals]), Number(f[head.away_club_goals])]);
  }
  return games;
}

async function main() {
  console.log('Завантажую рахунки матчів…');
  const games = await loadGames();
  console.log(`  ${games.size} матчів`);
  console.log('Завантажую таблицю виходів на поле…');
  const rl = await lines(URL);
  const topMinutes = new Map(); // tm id → Map(сезон → хвилини в топ-5 лігах і ЛЧ)

  const byComp = new Map(); // змагання → Map(гравець → суми)
  const bySeason = new Map(); // змагання → Map(«гравець|сезон» → суми)
  const byClub = new Map(); // клуб → Map(гравець → суми)
  const names = new Map();
  const perPlayer = new Map(); // tm id гравця бази → { t, c }
  let head = null, n = 0;
  for await (const line of rl) {
    if (!line) continue;
    const f = fields(line);
    if (!head) { head = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
    const comp = f[head.competition_id];
    const player = f[head.player_id];
    const d = { g: Number(f[head.goals]) || 0, a: Number(f[head.assists]) || 0, y: Number(f[head.yellow_cards]) || 0, r: Number(f[head.red_cards]) || 0 };
    // підсумки гравців бази — з усіх клубних змагань (ліги, кубки, єврокубки; матчів збірних у таблиці немає)
    if (ourTm.has(player)) {
      if (!perPlayer.has(player)) perPlayer.set(player, { t: [0, 0, 0, 0], c: {}, x: { min: 0, red: 0, full: 0, cs: 0, conc: 0, win: 0, clG: 0, clA: 0, top: 0 } });
      const pp = perPlayer.get(player);
      const club = f[head.player_club_id];
      pp.t[0] += d.g; pp.t[1] += d.a; pp.t[2]++; pp.t[3] += d.y;
      const x = pp.x;
      const min = Number(f[head.minutes_played]) || 0;
      x.min += min; x.red += d.r;
      if (comp === 'CL') { x.clG += d.g; x.clA += d.a; }
      const game = games.get(f[head.game_id]);
      if (game && Number.isFinite(game[2]) && Number.isFinite(game[3])) {
        const home = game[0] === club;
        const own = home ? game[2] : game[3], against = home ? game[3] : game[2];
        if (own > against) x.win++;
        if (min >= 60) { x.full++; x.conc += against; if (against === 0) x.cs++; }
      }
      if (TOP_LEVEL.includes(comp)) {
        if (!topMinutes.has(player)) topMinutes.set(player, new Map());
        const m = topMinutes.get(player), season = seasonOf(f[head.date]);
        m.set(season, (m.get(season) || 0) + min);
      }
      // по клубах — лише чемпіонат (коди ліг: GB1, ES1, UKR1… — з цифрою), як матчі й голи з Вікіпедії
      if (/\d$/.test(comp)) {
        const c = (pp.c[club] ||= [0, 0, 0]);
        c[0] += d.g; c[1] += d.a; c[2]++;
      }
    }
    if (!COMPS.includes(comp)) continue;
    names.set(player, f[head.player_name]);
    if (!byComp.has(comp)) { byComp.set(comp, new Map()); bySeason.set(comp, new Map()); }
    bump(byComp.get(comp), player, d);
    bump(bySeason.get(comp), `${player}|${seasonOf(f[head.date])}`, d);
    const club = f[head.player_club_id];
    if (CLUB_IDS.has(club)) {
      if (!byClub.has(club)) byClub.set(club, new Map());
      bump(byClub.get(club), player, d);
    }
    if (++n % 200000 === 0) process.stdout.write(`\r  ${n} записів`);
  }
  console.log(`\r  ${n} записів у потрібних змаганнях`);

  const result = { names: {}, comp: {}, club: {}, players: {} };
  const used = new Set();
  const keep = (list) => { list.forEach((r) => used.add(String(r[0]))); return list; };
  const seasonSplit = (k) => k.split('|');
  for (const [comp, map] of byComp) {
    const seasons = bySeason.get(comp);
    result.comp[comp] = {
      assists: keep(top(map, (v) => v.a)),
      ga: keep(top(map, (v) => v.g + v.a)),
      yellow: keep(top(map, (v) => v.y)),
      red: keep(top(map, (v) => v.r)),
      seasonGoals: keep(top(seasons, (v) => v.g, seasonSplit)),
      seasonAssists: keep(top(seasons, (v) => v.a, seasonSplit)),
    };
  }
  for (const [club, map] of byClub) {
    result.club[club] = { assists: keep(top(map, (v) => v.a)), ga: keep(top(map, (v) => v.g + v.a)) };
  }
  for (const id of used) result.names[id] = names.get(id);
  for (const [player, m] of topMinutes) perPlayer.get(player).x.top = [...m.values()].filter((v) => v >= 900).length;
  result.players = Object.fromEntries(perPlayer);
  fs.writeFileSync(OUT, JSON.stringify(result));
  console.log(`Готово: ${Object.keys(result.comp).length} змагань, ${Object.keys(result.club).length} клубів, ${used.size} гравців у топах, ${perPlayer.size} гравців бази → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
