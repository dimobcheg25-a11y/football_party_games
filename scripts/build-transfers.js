// Трансфери й ринкова вартість з відкритого набору transfermarkt-datasets (CC0, github.com/dcaribou/transfermarkt-datasets)
// → server/data/transfers.json: { [id гравця]: { maxValue, value, topFee, topFrom, topTo, topSeason, totalFees, paid, pos } } (євро;
//   pos — основна позиція з Transfermarkt англійською, напр. «Left Winger»: точніша за перелік позицій у Wikidata;
//   fees — усі платні трансфери [сума, клуб-продавець, клуб-покупець, сезон] з id клубів Transfermarkt)
// → server/data/transfer-clubs.json: { [id клубу TM]: { name, league (код ліги TM, якщо відстежується), team (наш qid, якщо зіставили) } }.
// Гравців зіставляємо за ID Transfermarkt у Wikidata (P2446), запасний варіант — ім'я + рік народження.
// Покриття: ті, хто грав у відстежуваних лігах приблизно з 2012 р.; легенди 90-х здебільшого без даних.
// Запуск: npm run build-transfers (після build-players).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { sparql, values, qidOf, sleep } = require('./lib/wikidata');
const { players, playerById, normalize } = require('../server/data');
const { careerOf } = require('../server/games/path/careers');

const BASE = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/';
const OUT = path.join(__dirname, '..', 'server', 'data', 'transfers.json');
const OUT_CLUBS = path.join(__dirname, '..', 'server', 'data', 'transfer-clubs.json');

