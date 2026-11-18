/* Seating: who sits next to whom. The neighbours follow the REAL hand-offs between agents (two consecutive
   cards of a board done by two different agents = one relay); the model may propose an order from the user's instructions, and the engine
   places it. The model places nothing: it returns neighbour PAIRS (never a whole order: with 13 agents a model forgets one), which `normalizeSeating` checks and
   `seatOrder` chains; an agent without a pair is placed after the others, in the order given.
   Pure: no DOM, no clock, no random. Same input -> same order. */

export const RELAYS_MAX = 60   // the pairs kept, strongest first (the agent half sends no more: hermes_officecraft/llm.py RELAYS_MAX)

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const byName = (p, q) => (p < q ? -1 : p > q ? 1 : 0)

/**
 * The hand-offs between agents, from the boards' cards: for each board, its cards with an assignee in creation order; two consecutive
 * cards of two different assignees count one relay for that pair. `names`: only agents of this list count (the roster; null = all).
 * -> [[a, b, n]] (a < b), strongest first, then by name, at most RELAYS_MAX. Same cards -> same list. Pure.
 */
export function relayWeights(boards, names = null) {
  const allowed = names ? new Set(names) : null
  const w = new Map()
  for (const b of boards || []) {
    const tasks = (b?.tasks || []).filter(t => t && t.assignee).map((t, i) => ({ who: t.assignee, at: Number.isFinite(t.createdMs) ? t.createdMs : 0, i }))
    tasks.sort((p, q) => p.at - q.at || p.i - q.i)
    for (let i = 1; i < tasks.length; i++) {
      const a = tasks[i - 1].who
      const c = tasks[i].who
      if (a === c || (allowed && (!allowed.has(a) || !allowed.has(c)))) continue
      const k = pairKey(a, c)
      w.set(k, (w.get(k) || 0) + 1)
    }
  }
  return [...w.entries()]
    .map(([k, n]) => { const [a, c] = k.split('|'); return [a, c, n] })
    .sort((p, q) => q[2] - p[2] || byName(p[0], q[0]) || byName(p[1], q[1]))
    .slice(0, RELAYS_MAX)
}

/**
 * A seating, made safe (the engine draws nothing it was not given in a known shape):
 *   { mode: 'relays', weights: [[a, b, n]] }  the neighbours follow the hand-offs (computed here, no model);
 *   { mode: 'model', pairs: [{ a, b }] }      the neighbour pairs the model proposed, the most important first;
 * anything else -> null (the default order, by name). A bad entry is ignored, never repaired. Pure.
 */
export function normalizeSeating(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (raw.mode === 'model') {
    if (!Array.isArray(raw.pairs)) return null
    const seen = new Set()
    const pairs = []
    for (const e of raw.pairs) {   // a bad pair (not two different names, or already seen either way round) is ignored, never repaired
      if (!e || typeof e.a !== 'string' || typeof e.b !== 'string' || !e.a || !e.b || e.a === e.b || seen.has(pairKey(e.a, e.b))) continue
      seen.add(pairKey(e.a, e.b))
      pairs.push(Object.freeze({ a: e.a, b: e.b }))
    }
    return pairs.length ? Object.freeze({ mode: 'model', pairs: Object.freeze(pairs) }) : null   // no pair = the default order
  }
  if (raw.mode === 'relays') {
    const weights = (Array.isArray(raw.weights) ? raw.weights : [])
      .filter(e => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string' && e[0] !== e[1] && Number.isInteger(e[2]) && e[2] > 0)
      .slice(0, RELAYS_MAX)
      .map(e => Object.freeze([e[0], e[1], e[2]]))
    return weights.length ? Object.freeze({ mode: 'relays', weights: Object.freeze(weights) }) : null
  }
  return null
}

const countOf = weights => {
  const m = new Map()
  for (const [a, b, n] of weights) m.set(pairKey(a, b), (m.get(pairKey(a, b)) || 0) + n)
  return (p, q) => m.get(pairKey(p, q)) || 0
}

/**
 * Hand-offs -> one seat order: the strongest hand-offs are kept first, as long as nobody gets more than two neighbours and no ring closes
 * (a table is a row, not a circle); the pieces of chain that result are laid end to end, the heaviest first; whoever has no hand-off comes
 * last. Every tie keeps the order given (by name), so the same cards always give the same seats.
 */
function chainOrder(list, count) {
  const n = list.length
  const edges = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const w = count(list[i].name, list[j].name); if (w > 0) edges.push({ i, j, w }) }
  edges.sort((p, q) => q.w - p.w || p.i - q.i || p.j - q.j)
  const parent = list.map((_, i) => i)
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const adj = list.map(() => [])
  for (const e of edges) {
    if (adj[e.i].length >= 2 || adj[e.j].length >= 2 || find(e.i) === find(e.j)) continue
    parent[find(e.i)] = find(e.j)
    adj[e.i].push({ to: e.j, w: e.w })
    adj[e.j].push({ to: e.i, w: e.w })
  }
  const seen = new Array(n).fill(false)
  const pieces = []
  for (let s0 = 0; s0 < n; s0++) {
    if (seen[s0] || adj[s0].length > 1) continue   // a piece starts at one of its ends, the one that comes first in the order given
    const piece = { at: s0, w: 0, members: [] }
    let prev = -1
    let cur = s0
    while (cur !== -1) {
      seen[cur] = true
      piece.members.push(list[cur])
      const next = adj[cur].find(x => x.to !== prev)
      if (next) piece.w += next.w
      prev = cur
      cur = next ? next.to : -1
    }
    pieces.push(piece)
  }
  return pieces.sort((p, q) => q.w - p.w || p.at - q.at).flatMap(p => p.members)
}

/**
 * The members of a pod in seat order. Default (no seating) = the order given (by name). 'relays': neighbours follow the hand-offs
 * (chainOrder above). 'model': the same chain, built from the neighbour pairs (the first pair is the strongest); whoever has no pair comes
 * last, in the order given. A single member is never moved. Returns a new array; never mutates.
 */
export function seatOrder(members, seating = null) {
  const list = [...members]
  if (!seating || list.length < 2) return list
  if (seating.mode === 'model') {
    const n = seating.pairs.length
    return chainOrder(list, countOf(seating.pairs.map((p, i) => [p.a, p.b, n - i])))
  }
  if (seating.mode === 'relays') {
    return chainOrder(list, countOf(seating.weights))
  }
  return list
}

/** The table neighbours of an agent by hand-offs, the strongest first: [{ who, n }], at most 3 (the inspector's « Relays » line). */
export function neighboursOf(name, weights) {
  return (weights || [])
    .filter(([a, b]) => a === name || b === name)
    .map(([a, b, n]) => ({ who: a === name ? b : a, n }))
    .sort((p, q) => q.n - p.n || byName(p.who, q.who))
    .slice(0, 3)
}
