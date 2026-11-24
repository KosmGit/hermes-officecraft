/**
 * Replay: what happened, from the FACTS of `GET /replay`, never from content. Pure: no SDK, no DOM, no clock of
 * its own, so tests/js/replay.test.mjs checks every decision by value under node.
 *
 *   toReplay        the body of /replay, normalised (seconds -> ms, closed lists, nothing unknown kept)
 *   cardsAt         the state of every card of a board at an instant T (the fold: start snapshot + facts <= T)
 *   officeAt        the same /live-shaped read the office is built from, for T -> buildOffice() draws the scene at T
 *   nightWindow     « this night » (default 19 h – 7 h, adjustable), computed on the LOCAL clock, DST and midnight included
 *   nightSummary    the counted summary of a window (cards done, blocks, failures, orders, crons, usage when it exists)
 *   journalOf       the facts of the window as one list (kanban, orders, crons, sessions, silences), each with its source and time
 *   orderAllowed    no order on the past
 *
 * Rule of gold: a number is shown only when it comes from a recorded fact; an absent datum is `null`, never 0.
 */
import { toPartial } from './history.js'
import { buildOffice } from './office.js'
import { count, str } from './util.js'

export const STATUSES = Object.freeze(['todo', 'ready', 'running', 'blocked', 'review', 'triage', 'scheduled', 'done', 'archived'])
const STATUS_SET = new Set(STATUSES)
/** A run with no sign of life for 5 minutes is silent (the server already computed the silences; this is the last sign of life + 5 min). */
export const SILENCE_MS = 300_000
export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000
/**
 * The graduations under the density strip: { ms, at (0..1), label, edge? }. Hours on a window of a day or less (every 2 h up to 14 h long,
 * every 6 h beyond, on the local hour), days from 7 (each local midnight, named by its weekday); the two ends are always there, as `edge`.
 * A graduation too close to an end is dropped, so two labels never overlap. `lang` = the page's, for the names of the days.
 */
export function axisTicks(fromMs, toMs, lang = 'en') {
  const span = toMs - fromMs
  if (!(span > 0)) return []
  const at = ms => (ms - fromMs) / span
  const long = span > 36 * HOUR_MS
  const hh = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hour12: false })
  const dd = new Intl.DateTimeFormat(lang, { weekday: 'short' })
  const edgeLabel = ms => (long ? dd.format(ms) : hh.format(ms))
  const out = [{ ms: fromMs, at: 0, label: edgeLabel(fromMs), edge: true }]
  const step = long ? DAY_MS : span > 14 * HOUR_MS ? 6 * HOUR_MS : 2 * HOUR_MS
  const d = new Date(fromMs)
  d.setMinutes(0, 0, 0)
  if (long) d.setHours(0)
  else d.setHours(Math.ceil(d.getHours() / (step / HOUR_MS)) * (step / HOUR_MS), 0, 0, 0)
  for (let ms = d.getTime(); ms < toMs; ms += step) {
    // DST: a local day is 23 or 25 h, so the next graduation is re-read from the clock rather than added
    const t = long ? new Date(ms).setHours(0, 0, 0, 0) : ms
    if (t <= fromMs || at(t) < 0.08 || at(t) > 0.92) continue
    out.push({ ms: t, at: at(t), label: long ? dd.format(t) : hh.format(t) })
  }
  out.push({ ms: toMs, at: 1, label: edgeLabel(toMs), edge: true })
  return out
}

export const WINDOWS = Object.freeze(['night', '24h', '7d'])
export const DEFAULT_NIGHT = Object.freeze({ from: 19, to: 7 })

const ms = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 1000) : null)
const text = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '')

/* ---------- the body of /replay ---------- */

function toUsage(u) {
  if (!u || typeof u !== 'object') return null
  const tok = u.tokens && typeof u.tokens === 'object' ? u.tokens : {}
  return {
    apiCalls: count(u.apiCalls),
    input: count(tok.input),
    output: count(tok.output),
    cacheRead: count(tok.cacheRead),
    cacheWrite: count(tok.cacheWrite),
    reasoning: count(tok.reasoning)
  }
}

