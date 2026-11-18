/**
 * Usage and costs: what Hermes RECORDED about its own use, from `GET /usage`, the runs of `GET /replay`, and the
 * account's quota read from Hermes (`model.options`, `usage.bars`). Pure: no SDK, no DOM, no clock of its own, so
 * tests/js/usage.test.mjs checks every decision by value under node.
 *
 * Rule of gold: a number is shown only when Hermes recorded it. An absent datum is `null` here and « absent » on screen, NEVER 0:
 *   - a profile with no usage base, an unreadable one, a column that is NULL: `null` and a `reason` (never summed as 0);
 *   - a profile with no session started in the window: `none` (there is nothing to count), not « 0 tokens »;
 *   - dollars only on a route Hermes can price (`priced`), only per row, never a total across routes (a priced and an unpriced route
 *     are never added together), always « Hermes' estimate, not an invoice »;
 *   - the breakdown by model includes auxiliary tasks and can exceed the sessions' total: it is shown as a breakdown, never added to it.
 */
import { toPartial } from './history.js'
import { clockLabel, toReplay } from './replay.js'
import { count, num, str } from './util.js'

export const USAGE_WINDOWS = Object.freeze(['24h', '7d', '30d'])
export const USAGE_METRICS = Object.freeze(['fresh', 'all'])
export const DAYS_SHOWN = 7
/** The day-by-day chart follows the chosen window — 24 h touches 2 local days at most (yesterday, today so far), 7 days = 7, 30 days = 30. */
export const DAYS_BY_WINDOW = Object.freeze({ '24h': 2, '7d': 7, '30d': 30 })
export const daysFor = kind => DAYS_BY_WINDOW[kind] ?? DAYS_SHOWN
const WINDOW_MS = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }
const COST_KINDS = new Set(['estimated', 'actual', 'unpriced'])
const STATES = new Set(['missing', 'unreadable', 'locked', 'schema', 'no_sessions', 'no_breakdown'])

/** The window to read: whole seconds, ending now. */
export function usageWindow(kind, nowMs) {
  const span = WINDOW_MS[kind] ?? WINDOW_MS['24h']
  return { kind: WINDOW_MS[kind] ? kind : '24h', fromMs: nowMs - span, toMs: nowMs, fromS: Math.floor((nowMs - span) / 1000), toS: Math.max(Math.floor((nowMs - span) / 1000) + 1, Math.floor(nowMs / 1000)) }
}

/** The last `n` local days, oldest first; the last one ends now. Local midnights (DST: a day of 23 or 25 h is what it is). */
export function dayRanges(nowMs, n = DAYS_SHOWN) {
  const out = []
  const today = new Date(nowMs)
  today.setHours(0, 0, 0, 0)
  for (let i = n - 1; i >= 0; i -= 1) {
    const from = new Date(today)
    from.setDate(from.getDate() - i)
    const next = new Date(from)
    next.setDate(next.getDate() + 1)
    const fromMs = from.getTime()
    const toMs = i === 0 ? nowMs : next.getTime() - 1000
    out.push({ fromMs, toMs, fromS: Math.floor(fromMs / 1000), toS: Math.max(Math.floor(fromMs / 1000) + 1, Math.floor(toMs / 1000)), past: i > 0 })
  }
  return out
}

/* ---------- the body of /usage ---------- */

function toTokens(raw) {
  if (!raw || typeof raw !== 'object') return null
  const t = { input: num(raw.input), output: num(raw.output), cacheRead: num(raw.cacheRead), cacheWrite: num(raw.cacheWrite), reasoning: num(raw.reasoning) }
  for (const k of Object.keys(t)) if (t[k] != null && t[k] < 0) t[k] = null
  return Object.values(t).every(v => v == null) ? null : t
}

function toLine(m) {
  if (!m || typeof m !== 'object') return null
  const model = str(m.model).slice(0, 120)
  if (!model) return null
  const priced = m.priced === true
  const usd = priced && num(m.usd) != null && m.usd >= 0 ? m.usd : null   // a route without a price has NO amount, whatever the body says
  return {
    model, provider: str(m.provider).slice(0, 120), task: /^[a-z_]{0,40}$/.test(str(m.task)) ? str(m.task) : '', apiCalls: count(m.apiCalls), tokens: toTokens(m.tokens),
    priced, usd, costKind: priced ? (COST_KINDS.has(m.costKind) && m.costKind !== 'unpriced' ? m.costKind : 'estimated') : 'unpriced', costSource: str(m.costSource).slice(0, 40)
  }
}

