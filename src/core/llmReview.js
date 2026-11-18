/**
 * The instructions of ONE card of the draft rewritten (`cardbody`), and the review before launch (`lint`), as the page builds their
 * bodies, reads their answers again and applies them. Pure: no SDK, no DOM, no clock. No interface here.
 *
 * Neither function reads a card that exists on a board: they take the cards of the DRAFT in the editor, and nothing else. `cardbody` rewrites
 * the instructions of the card it was asked about and of no other (`applyCardbody` finds it by its id: a card removed in the meantime = the proposal
 * is dropped). `lint` is advice: it answers at most 8 remarks about the draft, and never blocks « Create » (`lintView` only sorts and filters).
 * The marks « written by the model, to review » of `llmCampaign.js` apply to the rewritten instructions too.
 */
import { MAX_BODY, MAX_GOAL, MAX_TITLE, MAX_WORK_CARDS, isGuard, patchCard, workCards } from './campaign.js'
import { markCard } from './llmCampaign.js'
import { modelTextOk, readDraftAnswer } from './llmDraft.js'

/** A card's instructions are cut to this before the lint model reads them (hermes_officecraft/llm.py LINT_BODY_SENT); the agent half says how many it cut. */
export const LINT_BODY_SENT = 2000
export const LINT_KINDS = Object.freeze(['no_review', 'wrong_bot', 'vague', 'conflict', 'model', 'order', 'other'])
export const LINT_SEVERITIES = Object.freeze(['high', 'medium', 'low'])
export const FINDINGS_MAX = 8
export const FINDING_MAX = 200
export const PRICES_MAX = 8

const LANGS = ['en', 'fr', 'es']
const lang = l => (LANGS.includes(l) ? l : 'en')
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const sameKeys = (o, keys) => isObject(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k))

/* ---------- cardbody ---------- */
/** The body of `POST /llm/cardbody`: the goal and ONE card of the draft (its id is the `ref`; never the id of a card of a board). */
export const cardbodyBody = (id, goal, card, l) => ({
  id, goal: String(goal ?? '').trim().slice(0, MAX_GOAL),
  card: { ref: String(card?.id ?? ''), title: String(card?.title ?? '').trim().slice(0, MAX_TITLE), who: String(card?.who ?? ''), body: String(card?.body ?? '').slice(0, MAX_BODY) },
  lang: lang(l)
})

/** A `cardbody` fiche -> `{ body }` or null (a shape that is not exactly the contract's). */
export const readCardbodyFiche = f => (sameKeys(f, ['body']) && typeof f.body === 'string' ? { body: f.body } : null)

/** Faults of a rewritten body (codes). Same rule as the agent half (`validate_cardbody`): 1 to 8 000, several lines, printable, no link, no markup. */
export const cardbodyErrors = fiche => (fiche ? (modelTextOk(fiche.body, MAX_BODY, { multiline: true }) ? [] : ['body']) : ['shape'])

/**
 * The rewritten instructions of the card `id`, as « before / after » on the user's click: `{ ok, draft, before, after, marks, refused }`. The card is found by
 * its id in the draft AS IT IS NOW; a card removed meanwhile (`card_gone`) or a fiche that breaks a rule (`invalid`) leaves the draft exactly as it was.
 * Only the `body` of that one card changes. `marks` carries the mark for the new text.
 */
export function applyCardbody(draft, id, rawFiche, marks = null) {
  const card = draft.cards.find(c => c.id === id && !isGuard(c))
  if (!card) return { ok: false, draft, before: '', after: '', marks, refused: 'card_gone' }
  const fiche = readCardbodyFiche(rawFiche)
  if (cardbodyErrors(fiche).length || !fiche) return { ok: false, draft, before: card.body, after: card.body, marks, refused: 'invalid' }
  const next = patchCard(draft, id, { body: fiche.body })
  return { ok: true, draft: next, before: card.body, after: fiche.body, marks: markCard(marks, { ...card, body: fiche.body }, ['body']), refused: null }
}

/* ---------- lint ---------- */
/** One remark of the review: ONE line of 1 to 200 characters, nothing at its edges, no link, no markup (the agent half's `valid_finding`; same cases). */
export const findingTextOk = text => typeof text === 'string' && text === text.trim() && !/[\n\t]/.test(text) && modelTextOk(text, FINDING_MAX)

