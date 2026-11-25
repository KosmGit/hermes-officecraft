/**
 * Pure data of the side panel (inspector, "waiting for you" box, chains, journal). No SDK, no DOM, no clock
 * (callers pass `nowMs`). Read-only: nothing here sends an order.
 *
 * Privacy: card titles are shown (they are Hermes' own board text); bodies, results, comments,
 * session paths and previews never reach this module. Skills are name + category only, never a description.
 */
import { quietCards, runningCards } from './cards.js'
import { codeRef } from './hud.js'
import { modelText, pinOf } from './models.js'
import { lastTouch, oneLine } from './util.js'

export const CHAIN_LEN = 16
export const EVENTS_SHOWN = 14
/** Rows of the decision box (approvals + cards); the rest is counted (« N more »). */
export const INBOX_MAX = 50
export const INSPECTOR_WAITING_MAX = 4
/** Running cards listed in the inspector (then « +N »). */
export const INSPECTOR_CARDS_MAX = 4
export const INSPECTOR_SKILLS_MAX = 12
/** Event kinds the journal shows: the same seven the agent half copies (hermes_officecraft/snapshot.py EVENT_KINDS). */
export const EVENT_KINDS = Object.freeze(['blocked', 'unblocked', 'review_requested', 'changes_requested', 'completed', 'crashed', 'timed_out'])
export const CARD_STATUSES = Object.freeze(['todo', 'triage', 'scheduled', 'ready', 'running', 'review', 'blocked', 'done', 'archived'])

const agentsByName = office => new Map((office?.agents || []).map(a => [a.name, a]))
/** Short reference of a card: its code (S3.2) when the title starts with one, else its id. */
export const cardRef = t => codeRef(t?.title) || String(t?.id || '')

/** A card title without its leading code (the code is shown on its own): « S3.2 — Inspector » -> « Inspector ». */
export function plainTitle(title, code) {
  const text = String(title || '')
  if (!code || !text.startsWith(code)) return text
  return text.slice(code.length).replace(/^[\s:–—-]+/, '') || text
}

/** False in roster-only mode (no agent half, no /live): nothing is known about boards and cards — unknown, not zero. */
export const boardsKnown = office => Boolean(office) && office.mode !== 'roster'

/**
 * A phase guard whose campaign's head guard still waits on the same board. It is not a decision yet (launching it would be refused
 * `phase_not_done`): the list and the counter of the decisions both leave it out until the campaign is launched.
 */
export const heldPhaseGuard = (board, t) => Boolean(t.guard && !t.head && t.campaign && board.blocked.some(h => h.guard && h.head && h.campaign === t.campaign))

/** Counters of the top strip; the card counters are null (unknown) in roster-only mode. */
export function topStats(office) {
  const agents = office?.agents || []
  const boards = office?.boards || []
  const sum = pick => (boardsKnown(office) ? boards.reduce((n, b) => n + pick(b), 0) : null)
  return {
    agents: agents.length,
    working: agents.filter(a => a.state === 'working').length,
    active: agents.filter(a => a.state === 'active').length,
    decisions: sum(b => b.blocked.filter(t => !heldPhaseGuard(b, t)).length),
    open: sum(b => b.open.length),
    cards: sum(b => b.total)
  }
}

/** When each card was last blocked: `board/task` -> ms, from the whitelisted `blocked` events of `/history` (task_events). */
function lastBlocked(history) {
  const out = new Map()
  if (!history?.ok) return out
  for (const b of history.boards || []) {
    for (const e of b.events || []) {
      const k = `${b.slug}/${e.task}`
      if (e.kind === 'blocked' && e.ms != null && !(out.get(k) >= e.ms)) out.set(k, e.ms)
    }
  }
  return out
}

/**
 * Every `blocked` card of every board, longest waiting first. blockedMs = when it was last blocked (Hermes' task_events,
 * read through `/history`); null when no event says so (no agent half, or an old card), then its creation is the only age.
 * pin: the model the card imposes when it differs from its assignee's default, else null.
 */