function toBoardReplay(raw) {
  const slug = str(raw?.slug)
  if (!slug) return null
  const cards = {}
  if (raw.cards && typeof raw.cards === 'object') for (const [id, title] of Object.entries(raw.cards)) if (typeof title === 'string') cards[id] = title
  const facts = (Array.isArray(raw.facts) ? raw.facts : [])
    .filter(f => Array.isArray(f) && ms(f[0]) != null && typeof f[1] === 'string' && typeof f[2] === 'string')
    .map(f => ({ ms: ms(f[0]), task: f[1], kind: f[2], to: STATUS_SET.has(f[3]) ? f[3] : null, extra: typeof f[4] === 'string' ? f[4] : null }))
    .sort((a, b) => a.ms - b.ms)   // stable: facts of one second keep the server's order
  const runs = (Array.isArray(raw.runs) ? raw.runs : [])
    .filter(r => r && typeof r === 'object' && ms(r.start) != null && typeof r.task === 'string' && typeof r.profile === 'string' && r.profile)   // no profile = a « Lancer », not an execution
    .map(r => ({
      startMs: ms(r.start), endMs: ms(r.end), profile: typeof r.profile === 'string' ? r.profile : null, task: r.task,
      outcome: typeof r.outcome === 'string' ? r.outcome : null, usage: toUsage(r.usage), why: typeof r.why === 'string' ? r.why : null
    }))
    .sort((a, b) => a.startMs - b.startMs)
  const silences = (Array.isArray(raw.silences) ? raw.silences : [])
    .filter(s => Array.isArray(s) && ms(s[2]) != null && ms(s[3]) != null && typeof s[1] === 'string')
    .map(s => ({ profile: typeof s[0] === 'string' ? s[0] : null, task: s[1], fromMs: ms(s[2]), toMs: ms(s[3]) }))
  const start = (Array.isArray(raw.start) ? raw.start : [])
    .filter(c => Array.isArray(c) && typeof c[0] === 'string' && STATUS_SET.has(c[1]))
    .map(c => ({ id: c[0], status: c[1], assignee: typeof c[2] === 'string' ? c[2] : null }))
  return { slug, sinceMs: ms(raw.since), start, cards, facts, runs, silences }
}

/** `GET /replay` body -> { ok, atMs, fromMs, toMs, boards, orders, sessions, crons, truncatedAt, partial } (ok:false when it is not that). */
export function toReplay(body) {
  if (!body || body.ok !== true || !Array.isArray(body.boards) || ms(body.from) == null || ms(body.to) == null) return { ok: false, boards: [] }
  const orders = (Array.isArray(body.orders) ? body.orders : [])
    .filter(o => Array.isArray(o) && ms(o[0]) != null && typeof o[1] === 'string')
    .map(o => ({
      ms: ms(o[0]), verb: o[1], result: ['done', 'refused', 'failed'].includes(o[2]) ? o[2] : 'failed',
      board: text(o[3]), task: text(o[4]), profile: text(o[5]), choice: text(o[6], 12), source: o[7] === 'page' ? 'page' : 'agent'
    }))
  const sessions = (Array.isArray(body.sessions) ? body.sessions : [])
    .filter(s => Array.isArray(s) && ms(s[2]) != null)
    .map(s => ({ profile: text(s[0]), source: text(s[1], 32), startMs: ms(s[2]), endMs: ms(s[3]) }))
  const crons = (Array.isArray(body.crons) ? body.crons : [])
    .filter(c => Array.isArray(c) && ms(c[2]) != null && typeof c[1] === 'string')
    .map(c => ({ profile: text(c[0]), name: text(c[1]), ms: ms(c[2]), ok: c[3] === 1 || c[3] === true }))
  const cut = body.truncated && typeof body.truncated === 'object' ? ms(body.truncated.at) : null
  return {
    ok: true,
    atMs: ms(body.at),
    fromMs: ms(body.from),
    toMs: ms(body.to),
    boards: body.boards.map(toBoardReplay).filter(Boolean),
    orders: orders.sort((a, b) => a.ms - b.ms),
    sessions: sessions.sort((a, b) => a.startMs - b.startMs),
    crons: crons.sort((a, b) => a.ms - b.ms),
    truncatedAt: cut,
    partial: toPartial(body.partial) ?? []
  }
}

