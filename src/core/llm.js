/**
 * LLM functions: what the agent half serves (`GET /llm`, `POST /llm/*`) as the page reads it, and the rules the
 * page applies to it. The model only ever returns a closed fiche that the agent half validated; the page draws it through the engine
 * (src/scene/style.js for the decor, src/scene/wardrobe.js for the outfits) and never anything else. Pure: no SDK, no DOM.
 * The agent half's side is hermes_officecraft/llm.py.
 */
import { MOTIFS } from '../scene/art.js'
import { ROLES } from '../scene/wardrobe.js'
import { normalizeStyle } from '../scene/style.js'
import { postersOf, milestonesOf, pendingMilestones } from './wallart.js'
import { INSTR_MAX, seatingFor } from './seating.js'
import { isThought, thoughtsShown } from './thoughts.js'
import { looksSecret } from './modelOptions.js'
import { dict } from './dict.js'

/** The five functions, in display order (same ids as hermes_officecraft/llm.py FEATURES). */
export const LLM_FEATURES = Object.freeze(['decor', 'outfits', 'art', 'seating', 'thoughts'])
/** The ones this page draws: the decor and the outfits, the wall art, the seating and the thought bubbles. */
export const LLM_DRAWN = Object.freeze(['decor', 'outfits', 'art', 'seating', 'thoughts'])
/**
 * The five drafting functions (`recruit`, `revise`; `campaign`, `cardbody`, `lint` of the campaign editor). Kept apart from
 * `LLM_FEATURES`: their switches and costs are read
 * into `state.settings.features` and `state.costs` all the same, `state.pending` says which drafts the agent half keeps.
 */
export const LLM_USEFUL = Object.freeze(['recruit', 'revise', 'campaign', 'cardbody', 'lint'])
/**
 * The five functions that WORK (they fill a draft the user reads; they are not decor), in the order the settings
 * list them, and all ten switches (work first). Which of them this agent half serves is `state.features`.
 */
export const LLM_WORK = Object.freeze(['recruit', 'revise', 'campaign', 'cardbody', 'lint'])
export const LLM_ALL = Object.freeze([...LLM_WORK, ...LLM_FEATURES])
export const CAP_USD_MAX = 100
export const CALL_CAP_MAX = 10_000
export const STYLE_MAX = 280

/* ---------- two models, « strong » and « light » ---------- */
/** The two lanes, in display order (hermes_officecraft/llm.py LANES). */
export const LLM_LANES = Object.freeze(['strong', 'light'])
/** Which lane serves a function: fixed in code, never chosen per function (llm.py LANE_OF; a test keeps both tables equal). */
export const LLM_LANE_OF = Object.freeze({
  decor: 'light', outfits: 'light', art: 'light', seating: 'light', thoughts: 'light',
  recruit: 'light', revise: 'light', campaign: 'strong', cardbody: 'strong', lint: 'light'
})
/** Can a model be imposed per call? `granted` (the user agreed in Hermes), `not_granted` (the lists are greyed, with the way to grant), `unsupported` (Hermes too old). */
export const OVERRIDE_STATES = Object.freeze(['granted', 'not_granted', 'unsupported'])
export const PROVIDER_MAX = 100
export const MODEL_MAX = 200
const BLANK_OR_INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff\s]/

const idPart = (v, max) => (typeof v === 'string' && v.length >= 1 && v.length <= max && !BLANK_OR_INVISIBLE.test(v) && !looksSecret(v) ? v : null)

/**
 * One model choice as the server keeps it: exactly `{ provider, model }` (a closed shape; anything else is « the model of Hermes », null).
 * Same rule as `clean_model` in llm.py (a test runs both on the same cases).
 */
export function cleanModelPick(pick) {
  if (!pick || typeof pick !== 'object' || Array.isArray(pick)) return null
  const keys = Object.keys(pick)
  if (keys.length !== 2 || !keys.includes('provider') || !keys.includes('model')) return null
  const provider = idPart(pick.provider, PROVIDER_MAX)
  const model = idPart(pick.model, MODEL_MAX)
  return provider && model ? { provider, model } : null
}