export function inboxItems(office, history = null) {
  const by = agentsByName(office)
  const since = lastBlocked(history)
  const items = []
  for (const b of office?.boards || []) {
    for (const t of b.blocked) {
      if (heldPhaseGuard(b, t)) continue
      items.push({
        board: b.slug, id: t.id, code: codeRef(t.title), ...(t.blockReason ? { reason: t.blockReason } : {}), title: plainTitle(t.title, codeRef(t.title)), createdMs: t.createdMs, blockedMs: since.get(`${b.slug}/${t.id}`) ?? null, assignee: t.assignee, pin: pinOf(t, by.get(t.assignee)),
        ...(t.guard ? { guard: true, head: t.head === true, campaign: t.campaign ?? null, campaignSize: t.campaignSize ?? null, fullTitle: t.title } : {})
      })
    }
  }
  const age = i => i.blockedMs ?? i.createdMs ?? Infinity
  return items.sort((x, y) => age(x) - age(y) || x.board.localeCompare(y.board, 'en') || x.id.localeCompare(y.id, 'en'))
}

/** Per board: share done, and the queue of its last CHAIN_LEN cards (oldest left, newest right; archived ones skipped). */
export function chainsView(office) {
  const by = agentsByName(office)
  return (office?.boards || []).map(b => {
    const live = b.tasks.filter(t => t.status !== 'archived')
    const queue = [...live]
      .sort((x, y) => lastTouch(x) - lastTouch(y) || x.id.localeCompare(y.id, 'en'))
      .slice(-CHAIN_LEN)
      .map(t => ({ id: t.id, code: cardRef(t), title: t.title, status: t.status, pin: pinOf(t, by.get(t.assignee)) }))
    return { slug: b.slug, done: b.done, total: b.total, pct: Math.round((b.done / (b.total || 1)) * 100), queue, pinned: queue.filter(c => c.pin) }
  })
}

/** Newest `/history` events (whitelisted kinds only), with the card's short reference when the board still has it. */
export function eventsView(history, office, limit = EVENTS_SHOWN) {
  if (!history?.ok) return []
  const known = new Map()
  for (const b of office?.boards || []) for (const t of b.tasks) known.set(`${b.slug}/${t.id}`, t)
  const kinds = new Set(EVENT_KINDS)
  const out = []
  for (const b of history.boards || []) {
    for (const e of b.events || []) {
      if (!kinds.has(e.kind) || e.ms == null) continue
      const t = known.get(`${b.slug}/${e.task}`)
      // `title`: the card's own title (one clean line) while the board still has it; '' once the card is gone (archived): the journal then names it by its id
      out.push({ board: b.slug, kind: e.kind, code: t ? cardRef(t) : String(e.task || ''), title: t ? oneLine(t.title) : '', ms: e.ms })
    }
  }
  return out.sort((x, y) => y.ms - x.ms).slice(0, limit)
}

/** Which timestamp says "since when" for the state the agent is in: { kind, ms } or null. */
export function sinceOf(agent, nowMs) {
  if (!agent) return null
  if (agent.state === 'working') {
    // since when the MAIN card (the oldest running one) runs
    const started = runningCards(agent, nowMs)[0]?.startedMs
    if (started) return { kind: 'working', ms: started }
  }
  if (agent.state === 'waiting') {
    const created = (agent.blocked || []).map(t => t.createdMs).filter(Boolean)
    if (created.length) return { kind: 'waiting', ms: Math.min(...created) }
  }
  if (agent.state === 'stale' && agent.silentMs) return { kind: 'stale', ms: nowMs - agent.silentMs }
  if (agent.lastActivityMs) return { kind: 'activity', ms: agent.lastActivityMs }
  return null
}

/**
 * i18n key for a session that exists but carries no title (Hermes leaves new / untitled chats with `title: ''`).
 * null = the session has a title and prints it. Never « no session »: the Open button works for this one.
 */
export const untitledKey = session => (session && !session.title ? 'insp.untitled' : null)

