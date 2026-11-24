/**
 * Numbers, percentages and clock times in the language of the plugin (not the system's, not English's). Pure: no SDK, no DOM.
 * An Intl formatter costs a few tenths of a millisecond to build, so each one is built once per language and kept.
 */

const FORMATTERS = new Map()

function formatter(kind, lang) {
  const key = `${kind}|${lang}`
  let f = FORMATTERS.get(key)
  if (!f) {
    const build = l => {
      if (kind === 'number') return new Intl.NumberFormat(l)
      if (kind === 'percent') return new Intl.NumberFormat(l, { style: 'percent', maximumFractionDigits: 1 })
      return new Intl.DateTimeFormat(l, { hour: '2-digit', minute: '2-digit' })
    }
    try { f = build(lang) } catch { f = build('en') }   // a malformed language tag still reads
    FORMATTERS.set(key, f)
  }
  return f
}

const finite = n => typeof n === 'number' && Number.isFinite(n)

/** 8000 -> « 8,000 » (en), « 8 000 » (fr, narrow no-break space), « 8000 » (es: four digits are not grouped). null for anything that is not a finite number. */
export function numberText(n, lang = 'en') {
  return finite(n) ? formatter('number', lang).format(n) : null
}

/** A share given in percent points (48 -> « 48% » en, « 48 % » fr and es, with the language's own space). One decimal at most. null for anything that is not a finite number. */
export function percentText(p, lang = 'en') {
  return finite(p) ? formatter('percent', lang).format(p / 100) : null
}

/** A clock time (ms since the epoch) as hours and minutes in the language of the plugin, in the machine's time zone. Empty without a date. */
export function timeText(ms, lang = 'en') {
  if (!finite(ms)) return ''
  return formatter('time', lang).format(new Date(ms))
}

/** How many formatters are alive (a test reads it: one per kind and language, never one per call). */
export const formattersBuilt = () => FORMATTERS.size
