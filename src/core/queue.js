/**
 * The queue: a bot whose card waits for the work of someone else. Pure: no SDK, no DOM, no clock of its own (callers pass `nowMs`).
 *
 * The fact it stands on (Hermes, `kanban_db.py` `recompute_ready`): a card is `todo` while one of its parents (`task_links`, parent -> child)
 * is neither `done` nor `archived`; the dispatcher promotes it to `ready` the moment they all are. So a `todo` card WITH an unfinished
 * parent waits for someone, and a `ready` card waits for nobody (only for its turn). A `todo` card without such a parent is something else
 * (just created, parents finished and not promoted yet, a triaged card): it is never called « waiting » here.
 *
 * Words:
 *   waiting card   a `todo` card with at least one unfinished parent (a parent that is `done` or `archived` holds nothing back)
 *   head           a card of the chain that waits for nothing any more: the work that really moves, or does not
 *   chain          the cards upstream of a waiting card, from its parents up to the heads, walked breadth first, bounded
 *
 * The links come from `/live` (`board.links`, ids only, already limited to the ones that still hold a card back); a link is read
 * inside its own board (Hermes keeps one `task_links` per board).
 */
import { cardSilentMs } from './cards.js'
import { oneLine } from './util.js'

const DONE = new Set(['done', 'archived'])

/** How far upstream the chain is followed, and how many cards a walk visits at most (a longer queue says « at least »). */
export const QUEUE_DEPTH_MAX = 12
export const QUEUE_CARDS_MAX = 200
/** Links read per board (the agent half serves at most as many). */
export const QUEUE_LINKS_MAX = 2000
/** Bots a line spells out before « +N ». */
export const QUEUE_NAMES_MAX = 3
/** Parents a card names before « +N ». */
export const QUEUE_PARENTS_MAX = 2

export const cardKey = (board, id) => `${board}/${id}`
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** `/live` links of a board -> [[parent, child]] of strings, at most QUEUE_LINKS_MAX; anything else is dropped. */
export function toLinks(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const l of raw) {
    if (!Array.isArray(l) || typeof l[0] !== 'string' || typeof l[1] !== 'string' || !l[0] || !l[1] || l[0] === l[1]) continue
    out.push([l[0], l[1]])
    if (out.length >= QUEUE_LINKS_MAX) break
  }
  return out
}

/**
 * The index of the waits of an office: `boards` = buildOffice().boards (cards + `links`).
 * -> { cards: Map key -> card, parents: Map key -> [card] (unfinished parents, by key), children: Map key -> [card] }
 * Only the cards that a link touches are kept. A link whose ends are not both served, or finished, holds nothing back and is dropped.
 */
export function waitIndex(boards) {
  const cards = new Map()
  const parents = new Map()
  const children = new Map()
  const add = (map, k, card) => {
    const list = map.get(k)
    if (!list) map.set(k, [card])
    else if (!list.some(c => c.key === card.key)) list.push(card)
  }
  for (const b of Array.isArray(boards) ? boards : []) {
    if (!Array.isArray(b?.links) || !b.links.length) continue
    const byId = new Map((b.tasks || []).map(t => [t.id, t]))
    const card = t => {
      const k = cardKey(b.slug, t.id)
      if (!cards.has(k)) cards.set(k, { key: k, board: b.slug, id: t.id, title: oneLine(t.title), status: t.status, assignee: t.assignee || null, createdMs: t.createdMs ?? null, startedMs: t.startedMs ?? null, heartbeatMs: t.heartbeatMs ?? null })
      return cards.get(k)
    }
    for (const [p, c] of b.links) {
      const P = byId.get(p)
      const C = byId.get(c)
      if (!P || !C || P === C || DONE.has(P.status) || DONE.has(C.status)) continue
      const pc = card(P)
      const cc = card(C)
      add(parents, cc.key, pc)
      add(children, pc.key, cc)
    }
  }
  const byKey = (a, b) => byText(a.key, b.key)
  for (const list of parents.values()) list.sort(byKey)
  for (const list of children.values()) list.sort(byKey)
  return { cards, parents, children }
}

/** Does this card wait for someone? (`todo` with an unfinished parent) */
export const isWaiting = (index, card) => card?.status === 'todo' && (index.parents.get(card.key)?.length ?? 0) > 0

const byOldest = (a, b) => (a.createdMs ?? Infinity) - (b.createdMs ?? Infinity) || byText(a.key, b.key)

/** The waiting cards of every bot: Map name -> [{ ...card, parents: [card] }], the oldest card first. A card with no assignee belongs to no bot. */
export function waitingByBot(index) {
  const out = new Map()
  for (const [k, ps] of index.parents) {
    const card = index.cards.get(k)
    if (!card || card.status !== 'todo' || !card.assignee) continue
    if (!out.has(card.assignee)) out.set(card.assignee, [])
    out.get(card.assignee).push({ ...card, parents: ps })
  }
  for (const list of out.values()) list.sort(byOldest)
  return out
}

