/**
 * The campaign editor's logic, as pure data. No SDK, no DOM, no clock of its own, no network.
 * The agent half (hermes_officecraft/campaign.py) serves `POST /campaign` and the verbs `launch` and `cancel_campaign`.
 *
 * Nothing here composes, splits or assigns a card by a model. The time saved comes from CHAIN TEMPLATES written in code
 * (`TEMPLATES`) and from duplicating a card. Bots are always chosen from the real roster the caller passes in (no name in code).
 *
 * The draft lives in the memory of the tab (`keepDraft` / `recallDraft`), never in ctx.storage and never anywhere but in the one
 * `POST /campaign` (card titles and instructions are Hermes text, not ours to keep).
 *
 * The rules of `validateRequest` are the agent half's (hermes_officecraft/campaign.py `CampaignIn` + `plan_graph`) ported line by line:
 * the page never sends what the agent would refuse, and says why before sending. The agent stays the only authority (the page's list
 * of boards, for instance, cannot see an archived one).
 */
import { dict } from './dict.js'

/* ---------- bounds (the agent's: campaign.py MAX_* / MIN_RUNTIME / MAX_RUNTIME) ---------- */

export const MAX_WORK_CARDS = 40
export const MAX_CARDS = 48
export const MAX_PHASES = 8
export const MAX_TITLE = 120
export const MAX_GOAL = 120
export const MAX_NAME = 60
export const MAX_BODY = 8000
export const MIN_RUNTIME = 900
export const MAX_RUNTIME = 86_400
export const SLUG_MAX = 64
/** The slug rule of Hermes (`hermes_cli/kanban_db.py:374`), applied WITHOUT any normalisation (the agent refuses « UPPER », it does not lower it). */
export const SLUG_RE = /^[a-z0-9][a-z0-9\-_]{0,63}$/
export const REF_RE = /^[A-Za-z0-9_-]{1,16}$/
const GUARD_REF_RE = /^G[0-9]+$/
/** The head guard's ref; a phase guard's is `G<phase>` (the agent's key is `oc-camp:<id>:G<phase>`). */
export const HEAD = 'G0'
export const guardRef = phase => `G${phase}`
export const letter = i => String.fromCharCode(65 + i)

/** More than this many cards in the preview folds parallel ones into a pile (src/core/campaignLayout.js). */
export const FOLD_FROM = 24

/**
 * Printable by the agent's rule: no control, format, surrogate, private-use or unassigned character, no line or paragraph separator.
 * ZWNJ (U+200C) and ZWJ (U+200D) are the only format characters allowed, and only as a joiner: between two
 * letters (a letter, or a letter followed by its marks: Persian, Kurdish, Hindi) or, ZWJ only, inside an emoji sequence (a pictogram,
 * its variation selector / skin tone, then the next pictogram). At the start, at the end, doubled, alone, or next to a space or a
 * punctuation mark they stay refused. The same rule, code point for code point, is `_printable` in hermes_officecraft/campaign.py.
 */
const UNPRINTABLE = /[\p{C}\p{Zl}\p{Zp}]/u
const PICTO = [[0xA9, 0xA9], [0xAE, 0xAE], [0x203C, 0x203C], [0x2049, 0x2049], [0x2122, 0x2122], [0x2139, 0x2139], [0x2194, 0x21AA],
  [0x231A, 0x23FF], [0x24C2, 0x24C2], [0x25AA, 0x25FE], [0x2600, 0x27BF], [0x2934, 0x2935], [0x2B05, 0x2B55], [0x3030, 0x3030],
  [0x303D, 0x303D], [0x3297, 0x3297], [0x3299, 0x3299], [0x1F000, 0x1F2FF], [0x1F300, 0x1FAFF]]
const isPicto = c => c != null && PICTO.some(([a, b]) => c >= a && c <= b)
const isLetter = c => c != null && /^\p{L}$/u.test(String.fromCodePoint(c))
const isMark = c => c != null && /^\p{M}$/u.test(String.fromCodePoint(c))
const isEmojiTail = c => c === 0xFE0F || (c >= 0x1F3FB && c <= 0x1F3FF)
/** Is the joiner at index i of the code point list between two letters, or (ZWJ) two pictograms? */
function joinerOk(cps, i) {
  const after = cps[i + 1]
  let j = i - 1
  while (j >= 0 && isMark(cps[j])) j--          // letter + marks (virama, diacritics)
  if (j >= 0 && isLetter(cps[j]) && isLetter(after)) return true
  if (cps[i] !== 0x200D) return false
  j = i - 1
  while (j >= 0 && isEmojiTail(cps[j])) j--     // pictogram + variation selector / skin tone
  return j >= 0 && isPicto(cps[j]) && isPicto(after)
}
export const printable = (text, multiline = false) => {
  const s = String(text ?? '')
  if (!UNPRINTABLE.test(multiline ? s.replace(/[\n\r\t]/g, '') : s)) return true
  const cps = Array.from(s, ch => ch.codePointAt(0))
  for (let i = 0; i < cps.length; i++) {
    if (multiline && (cps[i] === 10 || cps[i] === 13 || cps[i] === 9)) continue   // a line break is not a letter: it never joins
    if ((cps[i] === 0x200C || cps[i] === 0x200D) && joinerOk(cps, i)) continue
    if (UNPRINTABLE.test(String.fromCodePoint(cps[i]))) return false
  }
  return true
}

