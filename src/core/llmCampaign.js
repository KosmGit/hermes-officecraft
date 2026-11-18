/**
 * A campaign the model drafted, as the page reads it and puts it into the campaign editor. Pure: no SDK, no DOM,
 * no clock. No interface here.
 *
 * `POST /llm/campaign` answers a DRAFT: `{ phases: [name], cards: [{ ref, phase, title, who, parents, body }] }`, a closed « fiche » the agent half
 * already judged (shape, bounds, bots, parents, loop, then the very rule of `POST /campaign`). The page does not trust the wire: it reads the fiche
 * again with the same rules (`readCampaignFiche`, `campaignFicheErrors`), converts it into the editor's draft the way `applyTemplate` does (same
 * `newDraft` shape, phases with their guards, cards with fresh ids, `mode: 'replace' | 'append'`), then runs the editor's OWN validators on the
 * result (`draftIssues`, `validateRequest(toRequest(…))`). One fault anywhere and the proposal is refused WHOLE: the editor is exactly what it was,
 * nothing is cut or repaired. Nothing is created here: the only way a graph is written stays « Create N cards » (`POST /campaign`).
 *
 * The marks « written by the model, to review »: `marks` remembers the VALUE the model wrote for each field; a field is marked while the card still
 * holds that value, so the user's own edit lifts the mark with no event to wire (`markedFields`); « validate » lifts it at once (`validateMarks`).
 */
import { MAX_BODY, MAX_GOAL, MAX_NAME, MAX_PHASES, MAX_TITLE, MAX_WORK_CARDS, HEAD, draftIssues, guardRef, isGuard, toRequest, validateRequest, workCards } from './campaign.js'
import { modelTextOk } from './llmDraft.js'

export const NOTES_MAX = 4000
/** What the model may name a card: a letter, then letters and digits (hermes_officecraft/llm.py CARD_REF_RE); `G<digits>` is a guard, never a card. */
export const CARD_REF = /^[A-Za-z][A-Za-z0-9]{0,15}$/
export const GUARD_REF = /^G[0-9]+$/
export const CARD_KEYS = Object.freeze('ref phase title who parents body'.split(' '))
/** The fields of a card of the draft the model fills (the ones the page marks). */
export const MODEL_CARD_FIELDS = Object.freeze('title who parents body'.split(' '))
/** How long the page waits for each call: the agent half's delay + 15 s, then it reads `GET /llm` (`pending`). */
export const LLM_WAIT_MS = Object.freeze({ campaign: 255_000, cardbody: 75_000, lint: 105_000 })

const LANGS = ['en', 'fr', 'es']
const lang = l => (LANGS.includes(l) ? l : 'en')
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const sameKeys = (o, keys) => isObject(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k))

/* ---------- the body posted: the goal and the notes the user typed, nothing else (the bots and the limits are read by the agent) ---------- */
export const campaignBody = (id, goal, notes, l) => ({ id, goal: String(goal ?? '').trim().slice(0, MAX_GOAL), notes: String(notes ?? '').slice(0, NOTES_MAX), lang: lang(l) })

/* ---------- the fiche as the wire gave it ---------- */
/** `POST /llm/campaign` fiche -> the closed object, or null when its shape is not exactly the contract's. */
export function readCampaignFiche(f) {
  if (!sameKeys(f, ['phases', 'cards']) || !Array.isArray(f.phases) || !Array.isArray(f.cards)) return null
  if (!f.phases.every(p => typeof p === 'string') || !f.cards.every(c => sameKeys(c, CARD_KEYS))) return null
  for (const c of f.cards) {
    if (typeof c.ref !== 'string' || !Number.isInteger(c.phase) || typeof c.title !== 'string' || typeof c.who !== 'string' || typeof c.body !== 'string') return null
    if (!Array.isArray(c.parents) || !c.parents.every(p => typeof p === 'string')) return null
  }
  return { phases: [...f.phases], cards: f.cards.map(c => ({ ref: c.ref, phase: c.phase, title: c.title, who: c.who, parents: [...c.parents], body: c.body })) }
}