function toProfile(p) {
  const profile = str(p?.profile)
  if (!profile) return null
  const reason = STATES.has(p.reason) ? p.reason : null
  return {
    profile, sessions: count(p.sessions), apiCalls: count(p.apiCalls), tokens: toTokens(p.tokens), reason,
    models: Array.isArray(p.models) ? p.models.map(toLine).filter(Boolean) : null
  }
}

/** `GET /usage` body -> { ok, fromMs, toMs, profiles, routes, partial } (ok:false when it is not that). */
export function toUsage(body) {
  const sec = v => (num(v) != null && v >= 0 ? Math.round(v * 1000) : null)
  if (!body || body.ok !== true || !Array.isArray(body.profiles) || sec(body.from) == null || sec(body.to) == null) return { ok: false, profiles: [], routes: [] }
  return {
    ok: true,
    fromMs: sec(body.from),
    toMs: sec(body.to),
    profiles: body.profiles.map(toProfile).filter(Boolean),
    routes: (Array.isArray(body.routes) ? body.routes : []).filter(r => r && str(r.model)).map(r => ({ model: str(r.model).slice(0, 120), provider: str(r.provider).slice(0, 120), priced: r.priced === true })),
    partial: toPartial(body.partial) ?? []
  }
}

/* ---------- tokens ---------- */

/**
 * The parts of a token record, by metric. `fresh` = input + output (what was read and written); `all` adds the cache (read + written).
 * A part Hermes did not record is `null` and is left out of the total, which is then flagged `incomplete` (a lower bound, said so).
 * -> { input, output, cache, total, incomplete } | null (nothing recorded).
 */
export function tokenParts(tokens, metric = 'fresh') {
  if (!tokens) return null
  const cache = tokens.cacheRead == null && tokens.cacheWrite == null ? null : (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0)
  const parts = metric === 'all' ? [tokens.input, tokens.output, cache] : [tokens.input, tokens.output]
  if (parts.every(v => v == null)) return null
  return { input: tokens.input, output: tokens.output, cache: metric === 'all' ? cache : null, total: parts.reduce((s, v) => s + (v ?? 0), 0), incomplete: parts.some(v => v == null) }
}

const addPart = (a, b) => (a == null ? b : b == null ? a : a + b)

/** Adds token records; a part is null only when no record had it. */
export function addTokens(list) {
  let out = null
  for (const t of list) {
    if (!t) continue
    out = out ?? { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null }
    for (const k of Object.keys(out)) out[k] = addPart(out[k], t[k])
  }
  return out
}

/* ---------- by agent ---------- */

/** How a profile row stands: `ok` (counted), `none` (no session in the window: nothing to count), `absent` (no base / unreadable: Hermes has no record). */
const rowState = p => (p.reason === 'no_sessions' ? 'none' : p.sessions == null || p.reason === 'missing' || p.reason === 'unreadable' || p.reason === 'locked' || p.reason === 'schema' ? 'absent' : 'ok')

/** The cost of a list of breakdown lines: one amount only when EVERY line is priced and carries its amount; else the priced part is kept apart. */
export function costOf(lines) {
  const list = lines ?? []
  if (!list.length) return { kind: 'none', usd: null, pricedUsd: null, unpriced: 0, source: '' }
  const priced = list.filter(l => l.priced && l.usd != null)
  const unpriced = list.length - priced.length
  const sum = priced.reduce((s, l) => s + l.usd, 0)
  const source = [...new Set(priced.map(l => l.costSource).filter(Boolean))].join(', ')
  if (!priced.length) return { kind: 'unpriced', usd: null, pricedUsd: null, unpriced, source: '' }
  if (unpriced) return { kind: 'mixed', usd: null, pricedUsd: sum, unpriced, source }
  return { kind: 'priced', usd: sum, pricedUsd: sum, unpriced: 0, source }
}