/**
 * The inspector's facts for one agent.
 *   agent: office agent (with workerModel when /history knows it); sceneAgent: toSceneModel agent (for the role);
 *   history: toHistory() or null; models: modelOf() result; roleId: roleOf(sceneAgent).role or null.
 * `grade` stays null until the game layer provides one; the page shows nothing for null.
 */
export function inspectorOf(agent, { nowMs, history = null, models = null, roleId = null, grade = null } = {}) {
  if (!agent) return null
  const cards = runningCards(agent, nowMs)
  const running = cards[0] || null   // the main card = the running card started first (src/core/cards.js)
  const hp = history?.ok ? history.profiles?.[agent.name] : null
  const own = hp?.skills?.own || []
  const session = agent.lastSession || hp?.lastSession || null
  // same age as the decision inbox: when the card was last blocked (task_events), else when it was created
  const since = lastBlocked(history)
  const ageOf = t => since.get(`${t.board}/${t.id}`) ?? t.createdMs ?? null
  const blocked = [...(agent.blocked || [])].sort((a, b) => (ageOf(a) ?? Infinity) - (ageOf(b) ?? Infinity))
  const oldest = blocked.length ? ageOf(blocked[0]) : null
  const oldestBlocked = blocked.length && since.has(`${blocked[0].board}/${blocked[0].id}`)
  return {
    name: agent.name,
    label: agent.label || agent.name,
    state: agent.state,
    roleId,
    since: agent.state === 'waiting' && oldest ? { kind: oldestBlocked ? 'waitingBlocked' : 'waiting', ms: oldest } : sinceOf(agent, nowMs),
    current: running ? { board: running.board, code: cardRef(running), title: plainTitle(running.title, cardRef(running)), startedMs: running.startedMs || null } : null,
    // `title`: what the card is about (the id when it has no title), `named`: the code in front of it is a real one (S3.2), not the id; the id is for a `title` tooltip
    waiting: blocked.slice(0, INSPECTOR_WAITING_MAX).map(t => ({ board: t.board, id: t.id, code: cardRef(t), named: Boolean(codeRef(t.title)), title: oneLine(plainTitle(t.title, cardRef(t))) || String(t.id || ''), createdMs: t.createdMs, blockedMs: since.get(`${t.board}/${t.id}`) ?? null })),
    waitingMore: Math.max(0, blocked.length - INSPECTOR_WAITING_MAX),
    session: session ? { title: session.title || '', ms: session.lastActiveMs ?? null } : null,
    skills: own.slice(0, INSPECTOR_SKILLS_MAX).map(s => ({ name: s.name, category: s.category })),
    skillsMore: Math.max(0, own.length - INSPECTOR_SKILLS_MAX),
    // every running card, main first, when the list says more than `current`: several cards, or the only one is silent on a bot that is not
    // stale itself (a waiting bot). One card otherwise: the output is then the single-card one, key for key.
    ...(cards.length > 1 || (cards.length === 1 && agent.state !== 'stale' && quietCards(cards, agent.state).length) ? { cards: cards.slice(0, INSPECTOR_CARDS_MAX).map(t => ({ board: t.board, id: t.id, code: cardRef(t), title: plainTitle(t.title, cardRef(t)), startedMs: t.startedMs || null, silentMs: t.silentMs, pin: pinOf(t, agent) ? modelText(pinOf(t, agent)) : null })), cardsMore: Math.max(0, cards.length - INSPECTOR_CARDS_MAX) } : {}),
    model: models?.differs
      ? { card: models.card ? modelText(models.card) : '', default: modelText(models.default), actual: models.actual?.model || null, ...(cards.length > 1 && models.card ? { cardCode: cardRef(cards.find(t => t.id === models.card.cardId) || { id: models.card.cardId }) } : {}) }
      : null,
    grade
  }
}

