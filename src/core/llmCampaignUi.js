/**
 * The campaign editor's side of the three assisted functions, as pure data. No SDK, no DOM, no clock.
 *   - « Propose a graph » (`campaign`): the refusals said in plain words (a closed list of codes: each one is translated), what a proposal holds
 *     (a summary), the plan of applying it (add to the end / replace), the marks « written by the model, to review » of a merged graph;
 *   - « Rewrite the instructions » (`cardbody`): the text applied is the one the user read (edited or not);
 *   - the review before launch (`lint`): the remarks kept with the draft they were written for, and CLEARED the moment that draft changes.
 * The conversion and the validators are those of src/core/llmCampaign.js and src/core/llmReview.js, and the editor's own (src/core/campaign.js):
 * nothing here sends anything, creates anything or relaxes a rule.
 */
import { MAX_BODY, codes, isGuard, patchCard, printable, workCards } from './campaign.js'
import { applyCampaign, emptyMarks, markedFields, pruneMarks, readCampaignFiche } from './llmCampaign.js'
import { REASONS } from './llm.js'
import { applyCardbody, lintView } from './llmReview.js'
import { refusalOf } from './llmAssist.js'
import { dict } from './dict.js'

/** Every refusal code of a proposed graph (the page's own checks): each one is translated under `llm.cg.err.<code>` in the three languages. */
export const CG_ERRORS = Object.freeze([
  // the fiche read again (llmCampaign.js campaignFicheErrors)
  'shape', 'phases_count', 'phase_name', 'phase_twice', 'cards_count', 'ref', 'ref_twice', 'phase_range', 'title', 'who_unknown', 'body',
  'parents_twice', 'parent_self', 'parent_unknown', 'parent_later', 'phase_empty', 'loop',
  // the draft it would make (applyCampaign) and the editor's own `draftIssues`
  'too_many_phases', 'too_many_cards', 'phase_chars', 'no_cards', 'too_many', 'title_empty', 'title_chars', 'body_long', 'body_chars', 'model_pair',
  'no_workdir', 'runtime', 'goal_chars', 'goal_empty', 'board_none', 'board_unknown', 'nb_name', 'slug_empty', 'slug_bad', 'slug_taken',
  // `validateRequest` of the request the draft would send (`graph:<reason>`), and the cases of the card instructions
  'graph', 'other'
])
/** The codes of a rewritten card (cardbody) the page refuses with, translated under `llm.body.err.<code>`. */
export const BODY_ERRORS = Object.freeze(['invalid', 'card_gone', 'blank', 'long', 'chars'])
/** The codes `llm.ref.<code>` already translates: the refusals of the guards and of the call. */
const FROM_CALL = new Set(REASONS)

/**
 * One refusal of a graph as the panel says it: `{ key, calls, action, cap, code }`. `key` = the i18n key of the sentence.
 * Input: the answer of the call (`readDraftAnswer`), or `{ errors }` for a graph the page refused after an answer `done` (the codes of `applyCampaign`).
 */
export function cgRefusalOf({ answer = null, errors = null } = {}) {
  if (errors?.length) {
    const first = String(errors[0])
    const code = first.startsWith('graph:') ? 'graph' : CG_ERRORS.includes(first) ? first : 'other'
    return { key: `llm.cg.err.${code}`, code, calls: answer?.retried ? 2 : 1, action: 'ask', cap: null, all: [...errors] }
  }
  const r = refusalOf({ answer })
  return { key: `llm.ref.${FROM_CALL.has(r.code) || r.code === 'expired' ? r.code : 'model_error'}`, code: r.code, calls: r.calls, action: r.action, cap: r.cap, all: r.all }
}

/** What a proposal holds, for « A graph is ready »: `{ cards, phases, bots }`, or null when the fiche is not a campaign fiche. */
export function proposalSummary(rawFiche) {
  const f = readCampaignFiche(rawFiche)
  return f ? { cards: f.cards.length, phases: f.phases.length, bots: new Set(f.cards.map(c => c.who)).size } : null
}

/**
 * The proposal applied to the draft AS IT IS NOW, in one of the two modes (`applyCampaign`, nothing changes): `{ ok, mode, errors, removed, added }`.
 * `removed` = the work cards the draft loses (replace), `added` = the cards the model brings. An empty draft is always « replace »
 * (there is nothing to add to). A refusal leaves the draft untouched, and says why (past 40 cards or 8 phases for an addition: use « Replace »).
 */
export function planApply(draft, rawFiche, mode, ctx = {}) {
  const have = workCards(draft).length
  const m = have === 0 ? 'replace' : mode === 'append' ? 'append' : 'replace'
  const r = applyCampaign(draft, rawFiche, { mode: m, bots: ctx.bots ?? [], boards: ctx.boards ?? [] })
  const added = r.ok ? workCards(r.draft).length - (m === 'append' ? have : 0) : (readCampaignFiche(rawFiche)?.cards.length ?? 0)
  return { ok: r.ok, mode: m, result: r, errors: r.errors, removed: m === 'replace' ? have : 0, added }
}

/** The marks of a draft the proposal was added to: the old ones (still on cards that exist) and the new ones. */
export function mergeMarks(old, fresh, draft) {
  const base = pruneMarks(old ?? emptyMarks(), draft)
  return { phases: { ...base.phases, ...fresh.phases }, cards: { ...base.cards, ...fresh.cards } }
}

/** The cards of the draft that still hold something the model wrote, not yet read or edited: `Set` of ids. */
export function reviewIds(marks, draft) {
  return new Set(workCards(draft).filter(c => markedFields(marks, c).length).map(c => c.id))
}
export const reviewCount = (marks, draft) => reviewIds(marks, draft).size

