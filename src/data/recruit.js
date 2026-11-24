import { readDescriptionOf, runRevise } from '../core/llmDraft.js'
import { IDLE, orderReducer } from '../core/orders.js'
import { readListed, readModel, recruitAuditBody, reviseAuditBody, runModel, runRecruit } from '../core/recruit.js'
import { safeRequest } from './rpc.js'

/**
 * The effects of a recruitment. The flow itself is in src/core/recruit.js (the RPC is passed in); this module gives it the
 * host's request and writes the journal line. Nothing here stores a draft: the order carries it until it has left.
 */

const MODEL_READS = 3
const MODEL_READ_GAP_MS = 1000
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** The departure of a recruitment (after the 6 s window). -> the action for the order machine. A lost create is `failed / unknown_outcome`. */
export async function sendRecruit(order, request = safeRequest) {
  if (order.verb === 'recruitModel') {
    const res = await runModel(order.code, order.model, order.provider, request)
    return res.ok
      ? { type: 'answered', answer: { ok: true, result: 'done', reason: null, before: null, after: null, comments: null, replayed: false, audited: true, atMs: null, detail: { failed: [], modelHeld: null } } }
      : { type: 'failed', reason: res.reason }
  }
  const res = await runRecruit(order.draft, request)
  if (!res.ok) return { type: 'failed', reason: res.reason }
  return {
    type: 'answered',
    answer: {
      ok: true, result: 'done', reason: null, before: null, after: null, comments: null, replayed: false, audited: true, atMs: null,
      detail: { failed: res.failed, modelHeld: res.modelHeld }
    }
  }
}

/**
 * After the departure: read `profiles.list` back and write the journal line. `present` is what the caller hands to the machine's `read`:
 * true = listed (and, for the model follow-up, the row shows the model), false = not listed, null = the list could not be read.
 * The journal says `done` only for a bot the list shows; an unreadable list writes nothing (nothing is claimed either way).
 */
export async function verifyRecruit(ctx, order, answer, auditOn, request = safeRequest, wait = pause) {
  const follow = order.verb === 'recruitModel'
  // a recruitment is read from `profiles.list`; the model follow-up from `profiles.describe` (the list does not carry the model)
  const reread = async () => {
    if (!follow) return readListed(order.code, request)
    const m = await readModel(order.code, request)
    return { listed: m.read ? true : null, model: m.model, provider: m.provider }
  }
  const shows = r => (follow ? r.listed === true && r.model === order.model && r.provider === order.provider : r.listed)
  let read = await reread()
  // bounded re-read: a write Hermes just made may need a moment to show (the follow-up reads a few times before it says it does not)
  for (let i = 1; follow && answer.ok && read.listed && !shows(read) && i < MODEL_READS; i++) {
    await wait(MODEL_READ_GAP_MS)
    read = await reread()
  }
  const present = read.listed === null ? null : shows(read)
  let result = null
  let reason = null
  if (answer.ok && present === true) { result = 'done'; reason = follow ? 'model_applied' : null }
  else if (answer.ok && present === false) { result = 'failed'; reason = follow ? 'model_not_read' : 'not_listed' }
  else if (!answer.ok) { result = 'failed'; reason = answer.reason }
  let audited = answer.audited
  if (auditOn && result) audited = await audit(ctx, recruitAuditBody(order, { result, reason }))
  return { present: answer.ok ? present : null, audited }
}

/**
 * The departure of a revised description (after the 6 s window): `profiles.configure { name, description }`, that field only. -> the action
 * for the order machine. A lost call is `failed / unknown_outcome`. The text is the order's, dropped the moment it has left.
 */
export async function sendRevise(order, request = safeRequest) {
  const res = await runRevise(order.code, order.description, request)
  return res.ok
    ? { type: 'answered', answer: { ok: true, result: 'done', reason: null, before: null, after: null, comments: null, replayed: false, audited: true, atMs: null, detail: null } }
    : { type: 'failed', reason: res.reason }
}

/**
 * After the departure: `profiles.list` read back and the journal line written (one line per order TRIED). `present` is what the machine's
 * `read` takes: true = the list shows the description that was applied, false = it shows another one, null = the list could not be read (nothing
 * is claimed, and the journal says `unknown_outcome`). A bounded re-read: a write Hermes just made may need a moment to show. `audited` false =
 * the line could not be written (an older agent half answers 422 to `verb: revise`): the page says so and claims nothing else.
 */
export async function verifyRevise(ctx, order, answer, auditOn, request = safeRequest, wait = pause) {
  const want = String(order.description ?? '').trim()
  let read = await readDescriptionOf(order.code, request)
  for (let i = 1; answer.ok && read.listed && read.description !== want && i < MODEL_READS; i++) {
    await wait(MODEL_READ_GAP_MS)
    read = await readDescriptionOf(order.code, request)
  }
  const present = answer.ok ? (read.listed === null ? null : read.listed && read.description === want) : null
  let result = null
  let reason = null
  if (answer.ok && present === true) result = 'done'
  else if (answer.ok && present === false) { result = 'failed'; reason = 'not_applied' }
  else if (!answer.ok) { result = 'failed'; reason = answer.reason }
  else { result = 'failed'; reason = 'unknown_outcome' }   // tried, list unreadable: nothing is claimed either way
  let audited = answer.audited
  if (auditOn && result) audited = await audit(ctx, reviseAuditBody(order, { result, reason, length: want.length }))
  return { present, audited }
}

/** Journal a recruitment the page just did (`POST /audit`; best effort: false = not written, the page says so). */
export async function audit(ctx, body) {
  try {
    const res = await ctx.rest('/audit', { method: 'POST', body, timeoutMs: 8_000 })
    return res?.ok === true
  } catch {
    return false
  }
}

/**
 * The page was left while the order was `sending`: the request has gone all the same, and the effect that re-reads the list and writes the journal
 * line will never run. Do it here, at the end of the departure's own chain: the same read and the same line as the effect would have made (what
 * the list shows after the answer, one line per order tried), nothing more. -> { present, audited }, or null for an order that is not a recruitment.
 */
export async function settleLeft(ctx, order, action, auditOn, request = safeRequest, wait = pause) {
  if (!order || (order.verb !== 'recruit' && order.verb !== 'recruitModel' && order.verb !== 'revise')) return null
  const { answer } = orderReducer({ ...IDLE, phase: 'sending', order }, action)
  if (!answer) return null
  return order.verb === 'revise' ? verifyRevise(ctx, order, answer, auditOn, request, wait) : verifyRecruit(ctx, order, answer, auditOn, request, wait)
}

/**
 * The whole departure of a recruitment or a revision: send, then hand the answer to the machine while the page is there (its effect re-reads the list
 * and writes the journal line), or, if the page was left meanwhile, do that re-read and that line here (`settleLeft`). `mounted()`: is the page still there.
 */
export async function depart(order, { mounted, dispatch, ctx, auditOn, request = safeRequest, wait = pause }) {
  const action = order.verb === 'revise' ? await sendRevise(order, request) : await sendRecruit(order, request)
  return mounted() ? dispatch(action) : settleLeft(ctx, order, action, auditOn, request, wait)
}
