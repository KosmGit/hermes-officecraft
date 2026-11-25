/**
 * Pure office model: roster desks (profiles.list) + the agent half's /live
 * read -> boards, agents with their state and home board, infrastructure.
 * No SDK, no DOM.
 *
 * States, strongest first:
 *   working  a worker heartbeat in the last 2 min (profiles.list worker_session)
 *   waiting  one of their cards is blocked (a decision is yours; wins over stale:
 *            a silent run is reclaimed by the dispatcher, a decision is not)
 *   stale    a card of theirs is `running` but its heartbeat is > 5 min old
 *            (never shown as working: the office must not lie)
 *   queued   (a bot with no session of the moment) a card of theirs waits for an unfinished parent card, and none runs or is blocked
 *            (src/core/queue.js; replaces `idle` and `active` only)
 *   active   a human session touched in the last 10 min
 *   idle     has sessions, none recent       new: never ran       unknown: no session fields
 *
 * The state is the BOT's and says nothing about one card among several. A silent CARD is a separate fact, whatever the
 * state of the bot: `agent.quiet` = its running cards whose own last sign of life (heartbeat, else start) is > 5 min old, the longest
 * silent first (src/core/cards.js). `stale` and `silentMs` are unchanged: the bot is stale only when NONE of its running cards gives a sign.
 */
import { STALE_AFTER_MS, quietCards, runningCards } from './cards.js'
import { isGatewayDegraded, isGatewayDown, isGatewayUp } from './gateway.js'
import { queuedState, toLinks, waitIndex, waitingByBot } from './queue.js'
import { toMs } from './time.js'
import { cutWords, lastTouch, num, oneLine, str } from './util.js'

export { STALE_AFTER_MS }
/** Characters of a blocking reason the page keeps (the agent half serves at most as many). */
export const BLOCK_REASON_MAX = 280
const DONE = new Set(['done', 'archived'])
const OK_RUN = new Set(['ok', 'success', 'completed', 'succeeded'])

/** One /live board -> counts, open/blocked cards, last activity per card. */
export function toBoard(raw) {
  const tasks = (Array.isArray(raw?.tasks) ? raw.tasks : [])
    .filter(t => t && typeof t === 'object' && str(t.id) && str(t.status))
    .map(t => ({
      id: t.id,
      title: oneLine(t.title),
      status: t.status,
      // the reason the bot gave when it blocked the card (`/live`, already cleaned and cut by the agent half): drawn as text, cleaned again here
      // since the page never trusts a text it did not write; absent when there is none. Read for a blocked card only.
      ...(t.status === 'blocked' && oneLine(t.blockReason) ? { blockReason: cutWords(oneLine(t.blockReason), BLOCK_REASON_MAX) } : {}),
      assignee: str(t.assignee) || null,
      createdMs: toMs(t.createdAt),
      startedMs: toMs(t.startedAt),
      completedMs: toMs(t.completedAt),
      heartbeatMs: toMs(t.heartbeatAt),
      // model the card pins; null = the bot's own default. Exact strings, never normalised.
      modelOverride: str(t.modelOverride).trim() || null,
      providerOverride: str(t.providerOverride).trim() || null,
      // a guard of a campaign written by Officecraft: `guard`, `head` (the head guard, else a phase guard), `campaign` (the first 8
      // characters of its id) and, on the head guard, `campaignSize` (the campaign's cards that are not archived). Nothing else is read.
      ...(t.guard === true ? { guard: true, head: t.head === true, campaign: str(t.campaign).slice(0, 8) || null, campaignSize: Number.isInteger(t.campaignSize) && t.campaignSize >= 0 ? t.campaignSize : null } : {})
    }))
  const counts = {}
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1
  const open = tasks.filter(t => !DONE.has(t.status))
  return {
    // the links that still hold a card back (`/live`: [parent id, child id], ids only); [] from an agent half that does not serve them, and in a replay
    links: toLinks(raw?.links),
    slug: str(raw?.slug) || 'board',
    // when the board was created (kanban boards metadata); the game layer dates « builder » with it
    createdMs: toMs(raw?.createdAt),
    tasks,
    counts,
    total: tasks.length,
    done: counts.done || 0,
    open,
    blocked: tasks.filter(t => t.status === 'blocked'),
    running: tasks.filter(t => t.status === 'running')
  }
}

/**
 * The slug is the identity of a board everywhere (zone keys, seats, tooltips, game). Boards that share one (several without a
 * usable slug all read 'board', or a repeated slug) are numbered in list order: 'board', 'board-2', 'board-3'.
 */
export function uniqueSlugs(boards) {
  const seen = new Set()
  return boards.map(b => {
    let slug = b.slug
    for (let n = 2; seen.has(slug); n++) slug = `${b.slug}-${n}`
    seen.add(slug)
    return slug === b.slug ? b : { ...b, slug }
  })
}

