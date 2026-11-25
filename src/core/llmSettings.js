/**
 * What the « LLM functions » settings show of the two models, the grant and the ten functions, as pure data. No SDK, no DOM.
 * The form (src/ui/SettingsFormLlm.jsx) only draws what this says; every state is a value a test reads (tests/js/llm-settings.test.mjs).
 *
 *   - the grant (`state.override`, read from `GET /llm`): `granted` -> the two lists answer; `not_granted` -> both greyed, with the way to
 *     grant it (a command to run in a terminal) and the fallback said; `unsupported` (a Hermes too old to know the grant) -> the lists are
 *     not drawn, « Hermes too old » is said. The plugin falls back on the auxiliary tasks of Hermes either way: no function breaks;
 *   - the list of models is the one the recruitment already reads (`model.options`, src/core/modelOptions.js): when it cannot be read the
 *     lists keep what is stored, say why, and still allow « the one of Hermes » (never a free field: a pair Hermes cannot serve fails at the call);
 *   - which model a function will really take comes from `state.routes` (the agent half says it); without it the page derives it from the
 *     fixed table function -> lane and the two picks (one filled serves both, none = the model of Hermes).
 */
import { LLM_ALL, LLM_FEATURES, LLM_LANES, LLM_LANE_OF, LLM_WORK, capReached, cleanModelPick, featureState, laneModel } from './llm.js'

/** The command that grants the model choice: a terminal of the profile that serves the plugin (Desktop and the webapp cannot give it). */
export const GRANT_COMMAND = 'hermes plugins enable hermes-officecraft'
/** Why the list of models is not offered (`loadModelOptions` states other than `ready`). */
export const LIST_FALLBACKS = Object.freeze(['empty', 'timeout', 'unsupported', 'failed'])

/** Is the choice of a model possible at all: the grant is given. */
export const canChoose = state => state?.override === 'granted'

/**
 * The flat list the two selects offer: every model of every provider Hermes says is ready, in the order of `sortProviders`.
 * -> `{ state, choices: [{ provider, providerName, model, name }] }`; `state` is the read of the list (`ready`, `loading`, or why it is not).
 */
export function modelChoices(opts) {
  const state = opts?.state ?? 'idle'
  const choices = []
  if (state === 'ready') {
    for (const p of opts.providers ?? []) {
      if (!p.ready) continue
      for (const m of p.models) choices.push({ provider: p.slug, providerName: p.name || p.slug, model: m.id, name: m.name && m.name !== m.id ? m.name : m.id })
    }
  }
  return { state, choices }
}

const same = (a, b) => Boolean(a) && Boolean(b) && a.provider === b.provider && a.model === b.model

/** A model id as the settings draw it: without the vendor before the last `/` (« example/model-fast-1017 » -> « model-fast-1017 »); the whole id stays in the tooltip. */
export const shortModel = id => String(id ?? '').split('/').filter(Boolean).pop() ?? ''

/** The index in `choices` of a stored pick, or -1 (absent from the list, or the list is not read). */
export const choiceIndex = (choices, pick) => (pick ? choices.findIndex(c => same(c, pick)) : -1)

/**
 * One lane's select: what it shows and offers. `pick` is what the server keeps (null = the one of Hermes).
 * -> `{ lane, pick, selected: 'hermes' | 'stored' | <index>, stored: boolean, fallback: <reason> | null, disabled, hidden }`
 *   `stored`: the pick is not in the list (a provider removed, a list unread): the select still shows it, it is never silently emptied.
 */
export function laneSelect(state, lane, list) {
  const pick = cleanModelPick(state?.settings?.models?.[lane])
  const idx = choiceIndex(list.choices, pick)
  const fallback = LIST_FALLBACKS.includes(list.state) ? list.state : null
  return {
    lane,
    pick,
    selected: !pick ? 'hermes' : idx >= 0 ? String(idx) : 'stored',
    stored: Boolean(pick) && idx < 0,
    fallback,
    disabled: !canChoose(state),
    hidden: state?.override === 'unsupported'
  }
}

/** How many of the two models the user set (0, 1, 2): one alone serves both lanes, none = the model of Hermes everywhere. */
export const modelsSet = state => LLM_LANES.filter(l => cleanModelPick(state?.settings?.models?.[l])).length

/**
 * The model a function will take, as the settings say it: `{ lane, kind: 'model' | 'host', provider, model }`. `host` = the auxiliary task of
 * Hermes (`officecraft` for the light lane, `officecraft_plan` for the strong one), which is what happens without the grant.
 */
