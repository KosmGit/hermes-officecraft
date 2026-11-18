/**
 * Hermes approvals in the decision box, as pure data. No SDK, no DOM, no clock of its own, no network.
 * Source: the RPC `approval.pending` / `approval.respond` and the events `approval.request` /
 * `approval.settled`.
 *
 * What is kept of a request: who asks (profile), in which session, the one-line SUMMARY Hermes gives it (`description`,
 * already redacted by Hermes), the choices it allows, and when the page first saw it. NEVER the command: the native
 * approval card of Hermes shows it, the desk does not repeat it; « Open session » leads there.
 */

/** The four answers of `approval.respond`, in the order the box offers them (safest first). */
export const CHOICES = Object.freeze(['deny', 'once', 'session', 'always'])

/**
 * Risk class of each answer: refusing runs nothing (« safe »); the other three let the command run, which cannot be
 * undone (« final »); `always` also writes the pattern into the profile's permanent allow-list, so it asks for a nominative
 * confirmation that names the agent and the session.
 */
export const CHOICE_RISK = Object.freeze({ deny: 'safe', once: 'final', session: 'final', always: 'final' })
export const choiceRisk = choice => CHOICE_RISK[choice] ?? 'final'
/** Answers that need an explicit confirmation before the 6 s window (refusing does not: it changes nothing). */
export const choiceConfirms = choice => choiceRisk(choice) !== 'safe'

/** Longest summary shown (Hermes' own descriptions are short; this bounds a pathological one). */
export const DESCRIPTION_MAX = 160
/** Sessions whose queue the page reads at most (one request each per read). */
export const SESSIONS_MAX = 10
/** Requests kept at most, whatever the sources say. */
export const REQUESTS_MAX = 50

const str = v => (typeof v === 'string' ? v : '')
// control characters, line separators and runs of blanks -> one space (a summary is one line); format characters (bidi overrides,
// zero-width) are dropped: a session title comes straight from Hermes and must not reorder or hide the text of a confirmation
const oneLine = s => str(s).replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim()

/**
 * The choices a request allows. Hermes lists them in `choices` (or leaves them to `allow_session` / `allow_permanent`:
 * `tui_gateway/server.py::_approval_request_payload`); `deny` is always there, nothing outside the four is ever offered.
 */
export function choicesOf(raw) {
  if (!raw || typeof raw !== 'object') return ['deny']   // nothing known about the request: the only answer that is always safe
  const listed = Array.isArray(raw?.choices) ? raw.choices.filter(c => CHOICES.includes(c)) : null
  let allowed
  if (listed && listed.length) allowed = new Set(listed)
  else {
    allowed = new Set(['once'])
    if (raw?.smart_denied !== true && raw?.allow_session !== false) {
      allowed.add('session')
      if (raw?.allow_permanent !== false) allowed.add('always')
    }
  }
  allowed.add('deny')
  return CHOICES.filter(c => allowed.has(c))
}

/** One request as the page keeps it, or null when it has no usable identity. `raw` is an event payload or an `approval.pending` row. */
export function normalizeRequest(raw, { sessionId, profile = '', nowMs = 0 } = {}) {
  if (!raw || typeof raw !== 'object') return null
  const sid = str(sessionId).trim()
  const rid = str(raw.request_id).trim() || str(raw.prompt_id).trim()
  if (!sid || !rid) return null
  return {
    key: `${sid}/${rid}`,
    sessionId: sid,
    requestId: rid,
    profile: oneLine(profile).slice(0, 64),
    summary: oneLine(raw.description).slice(0, DESCRIPTION_MAX),
    choices: choicesOf(raw),
    smartDenied: raw.smart_denied === true,
    firstSeenMs: nowMs
  }
}

/* ---------- the store: what the page knows right now ---------- */

export const emptyApprovals = () => ({ byKey: {}, titles: {}, unreadable: {} })

