/**
 * The orders of the decision box, as pure data. No SDK, no DOM, no clock of its own (callers pass `now`), no network.
 *
 * Rules:
 *   - every order carries its risk class, shown as text and colour;
 *   - an order that writes (unblock, comment) is « final »: an explicit confirmation names the target (board + card code),
 *     then 6 s to cancel, then it leaves; ONE order at a time (a second one is refused while one is counting or travelling);
 *   - after sending, the page shows « in progress » only; the outcome is the route's answer (re-read from the database by the
 *     agent half) once /live has been refreshed: nothing is displayed before that read (no optimistic state);
 *   - the text of a comment lives in this state and nowhere else (never stored, logged or shown after sending).
 *   - an approval answer (`approval.respond`, through the host, not POST /orders) rides the same machine; its risk comes
 *     from the choice (deny = safe, once/session/always = final) and only a refusal skips the confirmation.
 */
import { REQUEST_RE, choiceConfirms, choiceRisk } from './approvals.js'

/** Seconds between the confirmation and the departure of an order. */
export const UNDO_SECONDS = 6
/** Longest comment the agent half accepts (4 000 characters after strip; above -> 422). The page bounds the input. */
export const COMMENT_MAX = 4000
/** Entries of the audit journal the panel shows (`GET /orders?limit=`; the agent half allows up to 50). */
export const JOURNAL_SHOWN = 8
/** Lines read from the journal (`GET /orders?limit=`, the most the agent half serves): the panel shows the newest JOURNAL_SHOWN, the « Command » achievements read all. */
export const JOURNAL_FETCH = 50

export const RISKS = Object.freeze(['safe', 'rev', 'final'])

/**
 * The orders the decision box offers. `writes`: goes through POST /orders (needs the agent half and its capability);
 * `open*` are local to the page (host.openSession / host.navigate): no risk, no delay, nothing written, nothing journaled.
 */
export const ORDERS = Object.freeze({
  openSession: { risk: 'safe', writes: false },
  openKanban: { risk: 'safe', writes: false },
  unblock: { risk: 'final', writes: true, confirm: true },
  comment: { risk: 'final', writes: true, confirm: true, text: true },
  // answered through `host.request('approval.respond')`; the risk depends on the choice (see riskOf)
  approval: { risk: 'final', writes: true, confirm: true, via: 'rpc' },
  // recruiting a bot (`profiles.create` + `profiles.configure` through the host); it writes a folder on this machine: final.
  // `recruitModel` = the follow-up when Hermes held a costly model for a confirmation: it changes the config of that new bot (reversible).
  recruit: { risk: 'final', writes: true, confirm: true, via: 'rpc' },
  recruitModel: { risk: 'rev', writes: true, confirm: true, via: 'rpc' },
  // « Apply » on a revised description = `profiles.configure { description }` through the host, that field only. Reversible (the
  // text can be written again); the before / after on screen IS the confirmation, so it goes straight to the 6 s window like the campaign's.
  revise: { risk: 'rev', writes: true, confirm: false, via: 'rpc' },
  // the campaign. `campaign` = `POST /campaign` (the editor's review step IS its confirmation: it names the cards and the project,
  // so the order leaves for its 6 s window directly); `launch` / `cancel_campaign` = `POST /orders` on a guard (launch = `complete_task`,
  // never an unblock). All three are final: nothing is un-created, un-launched or un-archived by Officecraft.
  campaign: { risk: 'final', writes: true, confirm: true, via: 'campaign' },
  launch: { risk: 'final', writes: true, confirm: true },
  cancel_campaign: { risk: 'final', writes: true, confirm: true }
})

/** The verbs POST /orders serves (and /health `capabilities` lists): the orders that go through the agent half. */
export const WRITE_VERBS = Object.freeze(Object.keys(ORDERS).filter(k => ORDERS[k].writes && ORDERS[k].via !== 'rpc'))

/** Risk class of an order as it is shown: the choice for an approval, the verb's own class otherwise. */
export const riskOf = order => (order?.verb === 'approval' ? choiceRisk(order.choice) : ORDERS[order?.verb]?.risk ?? 'final')

