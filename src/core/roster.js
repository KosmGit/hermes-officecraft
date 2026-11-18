/**
 * Pure roster logic: `profiles.list` rows -> desks. No SDK, no DOM, so it runs
 * under `node --test`.
 *
 * Privacy: only whitelisted fields are copied. `path`, `preview`, `soul` and
 * message contents never leave this module.
 */
import { toMs } from './time.js'

/** Workers heartbeat `last_active` at least every 60 s (hermes-agent #72016). */
export const WORKER_LIVE_WINDOW_MS = 120_000
/** A human session touched this recently counts as "active". */
export const RECENT_WINDOW_MS = 10 * 60_000

export const DESCRIPTION_MAX = 280

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function countOf(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

function sessionRef(raw, kind) {
  if (!raw || typeof raw !== 'object') return null
  const id = text(raw.id)
  if (!id) return null
  const ref = { id, title: text(raw.title), lastActiveMs: toMs(raw.last_active) ?? toMs(raw.started_at) }
  if (kind === 'worker') ref.source = text(raw.source)
  // how many messages the session really holds (what a reader would show: `live_message_count`, else `message_count`);
  // null when Hermes does not say. Only a count, never a message.
  else ref.messages = countOf(raw.live_message_count) ?? countOf(raw.message_count)
  return ref
}

/** One `profiles.list` row -> a desk, or null when the row has no usable name. */
export function toDesk(row, nowMs = Date.now()) {
  if (!row || typeof row !== 'object') return null
  const name = text(row.name)
  if (!name) return null

  const hasSessionFields = 'last_session' in row || 'worker_session' in row
  const lastSession = sessionRef(row.last_session, 'human')
  const workerSession = sessionRef(row.worker_session, 'worker')

  return {
    name,
    label: text(row.display_name) || name,
    isDefault: Boolean(row.is_default),
    model: text(row.model),
    provider: text(row.provider),
    // role hints for the wardrobe; the description is the profile's own role text
    description: text(row.description).slice(0, DESCRIPTION_MAX),
    // the profile's own text was longer than what the office keeps: a screen that shows it says so (« … »)
    descriptionCut: text(row.description).length > DESCRIPTION_MAX,
    skillCount: Number.isFinite(row.skill_count) ? row.skill_count : 0,
    hasAvatar: Boolean(row.has_avatar),
    // this plugin's own per-bot settings (profile.yaml ui_meta['hermes-officecraft']), e.g. a hand-picked role
    officeMeta: row.ui_meta && typeof row.ui_meta['hermes-officecraft'] === 'object' && row.ui_meta['hermes-officecraft'] ? { ...row.ui_meta['hermes-officecraft'] } : {},
    lastSession,
    workerSession,
    state: deskState({ hasSessionFields, lastSession, workerSession }, nowMs),
    lastActivityMs: latest(lastSession?.lastActiveMs, workerSession?.lastActiveMs)
  }
}

function latest(...values) {
  const nums = values.filter(v => typeof v === 'number')
  return nums.length ? Math.max(...nums) : null
}

export function deskState({ hasSessionFields, lastSession, workerSession }, nowMs = Date.now()) {
  if (!hasSessionFields) return 'unknown'
  if (workerSession?.lastActiveMs && nowMs - workerSession.lastActiveMs <= WORKER_LIVE_WINDOW_MS) return 'working'
  if (lastSession?.lastActiveMs && nowMs - lastSession.lastActiveMs <= RECENT_WINDOW_MS) return 'active'
  if (lastSession || workerSession) return 'idle'
  return 'new'
}

const STATE_RANK = { working: 0, active: 1, idle: 2, new: 3, unknown: 4 }

/** Stable order: busiest first, then most recent activity, then name. */
export function sortDesks(desks) {
  return [...desks].sort(
    (a, b) =>
      STATE_RANK[a.state] - STATE_RANK[b.state] ||
      (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0) ||
      a.label.localeCompare(b.label)
  )
}

/** `profiles.list` result -> sorted desks. Tolerates any malformed shape. */
export function buildRoster(result, nowMs = Date.now()) {
  const rows = Array.isArray(result?.profiles) ? result.profiles : []
  const seen = new Set()
  const desks = []
  for (const row of rows) {
    const desk = toDesk(row, nowMs)
    if (!desk || seen.has(desk.name)) continue
    seen.add(desk.name)
    desks.push(desk)
  }
  return sortDesks(desks)
}

export function summarize(desks) {
  const counts = { total: desks.length, working: 0, active: 0, idle: 0, new: 0, unknown: 0 }
  for (const desk of desks) counts[desk.state] += 1
  return counts
}

/**
 * The session a click should open: the human conversation, else the newest non-empty one /history knows, else nothing.
 *
 * `profiles.list.last_session` is the newest listed row,
 * and Hermes lists a fresh blank chat (« Untitled session », 0 message, created by the app itself or a « + ») as a session.
 * When `last_session` is such a blank row (message_count 0, no title), a click would open an empty
 * tab. So a session is offered only when Hermes says it holds at least one message; an unknown count is not « some ».
 * The worker session is not offered: `profiles.list` gives it no message count, and Hermes keeps kanban/tool workers out of the
 * conversation lists (`_denied_source`), so nothing proves that opening it shows a transcript.
 */
export function sessionToOpen(desk) {
  const s = desk?.lastSession
  if (s?.id && s.messages > 0) return { id: s.id, profile: desk.name }
  // the newest listed row is a blank chat: /history's lastNonEmptySession is the conversation to open.
  // Without that fact (an older agent half) nothing else is offered.
  const f = desk?.nonEmptySession
  return f?.id && f.messages > 0 ? { id: f.id, profile: desk.name } : null
}

/**
 * Attach `/history`'s `lastNonEmptySession` to the agents, by name, as `nonEmptySession` (an id, a title, a time, a count: no
 * content). Only where there is one; no history (`ok:false`) or none served -> the very same array, untouched.
 */
export function withNonEmptySessions(agents, history) {
  if (!history?.ok) return agents
  let changed = false
  const out = (agents || []).map(a => {
    const f = history.profiles?.[a.name]?.lastNonEmptySession
    if (!f) return a
    changed = true
    return { ...a, nonEmptySession: f }
  })
  return changed ? out : agents
}
