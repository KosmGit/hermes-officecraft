/**
 * Notification settings: the shape the agent half serves (`GET /notify`) and the body it accepts (`POST /notify`),
 * the recipients of each type, the quiet hours, the preview of the message and the states of the test button.
 * The settings live on the SERVER (read by the gateway with no page open); the page only edits them. Pure: no SDK, no DOM.
 */
import { formatMessage, previewStyle } from './notifyFormat.js'
import { QUIET_SYMBOL, SYMBOLS } from './notifyWords.js'

/** The eight kinds of facts, in display order (same ids as hermes_officecraft/notify.py TYPES). */
export const NOTIFY_TYPES = Object.freeze(['decision', 'silent', 'gateway', 'cron', 'campaign', 'review', 'llm_cap', 'trophy'])
/** The four first types: the only ones an old server (and an old saved board) knows. */
export const LEGACY_TYPES = Object.freeze(NOTIFY_TYPES.slice(0, 4))
export const MAX_ROUTES = 4
export const DEFAULT_QUIET = Object.freeze({ enabled: false, from: '22:00', to: '07:00', urgent: Object.freeze([]) })
export const TEST_WAIT_S = 60

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const clockOr = (value, dflt) => (typeof value === 'string' && CLOCK.test(value) ? value : dflt)
const uniq = list => [...new Set(list)]

/**
 * What the server answered, normalised: every type present (OFF unless the server said `true`), the recipients of each type among the
 * ones Hermes lists, the quiet hours. An older server (a single `target`, no `routes`, no `quiet`) is read the way the agent half
 * migrates it: its recipient goes to every type that is on (to the four historic ones when none is), nothing is lost on screen.
 */
export function toNotify(body) {
  if (!body || body.ok !== true || !body.settings) return null
  const s = body.settings
  const on = s.types || {}
  const targets = Array.isArray(body.targets)
    ? body.targets.filter(t => t && typeof t.key === 'string').map(t => ({ key: t.key, platform: String(t.platform ?? ''), label: String(t.label ?? ''), source: String(t.source ?? '') }))
    : []
  const known = new Set(targets.map(t => t.key))
  const max = Number.isInteger(body.maxRoutes) && body.maxRoutes > 0 ? body.maxRoutes : MAX_ROUTES
  const types = Object.fromEntries(NOTIFY_TYPES.map(type => [type, on[type] === true]))
  let routes
  if (s.routes && typeof s.routes === 'object') {
    routes = Object.fromEntries(NOTIFY_TYPES.map(type => [type, Array.isArray(s.routes[type]) ? uniq(s.routes[type].filter(k => known.has(k))).slice(0, max) : []]))
  } else {
    const legacy = known.has(s.target) ? [s.target] : []
    const anyOn = LEGACY_TYPES.some(type => types[type])
    routes = Object.fromEntries(NOTIFY_TYPES.map(type => [type, legacy.length && LEGACY_TYPES.includes(type) && (types[type] || !anyOn) ? legacy : []]))
  }
  const q = s.quiet && typeof s.quiet === 'object' ? s.quiet : {}
  const quiet = {
    enabled: q.enabled === true,
    from: clockOr(q.from, DEFAULT_QUIET.from),
    to: clockOr(q.to, DEFAULT_QUIET.to),
    urgent: uniq(Array.isArray(q.urgent) ? q.urgent.filter(type => NOTIFY_TYPES.includes(type)) : [])
  }
  const last = body.last && typeof body.last === 'object' ? { success: body.last.success === true, count: Number(body.last.count) || 0, at: Number(body.last.at) || 0 } : null
  const lastBy = {}
  for (const [key, v] of Object.entries(body.lastBy && typeof body.lastBy === 'object' ? body.lastBy : {})) {
    if (known.has(key) && v && typeof v === 'object') lastBy[key] = { success: v.success === true, count: Number(v.count) || 0, at: Number(v.at) || 0 }
  }
  const tz = body.timezone && typeof body.timezone === 'object' ? body.timezone : null
  return {
    types,
    routes,
    quiet,
    targets,
    max,
    cap: Number(body.hourlyCap) || 0,
    last,
    lastBy,
    timezone: tz && typeof tz.name === 'string' ? { name: tz.name, offset: String(tz.offset ?? '') } : null,
    modern: Boolean(s.routes)
  }
}