/* ---------- the new project (« Nouveau projet… ») ---------- */

/** A name -> an identifier proposal: no accent, lower case, runs of anything else become one « - », at most 64. The user may then edit it. */
export const slugify = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX).replace(/-+$/g, '')

/**
 * What the identifier field says, from the rule of Hermes and the boards the page already reads (`/live`): 'empty', 'bad', 'taken' or 'free'.
 * `taken` is a check the page can do; the agent redoes it against ALL boards, archived ones included (`board_exists`, the only authority).
 */
export function slugState(slug, existing = []) {
  const s = String(slug ?? '')
  if (!s) return { ok: false, code: 'empty' }
  if (!SLUG_RE.test(s)) return { ok: false, code: 'bad' }
  const taken = existing instanceof Set ? existing.has(s) : (existing || []).includes(s)
  return taken ? { ok: false, code: 'taken' } : { ok: true, code: 'free' }
}

/* ---------- the draft ---------- */

/**
 * draft = { goal, boardMode: 'existing' | 'new', board, nb: { name, slug, typed }, phases: [{ name }], cards: [card], sel, seq }
 * card  = { id, kind: 'card' | 'guard', phase, title, who, model, provider, body, parents: [id], workspace, maxRuntime }
 * A guard card only says its phase (the head guard is `G0`, always there, no parent; a phase guard `G<k>`: its parents are COMPUTED, see `effective`).
 * `parents` of a card = what the user chose (cards only: the guards are put in by `effective`, so a card can never start by itself).
 */
export function newDraft({ phaseName = 'A', board = '' } = {}) {
  return { goal: '', boardMode: 'existing', board, nb: { name: '', slug: '', typed: false }, phases: [{ name: phaseName }], cards: [{ id: HEAD, kind: 'guard', phase: 0, parents: [] }], sel: null, seq: 0 }
}

export const isGuard = c => c?.kind === 'guard'
export const workCards = draft => draft.cards.filter(c => !isGuard(c))
export const cardById = (draft, id) => draft.cards.find(c => c.id === id) || null
const nextId = draft => { const seq = draft.seq + 1; return [`k${seq}`, seq] }

const blank = (id, phase, who) => ({ id, kind: 'card', phase, title: '', who: who || '', model: '', provider: '', body: '', parents: [], workspace: 'scratch', maxRuntime: 0 })

/** Every card (explicit parents only) below `id`. */
export function descendants(draft, id) {
  const out = new Set()
  const stack = [id]
  while (stack.length) {
    const n = stack.pop()
    for (const c of draft.cards) if (c.parents.includes(n) && !out.has(c.id)) { out.add(c.id); stack.push(c.id) }
  }
  return out
}
export const wouldCycle = (draft, parent, child) => parent === child || descendants(draft, child).has(parent)

/** The cards `id` may wait for: work cards of its phase or an earlier one, none of them below it (a loop is refused at the input). */
export function eligibleParents(draft, id) {
  const c = cardById(draft, id)
  if (!c || isGuard(c)) return []
  const below = descendants(draft, id)
  return workCards(draft).filter(x => x.id !== id && x.phase <= c.phase && !below.has(x.id))
}

/** Add a card at the end of a phase (the bot is the caller's choice, from the roster). */
export function addCard(draft, phase, who = '') {
  const [id, seq] = nextId(draft)
  const card = blank(id, Math.min(Math.max(0, phase), draft.phases.length - 1), who)
  const at = draft.cards.reduce((n, c, i) => (c.phase <= card.phase ? i + 1 : n), 0)
  const cards = [...draft.cards.slice(0, at), card, ...draft.cards.slice(at)]
  return { ...draft, cards, seq, sel: id }
}

/** Remove a card (a guard of a phase too; never the head guard); whoever waited for it stops waiting for it. */
export function removeCard(draft, id) {
  if (id === HEAD) return draft
  const cards = draft.cards.filter(c => c.id !== id).map(c => (c.parents.includes(id) ? { ...c, parents: c.parents.filter(p => p !== id) } : c))
  return { ...draft, cards, sel: draft.sel === id ? null : draft.sel }
}

/** A copy of a card, right after it, with the same bot, model, instructions and the same parents. */
export function duplicateCard(draft, id) {
  const src = cardById(draft, id)
  if (!src || isGuard(src)) return draft
  const [nid, seq] = nextId(draft)
  const at = draft.cards.findIndex(c => c.id === id) + 1
  const copy = { ...src, id: nid, parents: [...src.parents] }
  return { ...draft, cards: [...draft.cards.slice(0, at), copy, ...draft.cards.slice(at)], seq, sel: nid }
}

export function patchCard(draft, id, patch) {
  return { ...draft, cards: draft.cards.map(c => (c.id === id ? { ...c, ...patch } : c)) }
}

