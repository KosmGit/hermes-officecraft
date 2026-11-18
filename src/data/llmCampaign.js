import { useQueryClient } from '@hermes/plugin-sdk'

import { readDraftAnswer } from '../core/llmDraft.js'
import { LLM_WAIT_MS, campaignBody } from '../core/llmCampaign.js'
import { cardbodyBody, lintBody, readLintAnswer } from '../core/llmReview.js'
import { callLlm } from './llm.js'

/**
 * The three calls of the campaign editor. Each one only DRAFTS: a plan, the instructions of one card, a list of remarks. Nothing is created,
 * changed or launched by them (`POST /campaign` stays the only way a graph is written, on the user's click). The page posts the goal and the notes, one card
 * of the draft, or the cards of the draft: the agent half reads the bots itself and never a card of a board. Never throws: a refusal, a failure and a lost
 * request are all an answer (src/core/llm.js `readAnswer` / `answerOfError`). Each waits the agent half's delay + 15 s (`LLM_WAIT_MS`).
 * A draft whose window was closed is read later with `readDraft('campaign' | 'cardbody' | 'lint', id)` (src/data/llm.js) and forgotten with `forgetDraft`.
 */
export const callCampaign = (id, goal, notes, lang, queryClient) =>
  callLlm('/llm/campaign', campaignBody(id, goal, notes, lang), queryClient, readDraftAnswer, LLM_WAIT_MS.campaign)

export const callCardbody = (id, goal, card, lang, queryClient) =>
  callLlm('/llm/cardbody', cardbodyBody(id, goal, card, lang), queryClient, readDraftAnswer, LLM_WAIT_MS.cardbody)

/** `draft` = the draft of the editor (the work cards are sent, with the price of the models they pin: `prices` of `model.options`). Nothing to review = an answer, not a call. */
export async function callLint(id, draft, lang, prices, queryClient) {
  const body = lintBody(id, draft, lang, prices)
  if (!body) return { kind: 'refused', reason: 'nothing_to_send', cap: null, fiche: null, costUsd: null, costStatus: null, reset: false, truncated: 0, dropped: 0 }
  return callLlm('/llm/lint', body, queryClient, readLintAnswer, LLM_WAIT_MS.lint)
}

/** The three calls bound to the app's query client (hook: call it in the component's body). */
export function useCampaignLlm() {
  const queryClient = useQueryClient()
  return {
    campaign: (id, goal, notes, lang) => callCampaign(id, goal, notes, lang, queryClient),
    cardbody: (id, goal, card, lang) => callCardbody(id, goal, card, lang, queryClient),
    lint: (id, draft, lang, prices) => callLint(id, draft, lang, prices, queryClient)
  }
}