/**
 * Faults (codes, not sentences: the page translates them) of a fiche against the roster. Empty = it can go into the editor. Same rules as the agent half
 * (`validate_campaign`): phases 1 to 8, distinct, each with a card; cards 1 to 40; `ref` unique, never `G<digits>`; `who` a bot of the roster (`bots`,
 * names; an empty list skips this one); `parents` known, never itself, never a LATER phase (the editor's `effective` would drop such a parent silently,
 * so only this check sees it), no loop; every text printable, no link, no markup.
 */
export function campaignFicheErrors(fiche, bots = []) {
  if (!fiche) return ['shape']
  const e = []
  const { phases, cards } = fiche
  if (phases.length < 1 || phases.length > MAX_PHASES) e.push('phases_count')
  if (!phases.every(p => modelTextOk(p, MAX_NAME))) e.push('phase_name')
  if (new Set(phases).size !== phases.length) e.push('phase_twice')
  if (cards.length < 1 || cards.length > MAX_WORK_CARDS) e.push('cards_count')
  const phaseOf = new Map()
  for (const c of cards) {
    if (!CARD_REF.test(c.ref) || GUARD_REF.test(c.ref)) e.push('ref')
    else if (phaseOf.has(c.ref)) e.push('ref_twice')
    phaseOf.set(c.ref, c.phase)
    if (c.phase < 0 || c.phase >= phases.length) e.push('phase_range')
    if (!modelTextOk(c.title, MAX_TITLE)) e.push('title')
    if (!c.who || (bots.length && !bots.includes(c.who))) e.push('who_unknown')
    if (!modelTextOk(c.body, MAX_BODY, { multiline: true })) e.push('body')
    if (new Set(c.parents).size !== c.parents.length) e.push('parents_twice')
  }
  for (const c of cards) {
    for (const p of c.parents) {
      if (p === c.ref) e.push('parent_self')
      else if (!phaseOf.has(p)) e.push('parent_unknown')
      else if (phaseOf.get(p) > c.phase) e.push('parent_later')
    }
  }
  if (phases.length >= 1 && phases.length <= MAX_PHASES && new Set(cards.map(c => c.phase)).size !== phases.length) e.push('phase_empty')
  if (hasLoop(cards)) e.push('loop')
  return [...new Set(e)]
}

/** A loop among the parents of these cards (Kahn). */
function hasLoop(cards) {
  const waiting = new Map(cards.map(c => [c.ref, new Set(c.parents)]))
  while (waiting.size) {
    const free = [...waiting].filter(([, w]) => !w.size).map(([r]) => r)
    if (!free.length) return true
    for (const r of free) waiting.delete(r)
    for (const w of waiting.values()) for (const r of free) w.delete(r)
  }
  return false
}

/* ---------- the marks « written by the model, to review » ---------- */
export const emptyMarks = () => ({ phases: {}, cards: {} })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
/** The fields of a card of the draft that still hold what the model wrote (a field the user changed is no longer marked). */
export function markedFields(marks, card) {
  const m = marks?.cards?.[card?.id]
  return m ? MODEL_CARD_FIELDS.filter(f => f in m && same(m[f], card[f])) : []
}
/** Is the name of phase `k` still the one the model wrote? */
export const isPhaseMarked = (marks, draft, k) => Object.hasOwn(marks?.phases ?? {}, k) && draft.phases[k]?.name === marks.phases[k]
/** Remember what the model wrote into `fields` of a card (a card of the draft that is not one of the model's gets its mark here: `cardbody`). */
export function markCard(marks, card, fields) {
  const m = marks ?? emptyMarks()
  const mine = Object.fromEntries(fields.filter(f => MODEL_CARD_FIELDS.includes(f)).map(f => [f, Array.isArray(card[f]) ? [...card[f]] : card[f]]))
  return { ...m, cards: { ...m.cards, [card.id]: { ...(m.cards[card.id] ?? {}), ...mine } } }
}
/** The user validated a field (or, without `field`, the whole card): the mark goes. */
export function validateMarks(marks, id, field = null) {
  const cards = { ...(marks?.cards ?? {}) }
  if (field && cards[id]) {
    const { [field]: _gone, ...rest } = cards[id]
    cards[id] = rest
  } else delete cards[id]
  return { ...(marks ?? emptyMarks()), cards }
}
/** Marks of cards that no longer exist go (a card removed, a draft replaced). */
export function pruneMarks(marks, draft) {
  const ids = new Set(draft.cards.map(c => c.id))
  return { phases: { ...(marks?.phases ?? {}) }, cards: Object.fromEntries(Object.entries(marks?.cards ?? {}).filter(([id]) => ids.has(id))) }
}

