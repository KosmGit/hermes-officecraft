import { haptic, host } from '@hermes/plugin-sdk'

import { sessionToOpen } from '../core/roster.js'

/** Same mechanism the desk cards used: the SDK's host.openSession on the agent's latest human session. */
export const canOpenSession = desk => Boolean(sessionToOpen(desk)) && typeof host?.openSession === 'function'

export function openDeskSession(desk) {
  const target = sessionToOpen(desk)
  if (!target || typeof host?.openSession !== 'function') return false
  haptic?.('tap')
  host.openSession(target.id, { profile: target.profile })
  return true
}

/** The app has no deep link to one card (the board is an internal atom of the kanban plugin): the page opens the kanban itself. */
export const canOpenKanban = () => typeof host?.navigate === 'function'

export function openKanban() {
  if (!canOpenKanban()) return false
  haptic?.('tap')
  host.navigate('/kanban')
  return true
}