/* ---------- the fold: the state of the cards at T ---------- */

/** The profile of the latest run of a card that started at or before T (the card's assignee when no fact says it: `created` carries it). */
function runnerOf(board, task, atMs) {
  let who = null
  for (const r of board.runs) {
    if (r.startMs > atMs) break
    if (r.task === task && r.profile) who = r.profile
  }
  return who
}

/**
 * Every card of a board at T: [{ id, title, status, assignee, createdMs, startedMs, completedMs, blockedMs }], from the cards open when the
 * window started (`start`) and the facts up to T. A card created and archived within the window is there between the two; one that does
 * not exist yet at T is not. The titles are the CURRENT ones (Hermes keeps no history of titles). Archived cards are not listed (like /live).
 */
export function cardsAt(board, atMs) {
  const cards = new Map()
  for (const c of board.start) cards.set(c.id, { id: c.id, status: c.status, assignee: c.assignee, createdMs: null, startedMs: null, completedMs: null, blockedMs: null })
  for (const f of board.facts) {
    if (f.ms > atMs) break
    let c = cards.get(f.task)
    if (!c) { c = { id: f.task, status: null, assignee: null, createdMs: null, startedMs: null, completedMs: null, blockedMs: null }; cards.set(f.task, c) }
    if (f.to) c.status = f.to
    switch (f.kind) {
      case 'created': c.createdMs = f.ms; c.status = c.status ?? 'todo'; if (f.extra) c.assignee = f.extra; break
      case 'assigned': c.assignee = f.extra; break
      case 'claimed': c.startedMs = f.ms; break
      case 'completed': c.completedMs = f.ms; break
      case 'blocked': c.blockedMs = f.ms; break
      case 'unblocked': c.blockedMs = null; break
      default: break
    }
  }
  const out = []
  for (const c of cards.values()) {
    if (!c.status || c.status === 'archived') continue
    out.push({ ...c, title: Object.hasOwn(board.cards, c.id) ? board.cards[c.id] : c.id, assignee: c.assignee ?? runnerOf(board, c.id, atMs) })
  }
  return out
}

/** The runs open at T: started at or before T, not ended yet (or ended after T). */
export function openRunsAt(board, atMs) {
  return board.runs.filter(r => r.startMs <= atMs && (r.endMs == null || r.endMs > atMs))
}

/** The silences that cover T. */
const silentAt = (board, atMs) => board.silences.filter(s => s.fromMs <= atMs && atMs < s.toMs)

/**
 * The /live-shaped read of the boards at T (seconds, like Hermes writes them), so that buildOffice() and everything after it
 * (scene, tags, counts) is the same code for the present and for the past. A board that did not exist yet at T is absent.
 */
