/**
 * The alert rail under the header. The page's warnings (incident, gateway, scheduled jobs, stale or partial reading, roster-only
 * mode) become one short chip each; the full sentence is the chip's detail (shown on demand). Pure: the page translates `id` + `args`.
 *
 *   incident   crit  boards with an open incident (game layer: never in sober mode) + their failures
 *   gateway    crit  the gateway is not running
 *   degraded   warn  the gateway is degraded
 *   crons      warn  scheduled jobs failing (count)
 *   stale      warn  the read of /live keeps failing (staleMs of the last good reading)
 *   partial    info  sources the agent half could not read
 *   roster     info  agents only: no agent half
 */
const ORDER = ['incident', 'gateway', 'degraded', 'crons', 'stale', 'partial', 'roster']
const TONE = { incident: 'crit', gateway: 'crit', degraded: 'warn', crons: 'warn', stale: 'warn', partial: 'info', roster: 'info' }
const RANK = { crit: 0, warn: 1, info: 2 }

export function alertsOf({ incidentBoards = [], incidentFails = 0, gatewayDown = false, gatewayDegraded = false, failingCrons = 0, banner = null, rosterOnly = false } = {}) {
  const out = []
  if (incidentBoards.length) out.push({ id: 'incident', args: { boards: incidentBoards, fails: incidentFails } })
  if (gatewayDown) out.push({ id: 'gateway', args: {} })
  else if (gatewayDegraded) out.push({ id: 'degraded', args: {} })
  if (failingCrons > 0) out.push({ id: 'crons', args: { n: failingCrons } })
  if (banner?.staleMs != null) out.push({ id: 'stale', args: { staleMs: banner.staleMs } })
  if (banner?.partial?.labels?.length) out.push({ id: 'partial', args: { partial: banner.partial } })
  if (rosterOnly) out.push({ id: 'roster', args: {} })
  return out.map(a => ({ ...a, tone: TONE[a.id] })).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
}

/** In a narrow pane one chip stands for all: the worst one, and how many others hide behind it. */
export function foldAlerts(alerts) {
  if (!alerts.length) return null
  const worst = [...alerts].sort((a, b) => RANK[a.tone] - RANK[b.tone] || ORDER.indexOf(a.id) - ORDER.indexOf(b.id))[0]
  return { worst, more: alerts.length - 1 }
}

/**
 * How many chips of the rail fit on one line. `widths` are the chips' natural widths in rail order; the others fold into one « +N » chip
 * of width `plus`, which must fit too. Always at least one chip (the worst, the rail is sorted by weight), never more than there are.
 * An unknown width (0: not measured yet) counts as nothing, so the first pass shows everything and the second one folds.
 */
export function railFit(widths, avail, { gap = 8, plus = 56 } = {}) {
  const n = widths.length
  if (n === 0 || !(avail > 0) || widths.every(w => !(w > 0))) return n
  const used = k => widths.slice(0, k).reduce((s, w, i) => s + w + (i ? gap : 0), 0)
  if (used(n) <= avail) return n
  for (let k = n - 1; k >= 1; k--) if (used(k) + gap + plus <= avail) return k
  return 1
}
