import { useQuery, useQueryClient } from '@hermes/plugin-sdk'

import { PLUGIN_ID } from '../constants.js'
import { readTestError, toNotify } from '../core/notify.js'

/**
 * The notification settings live on the agent half (`/notify`): the settings form is rendered by Hermes' settings page
 * and by the gear, neither of which hands it `ctx`, so register() keeps the REST door here once.
 */
let rest = null

export function initNotify(ctx) {
  rest = typeof ctx?.rest === 'function' ? ctx.rest.bind(ctx) : null
}

export const NOTIFY_KEY = [PLUGIN_ID, 'notify']

/** Read once when the form opens, again after a change (no timer: nothing here changes by itself). */
export function useNotify() {
  return useQuery({
    queryKey: NOTIFY_KEY,
    queryFn: async () => {
      if (!rest) throw new Error('unavailable')
      const state = toNotify(await rest('/notify', { timeoutMs: 8_000 }))
      if (!state) throw new Error('notify read failed')
      return state
    },
    enabled: Boolean(rest),
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchIntervalInBackground: false,
    retry: false
  })
}

/**
 * Save the whole board. Resolves to `{ ok: true, state }` or `{ ok: false, reason }` (a refusal is said, never thrown).
 * The saved board goes into the query cache the gear and the settings page share, so a form reopened right after a
 * save never shows (and re-posts) the board from before it.
 */
export async function saveNotify(body, queryClient) {
  if (!rest) return { ok: false, reason: 'unavailable' }
  try {
    const res = await rest('/notify', { method: 'POST', body, timeoutMs: 8_000 })
    const state = toNotify(res)
    if (state) queryClient?.setQueryData?.(NOTIFY_KEY, state)
    return state ? { ok: true, state } : { ok: false, reason: typeof res?.reason === 'string' ? res.reason : 'failed' }
  } catch (error) {
    return { ok: false, reason: readTestError(error).reason || 'failed' }   // the host's door throws `Error("<status>: <body>")`: read both shapes
  }
}

/** `saveNotify` bound to the app's query client (hook: call it in the form's body). */
export function useSaveNotify() {
  const queryClient = useQueryClient()
  return body => saveNotify(body, queryClient)
}

/**
 * ONE test message to one recipient (`POST /notify/test`): the text is never ours to send, the agent half builds it. Never throws:
 * resolves to `{ ok: true }` or `{ ok: false, reason, retryAfter }` (a refusal, a failed send and a lost request are all an answer).
 */
export async function sendTest(key) {
  if (!rest) return { ok: false, reason: 'notify_unavailable', retryAfter: null }
  try {
    const res = await rest('/notify/test', { method: 'POST', body: { target: key }, timeoutMs: 20_000 })
    return res?.ok === true ? { ok: true } : { ok: false, reason: typeof res?.error === 'string' ? res.error : 'failed', retryAfter: null }
  } catch (error) {
    const { reason, retryAfter } = readTestError(error)
    return { ok: false, reason: reason || 'failed', retryAfter }
  }
}

/**
 * The trophies this page has just seen unlock, told to the agent half (`POST /notify/trophy`, idempotent there): the trophy
 * type is the only one computed by the page, so it only goes out while an office is open. Fire and forget: nothing waits for it.
 */
export async function reportTrophies(trophies) {
  if (!rest || !trophies.length) return false
  try {
    await rest('/notify/trophy', { method: 'POST', body: { trophies }, timeoutMs: 8_000 })
    return true
  } catch {
    return false
  }
}
