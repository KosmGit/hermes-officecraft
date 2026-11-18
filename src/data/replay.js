import { useQuery } from '@hermes/plugin-sdk'

import { PLUGIN_ID } from '../constants.js'
import { toReplay, windowFor } from '../core/replay.js'

export const REPLAY_POLL_MS = 60_000

/** The window's own key: a night is the same read all night long (and the next morning); a rolling window is one read that is refreshed. */
export const replayKey = (kind, night, anchor) => [PLUGIN_ID, 'replay', kind, night.from, night.to, kind === 'night' ? anchor : 'rolling']

/**
 * `GET /replay`: the facts of a window, read ONCE when the window is chosen (never per position of the cursor: the cursor and the
 * journal work on this answer in memory). While the window ends now it is read again at most once a minute (`poll`), page mounted and
 * visible; a window that ended in the past is never read twice. A failure keeps the last good answer; one retry, 5 s later.
 * `anchor` = the start of the night (changes the key when a new night begins).
 */
export function useReplay(ctx, { enabled, kind = 'night', night, anchor = 0, poll = false, nowMs = Date.now }) {
  return useQuery({
    queryKey: replayKey(kind, night, anchor),
    queryFn: async () => {
      const win = windowFor(kind, typeof nowMs === 'function' ? nowMs() : nowMs, night)
      const from = Math.floor(win.from / 1000)
      const to = Math.max(from + 1, Math.floor(win.to / 1000))
      const body = toReplay(await ctx.rest(`/replay?from=${from}&to=${to}`, { timeoutMs: 20_000 }))
      if (!body.ok) throw new Error('replay read failed')
      return { ...body, kind, ongoing: win.ongoing }
    },
    enabled: Boolean(enabled) && typeof ctx?.rest === 'function',
    refetchInterval: poll ? REPLAY_POLL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,
    staleTime: REPLAY_POLL_MS / 2,
    retry: 1,
    retryDelay: 5_000
  })
}