export function liveAt(replay, atMs) {
  const boards = []
  const working = new Set()
  const silent = new Set()
  for (const b of replay.boards) {
    if (b.sinceMs != null && b.sinceMs > atMs) continue
    const open = openRunsAt(b, atMs)
    const quiet = silentAt(b, atMs)
    const tasks = cardsAt(b, atMs).map(c => {
      const run = c.status === 'running' ? open.find(r => r.task === c.id) : null
      const hush = run ? quiet.find(s => s.task === c.id) : null
      return {
        id: c.id, title: c.title, status: c.status, assignee: c.assignee,
        createdAt: c.createdMs ? c.createdMs / 1000 : null,
        startedAt: (run?.startMs ?? c.startedMs) ? (run?.startMs ?? c.startedMs) / 1000 : null,
        completedAt: c.completedMs ? c.completedMs / 1000 : null,
        // a silent run's last sign of life: its silence began 5 min after it (a hair more, so that « more than 5 min » holds at the first second).
        // an open run in no silence of /replay gave a sign within the last 5 min: alive at T (without it, the silent-card mark
        // would fall back on the start and call every replayed card older than 5 min silent)
        heartbeatAt: hush ? (hush.fromMs - SILENCE_MS - 1000) / 1000 : run ? atMs / 1000 : null
      }
    })
    for (const r of open) {
      if (!r.profile) continue
      if (silentAt(b, atMs).some(s => s.task === r.task && s.profile === r.profile)) silent.add(r.profile)
      else working.add(r.profile)
    }
    boards.push({ slug: b.slug, createdAt: b.sinceMs ? b.sinceMs / 1000 : null, tasks })
  }
  return { live: { ok: true, boards }, working, silent }
}

/**
 * The office at T: the current desks (names, outfits, sessions of the roster) put in the state the facts say, through the same
 * buildOffice as the present. At work = a run is open for the profile and not silent; waiting = a card of theirs is blocked; silent = an
 * open run with no sign for 5 min; every other state the facts cannot tell (« active » = a human session, never dated) is « idle ».
 * An agent deleted since is not a desk any more: it stays in the journal, not in the scene.
 */
export function officeAt(desks, replay, atMs) {
  const { live, working } = liveAt(replay, atMs)
  const at = (Array.isArray(desks) ? desks : []).map(d => ({
    ...d,
    state: working.has(d.name) ? 'working' : d.state === 'new' || d.state === 'unknown' ? d.state : 'idle',
    lastActivityMs: null   // « last seen N min ago » is about now, not about T
  }))
  return buildOffice(at, live, atMs)
}

/* ---------- the clock ---------- */

/** Minutes east of UTC at an instant on this machine (the page's default; tests inject their own, DST included). */
export const localOffset = atMs => -new Date(atMs).getTimezoneOffset()

const parts = (atMs, off) => {
  const d = new Date(atMs + off(atMs) * 60_000)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }
}
/** The instant of a local wall-clock time (day overflow allowed: day 0 = the last day of the month before). Two passes: the offset of the target itself. */
export function localEpoch(y, m, d, h, off) {
  const naive = Date.UTC(y, m, d, h)
  return naive - off(naive - off(naive) * 60_000) * 60_000
}

/**
 * A night setting kept per machine: whole hours 0-23; anything else is the default 19 h – 7 h. The same hour twice
 * (0 -> 0, 7 -> 7) is a deliberate setting: a night of 24 h, from that hour to the same hour the next day (never thrown
 * back to the default: the selectors show the choice).
 */
export function normalizeNight(v) {
  const ok = h => Number.isInteger(h) && h >= 0 && h <= 23
  return v && ok(v.from) && ok(v.to) ? { from: v.from, to: v.to } : { ...DEFAULT_NIGHT }
}

/**
 * « This night »: the latest night that has begun, from its start to its end (or to now while it lasts). A window that passes midnight
 * (19 -> 7) ends the next local day; one that does not (1 -> 5) ends the same day. On the local clock, so a DST change shortens or
 * lengthens it (a 19 h – 7 h night is 11 h or 13 h long on the days the clocks change).
 * -> { from, to, end, ongoing } in ms. `to` is what /replay is asked for (never in the future).
 */
export function nightWindow(nowMs, night = DEFAULT_NIGHT, off = localOffset) {
  const { from: h0, to: h1 } = normalizeNight(night)
  const { y, m, d } = parts(nowMs, off)
  const spans = h1 <= h0 ? 1 : 0
  for (let back = 0; back <= 2; back += 1) {
    const from = localEpoch(y, m, d - back, h0, off)
    if (from > nowMs) continue
    const end = localEpoch(y, m, d - back + spans, h1, off)
    return { from, to: Math.min(end, nowMs), end, ongoing: nowMs < end }
  }
  return null
}