/**
 * Write orders offered by the page = verbs the agent half announces in /health `capabilities`, and only those.
 * No agent half, a read that has not answered, or a verb it does not list: the button is not drawn (never greyed in silence).
 */
export function offeredWrites(health) {
  if (!health?.present || !Array.isArray(health.capabilities)) return []
  return WRITE_VERBS.filter(v => health.capabilities.includes(v))
}

/** Same for the journal: only read when /health says `reads` has `orders`. */
export const journalServed = health => Boolean(health?.present) && Array.isArray(health.reads) && health.reads.includes('orders')

/* ---------- reasons: stable codes of the agent half + the page's own, all translated by the page ---------- */

/** `reason` codes of POST /orders and of the page; anything else is shown as `unknown`. */
export const REASONS = Object.freeze([
  'unknown_board', 'archived_board', 'unknown_task', 'not_blocked', 'running', 'archived_task', 'empty_text', 'hermes_error', 'id_conflict',
  'busy', 'invalid', 'unreachable', 'unknown_outcome', 'hidden', 'unknown',
  // recruiting: the identifier Hermes refused, a bot created but not listed back, the model applied after a confirmation
  'name_taken', 'name_invalid', 'not_listed', 'model_applied', 'model_not_read',
  // a description Hermes said it wrote but `profiles.list` does not show
  'not_applied',
  // approvals: settled elsewhere, no longer answerable from this window, still listed after the answer
  'already_settled', 'stale', 'still_pending',
  // campaign: the agent half's codes
  'board_exists', 'bad_slug', 'no_workdir', 'unknown_profile', 'cycle', 'no_head_guard', 'bad_guard', 'unguarded', 'too_many_cards', 'bad_parent',
  'readback_mismatch', 'already_created', 'guard', 'not_a_guard', 'phase_not_done', 'launched', 'linked', 'partial'
])
const REASON_SET = new Set(REASONS)
export const reasonOf = code => (REASON_SET.has(code) ? code : 'unknown')

/**
 * What a failed call to POST /orders means. The route answers HTTP 200 for every business decision; a thrown error is
 * 409 busy (another order is running on the server), 422/413 (invalid body: the page bounds its input, so this is a bug
 * or a version mismatch), or the network. A call that may have reached the agent half but whose answer was lost is
 * `unknown_outcome`: the page does not say « failed », it says the outcome is unknown and points at the journal.
 */
export function classifyError(error) {
  const status = Number(error?.status ?? error?.response?.status ?? (String(error?.message || '').match(/\b(4\d\d|5\d\d)\b/) || [])[1])
  if (status === 409) return 'busy'
  if (status === 422 || status === 413 || status === 400) return 'invalid'
  if (status === 404 || status === 405) return 'unreachable'
  return 'unknown_outcome'
}

/* ---------- the request and its answer ---------- */

/** Order of the machine -> body of POST /orders (closed fields; `text` only for a comment). */
export function orderBody(order) {
  if (order.verb === 'campaign') return order.body   // the closed body `toRequest` built (src/core/campaign.js), held by the order for its 6 s only
  const body = { id: order.id, verb: order.verb, board: order.board, task: order.task }
  if (ORDERS[order.verb]?.text) body.text = String(order.text ?? '')
  return body
}

/**
 * The agent half's answer, kept to the whitelisted facts. Anything that is not a well-formed business answer is null
 * (the caller then treats the order as `unknown_outcome`: nothing is invented).
 */
export function readAnswer(body) {
  if (!body || typeof body !== 'object' || typeof body.result !== 'string') return null
  const status = x => (typeof x?.status === 'string' ? x.status : null)
  return {
    ok: body.result === 'done',
    result: ['done', 'refused', 'failed', 'busy'].includes(body.result) ? body.result : 'failed',
    reason: body.result === 'done' ? null : reasonOf(body.reason),
    before: status(body.before),
    after: status(body.after),
    comments: Number.isInteger(body.after?.comments) ? body.after.comments : null,
    // `launch` says how many cards became ready, `cancel_campaign` how many it archived (both read back by the agent half)
    ready: Number.isInteger(body.after?.ready) && body.after.ready >= 0 ? body.after.ready : null,
    archived: Number.isInteger(body.after?.archived) && body.after.archived >= 0 ? body.after.archived : null,
    replayed: body.replayed === true,
    audited: body.audited !== false,
    atMs: Number.isFinite(body.at) ? Math.round(body.at * 1000) : null
  }
}

