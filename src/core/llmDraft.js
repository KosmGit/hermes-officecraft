/**
 * What the model drafts, as the page reads it and merges it. Pure: no SDK, no DOM, no clock. No interface here.
 *
 * `POST /llm/recruit` and `POST /llm/revise` answer a DRAFT (a closed « fiche » the agent half already validated). This module builds the
 * two bodies, reads the answer again with the same rules (the page does not trust the wire), and MERGES a recruitment draft into the
 * `hireDraft` of src/core/recruit.js: the fields the model wrote, the list of those fields (the page marks them « written by the model,
 * to review »), the skills to switch off computed from `keep_skills`. A draft that breaks one rule is refused WHOLE (the form stays as it
 * was): never repaired, never cut. Nothing is created or changed here: the order stays `profiles.create` / `profiles.configure` on a click.
 */
import { ROLES } from '../scene/wardrobe.js'
import { printable } from './campaign.js'
import { readAnswer, reportedName } from './llm.js'
import { DESCRIPTION_MAX, SOUL_MAX, TITLE_MAX, hireErrors } from './recruit.js'

export const DRAFT_FEATURES = Object.freeze(['recruit', 'revise', 'campaign', 'cardbody', 'lint'])
export const MISSION_MAX = 1000
export const SOUL_MIN = 200
export const CHANGE_MAX = 120
export const CHANGES_MAX = 3
/** The keys of a recruitment fiche, exactly (hermes_officecraft/llm.py RECRUIT_KEYS). */
// (written as a list of words: the bundle check reads « from » followed by a quote as an import)
export const RECRUIT_KEYS = Object.freeze('name title description role start from keep_skills soul overlap'.split(' '))
/** The fields of the hire form the model fills (the ones the page marks « written by the model, to review »). `from` and `off` only for a copy. */
export const MODEL_FIELDS = Object.freeze('name title description role start from off soul'.split(' '))

const LANGS = ['en', 'fr', 'es']
const lang = l => (LANGS.includes(l) ? l : 'en')

/* ---------- the bodies posted: the mission or a name, nothing else (the agent half reads the bots itself) ---------- */
export const recruitBody = (id, mission, l) => ({ id, mission: String(mission ?? '').trim().slice(0, MISSION_MAX), lang: lang(l) })
export const reviseBody = (id, profile, l) => ({ id, profile: String(profile ?? ''), lang: lang(l) })
export const draftForgetBody = (id, feature) => ({ id, feature })

/* ---------- the same text rules as the agent half (llm.py _model_text): printable, not blank, no link, no markup ---------- */
const TAG = /<\s*\/?\s*[A-Za-z!?]/
// a scheme GLUED to what follows (not a blank, `*` or `_`: « the data: date… », « **Data:** » are words), or a domain with a path
const SCHEME = /(?<![a-z0-9])(?:javascript|vbscript|data|mailto|file|ftp|tel|sms|media|blob|https?|wss?):(?=[^\s*_])|[a-z0-9-]+\.[a-z]{2,}\/|(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]{1,5})?\/|(?<![a-z0-9])[a-z0-9][a-z0-9.-]{0,62}:[0-9]{2,5}\/|(?<![:/a-z0-9])\/\/[a-z0-9]/i
/** A text a model wrote that a person, then a bot, will read: printable, not blank, `lo` to `hi` long, no link, no markup. */
export function modelTextOk(value, hi, { multiline = false, lo = 1 } = {}) {
  return typeof value === 'string' && value.length >= lo && value.length <= hi && value.trim() !== '' && printable(value, multiline) &&
    !TAG.test(value) && !value.includes('://') && !value.toLowerCase().includes('www.') && !SCHEME.test(value)
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const closedKeys = (o, keys) => isObject(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k))

/** A fiche of `POST /llm/recruit` as the wire gave it -> the closed object, or null when its shape is not exactly the contract's. */
export function readRecruitFiche(f) {
  if (!closedKeys(f, RECRUIT_KEYS)) return null
  for (const k of RECRUIT_KEYS) if (k !== 'keep_skills' && typeof f[k] !== 'string') return null
  if (!Array.isArray(f.keep_skills) || !f.keep_skills.every(s => typeof s === 'string')) return null
  return Object.fromEntries(RECRUIT_KEYS.map(k => [k, k === 'keep_skills' ? [...f.keep_skills] : f[k]]))
}