/** The body to POST after one change: the whole board (the server replaces it) and the page language for the messages. */
export function changeBody(current, change, lang) {
  const types = { ...current.types, ...(change.types || {}) }
  const routes = { ...current.routes, ...(change.routes || {}) }
  const quiet = { ...current.quiet, ...(change.quiet || {}) }
  return {
    types: Object.fromEntries(NOTIFY_TYPES.map(type => [type, types[type] === true])),
    routes: Object.fromEntries(NOTIFY_TYPES.map(type => [type, uniq(routes[type] || []).slice(0, current.max || MAX_ROUTES)])),
    quiet: { enabled: quiet.enabled === true, from: clockOr(quiet.from, DEFAULT_QUIET.from), to: clockOr(quiet.to, DEFAULT_QUIET.to), urgent: uniq(quiet.urgent || []).filter(type => NOTIFY_TYPES.includes(type)) },
    lang: ['en', 'fr', 'es'].includes(lang) ? lang : 'en'
  }
}

/** The recipients of one type after a click on one recipient: added (while there is room) or removed. */
export function toggleRoute(current, type, key) {
  const list = current.routes[type] || []
  if (list.includes(key)) return list.filter(k => k !== key)
  return list.length >= (current.max || MAX_ROUTES) ? list : [...list, key]
}

/** « The same recipient for everything »: every type gets this one recipient (none = every type emptied). */
export const sameForAll = key => Object.fromEntries(NOTIFY_TYPES.map(type => [type, key ? [key] : []]))

/** The recipient every type has, alone, when it is the same one; otherwise null (the shortcut's select shows its blank). */
export function sharedRoute(state) {
  const first = state.routes[NOTIFY_TYPES[0]]
  if (first.length !== 1) return null
  return NOTIFY_TYPES.every(type => state.routes[type].length === 1 && state.routes[type][0] === first[0]) ? first[0] : null
}

/** The types that are on while nothing can be sent for them (no recipient): the form says so instead of letting them look active. */
export const typesWithoutRoute = state => (state ? NOTIFY_TYPES.filter(type => state.types[type] && state.routes[type].length === 0) : [])
export const needsTarget = state => typesWithoutRoute(state).length > 0

// ------------------------------------------------------------------ quiet hours
export const clockOfHour = h => `${String(h).padStart(2, '0')}:00`
/** The choices of an hour selector: the 24 hours, plus the value itself when it is not on the hour (set elsewhere: it is kept, never rewritten). */
export const hourChoices = value => {
  const all = Array.from({ length: 24 }, (_, h) => clockOfHour(h))
  return CLOCK.test(value) && !all.includes(value) ? [...all, value].sort() : all
}
const minutesOf = clock => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3))

/** From = to is an empty range (no effect), the same rule as the replay's night; a range may pass midnight. */
export const quietEmpty = quiet => quiet.from === quiet.to

/** Is this minute of the day (0 to 1439, the SERVER's clock) inside the quiet hours? [from, to[ ; `22:00 → 07:00` passes midnight. */
export function inQuiet(quiet, minute) {
  if (!quiet.enabled || quietEmpty(quiet)) return false
  const a = minutesOf(quiet.from)
  const b = minutesOf(quiet.to)
  return a < b ? minute >= a && minute < b : minute >= a || minute < b
}

/** Does the range pass midnight (22:00 → 07:00)? */
export const passesMidnight = quiet => !quietEmpty(quiet) && minutesOf(quiet.from) > minutesOf(quiet.to)

/** What the quiet-hours sentence needs: null when the quiet hours do nothing, otherwise the two ends and the types that still pass. */
export function quietSentence(quiet) {
  if (!quiet.enabled || quietEmpty(quiet)) return null
  return { from: quiet.from, to: quiet.to, urgent: NOTIFY_TYPES.filter(type => quiet.urgent.includes(type)) }
}

