import { useQuery } from '@hermes/plugin-sdk'

import { PLUGIN_ID } from '../constants.js'
import { healthPollMs } from '../core/health.js'
import { toHistory } from '../core/history.js'
import { buildRoster } from '../core/roster.js'
import { safeRequest } from './rpc.js'

export const ROSTER_KEY = [PLUGIN_ID, 'roster']
export const LIVE_KEY = [PLUGIN_ID, 'live']
export const PAGE_POLL_MS = 5_000
export const CHIP_POLL_MS = 30_000
export const HISTORY_POLL_MS = 60_000

async function fetchRoster() {
  const res = await safeRequest('profiles.list', { include_sessions: true })
  // a failed read is thrown (like /live): React Query keeps the last good roster in `data`; it is not replaced by an empty one
  if (!res.ok) throw new Error(`profiles.list failed (${res.reason ?? 'unknown'})`)
  return { ok: true, desks: buildRoster(res.data), fetchedAt: Date.now() }
}

/**
 * Shared roster query. React Query keeps one fetch per key and polls at the
 * fastest interval among mounted observers; it stops when nothing is mounted
 * and pauses while the window is hidden.
 */
export function useRoster(intervalMs = PAGE_POLL_MS) {
  return useQuery({
    queryKey: ROSTER_KEY,
    queryFn: fetchRoster,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,   // no request on `online` while the window is hidden (default true)
    staleTime: Math.min(intervalMs, PAGE_POLL_MS),
    retry: false   // a thrown failure is not asked again after 1 s (React Query default): the next poll is the retry
  })
}

/**
 * Boards, gateway and cron jobs from the agent half (`GET /live`). Only runs when
 * the backend says it serves them; otherwise the office stays roster-only.
 * A failed poll keeps the last good data (React Query keeps `data` on error).
 */
export function useLive(ctx, enabled, intervalMs = PAGE_POLL_MS) {
  return useQuery({
    queryKey: LIVE_KEY,
    queryFn: async () => {
      const body = await ctx.rest('/live', { timeoutMs: 8_000 })
      if (!body?.ok) throw new Error(body?.error || 'live read failed')
      return body
    },
    enabled: Boolean(enabled) && typeof ctx?.rest === 'function',
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,   // no request on `online` while the window is hidden (default true)
    staleTime: intervalMs,
    retry: 1,
    retryDelay: 5_000   // React Query's default retry delay is 1 s, i.e. a failed read asked again within 5 s
  })
}

/**
 * Skills, descriptions, runs, events and session aggregates from the agent half (`GET /history`).
 * On demand, not live: once on mount, then at most once a minute while the page is mounted and visible.
 * A failure never shows: the scene falls back to name-only outfits and no skill objects. One retry only
 * (no loop); the next attempt is the next minute's poll.
 */
export function useHistory(ctx, enabled, intervalMs = HISTORY_POLL_MS) {
  return useQuery({
    queryKey: [PLUGIN_ID, 'history'],
    queryFn: async () => {
      const body = await ctx.rest('/history', { timeoutMs: 10_000 })
      const history = toHistory(body)
      if (!history.ok) throw new Error(body?.error || 'history read failed')
      return history
    },
    enabled: Boolean(enabled) && typeof ctx?.rest === 'function',
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,   // no request on `online` while the window is hidden (default true)
    staleTime: intervalMs,
    retry: 1,
    retryDelay: 5_000
  })
}

/** Optional agent half. Absent -> read-only mode, silently. */
export function useBackendHealth(ctx) {
  return useQuery({
    queryKey: [PLUGIN_ID, 'health'],
    queryFn: async () => {
      try {
        if (typeof ctx?.rest !== 'function') return { present: false }
        const body = await ctx.rest('/health', { timeoutMs: 4_000 })
        return body?.ok
          ? { present: true, reads: Array.isArray(body.reads) ? body.reads : [], capabilities: body.capabilities ?? [] }
          : { present: false }
      } catch {
        return { present: false }
      }
    },
    staleTime: 5 * 60_000,
    // absent or unreachable -> asked again (src/core/health.js); present -> never again
    refetchInterval: query => healthPollMs(query.state.data),
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,   // no request on `online` while the window is hidden (default true)
    retry: false
  })
}