/** The window the page asks /replay for, from a kind: the night, the last 24 h or the last 7 days (never more: the route refuses). */
export function windowFor(kind, nowMs, night = DEFAULT_NIGHT, off = localOffset) {
  if (kind === '7d') return { kind, from: nowMs - 7 * DAY_MS + 1000, to: nowMs, ongoing: true }
  if (kind === '24h') return { kind, from: nowMs - DAY_MS, to: nowMs, ongoing: true }
  const n = nightWindow(nowMs, night, off)
  return { kind: 'night', from: n.from, to: n.to, ongoing: n.ongoing }
}

/** « 03:12 » (24 h, 2 digits) in the page's language; with `day`, the weekday and the day of the month in front (« ven. 13 03:12 »). `tz` only for tests. */
export function clockLabel(atMs, lang, { day = false, tz } = {}) {
  try {
    const time = formatter(lang, tz, 'time').format(new Date(atMs))
    return day ? `${formatter(lang, tz, 'day').format(new Date(atMs))} ${time}` : time
  } catch {
    return new Date(atMs).toISOString().slice(11, 16)
  }
}

// An Intl.DateTimeFormat costs ~0.3 ms to build: the journal asks for 120 labels per render while the cursor is dragged (measured: 12 % of the
// time of a drag), so each one is built once per language and zone.
const FORMATTERS = new Map()
function formatter(lang, tz, kind) {
  const key = `${lang}|${tz ?? ''}|${kind}`
  let f = FORMATTERS.get(key)
  if (!f) {
    const zone = tz ? { timeZone: tz } : {}
    // the day of the month with the weekday: a 7-day window starts and ends on the same weekday (« ven. 08:31 → ven. 08:31 »)
    f = new Intl.DateTimeFormat(lang, kind === 'time' ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...zone } : { weekday: 'short', day: 'numeric', ...zone })
    FORMATTERS.set(key, f)
  }
  return f
}

/* ---------- the counted summary: « what happened this night » ---------- */

export const FAIL_KINDS = Object.freeze(['timed_out', 'crashed', 'spawn_failed', 'gave_up'])
const FAIL_SET = new Set(FAIL_KINDS)
/** A card that waits for a human: `blocked` of any kind but `dependency` (that one only waits for another card, and goes back to `todo`). */
export const isBlock = f => f.kind === 'blocked' && f.extra !== 'dependency'

const within = (t, from, to) => t >= from && t <= to

/**
 * The crons tile of the night card. The big number is what its label says: the failures under « failed » (red, like the other
 * failure tiles) with the total as detail, else the runs under « ran ». (Never the total under « failed »: « 23 failed · 3 / 23 ».)
 */
export function cronsTile(crons) {
  const failed = crons?.failed || 0
  const total = (crons?.ok || 0) + failed
  return failed ? { n: failed, label: 'replay.night.cronsFailed', total, tone: 'fail' } : { n: total, label: 'replay.night.cronsOk', total: null, tone: '' }
}

/**
 * The counted summary of [from, to]: only counts of recorded facts. Usage (calls, tokens) is summed over the runs STARTED in the window
 * that have a recorded usage; the runs that have none are counted apart (`runsWithout`), never as zero. -> numbers and lists, no text.
 */