/* ---------- the state machine ---------- */

/**
 * phases:
 *   idle       nothing pending (`outcome` keeps the last result until dismissed)
 *   draft      a comment is being written (nothing decided)
 *   confirm    the confirmation names the target; nothing leaves yet
 *   counting   the 6 s window: cancel is possible, nothing has left
 *   sending    the request left; waiting for the route's answer (cancel is no longer possible)
 *   verifying  the answer is in; /live is being re-read before anything is shown
 *   done       outcome displayed: `outcome` = { ok, reason, ... } (read back)
 * An order is « busy » from the moment the countdown starts to the moment its outcome is displayed.
 */
export const IDLE = Object.freeze({ phase: 'idle', order: null, sendAt: null, left: 0, answer: null, outcome: null, notice: null })

const CHOICE_LIST = ['deny', 'once', 'session', 'always']
const BUSY = new Set(['counting', 'sending', 'verifying'])
export const isBusy = state => BUSY.has(state.phase)
/** Something the user can still back out of without any effect. */
export const isCancellable = state => state.phase === 'draft' || state.phase === 'confirm' || state.phase === 'counting'

/** Escape gives up whatever can still be given up (draft, confirmation, the 6 s window); once the order has left it does nothing. */
export const keyCancels = (state, key) => key === 'Escape' && isCancellable(state)
/** No answer came back (network cut, proxy page, 502): the order may well have been executed, so the page must not say « did not go through ». */
export const isUnknownOutcome = out => Boolean(out) && !out.cancelled && !out.ok && out.reason === 'unknown_outcome'

/** Whole seconds left before departure, never below 1 while counting (the last second reads « 1 »). */
export const secondsLeft = (sendAt, now) => Math.max(0, Math.ceil((sendAt - now) / 1000))

/** The text of a comment, bounded to what the agent half accepts. */
export const clampText = text => String(text ?? '').slice(0, COMMENT_MAX)
/** A comment can go once it holds something other than blanks (the agent half strips; empty -> `empty_text`). */
export const textReady = text => String(text ?? '').trim().length > 0

/**
 * Pure transition. Actions:
 *   request { order: { id, verb, board, task, code }, now }   a button was pressed (id = fresh UUID from the caller)
 *   text    { text }                                            the comment draft changed (draft phase)
 *   review  {}                                                  draft -> confirm (comment ready to confirm)
 *   back    {}                                                  confirm -> draft (comment) or idle (unblock)
 *   confirm { now }                                             confirm -> counting
 *   tick    { now }                                             counting: update `left`; at 0 -> sending
 *   cancel  { reason? }                                         draft | confirm | counting -> idle with outcome cancelled; refused later
 *   answered { answer }                                         sending -> verifying (answer = readAnswer() result)
 *   failed  { reason }                                          sending -> verifying with a failure that has no answer (network, 409...)
 *   read    { liveOk }                                          verifying -> done (the outcome becomes visible only here)
 *   dismiss {}                                                  done | idle -> idle without outcome
 * A refused action returns the same state with `notice` set (never throws, never changes a busy order).
 */