/* ---------- the fiche into the editor's draft ---------- */
const refused = (draft, errors) => ({ ok: false, draft, marks: emptyMarks(), errors, refused: errors[0] })
const keyOf = i => JSON.stringify([i.code, i.id ?? null, i.phase ?? null])
// the editor's own validators on a draft, with a goal and a board standing in (the user may not have typed them yet): what the GRAPH says
const probe = d => ({ ...d, goal: 'goal', boardMode: 'existing', board: 'board' })

/**
 * A campaign fiche as the editor's draft, like `applyTemplate` (src/core/campaign.js) does for a template: `mode` is
 *   - 'replace' : the draft's cards and phases are replaced by the model's (the goal, the project and the head guard stay);
 *   - 'append'  : the model's phases come after the existing ones, each with its guard, its cards wait for what the editor makes them wait for.
 * The cards get fresh ids (`k<n>`, from the draft's `seq`), the model's refs are only used to link its parents. `bots` = the names of the roster
 * (`draftIssues` ctx), `boards` = the slugs known (optional).
 *
 * -> `{ ok, draft, marks, errors, refused }`. Refused whole (`ok: false`): `draft` is the one passed in, untouched, `marks` empty and `errors` says
 * why (the codes of `campaignFicheErrors`, `too_many_phases` / `too_many_cards` past 8 phases / 40 work cards, then the codes of `draftIssues`, then
 * `graph:<reason>` of `validateRequest`). On an append, a fault the draft already had before is not the model's.
 */
export function applyCampaign(draft, rawFiche, { mode = 'replace', bots = [], boards = [] } = {}) {
  const fiche = readCampaignFiche(rawFiche)
  const errors = campaignFicheErrors(fiche, bots)
  if (errors.length || !fiche) return refused(draft, errors.length ? errors : ['shape'])
  const replace = mode !== 'append'
  const head = draft.cards.find(c => c.id === HEAD) ?? { id: HEAD, kind: 'guard', phase: 0, parents: [] }
  const base = replace ? { ...draft, phases: [], cards: [head], sel: null } : draft
  const shift = base.phases.length
  if (shift + fiche.phases.length > MAX_PHASES) return refused(draft, ['too_many_phases'])
  if (workCards(base).length + fiche.cards.length > MAX_WORK_CARDS) return refused(draft, ['too_many_cards'])
  const phases = [...base.phases, ...fiche.phases.map(name => ({ name }))]
  const guards = fiche.phases.map((_, k) => shift + k).filter(p => p >= 1).map(p => ({ id: guardRef(p), kind: 'guard', phase: p, parents: [] }))
  let seq = base.seq
  const ids = new Map(fiche.cards.map(c => [c.ref, `k${++seq}`]))
  const made = fiche.cards.map(c => ({
    id: ids.get(c.ref), kind: 'card', phase: shift + c.phase, title: c.title, who: c.who, model: '', provider: '', body: c.body,
    parents: c.parents.map(p => ids.get(p)), workspace: 'scratch', maxRuntime: 0
  }))
  // the guards sit in front of their phase's cards, the phases in order (the order `applyTemplate` keeps)
  const cards = [...base.cards, ...guards, ...made].sort((a, b) => a.phase - b.phase || (isGuard(b) - isGuard(a)))
  const next = { ...base, phases, cards, seq, sel: null }
  const ctx = { bots, boards: ['board', ...boards] }
  const before = replace ? [] : draftIssues(probe(draft), ctx).map(keyOf)
  const fresh = draftIssues(probe(next), ctx).filter(i => !before.includes(keyOf(i)))
  if (fresh.length) return refused(draft, [...new Set(fresh.map(i => i.code))])
  const why = validateRequest(toRequest(probe(next), 'preview'))
  if (why && (replace || !validateRequest(toRequest(probe(draft), 'preview')))) return refused(draft, [`graph:${why}`])
  const marks = emptyMarks()
  fiche.phases.forEach((name, k) => { marks.phases[shift + k] = name })
  for (const c of made) marks.cards[c.id] = { title: c.title, who: c.who, parents: [...c.parents], body: c.body }
  return { ok: true, draft: next, marks, errors: [], refused: null }
}
