/**
 * How often the page asks `/health` again (the agent half's presence). Pure: no SDK, no DOM.
 * A present half is asked once (it does not go away without a reload). An absent or unreachable one is asked
 * again every 30 s while the page is mounted and visible: a transient network error, or the agent half installed /
 * the gateway restarted meanwhile, must not keep the office read-only until the next reload.
 * 30 s is well under the « ≤ 1 request / 5 s per source » rule.
 */
export const HEALTH_RETRY_MS = 30_000

/** data: what the health query holds (`{ present, ... }`) or undefined. -> ms to the next ask, or false (never). */
export const healthPollMs = data => (data?.present ? false : HEALTH_RETRY_MS)