// ------------------------------------------------------------------ preview
/** Sample facts of one type, the card codes and the project saying « demo »: nothing real, the shape of a real fact (see sample_facts in notify.py). */
export function sampleFact(type, words, nowSec) {
  const at = (h, m) => new Date(2026, 0, 1, h, m).getTime() / 1000
  const code = n => `${words.mark}-${n}`
  switch (type) {
    case 'decision': return { state: 'blocked', board: words.board, title: `${code(1)} — ${words.decision}`, agent: 'backend', since: nowSec - 12 * 60 }
    case 'silent': return { state: 'silent', board: words.board, title: `${code(2)} — ${words.silent}`, agent: 'frontend', since: nowSec - 7 * 60 }
    case 'gateway': return { state: 'stopped', start: at(2, 10), end: at(2, 48) }
    case 'cron': return { state: 'cron_failed', title: words.cron, agent: 'default', since: nowSec - 3 * 60 }
    case 'campaign': return { state: 'camp_ready', board: words.board, name: words.campaign, count: 5, phase: 0 }
    case 'review': return { state: 'review_changes', board: words.board, title: `${code(3)} — ${words.review}`, agent: 'reviewer', since: nowSec - 4 * 60 }
    case 'llm_cap': return { state: 'llm_90', kind: 'usd', pct: 90, used: 4.5, cap: 5 }
    default: return { state: 'trophy', name: words.trophy, tier: 'bronze' }
  }
}

/**
 * The message as it will go, for the types that are on, in the page language (`platform` = the one of the first recipient: the bold
 * of a message is drawn where the platform has one). `text` is the message with \u0001 … \u0002 around what is bold, `quietText` the
 * summary of the end of the quiet hours when they are on. Null when no type is on.
 */
export function previewOf(state, lang, words, platform = null, nowSec = 1_800_000_000) {
  const on = NOTIFY_TYPES.filter(type => state.types[type])
  if (!on.length) return null
  const facts = on.map(type => sampleFact(type, words, nowSec))
  const style = previewStyle(platform)
  const text = formatMessage(facts, lang, { style, now: nowSec })
  const q = quietSentence(state.quiet)
  const quietText = q ? formatMessage(facts, lang, { style, now: nowSec, quiet: { from: q.from, to: q.to, resolved: 1 } }) : null
  return { text, quietText, count: facts.length }
}

const GLYPHS = new Map([...Object.entries(SYMBOLS).map(([type, symbol]) => [symbol, type]), [QUIET_SYMBOL, 'quiet']])
const GLYPH_RE = new RegExp(`(${[...GLYPHS.keys()].join('|')})`, 'u')

/**
 * Split a preview text into pieces `[text, bold, glyph]`: the bold parts are the ones between \u0001 and \u0002; a symbol of the message
 * (one per type, an emoji in the real message) is a piece of its own whose `glyph` names the type (the page draws a line icon for it:
 * no emoji in the interface, and no missing glyph on a machine without an emoji font). The texts put end to end give the message.
 */
export function previewPieces(text) {
  const raw = []
  for (const [i, part] of String(text).split('\u0001').entries()) {
    if (i === 0) { if (part) raw.push([part, false]); continue }
    const [bold, ...rest] = part.split('\u0002')
    raw.push([bold, true])
    if (rest.join('\u0002')) raw.push([rest.join('\u0002'), false])
  }
  return raw.flatMap(([piece, bold]) => piece.split(GLYPH_RE).filter(Boolean).map(chunk => [chunk, bold, GLYPHS.get(chunk) ?? null]))
}

/** The platform whose bold the preview draws: the one of the first recipient of the first type that is on and routed. */
export function previewPlatform(state) {
  for (const type of NOTIFY_TYPES) {
    if (!state.types[type]) continue
    const target = state.targets.find(t => t.key === state.routes[type][0])
    if (target) return target.platform
  }
  return state.targets[0]?.platform ?? null
}

