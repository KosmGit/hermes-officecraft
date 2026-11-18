import { useQuery } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import { PLUGIN_ID } from '../constants.js'
import { approvalsReducer, auditBody, emptyApprovals, pendingView, readLiveSessions, readRespond, requestStamp, sessionGone, sessionsToRead, withProfile } from '../core/approvals.js'
import { classifyError } from '../core/orders.js'
import { safeRequest } from './rpc.js'

/**
 * Approvals asked by Hermes sessions. Two sources feed ONE store:
 *   - the gateway's `approval.request` / `approval.settled` events, tapped by `register()` even while the page is closed
 *     (a request that arrived is kept, so the box shows it when the page opens);
 *   - a READ while the page is mounted and visible: `session.active_list` (which sessions are live) then `approval.pending`
 *     for each, which also catches a request whose event this window did not see and drops one answered elsewhere.
 * What the store keeps is in src/core/approvals.js. It includes the command Hermes asks about (already redacted by Hermes),
 * shown in the confirmation of an allowing answer. The store is this module's memory and nothing else: the command is never
 * written to storage, to the journal (`auditBody` has closed fields), to a notification or to a model, and this file never
 * reads it (the answer that leaves carries the session, the request id and the choice).
 */
let state = emptyApprovals()
const listeners = new Set()
export const APPROVALS_KEY = [PLUGIN_ID, 'approvals']
/** One round of reads (1 + sessions requests) every 10 s while the page is mounted: spaced out so a few sessions stay under 1 request / 5 s each. */
export const APPROVALS_POLL_MS = 10_000

export function dispatchApprovals(action) {
  const next = approvalsReducer(state, action)
  if (next === state) return
  state = next
  for (const l of [...listeners]) l()
}

export const resetApprovals = () => { state = emptyApprovals() }

/** Hooks the two events once (`ctx.onEvent` is removed by Hermes when the plugin unloads). Safe when the host has no event tap. */
export function initApprovals(ctx) {
  if (typeof ctx?.onEvent !== 'function') return
  ctx.onEvent('approval.request', event => {
    const p = event?.payload
    dispatchApprovals({ type: 'received', raw: p, sessionId: event?.session_id, profile: event?.profile ?? '', nowMs: Date.now() })
  })
  ctx.onEvent('approval.settled', event => {
    const p = event?.payload
    dispatchApprovals({ type: 'settled', sessionId: event?.session_id, requestId: p?.request_id ?? p?.prompt_id })
  })
}

/** Re-read one session's queue and fold it into the store. Returns the rows' request ids, or null when the read failed. */
export async function readPending(sessionId, profile = '') {
  const res = await safeRequest('approval.pending', withProfile({ session_id: sessionId }, profile))
  if (res.ok && Array.isArray(res.data?.approvals)) {
    dispatchApprovals({ type: 'snapshot', sessionId, rows: res.data.approvals, nowMs: Date.now() })
    return res.data.approvals.map(r => String(r?.request_id ?? r?.prompt_id ?? ''))
  }
  dispatchApprovals({ type: 'unreadable', sessionId, gone: sessionGone(res.error) })
  return null
}

/** `approval.respond` for one request (the order machine calls it once the 6 s window has run out). */
export async function respond(order) {
  const res = await safeRequest('approval.respond', withProfile({ session_id: order.sessionId, request_id: order.requestId, choice: order.choice }, order.agent))
  return readRespond(res)
}

/**
 * The departure of an approval order (after the 6 s window): `approval.respond`, then the journal line when the page writes one.
 * Returns the action for the order machine: a lost answer is `failed / unknown_outcome`, never « answered ».
 */
export async function sendApproval(ctx, order, auditOn = false) {
  const wasPending = Boolean(state.byKey[`${order.sessionId}/${order.requestId}`])   // a request the page had really seen pending
  const read = await respond(order)
  if (!read) return { type: 'failed', reason: 'unknown_outcome' }
  const audited = auditOn ? await audit(ctx, order, read, requestStamp(order, wasPending)) : true
  return { type: 'answered', answer: { ok: read.ok, result: read.result, reason: read.reason, before: null, after: null, comments: null, replayed: false, audited, atMs: null } }
}

/** After an answer: does the queue of that session still list the request? true = gone, false = still there, null = could not read. */
export async function isGone(order) {
  const ids = await readPending(order.sessionId, order.agent)
  if (ids === null) return null
  return !ids.includes(order.requestId)
}

/** Journal an approval the page just answered (`POST /audit`; best effort: false = not written, the page says so). */
export async function audit(ctx, order, answer, request = null) {
  const post = body => ctx.rest('/audit', { method: 'POST', body, timeoutMs: 8_000 })
  try {
    return (await post(auditBody(order, answer, request)))?.ok === true
  } catch (error) {
    // an agent half older than the `request` field refuses a body that carries it (422, closed fields): the line is
    // written without it rather than not at all (« Guardian » then simply does not count it)
    if (!request || classifyError(error) !== 'invalid') return false
    try {
      return (await post(auditBody(order, answer)))?.ok === true
    } catch {
      return false
    }
  }
}

async function readRound() {
  const live = await safeRequest('session.active_list', {})
  const { waiting, titles } = live.ok ? readLiveSessions(live.data) : { waiting: [], titles: {} }
  if (live.ok) dispatchApprovals({ type: 'titles', titles })
  const sessions = sessionsToRead(state, waiting)
  await Promise.all(sessions.map(s => readPending(s.sessionId, s.profile)))
  return { sessions: sessions.length, at: Date.now() }
}

/**
 * The approvals waiting, oldest first. The store updates the list at once on an event; the query refreshes it from the gateway
 * every 10 s while the page is mounted and visible (no timer outside useQuery).
 */
export function useApprovals(intervalMs = APPROVALS_POLL_MS) {
  const [, bump] = useState(0)
  useEffect(() => {
    const l = () => bump(n => n + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  const query = useQuery({
    queryKey: APPROVALS_KEY,
    queryFn: readRound,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,
    staleTime: intervalMs,
    retry: false
  })
  return { state, query, view: pendingView(state, Date.now()), refresh: () => query.refetch() }
}
