// Запити до GitHub API репозиторію сайту: звіти про фото «Фотоархіву» (games/archive/reports.js) і відгуки гравців (core/feedback.js).
// Токен — GITHUB_TOKEN на Render; без нього (локально) звіти й відгуки лише пишуться в консоль.
const REPO = process.env.REPORTS_REPO || 'dimobcheg25-a11y/football_party_games';
const TOKEN = process.env.GITHUB_TOKEN || '';

async function gh(method, url, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'football-party-games', ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

module.exports = { gh, hasToken: !!TOKEN };
