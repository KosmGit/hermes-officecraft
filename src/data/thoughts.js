import { useQuery, useQueryClient } from '@hermes/plugin-sdk'
import { newId as randomUuid } from './uuid.js'
import { useRef } from 'react'

import { PLUGIN_ID } from '../constants.js'
import { THOUGHT_EVERY_MS, thoughtGate, thoughtsBody } from '../core/thoughts.js'
import { callLlm, hasRest } from './llm.js'

/* ---------- thought bubbles ---------- */
/** When the page last sent `POST /llm/thoughts` (this tab). The gate below keeps two requests at least a minute apart, whoever asks. */
let lastThoughtsAt = null

/** For tests: forget the last request. */
export function resetThoughtsClock() { lastThoughtsAt = null }

/**
 * The bubbles' rhythm: while the function is ON and ready, the page visible and someone at work, ask the agent half for bubbles, at most
 * once a minute (`thoughtGate`: never sooner than THOUGHT_EVERY_MS after the last request; the agent half refuses sooner too). A query
 * with a one-minute `refetchInterval` (never in the background, no timer of its own): it ends with the page, with the function, and
 * when nobody works. The request carries the roles of the agents at work; the agent half finds their card and tools and regroups them
 * in ONE model call; an answer of `unchanged` or `nothing_to_send` costs nothing. The bubbles themselves are read back from `GET /llm`.
 */
export function useThoughts({ ready, visible, roles, lang }) {
  const queryClient = useQueryClient()
  const rolesRef = useRef(roles)
  rolesRef.current = roles
  const working = Object.keys(roles || {}).length > 0
  const enabled = hasRest() && Boolean(ready) && Boolean(visible) && working
  return useQuery({
    queryKey: [PLUGIN_ID, 'llm', 'thoughts'],
    queryFn: async () => {
      const now = Date.now()
      const gate = thoughtGate({ nowMs: now, lastMs: lastThoughtsAt, visible: typeof document === 'undefined' ? true : !document.hidden, ready: true, roles: rolesRef.current })
      if (!gate.ask) return { skipped: gate.why }
      lastThoughtsAt = now
      const answer = await callLlm('/llm/thoughts', thoughtsBody(randomUuid(), rolesRef.current, lang), queryClient)
      return { kind: answer.kind, reason: answer.reason }
    },
    enabled,
    refetchInterval: enabled ? THOUGHT_EVERY_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 0,
    gcTime: 0,
    retry: false
  })
}