const PRICE = /^[\d$€£.,\s/a-zA-Z-]{0,24}$/
const cleanPrice = v => (typeof v === 'string' && PRICE.test(v) ? v : '')

/**
 * The body of `POST /llm/lint`: the WORK cards of the draft (the guards are not sent, nor a parent that is a guard), each one's instructions cut to
 * `LINT_BODY_SENT`, and the price of each model the draft pins, as Hermes served it (`prices`: `{ <model>: { input, output, free } }`, from `model.options`;
 * an entry for a model no card pins is not sent). Never the goal, never a card of a board. -> null when the draft has no work card or more than 40
 * (the editor does not offer the review then).
 */
export function lintBody(id, draft, l, prices = {}) {
  const work = workCards(draft)
  if (!work.length || work.length > MAX_WORK_CARDS) return null
  const ids = new Set(work.map(c => c.id))
  const cards = work.map(c => ({
    ref: c.id, phase: c.phase, title: String(c.title ?? '').trim().slice(0, MAX_TITLE), who: String(c.who ?? ''), model: String(c.model ?? ''),
    parents: c.parents.filter(p => ids.has(p)), body: String(c.body ?? '').slice(0, LINT_BODY_SENT)
  }))
  const pinned = [...new Set(cards.map(c => c.model).filter(Boolean))]
  const out = {}
  for (const m of pinned.slice(0, PRICES_MAX)) {
    const p = prices && Object.hasOwn(prices, m) ? prices[m] : null
    if (isObject(p)) out[m] = { input: cleanPrice(p.input), output: cleanPrice(p.output), free: p.free === true }
  }
  return { id, cards, prices: out, lang: lang(l) }
}

/** A `lint` fiche -> `{ findings: [{ ref, kind, severity, text }] }` with the closed shape, or null. A line of another shape is kept apart (`kept`). */
export function readLintFiche(f) {
  if (!sameKeys(f, ['findings']) || !Array.isArray(f.findings)) return null
  return { findings: f.findings }
}

const RANK = Object.fromEntries(LINT_SEVERITIES.map((s, i) => [s, i]))

/**
 * What the review says about THIS draft: `{ ok, findings, dropped }`. More than 8 lines, or a fiche that is not `{ findings: [...] }`, is refused whole
 * (`ok: false`). A line that is not valid (a `ref` the draft does not have any more, a kind or a gravity out of the lists, a text over 200 or with a link) is dropped
 * ALONE; an empty list is a valid review. Sorted by gravity, the order of the model kept inside a gravity. Advice only: nothing here blocks anything.
 */
export function lintView(rawFiche, draft) {
  const fiche = readLintFiche(rawFiche)
  if (!fiche || fiche.findings.length > FINDINGS_MAX) return { ok: false, findings: [], dropped: 0 }
  const refs = new Set(workCards(draft).map(c => c.id))
  const kept = fiche.findings.filter(f => sameKeys(f, ['ref', 'kind', 'severity', 'text']) && typeof f.ref === 'string' && refs.has(f.ref) &&
    LINT_KINDS.includes(f.kind) && LINT_SEVERITIES.includes(f.severity) && findingTextOk(f.text))
    .map(f => ({ ref: f.ref, kind: f.kind, severity: f.severity, text: f.text }))
  return { ok: true, findings: kept.map((f, i) => [f, i]).sort(([a, i], [b, j]) => RANK[a.severity] - RANK[b.severity] || i - j).map(([f]) => f), dropped: fiche.findings.length - kept.length }
}

/**
 * The answer of `POST /llm/lint`, read like any draft answer (`readDraftAnswer`) plus what only the review says: `truncated` (cards whose instructions the
 * agent half cut to `LINT_BODY_SENT`: the page says so) and `dropped` (lines of the model the agent half dropped because they did not pass).
 */
export function readLintAnswer(body) {
  const base = readDraftAnswer(body)
  if (!base) return null
  const n = v => (Number.isInteger(v) && v >= 0 ? v : 0)
  return { ...base, truncated: n(body.truncated), dropped: n(body.dropped) }
}
