/**
 * The view of the showcase window: what the dialog shows, computed from the game and nothing else — pure, runs under node.
 * Facts only: every number is read from `computeGame` (cards done, achievements, grades, streak); nothing is invented, nothing counts volume.
 *   vitrineView(game, nowMs) -> {
 *     level:    { level, name, nextName, done, next, floor, pct }   done / next, the same ratio as the text « done/next »
 *     got, total, hidden                                          unlocked / catalogue size / locked secret ones
 *     shelves:  [{ family, items, unlocked }]                     the families in order, each shelf best first (core/achievements collectionFamilies)
 *     order:    [id]                                              every achievement in shelf order (the keyboard walks it)
 *     almost:   [achievement]                                     the 3 locked, non-secret ones closest to their goal (with some progress)
 *     recent:   Set<id>                                           unlocked within the last 2 days (a date, never a guess)
 *     grades:   [{ id, n }]                                       how many agents hold each grade, highest first, none at 0
 *     first:    id                                                the medal selected when the window opens
 *   }
 */
import { collectionFamilies, hiddenLocked } from './achievements.js'
import { GRADES, OFFICE_LEVELS } from './game.js'

export const RECENT_MS = 2 * 86_400_000
export const ALMOST_N = 3

/** Share of a locked achievement's goal reached, 0..1 (a goal of 0 or an unread value is 0). */
export const ratio = a => {
  const [cur, goal] = a.progress || [0, 0]
  return goal > 0 ? Math.min(1, Math.max(0, cur / goal)) : 0
}

export function vitrineView(game, nowMs = 0) {
  const lvl = game.office
  const idx = OFFICE_LEVELS.findIndex(l => l.name === lvl.name)
  const floor = OFFICE_LEVELS[idx]?.at ?? 0
  const nextName = OFFICE_LEVELS[idx + 1]?.name ?? null
  // the bar says what the text says. The text is « done/next » (cards done in total over the threshold), so the fill is done/next:
  // « 76/800 » is a bar at 9.5 %, never the 50 % of a distance measured from the level floor.
  const pct = lvl.next ? Math.min(100, Math.max(0, Math.round((lvl.done / lvl.next) * 1000) / 10)) : 100
  const shelves = collectionFamilies(game.achievements)
  const order = shelves.flatMap(f => f.items.map(a => a.id))
  const all = shelves.flatMap(f => f.items)
  const almost = all
    .filter(a => !a.unlocked && !a.hidden && !a.unavailable && ratio(a) > 0)
    .sort((x, y) => ratio(y) - ratio(x) || order.indexOf(x.id) - order.indexOf(y.id))
    .slice(0, ALMOST_N)
  const recent = new Set(all.filter(a => a.unlocked && a.dated && a.unlockedMs != null && nowMs - a.unlockedMs >= 0 && nowMs - a.unlockedMs < RECENT_MS).map(a => a.id))
  const held = Object.values(game.grades || {})
  const grades = [...GRADES].reverse().map(g => ({ id: g.id, n: held.filter(x => x.id === g.id).length })).filter(g => g.n > 0)
  const latest = all.filter(a => a.unlocked && a.unlockedMs != null).sort((x, y) => y.unlockedMs - x.unlockedMs)[0]
  const first = (latest ?? all.find(a => a.unlocked) ?? almost[0] ?? all[0])?.id ?? null
  return {
    level: { level: lvl.level, name: lvl.name, nextName, done: lvl.done, next: lvl.next, floor, pct },
    got: game.achievements.filter(a => a.unlocked).length,
    total: game.achievements.length,
    hidden: hiddenLocked(game.achievements),
    shelves, order, almost, recent, grades, first
  }
}
