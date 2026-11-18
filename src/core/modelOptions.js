/**
 * The model + provider the recruitment form offers, read from Hermes' `model.options` (the same call and the same fallback as
 * the Bots tab's picker: apps/desktop/src/plugins/hermes-bots/model-picker.tsx). Pure: no SDK, no DOM, no clock; the RPC is passed to
 * the effect in src/data/modelOptions.js.
 *
 * Privacy: the answer is read through an ALLOW-LIST and nothing else is kept. Of a provider: `slug`, `name`,
 * `authenticated`, `is_current`, `models`; of a model: its id (and `name`), and its price strings from `pricing[id]`. Never kept, even
 * when present: `key_env`, `api_url`, `auth_type`, `warning` (free text), `limit`, `usage`, `plan_usage` and any unknown field. A value that
 * looks like a secret (a key prefix, a bearer token, a JWT, a long hex run) is dropped where it stands. This module neither asks for
 * nor stores a key: `model.save_key` / `model.disconnect` are never called from the office.
 */

/** Longest wait before the free fields come back (the Bots tab's settle guard: 20 s). */
export const MODEL_OPTIONS_TIMEOUT_MS = 20_000
/** The most results drawn at once: the search narrows the rest. */
export const MODELS_SHOWN = 100
/** Same bounds as the recruitment's own `clip` (src/core/recruit.js). */
const ID_MAX = 200
const SLUG_MAX = 100

const SECRET = /(?:\b(?:sk|pk|rk|sess)[-_][A-Za-z0-9_-]{12,}|\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{12,}|\bxox[abprs]-[A-Za-z0-9-]{8,}|\bAIza[0-9A-Za-z_-]{20,}|\bBearer\s+\S{8,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}|(?<![A-Za-z0-9])[0-9a-fA-F]{32,}(?![A-Za-z0-9]))/
const CTRL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff\s]/

/** True for a string that must never be shown, kept or sent on: it looks like a credential. */
export const looksSecret = s => typeof s === 'string' && SECRET.test(s)

/** A model id or provider slug the page will keep: non-empty, bounded, no blank or control character, not a secret. */
const cleanId = (v, max) => {
  if (typeof v !== 'string') return ''
  const s = v.trim()
  return s && s.length <= max && !CTRL.test(s) && !looksSecret(s) ? s : ''
}
/** A display name: bounded, one line, not a secret. */
const cleanName = (v, fallback) => {
  if (typeof v !== 'string') return fallback
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()
  return s && s.length <= 60 && !looksSecret(s) ? s : fallback
}
/** A price as Hermes formats it (« $0.15 », « free »): short, no letter other than a plain unit word. */
const cleanPrice = v => (typeof v === 'string' && /^[\d$€£.,\s/a-zA-Z-]{1,24}$/.test(v.trim()) && !looksSecret(v) ? v.trim() : '')

function readModel(m, pricing) {
  const id = cleanId(typeof m === 'string' ? m : m?.id, ID_MAX)
  if (!id) return null
  const out = { id, name: cleanName(typeof m === 'object' ? m?.name : '', ''), price: null }
  const p = pricing && typeof pricing === 'object' ? pricing[id] : null
  if (p && typeof p === 'object') {
    const input = cleanPrice(p.input)
    const output = cleanPrice(p.output)
    const free = p.free === true
    if (free || input || output) out.price = { input, output, free }   // nothing is computed or guessed: what Hermes said, or nothing
  }
  return out
}

/**
 * The answer of `model.options` as the form reads it.
 * -> { providers: [{ slug, name, ready, current, models: [{ id, name, price }] }], inherited: { model, provider } }
 * `ready` = Hermes says a key or a connection is registered (`authenticated`; a row without the flag comes from an older Hermes that
 * only lists configured providers, so it is ready). `inherited` = what the main bot uses now (top-level `model` / `provider`).
 */
export function parseModelOptions(payload) {
  const rows = Array.isArray(payload?.providers) ? payload.providers : []
  const providers = []
  const seen = new Set()
  for (const r of rows) {
    const slug = cleanId(r?.slug, SLUG_MAX)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    const models = []
    const ids = new Set()
    for (const m of Array.isArray(r.models) ? r.models : []) {
      const one = readModel(m, r.pricing)
      if (one && !ids.has(one.id)) { ids.add(one.id); models.push(one) }
    }
    providers.push({ slug, name: cleanName(r.name, slug), ready: r.authenticated !== false, current: r.is_current === true, models })
  }
  return {
    providers,
    inherited: { model: cleanId(payload?.model, ID_MAX), provider: cleanId(payload?.provider, SLUG_MAX) }
  }
}

/** Ready providers first (the current one at the head), then by name; the others after, by name. */
export function sortProviders(providers) {
  const rank = p => (p.ready ? (p.current ? 0 : 1) : 2)
  return [...providers].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** The models whose id or name holds every word of the query (accents and case ignored). An empty query keeps all. */
export function filterModels(models, query) {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return models
  return models.filter(m => {
    const hay = `${norm(m.id)} ${norm(m.name)}`
    return words.every(w => hay.includes(w))
  })
}

/** « $0.15 in · $0.60 out » as the answer gave it; null when it gave nothing (no figure is made up). */
export function priceLabel(price, t) {
  if (!price) return null
  if (price.free) return t('recruit.model.free')
  const parts = []
  if (price.input) parts.push(t('recruit.model.priceIn', price.input))
  if (price.output) parts.push(t('recruit.model.priceOut', price.output))
  return parts.length ? parts.join(' · ') : null
}

/** Why the free fields are back: 'timeout' | 'unsupported' (an older Hermes without the method) | 'failed' | 'empty' (answered, nothing to pick). */
export function failureOf(res) {
  const msg = String(res?.error?.message ?? res?.error ?? '')
  if (res?.reason === 'timeout') return 'timeout'
  if (res?.reason === 'unavailable' || /unknown method|method not found|not implemented|-32601|no such method/i.test(msg)) return 'unsupported'
  return 'failed'
}