/** The model a lane asks for: its own, else the other lane's when it is the only one filled, else null (« the model of Hermes »). Mirrors `lane_model`. */
export function laneModel(models, lane) {
  const m = models && typeof models === 'object' ? models : {}
  const other = lane === 'strong' ? 'light' : 'strong'
  return cleanModelPick(m[lane]) || cleanModelPick(m[other]) || null
}

// a model or provider name the agent half REPORTS (a route, the model a call used) is kept for display only when it reads like a name:
// 1 to MODEL_MAX characters, no control or invisible character, nothing shaped like a key (`looksSecret` of src/core/modelOptions.js); else null (never shown, never kept)
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/
export const reportedName = v => (typeof v === 'string' && v.length >= 1 && v.length <= MODEL_MAX && !INVISIBLE.test(v) && !looksSecret(v) ? v : null)

const readRoute = r => ({
  via: r?.via === 'model' ? 'model' : 'task',
  provider: reportedName(r?.provider),
  model: reportedName(r?.model)
})

const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Neighbour pairs as the agent half validated them: two different names, a known reason, no pair twice either way round; empty is fine. */
export const SEAT_WHY = Object.freeze(['relay', 'instruction'])
export function pairsAreSound(pairs) {
  const seen = new Set()
  for (const p of pairs) {
    if (!p || typeof p.a !== 'string' || typeof p.b !== 'string' || !p.a || !p.b || p.a === p.b || !SEAT_WHY.includes(p.why)) return false
    const k = [p.a, p.b].sort().join('|')
    if (seen.has(k)) return false
    seen.add(k)
  }
  return true
}

/**
 * What `GET /llm` (and `POST /llm/settings`) answered, normalised; null when it is not an answer of the agent half (an older agent half
 * has no such route: the page then shows nothing LLM). Every function is OFF unless the server said `true`.
 */