export function nightSummary(replay, win) {
  const { from, to } = win
  const s = {
    from, to, ongoing: Boolean(win.ongoing),
    runs: 0, done: 0, blocked: 0, loops: 0, unblocked: 0, failures: 0, silences: 0,
    orders: { total: 0, done: 0, refused: 0, failed: 0 },
    crons: { ok: 0, failed: 0 },
    usage: { calls: 0, input: 0, output: 0, runsWith: 0, runsWithout: 0 },
    byProfile: [], buckets: [], boards: [], since: [], truncatedAt: replay.truncatedAt ?? null, empty: true
  }
  const by = new Map()
  const prof = name => {
    const key = name || ''
    if (!by.has(key)) by.set(key, { profile: name || null, runs: 0, calls: null, input: null, output: null })
    return by.get(key)
  }
  const n = Math.max(1, Math.min(48, Math.ceil((to - from) / HOUR_MS)))
  const size = Math.max(1, (to - from) / n)
  s.buckets = Array.from({ length: n }, (_, i) => ({ from: from + i * size, done: 0, blocked: 0, failures: 0 }))
  const bucket = t => s.buckets[Math.min(n - 1, Math.max(0, Math.floor((t - from) / size)))]
  for (const b of replay.boards) {
    if (b.sinceMs != null && b.sinceMs > from) s.since.push({ slug: b.slug, sinceMs: b.sinceMs })
    for (const f of b.facts) {
      if (!within(f.ms, from, to)) continue
      if (f.kind === 'completed') { s.done += 1; bucket(f.ms).done += 1 }
      else if (isBlock(f)) { s.blocked += 1; bucket(f.ms).blocked += 1 }
      else if (f.kind === 'block_loop_detected') s.loops += 1
      else if (f.kind === 'unblocked') s.unblocked += 1
      else if (FAIL_SET.has(f.kind)) { s.failures += 1; bucket(f.ms).failures += 1 }
    }
    for (const r of b.runs) {
      if (!within(r.startMs, from, to)) continue
      s.runs += 1
      const p = prof(r.profile)
      p.runs += 1
      if (r.usage && r.usage.apiCalls != null) {
        s.usage.runsWith += 1
        s.usage.calls += r.usage.apiCalls
        s.usage.input += r.usage.input ?? 0
        s.usage.output += r.usage.output ?? 0
        p.calls = (p.calls ?? 0) + r.usage.apiCalls
        p.input = (p.input ?? 0) + (r.usage.input ?? 0)
        p.output = (p.output ?? 0) + (r.usage.output ?? 0)
      } else s.usage.runsWithout += 1
    }
    s.silences += b.silences.filter(x => x.fromMs <= to && x.toMs >= from).length
    s.boards.push(b.slug)
  }
  for (const o of replay.orders) if (within(o.ms, from, to)) { s.orders.total += 1; s.orders[o.result] += 1 }
  for (const c of replay.crons) if (within(c.ms, from, to)) s.crons[c.ok ? 'ok' : 'failed'] += 1
  if (!s.usage.runsWith) { s.usage.calls = null; s.usage.input = null; s.usage.output = null }   // nothing recorded: absent, not 0
  s.byProfile = [...by.values()].sort((a, b) => b.runs - a.runs || String(a.profile).localeCompare(String(b.profile), 'en'))
  s.empty = !(s.runs || s.done || s.blocked || s.loops || s.unblocked || s.failures || s.silences || s.orders.total || s.crons.ok || s.crons.failed)
  return s
}

/* ---------- the journal of the facts ---------- */

/** What a kind belongs to: the filters of the journal and the numbers of the summary share these groups. */
export function groupOf(kind) {
  switch (kind) {
    case 'claimed': return 'start'
    case 'completed': return 'done'
    case 'blocked': case 'block_loop_detected': return 'block'
    case 'unblocked': return 'unblock'
    case 'timed_out': case 'crashed': case 'spawn_failed': case 'gave_up': case 'stale': return 'fail'
    case 'rate_limited': case 'reclaimed': return 'retry'
    case 'review_requested': case 'changes_requested': case 'review_reopened': return 'review'
    case 'order': case 'cron': case 'session': case 'silence': return kind
    default: return 'card'
  }
}
/** The kinds of card facts the route serves (a closed list: the page has a sentence for each, i18n `replay.fact.*`). */
export const FACT_KINDS = Object.freeze([
  'created', 'assigned', 'claimed', 'completed', 'blocked', 'block_loop_detected', 'gave_up', 'unblocked', 'promoted', 'promoted_manual',
  'dependency_wait', 'specified', 'status', 'scheduled', 'review_requested', 'changes_requested', 'review_reopened', 'archived', 'timed_out',
  'crashed', 'rate_limited', 'reclaimed', 'spawn_failed', 'stale', 'reconciled', 'decomposed', 'claim_rejected', 'commented', 'linked', 'unlinked'
])
export const GROUPS = Object.freeze(['start', 'done', 'block', 'unblock', 'fail', 'retry', 'review', 'order', 'cron', 'session', 'silence', 'card'])
/** Facts that are bookkeeping rather than events (a card promoted, linked, commented, assigned…): listed only on request. */
const MINOR = new Set(['card', 'session'])