/**
 * The agents of a `/usage` answer, biggest first: [{ profile, state, sessions, calls, parts, cost }] and the totals over the counted ones.
 * `totals` is null when no agent has a record (never a sum of nothing shown as 0).
 */
export function agentRows(usage, metric = 'fresh') {
  const rows = (usage?.profiles ?? []).map(p => ({
    profile: p.profile, state: rowState(p), reason: p.reason, sessions: p.sessions, calls: p.apiCalls, tokens: p.tokens,
    parts: tokenParts(p.tokens, metric), cost: costOf(p.models)
  }))
  const rank = { ok: 0, none: 1, absent: 2 }
  rows.sort((a, b) => rank[a.state] - rank[b.state] || (b.parts?.total ?? -1) - (a.parts?.total ?? -1) || a.profile.localeCompare(b.profile))
  const counted = rows.filter(r => r.state === 'ok')
  const tokens = addTokens(counted.map(r => r.tokens))
  const totals = counted.length ? {
    sessions: counted.reduce((s, r) => addPart(s, r.sessions), null),
    calls: counted.reduce((s, r) => addPart(s, r.calls), null),
    tokens,
    parts: tokenParts(tokens, metric),
    incomplete: counted.some(r => r.parts == null || r.parts.incomplete)
  } : null
  return { rows, totals, none: rows.filter(r => r.state === 'none').length, absent: rows.filter(r => r.state === 'absent').length }
}

/* ---------- by model ---------- */

/**
 * The breakdown by model (route): the lines of `session_model_usage` merged across agents and tasks, biggest first. A row is priced only if
 * every merged line is; its amount is the sum of THAT route's lines. No total across rows. `aux` = the part that is not the main loop.
 * It is a breakdown (auxiliary tasks included): it is never compared to or added to the agents' total.
 */
export function modelRows(usage, metric = 'fresh') {
  const by = new Map()
  let known = 0
  let withoutBreakdown = 0
  for (const p of usage?.profiles ?? []) {
    if (p.models == null) { if (rowState(p) === 'ok') withoutBreakdown += 1; continue }
    for (const l of p.models) {
      known += 1
      const key = `${l.provider}\u0000${l.model}`
      const r = by.get(key) ?? { model: l.model, provider: l.provider, lines: [], tokens: null, calls: null, auxCalls: null, tasks: new Set() }
      r.lines.push(l)
      r.tokens = addTokens([r.tokens, l.tokens])
      r.calls = addPart(r.calls, l.apiCalls)
      if (l.task) { r.auxCalls = addPart(r.auxCalls, l.apiCalls); r.tasks.add(l.task) }
      by.set(key, r)
    }
  }
  const rows = [...by.values()].map(r => ({
    model: r.model, provider: r.provider, calls: r.calls, auxCalls: r.auxCalls, tasks: [...r.tasks].sort(), tokens: r.tokens,
    parts: tokenParts(r.tokens, metric), cost: costOf(r.lines)
  }))
  rows.sort((a, b) => (b.parts?.total ?? -1) - (a.parts?.total ?? -1) || a.model.localeCompare(b.model))
  return { rows, lines: known, withoutBreakdown }
}

/* ---------- by board (from the runs of /replay: kanban workers only) ---------- */

/**
 * Per board, from the runs of a replay: how many runs, how many carry a recorded usage, the tokens of those. Runs with no usage are counted
 * apart (`without`), never as 0. Only the kanban workers' runs: a session outside a kanban card has no board.
 */
export function boardRows(replay, metric = 'fresh') {
  const rows = (replay?.boards ?? []).map(b => {
    const withUsage = b.runs.filter(r => r.usage && r.usage.apiCalls != null)
    const tokens = addTokens(withUsage.map(r => ({ input: r.usage.input, output: r.usage.output, cacheRead: r.usage.cacheRead, cacheWrite: r.usage.cacheWrite, reasoning: r.usage.reasoning })))
    return {
      slug: b.slug, runs: b.runs.length, with: withUsage.length, without: b.runs.length - withUsage.length,
      calls: withUsage.length ? withUsage.reduce((s, r) => s + r.usage.apiCalls, 0) : null, tokens, parts: tokenParts(tokens, metric)
    }
  })
  rows.sort((a, b) => (b.parts?.total ?? -1) - (a.parts?.total ?? -1) || a.slug.localeCompare(b.slug))
  return { rows, runs: rows.reduce((s, r) => s + r.runs, 0) }
}