/** A fiche of `POST /llm/revise` -> `{ description, changes }` or null. */
export function readReviseFiche(f) {
  if (!closedKeys(f, ['description', 'changes'])) return null
  if (typeof f.description !== 'string' || !Array.isArray(f.changes) || !f.changes.every(c => typeof c === 'string')) return null
  return { description: f.description, changes: [...f.changes] }
}

/** The answer of a draft call, as `readAnswer` reads it plus what only a draft carries: the route taken, the relaunch, a draft that expired. */
export function readDraftAnswer(body) {
  const base = readAnswer(body)
  if (!base) return null
  return {
    ...base,
    lane: body.lane === 'strong' || body.lane === 'light' ? body.lane : null,
    via: body.via === 'model' || body.via === 'task' ? body.via : null,
    model: reportedName(body.model),       // a name shaped like a key, or with an invisible character, is never shown
    provider: reportedName(body.provider),
    retried: body.retried === true,
    expired: body.expired === true
  }
}

/**
 * `GET /llm/draft` -> the draft a closed window did not read, `{ id, at, target, fiche }`, or null (expired, forgotten, unreadable). A review (`lint`)
 * also keeps `truncated` and `dropped`, as its live answer says them (`readLintAnswer`).
 */
export function readDraftRead(body, feature) {
  if (!isObject(body) || body.ok !== true || body.feature !== feature || typeof body.id !== 'string' || !isObject(body.fiche)) return null
  const out = { id: body.id, at: Number.isFinite(body.at) ? body.at : 0, target: typeof body.target === 'string' ? body.target : null, fiche: body.fiche }
  const n = v => (Number.isInteger(v) && v >= 0 ? v : 0)
  return feature === 'lint' ? { ...out, truncated: n(body.truncated), dropped: n(body.dropped) } : out
}

/* ---------- recruit: merge a fiche into the draft of the Recruit window ---------- */
// the fields only a copy fills (the source, the skills switched off); written as one string so the bundle holds no `from '…'` look-alike (dev/check.mjs reads those as imports)
const COPY_ONLY = new Set('from off'.split(' '))
const ownNames = p => (Array.isArray(p?.skills?.own) ? p.skills.own.map(s => s?.name).filter(n => typeof n === 'string') : [])
const longOr = (text, max, long, bad) => (typeof text === 'string' && text.length > max && modelTextOk(text, 2000) ? long : bad)

/**
 * Faults (codes, not sentences: the page translates them) of a recruitment fiche against the roster. Empty = it can fill the form.
 * The roster is `[{ name, skills: { own: [{ name }] } }]` (`hireDraft` / `profiles.list` shape). `fiche` comes from `readRecruitFiche`.
 */
export function recruitFicheErrors(fiche, profiles = []) {
  if (!fiche) return ['shape']
  const e = []
  if (!modelTextOk(fiche.title, TITLE_MAX)) e.push(longOr(fiche.title, TITLE_MAX, 'title_long', 'title_invalid'))
  if (!modelTextOk(fiche.description, DESCRIPTION_MAX)) e.push(longOr(fiche.description, DESCRIPTION_MAX, 'description_long', 'description_invalid'))
  if (fiche.role !== 'none' && !Object.hasOwn(ROLES, fiche.role)) e.push('role_unknown')
  if (fiche.start !== 'clone' && fiche.start !== 'fresh') e.push('start_unknown')
  if (fiche.start === 'clone') {
    const source = profiles.find(p => p.name === fiche.from)
    if (!source) e.push('from_missing')
    else if (!fiche.keep_skills.every(s => ownNames(source).includes(s)) || new Set(fiche.keep_skills).size !== fiche.keep_skills.length) e.push('skills_foreign')
  } else if (fiche.from !== '' || fiche.keep_skills.length) e.push('fresh_with_source')
  if (!modelTextOk(fiche.soul, SOUL_MAX, { multiline: true, lo: SOUL_MIN })) e.push('soul_invalid')
  if (fiche.overlap !== '' && (!profiles.some(p => p.name === fiche.overlap) || fiche.overlap === fiche.name)) e.push('overlap_unknown')
  return e
}

/**
 * The fiche merged into the draft of the form (`hireDraft` of src/core/recruit.js): the name, the title, the description, the type of bot, the
 * start, the source and the skills to switch off (`off` = the own skills of the source that `keep_skills` does not keep), the SOUL written for
 * this bot. `overlap` (a bot that already covers the mission, or '') is returned beside: it is not a field of the form.
 *
 * -> `{ ok, draft, filled, overlap, errors }`. `filled` = the fields the model wrote (`MODEL_FIELDS`, `from` and `off` for a copy only).
 * Refused whole (`ok: false`): `draft` is the one passed in, untouched, `filled` is empty and `errors` says why (`hireErrors` codes, plus the
 * codes of `recruitFicheErrors`: `title_long`, `description_long`, `skills_foreign`, `soul_invalid`…). A name taken or reserved is refused too.
 */
