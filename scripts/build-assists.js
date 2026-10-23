// Хто кому віддавав гольові передачі — з таблиці подій матчів transfermarkt-datasets (CC0; голи з автором передачі,
// приблизно з 2012/13: клубні змагання й турніри збірних) → server/data/assists.json:
//   { names: { [tm id]: ім'я } — гравці поза базою, які трапляються в списках,
//     to: { [tm id гравця бази]: [[tm id асистента, передач, tm id клубу]] } — хто асистував цьому гравцю (усі),
//     by: { [tm id гравця бази]: [[tm id того, хто забив, передач, tm id клубу]] } — кому найбільше асистував цей гравець (перші 20 і всі з 2+),
//     duos: [[асистент, автор голу, передач, клуб]] — найрезультативніші пари загалом (обидва з бази) }.
// Клуб — той, за який пара найчастіше так забивала (для збірної — id збірної в Transfermarkt).
// Запуск: npm run build-assists (≈1 хв; після build-transfers — з нього беруться tm id гравців бази).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');

const URL = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/game_events.csv.gz';
const OUT = path.join(__dirname, '..', 'server', 'data', 'assists.json');
const TOP = 20; // рядків у кожному списку
const DUOS = 60;

const ourTm = new Set(Object.values(require('../server/data/transfers.json')).map((v) => String(v.tm)).filter((x) => x !== 'null' && x !== 'undefined'));

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

async function main() {
  console.log('Завантажую таблицю подій матчів…');
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rl = readline.createInterface({ input: Readable.fromWeb(res.body).pipe(zlib.createGunzip()), crlfDelay: Infinity });

  const pairs = new Map(); // «асистент|автор» → { n, clubs: Map(клуб → n) }
  let head = null, goals = 0, assisted = 0;
  for await (const line of rl) {
    if (!line) continue;
    const f = fields(line);
    if (!head) { head = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
    if (f[head.type] !== 'Goals') continue;
    goals++;
    const scorer = f[head.player_id], assist = f[head.player_assist_id];
    if (!scorer || !assist || scorer === assist) continue;
    if (!ourTm.has(scorer) && !ourTm.has(assist)) continue;
    assisted++;
    const key = `${assist}|${scorer}`;
    const cur = pairs.get(key) || { n: 0, clubs: new Map() };
    cur.n++;
    const club = f[head.club_id];
    cur.clubs.set(club, (cur.clubs.get(club) || 0) + 1);
    pairs.set(key, cur);
  }
  console.log(`  голів ${goals}, з передачею за участі гравців бази ${assisted}`);

  // імена — з таблиці гравців (у подіях імен немає)
  console.log('Завантажую імена гравців…');
  const names = new Map();
  const pres = await fetch(URL.replace('game_events', 'players'));
  if (!pres.ok) throw new Error(`HTTP ${pres.status}`);
  const prl = readline.createInterface({ input: Readable.fromWeb(pres.body).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let ph = null;
  for await (const line of prl) {
    if (!line) continue;
    const f = fields(line);
    if (!ph) { ph = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
    names.set(f[ph.player_id], f[ph.name]);
  }

  const to = new Map(), by = new Map(), duos = [];
  for (const [key, v] of pairs) {
    const [a, s] = key.split('|');
    const club = Number([...v.clubs].sort((x, y) => y[1] - x[1])[0][0]);
    if (ourTm.has(s)) (to.get(s) || to.set(s, []).get(s)).push([Number(a), v.n, club]);
    if (ourTm.has(a)) (by.get(a) || by.set(a, []).get(a)).push([Number(s), v.n, club]);
    if (ourTm.has(a) && ourTm.has(s)) duos.push([Number(a), Number(s), v.n, club]);
  }
  const used = new Set();
  // to — повністю (категорії «асистував зірці» мають бути повні), by — перші TOP і всі з 2+ передачами
  const cut = (map, all) => Object.fromEntries([...map].map(([k, list]) => {
    const top = list.sort((x, y) => y[1] - x[1]).filter((r, i) => all || i < TOP || r[1] >= 2);
    top.forEach((r) => used.add(String(r[0])));
    return [k, top];
  }));
  const result = { names: {}, to: cut(to, true), by: cut(by, false), duos: duos.sort((x, y) => y[2] - x[2]).slice(0, DUOS) };
  for (const id of used) if (!ourTm.has(id) && names.has(id)) result.names[id] = names.get(id);
  fs.writeFileSync(OUT, JSON.stringify(result));
  console.log(`Готово: «кому асистували» ${to.size}, «хто асистував» ${by.size}, імен поза базою ${Object.keys(result.names).length} → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