/**
 * The state of a bot once the queue is known (the ONE place that decides it). It only ever replaces a bot at rest (`idle`) or whose only
 * sign is a recent session (`active`): a worker alive, a silent run and a blocked card (a decision is yours) all win, and so does a bot
 * with a card of its own running or blocked. `new` / `unknown` say something about the SESSION DATA and stay.
 * `n` = { running, blocked, queued }: how many cards of each kind the bot has.
 */
export function queuedState(state, { running = 0, blocked = 0, queued = 0 } = {}) {
  if (!(queued > 0) || running > 0 || blocked > 0) return state
  return state === 'idle' || state === 'active' ? 'queued' : state
}

/* ---------- what the head of the queue is doing ---------- */

/**
 * The state of a head card, as data (the page translates it):
 *   { kind: 'waiting' }                 blocked: a decision is the user's
 *   { kind: 'silent', ms }              running, no sign of life for more than 5 min (`ms` = how long)
 *   { kind: 'working', sinceMs }        running (`sinceMs` null when Hermes does not say since when)
 *   { kind: 'ready' }                   ready to be taken, or about to be (every parent finished)
 *   { kind: 'triage' }                  not specified yet
 *   { kind: 'other' }                   anything else (scheduled, review...): nothing is said
 */
export function headFact(card, nowMs) {
  switch (card?.status) {
    case 'blocked': return { kind: 'waiting' }
    case 'running': {
      const ms = cardSilentMs(card, nowMs)
      return ms ? { kind: 'silent', ms } : { kind: 'working', sinceMs: card.startedMs || null }
    }
    case 'ready': case 'todo': return { kind: 'ready' }
    case 'triage': return { kind: 'triage' }
    default: return { kind: 'other' }
  }
}

const HEAD_RANK = { waiting: 0, silent: 1, working: 2, ready: 3, triage: 4, other: 5 }

/* ---------- the chain upstream ---------- */

/**
 * What a waiting card waits for, up to the heads. Breadth first, each card once (a loop cannot cycle: a card seen is not walked again),
 * at most `depthMax` levels and `cardsMax` cards (`capped` says the walk stopped short).
 * -> { card, parents: [card], heads: [{ card, depth, fact }] (the most useful first), upstream: [card] (every card between, nearest first),
 *      loop: no head at all because the cards wait on each other, capped }
 */
export function chainOf(index, card, nowMs = 0, { depthMax = QUEUE_DEPTH_MAX, cardsMax = QUEUE_CARDS_MAX } = {}) {
  const parents = index.parents.get(card.key) || []
  const depthOf = new Map([[card.key, 0]])
  const upstream = []
  const heads = []
  let frontier = [card]
  let capped = false
  for (let depth = 1; frontier.length; depth++) {
    const next = []
    for (const at of frontier) {
      for (const p of index.parents.get(at.key) || []) {
        if (depthOf.has(p.key)) continue
        if (depthOf.size >= cardsMax) { capped = true; continue }
        depthOf.set(p.key, depth)
        upstream.push(p)
        if (isWaiting(index, p)) next.push(p)
        else heads.push({ card: p, depth, fact: headFact(p, nowMs) })
      }
    }
    if (depth >= depthMax) { capped = capped || next.length > 0; break }
    frontier = next
  }
  heads.sort((a, b) => HEAD_RANK[a.fact.kind] - HEAD_RANK[b.fact.kind] || a.depth - b.depth || byText(a.card.key, b.card.key))
  return { card, parents, heads, upstream, loop: heads.length === 0 && !capped && upstream.length > 0, capped }
}

/* ---------- who waits behind a card ---------- */

/**
 * The waiting cards behind some cards (their children, then those children's...), bounded like `chainOf`.
 * -> { cards: [card] (waiting cards only, nearest first), capped }
 */
export function behindOf(index, starts, { depthMax = QUEUE_DEPTH_MAX, cardsMax = QUEUE_CARDS_MAX } = {}) {
  const seen = new Set(starts.map(c => c.key))
  const out = []
  let frontier = starts
  let capped = false
  for (let depth = 1; frontier.length; depth++) {
    const next = []
    for (const at of frontier) {
      for (const c of index.children.get(at.key) || []) {
        if (seen.has(c.key)) continue
        if (seen.size >= cardsMax) { capped = true; continue }
        seen.add(c.key)
        next.push(c)
        if (isWaiting(index, c)) out.push(c)
      }
    }
    if (depth >= depthMax) { capped = capped || next.length > 0; break }
    frontier = next
  }
  return { cards: out, capped }
}

const namesOf = (cards, skip = null) => {
  const out = []
  for (const c of cards) if (c.assignee && c.assignee !== skip && !out.includes(c.assignee)) out.push(c.assignee)
  return out
}

/**
 * What a card holds back: the waiting cards behind it and the bots that own them (not its own bot, and only the bots of `team` when
 * one is given). -> { cards: n, bots: [name], capped }. Nothing behind it: { cards: 0, bots: [], capped: false }.
 */
