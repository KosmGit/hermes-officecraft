/**
 * What computeGame() really reads of the office and of the clock, as one string (pure: no SDK, no DOM, no clock).
 *
 * A /live read builds a new office object every time (its body carries a timestamp, and the heartbeat of every running card moves),
 * so memoising the game on that object recomputes it once per read for nothing. The game reads, of the office: the cards it counts
 * (their status, dates, assignee, title, model override, guard flag), the boards (slug, creation date) and, of the agents, their name,
 * whether they work and what dresses them (description, role). Of the clock it reads the local day (streak, season, closed nights and
 * days), whether it is night, the age in days of the oldest profile and which profiles are still recruits. Two reads that give the
 * same key give the same game: nothing else is looked at (tests/js/gamekey.test.mjs holds it against computeGame itself).
 */
import { RULES_V2, dayNo } from './achievements.js'
import { RULES, gameFacts } from './game.js'

const DAY_MS = 86_400_000
const finite = v => typeof v === 'number' && Number.isFinite(v)

/** The part of the office the game reads (same shapes, nothing else): what `computeGame` gets in place of the whole office gives the same game. */
export function gameOffice(office) {
  const { office: o } = gameFacts(null, office)   // the same filter as the game: no test board, no guard
  if (!o) return o
  return {
    boards: (o.boards || []).map(b => ({
      slug: b?.slug,
      createdMs: b?.createdMs,
      tasks: (Array.isArray(b?.tasks) ? b.tasks : []).map(t => (t ? { id: t.id, status: t.status, createdMs: t.createdMs, completedMs: t.completedMs, assignee: t.assignee, title: t.title, modelOverride: t.modelOverride } : t))
    })),
    agents: (o.agents || []).map(a => ({
      name: a?.name,
      state: a?.state === 'working' ? 'working' : 'other',
      description: a?.description,
      roleOverride: a?.roleOverride,
      officeMeta: typeof a?.officeMeta?.role === 'string' ? { role: a.officeMeta.role } : undefined
    }))
  }
}

/** The clock as the game reads it: the local day, the night, the age of the oldest profile in days, the recruits (7 days from their first sighting). */
export function gameClock(history, nowMs) {
  const profiles = history && history.ok ? Object.values(history.profiles || {}) : []
  const firsts = profiles.map(p => p?.stats?.firstSeenMs).filter(finite)
  return [
    dayNo(nowMs),
    new Date(nowMs).getHours() < RULES_V2.quietUntilHour,
    firsts.length ? Math.max(0, Math.floor((nowMs - Math.min(...firsts)) / DAY_MS)) : null,
    profiles.filter(p => finite(p?.stats?.firstSeenMs) && nowMs - p.stats.firstSeenMs >= 0 && nowMs - p.stats.firstSeenMs < RULES.recruitMs).map(p => p.name)
  ]
}

/** The key: the game is recomputed when it changes (and when /history, the preference or the extra definitions change, which the caller tracks). */
export function gameInputsKey(office, nowMs, history = null) {
  return JSON.stringify([gameOffice(office), gameClock(history, nowMs)])
}