// ------------------------------------------------------------------ the test button
/** What a failed call says, whichever way the host's REST door reports it: a `status` / `body`, or `Error("<status>: <body>")`. */
export function readTestError(error) {
  const message = String(error?.message ?? '')
  const status = Number(error?.status ?? (message.match(/^(\d{3})\b/) || [])[1]) || null
  let body = error?.body && typeof error.body === 'object' ? error.body : null
  if (!body) {
    try { const parsed = JSON.parse(message.replace(/^\d{3}\s*:?\s*/, '')); if (parsed && typeof parsed === 'object') body = parsed } catch { /* not JSON */ }
  }
  const code = body && (typeof body.error === 'string' ? body.error : typeof body.reason === 'string' ? body.reason : null)
  const retry = body && body.retryAfter != null && Number.isFinite(Number(body.retryAfter)) ? Math.max(0, Math.ceil(Number(body.retryAfter))) : null
  return { status, reason: code, retryAfter: retry }
}

/** The reasons the page words; any other one is said as a plain failure. */
export const TEST_REASONS = Object.freeze(['unknown_target', 'platform_not_connected', 'send_failed', 'rate_limited', 'daily_limit', 'notify_unavailable'])

/**
 * The state of one recipient's button after the call: `sent` (at), `wait` (until: a minute between two tests), or `error` (a reason from
 * TEST_REASONS, or `failed`). The day's limit is an error that says its own number; the 1-a-minute one is a wait.
 */
export function testState(answer, nowMs) {
  if (answer?.ok === true) return { kind: 'sent', at: nowMs }
  const reason = TEST_REASONS.includes(answer?.reason) ? answer.reason : 'failed'
  if (reason === 'rate_limited') return { kind: 'wait', until: nowMs + (Number.isFinite(answer.retryAfter) && answer.retryAfter > 0 ? answer.retryAfter : TEST_WAIT_S) * 1000 }
  return { kind: 'error', reason }
}

/** The minute between two tests, counted from a test that reached the sender (the server counts one a minute for ALL recipients). */
export const cooldownUntil = nowMs => nowMs + TEST_WAIT_S * 1000

/**
 * What a button and the line under it show: `busy` (a call is out), `disabled`, and the line (`sent` + time, `wait` + seconds, or the
 * error's reason). The minute between two tests disables every button, whichever recipient was tried.
 */
export function testView(state, nowMs, coolUntil = 0) {
  if (state?.kind === 'sending') return { busy: true, disabled: true, line: null }
  const wait = Math.max(state?.kind === 'wait' ? state.until : 0, coolUntil) - nowMs
  const waiting = wait > 0
  if (state?.kind === 'sent') return { busy: false, disabled: waiting, line: { key: 'sent', at: state.at } }
  if (state?.kind === 'wait') return { busy: false, disabled: waiting, line: waiting ? { key: 'wait', seconds: Math.ceil(wait / 1000) } : null }
  if (state?.kind === 'error') return { busy: false, disabled: waiting, line: { key: state.reason } }
  return { busy: false, disabled: waiting, line: null }
}

// ------------------------------------------------------------------ trophies
const TROPHY_ID = /^[a-z0-9_]{1,40}$/

/**
 * The trophies the page tells the agent half about: only the ones it has just SEEN unlock (« new »). The first launch and a grouped
 * update (many at once) are a collection, not news: the server would take them for the first sync, so nothing is sent for them.
 */
export function trophyPayload(announcement, game, nameOf) {
  if (announcement?.kind !== 'new') return []
  const by = new Map((game?.achievements || []).map(a => [a.id, a]))
  return announcement.ids.slice(0, 12).flatMap(id => {
    const name = String(nameOf(id) ?? '').trim().slice(0, 60)
    if (!TROPHY_ID.test(id) || !name) return []
    const tier = by.get(id)?.tier
    return [{ id, name, tier: ['bronze', 'silver', 'gold'].includes(tier) ? tier : null }]
  })
}
