/** Small helpers shared by the pure core modules. */

/** A finite number, else null. */
export const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A recorded count: a finite number >= 0, else null (a negative column is absent). */
export const count = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/** A string as is, else ''. */
export const str = v => (typeof v === 'string' ? v : '')

/** A string without surrounding spaces, else ''. (models.js: model names are compared trimmed.) */
export const trimmed = v => (typeof v === 'string' ? v.trim() : '')

/** The latest timestamp a card carries (completed, started, created); 0 when none. */
export const lastTouch = t => Math.max(t.completedMs || 0, t.startedMs || 0, t.createdMs || 0)
