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

/**
 * Text written by a bot or a stranger, as one line the page may draw: control and line-separator characters become a blank, format
 * characters (bidi overrides and isolates, zero-width) go, runs of blanks collapse, the ends are trimmed. Markup is NOT interpreted
 * or removed here (the page draws text, never HTML): `<b>` stays the five characters it is.
 */
export const oneLine = v => str(v).replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim()

/** At most `max` characters, cut on a word and closed with « … » (the same rule as the agent half's `_block_reason`). */
export function cutWords(text, max) {
  const chars = [...str(text)]
  if (chars.length <= max) return chars.join('')
  let head = chars.slice(0, max - 1)
  if (chars[max - 1] !== ' ' && head.lastIndexOf(' ') >= Math.floor(max / 2)) head = head.slice(0, head.lastIndexOf(' '))
  return `${head.join('').replace(/[\s,;:.—–·(-]+$/u, '')}…`
}
