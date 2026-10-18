// Фото «Фотоархіву» (server/data/shots.json — scripts/build-shots.js): хто з позначених на фото загадується на якому рівні
// і хто «міг бути на кадрі» (грав того року за ту саму команду чи збірну, що й хтось із позначених) — за таких ні очок, ні штрафу.
const { playerById } = require('../../data');
const { poolFor, careerOf } = require('../path/careers');

let shots = [];
try { shots = require('../../data/shots.json'); } catch { /* ще не зібрано — гра без фото */ }
const shotById = new Map(shots.map((s) => [s.id, s]));

const LEVELS = ['easy', 'normal', 'fan'];
const CATEGORIES = ['all', 'legends', 'modern'];
const pools = Object.fromEntries(LEVELS.map((l) => [l, new Set(poolFor('all', l).map((p) => p.id))]));

// кого з фото загадуємо: позначені на Commons гравці з пулу рівня (решта — «є на фото», нейтральні)
const targetsOf = (shot, level) => shot.who.filter((id) => pools[level].has(id));

function shotsFor(category, level) {
  return shots.filter((s) => (category === 'all' || (category === 'legends') === s.legend) && targetsOf(s, level).length);
}

// команди, за які гравець грав у році фото (рік невідомий — будь-коли): клуби кар'єри + збірна, якщо тоді грав
function teamsIn(p, year) {
  const c = careerOf(p);
  if (!c) return [];
  const at = (k) => !year || ((k.s || 0) <= year && (k.e == null || k.e >= year));
  const clubs = c.clubs.filter(at).map((k) => k.t);
  const first = Math.min(...c.clubs.map((k) => k.s || 9999));
  const active = !year || (first <= year && c.clubs.some((k) => k.e == null || k.e >= year));
  return c.nation && active ? [...clubs, c.nation.t] : clubs;
}

const teamCache = new Map();
function shotTeams(shot) {
  if (!teamCache.has(shot.id)) {
    teamCache.set(shot.id, new Set(shot.who.flatMap((id) => (playerById.get(id) ? teamsIn(playerById.get(id), shot.year) : []))));
  }
  return teamCache.get(shot.id);
}

// названий гравець міг бути на кадрі: позначений, але не загаданий, або грав тоді за одну з команд фото
function maybeOnShot(shot, p) {
  if (shot.who.includes(p.id)) return true;
  const teams = shotTeams(shot);
  return teamsIn(p, shot.year).some((t) => teams.has(t));
}

module.exports = { shots, shotById, shotsFor, targetsOf, maybeOnShot, LEVELS, CATEGORIES };