/** Boards can be asked only inside what `/replay` serves. */
export const boardsAvailable = kind => kind !== '30d'

export { toReplay }

/* ---------- day by day ---------- */

/**
 * `days` = [{ fromMs, toMs, usage|null }] (usage = toUsage of that day's answer; null = the read failed). -> [{ fromMs, state, parts, calls, sessions }]
 * `ok` = a recorded total; `none` = no session that day (a quiet day: no bar, no « 0 »); `failed` = no answer for that day.
 */
export function dailySeries(days, metric = 'fresh') {
  return days.map(d => {
    if (!d.usage || !d.usage.ok) return { fromMs: d.fromMs, toMs: d.toMs, state: 'failed', parts: null, calls: null, sessions: null }
    const a = agentRows(d.usage, metric)
    if (!a.totals) return { fromMs: d.fromMs, toMs: d.toMs, state: a.absent && !a.none ? 'failed' : 'none', parts: null, calls: null, sessions: a.none && !a.absent ? 0 : null }
    return { fromMs: d.fromMs, toMs: d.toMs, state: a.totals.parts ? 'ok' : 'none', parts: a.totals.parts, calls: a.totals.calls, sessions: a.totals.sessions }
  })
}

/** The scale of a chart: the biggest recorded total (never below 1 so a lone small day still draws). */
export const peakOf = totals => Math.max(1, ...totals.filter(v => v != null))

/** Height of a bar as a share of the peak, in [0, 1]; a recorded total > 0 keeps at least 2 % (a visible bar). */
export function share(value, peak) {
  if (value == null || !(peak > 0)) return null
  if (value <= 0) return 0
  return Math.min(1, Math.max(0.02, value / peak))
}

/**
 * The split of a row's tokens (input, output, cache, in that order) as shares of what was recorded, for the ring of the Resources
 * window. A part Hermes did not record (null) or that is zero is absent, never drawn as 0 %; no recorded part at all gives no ring.
 * `pct` is the whole-number share (the shares themselves keep their exact value for the arcs).
 */
export function splitShares(parts) {
  if (!parts) return []
  const items = [['in', parts.input], ['out', parts.output], ['cache', parts.cache]].filter(([, v]) => Number.isFinite(v) && v > 0)
  const sum = items.reduce((n, [, v]) => n + v, 0)
  if (!(sum > 0)) return []
  return items.map(([key, value]) => ({ key, value, share: value / sum, pct: Math.round((value / sum) * 100) }))
}

/* ---------- the quota of the account (model.options) and the Nous balance (usage.bars) ---------- */