/**
 * The board an agent sits at = the one with their newest card; on a tie the board of their running card,
 * then the first slug in alphabetical order (never the order the boards are listed in: the seat must not flip between polls).
 * seats: [{ slug, ts, running }] -> slug, or null when the agent has no card.
 */
export function homeBoard(seats) {
  const best = [...seats].sort((x, y) => y.ts - x.ts || Number(y.running) - Number(x.running) || x.slug.localeCompare(y.slug, 'en'))[0]
  return best ? best.slug : null
}

/**
 * desks: buildRoster() output. live: /live body or null (roster-only mode).
 * Returns { mode, agents, boards, hall, ops }.
 */
export function buildOffice(desks, live, nowMs = Date.now()) {
  const full = Boolean(live && live.ok !== false && Array.isArray(live.boards))
  const boards = full ? uniqueSlugs(live.boards.map(toBoard)) : []
  const waiting = waitingByBot(waitIndex(boards))   // bot -> its cards that wait for an unfinished parent (src/core/queue.js)
  const agents = (Array.isArray(desks) ? desks : []).map(desk => {
    const mine = []
    const seats = new Map()   // board slug -> { slug, ts: newest card of the agent there, running: a card of theirs runs there }
    for (const b of boards) {
      for (const t of b.tasks) {
        if (t.assignee !== desk.name) continue
        mine.push({ board: b.slug, ...t })
        const seat = seats.get(b.slug) || { slug: b.slug, ts: -1, running: false }
        seat.ts = Math.max(seat.ts, lastTouch(t))
        seat.running = seat.running || t.status === 'running'
        seats.set(b.slug, seat)
      }
    }
    const home = homeBoard([...seats.values()])
    const blocked = mine.filter(t => t.status === 'blocked')
    const running = mine.filter(t => t.status === 'running')
    let state = desk.state
    let silentMs = null
    if (state !== 'working') {
      // the freshest signal among their running cards decides; a running card with no signal at all is silent since it started
      const freshest = running.reduce((m, t) => Math.max(m, t.heartbeatMs || t.startedMs || 0), 0)
      if (running.length && freshest && nowMs - freshest > STALE_AFTER_MS) silentMs = nowMs - freshest
      if (blocked.length) state = 'waiting'
      else if (silentMs) state = 'stale'
    }
    // the cards of theirs that wait for someone else's work: `queued` is a state only for a bot with nothing running or blocked and no live session
    const queued = waiting.get(desk.name) || []
    state = queuedState(state, { running: running.length, blocked: blocked.length, queued: queued.length })
    const quiet = quietCards(runningCards({ running }, nowMs), state)
    return { ...desk, state, silentMs, home, mine, blocked, running, quiet, queued }
  })
  const hall = agents.filter(a => !a.home)
  return { mode: full ? 'full' : 'roster', agents, boards, hall, ops: full ? toOps(live.ops) : null }
}

/** Gateway + cron jobs, whitelisted shape; cron identity = profile + name (names repeat across profiles). */
export function toOps(raw) {
  const g = raw?.gateway
  const gateway = g && typeof g === 'object'
    ? {
        // Hermes writes starting | running | degraded (alive, platforms retrying, crons run) | stopped | startup_failed
        state: str(g.state) || null,
        up: isGatewayUp(g.state),
        down: isGatewayDown(g.state),
        degraded: isGatewayDegraded(g.state),
        platforms: (Array.isArray(g.platforms) ? g.platforms : []).map(p => ({ name: str(p?.name), state: str(p?.state), attention: Boolean(p?.needsAttention) })).filter(p => p.name)
      }
    : null
  const crons = (Array.isArray(raw?.crons) ? raw.crons : []).filter(c => c && str(c.name)).map(c => {
    const status = str(c.last_status).toLowerCase()
    return {
      key: `${str(c.profile) || 'default'}/${c.name}`,
      name: c.name,
      profile: str(c.profile) || 'default',
      enabled: c.enabled !== false && !c.paused_at,
      schedule: str(c.schedule_display),
      lastRunMs: toMs(c.last_run_at),
      nextRunMs: toMs(c.next_run_at),
      failing: c.enabled !== false && ((num(c.failure_streak) || 0) > 0 || (status !== '' && !OK_RUN.has(status)))
    }
  })
  return { gateway, crons }
}

export function summarizeOffice(office) {
  const c = { total: office.agents.length, working: 0, active: 0, waiting: 0, stale: 0, queued: 0, idle: 0, new: 0, unknown: 0 }
  for (const a of office.agents) c[a.state] = (c[a.state] || 0) + 1
  c.blocked = office.boards.reduce((n, b) => n + b.blocked.length, 0)
  c.open = office.boards.reduce((n, b) => n + b.open.length, 0)
  c.cards = office.boards.reduce((n, b) => n + b.total, 0)
  return c
}