/** Are two sets of marks the same (nothing to store again)? */
export const sameMarks = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// the marks live as long as the draft does: the memory of the tab (same lifetime as `keepSession` of src/core/campaign.js)
let keptMarks = null
export const keepMarks = marks => { keptMarks = marks }
export const recallMarks = () => keptMarks ?? emptyMarks()
export const clearMarks = () => { keptMarks = null }

/* ---------- cardbody: the text the user read is the text that goes in ---------- */

/**
 * The instructions of card `id` replaced by `text` (what « After » says now). Unchanged from what the model wrote: `applyCardbody` (it keeps the mark
 * « to review »). Edited by the user: it is the user's own text, held to the rule of a hand-typed instruction (printable, 1 to 8 000), no mark.
 * -> `{ ok, draft, marks, refused, before, after }` (`refused`: a code of `BODY_ERRORS`).
 */
export function applyBodyText(draft, id, text, original, marks = null) {
  const card = draft.cards.find(c => c.id === id && !isGuard(c))
  if (!card) return { ok: false, draft, marks, refused: 'card_gone', before: '', after: '' }
  const after = String(text ?? '')
  if (after === original) {
    const r = applyCardbody(draft, id, { body: after }, marks)
    return r.ok ? r : { ...r, refused: r.refused === 'invalid' ? 'invalid' : r.refused }
  }
  if (!after.trim()) return { ok: false, draft, marks, refused: 'blank', before: card.body, after: card.body }
  if (after.length > MAX_BODY) return { ok: false, draft, marks, refused: 'long', before: card.body, after: card.body }
  if (!printable(after, true)) return { ok: false, draft, marks, refused: 'chars', before: card.body, after: card.body }
  // no mark to write: the body is the user's own now, and a mark holds only while the field still has the model's value (`markedFields`)
  return { ok: true, draft: patchCard(draft, id, { body: after }), marks: marks ?? emptyMarks(), refused: null, before: card.body, after }
}
/** Can « Apply to <card> » go: not blank, within the limit, printable, and not the text the card already has. */
export function bodyApplicable(draft, id, text) {
  const card = draft.cards.find(c => c.id === id && !isGuard(c))
  const t = String(text ?? '')
  return Boolean(card) && t.trim() !== '' && t.length <= MAX_BODY && printable(t, true) && t !== card.body
}

/* ---------- lint: remarks that belong to ONE state of the draft ---------- */

/**
 * What the review reads of the draft, as one string: the phases (names), and for each work card its phase, title, bot, pinned model, parents and
 * instructions. The rule: the remarks of a review hold only for the draft they were made on. As soon as ANY of those changes (a word of an
 * instruction, a bot, a dependency, a card added or removed, a phase renamed) the signature changes and the remarks are cleared; what the review
 * does not read (the selected card, the project, the objective, the order of the page) never clears them.
 */
export function lintSignature(draft) {
  return JSON.stringify([
    draft.phases.map(p => p.name),
    workCards(draft).map(c => [c.id, c.phase, c.title, c.who, c.model, c.provider, [...c.parents].sort(), c.body])
  ])
}

/**
 * A review kept with its draft: `{ sig, findings, dropped, truncated, model, seconds, costUsd, at }` from `lintView` (sorted by gravity), or null when the
 * fiche was refused whole (`view.ok` false: the caller says `invalid_output`).
 */
export function keepLint(draft, rawFiche, extra = {}) {
  const view = lintView(rawFiche, draft)
  if (!view.ok) return null
  const n = v => (Number.isInteger(v) && v >= 0 ? v : 0)
  return {
    sig: lintSignature(draft), findings: view.findings, dropped: view.dropped + n(extra.dropped), truncated: n(extra.truncated),
    model: typeof extra.model === 'string' ? extra.model : '', seconds: Number.isFinite(extra.seconds) ? extra.seconds : null,
    costUsd: Number.isFinite(extra.costUsd) ? extra.costUsd : null, costStatus: extra.costStatus ?? null
  }
}

/**
 * The remarks to show for the draft as it is NOW: `{ findings, dropped, truncated, ... }`, or null when there is none kept or the draft changed since
 * (`cleared` tells the page to forget them). A remark about a card that is no longer in the draft is set aside, not shown (`set_aside` counts them).
 * Each remark carries the card's code (`A1`, `B3`) as the graph shows it.
 */
export function lintShown(kept, draft) {
  if (!kept) return { view: null, cleared: false }
  if (kept.sig !== lintSignature(draft)) return { view: null, cleared: true }
  const code = codes(draft)
  const live = new Set(workCards(draft).map(c => c.id))
  // the model was sent the draft's own ids as `ref` (`k5`): in its sentence, a whole word that is a card of this draft reads as the code the graph shows
  const say = text => text.replace(/[A-Za-z0-9_-]+/g, w => (live.has(w) && code[w] ? code[w] : w))
  const findings = kept.findings.filter(f => live.has(f.ref)).map(f => ({ ...f, text: say(f.text), code: code[f.ref] ?? '' }))
  return { view: { ...kept, findings, set_aside: kept.findings.length - findings.length }, cleared: false }
}

/** The prices of the models a draft may pin, from the list `model.options` gave (`{ <model>: { input, output, free } }`): what `lintBody` reads. */
export function pricesOf(providers) {
  const out = dict()
  for (const p of Array.isArray(providers) ? providers : []) {
    for (const m of Array.isArray(p?.models) ? p.models : []) if (m?.id && m.price && !Object.hasOwn(out, m.id)) out[m.id] = m.price
  }
  return out
}
