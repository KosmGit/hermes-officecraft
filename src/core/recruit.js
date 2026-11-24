/**
 * Recruiting a bot from the office, as pure data. No SDK, no DOM, no clock; the RPC is passed in (`request`), so the whole
 * flow runs under node. The Bots tab does the same calls (create-dialog.tsx `profiles.create`, then
 * `profiles.configure`).
 *
 * Rules:
 *   - the identifier is validated BEFORE anything is sent: Hermes lowercases a name in silence, so the page refuses what it would change;
 *   - `soul` of an EXISTING bot is never read, displayed or kept: a copied bot keeps the SOUL.md it was copied with, any other start gets
 *     the same short identity sheet the Bots tab writes (title + role description), composed at the moment of sending. The only SOUL
 *     the draft carries is one the model WROTE for the bot being recruited (`h.soul`): shown, editable, sent by `profiles.create`
 *     for a non-copied bot, never read back;
 *   - the model is NOT sent with `profiles.create` (that call pins it without the expensive-model guard): it goes through
 *     `profiles.configure`, which answers `confirm_required` for a costly model and writes nothing until the user confirms;
 *   - the answer of `profiles.create` (`path`, `soul_written`, `mirrored`) is read for success only; the folder path is dropped.
 */

import { ROLES } from '../scene/wardrobe.js'
import { slugify } from './campaign.js'

export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const RESERVED = Object.freeze(['default', 'hermes', 'test', 'tmp', 'root', 'sudo'])
export const TITLE_MAX = 60
export const DESCRIPTION_MAX = 280
/** The longest SOUL the model may write for a bot being recruited (hermes_officecraft/llm.py SOUL_LIMIT). */
export const SOUL_MAX = 4000
export const STARTS = Object.freeze(['clone', 'fresh', 'empty'])
/** Longest Hermes message kept about a model that needs a confirmation. */
const MESSAGE_MAX = 600

export function hireDraft(profiles = []) {
  return {
    name: '', title: '', description: '', start: 'clone',
    from: profiles.find(p => p.isDefault)?.name || profiles[0]?.name || 'default',
    model: '', provider: '', off: [],
    role: AUTO_ROLE   // « Automatic » (guessed by the office) or a role of the catalogue / 'none', written to ui_meta at the creation
  }
}

/** The type of bot the form can write: the guess (`auto`, what the office has always stored), 'none' (no role: the generalist outfit) or a role of the catalogue. */
export const AUTO_ROLE = 'auto'
export const roleChoice = r => (r === AUTO_ROLE || r === 'none' || (typeof r === 'string' && Object.hasOwn(ROLES, r)) ? r : AUTO_ROLE)

/** The order the picker lists the roles in: by family (leadership, making, tech and quality, knowledge, business). Any role of the catalogue not named here follows, so none is ever unreachable. */
const ROLE_ORDER = ['executive', 'manager', 'product', 'assistant', 'hr', 'designer', 'writer', 'translator', 'media', 'comms', 'developer', 'devops', 'data', 'reviewer', 'researcher', 'teacher', 'marketer', 'sales', 'support', 'finance', 'legal', 'logistics']
/** « Automatic », every role of the wardrobe (`ROLES`), then « none » (the generalist outfit): the choices of the form, ids as written to ui_meta. */
export function roleChoices() {
  const all = Object.keys(ROLES)
  return [AUTO_ROLE, ...ROLE_ORDER.filter(r => all.includes(r)), ...all.filter(r => !ROLE_ORDER.includes(r)), 'none']
}

/** Same identity block as the Bots tab (composeSoul): the server writes SOUL.md only when `soul` is sent. */
export function composeSoul(h) {
  const shown = h.title || h.name
  return [`# ${shown}`, '', h.title ? `**Role:** ${h.title}` : null, h.description ? `**Mission:** ${h.description}` : null, '',
    `You are ${shown}, a persistent named agent (profile \`${h.name}\`) on this machine.`,
    'You keep your own memory, skills, and conversation history across sessions.'].filter(l => l !== null).join('\n')
}

const clip = (s, n) => String(s ?? '').trim().slice(0, n)

/**
 * The calls Hermes receives, in order: [[method, params], ...]. `profiles.create` first; then `profiles.configure` for the skills to
 * switch off (copy only), for the display title and this plugin's own tag, and for the model (alone, so that a confirmation held by
 * Hermes leaves the rest applied).
 */