export function orderReducer(state, action) {
  const refuse = notice => ({ ...state, notice })
  switch (action.type) {
    case 'request': {
      if (action.replay) return refuse('replay')   // no order on the past (the page says `replay: true` while it replays)
      const o = action.order
      const spec = ORDERS[o?.verb]
      if (!spec?.writes) return refuse('not_an_order')
      if (isBusy(state)) return refuse('busy')   // the second order is refused, the first one is untouched
      const base = { ...IDLE, order: { ...o, text: spec.text ? '' : undefined } }
      if (o.verb === 'approval') {
        if (!CHOICE_LIST.includes(o.choice)) return refuse('not_an_order')
        // refusing changes nothing: no confirmation, straight to the 6 s window; every other answer lets the command run
        if (!choiceConfirms(o.choice)) return { ...base, phase: 'counting', sendAt: action.now + UNDO_SECONDS * 1000, left: UNDO_SECONDS }
        return { ...base, phase: 'confirm' }
      }
      // the campaign editor's review step already named what will be written and where: straight to the 6 s window.
      // that shortcut is the `campaign` order's only; a launch, a cancel or an unblock always stops at its named confirmation.
      // and the revision of a description (the before / after on screen named the bot and the text)
      if (o.preconfirmed && (o.verb === 'campaign' || o.verb === 'revise')) return { ...base, phase: 'counting', sendAt: action.now + UNDO_SECONDS * 1000, left: UNDO_SECONDS }
      return spec.text ? { ...base, phase: 'draft' } : { ...base, phase: 'confirm' }
    }
    case 'text':
      if (state.phase !== 'draft') return refuse('wrong_phase')
      return { ...state, notice: null, order: { ...state.order, text: clampText(action.text) } }
    case 'review':
      if (state.phase !== 'draft') return refuse('wrong_phase')
      if (!textReady(state.order.text)) return refuse('empty_text')
      return { ...state, phase: 'confirm', notice: null }
    case 'back':
      if (state.phase !== 'confirm') return refuse('wrong_phase')
      return ORDERS[state.order.verb].text ? { ...state, phase: 'draft', notice: null } : { ...IDLE }
    case 'confirm':
      // the explicit confirmation of a final order; nothing leaves without it
      if (state.phase !== 'confirm') return refuse('wrong_phase')
      return { ...state, phase: 'counting', sendAt: action.now + UNDO_SECONDS * 1000, left: UNDO_SECONDS, notice: null }
    case 'tick': {
      if (state.phase !== 'counting') return state
      const left = secondsLeft(state.sendAt, action.now)
      return left > 0 ? (left === state.left ? state : { ...state, left }) : { ...state, phase: 'sending', left: 0 }
    }
    case 'cancel':
      if (!isCancellable(state)) return refuse(state.phase === 'idle' || state.phase === 'done' ? 'wrong_phase' : 'too_late')
      return { ...IDLE, outcome: { cancelled: true, reason: action.reason ?? null, verb: state.order.verb, board: state.order.board, task: state.order.task, code: state.order.code, choice: state.order.choice, agent: state.order.agent, title: state.order.title, wasCounting: state.phase === 'counting' } }
    case 'answered':
      if (state.phase !== 'sending') return refuse('wrong_phase')
      return { ...state, phase: 'verifying', answer: action.answer }
    case 'failed':
      if (state.phase !== 'sending') return refuse('wrong_phase')
      return { ...state, phase: 'verifying', answer: { ok: false, result: 'failed', reason: reasonOf(action.reason), before: null, after: null, comments: null, replayed: false, audited: true, atMs: null } }
    case 'read': {
      if (state.phase !== 'verifying') return refuse('wrong_phase')
      const a = state.answer
      const o = state.order
      // an approval is only « done » once the queue was re-read and no longer lists the request (gone === true);
      // gone === false: Hermes said resolved but the request is still pending; gone === null: the re-read failed (unverified)
      const stuck = o.verb === 'approval' && a.ok && action.gone === false
      // a recruitment is only « done » once `profiles.list` lists the bot (present === true); absent = created per Hermes but not listed;
      // null = the list could not be read (nothing is claimed)
      const revise = o.verb === 'revise'   // read back from `profiles.list`: the description it shows is the one that was applied (true), another (false), unread (null)
      const recruit = o.verb === 'recruit' || o.verb === 'recruitModel' || revise
      const unlisted = recruit && a.ok && action.present === false
      return {
        ...IDLE,
        phase: 'done',
        order: { ...o, text: undefined, draft: undefined, body: undefined, description: undefined },   // the text of a comment, the draft of a recruitment, the body of a campaign (titles, instructions) and a revised description are dropped the moment it has left
        outcome: {
          cancelled: false, ok: a.ok && !stuck && !unlisted, reason: stuck ? 'still_pending' : unlisted ? (revise ? 'not_applied' : o.verb === 'recruitModel' ? 'model_not_read' : 'not_listed') : a.reason, verb: o.verb, board: o.board, task: o.task, code: o.code,
          choice: o.choice, agent: o.agent, title: o.title, gone: o.verb === 'approval' ? (action.gone ?? null) : null,
          present: recruit ? (action.present ?? null) : null, detail: a.detail ?? null,
          ready: a.ready ?? null, archived: a.archived ?? null, starts: o.starts, size: o.size, head: o.head,
          before: a.before, after: a.after, comments: a.comments, replayed: a.replayed, audited: action.audited ?? a.audited, liveOk: action.liveOk !== false
        }
      }
    }
    case 'dismiss':
      return state.phase === 'done' || state.phase === 'idle' ? { ...IDLE } : refuse('busy')
    default:
      return state
  }
}