export function mergeRecruit(draft, rawFiche, profiles = []) {
  const fiche = readRecruitFiche(rawFiche)
  const errors = recruitFicheErrors(fiche, profiles)
  if (!errors.length) {
    const copy = fiche.start === 'clone'
    const own = copy ? ownNames(profiles.find(p => p.name === fiche.from)) : []
    const next = {
      ...draft, name: fiche.name, title: fiche.title, description: fiche.description, role: fiche.role, start: fiche.start,
      from: copy ? fiche.from : draft.from, off: copy ? own.filter(n => !fiche.keep_skills.includes(n)) : [], soul: fiche.soul
    }
    errors.push(...hireErrors(next, profiles))   // format, reserved, already taken: the same checks as the « Recruit » button
    if (!errors.length) {
      return { ok: true, draft: next, filled: MODEL_FIELDS.filter(f => copy || !COPY_ONLY.has(f)), overlap: fiche.overlap, errors: [] }
    }
  }
  return { ok: false, draft, filled: [], overlap: '', errors }
}

/* ---------- revise: before / after of one description ---------- */
/** Faults of a revision fiche (codes). Empty = it can be shown as « before / after ». */
export function reviseFicheErrors(fiche) {
  if (!fiche) return ['shape']
  const e = []
  if (!modelTextOk(fiche.description, DESCRIPTION_MAX)) e.push(longOr(fiche.description, DESCRIPTION_MAX, 'description_long', 'description_invalid'))
  if (fiche.changes.length > CHANGES_MAX || !fiche.changes.every(c => modelTextOk(c, CHANGE_MAX))) e.push('changes_invalid')
  return e
}

/**
 * A revision as « before / after »: `{ ok, before, after, changes, errors }`. Applied by `reviseConfigure` (`profiles.configure { description }`
 * and nothing else), on the user's click. A fiche that breaks a rule is refused whole.
 */
export function mergeRevise(currentDescription, rawFiche) {
  const fiche = readReviseFiche(rawFiche)
  const errors = reviseFicheErrors(fiche)
  const before = String(currentDescription ?? '')
  return errors.length ? { ok: false, before, after: before, changes: [], errors } : { ok: true, before, after: fiche.description, changes: fiche.changes, errors: [] }
}

/** The one order a revision becomes: the description of that bot, nothing more. */
export const reviseConfigure = (name, description) => ['profiles.configure', { name, description: String(description ?? '').trim().slice(0, DESCRIPTION_MAX) }]

/* ---------- the flow of « Apply » (the RPC is passed in, so the whole of it runs under node) ---------- */

const GONE = /time(d)?[ -]?out|timeout|socket|closed|disconnect|network|abort|unavailable/i

/**
 * `profiles.configure { name, description }` and nothing else, through the host. `request(method, params)` -> `{ ok, data?, error? }` (`safeRequest`).
 * -> `{ ok, reason }`: `ok` only when Hermes says the description was written (`applied.description`); a lost call is `unknown_outcome` (the
 * folder may well have been written: nothing is claimed), anything else Hermes refused is `hermes_error`.
 */
export async function runRevise(name, description, request) {
  const [method, params] = reviseConfigure(name, description)
  const res = await request(method, params)
  if (!res?.ok) {
    const msg = String(res?.error?.message ?? res?.error ?? '')
    return { ok: false, reason: !msg || GONE.test(msg) ? 'unknown_outcome' : 'hermes_error' }
  }
  if (res.data?.ok === false || res.data?.applied?.description === false) return { ok: false, reason: 'hermes_error' }
  return { ok: true, reason: null }
}

/**
 * The description of a bot as `profiles.list` shows it now (the read after « Apply »): `{ listed, description }`; `listed: null` = the list
 * could not be read (nothing is claimed). Only the description of that one row is read: never its path, its sessions or a SOUL.
 */
export async function readDescriptionOf(name, request) {
  const res = await request('profiles.list', { include_sessions: false })
  const rows = res?.ok && Array.isArray(res.data?.profiles) ? res.data.profiles : null
  if (!rows) return { listed: null, description: '' }
  const row = rows.find(r => String(r?.name ?? '').toLowerCase() === String(name).toLowerCase())
  return { listed: Boolean(row), description: typeof row?.description === 'string' ? row.description.trim() : '' }
}