export function toLlm(body) {
  if (!body || body.ok !== true || !body.settings || typeof body.settings !== 'object') return null
  const on = body.settings.features && typeof body.settings.features === 'object' ? body.settings.features : {}
  const sp = body.spend && typeof body.spend === 'object' ? body.spend : {}
  const route = body.route && typeof body.route === 'object' ? { provider: reportedName(body.route.provider) ?? '', model: reportedName(body.route.model) ?? '', priced: body.route.priced === true } : null
  const fiches = body.fiches && typeof body.fiches === 'object' ? body.fiches : {}
  const decor = fiches.decor && typeof fiches.decor === 'object' && fiches.decor.fiche ? { fiche: fiches.decor.fiche, style: String(fiches.decor.style ?? '').slice(0, STYLE_MAX), at: num(fiches.decor.at, 0), model: reportedName(fiches.decor.model) ?? '' } : null
  // the style that came back while the window was closed: kept by the agent half, applied only by a click
  const decorPending = fiches.decorPending && typeof fiches.decorPending === 'object' && fiches.decorPending.fiche
    ? { fiche: fiches.decorPending.fiche, style: String(fiches.decorPending.style ?? '').slice(0, STYLE_MAX), at: num(fiches.decorPending.at, 0) } : null
  const outfits = dict()
  for (const [name, e] of Object.entries(fiches.outfits && typeof fiches.outfits === 'object' ? fiches.outfits : {})) {
    if (e && typeof e === 'object' && typeof e.role === 'string') outfits[name] = { role: e.role, at: num(e.at, 0) }
  }
  // the posters (motif + two colours per milestone key), the order the model proposed, the bubbles the agent half keeps for 5 minutes
  const art = {}
  const HEX = /^#[0-9a-f]{6}$/
  for (const [key, e] of Object.entries(fiches.art && typeof fiches.art === 'object' ? fiches.art : {})) {
    const p = e && typeof e === 'object' ? e.poster : null
    if (p && MOTIFS.includes(p.motif) && HEX.test(p.sky) && HEX.test(p.accent)) art[key] = { poster: { motif: p.motif, sky: p.sky, accent: p.accent }, at: num(e.at, 0) }
  }
  const sf = fiches.seating && typeof fiches.seating === 'object' ? fiches.seating : null
  const seating = sf && Array.isArray(sf.pairs) && pairsAreSound(sf.pairs)
    ? { pairs: sf.pairs.map(p => ({ a: p.a, b: p.b, why: p.why })), at: num(sf.at, 0), instructions: String(sf.instructions ?? '').slice(0, INSTR_MAX) } : null
  const thoughts = (Array.isArray(fiches.thoughts) ? fiches.thoughts : []).filter(t => t && typeof t.name === 'string' && isThought(t.text)).map(t => ({ name: t.name, text: t.text }))
  const costs = body.costs && typeof body.costs === 'object' ? body.costs : {}
  // the two models chosen, whether a model can be imposed, and what each lane / function will really take (an older agent half serves none)
  const picked = body.settings.models && typeof body.settings.models === 'object' ? body.settings.models : {}
  const lanesIn = body.lanes && typeof body.lanes === 'object' ? body.lanes : {}
  const routesIn = body.routes && typeof body.routes === 'object' ? body.routes : {}
  const lanes = Object.fromEntries(LLM_LANES.map(l => {
    const e = lanesIn[l] && typeof lanesIn[l] === 'object' ? lanesIn[l] : {}
    const b = e.busy && typeof e.busy === 'object' && typeof e.busy.feature === 'string' ? { feature: e.busy.feature, since: num(e.busy.since, 0) } : null
    return [l, { ...readRoute(e), task: typeof e.task === 'string' ? e.task : null, priced: typeof e.priced === 'boolean' ? e.priced : null, busy: b }]
  }))
  const routes = Object.fromEntries(Object.keys(LLM_LANE_OF).filter(f => routesIn[f] && typeof routesIn[f] === 'object').map(f => [f, { lane: LLM_LANE_OF[f], ...readRoute(routesIn[f]) }]))
  return {
    available: body.available === true,
    features: Array.isArray(body.features) ? body.features.filter(f => LLM_ALL.includes(f)) : [],
    override: OVERRIDE_STATES.includes(body.override) ? body.override : 'unsupported',
    lanes,
    routes,
    settings: {
      features: Object.fromEntries(LLM_ALL.map(f => [f, on[f] === true])),
      capUsd: clamp(num(body.settings.capUsd, 1), 0, CAP_USD_MAX),
      callCap: clamp(Math.trunc(num(body.settings.callCap, 300)), 0, CALL_CAP_MAX),
      models: { strong: cleanModelPick(picked.strong), light: cleanModelPick(picked.light) }
    },
    spend: { month: String(sp.month ?? ''), usd: num(sp.usd), calls: Math.trunc(num(sp.calls)), unpriced: Math.trunc(num(sp.unpriced)) },
    route,
    fiches: { decor, decorPending, outfits, art, seating, thoughts },
    costs: Object.fromEntries(LLM_ALL.map(f => [f, { lastUsd: costs[f] && Number.isFinite(costs[f].lastUsd) ? costs[f].lastUsd : null, status: costs[f] && typeof costs[f].status === 'string' ? costs[f].status : null }])),
    // the drafts the agent half keeps for a closed window (id, when, the bot a revision is about): never their content
    pending: Object.fromEntries(LLM_USEFUL.filter(f => body.pending?.[f] && typeof body.pending[f] === 'object' && typeof body.pending[f].id === 'string')
      .map(f => [f, { id: body.pending[f].id, at: num(body.pending[f].at, 0), target: typeof body.pending[f].target === 'string' ? body.pending[f].target : null }]))
  }
}

/**
 * The monthly cap that is reached for a function, as the agent half judges it before any call (so the page does not even offer the
 * call): 'usd' when the spent dollars reach the cap, or the next call (at that function's last cost) would pass it; 'calls' when the
 * calls without a known price reach theirs; else null. Mirrors Engine._guarded (hermes_officecraft/llm.py).
 */
export function capReached(state, feature) {
  if (!state) return null
  const { usd, unpriced } = state.spend
  const { capUsd, callCap } = state.settings
  const last = state.costs?.[feature]?.lastUsd ?? 0
  if (usd >= capUsd || usd + last > capUsd) return 'usd'
  if (unpriced >= callCap) return 'calls'
  return null
}