/** Toggle « `id` waits for `parent` ». A loop, or a parent that is not eligible, is refused: `{ draft, refused: 'cycle' | 'not_eligible' }`. */
export function toggleParent(draft, id, parent) {
  const c = cardById(draft, id)
  if (!c) return { draft, refused: 'not_eligible' }
  if (c.parents.includes(parent)) return { draft: patchCard(draft, id, { parents: c.parents.filter(p => p !== parent) }), refused: null }
  if (wouldCycle(draft, parent, id)) return { draft, refused: 'cycle' }
  if (!eligibleParents(draft, id).some(x => x.id === parent)) return { draft, refused: 'not_eligible' }
  return { draft: patchCard(draft, id, { parents: [...c.parents, parent] }), refused: null }
}

/** A new phase after the last one, with its guard (the guard is optional: remove it with `removeCard`). `false` when 8 phases already exist. */
export function addPhase(draft, name, withGuard = true) {
  if (draft.phases.length >= MAX_PHASES) return draft
  const phase = draft.phases.length
  const cards = withGuard ? [...draft.cards, { id: guardRef(phase), kind: 'guard', phase, parents: [] }] : draft.cards
  return { ...draft, phases: [...draft.phases, { name }], cards }
}

/** Put the guard back on a phase that lost it. */
export function addGuard(draft, phase) {
  if (phase < 1 || phase >= draft.phases.length || draft.cards.some(c => isGuard(c) && c.phase === phase)) return draft
  const at = draft.cards.reduce((n, c, i) => (c.phase < phase ? i + 1 : n), 0)
  return { ...draft, cards: [...draft.cards.slice(0, at), { id: guardRef(phase), kind: 'guard', phase, parents: [] }, ...draft.cards.slice(at)] }
}

/** The last phase goes away (its cards with it, the guard too). The first phase stays. */
export function removeLastPhase(draft) {
  const last = draft.phases.length - 1
  if (last < 1) return draft
  const gone = new Set(draft.cards.filter(c => c.phase === last).map(c => c.id))
  const cards = draft.cards.filter(c => !gone.has(c.id)).map(c => ({ ...c, parents: c.parents.filter(p => !gone.has(p)) }))
  return { ...draft, phases: draft.phases.slice(0, last), cards, sel: gone.has(draft.sel) ? null : draft.sel }
}

export const renamePhase = (draft, k, name) => ({ ...draft, phases: draft.phases.map((p, i) => (i === k ? { name } : p)) })

/** `A1`, `A2`… per phase (Hermes gives the real id at creation); a guard is `G0`, `G1`… */
export function codes(draft) {
  const n = {}
  const out = {}
  for (const c of draft.cards) {
    if (isGuard(c)) { out[c.id] = guardRef(c.phase); continue }
    n[c.phase] = (n[c.phase] || 0) + 1
    out[c.id] = `${letter(c.phase)}${n[c.phase]}`
  }
  return out
}

/* ---------- the graph the request will carry (guards put in) ---------- */

/**
 * The graph as it will be written: { phases, cards: [{ id, kind, phase, parents, ...fields }], loop }.
 *  - a phase guard stays only when the phase before it has a work card (an empty phase's guard would wait for nothing and be launched
 *    first: the agent refuses it `unguarded`, the page does not send it);
 *  - a phase guard waits for the LAST cards of the phase before it (the cards no other card of that phase waits for: plan_graph);
 *  - a work card starts under the head guard and under the guard of its phase when it has one: when none of its ancestors is that guard,
 *    the guard is added to its parents (so « Everything starts from a guard » holds whatever the user draws).
 * `loop` = a cycle among the explicit parents (the editor refuses to draw one; a draft that has one anyway is not sent).
 */
export function effective(draft) {
  const ids = new Set(draft.cards.map(c => c.id))
  const byId = new Map(draft.cards.map(c => [c.id, c]))
  const work = workCards(draft)
  const hasWork = new Set(work.map(c => c.phase))
  const kept = draft.cards.filter(c => !isGuard(c) || c.phase === 0 || hasWork.has(c.phase - 1))
  const parents = new Map()
  for (const c of kept) {
    if (isGuard(c)) continue
    parents.set(c.id, c.parents.filter(p => ids.has(p) && p !== c.id && byId.get(p).phase <= c.phase && !isGuard(byId.get(p))))
  }
  // phase guards: the last cards of the phase before
  for (const g of kept) {
    if (!isGuard(g)) continue
    if (g.phase === 0) { parents.set(g.id, []); continue }
    const before = work.filter(c => c.phase === g.phase - 1)
    const inside = new Set(before.flatMap(c => parents.get(c.id) || []))
    parents.set(g.id, before.filter(c => !inside.has(c.id)).map(c => c.id))
  }
  const guardOf = new Map(kept.filter(isGuard).map(g => [g.phase, g.id]))
  // ancestors in topological order (a loop leaves the rest unvisited)
  const anc = new Map()
  const state = new Map()
  let loop = false
  const visit = id => {
    if (anc.has(id)) return anc.get(id)
    if (state.get(id) === 1) { loop = true; return new Set() }
    state.set(id, 1)
    const c = byId.get(id)
    if (!isGuard(c)) {
      // the guard of its phase first: its own ancestors usually bring the head guard along
      const need = [guardOf.get(c.phase), HEAD].filter(Boolean)
      // the parents first: their ancestors say which guard is still missing
      for (const p of parents.get(id)) visit(p)
      const have = new Set()
      for (const p of parents.get(id)) { have.add(p); for (const a of anc.get(p) || []) have.add(a) }
      for (const g of need) if (!have.has(g) && !parents.get(id).includes(g)) { parents.get(id).push(g); have.add(g); for (const a of visit(g)) have.add(a) }
      anc.set(id, have)
    } else {
      const have = new Set()
      for (const p of parents.get(id)) { have.add(p); for (const a of visit(p)) have.add(a) }
      anc.set(id, have)
    }
    state.set(id, 2)
    return anc.get(id)
  }
  for (const c of kept) visit(c.id)
  const cards = kept.map(c => ({ ...c, parents: parents.get(c.id) || [] }))
  return { phases: draft.phases, cards, loop }
}