/**
 * Pure transition. Actions:
 *   received { raw, sessionId, profile, nowMs }   an `approval.request` event
 *   settled  { sessionId, requestId }              an `approval.settled` event (answered anywhere, expired, withdrawn)
 *   snapshot { sessionId, rows, nowMs, profile? }  a READ of `approval.pending`: it is the truth for that session, a request it
 *                                                  does not list is gone, one it lists and the page did not know is added
 *   unreadable { sessionId, gone }                 the read failed: `gone` (session no longer exists) forgets its requests,
 *                                                  otherwise they stay, flagged unverified
 *   titles   { titles }                            session titles (runtime id -> title) from `session.active_list`
 */
export function approvalsReducer(state, action) {
  const by = { ...state.byKey }
  switch (action.type) {
    case 'received': {
      const r = normalizeRequest(action.raw, action)
      if (!r) return state
      const known = by[r.key]
      by[r.key] = known ? { ...r, firstSeenMs: known.firstSeenMs, profile: r.profile || known.profile } : r
      return { ...state, byKey: capRequests(by), unreadable: dropKey(state.unreadable, r.sessionId) }
    }
    case 'settled': {
      const key = `${action.sessionId}/${action.requestId}`
      if (!by[key]) return state
      delete by[key]
      return { ...state, byKey: by }
    }
    case 'snapshot': {
      const sid = str(action.sessionId)
      const rows = Array.isArray(action.rows) ? action.rows : []
      const seen = new Set()
      for (const row of rows) {
        const r = normalizeRequest(row, { sessionId: sid, profile: action.profile ?? '', nowMs: action.nowMs })
        if (!r) continue
        seen.add(r.key)
        const known = by[r.key]
        by[r.key] = known ? { ...r, firstSeenMs: known.firstSeenMs, profile: known.profile || r.profile } : r
      }
      for (const key of Object.keys(by)) if (by[key].sessionId === sid && !seen.has(key)) delete by[key]
      return { ...state, byKey: capRequests(by), unreadable: dropKey(state.unreadable, sid) }
    }
    case 'unreadable': {
      const sid = str(action.sessionId)
      if (action.gone) {
        for (const key of Object.keys(by)) if (by[key].sessionId === sid) delete by[key]
        return { ...state, byKey: by, unreadable: dropKey(state.unreadable, sid) }
      }
      return { ...state, unreadable: { ...state.unreadable, [sid]: true } }
    }
    case 'titles': {
      const titles = {}
      for (const [id, title] of Object.entries(action.titles || {})) if (typeof title === 'string' && title.trim()) titles[id] = oneLine(title).slice(0, 120)
      return { ...state, titles }
    }
    default:
      return state
  }
}

function dropKey(obj, key) {
  if (!(key in obj)) return obj
  const next = { ...obj }
  delete next[key]
  return next
}

/** Keep the newest REQUESTS_MAX (a runaway source never grows the page without bound). */
function capRequests(by) {
  const keys = Object.keys(by)
  if (keys.length <= REQUESTS_MAX) return by
  const keep = keys.sort((a, b) => by[b].firstSeenMs - by[a].firstSeenMs).slice(0, REQUESTS_MAX)
  return Object.fromEntries(keep.map(k => [k, by[k]]))
}

/** What the box lists: oldest first (the one that has waited longest), with its session title when known and the unverified flag. */
export function pendingView(state, nowMs = 0) {
  return Object.values(state.byKey)
    .map(r => ({
      ...r,
      title: state.titles[r.sessionId] || '',
      unverified: Boolean(state.unreadable[r.sessionId]),
      ageMs: Math.max(0, nowMs - r.firstSeenMs)
    }))
    .sort((a, b) => a.firstSeenMs - b.firstSeenMs || a.key.localeCompare(b.key, 'en'))
}

/**
 * The sessions to read: those that hold a request (with the profile that owns them: a gateway that serves several profiles routes
 * `approval.*` by it, exactly as the app's own card does), then the sessions the host says are waiting on a prompt, bounded.
 * `[{ sessionId, profile }]`.
 */
export function sessionsToRead(state, waitingIds = []) {
  const out = []
  const has = id => out.some(s => s.sessionId === id)
  for (const r of Object.values(state.byKey)) if (!has(r.sessionId)) out.push({ sessionId: r.sessionId, profile: r.profile })
  for (const id of waitingIds) if (typeof id === 'string' && id && !has(id)) out.push({ sessionId: id, profile: '' })
  return out.slice(0, SESSIONS_MAX)
}

