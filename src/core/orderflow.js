/**
 * The decisions around the order machine (src/core/orders.js `orderReducer`), as pure functions. The hook
 * (src/data/orders.js) and the bar (src/ui/Orders.jsx) only wire them to timers, the network and the DOM; the tests of
 * tests/js/orders.test.mjs check them by value under node. No SDK, no DOM, no clock of its own (callers pass `now`).
 */
/* ---------- the countdown ---------- */

/**
 * Milliseconds to wait before the next tick of the 6 s window, or null when nothing is counting. The shown second drops when the time
 * left reaches (left - 1) s: wake up then, not by a fixed 1 s step (a late timer never lengthens or shortens the window: the deadline
 * is `sendAt`). +15 ms: a timer that fires a hair early would leave `left` unchanged and stall; never under 20 ms.
 */
export const countdownWait = (state, now) => (state.phase === 'counting' ? Math.max(20, state.sendAt - now - (state.left - 1) * 1000 + 15) : null)

/** A window nobody is watching cancels: the action to dispatch when the page becomes hidden during the 6 s, else null. */
export const hiddenCancel = (state, hidden) => (state.phase === 'counting' && hidden === true ? { type: 'cancel', reason: 'hidden' } : null)

/* ---------- how an order leaves and comes back ---------- */

/** The route of an order: `recruit` (profiles.create / configure through the host), `approval` (approval.respond through the host), `card` (POST /orders). */
export const routeOf = order => (order?.verb === 'recruit' || order?.verb === 'recruitModel' ? 'recruit' : order?.verb === 'revise' ? 'revise' : order?.verb === 'approval' ? 'approval' : order?.verb === 'campaign' ? 'campaign' : 'card')

/** What the re-read after an answer reads: the request queue (approval), the roster (recruit), /live (a card). */
export const rereadOf = order => ({ recruit: 'roster', revise: 'roster', approval: 'queue', card: 'live', campaign: 'live' })[routeOf(order)]

/** /live counts as re-read only when it answered after the order left (a failed refetch keeps the older data). `q` = the query state. */
export const liveRead = (q, startedAt) => Boolean(q) && q.status !== 'error' && (q.dataUpdatedAt || 0) >= startedAt

/** « Back » on a confirmation: a comment and a recruitment return to their draft; the others give up. */
export const backAction = order => (order?.verb === 'comment' || order?.verb === 'recruit' ? 'back' : 'cancel')

/**
 * Where the keyboard goes when an order ends (outcome shown or cancelled): the button that launched it, else the panel, else its toggle.
 * { kind: 'recruit' } (the « Recruit » button) or { kind: 'card', verb, board, task } (that card's button).
 */
export const focusTarget = out => (routeOf(out) === 'recruit' ? { kind: 'recruit' } : routeOf(out) === 'revise' ? { kind: 'revise' } : routeOf(out) === 'campaign' ? { kind: 'campaign' } : { kind: 'card', verb: out?.verb, board: out?.board, task: out?.task })

/** The same, as a CSS selector of the page (null for the recruitment: its button is found by `[data-recruit-open]`). */
export const focusSelector = out => {
  const f = focusTarget(out)
  return f.kind === 'card' ? `[data-order="${f.verb}"][data-board="${f.board}"][data-card="${f.task}"]` : f.kind === 'campaign' ? '[data-campaign-open]' : f.kind === 'revise' ? '[data-revise-open]' : '[data-recruit-open]'
}

/* ---------- an order cancelled by leaving the page ---------- */

/**
 * Leaving the page unmounts it and the 6 s window dies with it: the order never leaves. What stays is a line in the memory of the
 * tab (module state, NOT ctx.storage: it is a moment, not a preference), said ONCE when the page comes back, with the target.
 * Returns what to remember for a state that was counting, else null (a draft or a confirmation had committed nothing).
 */
export function leftBehind(state) {
  if (!state || state.phase !== 'counting' || !state.order) return null
  const o = state.order
  return { verb: o.verb, board: o.board, task: o.task, code: o.code, choice: o.choice, agent: o.agent, title: o.title }
}

let left = null
export const rememberLeft = info => { left = info || null }
/** The order cancelled by leaving, without forgetting it (React may render twice; `clearLeft` runs in an effect). */
export const peekLeft = () => left
export const clearLeft = () => { left = null }

/** The outcome the bar shows on the way back: cancelled, reason `left`, naming the target; nothing was sent. */
export const leftOutcome = info => (info ? { cancelled: true, reason: 'left', wasCounting: true, ...info } : null)
