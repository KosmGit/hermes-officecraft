import { useQuery } from '@hermes/plugin-sdk'
import { useEffect, useRef } from 'react'

import { PLUGIN_ID } from '../constants.js'
import { dayRanges, daysFor, nousBalance, toUsage, usageWindow } from '../core/usage.js'
import { safeRequest } from './rpc.js'

/** One read of each source a minute at most: the numbers are sessions' totals, not a live meter. */
export const USAGE_POLL_MS = 60_000
/** Hermes refreshes the account's quota in its cache every 2 minutes at most (agent/account_usage_cache.py): asking faster learns nothing. */
export const QUOTA_POLL_MS = 120_000
/** The first read of a process may find the quota cache cold (Hermes warms it in the background): one more look, a little later. */
export const QUOTA_RETRY_MS = 8_000

const read = async (ctx, from, to) => {
  const body = toUsage(await ctx.rest(`/usage?from=${from}&to=${to}`, { timeoutMs: 20_000 }))
  if (!body.ok) throw new Error('usage read failed')
  return body
}

/** `GET /usage` for a window ending now: the sessions started in it. Read when the window is chosen, then once a minute while shown. */
export function useUsage(ctx, { enabled, kind = '24h', nowMs = Date.now }) {
  return useQuery({
    queryKey: [PLUGIN_ID, 'usage', kind],
    queryFn: async () => {
      const w = usageWindow(kind, typeof nowMs === 'function' ? nowMs() : nowMs)
      return { ...(await read(ctx, w.fromS, w.toS)), kind }
    },
    enabled: Boolean(enabled) && typeof ctx?.rest === 'function',
    refetchInterval: USAGE_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,
    staleTime: USAGE_POLL_MS / 2,
    retry: 1,
    retryDelay: 5_000
  })
}

/**
 * `GET /usage` counts the tokens of a session on the day it STARTED, and a session keeps growing until it ends: one started at 23:50 and
 * finished at 00:40 still adds to « yesterday » after midnight (a bar read at 00:05 said 40 000, the route said 250 000 at 06:45). A day that
 * is over is therefore kept for good only once it has been read at least DAY_GRACE_MS after its end (a session that long is a long one: past that
 * the bar is taken as final); until then it is read again, at most once a minute (the poll), like today. The table keeps the last DAYS_KEPT days.
 */
export const DAY_GRACE_MS = 24 * 3_600_000
export const DAYS_KEPT = 45
const DAY_READ_GAP_MS = USAGE_POLL_MS
/** fromS -> { usage, readMs (when it was read), final }. Bounded: the oldest days leave first. */
const dayTable = new Map()

/** What the table knows of the day `d` at `nowMs`: kept as it is while it is final or was read less than a minute ago; else null (to be read). */
const dayKept = (d, nowMs) => {
  const hit = dayTable.get(d.fromS)
  return hit && (hit.final || nowMs - hit.readMs < DAY_READ_GAP_MS) ? hit.usage : null
}
const dayKeep = (d, usage, nowMs) => {
  dayTable.set(d.fromS, { usage, readMs: nowMs, final: d.past && nowMs >= d.toMs + 1000 + DAY_GRACE_MS })
  if (dayTable.size > DAYS_KEPT) for (const key of [...dayTable.keys()].sort((x, y) => x - y).slice(0, dayTable.size - DAYS_KEPT)) dayTable.delete(key)
}
/** The table as it stands (tests). */
export const usageDayTable = () => dayTable

/**
 * The last days one by one (`GET /usage` per local day: the route gives no per-day split, and the tokens of a session are not dated per
 * call, so each day counts the sessions STARTED that day). Read in sequence, never in parallel; a failed day is `usage: null` (said
 * « no answer », never 0) and is asked again next time; a day over but not final yet keeps its last reading when a new one fails.
 */
export function useUsageDays(ctx, { enabled, kind = '7d', nowMs = Date.now }) {
  const n = daysFor(kind)
  return useQuery({
    queryKey: [PLUGIN_ID, 'usage-days', n],
    queryFn: async () => {
      const now = typeof nowMs === 'function' ? nowMs() : nowMs
      const days = dayRanges(now, n)
      const out = []
      for (const d of days) {
        let usage = dayKept(d, now)
        if (!usage) {
          try { usage = await read(ctx, d.fromS, d.toS); dayKeep(d, usage, now) } catch { usage = d.past ? dayTable.get(d.fromS)?.usage ?? null : null }
        }
        out.push({ fromMs: d.fromMs, toMs: d.toMs, usage })
      }
      if (out.every(d => !d.usage)) throw new Error('usage read failed')
      return out
    },
    enabled: Boolean(enabled) && typeof ctx?.rest === 'function',
    refetchInterval: USAGE_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,
    staleTime: USAGE_POLL_MS / 2,
    retry: 1,
    retryDelay: 5_000
  })
}

/**
 * The account's quota: the RPC `model.options` (read from Hermes' cache, no inference), at most every 2 minutes, plus `usage.bars`
 * (the Nous balance, `available: false` when not signed in). Only the quota windows are kept (the payload is not stored whole).
 * Read once more shortly after the first empty answer (cold cache).
 */
export function useQuota({ enabled }) {
  const query = useQuery({
    queryKey: [PLUGIN_ID, 'quota'],
    queryFn: async () => {
      const options = await safeRequest('model.options', {})
      const bars = await safeRequest('usage.bars', {})
      if (!options.ok && !bars.ok) throw new Error('quota read failed')
      const providers = options.ok && Array.isArray(options.data?.providers)
        ? options.data.providers.map(p => ({ slug: p?.slug, usage: p?.usage })).filter(p => typeof p.slug === 'string')
        : null
      return { atMs: Date.now(), options: providers ? { providers } : null, balance: bars.ok ? nousBalance(bars.data) : null }
    },
    enabled: Boolean(enabled),
    refetchInterval: QUOTA_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,
    staleTime: QUOTA_POLL_MS / 2,
    retry: 1,
    retryDelay: 5_000
  })
  return query
}

/** One extra read of the quota a few seconds after an answer without any window (the first read of a Hermes process finds its cache cold). */
export function useQuotaRetry(query, hasWindows) {
  const tried = useRef(false)
  const at = query.dataUpdatedAt
  useEffect(() => {
    if (!at || hasWindows || tried.current) return undefined
    tried.current = true   // one extra look only: after that the 2-minute poll is the retry
    const id = setTimeout(() => { query.refetch() }, QUOTA_RETRY_MS)
    return () => clearTimeout(id)
  }, [at, hasWindows])
}
