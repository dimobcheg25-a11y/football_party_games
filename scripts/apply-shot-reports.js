// Переносить схвалені звіти гравців «Фотоархіву» в базу: задачі GitHub з мітками photo-report + approved
// (їх створює server/games/archive/reports.js). 🚩 погане фото → manual-shots.js `rejected` і геть із shots.json;
// ➕ хто ще на фото → manual-shots.js `extra` і в `who` фото. Застосовані задачі закриваються з коментарем.
// Токен — GITHUB_TOKEN або збережений git-логін до github.com (git credential fill).
// Запуск: npm run apply-shot-reports [-- --dry] (--dry — лише показати, нічого не змінювати). Потім — npm test, коміт.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = process.env.REPORTS_REPO || 'dimobcheg25-a11y/football_party_games';
const DRY = process.argv.includes('--dry');
const MANUAL = path.join(__dirname, '..', 'server', 'data', 'manual-shots.js');
const SHOTS = path.join(__dirname, '..', 'server', 'data', 'shots.json');

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const out = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  return /^password=(.*)$/m.exec(out)?.[1];
}
const TOKEN = token();

async function gh(method, url, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${url}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'football-party-games', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function writeManual(m) {
  const q = (s) => JSON.stringify(s);
  const extra = Object.entries(m.extra).sort(([a], [b]) => a.localeCompare(b)).map(([t, ids]) => `    ${q(t)}: ${q(ids)},`).join('\n');
  fs.writeFileSync(MANUAL, `// Ручні правки фото «Фотоархіву» (scripts/build-shots.js). Поповнює scripts/apply-shot-reports.js зі схвалених звітів гравців.
// rejected — назви файлів Commons, які не показуємо; extra — файл → [id гравців], яких немає в «зображено» на Commons;
// legends — сучасні за датою, але легендарні кадри (ретро до 2000 — легенди й так).
module.exports = {
  legends: [${m.legends.map(q).join(', ')}],
  extra: {${extra ? `\n${extra}\n  ` : ''}},
  rejected: [
${[...new Set(m.rejected)].sort().map((t) => `    ${q(t)},`).join('\n')}
  ],
};
`);
}

(async () => {
  const manual = require(MANUAL);
  let shots = JSON.parse(fs.readFileSync(SHOTS, 'utf8'));
  const issues = await gh('GET', '/issues?labels=photo-report,approved&state=open&per_page=100');
  console.log(`Схвалених задач: ${issues.length}${DRY ? ' (--dry: нічого не змінюю)' : ''}`);
  const applied = [];
  for (const it of issues) {
    const id = /\[shot:([a-z0-9]+)\]/.exec(it.title)?.[1];
    const shot = shots.find((s) => s.id === id);
    const file = shot?.file || /📷 (.+) \[shot:/.exec(it.title)?.[1];
    const comments = await gh('GET', `/issues/${it.number}/comments?per_page=100`);
    const reports = comments.map((c) => /<!-- report (\{.*\}) -->/.exec(c.body)?.[1]).filter(Boolean).map((j) => JSON.parse(j));
    const bad = reports.some((r) => r.kind === 'bad');
    const add = [...new Set(reports.filter((r) => r.kind === 'missing').flatMap((r) => r.ids))];
    if (bad) {
      console.log(`  #${it.number} 🚩 прибрати: ${file}`);
      manual.rejected.push(file);
      shots = shots.filter((s) => s.file !== file);
    } else if (add.length) {
      console.log(`  #${it.number} ➕ ${file}: ${add.join(', ')}`);
      manual.extra[file] = [...new Set([...(manual.extra[file] || []), ...add])];
      if (shot) shot.who = [...new Set([...shot.who, ...add])];
    } else console.log(`  #${it.number} — немає звітів, пропускаю`);
    applied.push(it.number);
  }
  if (DRY || !applied.length) return;
  writeManual(manual);
  fs.writeFileSync(SHOTS, JSON.stringify(shots));
  for (const n of applied) {
    await gh('POST', `/issues/${n}/comments`, { body: '✅ Застосовано в базі фото — буде на сайті після наступного деплою.' });
    await gh('PATCH', `/issues/${n}`, { state: 'closed', state_reason: 'completed' });
  }
  console.log(`Готово: ${applied.length} задач застосовано й закрито. Далі — npm test і коміт.`);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