const iso = v => {
  if (typeof v !== 'string' || !v) return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

function toWindow(w) {
  if (!w || typeof w !== 'object') return null
  const used = num(w.used_percent)
  if (used == null) return null
  return { label: str(w.label).slice(0, 60), usedPercent: Math.min(100, Math.max(0, used)), resetsAtMs: iso(w.resets_at), scope: w.scope === 'model' ? 'model' : 'account' }
}

const sameWindows = (a, b) => a.length === b.length && a.every((w, i) => w.label === b[i].label && w.usedPercent === b[i].usedPercent && w.resetsAtMs === b[i].resetsAtMs)

/**
 * The quota windows of the providers the usage actually went through. `payload` = the `model.options` answer (only `providers[].slug`,
 * `usage.windows`, `usage.accounts[]` are read: nothing else is kept). Providers that report the SAME windows (one account behind several
 * routes) are one group. A provider with several accounts keeps each apart (never an average). -> { groups: [{ providers, account, windows }], missing }
 * `missing` = routes' providers with no windows (cache not warm yet, or a provider that reports none): said absent, never 0 %.
 */
export function quotaOf(payload, routes) {
  const wanted = [...new Set((routes ?? []).map(r => r.provider).filter(Boolean))]
  const rows = Array.isArray(payload?.providers) ? payload.providers : []
  const groups = []
  const missing = []
  for (const slug of wanted) {
    const row = rows.find(r => r && r.slug === slug)
    const usage = row?.usage
    const entries = []
    if (usage && Array.isArray(usage.accounts)) {
      for (const a of usage.accounts) {
        const windows = (Array.isArray(a?.windows) ? a.windows : []).map(toWindow).filter(Boolean)
        if (windows.length) entries.push({ account: str(a.label).slice(0, 40) || null, windows })
      }
    } else if (usage && Array.isArray(usage.windows)) {
      const windows = usage.windows.map(toWindow).filter(Boolean)
      if (windows.length) entries.push({ account: null, windows })
    }
    if (!entries.length) { missing.push(slug); continue }
    for (const e of entries) {
      const twin = groups.find(g => g.account === e.account && sameWindows(g.windows, e.windows))
      if (twin) { if (!twin.providers.includes(slug)) twin.providers.push(slug) } else groups.push({ providers: [slug], account: e.account, windows: e.windows })
    }
  }
  return { groups, missing }
}

/** `usage.bars` -> the balance of the Nous account as Hermes formats it, only when `available` (else null: nothing to show). Never per agent. */
export function nousBalance(body) {
  if (!body || body.available !== true) return null
  const text = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : null)
  const bar = b => (b && typeof b === 'object' && num(b.fill_fraction) != null ? { fill: Math.min(1, Math.max(0, b.fill_fraction)), remaining: text(b.remaining_display), total: text(b.total_display), spent: text(b.spent_display) } : null)
  const out = { plan: text(body.plan_name), renews: text(body.renews_display), spendable: text(body.total_spendable_display), planBar: bar(body.plan_bar), topupBar: bar(body.topup_bar) }
  return out.spendable || out.planBar || out.topupBar ? out : null
}

/* ---------- numbers on screen ---------- */

/** Tokens, rounded for reading: 999 -> « 999 », 1 234 -> « 1.2K », 1 234 567 -> « 1.2M »; the exact number is in the tooltip. null -> null (never « 0 »). */
export function tokenLabel(n, lang = 'en') {
  if (n == null || !Number.isFinite(n)) return null
  const unit = Math.abs(n) >= 1e9 ? 1e9 : Math.abs(n) >= 1e6 ? 1e6 : Math.abs(n) >= 1e3 ? 1e3 : 1
  try {
    return new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: Math.abs(n) / unit >= 100 || unit === 1 ? 0 : 1 }).format(n)
  } catch {
    return String(Math.round(n))
  }
}

export function exactLabel(n, lang = 'en') {
  if (n == null || !Number.isFinite(n)) return null
  try {
    return new Intl.NumberFormat(lang).format(n)
  } catch {
    return String(n)
  }
}

/** Dollars: two decimals; under one cent four (a price per call can be 0.0003 $); a recorded 0 stays « 0.00 ». null -> null. */
export function usdLabel(usd, lang = 'en') {
  if (usd == null || !Number.isFinite(usd)) return null
  if (usd > 0 && usd < 0.0001) return '< 0.0001'.replace('.', new Intl.NumberFormat(lang).format(1.1).charAt(1))   // never « 0.0000 » for a positive amount
  const digits = usd > 0 && usd < 0.01 ? 4 : 2
  try {
    return new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(usd)
  } catch {
    return usd.toFixed(digits)
  }
}

/** The bounds of the period. Beyond a week the weekday and day alone are ambiguous (30 days: « 14 Wed → 13 Fri »): the month is written. */
export function rangeLabel(fromMs, toMs, lang = 'en') {
  if (toMs - fromMs <= 8 * 86_400_000) return `${clockLabel(fromMs, lang, { day: true })} → ${clockLabel(toMs, lang, { day: true })}`
  const f = ms => {
    try {
      return `${new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(new Date(ms))} ${clockLabel(ms, lang)}`
    } catch {
      return new Date(ms).toISOString().slice(0, 16)
    }
  }
  return `${f(fromMs)} → ${f(toMs)}`
}

/** A quota percentage: whole numbers (the provider's own precision is coarser). */
export const percentLabel = p => (p == null || !Number.isFinite(p) ? null : String(Math.round(p)))