export function holdsBack(index, board, id, team = null) {
  const start = index.cards.get(cardKey(board, id))
  if (!start) return { cards: 0, bots: [], capped: false }
  const { cards, capped } = behindOf(index, [start])
  return { cards: cards.length, bots: namesOf(cards, start.assignee).filter(n => !team || team.has(n)), capped }
}

/**
 * The bots that wait behind the cards of a bot (not its own): { bots: [name], cards: n, capped }, the nearest first, only the bots of `team`.
 * `cards` = how many of its cards something waits behind. Only the cards that wait for nothing themselves count (a card of its own that is
 * waiting is not the work the others are held by: the head of that queue is).
 */
export function waitersOf(index, name, team = null) {
  const mine = []
  for (const c of index.cards.values()) if (c.assignee === name && !DONE.has(c.status) && !isWaiting(index, c) && index.children.has(c.key)) mine.push(c)
  if (!mine.length) return { bots: [], cards: 0, capped: false }
  const { cards, capped } = behindOf(index, mine.sort(byOldest))
  return { bots: namesOf(cards, name).filter(n => !team || team.has(n)), cards: mine.length, capped }
}

/* ---------- the sheet of a bot ---------- */

const CARD_TITLE_MAX = 160

/**
 * The queue as the sheet of a bot says it. `office` = buildOffice(); `agent` = one of its agents.
 *   a bot in the queue    -> { kind: 'queued', card, waits: [{ card, who }], waitsMore, head: { card, who, fact } | null, headsMore, position, loop, capped, upstream: [name] }
 *   a bot others wait for -> { kind: 'waited', bots: [name] (at most QUEUE_NAMES_MAX), more, count, capped }
 *   neither -> null
 * `who` = { name, label, kind: 'bot' | 'none' (a card with no assignee) | 'outside' (a bot that is not on the team) }.
 * `position` = how many cards separate the bot's card from the head's (1 = it waits for the head's card itself).
 */
export function queueView(office, agent, nowMs = 0, index = waitIndex(office?.boards)) {
  if (!agent) return null
  const agents = new Map((office?.agents || []).map(a => [a.name, a]))
  const team = new Set(agents.keys())
  const whoOf = card => {
    if (!card.assignee) return { name: '', label: '', kind: 'none' }
    const a = agents.get(card.assignee)
    return a ? { name: a.name, label: a.label || a.name, kind: 'bot' } : { name: card.assignee, label: card.assignee, kind: 'outside' }
  }
  const trim = card => ({ board: card.board, id: card.id, title: oneLine(card.title).slice(0, CARD_TITLE_MAX), status: card.status })
  if (agent.state === 'queued') {
    const main = (waitingByBot(index).get(agent.name) || [])[0]
    if (!main) return null
    const chain = chainOf(index, main, nowMs)
    const head = chain.heads[0] || null
    return {
      kind: 'queued',
      card: trim(main),
      waits: chain.parents.slice(0, QUEUE_PARENTS_MAX).map(p => ({ card: trim(p), who: whoOf(p) })),
      waitsMore: Math.max(0, chain.parents.length - QUEUE_PARENTS_MAX),
      head: head ? { card: trim(head.card), who: whoOf(head.card), fact: head.fact } : null,
      headsMore: Math.max(0, chain.heads.length - 1),
      position: head ? head.depth : null,
      loop: chain.loop,
      capped: chain.capped,
      upstream: namesOf(chain.upstream, agent.name).filter(n => team.has(n))
    }
  }
  const { bots, cards, capped } = waitersOf(index, agent.name, team)
  if (!bots.length) return null
  return { kind: 'waited', bots: bots.slice(0, QUEUE_NAMES_MAX), more: Math.max(0, bots.length - QUEUE_NAMES_MAX), count: bots.length, cards, capped }
}

/**
 * The bots a queued bot waits for, by the direct parents of its oldest waiting card (`agent.queued`, buildOffice): their names, the team's
 * order of reading, at most QUEUE_PARENTS_MAX (the sheet says the rest). A parent with no assignee names nobody. `labelOf(name)` gives the name to show.
 */
export function waitsOn(agent, labelOf = n => n) {
  const card = Array.isArray(agent?.queued) ? agent.queued[0] : null
  if (!card) return []
  return namesOf(card.parents || [], agent.name).map(labelOf).slice(0, QUEUE_PARENTS_MAX)
}

/* ---------- words that are not in a catalogue ---------- */

/** « 2ᵉ », « 2nd », « 2.º »: the rank of a bot behind the head of the queue (2 and more: the first needs no rank). */
export function ordinalText(n, lang) {
  const k = Math.max(1, Math.floor(Number(n) || 1))
  if (lang === 'fr') return k === 1 ? '1ᵉʳ' : `${k}ᵉ`
  if (lang === 'es') return `${k}.º`
  const tens = k % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[k % 10] || 'th'
  return `${k}${suffix}`
}