/* ---------- the request (POST /campaign) ---------- */

/** The body of `POST /campaign`, closed fields only. `id` = the UUID of the order (the replay key). */
export function toRequest(draft, id) {
  const g = effective(draft)
  const req = { id, goal: String(draft.goal).trim(), phases: g.phases.map(p => ({ name: String(p.name).trim() })), cards: [] }
  if (draft.boardMode === 'new') req.newBoard = { slug: String(draft.nb.slug), name: String(draft.nb.name).trim() }
  else req.board = String(draft.board)
  for (const c of g.cards) {
    if (isGuard(c)) { req.cards.push({ ref: c.id, kind: 'guard', phase: c.phase, parents: [...c.parents] }); continue }
    const o = { ref: c.id, kind: 'card', phase: c.phase, title: String(c.title).trim(), assignee: c.who, parents: [...c.parents] }
    if (c.model && c.provider) { o.model = c.model; o.provider = c.provider }
    if (String(c.body).trim()) o.body = String(c.body)
    if (c.workspace === 'dir') o.workspace = 'dir'
    if (c.maxRuntime) o.maxRuntime = Number(c.maxRuntime)
    req.cards.push(o)
  }
  return req
}

/**
 * The agent's checks on a request, ported: shape (what is a 422 there) then graph (what is a 200 `refused` there). Returns the first
 * reason code, or null. Codes: `invalid` (shape), then `too_many_cards`, `no_head_guard`, `bad_guard`, `bad_parent`, `cycle`, `unguarded`.
 */