/** Idle state to start from. */
export const initialOrderState = (outcome = null) => ({ ...IDLE, outcome })   // a page that comes back may start with the line « order not sent »

/* ---------- targets ---------- */

/** Card -> what the order names: its board and its short code (the id when the title has none). Never the title's body. */
export const targetOf = (verb, item, id) => ({ id, verb, board: item.board, task: item.id, code: item.code || item.id })

/**
 * The revision of a description names the bot (its identifier is the « code ») and carries the text for the 6 s only (dropped the moment
 * the order has left, like a comment). `preconfirmed`: the before / after on screen was the confirmation.
 */
export const reviseTarget = (name, description, id) => ({ id, verb: 'revise', code: name, board: '', task: '', description: String(description ?? ''), preconfirmed: true })

/**
 * A recruitment names the new bot (its identifier is the « code »); `draft` = what the form holds (never a soul).
 * `held` = the model Hermes asked to confirm (the follow-up order `recruitModel`).
 */
export const recruitTarget = (draft, id, held = null) => (held
  ? { id, verb: 'recruitModel', code: draft.name, board: '', task: '', draft: { name: draft.name }, model: held.model, provider: held.provider, message: held.message }
  : { id, verb: 'recruit', code: draft.name, board: '', task: '', draft: { ...draft, off: [...(draft.off || [])] } })

/* ---------- the journal ---------- */

const JOURNAL_VERBS = new Set(['unblock', 'comment', 'approval', 'recruit', 'revise', 'campaign', 'launch', 'cancel_campaign'])
const JOURNAL_RESULTS = new Set(['done', 'refused', 'failed'])
const cut = (s, n = 64) => String(s ?? '').slice(0, n)

/**
 * `GET /orders` -> entries in the whitelist the page shows: when, verb, risk, board, card id, result, reason, statuses.
 * (The agent half already filters; the page filters again, as it does for every read.) Never a text, a command or a path.
 */
export function toJournal(body, limit = JOURNAL_SHOWN) {
  if (!body || body.ok !== true || !Array.isArray(body.entries)) return { ok: false, entries: [] }
  const entries = body.entries
    .filter(e => e && typeof e === 'object' && JOURNAL_VERBS.has(e.verb) && Number.isFinite(e.ts))
    .map(e => ({
      ms: Math.round(e.ts * 1000),
      id: cut(e.id),
      verb: e.verb,
      risk: RISKS.includes(e.risk) ? e.risk : 'final',
      board: cut(e.board),
      task: cut(e.task),
      result: JOURNAL_RESULTS.has(e.result) ? e.result : 'failed',
      reason: e.reason ? reasonOf(e.reason) : null,
      before: typeof e.before?.status === 'string' ? cut(e.before.status, 24) : null,
      after: typeof e.after?.status === 'string' ? cut(e.after.status, 24) : null,
      len: Number.isInteger(e.len) ? e.len : null,
      choice: ['deny', 'once', 'session', 'always'].includes(e.choice) ? e.choice : null,
      profile: typeof e.profile === 'string' ? cut(e.profile) : null,
      source: e.source === 'page' ? 'page' : 'agent',
      // the Hermes request the page saw and answered (approval lines); only when it has the shape of such an id
      ...(typeof e.request === 'string' && REQUEST_RE.test(e.request) ? { request: e.request } : {})
    }))
    .sort((x, y) => y.ms - x.ms)
    .slice(0, limit)
  return { ok: true, entries }
}
