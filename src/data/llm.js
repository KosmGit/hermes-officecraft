import { useQuery, useQueryClient } from '@hermes/plugin-sdk'

import { PLUGIN_ID } from '../constants.js'
import { answerOfError, readAnswer, toLlm } from '../core/llm.js'
import { DRAFT_FEATURES, draftForgetBody, readDraftAnswer, readDraftRead, recruitBody, reviseBody } from '../core/llmDraft.js'

/**
 * The LLM functions live on the agent half (`/llm`): switches, caps, the month's spend and the fiches are kept ON THE SERVER, the
 * model is called there (`ctx.llm`; a page has none). Like the notification settings, the form is rendered by Hermes' settings page and by
 * the gear, neither of which hands it `ctx`, so register() keeps the REST door here once.
 */
let rest = null

export function initLlm(ctx) {
  rest = typeof ctx?.rest === 'function' ? ctx.rest.bind(ctx) : null
}

/** Whether the REST door is there (an older host gives none): the bubbles' query asks before it runs. */
export const hasRest = () => Boolean(rest)

export const LLM_KEY = [PLUGIN_ID, 'llm']
/** The fiches are re-read at most once a minute, page mounted and visible. */
export const LLM_POLL_MS = 60_000
/** A model call can take its whole minute on the agent half; the page waits a little longer than that. */
const CALL_TIMEOUT_MS = 75_000

/**
 * `GET /llm`, normalised (src/core/llm.js toLlm). Read when the form or the page mounts, after every call, then at most once a minute while
 * the page is mounted and visible (`poll`). Never a model call: a read costs nothing. An older agent half has no such route: the query errors
 * and nothing LLM is shown.
 */
export function useLlm({ enabled = true, poll = false } = {}) {
  return useQuery({
    queryKey: LLM_KEY,
    queryFn: async () => {
      if (!rest) throw new Error('unavailable')
      const state = toLlm(await rest('/llm', { timeoutMs: 8_000 }))
      if (!state) throw new Error('llm read failed')
      return state
    },
    enabled: Boolean(rest) && enabled,
    refetchInterval: poll ? LLM_POLL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: false,
    staleTime: 15_000,
    retry: false
  })
}

/** Save the whole board of switches and caps. -> `{ ok: true, state }` or `{ ok: false, reason }`; the saved board goes into the shared cache. */
export async function saveLlm(body, queryClient) {
  if (!rest) return { ok: false, reason: 'unreachable' }
  try {
    const res = await rest('/llm/settings', { method: 'POST', body, timeoutMs: 8_000 })
    const state = toLlm(res)
    if (state) queryClient?.setQueryData?.(LLM_KEY, state)
    return state ? { ok: true, state } : { ok: false, reason: 'failed' }
  } catch (error) {
    return { ok: false, reason: typeof error?.body?.reason === 'string' ? error.body.reason : 'failed' }
  }
}

/**
 * One call to a function (`POST /llm/<path>`): one gesture, one id (the id is in `body`). Never throws: a refusal, a failure and a lost
 * request are all an answer (src/core/llm.js readAnswer / answerOfError). The shared state is read again after it: the spend and the new
 * fiche come from the server, never from this answer.
 */
export async function callLlm(path, body, queryClient, read = readAnswer, timeoutMs = CALL_TIMEOUT_MS) {
  let answer
  if (!rest) answer = answerOfError(null)
  else {
    try {
      answer = read(await rest(path, { method: 'POST', body, timeoutMs })) ?? answerOfError(null)
    } catch (error) {
      answer = answerOfError(error)
    }
  }
  queryClient?.invalidateQueries?.({ queryKey: LLM_KEY })
  return answer
}

/**
 * A recruitment draft for a mission, or a new description for one bot. Both only DRAFT: nothing is created or changed by these
 * calls (the orders stay `profiles.create` / `profiles.configure`, on the user's click). The page posts the mission or a name; the agent
 * half reads the bots itself. -> the answer of `readDraftAnswer` (`fiche` is the raw fiche: `mergeRecruit` / `mergeRevise` read it again).
 */
export const callRecruit = (id, mission, lang, queryClient) => callLlm('/llm/recruit', recruitBody(id, mission, lang), queryClient, readDraftAnswer)
export const callRevise = (id, profile, lang, queryClient) => callLlm('/llm/revise', reviseBody(id, profile, lang), queryClient, readDraftAnswer)

/**
 * The draft a closed window did not read (`GET /llm/draft`, no model, free). -> `{ id, at, target, fiche }`, or null when it expired, was
 * forgotten (the gateway restarted, 30 minutes passed) or could not be read.
 */
export async function readDraft(feature, id) {
  if (!rest || !DRAFT_FEATURES.includes(feature) || typeof id !== 'string') return null
  try {
    return readDraftRead(await rest(`/llm/draft?feature=${encodeURIComponent(feature)}&id=${encodeURIComponent(id)}`, { timeoutMs: 8_000 }), feature)
  } catch {
    return null
  }
}

/** The page applied or dropped a draft: the agent half forgets it. -> true when it was kept and is now gone. Never throws. */
export async function forgetDraft(feature, id, queryClient) {
  if (!rest || !DRAFT_FEATURES.includes(feature)) return false
  try {
    const res = await rest('/llm/draft/forget', { method: 'POST', body: draftForgetBody(id, feature), timeoutMs: 8_000 })
    queryClient?.invalidateQueries?.({ queryKey: LLM_KEY })
    return res?.forgotten === true
  } catch {
    return false
  }
}

/** `saveLlm`, `callLlm` and the draft calls bound to the app's query client (hook: call it in the component's body). */
export function useLlmActions() {
  const queryClient = useQueryClient()
  return {
    save: body => saveLlm(body, queryClient),
    call: (path, body) => callLlm(path, body, queryClient),
    recruit: (id, mission, lang) => callRecruit(id, mission, lang, queryClient),
    revise: (id, profile, lang) => callRevise(id, profile, lang, queryClient),
    readDraft,
    forgetDraft: (feature, id) => forgetDraft(feature, id, queryClient),
    // read `GET /llm` again now (a window that opens asks for the drafts the agent half kept; free, no model)
    refresh: () => queryClient?.invalidateQueries?.({ queryKey: LLM_KEY })
  }
}
