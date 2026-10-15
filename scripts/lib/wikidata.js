// Запити до Wikidata/Вікіпедії з повторами при обривах і лімітах. Спільне для скриптів збирання бази.

const UA = 'football-party-games/1.0 (https://github.com/dimobcheg25-a11y/football_party_games; hobby project)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, headers = {}, attempt = 0) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  } catch (e) {
    // обірване з'єднання / таймаут — пробуємо ще
    if (attempt >= 6) throw e;
    console.log(`  (мережева помилка: ${e.message}, повтор)`);
    await sleep(4000 * (attempt + 1));
    return getJson(url, headers, attempt + 1);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    const wait = 4000 * (attempt + 1);
    console.log(`  (HTTP ${res.status}, чекаю ${wait / 1000} с)`);
    await sleep(wait);
    return getJson(url, headers, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 120)}`);
  let text;
  try {
    text = await res.text();
  } catch (e) {
    // з'єднання обірвалось під час читання відповіді — повторюємо запит
    if (attempt >= 6) throw e;
    console.log(`  (обірвано під час читання: ${e.message}, повтор)`);
    await sleep(4000 * (attempt + 1));
    return getJson(url, headers, attempt + 1);
  }
  if (text.startsWith('You are making too many requests') && attempt < 6) {
    console.log('  (ліміт запитів Вікіпедії, чекаю)');
    await sleep(5000 * (attempt + 1));
    return getJson(url, headers, attempt + 1);
  }
  return JSON.parse(text);
}

async function sparql(query) {
  const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query);
  const j = await getJson(url, { Accept: 'application/sparql-results+json' });
  return j.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

const qidOf = (uri) => uri.split('/').pop();
const values = (qids) => qids.map((q) => 'wd:' + q).join(' ');

module.exports = { getJson, sparql, sleep, qidOf, values };