export function hirePayload(h) {
  const title = clip(h.title, TITLE_MAX)
  const description = clip(h.description, DESCRIPTION_MAX)
  const create = { name: h.name }
  if (description) create.description = description   // the kanban routes cards on this text: kept clean, the title goes to ui_meta
  if (h.start === 'clone') create.clone_from = h.from
  if (h.start === 'empty') create.no_skills = true
  // the SOUL the model wrote and the user reviewed (`h.soul`, a draft field, sent once and never read back). A new bot (fresh, empty)
  // takes it, else the short identity sheet composed here. A copy keeps the copied SOUL.md, EXCEPT when the draft comes from the model:
  // that SOUL is then taken by default, the copy's own describing another job, unless the user chose « keep the source's » (`soulKeep`:
  // no `soul` is sent; `profiles.create` writes SOUL.md after the copy, so sending it replaces the copied one)
  const written = typeof h.soul === 'string' && h.soul.trim() ? h.soul.trim().slice(0, SOUL_MAX) : ''
  if (h.start !== 'clone') create.soul = written || composeSoul({ name: h.name, title, description })
  else if (written && !h.soulKeep) create.soul = written
  const reqs = [['profiles.create', create]]
  if (h.start === 'clone' && h.off?.length) reqs.push(['profiles.configure', { name: h.name, disabled_skills: [...h.off] }])
  // `role`: the key the scene reads (roster officeMeta.role -> wardrobe roleOverride); `copiedFrom`: the bot whose skills came along,
  // so the guess of a bot left on `auto` does not count them (wardrobe scoreRole)
  const meta = { 'hermes-officecraft': { role: roleChoice(h.role), hiredFrom: 'office' } }
  if (h.start === 'clone' && h.from) meta['hermes-officecraft'].copiedFrom = h.from
  if (title) meta['hermes-bots'] = { title }   // where the Bots tab reads the display title
  reqs.push(['profiles.configure', { name: h.name, ui_meta: meta }])
  const model = clip(h.model, 200)
  const provider = clip(h.provider, 100)
  if (model && provider) reqs.push(['profiles.configure', { name: h.name, model, provider }])
  return reqs
}

/** The same calls for display: the identity sheet is replaced by a marker (the page never shows a `soul`). */
export function requestsPreview(h) {
  return hirePayload(h).map(([method, params]) => [method, 'soul' in params ? { ...params, soul: '…' } : params])
}

/** Codes (not sentences: the page translates them). Empty = the draft can be sent. `profiles` = [{ name }] already known. */
export function hireErrors(h, profiles = []) {
  const e = []
  if (!h.name) e.push('name_empty')
  else if (!NAME_RE.test(h.name)) e.push('name_format')
  else if (RESERVED.includes(h.name)) e.push('name_reserved')
  else if (profiles.some(p => String(p.name).toLowerCase() === h.name)) e.push('name_taken')
  const m = String(h.model ?? '').trim()
  const p = String(h.provider ?? '').trim()
  if ((m && !p) || (!m && p)) e.push('model_pair')
  if (h.start === 'clone' && !profiles.some(x => x.name === h.from)) e.push('from_missing')
  return e
}

/**
 * The identifier follows the display title until it has been written by hand: the patch `{ name }` that typing `title` makes, or `{}`
 * when the identifier is its own (typed, or filled in by the model: it is then no longer the slug of the title that preceded).
 */
export const followTitle = (draft, title) => (!draft.name || draft.name === slugify(draft.title) ? { name: slugify(title) } : {})

/** What a typed identifier becomes: lowercase, no surrounding blanks (the page shows the result, never a silent change). */
export const normalizeName = s => String(s ?? '').trim().toLowerCase()

/**
 * The desk the office would draw for this draft: the same inputs as a real bot (name, description, own skills). The description is
 * the one `profiles.create` sends (what `profiles.list` will carry); the title goes to ui_meta, which the roster does not read, so it
 * is not mixed in (it would make the preview announce a role the bot did not get).
 */
export function hireAgent(h, profiles = []) {
  const src = profiles.find(p => p.name === h.from)
  const own = h.start === 'clone' && src?.skills?.own ? src.skills.own.filter(s => !h.off.includes(s.name)) : []
  const description = clip(h.description, DESCRIPTION_MAX)
  // the skills of a copy are the SOURCE's (a `manager` copied from `default` carries its testing / audit / review skills): they
  // say nothing about this bot's job, so they are listed as copied and the guess ignores them; the name and the description decide.
  // The type chosen by hand is the override, like the one written to ui_meta.
  const role = roleChoice(h.role)
  return {
    name: h.name || 'new', label: h.title || h.name || '', description, skills: { enabled: own.length, own }, copiedSkills: own.map(s => s.name), state: 'new',
    ...(role === AUTO_ROLE ? {} : { roleOverride: role })
  }
}

/* ---------- the flow ---------- */