async function downloadCsv(name) {
  console.log(`Завантажую ${name}…`);
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${name}`);
  const text = zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
  return parseCsv(text);
}

// CSV з лапками: "a","b,c",,"d" — повертає масив об'єктів за заголовком.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...data] = rows;
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// ID Transfermarkt з Wikidata (P2446) для наших гравців.
async function transfermarktIds() {
  const qids = players.map((p) => p.qid).filter(Boolean);
  const out = new Map(); // qid → tm id
  for (let i = 0; i < qids.length; i += 300) {
    const rows = await sparql(`SELECT ?p ?tm WHERE { VALUES ?p { ${values(qids.slice(i, i + 300))} } ?p wdt:P2446 ?tm }`);
    for (const r of rows) if (!out.has(qidOf(r.p))) out.set(qidOf(r.p), r.tm);
    process.stdout.write(`\r  Wikidata: ${Math.min(i + 300, qids.length)}/${qids.length}`);
    await sleep(300);
  }
  console.log();
  return out;
}

const num = (s) => (s ? Math.round(Number(s)) : 0);

async function main() {
  const [tmPlayers, tmTransfers, tmClubs, tmIds] = [await downloadCsv('players.csv.gz'), await downloadCsv('transfers.csv.gz'), await downloadCsv('clubs.csv.gz'), await transfermarktIds()];
  const byTm = new Map(tmPlayers.map((p) => [p.player_id, p]));

  // запасний ключ: ім'я + рік народження (лише якщо такий гравець у TM один)
  const byName = new Map();
  for (const p of tmPlayers) {
    const key = `${normalize(p.name)}|${(p.date_of_birth || '').slice(0, 4)}`;
    byName.set(key, byName.has(key) ? null : p);
  }

  const transfersOf = new Map();
  for (const t of tmTransfers) {
    if (!transfersOf.has(t.player_id)) transfersOf.set(t.player_id, []);
    transfersOf.get(t.player_id).push(t);
  }

  const result = {};
  const clubNames = new Map(); // id клубу TM → назва
  const votes = new Map(); // id клубу TM → { n, teams: Map(qid → скільки гравців) }
  let viaWikidata = 0, viaName = 0;
  for (const p of players) {
    let tm = tmIds.has(p.qid) ? byTm.get(tmIds.get(p.qid)) : null;
    if (tm) viaWikidata++;
    else {
      tm = byName.get(`${normalize(p.name)}|${p.born}`) || null;
      if (tm) viaName++;
    }
    if (!tm) continue;
    const list = (transfersOf.get(tm.player_id) || []).filter((t) => num(t.transfer_fee) > 0);
    const top = list.reduce((a, t) => (!a || num(t.transfer_fee) > num(a.transfer_fee) ? t : a), null);
    const entry = {
      tm: Number(tm.player_id),
      maxValue: num(tm.highest_market_value_in_eur) || null,
      // поточна вартість — лише для тих, хто ще грає (сезон 2025+)
      value: Number(tm.last_season) >= 2025 ? num(tm.market_value_in_eur) || null : null,
      totalFees: list.reduce((s, t) => s + num(t.transfer_fee), 0),
      paid: list.length,
      pos: tm.sub_position || null,
    };
    if (top) Object.assign(entry, { topFee: num(top.transfer_fee), topFrom: top.from_club_name, topTo: top.to_club_name, topSeason: top.transfer_season });
    if (list.length) entry.fees = list.map((t) => [num(t.transfer_fee), Number(t.from_club_id), Number(t.to_club_id), t.transfer_season]);
    if (entry.maxValue || entry.paid) result[p.id] = entry;
    for (const t of list) {
      clubNames.set(Number(t.from_club_id), t.from_club_name);
      clubNames.set(Number(t.to_club_id), t.to_club_name);
      // клуб TM → наш клуб: які клуби з кар'єри цього гравця (з Вікіпедії) могли бути ним
      for (const id of [Number(t.from_club_id), Number(t.to_club_id)]) {
        if (!votes.has(id)) votes.set(id, { n: 0, teams: new Map() });
        const v = votes.get(id);
        v.n++;
        for (const q of new Set((careerOf(p)?.clubs || []).map((x) => x.t))) v.teams.set(q, (v.teams.get(q) || 0) + 1);
      }
    }
  }

  // Ручні доповнення: відомі трансфери, яких немає в наборі (переважно гравці, що вже завершили кар'єру).
  const idByName = new Map([...clubNames].map(([id, name]) => [name, id]));
  for (const [id, fee, from, to, season] of require('../server/data/manual-transfers')) {
    const [f, t] = [idByName.get(from), idByName.get(to)];
    if (!playerById.has(id) || f == null || t == null) { console.warn(`  ручний трансфер пропущено: ${id} ${from} → ${to}`); continue; }
    const tm = (result[id] ||= { tm: null, maxValue: null, value: null, totalFees: 0, paid: 0, pos: null });
    tm.fees ||= [];
    if (tm.fees.some((x) => x[2] === t && x[3] === season)) continue;
    tm.fees.push([Math.round(fee * 1e6), f, t, season]);
    tm.totalFees += Math.round(fee * 1e6);
    tm.paid++;
    if (!tm.topFee || fee * 1e6 > tm.topFee) Object.assign(tm, { topFee: Math.round(fee * 1e6), topFrom: from, topTo: to, topSeason: season });
  }

  // Наш клуб для клубу TM — той, що є в кар'єрах більшості гравців, які туди/звідти переходили (і щонайменше 3 таких гравці).
  const leagueOf = new Map(tmClubs.map((c) => [Number(c.club_id), c.domestic_competition_id]));
  const clubs = {};
  for (const [id, name] of clubNames) {
    const v = votes.get(id);
    const [team, n] = [...(v?.teams || [])].sort((a, b) => b[1] - a[1])[0] || [];
    clubs[id] = { name, league: leagueOf.get(id) || null, team: n >= 3 && n >= v.n * 0.6 ? team : null };
  }
  fs.writeFileSync(OUT_CLUBS, JSON.stringify(clubs));
  console.log(`Клубів: ${clubNames.size}, зіставлено з нашими: ${Object.values(clubs).filter((c) => c.team).length}`);

  fs.writeFileSync(OUT, JSON.stringify(result));
  console.log(`Готово: ${Object.keys(result).length} з ${players.length} гравців (Wikidata: ${viaWikidata}, за іменем: ${viaName}) → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