/**
 * One function's state in the settings: 'off' (the user's switch; the default) | 'unavailable' (Hermes offers no model route for the
 * plugin) | 'cap' (the monthly cap is reached: nothing is called) | 'error' (the last call failed: `failed` is what the page just saw,
 * the server's cost status says it for the one before) | 'ready'. The order is the order of the agent half's guards.
 */
export function featureState(state, feature, failed = null) {
  if (!state || !state.settings.features[feature]) return 'off'
  if (!state.features.includes(feature)) return 'unavailable'
  if (capReached(state, feature)) return 'cap'
  if (failed || state.costs[feature]?.status === 'error') return 'error'
  return 'ready'
}

/**
 * The month's spend, as the settings say it. The price of the model Hermes uses for the plugin decides the cap that counts:
 * a known price -> dollars against `capUsd`; an unknown one (a subscription, a model without a tariff) or none seen yet -> calls
 * without a price against `callCap`, with the way to choose a priced model. `usd` is an estimate (Hermes never fills `cost_usd`).
 */
export function spendView(state) {
  if (!state) return null
  const { usd, unpriced, calls } = state.spend
  const { capUsd, callCap } = state.settings
  const priced = state.route ? state.route.priced : false
  const pct = (n, cap) => (cap > 0 ? clamp(n / cap, 0, 1) : 1)
  return {
    mode: priced ? 'usd' : 'calls',
    usd, capUsd, calls, unpriced, callCap,
    usdPct: pct(usd, capUsd),
    callsPct: pct(unpriced, callCap),
    // an unknown price is said with the way to a priced model; a known one with the calls that had none only if there were some
    unknownPrice: !priced,
    unpricedCalls: unpriced,
    route: state.route
  }
}

/** The settings body after one change: the whole board (the server replaces it). Caps are clamped like the server (0 to 100 $ in cents, 0 to 10 000 calls). */
export function settingsBody(state, change = {}) {
  const features = { ...state.settings.features, ...(change.features || {}) }
  // a switch of a drafting function is posted only when the change names it (the agent half keeps the stored one for a key that is absent)
  const useful = Object.fromEntries(LLM_WORK.filter(f => change.features && f in change.features).map(f => [f, features[f] === true]))
  const capUsd = 'capUsd' in change ? change.capUsd : state.settings.capUsd
  const callCap = 'callCap' in change ? change.callCap : state.settings.callCap
  // both lanes are always sent (the server also keeps a lane that is absent, but this page knows both); `change.models.<lane>` is a
  // `{ provider, model }` picked in the list of Hermes, or null for « the model of Hermes »; an invalid pick is null, never sent as is
  const kept = state.settings.models || {}
  const asked = change.models && typeof change.models === 'object' ? change.models : {}
  const models = Object.fromEntries(LLM_LANES.map(l => [l, l in asked ? cleanModelPick(asked[l]) : cleanModelPick(kept[l])]))
  return {
    features: { ...Object.fromEntries(LLM_FEATURES.map(f => [f, features[f] === true])), ...useful },
    capUsd: Math.round(clamp(num(Number(capUsd), state.settings.capUsd), 0, CAP_USD_MAX) * 100) / 100,
    callCap: clamp(Math.trunc(num(Number(callCap), state.settings.callCap)), 0, CALL_CAP_MAX),
    models
  }
}

/** A cap typed in a field -> a number, or null when it is not one (the field keeps its last good value). */
export function parseCap(text, kind) {
  const s = String(text ?? '').trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return kind === 'calls' ? (Number.isInteger(n) ? clamp(n, 0, CALL_CAP_MAX) : null) : Math.round(clamp(n, 0, CAP_USD_MAX) * 100) / 100
}

/**
 * A function of work is offered (its button is drawn) when the agent half answered, serves it, the user switched it on and Hermes
 * gives it a model. A cap that is reached still draws the button (the window says the refusal in one line instead of hiding it); an error
 * of the last call too (it may be asked again). The sober mode of the page does not enter here.
 */
export function workReady(state, feature) {
  if (!state || !LLM_WORK.includes(feature) || state.settings.features[feature] !== true || !state.available) return false
  return state.features.includes(feature)
}