export function validateRequest(req) {
  const cards = Array.isArray(req?.cards) ? req.cards : []
  const phases = Array.isArray(req?.phases) ? req.phases : []
  const str = (v, min, max, multiline = false) => typeof v === 'string' && v.trim().length >= min && v.length <= max && printable(v, multiline)
  if (!str(req?.goal, 1, MAX_GOAL)) return 'invalid'
  if (phases.length < 1 || phases.length > MAX_PHASES || !phases.every(p => str(p?.name, 1, MAX_NAME))) return 'invalid'
  if (cards.length < 1 || cards.length > MAX_CARDS) return 'invalid'
  if (Boolean(req.board) === Boolean(req.newBoard)) return 'invalid'
  if (req.newBoard && !(typeof req.newBoard.slug === 'string' && req.newBoard.slug.length >= 1 && req.newBoard.slug.length <= 128 && str(req.newBoard.name, 1, MAX_NAME))) return 'invalid'
  const refs = cards.map(c => c?.ref)
  if (new Set(refs).size !== refs.length) return 'invalid'
  for (const c of cards) {
    if (typeof c?.ref !== 'string' || !REF_RE.test(c.ref) || !['card', 'guard'].includes(c.kind)) return 'invalid'
    if (!Number.isInteger(c.phase) || c.phase < 0 || c.phase >= MAX_PHASES || c.phase >= phases.length) return 'invalid'
    const ps = c.parents ?? []
    if (!Array.isArray(ps) || ps.length > MAX_CARDS || new Set(ps).size !== ps.length || !ps.every(p => typeof p === 'string' && REF_RE.test(p))) return 'invalid'
    if ((c.model == null) !== (c.provider == null)) return 'invalid'
    for (const v of [c.model, c.provider]) if (v != null && !(typeof v === 'string' && /^\S{1,200}$/.test(v))) return 'invalid'
    if (c.body != null && !(typeof c.body === 'string' && c.body.length <= MAX_BODY && printable(c.body, true))) return 'invalid'
    if (c.workspace != null && !['scratch', 'dir'].includes(c.workspace)) return 'invalid'
    if (c.maxRuntime != null && !(Number.isInteger(c.maxRuntime) && c.maxRuntime >= MIN_RUNTIME && c.maxRuntime <= MAX_RUNTIME)) return 'invalid'
    if (c.kind === 'guard') {
      if ([c.title, c.assignee, c.model, c.provider, c.body, c.workspace, c.maxRuntime].some(v => v != null)) return 'invalid'
    } else if (!str(c.title, 1, MAX_TITLE) || typeof c.assignee !== 'string' || !/^[a-z0-9][a-z0-9\-_]{0,63}$/.test(c.assignee) || GUARD_REF_RE.test(c.ref)) return 'invalid'
  }
  const byRef = new Map(cards.map(c => [c.ref, c]))
  const work = cards.filter(c => c.kind === 'card')
  const guards = cards.filter(c => c.kind === 'guard')
  if (work.length > MAX_WORK_CARDS) return 'too_many_cards'
  const heads = guards.filter(g => g.phase === 0)
  if (heads.length !== 1 || (heads[0].parents ?? []).length) return 'no_head_guard'
  if (new Set(guards.map(g => g.phase)).size !== guards.length) return 'bad_guard'
  for (const c of cards) for (const p of c.parents ?? []) if (!byRef.has(p) || byRef.get(p).phase > c.phase) return 'bad_parent'
  // Kahn, stable on the order given
  const waiting = new Map(cards.map(c => [c.ref, new Set(c.parents ?? [])]))
  const order = []
  const left = cards.map(c => c.ref)
  while (left.length) {
    const i = left.findIndex(r => !waiting.get(r).size)
    if (i < 0) return 'cycle'
    const [r] = left.splice(i, 1)
    order.push(byRef.get(r))
    for (const w of waiting.values()) w.delete(r)
  }
  for (const g of guards) {
    if (g.phase === 0) continue
    const before = work.filter(c => c.phase === g.phase - 1)
    const inside = new Set(before.flatMap(c => c.parents ?? []))
    const ends = new Set(before.filter(c => !inside.has(c.ref)).map(c => c.ref))
    const own = new Set(g.parents ?? [])
    if (ends.size !== own.size || [...ends].some(r => !own.has(r))) return 'bad_parent'
  }
  const anc = new Map()
  for (const c of order) {
    const found = new Set()
    for (const p of c.parents ?? []) { found.add(p); for (const a of anc.get(p)) found.add(a) }
    anc.set(c.ref, found)
  }
  const phaseGuard = new Map(guards.map(g => [g.phase, g.ref]))
  for (const c of work) {
    const a = anc.get(c.ref)
    if (!a.has(heads[0].ref) || !a.has(phaseGuard.get(c.phase) ?? heads[0].ref)) return 'unguarded'
  }
  return null
}

/* ---------- what the editor says before anything is sent ---------- */

/**
 * Blocking problems of a draft: [{ code, id?, phase? }], in reading order. `ctx` = { bots: [names of the roster], boards: [slugs of /live] }.
 * Codes: goal_empty, goal_chars, board_none, board_unknown, nb_name, slug_empty, slug_bad, slug_taken, no_cards, too_many, title_empty, title_chars,
 * who_unknown, body_long, body_chars, model_pair, phase_name, phase_chars, no_workdir, runtime, loop, graph:<code> (the agent's own rule, last resort).
 */
export function draftIssues(draft, ctx = {}) {
  const out = []
  const bots = new Set(ctx.bots || [])
  const boards = new Set(ctx.boards || [])
  if (!String(draft.goal).trim()) out.push({ code: 'goal_empty' })
  else if (!printable(draft.goal)) out.push({ code: 'goal_chars' })
  if (draft.boardMode === 'new') {
    if (!String(draft.nb.name).trim()) out.push({ code: 'nb_name' })
    else if (!printable(draft.nb.name)) out.push({ code: 'goal_chars' })
    const s = slugState(draft.nb.slug, boards)
    if (!s.ok) out.push({ code: `slug_${s.code}` })
  } else if (!draft.board) out.push({ code: 'board_none' })
  else if (boards.size && !boards.has(draft.board)) out.push({ code: 'board_unknown' })
  draft.phases.forEach((p, k) => {
    if (!String(p.name).trim()) out.push({ code: 'phase_name', phase: k })
    else if (!printable(p.name)) out.push({ code: 'phase_chars', phase: k })
  })
  const work = workCards(draft)
  if (!work.length) out.push({ code: 'no_cards' })
  if (work.length > MAX_WORK_CARDS) out.push({ code: 'too_many' })
  for (const c of work) {
    if (!String(c.title).trim()) out.push({ code: 'title_empty', id: c.id })
    else if (!printable(c.title)) out.push({ code: 'title_chars', id: c.id })
    if (!c.who || (bots.size && !bots.has(c.who))) out.push({ code: 'who_unknown', id: c.id })
    if (String(c.body).length > MAX_BODY) out.push({ code: 'body_long', id: c.id })
    else if (!printable(c.body, true)) out.push({ code: 'body_chars', id: c.id })
    if (Boolean(c.model) !== Boolean(c.provider)) out.push({ code: 'model_pair', id: c.id })
    if (c.workspace === 'dir' && draft.boardMode === 'new') out.push({ code: 'no_workdir', id: c.id })
    if (c.maxRuntime && (c.maxRuntime < MIN_RUNTIME || c.maxRuntime > MAX_RUNTIME)) out.push({ code: 'runtime', id: c.id })
  }
  if (effective(draft).loop) out.push({ code: 'loop' })
  if (!out.length) {
    const why = validateRequest(toRequest(draft, 'preview'))
    if (why) out.push({ code: `graph:${why}` })
  }
  return out
}

