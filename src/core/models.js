/**
 * Pure model logic: which model a bot works with on its running card, and whether that differs
 * from the bot's own default. No SDK, no DOM. Strings are compared exactly and shown as received
 * (`large` is never turned into `model-large-5`; the UI prints both).
 *
 * Sources:
 *   default  profiles.list `model` / `provider` (desk.model / desk.provider), filled by
 *            /history `defaultModel` / `defaultProvider` when the roster sends an empty value
 *            (`withWorkerModels`); unknown stays `''`, never the string "null"
 *   card     /live tasks[].modelOverride / providerOverride (tasks.model_override / provider_override)
 *   actual   /history profiles[].workerModel (sessions.model of the newest worker session)
 */

import { runningCards } from './cards.js'
import { trimmed } from './util.js'

const str = trimmed

/**
 * The running card whose model decides. Among the running cards (main card first, src/core/cards.js) the first one that pins
 * a model or provider other than the bot's default; else the main card. The comparison is the exact-string one of `pinOf`: an unknown
 * default never makes a card differ.
 */
function runningCard(agent, def) {
  const cards = runningCards(agent)
  const known = (side, against) => side !== null && Boolean(against) && side !== against
  const pins = t => known(str(t.modelOverride) || null, def.model) || known(str(t.providerOverride) || null, def.provider)
  return cards.find(pins) || cards[0] || null
}

/**
 * agent: an `buildOffice` agent (desk fields + `running`), optionally with `workerModel` / `workerActiveMs`
 * (see `withWorkerModels`).
 * -> { default: {model, provider}, card: {model, provider, cardId, board} | null,
 *      actual: {model} | null, differs: boolean }
 * `card` is null without a running card; with one but no override its model/provider are null.
 * `actual` is only set with a running card and a worker model the worker session really ran with
 * (not one left by an earlier card: the session must have been active since the card started).
 * `differs`: the model really used when known, else the one the card pins (model or provider), against the
 * default — and only when both sides are known. An unknown default (roster empty and /history without a value)
 * never makes a card differ: the UI then says « modèle par défaut inconnu » instead of inventing a comparison.
 */
export function modelOf(agent) {
  const def = { model: str(agent?.model), provider: str(agent?.provider) }
  const task = runningCard(agent, def)
  if (!task) return { default: def, card: null, actual: null, differs: false }
  const card = { model: str(task.modelOverride) || null, provider: str(task.providerOverride) || null, cardId: task.id, board: task.board }
  const wm = str(agent.workerModel)
  const fresh = !(typeof agent.workerActiveMs === 'number' && typeof task.startedMs === 'number' && agent.workerActiveMs < task.startedMs)
  const actual = wm && fresh ? { model: wm } : null
  // both sides must be known: an unknown default (`''`) is never compared, so it never "differs"
  const known = (side, against) => side !== null && Boolean(against) && side !== against
  const pinned = known(card.model, def.model) || known(card.provider, def.provider)
  const differs = actual ? Boolean(def.model) && actual.model !== def.model : pinned
  return { default: def, card, actual, differs }
}

/**
 * A card's pinned model against its assignee's own default, whatever the card's status (the inbox and the chains show
 * it for blocked / queued cards too). null = nothing pinned, same as the default, or no known assignee.
 * -> { model, provider, default: { model, provider } }
 */
export function pinOf(task, agent) {
  if (!task || !agent) return null
  const model = str(task.modelOverride) || null
  const provider = str(task.providerOverride) || null
  const def = { model: str(agent.model), provider: str(agent.provider) }
  // same rule as modelOf: a pin only counts when the default side is known
  const known = (side, against) => side !== null && Boolean(against) && side !== against
  const pinned = known(model, def.model) || known(provider, def.provider)
  return pinned ? { model, provider, default: def } : null
}

/** The model string to print for a { model, provider } pair: the model, else the provider, else empty. */
export const modelText = m => str(m?.model) || str(m?.provider)

/**
 * Attach `/history` facts to agents, by name: the worker model + last activity, and the bot's own default
 * model (`defaultModel` / `defaultProvider`) **only where the roster sent nothing** — `profiles.list` returns
 * `model: ""` for most bots in the webapp, so `/history` is the reliable source; when the roster does provide a
 * value it wins. A missing / null / empty / "null" value leaves the default unknown (`''`), never the string
 * "null". No history (`ok:false`) -> the very same array, untouched.
 */
export function withWorkerModels(agents, history) {
  if (!history?.ok) return agents
  return (agents || []).map(a => {
    const hp = history.profiles?.[a.name]
    if (!hp) return a
    const next = { ...a }
    let changed = false
    const fill = (key, value) => {
      if (str(next[key])) return
      const v = str(value)
      if (!v || v === 'null') return
      next[key] = v
      changed = true
    }
    fill('model', hp.defaultModel)
    fill('provider', hp.defaultProvider)
    if (hp.workerModel) {
      next.workerModel = hp.workerModel
      next.workerActiveMs = hp.worker?.lastActiveMs ?? null
      changed = true
    }
    return changed ? next : a
  })
}
