/**
 * The one definition of the gateway's states (shared by core/office.js, core/tips.js and scene/model.js).
 * Hermes writes starting | running | degraded (alive, platforms retrying, crons run) | stopped | startup_failed.
 * Pure: strings in, booleans out.
 */
export const GATEWAY_STATES = Object.freeze(['starting', 'running', 'degraded', 'stopped', 'startup_failed'])

/** Only these two switch the office off: `starting` is not an outage. */
const DOWN_STATES = Object.freeze(['stopped', 'startup_failed'])

export const isGatewayKnown = state => GATEWAY_STATES.includes(state)
export const isGatewayDown = state => DOWN_STATES.includes(state)
export const isGatewayDegraded = state => state === 'degraded'
export const isGatewayUp = state => state === 'running'
