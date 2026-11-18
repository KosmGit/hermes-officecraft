/**
 * The page's side of the two assisted functions of the office, as pure data. No SDK, no DOM, no clock.
 *   - recruitment: the marks « written by the model, to review » (one per field, lifted by an edit or a click, never blocking), the refusals
 *     said in plain words (a closed list of codes: each one is translated), the SOUL choice of a copy, the draft kept for a closed window;
 *   - revision: when the button is offered, before / after, whether « Apply » can go.
 * The fusion itself is `mergeRecruit` / `mergeRevise` (src/core/llmDraft.js); the orders are `profiles.create` / `profiles.configure`
 * (src/core/recruit.js, src/core/orders.js): nothing here sends anything.
 */
import { DESCRIPTION_MAX } from './recruit.js'
import { REASONS, workReady } from './llm.js'

/** The fields of the recruitment form that wear the mark; `start` covers the source and the skills kept (`from`, `off`). */
export const MARK_FIELDS = Object.freeze(['name', 'title', 'description', 'role', 'start', 'soul'])
const MARK_OF = { name: 'name', title: 'title', description: 'description', role: 'role', start: 'start', from: 'start', off: 'start', soul: 'soul', soulKeep: 'soul' }

/** The marks a merged draft starts with: the fields the model wrote (`filled` of `mergeRecruit`). */
export const marksOf = filled => new Set((filled ?? []).map(f => MARK_OF[f]).filter(Boolean))

/** The marks left once the user changed these fields of the draft (`patch` = the keys the form just set): an edit lifts the mark of its field. */
export function liftMarks(marks, patch) {
  const next = new Set(marks)
  for (const k of Object.keys(patch ?? {})) next.delete(MARK_OF[k])
  return next.size === marks.size ? marks : next
}

/** A click on the mark itself: « read ». */
export function readMark(marks, field) {
  if (!marks.has(field)) return marks
  const next = new Set(marks)
  next.delete(field)
  return next
}

/** How many fields still wear the mark (the counter at the foot of the window: it never stops « Recruit »). */
export const unreadCount = marks => marks.size

/* ---------- refusals, in plain words ---------- */

/** What the page itself can refuse once the agent half answered `done` (`mergeRecruit` / `reviseFicheErrors` codes, plus `hireErrors`'s). */
export const MERGE_ERRORS = Object.freeze([
  'shape', 'title_long', 'title_invalid', 'description_long', 'description_invalid', 'role_unknown', 'start_unknown', 'from_missing', 'skills_foreign',
  'fresh_with_source', 'soul_invalid', 'overlap_unknown', 'changes_invalid', 'name_empty', 'name_format', 'name_reserved', 'name_taken', 'model_pair'
])
/** Every code a refusal can carry, each translated under `llm.ref.<code>` in the three languages (tests/js/llm-settings.test.mjs). `expired` = a kept draft that is gone. */
export const REFUSAL_CODES = Object.freeze([...REASONS, ...MERGE_ERRORS, 'expired'])

/** Reasons where nothing was called (so nothing was counted): the answer is a refusal of the guards, not a failed call. */
const NOT_CALLED = new Set(['disabled', 'unavailable', 'cap_reached', 'too_soon', 'unchanged', 'nothing_to_send', 'not_allowed', 'busy', 'unreachable', 'expired'])

/**
 * One refusal as the window says it: `{ code, calls, action }`. `calls` = the calls that were paid for nothing (0 when a guard refused before
 * any call; 2 when the agent half relaunched on a length), `action` = what the one button does: `ask` (ask again) or `settings` (the cap is
 * reached: the way to raise it). `cap` = which cap, for the sentence.
 * Input: the answer of the call (`readDraftAnswer`), or `{ errors }` for a draft the page refused after an answer `done`.
 */
export function refusalOf({ answer = null, errors = null } = {}) {
  if (errors?.length) return { code: errors[0], calls: answer?.retried ? 2 : 1, action: 'ask', cap: null, all: [...errors] }
  const code = REFUSAL_CODES.includes(answer?.reason) ? answer.reason : 'model_error'
  const paid = !NOT_CALLED.has(code)
  return { code, calls: paid ? (answer?.retried ? 2 : 1) : 0, action: code === 'cap_reached' ? 'settings' : 'ask', cap: answer?.cap ?? null, all: [code] }
}

/* ---------- recruitment: the SOUL of a copy ---------- */

/**
 * A draft from the model carries a SOUL written for the new bot. For a NEW bot it replaces the identity sheet
 * `composeSoul` writes; for a COPY it is taken by default too (the copy would otherwise keep the SOUL of its source, which describes
 * another job), with a visible choice « keep the one of <source> » that sends no `soul` at all. `keep` = that choice.
 * Without a draft from the model nothing changes: no `soul` for a copy, the identity sheet for the others.
 */
export const soulChoice = draft => (draft?.start === 'clone' && typeof draft.soul === 'string' && draft.soul.trim() ? (draft.soulKeep ? 'keep' : 'new') : null)

/* ---------- the draft kept by the agent half for a closed window ---------- */

/**
 * The draft of a function that is kept for a window that was closed, as `GET /llm` says it (`pending`, `at` in epoch seconds), or null.
 * `atMs` = when it was asked, the epoch ms `t.ago` takes for « 3 min ago » (never the age itself, which `t.ago` would read as a date: « 57 years ago »).
 */
export function pendingOffer(state, feature, nowMs = 0) {
  const p = state?.pending?.[feature]
  if (!p || typeof p.id !== 'string') return null
  return { id: p.id, at: p.at, target: p.target, atMs: p.at > 0 ? p.at * 1000 : null, ageMs: p.at > 0 && nowMs > 0 ? Math.max(0, nowMs - p.at * 1000) : null }
}

/** Seconds waited, as « 7 s » / « 1 min 12 s » (units that read the same in the three languages). */
export function formatWait(seconds) {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}

/* ---------- revision of one bot's description ---------- */

/**
 * Is « Revise the description » offered for this agent: the function is on and served, and there is something to rewrite (the main bot
 * with an empty description is not revised: the agent half answers `nothing_to_send`).
 */
export const canRevise = (state, agent) => workReady(state, 'revise') && Boolean(agent?.name) && !(agent.isDefault && !String(agent.description ?? '').trim())

/** A bot's description as a screen shows it: `—` when empty, `…` at the end when the office kept only its first DESCRIPTION_MAX characters. */
export const shownDescription = (text, cut = false) => (String(text ?? '').trim() ? `${String(text).trim()}${cut ? '…' : ''}` : '—')

/** The text typed in « After »: can it be applied: not blank, not longer than a description, not the one the bot already has. */
export function reviseApplicable(before, after) {
  const a = String(after ?? '').trim()
  return a.length > 0 && a.length <= DESCRIPTION_MAX && a !== String(before ?? '').trim()
}