/**
 * What the page shows of the LLM functions, as one decision: `on` only when the agent half answered AND the page is not sober (« nothing
 * LLM shown » in sober mode: no decor, no model outfit, no button, no tooltip); `style` the decor to draw (null = the default office);
 * `roles` the model's outfits; `decorReady` the decorator's button (function on, with a model route). Pure.
 */
export function llmView(state, sober = false, extra = {}) {
  const on = !sober && state != null
  const ready = f => on && state.features.includes(f) && featureState(state, f) !== 'off'
  const feat = f => on && state.settings.features[f] === true
  // `extra`: { game, office, nowMs, agents (scene agents), seatChoice, visible }: what the page knows and the state does not
  const milestones = feat('art') ? milestonesOf(extra.game, extra.office, extra.nowMs ?? 0) : []
  const weights = extra.weights ?? []
  // the functions that WORK (a draft the user reads) are not decor: the sober mode hides the decor, not these. They need only the agent
  // half's answer, their own switch and a model route; `sober` never enters
  const work = Object.fromEntries(LLM_WORK.map(f => [f, workReady(state, f)]))
  return {
    on,
    work,
    recruitReady: work.recruit,
    reviseReady: work.revise,
    style: on ? decorStyle(state) : null,
    roles: on ? modelRoles(state) : {},
    decorReady: ready('decor'),
    // wall art: the real milestones, those still without a poster, and the posters the wall carries (only real milestones with a fiche)
    milestones,
    pending: feat('art') ? pendingMilestones(milestones, state.fiches.art) : [],
    posters: feat('art') ? postersOf(milestones, state.fiches.art) : [],
    artReady: ready('art'),
    // seating: what the scene receives (null = the default order) and whether the dialog can ask the model
    seating: seatingFor({ on: feat('seating'), choice: extra.seatChoice, fiche: state?.fiches?.seating ?? null, weights }),
    seatingReady: ready('seating'),
    // thought bubbles: only the agents at work, only while the function is ON and the page is visible
    thoughts: on ? thoughtsShown(state, extra.agents, { sober, visible: extra.visible !== false }) : {},
    thoughtsReady: ready('thoughts') && featureState(state, 'thoughts') === 'ready'
  }
}

/* ---------- decorator ---------- */
/**
 * A style that came back is applied at once (the office shows it, « Keep / Back ») ONLY if the window stayed open from the call to
 * its answer. A window closed meanwhile (even reopened) means the answer stays kept by the agent half, unapplied, until « Apply ». Pure.
 */
export const decorAppliesNow = (answer, closedDuring) => !closedDuring && answer?.kind === 'done' && answer.reset !== true && answer.fiche != null
export const decorResolveBody = (id, choice) => ({ id, choice: choice === 'apply' ? 'apply' : 'ignore' })
/** The style typed, as it will be sent: spaces squeezed, 1 to 280 characters. null = nothing to send. */
export function cleanStyle(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, STYLE_MAX) : null
}
export const decorBody = (id, style, lang) => ({ id, style: cleanStyle(style), lang: ['en', 'fr', 'es'].includes(lang) ? lang : 'en' })
export const outfitsBody = (id, skip, lang) => ({ id, skip: [...new Set(skip)].slice(0, 64), lang: ['en', 'fr', 'es'].includes(lang) ? lang : 'en' })

/** The decor the page draws: the stored fiche made safe by the engine (unknown values ignored), only while the function is ON. */
export function decorStyle(state) {
  if (!state || !state.settings.features.decor) return null
  return normalizeStyle(state.fiches.decor?.fiche)
}

/* ---------- outfits ---------- */
const validRole = r => typeof r === 'string' && Object.hasOwn(ROLES, r)

/** The profiles whose role the user chose by hand (`ui_meta`): never sent, never overridden. 'none' is a choice too. */
export function manualProfiles(agents) {
  return (agents || []).filter(a => { const r = a?.officeMeta?.role; return typeof r === 'string' && (validRole(r) || r === 'none') }).map(a => a.name)
}

/**
 * The role the model chose for each profile, only while the function is ON, only a role of the catalogue (any other is ignored).
 * -> { [profile]: { modelRole, modelRoleAt (ms) } }. A hand-picked role still wins in the engine (wardrobe roleOf).
 */