/** Soft notes (do not block): the work cards that carry no instructions. */
export const draftNotes = draft => workCards(draft).filter(c => !String(c.body).trim()).map(c => ({ code: 'no_body', id: c.id }))

/** The figures of the review (what will be written): { cards, work, guards, links, bots: [[name, n]], pins: [card], first: [card] }. */
export function summary(draft) {
  const g = effective(draft)
  const work = g.cards.filter(c => !isGuard(c))
  const guards = g.cards.filter(isGuard)
  const bots = dict()
  for (const c of work) bots[c.who] = (bots[c.who] || 0) + 1
  const links = g.cards.reduce((n, c) => n + c.parents.length, 0)
  const pins = work.filter(c => c.model && c.provider)
  const first = work.filter(c => c.parents.includes(HEAD))
  return { cards: g.cards.length, work: work.length, guards: guards.length, links, bots: Object.entries(bots).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')), pins, first }
}

/* ---------- chain templates (written in code) ---------- */

/** Defaults of each template's knobs: `n` = how many (steps, audits, phases, cards), `per` = cards per phase. */
export const TEMPLATES = Object.freeze([
  { id: 'devreview', n: { min: 1, max: 12, def: 3 }, bots: ['dev', 'review'] },
  { id: 'audit', n: { min: 2, max: 16, def: 4 }, bots: ['audit', 'synth'] },
  { id: 'phases', n: { min: 2, max: 8, def: 2 }, per: { min: 1, max: 6, def: 2 }, bots: ['work'] },
  { id: 'chain', n: { min: 1, max: 20, def: 4 }, bots: ['chain'] }
])
export const templateOf = id => TEMPLATES.find(t => t.id === id) || null

const clampN = (v, lim) => Math.max(lim.min, Math.min(lim.max, Math.round(Number(v)) || lim.def))
const EN = { step: n => `Step ${n}`, review: n => `Review of step ${n}`, audit: n => `Audit ${n}`, synth: () => 'Synthesis', card: n => `Card ${n}`, phase: k => `Phase ${k}`, phaseCard: (k, n) => `Phase ${k}, card ${n}` }

/**
 * The cards a template writes. `params` = { n, per, bots: { dev, review, audit, synth, work, chain } }: each is a bot name FROM THE ROSTER
 * (a list for `work` and `chain`, cycled). `L` = the page's wording of the titles (the pure default is English). Returns { phases, cards }:
 *   devreview  N steps: a work card, then its review, the next step after the review (a chain of 2N cards);
 *   audit      N parallel audits, then one synthesis card that waits for all of them (N + 1 cards);
 *   phases     N phases of `per` parallel cards, a guard before every phase after the first (you launch phase by phase);
 *   chain      N cards one after the other.
 * The first cards wait for the head guard. `phases` are what the draft gets in addition (appended after the existing ones).
 */
export function templateCards(id, params, L = EN) {
  const tpl = templateOf(id)
  if (!tpl) return { phases: [], cards: [] }
  const n = clampN(params?.n, tpl.n)
  const b = params?.bots || {}
  const list = x => (Array.isArray(x) ? x : [x]).filter(Boolean)
  const cycle = (x, i) => { const l = list(x); return l.length ? l[i % l.length] : '' }
  const cards = []
  let seq = 0
  const make = (phase, who, title, parents) => { seq += 1; const c = { ...blank(`t${seq}`, phase, who), title, parents }; cards.push(c); return c.id }
  if (id === 'devreview') {
    let prev = HEAD
    for (let i = 1; i <= n; i++) {
      const d = make(0, cycle(b.dev, 0), L.step(i), [prev])
      prev = make(0, cycle(b.review, 0), L.review(i), [d])
    }
    return { phases: [], cards }
  }
  if (id === 'audit') {
    const audits = []
    for (let i = 1; i <= n; i++) audits.push(make(0, cycle(b.audit, i - 1), L.audit(i), [HEAD]))
    make(0, cycle(b.synth, 0), L.synth(), audits)
    return { phases: [], cards }
  }
  if (id === 'phases') {
    const per = clampN(params?.per, tpl.per)
    const names = []
    let k = 0
    for (let p = 0; p < n; p++) {
      names.push(L.phase(letter(p)))
      for (let i = 1; i <= per; i++) { make(p, cycle(b.work, k), L.phaseCard(letter(p), i), p === 0 ? [HEAD] : []); k += 1 }
    }
    return { phases: names, cards }
  }
  let prev = HEAD
  for (let i = 1; i <= n; i++) prev = make(0, cycle(b.chain, i - 1), L.card(i), [prev])
  return { phases: [], cards }
}

/**
 * Apply a template to the draft. `mode`: 'append' (after what is there: the new cards wait for the head guard, i.e. they start with the
 * first ones; `phases` adds its phases after the existing ones, each with its guard) or 'replace' (the draft's cards and phases are
 * replaced; the goal, the project and the head guard stay). Refused (draft unchanged, `refused: 'too_many'`) past 40 work cards or 8 phases.
 */
export function applyTemplate(draft, id, params, mode = 'append', L = EN) {
  const made = templateCards(id, params, L)
  const base = mode === 'replace' ? { ...draft, phases: [draft.phases[0] || { name: L.phase('A') }], cards: [draft.cards.find(c => c.id === HEAD)], sel: null } : draft
  const extra = id === 'phases' ? made.phases : []
  let phases = [...base.phases]
  let cards = [...base.cards]
  let seq = base.seq
  const idMap = new Map([[HEAD, HEAD]])
  // `phases` template: phase 0 of the template = the draft's phase 0 on a replace, a new phase after the last one on an append
  const shift = id === 'phases' ? (mode === 'replace' ? 0 : phases.length) : 0
  if (id === 'phases') {
    if (mode === 'replace') phases = [{ name: extra[0] }, ...extra.slice(1).map(name => ({ name }))]
    else phases = [...phases, ...extra.map(name => ({ name }))]
    if (phases.length > MAX_PHASES) return { draft, refused: 'too_many' }
    for (let p = 1; p < extra.length; p++) cards.push({ id: guardRef(shift + p), kind: 'guard', phase: shift + p, parents: [] })
    if (mode !== 'replace') cards.push({ id: guardRef(shift), kind: 'guard', phase: shift, parents: [] })
  }
  const target = id === 'phases' ? null : phases.length - 1
  for (const c of made.cards) {
    seq += 1
    idMap.set(c.id, `k${seq}`)
  }
  for (const c of made.cards) {
    cards.push({ ...c, id: idMap.get(c.id), phase: target ?? shift + c.phase, parents: c.parents.map(p => idMap.get(p)).filter(Boolean) })
  }
  const next = { ...base, phases, cards, seq, sel: null }
  if (workCards(next).length > MAX_WORK_CARDS) return { draft, refused: 'too_many' }
  // the guards of a phase template sit in front of their phase's cards: keep the guards in phase order
  next.cards = [...next.cards].sort((a, b) => a.phase - b.phase || (isGuard(b) - isGuard(a)))
  return { draft: next, refused: null }
}

/**
 * What a template would make of the draft, for the line beside its button: { mode, made (cards it writes), work (cards the draft would then
 * hold), phases, guards }, or { refused } past the limits. On a draft with no card, `append` and `replace` are the same thing: it is read as `replace`.
 */
export function templatePreview(draft, id, params, mode = 'append', L = EN) {
  const m = workCards(draft).length ? mode : 'replace'
  const r = applyTemplate(draft, id, params, m, L)
  if (r.refused) return { refused: r.refused }
  const s = summary(r.draft)
  return { refused: null, mode: m, made: templateCards(id, params, L).cards.length, work: s.work, phases: r.draft.phases.length, guards: s.guards }
}

/**
 * What a draft lacks to be reviewed, in the words the window says them: ['goal', 'project' | 'projectName', 'card'] (the order of the form).
 * Only what is MISSING: a wrong value (a loop, a title with a control character) is an error, said when « Review » is pressed.
 */
export function missingParts(issues) {
  const has = (...codes) => issues.some(i => codes.includes(i.code))
  return [has('goal_empty') ? 'goal' : null, has('board_none') ? 'project' : has('nb_name') ? 'projectName' : null, has('no_cards') ? 'card' : null].filter(Boolean)
}

/* ---------- the answer of POST /campaign ---------- */

export const CAMPAIGN_RESULTS = Object.freeze(['done', 'refused', 'failed'])

/** `POST /campaign` answer -> what the page keeps (whitelist). null when it is not a well-formed business answer (then: `unknown_outcome`). */
export function readCampaign(body) {
  if (!body || typeof body !== 'object' || typeof body.result !== 'string') return null
  const int = v => (Number.isInteger(v) && v >= 0 ? v : null)
  const pick = list => (Array.isArray(list) ? list.filter(x => x && typeof x.ref === 'string' && typeof x.task === 'string').map(x => ({ ref: x.ref.slice(0, 16), task: x.task.slice(0, 64) })) : [])
  const after = body.after && typeof body.after === 'object' ? { blocked: int(body.after.blocked), todo: int(body.after.todo), ready: int(body.after.ready), running: int(body.after.running) } : null
  const guards = pick(body.guards)
  return {
    ok: body.result === 'done',
    result: CAMPAIGN_RESULTS.includes(body.result) ? body.result : 'failed',
    reason: body.result === 'done' ? null : (typeof body.reason === 'string' ? body.reason : null),
    before: null,
    after: null,
    comments: null,
    replayed: body.replayed === true,
    audited: body.audited !== false,
    atMs: Number.isFinite(body.at) ? Math.round(body.at * 1000) : null,
    detail: {
      board: typeof body.board === 'string' ? body.board.slice(0, 64) : null,
      created: int(body.created) ?? 0,
      links: int(body.links) ?? 0,
      archived: int(body.archived),
      boardCreated: body.boardCreated === true,
      boardArchived: body.boardArchived === true ? true : body.boardArchived === false ? false : null,
      guards,
      head: guards.find(g => g.ref === HEAD)?.task ?? null,
      cards: pick(body.cards),
      counts: after
    }
  }
}

/**
 * What a FAILED campaign says about the project it created on the way (« New project… »), read back by the agent half: archived with
 * the cards, or left behind (the archiving itself failed): the page must not say « nothing was modified » then. { key, board } or null
 * (existing project, success, other order, or no fact: nothing is claimed).
 */
export function campaignBoardNote(o) {
  if (!o || o.ok || o.cancelled || o.verb !== 'campaign' || !o.detail?.boardCreated) return null
  const board = o.detail.board ?? o.board
  if (o.detail.boardArchived === false) return { key: 'campaign.boardLeft', board }
  if (o.detail.boardArchived === true) return { key: 'campaign.boardArchived', board }
  return null
}

/**
 * The window's own state (what it shows; the order itself is the order machine's, src/core/orders.js, one at a time with every other order):
 *   { step, created } — `created` = what the campaign is once it exists: { board, boardCreated, head, size, links, counts, goal, name, starts: [..],
 *   launched: null | { ready }, cancelled: null | { archived } }.
 */
export const initialWindow = () => ({ step: 'compose', created: null })

export function windowReducer(state, action) {
  switch (action.type) {
    case 'review': return state.step === 'compose' ? { ...state, step: 'review' } : state
    case 'back': return state.step === 'review' ? { ...state, step: 'compose' } : state
    case 'created': return state.step === 'review' || state.step === 'compose' ? { step: 'created', created: action.created } : state
    case 'launched': return state.created && state.created.head === action.task && !state.created.cancelled ? { ...state, created: { ...state.created, launched: { ready: action.ready ?? null } } } : state
    case 'cancelled': return state.created && state.created.head === action.task && !state.created.launched ? { ...state, created: { ...state.created, cancelled: { archived: action.archived ?? null } } } : state
    case 'recompose': return { step: 'compose', created: null }
    case 'reset': return initialWindow()
    default: return state
  }
}

/** What a successful `campaign` outcome makes of the window: the facts read back, and the names the launch confirmation will say. */
export function createdOf(outcome, draft) {
  const d = outcome?.detail
  if (!outcome || outcome.verb !== 'campaign' || !outcome.ok || !d) return null
  const s = summary(draft)
  const code = codes(draft)
  return {
    board: d.board || outcome.board, boardCreated: d.boardCreated, head: d.head, size: d.created, links: d.links, counts: d.counts, goal: String(draft.goal).trim(),
    name: draft.boardMode === 'new' ? String(draft.nb.name).trim() : outcome.board, starts: s.first.map(c => `${code[c.id]} · ${c.who}`), launched: null, cancelled: null
  }
}

/* ---------- the guard of a campaign, as a decision (the card of « Décisions ») ---------- */

/** The title the agent half writes on a guard card (`guard_titles` of hermes_officecraft/campaign.py): « Guard — <goal> » for the
 * start guard, « Guard phase B — <name> » for a phase guard. English for every user: the kanban is shared. */
export const guardTitle = (goal, phase = 0, name = '') => (phase > 0 ? `Guard phase ${letter(phase)} — ${name}` : `Guard — ${goal}`)

/** « Guard — <goal> » / « Guard phase B — <name> » -> the campaign's goal or phase name. The earlier French titles
 * (« Garde — … », « Garde phase B — … ») are read too: a campaign created before the titles became English keeps its name. */
export const guardName = title => String(title ?? '').replace(/^(?:Guard|Garde)(?: phase [A-H])?\s+[—–-]\s+/, '').trim() || String(title ?? '')

/** The order a guard's button names (the confirmation, the 6 s window, the outcome): the board, and the campaign by its name. */
export const guardTarget = (verb, item, id) => ({ id, verb, board: item.board, task: item.id, code: guardName(item.fullTitle ?? item.title), head: item.head === true, size: item.campaignSize ?? null })

/* ---------- the draft of the tab ---------- */

let kept = null
/**
 * The draft and the window's step stay in the memory of the tab (module state: gone with the tab, never in ctx.storage), so closing the
 * window, or leaving the page and coming back, loses nothing. Once the campaign is launched there is nothing left to keep (`clearSession`);
 * a created-but-not-launched campaign keeps its draft so « Recompose » can start from it after a cancel.
 */
export const keepSession = (draft, win) => { kept = { draft, win } }
export const recallSession = () => kept
export const clearSession = () => { kept = null }
/** Is the draft worth keeping? (a goal or at least one work card) */
export const draftIsEmpty = draft => !draft || (!String(draft.goal).trim() && !workCards(draft).length)