/** Params of `approval.pending` / `approval.respond`: the profile only when it is known (the app sends it, `default` otherwise). */
export const withProfile = (params, profile) => (profile ? { ...params, profile } : params)

/* ---------- answers of the gateway ---------- */

/**
 * `session.active_list` -> { ids, waiting, titles }: the runtime id, the title, and which sessions are parked on a prompt
 * (`status: 'waiting'`, `tui_gateway/session_registry.py::_session_live_status`). Never the preview or the model. Only the waiting
 * ones are asked for their queue, so a quiet office costs one request per round.
 */
export function readLiveSessions(data) {
  const rows = Array.isArray(data?.sessions) ? data.sessions : []
  const ids = []
  const waiting = []
  const titles = {}
  for (const row of rows) {
    const id = str(row?.id).trim()
    if (!id) continue
    ids.push(id)
    if (row.status === 'waiting') waiting.push(id)
    if (str(row.title).trim()) titles[id] = row.title
  }
  return { ids, waiting, titles }
}

/** An error of the gateway that says the session no longer exists (the requests of it are gone with it). */
export const sessionGone = error => /\b4001\b|session not found|unknown session/i.test(String(error?.message ?? error ?? ''))

/**
 * `approval.respond` -> `{ resolved: n }`. n >= 1: the request was settled by this answer; 0: it was already settled (another
 * window, a timeout) or the id is not pending; anything else is no answer at all (the page does not guess).
 * `error` is what `safeRequest` carries when the call failed.
 */
export function readRespond(res) {
  if (res && res.ok === true && Number.isInteger(res.data?.resolved)) {
    return res.data.resolved >= 1 ? { ok: true, result: 'done', reason: null } : { ok: false, result: 'refused', reason: 'already_settled' }
  }
  if (res && res.ok === false && res.reason === 'unavailable') return { ok: false, result: 'failed', reason: 'unreachable' }
  const message = String(res?.error?.message ?? '')
  if (/stale or unavailable|reconnect before|attach/i.test(message)) return { ok: false, result: 'failed', reason: 'stale' }
  if (res && res.ok === false && /\b4001\b|session not found/i.test(message)) return { ok: false, result: 'failed', reason: 'stale' }
  return null   // lost answer: the caller says « unknown outcome », never « failed »
}

/**
 * A successful answer is said « no longer pending (read back) » only when the re-read of `approval.pending` saw it gone
 * (`gone === true`); when the re-read failed (`gone === null`) the page only knows what Hermes answered (`resolved: 1`).
 */
export const answerReread = outcome => outcome?.gone === true

/** The request as the order machine names it (never the command). */
export const approvalTarget = (req, id, choice) => ({
  id, verb: 'approval', choice, sessionId: req.sessionId, requestId: req.requestId,
  code: req.title || req.profile || '', agent: req.profile || '', title: req.title || ''
})

/** Shape of the id Hermes gives an approval request (`request_id`), as the agent half validates it before writing it to the journal. */
export const REQUEST_RE = /^[A-Za-z0-9_-]{8,128}$/

/**
 * The id of the request, written in the journal line ONLY when the page had seen that request pending when its answer left
 * (listed in the page's store). The « Guardian » medal counts only a line that carries it
 * (`request`). null = write the line without it.
 */
export const requestStamp = (order, wasPending) => (wasPending === true && typeof order?.requestId === 'string' && REQUEST_RE.test(order.requestId) ? order.requestId : null)

/** The body of `POST /audit` for an approval: closed fields, no command, no summary, no title. `request` = requestStamp(). */
export function auditBody(order, answer, request = null) {
  const result = answer?.result === 'done' ? 'done' : answer?.result === 'refused' ? 'refused' : 'failed'
  const body = { id: order.id, verb: 'approval', risk: choiceRisk(order.choice) === 'safe' ? 'safe' : 'final', result, choice: order.choice }
  if (answer?.reason && /^[a-z][a-z0-9_]{0,63}$/.test(answer.reason)) body.reason = answer.reason
  if (request) body.request = request
  return body
}