export function modelRoles(state) {
  if (!state || !state.settings.features.outfits) return dict()
  const out = dict()
  for (const [name, e] of Object.entries(state.fiches.outfits)) if (validRole(e.role)) out[name] = { modelRole: e.role, modelRoleAt: e.at > 0 ? e.at * 1000 : null }
  return out
}

/** The scene's profiles with the model's roles added (a copy; the profile facts of /history are untouched). */
export function withModelRoles(profiles, roles) {
  const out = dict(profiles || {})
  for (const [name, r] of Object.entries(roles || {})) out[name] = { ...(out[name] || {}), ...r }
  return out
}

/* ---------- a call's answer ---------- */
/** Refusal and failure reasons the agent half can give (hermes_officecraft/llm.py REASONS), plus the page's own (`busy`, `unreachable`). */
export const REASONS = Object.freeze(['disabled', 'unavailable', 'cap_reached', 'too_soon', 'unchanged', 'nothing_to_send', 'invalid_output', 'model_error', 'timeout', 'not_allowed', 'busy', 'unreachable'])

/**
 * `POST /llm/<function>` answered -> { kind: 'done' | 'refused' | 'failed', reason, cap, fiche, costUsd, costStatus, reset }; null when it is
 * not an answer. The reason is shown by its code, never a text from the model or an exception.
 */
export function readAnswer(body) {
  if (!body || typeof body !== 'object' || typeof body.result !== 'string') return null
  const kind = ['done', 'refused', 'failed'].includes(body.result) ? body.result : null
  if (!kind) return null
  const reason = typeof body.reason === 'string' && REASONS.includes(body.reason) ? body.reason : kind === 'done' ? null : 'model_error'
  return {
    kind,
    reason,
    cap: body.cap === 'usd' || body.cap === 'calls' ? body.cap : null,
    fiche: body.fiche && typeof body.fiche === 'object' ? body.fiche : null,
    costUsd: Number.isFinite(body.costUsd) ? body.costUsd : null,
    costStatus: typeof body.costStatus === 'string' ? body.costStatus : null,
    reset: body.reset === true
  }
}

/** A call that threw (HTTP 409 busy, 4xx/5xx, network) -> the failed answer the page shows. */
export function answerOfError(error) {
  // the host's REST door throws `Error("<status>: <body>")` (no `.body`, no `.status`): 409 is the agent half's « busy »
  const status = Number(error?.status ?? (String(error?.message ?? '').match(/^(\d{3})\b/) || [])[1])
  const code = status === 409 ? 'busy' : error?.body?.reason
  const reason = typeof code === 'string' && REASONS.includes(code) ? code : 'unreachable'
  return { kind: 'failed', reason, cap: null, fiche: null, costUsd: null, costStatus: null, reset: false }
}

/**
 * The cost of a call, as the dialog says it: 'known' (an estimate, in dollars), 'unknown' (no price: a subscription or a model without a
 * tariff, counted in calls), 'error' (the call failed without usage, counted in calls), or null (nothing was called).
 */
export function costKind(answer) {
  if (!answer || answer.kind === 'refused') return null
  if (answer.costStatus === 'estimated' || answer.costStatus === 'actual') return answer.costUsd != null ? 'known' : 'unknown'
  if (answer.costStatus === 'error') return 'error'
  return answer.costStatus ? 'unknown' : null
}

/** « 0,0003 $ »-style amount with enough decimals for a fraction of a cent (the agent half's estimate is ~0.0003 $ per fiche). */
export function formatUsd(usd, lang = 'en') {
  if (!Number.isFinite(usd)) return ''
  const digits = usd === 0 ? 2 : usd < 0.01 ? 4 : 2
  try {
    return new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(usd)
  } catch {
    return usd.toFixed(digits)
  }
}

/** A tooltip's reading of where an outfit comes from: { kind: 'manual' | 'model' | rules }, plus when the model chose (ms). Pure view of `roleOf().why`. */
export function outfitSource(why) {
  if (!why) return { kind: 'none', at: null }
  return { kind: why.kind, at: why.kind === 'model' ? why.at ?? null : null }
}