const GONE = /time(d)?[ -]?out|timeout|socket|closed|disconnect|network|abort|unavailable/i
/** Why `profiles.create` failed, as one of the page's reason codes. A lost call is unknown, never « failed » (it may have created the folder). */
export function createFailure(error) {
  const msg = String(error?.message ?? error ?? '')
  if (!msg || GONE.test(msg)) return 'unknown_outcome'
  if (/exist/i.test(msg)) return 'name_taken'
  if (/name|invalid|reserved/i.test(msg)) return 'name_invalid'
  return 'hermes_error'
}

const okStep = res => Boolean(res?.ok) && res.data?.ok !== false
const heldMessage = data => clip(data?.confirm_message, MESSAGE_MAX)

/**
 * The recruitment: `profiles.create`, then each `profiles.configure`. `request(method, params)` -> { ok, data?, error? } (safeRequest).
 * -> { ok, created, reason, failed: ['skills' | 'meta' | 'model'], modelHeld: { message, model, provider } | null }
 *    ok = the profile was created. `failed` lists the settings Hermes did not apply (the bot exists without them: the page says so).
 */
export async function runRecruit(draft, request) {
  const [[createMethod, createParams], ...configs] = hirePayload(draft)
  const made = await request(createMethod, createParams)
  if (!made.ok) return { ok: false, created: false, reason: createFailure(made.error), failed: [], modelHeld: null }
  if (made.data?.ok === false) return { ok: false, created: false, reason: 'hermes_error', failed: [], modelHeld: null }
  const failed = []
  let modelHeld = null
  for (const [method, params] of configs) {
    const res = await request(method, params)
    const key = 'disabled_skills' in params ? 'skills' : 'ui_meta' in params ? 'meta' : 'model'
    if (key === 'model' && res.ok && res.data?.confirm_required) {
      modelHeld = { message: heldMessage(res.data), model: params.model, provider: params.provider }
      continue
    }
    if (!okStep(res)) failed.push(key)
  }
  return { ok: true, created: true, reason: null, failed, modelHeld }
}

/** The model of a bot just recruited, after the user confirmed what Hermes warned about. -> { ok, reason }. */
export async function runModel(name, model, provider, request) {
  const res = await request('profiles.configure', { name, model: clip(model, 200), provider: clip(provider, 100), confirm_expensive_model: true })
  if (!res.ok) return { ok: false, reason: createFailure(res.error) === 'unknown_outcome' ? 'unknown_outcome' : 'hermes_error' }
  if (res.data?.confirm_required || res.data?.ok === false || res.data?.applied?.model === false) return { ok: false, reason: 'hermes_error' }
  return { ok: true, reason: null }
}

/**
 * Read `profiles.list` back: is the bot there (true), absent (false), or could the list not be read (null: nothing is claimed).
 * `model`/`provider` are what the row says; never the row's path.
 */
export async function readListed(name, request) {
  const res = await request('profiles.list', { include_sessions: false })
  const rows = res.ok && Array.isArray(res.data?.profiles) ? res.data.profiles : null
  if (!rows) return { listed: null, model: '', provider: '' }
  const row = rows.find(r => String(r?.name ?? '').toLowerCase() === name)
  return { listed: Boolean(row), model: String(row?.model ?? ''), provider: String(row?.provider ?? '') }
}

/**
 * The model of a bot as Hermes reports it (`profiles.describe`): `profiles.list` does NOT carry it for a bot served by the multiplexed
 * gateway (always empty), so the model follow-up is read back here. Only `model.default` / `model.provider` are read:
 * the `soul` and the rest of the same answer are never looked at, never kept. -> { read, model, provider }.
 */
export async function readModel(name, request) {
  const res = await request('profiles.describe', { name })
  const m = res.ok && res.data && typeof res.data.model === 'object' ? res.data.model : null
  if (!m) return { read: false, model: '', provider: '' }
  return { read: true, model: String(m.default ?? ''), provider: String(m.provider ?? '') }
}

/**
 * The journal line of a recruitment (`POST /audit`): the profile name and the result only, never a description, a title or a soul.
 */
export function recruitAuditBody(order, { result, reason = null }) {
  const body = { id: order.id, verb: 'recruit', risk: 'final', result, profile: order.code }
  if (reason && /^[a-z][a-z0-9_]{0,63}$/.test(reason)) body.reason = reason
  return body
}

/**
 * The journal line of a revision (`POST /audit`): the bot and the result, plus — like a comment's `len` — the length of the description
 * written. Never the text, never a title, never a soul: `AuditIn` has no field for them and refuses one that is sent.
 */
export function reviseAuditBody(order, { result, reason = null, length = null }) {
  const body = { id: order.id, verb: 'revise', risk: 'rev', result, profile: order.code }
  if (reason && /^[a-z][a-z0-9_]{0,63}$/.test(reason)) body.reason = reason
  if (Number.isInteger(length) && length >= 0) body.len = length
  return body
}