/**
 * Every fact of the window as one list, oldest first. An entry: { ms, kind, group, source, board, task, title, profile, to, extra, result }
 * with `source` = where Hermes recorded it: `kanban` (+ board), `orders` (audit journal), `cron`, `session`, `silence` (computed from the
 * heartbeats of the board). The agent of a card fact is the card's assignee at that moment. Never the content: the whitelist of the route.
 */
export function journalOf(replay) {
  const out = []
  for (const b of replay.boards) {
    const who = new Map(b.start.map(c => [c.id, c.assignee]))
    for (const f of b.facts) {
      if (f.kind === 'assigned' || (f.kind === 'created' && f.extra)) who.set(f.task, f.extra)
      out.push({
        // a block that only waits for another card (`dependency`) is bookkeeping, not « a card that waits for you »: same rule as the summary
        ms: f.ms, kind: f.kind, group: f.kind === 'blocked' && !isBlock(f) ? 'card' : groupOf(f.kind), source: 'kanban', board: b.slug, task: f.task,
        title: Object.hasOwn(b.cards, f.task) ? b.cards[f.task] : null,
        profile: who.get(f.task) ?? runnerOf(b, f.task, f.ms) ?? null, to: f.to, extra: f.extra, result: null
      })
    }
    for (const s of b.silences) {
      out.push({ ms: s.fromMs, kind: 'silence', group: 'silence', source: 'silence', board: b.slug, task: s.task, title: Object.hasOwn(b.cards, s.task) ? b.cards[s.task] : null, profile: s.profile, to: null, extra: String(Math.round((s.toMs - s.fromMs) / 60_000)), result: null })
    }
  }
  for (const o of replay.orders) out.push({ ms: o.ms, kind: o.verb, group: 'order', source: 'orders', board: o.board || null, task: o.task || null, title: null, profile: o.profile || null, to: null, extra: o.choice || null, result: o.result })
  for (const c of replay.crons) out.push({ ms: c.ms, kind: 'cron', group: 'cron', source: 'cron', board: null, task: null, title: c.name, profile: c.profile || null, to: null, extra: null, result: c.ok ? 'done' : 'failed' })
  for (const s of replay.sessions) out.push({ ms: s.startMs, kind: 'session', group: 'session', source: 'session', board: null, task: null, title: null, profile: s.profile || null, to: null, extra: s.source || null, result: null })
  return out.sort((a, b) => a.ms - b.ms)
}

/** The boards and the agents that appear in the journal (for the two filters), sorted. */
export function journalFacets(entries) {
  const boards = new Set()
  const agents = new Set()
  for (const e of entries) { if (e.board) boards.add(e.board); if (e.profile) agents.add(e.profile) }
  const sort = set => [...set].sort((a, b) => a.localeCompare(b, 'en'))
  return { boards: sort(boards), agents: sort(agents) }
}

/** filter = { board, agent, group, all }: `all` = also the bookkeeping groups; a `group` asked for is shown even if it is one. A board filter drops what has no board (crons, sessions). */
export function filterJournal(entries, filter = {}) {
  const { board = null, agent = null, group = null, all = false } = filter
  return entries.filter(e => {
    if (board && e.board !== board) return false
    if (agent && e.profile !== agent) return false
    if (group) return e.group === group
    return all || !MINOR.has(e.group)
  })
}

/**
 * What the journal shows at cursor T: newest first, the facts after T dimmed at the top of the slice. `max` rows around T (a 7-day
 * journal has thousands of facts: the list never renders more than this).
 * -> { rows: [{ ...entry, future }], olderHidden, newerHidden }
 */
