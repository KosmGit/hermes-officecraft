import { atom } from '@hermes/plugin-sdk'

import { isLightPref, isMotionPref } from '../core/daylight.js'
import { isLanguagePref } from '../core/locale.js'
import { normalizeNight } from '../core/replay.js'
import { isSeatChoice } from '../core/seating.js'
import { panelOpenOf } from '../core/uistate.js'

/**
 * Per-machine preferences, persisted in ctx.storage (keys live under
 * `hermes.plugin.hermes-officecraft.`). Exposed as atoms so React re-renders and
 * register() can re-label contributions when they change.
 */
export const $languagePref = atom('auto')
/** Game layer (achievements, unlockable decor, grades, mascot, seasons). On by default; Settings → Plugins → Officecraft → Game. */
export const $gameMode = atom(true)
/** Light: 'auto' (computer clock, night 19 h – 7 h) | 'day' | 'night'. */
export const $lightPref = atom('auto')
/** Motion: 'auto' (follows the system's reduced-motion setting) | 'reduced' (nothing animates). */
export const $motionPref = atom('auto')

/** The night « what happened this night » covers: whole hours { from, to } on the local clock (default 19 h – 7 h, the light's). Kept per machine. */
export const $nightPref = atom({ from: 19, to: 7 })

/** Side panel open (true) or folded (false) on a wide pane: a layout preference, kept per machine. The drawer of a narrow pane stays transient. */
export const $panelOpen = atom(true)

/** Seating: 'relays' (neighbours follow the real hand-offs, the default once the function is on) | 'model' (the order the model proposed) | 'default' (by name). Kept per machine. */
export const $seatChoice = atom('relays')

// Every choice is written as an explicit value, « auto » and « on » included, never removed: in the webapp the host's
// storage mirrors shared keys, and a removed key came back on the next load (measured: Motion « reduced » returned
// after choosing Automatic), so the only way to go back to the default is to store it.
let storage = null

export function initPrefs(ctx) {
  storage = ctx?.storage ?? null
  const saved = storage?.get?.('language', 'auto')
  $languagePref.set(isLanguagePref(saved) ? saved : 'auto')
  $gameMode.set(storage?.get?.('game', true) !== false)
  const light = storage?.get?.('light', 'auto')
  $lightPref.set(isLightPref(light) ? light : 'auto')
  const motion = storage?.get?.('motion', 'auto')
  $motionPref.set(isMotionPref(motion) ? motion : 'auto')
  $nightPref.set(normalizeNight(storage?.get?.('night', null)))
  $panelOpen.set(panelOpenOf(storage?.get?.('panel', true)))
  const seating = storage?.get?.('seating', 'relays')
  $seatChoice.set(isSeatChoice(seating) ? seating : 'relays')
}

// « Already seen » achievements: the only game state kept, per machine. null = first launch on this machine.
// Kept in memory too, so a host without storage announces once per page load, not on every poll.
let seenMemory = null

export function readSeen() {
  const stored = storage?.get?.('seen', null)
  return Array.isArray(stored) ? stored.filter(id => typeof id === 'string') : seenMemory
}

export function writeSeen(ids) {
  seenMemory = [...ids]
  storage?.set?.('seen', seenMemory)
}

export function setGameMode(on) {
  $gameMode.set(Boolean(on))
  storage?.set?.('game', Boolean(on))
}

export function setLanguagePref(value) {
  const next = isLanguagePref(value) ? value : 'auto'
  $languagePref.set(next)
  storage?.set?.('language', next)
}

export function setLightPref(value) {
  const next = isLightPref(value) ? value : 'auto'
  $lightPref.set(next)
  storage?.set?.('light', next)
}

/** The night window: an invalid one is the default (the same hour twice is a 24 h night); stored as an explicit value, never removed. */
export function setNightPref(value) {
  const next = normalizeNight(value)
  $nightPref.set(next)
  storage?.set?.('night', next)
}

export function setPanelOpen(open) {
  const next = open !== false
  $panelOpen.set(next)
  storage?.set?.('panel', next)   // explicit true / false, never removed (same rule as the other keys)
}

export function setSeatChoice(value) {
  const next = isSeatChoice(value) ? value : 'relays'
  $seatChoice.set(next)
  storage?.set?.('seating', next)   // explicit value, never removed (same rule as the other keys)
}

export function setMotionPref(value) {
  const next = isMotionPref(value) ? value : 'auto'
  $motionPref.set(next)
  storage?.set?.('motion', next)
}