export function routeOf(state, feature) {
  const lane = LLM_LANE_OF[feature]
  if (state?.override !== 'granted') return { lane, kind: 'host', provider: null, model: null }
  const said = state.routes?.[feature]
  if (said) return said.via === 'model' && said.model ? { lane, kind: 'model', provider: said.provider, model: said.model } : { lane, kind: 'host', provider: null, model: null }
  const pick = laneModel(state.settings?.models, lane)
  return pick ? { lane, kind: 'model', provider: pick.provider, model: pick.model } : { lane, kind: 'host', provider: null, model: null }
}

/**
 * One row of the list. `state`: the function's state as `featureState` says it, or `outdated` (the agent half answered but does not serve it
 * yet: the switch is then not offered, posting it would be refused), or `unavailable` (Hermes offers no model). `served`: can be switched.
 */
export function featureRow(state, feature, failed = null) {
  const group = LLM_WORK.includes(feature) ? 'work' : 'decor'
  const served = state.features.includes(feature)
  const outdated = state.available && !served
  return {
    key: feature,
    group,
    lane: LLM_LANE_OF[feature],
    state: outdated ? 'outdated' : featureState(state, feature, failed),
    on: state.settings.features[feature] === true,
    switchable: !outdated,
    route: routeOf(state, feature),
    cap: capReached(state, feature)
  }
}

/** The states that can hit several functions for ONE reason (an older agent half, no model offered): said once for the group, never row by row. */
export const SHARED_STATES = Object.freeze(['outdated', 'unavailable'])

/**
 * What a group says once. `notice`: the state shared by at least two of its rows (`outdated`: the agent half is older than the page), which
 * gets one banner with the action; the rows of such a state are `quiet` (dimmed, no pill of their own). `unavailable` (Hermes offers no
 * model) already has its single banner at the top of the tab, so its rows are only quiet. A state on ONE row stays on that row.
 */
export function groupNotice(rows) {
  const counts = {}
  for (const r of rows) if (SHARED_STATES.includes(r.state)) counts[r.state] = (counts[r.state] ?? 0) + 1
  const shared = SHARED_STATES.filter(k => counts[k] >= 2)
  return { notice: shared.includes('outdated') ? 'outdated' : null, rows: rows.map(r => ({ ...r, quiet: shared.includes(r.state) })) }
}

/** What a row's model chip says (its lane and the model, or Hermes' own): the comparison key of `chipRows`. */
export const chipKey = row => `${row.lane}:${row.route.kind === 'model' ? `${row.route.provider}/${row.route.model}` : 'host'}`

/**
 * The keys of the rows whose model chip says something. The chip is the model a function takes; when it is the same on every row (the choice
 * of a model is not possible: every row says « light · Hermes ») it says nothing and none is drawn. When two kinds exist, the one most
 * rows have is the default and is not repeated: only the rows that differ from it carry a chip.
 */
export function chipRows(rows) {
  const counts = new Map()
  for (const r of rows) counts.set(chipKey(r), (counts.get(chipKey(r)) ?? 0) + 1)
  if (counts.size <= 1) return new Set()
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return new Set(rows.filter(r => chipKey(r) !== common).map(r => r.key))
}

/** The whole tab, as one value. `list` = `modelChoices(opts)`; `failed` = `{ [feature]: answer }` of the last calls made from the form. */
export function settingsView(state, list = { state: 'idle', choices: [] }, failed = {}) {
  const rows = f => featureRow(state, f, failed[f]?.kind === 'failed' ? failed[f] : null)
  const work = groupNotice(LLM_WORK.map(rows))
  const decor = groupNotice(LLM_FEATURES.map(rows))
  const chips = chipRows([...work.rows, ...decor.rows])
  const mark = r => ({ ...r, chip: chips.has(r.key) })
  return {
    override: state.override,
    granted: canChoose(state),
    lists: state.override !== 'unsupported',
    needsGrant: state.override === 'not_granted',
    tooOld: state.override === 'unsupported',
    command: GRANT_COMMAND,
    chosen: modelsSet(state),
    selects: Object.fromEntries(LLM_LANES.map(l => [l, laneSelect(state, l, list)])),
    list: { state: list.state, count: list.choices.length, fallback: LIST_FALLBACKS.includes(list.state) ? list.state : null },
    groups: { work: work.rows.map(mark), decor: decor.rows.map(mark) },
    notices: { work: work.notice, decor: decor.notice },
    on: LLM_ALL.filter(f => state.settings.features[f] === true).length,
    of: LLM_ALL.length
  }
}

/** The change a select makes: `null` = « the one of Hermes », else the `{ provider, model }` of the chosen row of the list (never a typed value). */
export function pickFromValue(value, choices) {
  if (value === 'hermes' || value === '') return null
  const c = choices[Number(value)]
  return c ? { provider: c.provider, model: c.model } : undefined   // undefined = nothing to change (the stored value, or an index that is not in the list)
}
