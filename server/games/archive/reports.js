// Звіти гравців про фото «Фотоархіву»: 🚩 погане фото і ➕ хто ще є на фото. Кожне фото — одна задача (issue) у GitHub
// з міткою photo-report, кожен звіт — коментар до неї. Власник ставить мітку `approved` (схвалити все в задачі) або закриває;
// схвалене переносить у базу scripts/apply-shot-reports.js. Без GITHUB_TOKEN (локально) звіти лише пишуться в консоль.
const { gh, hasToken } = require('../../core/github');
const LABEL = 'photo-report';

const REASONS = {
  hidden: 'загаданих гравців не видно або вони дрібні',
  wrong: 'на фото не ті люди, що в підписі',
  boring: 'не матч: тренування, розминка, натовп',
  other: 'інше',
};

// фото → номер відкритої задачі; список відкритих задач читаємо один раз після старту
let issues = null;
async function loadIssues() {
  if (issues) return issues;
  const map = new Map();
  for (let page = 1; page < 30; page++) {
    const list = await gh('GET', `/issues?labels=${LABEL}&state=open&per_page=100&page=${page}`);
    for (const it of list) {
      const m = /\[shot:([a-z0-9]+)\]/.exec(it.title);
      if (m) map.set(m[1], it.number);
    }
    if (list.length < 100) break;
  }
  issues = map;
  return issues;
}

const names = (players) => players.map((p) => `${p.uk || p.name} (${p.name}${p.born ? `, ${p.born}` : ''}; \`${p.id}\`)`).join(', ');

function issueBody(shot, tagged) {
  return [
    `![фото](${shot.img})`,
    '',
    `**Файл:** [${shot.file}](${shot.page})${shot.year ? ` · ${shot.year}` : ''}`,
    `**Зараз позначені:** ${names(tagged) || '—'}`,
    shot.desc ? `**Підпис Commons:** ${shot.desc}` : '',
    '',
    '---',
    'Схвалити все в цій задачі — мітка **`approved`**, тоді `npm run apply-shot-reports` перенесе це в базу.',
    'Відхилити — просто закрити задачу. Якщо схвалити треба лише частину — видаліть зайві коментарі перед міткою.',
  ].filter((l) => l !== null).join('\n');
}

function commentBody(report, players) {
  const data = report.kind === 'bad' ? { kind: 'bad', reason: report.reason } : { kind: 'missing', ids: players.map((p) => p.id) };
  const text = report.kind === 'bad'
    ? `🚩 **Погане фото:** ${REASONS[report.reason] || REASONS.other}${report.note ? ` — «${report.note}»` : ''}`
    : `➕ **Тут є ще:** ${names(players)}`;
  return `${text}\n\n<!-- report ${JSON.stringify(data)} -->`;
}

// звіти пишемо по одному, щоб два одночасні звіти про те саме фото не створили дві задачі
let chain = Promise.resolve();
function submit(report, shot, tagged, players) {
  if (!hasToken) {
    console.log('[archive] звіт (без GITHUB_TOKEN — лише в консоль):', shot.file, commentBody(report, players).split('\n')[0]);
    return Promise.resolve();
  }
  chain = chain.then(async () => {
    const map = await loadIssues();
    let num = map.get(shot.id);
    if (!num) {
      const it = await gh('POST', '/issues', { title: `📷 ${shot.file} [shot:${shot.id}]`, body: issueBody(shot, tagged), labels: [LABEL] });
      num = it.number;
      map.set(shot.id, num);
    }
    await gh('POST', `/issues/${num}/comments`, { body: commentBody(report, players) });
    await gh('POST', `/issues/${num}/labels`, { labels: [report.kind === 'bad' ? 'photo-bad' : 'photo-missing'] });
  }).catch((e) => console.log('[archive] звіт не відправлено:', e.message));
  return chain;
}

module.exports = { submit, REASONS };