/** Agents whose running card differs from their default model: [{ name, code, board, card, default }] (the badge's data). */
export function badgesOf(agents, modelsByName) {
  const out = []
  for (const a of agents || []) {
    const m = modelsByName.get(a.name)
    if (!m?.differs || !m.card) continue
    const task = (a.running || []).find(t => t.id === m.card.cardId)
    out.push({
      name: a.name,
      label: a.label || a.name,
      board: m.card.board,
      code: cardRef(task || { id: m.card.cardId }),
      card: modelText(m.card) || modelText(m.actual ? { model: m.actual.model } : null),
      default: modelText(m.default),
      actual: m.actual?.model || null
    })
  }
  return out
}

/**
 * Agents that just entered « waiting for you » or « silent » (a decision is yours / a run went quiet): what the live region
 * announces besides the badges. `prev` = Map name -> state of the previous render, or null at first sight (the page that opens says
 * nothing: those states are on screen, nobody changed). Pure.
 */
export function newAttention(prev, agents) {
  if (!(prev instanceof Map)) return []
  return (agents || []).filter(a => (a.state === 'waiting' || a.state === 'stale') && prev.has(a.name) && prev.get(a.name) !== a.state)
}

/**
 * Cards that just went silent on a bot that is not itself silent (its own state says it when it is): what the discreet live
 * region announces besides the states. `prev` = Map agent name -> Set of the keys (`board/id`) of the silent cards of the previous render, or
 * null at first sight (a page that opens says nothing: those cards are marked on screen, nobody changed). A card is announced once: its key
 * stays in the set while it stays silent, whatever the state of the bot. Reads `agent.quiet` (buildOffice). Pure.
 * -> [{ agent, card }]
 */
export function newQuiet(prev, agents) {
  if (!(prev instanceof Map)) return []
  const out = []
  for (const a of agents || []) {
    if (a.state === 'stale' || !prev.has(a.name)) continue
    for (const c of a.quiet || []) if (!prev.get(a.name).has(quietKey(c))) out.push({ agent: a, card: c })
  }
  return out
}
export const quietKey = c => `${c.board}/${c.id}`
/** The silent cards of every agent, for the next `newQuiet` call: Map name -> Set of keys. */
export const quietNow = agents => new Map((agents || []).map(a => [a.name, new Set((a.quiet || []).map(quietKey))]))

/** Badges that were not there before: what the discreet live region announces. `prev` = Set of agent names (or null at first sight). */
export function newBadges(prevNames, badges) {
  const seen = prevNames instanceof Set ? prevNames : new Set()
  return badges.filter(b => !seen.has(b.name))
}

/**
 * What the decision box draws. `cards` = inboxItems() (already sorted, longest waiting first), `approvals` = pending requests.
 * At most INBOX_MAX rows in all, approvals first (they expire), then the cards that fit; `more` counts what is left out, `total` everything.
 */
export function inboxView(cards, approvals, max = INBOX_MAX) {
  const shownApprovals = approvals.slice(0, max)
  const shownCards = cards.slice(0, Math.max(0, max - shownApprovals.length))
  const total = cards.length + approvals.length
  return { approvals: shownApprovals, cards: shownCards, more: total - shownApprovals.length - shownCards.length, total }
}

/**
 * The model block of an agent's sheet in two lines: the model the work really runs on, whole, with who imposes it (« imposed by WX-14 »)
 * when a card pins it; then the bot's default. « Really used » is a third line only when what the worker ran with differs from what the
 * card pins (when no card pins anything, the worker's model IS the first line). `m` = inspectorOf(...).model; `soleCardCode` = the code of the only running card (the one that pins it when `m` names no other).
 * -> { shown, imposedBy: code | '' | null (null = not imposed; '' = imposed by a card that has no code), actual: string | null, default: string } | null
 */
export function modelLines(m, soleCardCode = '') {
  if (!m) return null
  const imposed = Boolean(m.card)
  return {
    shown: m.card || m.actual || '',
    imposedBy: imposed ? m.cardCode || soleCardCode || '' : null,
    actual: imposed && m.actual && m.actual !== m.card ? m.actual : null,
    default: m.default || ''
  }
}