export function journalView(entries, atMs, max = 120, lead = 12) {
  const desc = [...entries].reverse()   // newest first
  let first = desc.findIndex(e => e.ms <= atMs)   // the newest fact not after T
  if (first < 0) first = desc.length
  const begin = Math.max(0, first - lead)
  const rows = desc.slice(begin, begin + max).map(e => ({ ...e, future: e.ms > atMs }))
  return { rows, newerHidden: begin, olderHidden: Math.max(0, desc.length - begin - rows.length) }
}

/* ---------- the cursor ---------- */

export const clampCursor = (atMs, replay) => (replay?.ok ? Math.min(replay.toMs, Math.max(replay.fromMs, Math.round(atMs))) : atMs)

/** The instant of the previous / next fact (kanban facts and orders; not the bookkeeping) around T, or null at the edge. */
export function stepFact(entries, atMs, dir) {
  const real = entries.filter(e => !MINOR.has(e.group))
  if (dir > 0) { const next = real.find(e => e.ms > atMs); return next ? next.ms : null }
  for (let i = real.length - 1; i >= 0; i -= 1) if (real[i].ms < atMs) return real[i].ms
  return null
}

/** The cursor's keys beyond the arrows of the range input: Shift = 10 min, PageUp / PageDown = 1 h, Home / End = the ends. -> the new T, or null (the input does the rest). */
export function cursorKey(key, shift, atMs, replay) {
  const step = key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : key === 'ArrowRight' || key === 'ArrowUp' ? 1 : 0
  if (step && shift) return clampCursor(atMs + step * 10 * 60_000, replay)
  if (key === 'PageUp' || key === 'PageDown') return clampCursor(atMs + (key === 'PageUp' ? 1 : -1) * HOUR_MS, replay)
  if (key === 'Home') return replay.fromMs
  if (key === 'End') return replay.toMs
  return null
}

/** The thin strip under the slider: how many facts fall in each of `n` slices of the window (done / blocked / failures drawn apart). */
export function density(entries, fromMs, toMs, n = 96) {
  const size = Math.max(1, (toMs - fromMs) / n)
  const bins = Array.from({ length: n }, () => ({ all: 0, done: 0, block: 0, fail: 0 }))
  for (const e of entries) {
    if (MINOR.has(e.group) || e.ms < fromMs || e.ms > toMs) continue
    const b = bins[Math.min(n - 1, Math.floor((e.ms - fromMs) / size))]
    b.all += 1
    if (e.group === 'done') b.done += 1
    else if (e.group === 'block') b.block += 1
    else if (e.group === 'fail') b.fail += 1
  }
  return bins
}

/* ---------- what the replay forbids and what it stops ---------- */

/** No order on the past: nothing is asked of Hermes while the office shows another moment. */
export const orderAllowed = replayOn => !replayOn

/**
 * Escape leaves the replay, unless something nearer is open (a dialog, the settings, the narrow drawer: Escape closes those first),
 * or another handler already took the key.
 */
export const replayKeyExits = ({ key, dialogOpen = false, drawerOpen = false, narrow = false, defaultPrevented = false }) =>
  key === 'Escape' && !defaultPrevented && !dialogOpen && !(narrow && drawerOpen)

/**
 * Does the replay still need the network? A window that ended in the past never changes. A window that ends now gains facts, but they only
 * matter when the cursor sits on the live edge (within 2 min of the end): anywhere else the next minute's read would change nothing the
 * person looks at. The page's own reads (/live, roster, /history, the order journal) are not needed at all while a past moment is shown.
 */
export const replayPollNeeded = ({ ongoing, cursorMs, toMs }) => Boolean(ongoing) && cursorMs >= toMs - 2 * 60_000

/** Whether the page keeps polling its own reads: only when it shows the present. */
export const livePollMs = (replayOn, ms) => (replayOn ? false : ms)
