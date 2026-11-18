/**
 * Day / night follows the system clock (no manual switch): night from 19:00 to 07:00 local time.
 * Pure, so the scene and the tests share it.
 */
export const NIGHT_FROM_HOUR = 19
export const DAY_FROM_HOUR = 7

export function lightModeAt(date = new Date()) {
  const h = date.getHours()
  return h >= NIGHT_FROM_HOUR || h < DAY_FROM_HOUR ? 'night' : 'day'
}

/** Light setting (Settings → Plugins → Officecraft → Light): follow the clock, or force day or night. */
export const LIGHT_PREFS = Object.freeze(['auto', 'day', 'night'])
export const isLightPref = value => LIGHT_PREFS.includes(value)

/** 'day' | 'night' for a setting at a given moment: a forced choice wins, anything else follows the clock. */
export function resolveLight(pref, date = new Date()) {
  return pref === 'day' || pref === 'night' ? pref : lightModeAt(date)
}

/** Motion setting: follow the system (`prefers-reduced-motion`), or force reduced motion. */
export const MOTION_PREFS = Object.freeze(['auto', 'reduced'])
export const isMotionPref = value => MOTION_PREFS.includes(value)

/** True when nothing may animate: the user asked for it here, or their system did. */
export const motionReduced = (pref, systemReduced) => pref === 'reduced' || Boolean(systemReduced)

/** Milliseconds until the next switch, to schedule a single re-render instead of polling. */
export function msUntilNextSwitch(date = new Date()) {
  const next = new Date(date)
  const h = date.getHours()
  next.setHours(h >= DAY_FROM_HOUR && h < NIGHT_FROM_HOUR ? NIGHT_FROM_HOUR : DAY_FROM_HOUR, 0, 0, 0)
  if (next <= date) next.setDate(next.getDate() + 1)
  return next - date
}

/**
 * Milliseconds until the page clock must be taken again: the next full minute (the wall clock, silence spans and
 * « ago » labels move by the minute) or the day/night switch, whichever comes first. One timer, never a poll.
 */
export function msUntilPageTick(date = new Date()) {
  const toMinute = 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds())
  return Math.max(1, Math.min(toMinute, msUntilNextSwitch(date)))
}

/** The page clock's next timer: none while the window is hidden, else `msUntilPageTick`. */
export const pageTickDelay = (hidden, date = new Date()) => (hidden ? null : msUntilPageTick(date))
