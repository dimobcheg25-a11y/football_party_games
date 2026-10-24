// Сила ліг за роками — таблиця коефіцієнтів країн УЄФА (сума за 5 сезонів) з архіву Берта Кассіса kassiesa.net
// → server/data/uefa-ranks.json: { [рік]: { [країна англ.]: [місце, сила 0..1 — частка від лідера] } }.
// Рік Y — рейтинг після сезону (Y-1)/Y. Методика підрахунку очок УЄФА мінялась (method1…5), тому порівнюємо
// лише частку від лідера того ж року. Для «Трансферного вікна»: вага нагороди ліги = сила її країни того року.
// Запуск: npm run build-uefa-ranks (≈30 с)

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'server', 'data', 'uefa-ranks.json');
const FIRST = 1979;
const LAST = new Date().getFullYear();
// у якій теці архіву лежить рік (методика УЄФА того часу)
const methodOf = (y) => (y <= 1998 ? 1 : y <= 2003 ? 2 : y <= 2008 ? 3 : y <= 2017 ? 4 : 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Рядки таблиці: місце, (порожньо), країна, 5 сезонів, сума, клубів
function parse(html) {
  const rows = [];
  for (const tr of html.split(/<tr class="countryline">/).slice(1)) {
    const cells = [...tr.split('</tr>')[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
    if (cells.length < 8) continue;
    const total = Number(cells[cells.length - 2]);
    if (cells[2] && Number.isFinite(total)) rows.push([Number(cells[0]), cells[2], total]);
  }
  return rows;
}

async function main() {
  const result = {};
  for (let y = FIRST; y <= LAST; y++) {
    const url = `https://kassiesa.net/uefa/data/method${methodOf(y)}/crank${y}.html`;
    const res = await fetch(url, { headers: { 'User-Agent': 'football-games data build' } });
    if (!res.ok) { console.log(`  ${y}: HTTP ${res.status} — пропускаю`); continue; }
    const rows = parse(await res.text());
    if (!rows.length) { console.log(`  ${y}: таблицю не знайдено`); continue; }
    const max = Math.max(...rows.map((r) => r[2]));
    result[y] = Object.fromEntries(rows.map(([rank, country, total]) => [country, [rank, Math.round((total / max) * 1000) / 1000]]));
    console.log(`  ${y}: ${rows.length} країн, перша — ${rows.find((r) => r[0] === 1)?.[1]}`);
    await sleep(300);
  }
  fs.writeFileSync(OUT, JSON.stringify(result));
  console.log(`Готово: ${Object.keys(result).length} років → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
