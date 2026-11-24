/**
 * Pure HUD logic for the office page (no SDK, no DOM, no clock): what an agent's label says,
 * how the scene or the list is chosen, and how island labels slide away from agent labels.
 *
 * Privacy: a card's title is only mined for its short code (S3.2); the title itself is never returned.
 */
import { fitScale } from '../scene/fit.js'
import { quietCards, runningCards } from './cards.js'

/** Card code at the start of a title: "S3.2 …" -> "S3.2". Nothing else of the title survives. */
// e.g. S2, S2.F, S5.1, S1.3b, API-A1, V-WEB-A. A word in capitals is not a code: it needs a digit or a dot / dash joining parts.
const CODE_RE = /^([A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*[a-z]?)\b/
export const codeRef = title => {
  const code = (String(title || '').match(CODE_RE) || [])[1] || ''
  return /[0-9.-]/.test(code) ? code : ''
}

/** "12 min" / "2 h 05": short spans for labels (units are the same in en, fr, es). */
export function formatSpan(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`
}

/** A card's short reference for a list of cards: its code, else its id (a card without a code must still be named). */
const refOf = t => codeRef(t?.title) || String(t?.id || '')
/** At most this many cards are named in a tooltip (then « +N »); the `+N` of a label never reads more than +9. */
export const NAMED_MAX = 3
export const MORE_MAX = 9
export const plusOf = more => `+${Math.min(Math.max(0, Number(more) || 0), MORE_MAX)}`

/** The code a label shows: the main card's, else the first running card (in order) that has one; '' when none has. */
const labelRef = cards => {
  for (const c of cards) { const r = codeRef(c.title); if (r) return r }
  return ''
}
/** More than one running card: how many more than the main one, and the first NAMED_MAX of them with their time on the card (the main one first). */
function manyFacts(cards, nowMs) {
  if (cards.length < 2) return {}
  const span = c => (c.startedMs && nowMs > c.startedMs ? formatSpan(nowMs - c.startedMs) : '')
  return { more: cards.length - 1, cards: cards.slice(0, NAMED_MAX).map(c => ({ ref: refOf(c), span: span(c) })), cardsMore: Math.max(0, cards.length - NAMED_MAX) }
}
/** Silent cards (their OWN last sign is > 5 min old), the longest silent first, as data for the sign on the label and the tooltip. */
function quietFacts(cards, state) {
  const quiet = quietCards(cards, state)
  return quiet.length ? { quiet: quiet.slice(0, NAMED_MAX).map(c => ({ ref: refOf(c), span: formatSpan(c.silentMs) })), quietMore: Math.max(0, quiet.length - NAMED_MAX) } : {}
}

/**
 * The sign « a decision waits for you » on a bot whose main state is not « waits for you ». The state of a bot says one thing (working wins
 * over a blocked card, src/core/office.js): a bot at work with a blocked card keeps its state, its outline and its ring, and carries this
 * sign besides, so the scene shows every bot a decision is waiting on. A bot already in the waiting state says it by its state.
 */
export const waitSign = agent => Boolean(agent) && agent.state !== 'waiting' && Array.isArray(agent.blocked) && agent.blocked.length > 0

/** The bots that say « a decision waits for you » on screen: the waiting state, or the sign beside another state. A bot with no card, or none blocked, is not one. */
export const waitBearers = agents => (agents || []).filter(a => a?.state === 'waiting' || waitSign(a))

/**
 * The agent's short factual tag, as data (the page translates it). The card it names is the MAIN one (the running card started first,
 * src/core/cards.js); `more` / `cards` appear only with several running cards, `quiet` only with a silent card on a bot that is not
 * itself silent:
 *   working -> { kind: 'working', ref, span, more?, cards?, cardsMore?, quiet?, quietMore?, wait? }   card code + time on it (either may be empty); `wait` = its cards that wait for a decision
 *   stale   -> { kind: 'stale', span, ref?, more?, cards?, cardsMore? }    silent for <span> (ref: the code of the card that went silent, when it has one)
 *   waiting -> { kind: 'waiting', ref, n, quiet?, quietMore? }             the card waiting on you
 *   other   -> { kind: 'quiet', quiet, quietMore } when a running card is silent, else null
 */
export function taskTag(agent, nowMs) {
  if (!agent) return null
  const cards = runningCards(agent, nowMs)
  if (agent.state === 'working') {
    const main = cards[0]
    const ref = labelRef(cards) || (cards.length < 2 ? codeRef(agent.workerSession?.title) : '')
    const since = main?.startedMs
    return { kind: 'working', ref, span: since && nowMs > since ? formatSpan(nowMs - since) : '', ...manyFacts(cards, nowMs), ...quietFacts(cards, 'working'), ...(waitSign(agent) ? { wait: agent.blocked.length } : {}) }
  }
  if (agent.state === 'stale') {
    // the card that went silent, by its code (the label of the scene is « name + code »); nothing when it has none
    const ref = labelRef(cards)
    return { kind: 'stale', span: formatSpan(agent.silentMs || 0), ...(ref ? { ref } : {}), ...manyFacts(cards, nowMs) }
  }
  if (agent.state === 'waiting') {
    const blocked = agent.blocked || []
    return { kind: 'waiting', ref: codeRef(blocked[0]?.title), n: blocked.length, ...quietFacts(cards, 'waiting') }
  }
  const quiet = quietFacts(cards, agent.state)
  return quiet.quiet ? { kind: 'quiet', ...quiet } : null
}

/**
 * The time an agent has spent on its running card, as a bar under its label. No card says how long it should take, so the bar
 * is a clock, not a share done: it fills over PROGRESS_FULL_MS, then stays full and turns `late` (it drags). null = nothing to show.
 * The card is the MAIN one (the oldest running card).
 */
export const PROGRESS_FULL_MS = 30 * 60_000
export function cardProgress(agent, nowMs) {
  if (agent?.state !== 'working') return null
  const since = runningCards(agent, nowMs)[0]?.startedMs
  if (!since || !(nowMs > since)) return null
  const ms = nowMs - since
  return { f: Math.min(1, ms / PROGRESS_FULL_MS), late: ms > PROGRESS_FULL_MS }
}

/**
 * The label's tag already says « waits · 2 cards » / « silent 12 min »: the state word next to it would say it twice.
 * (The state stays in the aria-label.)
 */
export const tagSaysState = tag => tag?.kind === 'waiting' || tag?.kind === 'stale'

/** Scene or list, and how dense the labels are. `box`: free CSS pixels of the pane; `art`: layout.W/H. */
export function chooseView({ availW, availH, W, H, dpr = 1, people = 0 }) {
  if (!(availW > 0) || !(availH > 0)) return { mode: 'pending', scale: 0, dense: false, compact: false }
  return fitScale({ availW, availH, W, H, dpr, people })
}

/** Placed agents, whichever room they sit in. */
export const countPeople = layout => layout.pods.reduce((n, p) => n + p.seats.filter(s => s.agent).length, 0) + layout.lounge.seats.length

/** Same facts as the scene, grouped for the list: one zone per board (even an empty one), then the common room. */
export function listZones(layout) {
  const zones = layout.pods.map(p => ({ key: `b:${p.b.slug}`, board: p.b, agents: p.seats.filter(s => s.agent).map(s => s.agent) }))
  const hall = layout.lounge.seats.map(s => s.agent)
  if (hall.length) zones.push({ key: 'hall', board: null, agents: hall })
  return zones
}

const touches = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)

/**
 * Island / common-room labels never cover an agent label: each one slides down, else up, until free.
 * Rectangles are { left, top, right, bottom } in the same space; `bounds` is the stage. Pure.
 * Returns one vertical offset (px) per label, in order; labels already placed are obstacles for the next ones.
 * A label with nowhere free keeps its own spot (offset 0).
 */
export function unclutter(labels, taken, bounds) {
  const obstacles = [...taken]
  const offsets = []
  for (const label of labels) {
    const height = label.bottom - label.top
    let best = 0
    for (const dir of [1, -1]) {
      let dy = 0
      for (let k = 0; k < 8; k++) {
        const r = { left: label.left, right: label.right, top: label.top + dy, bottom: label.top + dy + height }
        const hit = obstacles.find(o => touches(o, r))
        if (!hit) break
        dy += dir > 0 ? hit.bottom - r.top + 2 : hit.top - r.bottom - 2
      }
      const r = { left: label.left, right: label.right, top: label.top + dy, bottom: label.top + dy + height }
      if (!obstacles.some(o => touches(o, r)) && (!bounds || (r.bottom <= bounds.bottom + 2 && r.top >= bounds.top))) { best = dy; break }
    }
    offsets.push(best)
    obstacles.push({ left: label.left, right: label.right, top: label.top + best, bottom: label.bottom + best })
  }
  return offsets
}

export const rectsIntersect = touches

/** Priority of a full label when two of them overlap (lower wins): selected > waits for you > silent > working > active > the rest. */
const FOLD_RANK = { waiting: 0, stale: 1, working: 2, active: 3 }
export const foldRank = ({ selected, state }) => (selected ? -1 : FOLD_RANK[state] ?? 4)

/**
 * When two FULL agent labels overlap, the less important one folds into its dot (colour kept, full text in its
 * aria-label), so no two full labels ever cover each other. A folded label opens again on hover, keyboard focus and
 * selection (CSS, on top). Never moved over another agent: a label above the wrong head would name the wrong agent.
 * Items: [{ id, rect: { left, top, right, bottom }, state, selected, name }], the FULL labels only, in their final place.
 * Greedy in priority order (ties: name, then id: stable between polls): a label stays full if it touches no full label kept
 * before it. Returns the ids to fold. Pure.
 */
export function foldOverlaps(items) {
  const order = [...items].sort((a, b) => foldRank(a) - foldRank(b) || String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)))
  const kept = []
  const folded = []
  for (const it of order) {
    if (kept.some(k => touches(k.rect, it.rect))) folded.push(it.id)
    else kept.push(it)
  }
  return folded
}

/**
 * After sliding, a full label that still covers another agent's dot (a dot-only label, or one folded by foldOverlaps) would
 * hide that agent's state: the least important of them folds too (one per call, the caller measures again). The selected label
 * never folds, and neither does a label more important than the dot it covers (the less important yields, so a working
 * agent never loses its name to an idle neighbour's dot). `fulls` / `dots`: [{ id, rect, state, selected, name }]. Returns [] or [id]. Pure.
 */
export function foldCovering(fulls, dots) {
  const covering = fulls.filter(f => !f.selected && dots.some(d => d.id !== f.id && touches(d.rect, f.rect) && foldRank(d) <= foldRank(f)))
  if (!covering.length) return []
  covering.sort((a, b) => foldRank(b) - foldRank(a) || String(b.name).localeCompare(String(a.name)) || String(b.id).localeCompare(String(a.id)))
  return [covering[0].id]
}

/**
 * A stable fingerprint of what a scene model DRAWS. A /live read that changes nothing displayed gives the same
 * string, so the page keeps the previous model (no layout, no repaint, no new base). The wall clock shows hours and minutes:
 * the time enters by the minute only. `selected` is left out (the page paints it separately). Pure.
 *
 * Of a board the engine reads its slug and creation date (layout, hue), its counts (whiteboard) and the number of cards that wait for
 * the user (the desk, the island); never its cards: their heartbeats move at every read, their titles and dates are not drawn. Of the
 * gateway it draws the state and the state of each platform, of the crons which one is on and which one fails. A card that changes
 * status changes the counts: the fingerprint follows. The silent state of a bot comes from the agent (`state`), already in the model.
 */
export function sceneFacts(model) {
  const { boards, ops, ...rest } = model
  return JSON.stringify({
    ...rest,
    boards: (boards || []).map(b => [b.slug, b.createdMs ?? null, b.total, b.done, b.counts, b.blocked?.length ?? 0]),
    ops: ops ? { gateway: ops.gateway ? { state: ops.gateway.state, platforms: (ops.gateway.platforms || []).map(p => [p.name, p.state, p.attention]) } : null, crons: (ops.crons || []).map(c => [c.key, c.enabled, c.failing]) } : null
  }, (key, value) => (key === 'nowMs' ? Math.floor(value / 60_000) : key === 'selected' ? undefined : value))
}

/**
 * The legend of the halos under the desks, as data. Colours are the ones the scene really draws (`HALO`, src/scene/furniture.js):
 * the legend takes them from there, never its own copy. `rgb: null` = no halo (an agent at rest is drawn without one).
 * Windows come from the rules that decide the states (roster.js, office.js), in minutes. Pure.
 */
export function legendRows(halo, { workingMs, staleMs, activeMs }) {
  const mins = ms => Math.round(ms / 60_000)
  return [
    { state: 'working', rgb: halo.working || null, hint: 'legend.working', arg: mins(workingMs) },
    { state: 'waiting', rgb: halo.waiting || null, hint: 'legend.waiting', arg: null },
    { state: 'stale', rgb: halo.stale || null, hint: 'legend.stale', arg: mins(staleMs) },
    { state: 'active', rgb: halo.active || null, hint: 'legend.active', arg: mins(activeMs) },
    { state: 'idle', rgb: halo.idle || null, hint: 'legend.rest', arg: null }
  ]
}
