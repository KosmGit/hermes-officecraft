/**
 * The ONE reading of the cards an agent is running. Pure: no SDK, no DOM, no clock (callers pass `nowMs`).
 * The label, its time bar, « since when », the inspector, the model badge and the replay panel all read it; none sorts the
 * running cards on its own any more.
 *
 * Definitions:
 *   running card   a `running` card assigned to the agent, every served board together (`agent.running` of buildOffice)
 *   main card      the running card that STARTED FIRST (smallest `startedMs`). It does not change when a new card starts.
 *                  Ties and unknown starts: board slug in alphabetical order, then id. A card with an unknown start comes
 *                  after every card with a known one (nothing is invented: an unknown start is never « the oldest »).
 *   silent card    a running card whose OWN last sign of life (`heartbeatMs`, else `startedMs`) is older than STALE_AFTER_MS
 *                  (the rule of hermes_officecraft/notify.py `silent`). A card with no sign at all is not said silent.
 */

export const STALE_AFTER_MS = 300_000

const known = ms => typeof ms === 'number' && ms > 0
const by = text => String(text ?? '')

/** Order of the main card: started first; then board slug, then id (stable from one refresh to the next). */
function order(a, b) {
  const ka = known(a.startedMs)
  const kb = known(b.startedMs)
  if (ka !== kb) return ka ? -1 : 1
  if (ka && a.startedMs !== b.startedMs) return a.startedMs - b.startedMs
  return by(a.board).localeCompare(by(b.board), 'en') || by(a.id).localeCompare(by(b.id), 'en')
}

/** How long this card has been silent, in ms; null when it is not (or when nothing says how old its last sign is). */
export function cardSilentMs(card, nowMs) {
  const sign = card?.heartbeatMs || card?.startedMs || 0
  if (!known(sign) || !(nowMs - sign > STALE_AFTER_MS)) return null
  return nowMs - sign
}

/**
 * The running cards of an agent, main card first: [{ ...card, silentMs }] (`silentMs` null = not silent, or no `nowMs`).
 * `agent.running` entries keep their own fields (board, id, title, startedMs, heartbeatMs, modelOverride…); the input is not changed.
 */
export function runningCards(agent, nowMs) {
  const list = Array.isArray(agent?.running) ? agent.running : []
  return list.filter(t => t && typeof t === 'object').sort(order).map(t => ({ ...t, silentMs: typeof nowMs === 'number' ? cardSilentMs(t, nowMs) : null }))
}

/**
 * The silent cards worth marking, the longest silent first (ties: the order of the main card).
 * One exception, to leave a single card exactly as it was: a bot that WORKS (a live worker session) with ONE running card has nothing to mark:
 * the card's heartbeat is the only card there is and the bot's state already says it works. Every other case marks the silent card:
 * several cards (the others may be fine), a bot waiting for you, a bot at rest. (A stale bot is marked by its state: callers skip it.)
 */
export function quietCards(cards, state = null) {
  if (state === 'working' && cards.length === 1) return []
  return cards.filter(c => c.silentMs).sort((a, b) => b.silentMs - a.silentMs)
}
