/** Hermes stores epoch seconds (floats); accept milliseconds defensively. */
export function toMs(value) {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n)
}

const UNITS = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000]
]

/**
 * "3 hours ago" / "il y a 3 heures" / "hace 3 horas", in the PLUGIN's language
 * (which may differ from the app's when the user overrides it).
 */
const FORMATTERS = new Map()
/** One formatter per language: building an Intl.RelativeTimeFormat costs far more than formatting with it, and a list calls this once per row. */
function relativeFormatter(locale) {
  const key = String(locale)
  let rtf = FORMATTERS.get(key)
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })   // an invalid language throws here, as before, and is not kept
    if (FORMATTERS.size >= 16) FORMATTERS.clear()
    FORMATTERS.set(key, rtf)
  }
  return rtf
}

export function formatRelative(targetMs, nowMs, locale) {
  if (typeof targetMs !== 'number') return ''
  const diff = targetMs - nowMs
  const rtf = relativeFormatter(locale)
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size || unit === 'second') return rtf.format(Math.round(diff / size), unit)
  }
  return ''
}
