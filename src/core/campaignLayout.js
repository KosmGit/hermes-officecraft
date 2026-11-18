/**
 * The campaign preview's layout, as pure geometry (foldCards / layout / edgePath).
 * No SDK, no DOM, no text measure: the nodes are drawn as real elements by src/ui/CampaignGraph.jsx, the edges as one SVG underneath.
 *
 *   rows      = depth: the order in which the cards start; a guard is a barrier across the whole width;
 *   folding   = past FOLD_FROM cards, parallel cards (same phase, same depth, same parents; at least GROUP_MIN of them) become ONE pile
 *               node (« A1–A12 · ×12 »), unfolded by a click (`open`); the selected card is never inside a pile;
 *   edges     = a link that would run over a row of cards runs down a side channel instead: an edge never crosses a card, and keeps
 *               EDGE_CLEAR px from the border of every node that is not its own end (`edgeClearance`);
 *   guarantee = two nodes never overlap (tests/js/campaign.test.mjs checks up to 40 cards and random graphs).
 * Input cards: [{ id, kind: 'card' | 'guard', phase, parents: [id] }] (the graph as `effective(draft)` gives it).
 */
import { FOLD_FROM } from './campaign.js'

export const GROUP_MIN = 4
const isGuard = c => c.kind === 'guard'

/** Depth of every card: 0 without parents, else 1 + the deepest parent. */
export function depthOf(cards) {
  const byId = new Map(cards.map(c => [c.id, c]))
  const depth = new Map()
  const d = c => {
    if (depth.has(c.id)) return depth.get(c.id)
    depth.set(c.id, 0)   // guards a loop (the editor never draws one)
    const v = c.parents.length ? 1 + Math.max(...c.parents.map(p => (byId.get(p) ? d(byId.get(p)) : 0))) : 0
    depth.set(c.id, v)
    return v
  }
  cards.forEach(d)
  return depth
}

/**
 * Fold parallel cards into piles when there are more than FOLD_FROM cards. A pile = { id: 'grp:<first>', kind: 'group', phase, members, parents, who }.
 * `open` = Set of pile ids the user unfolded; `keep` = ids that stay out of any pile (the selected card).
 */
export function foldCards(cards, open = new Set(), keep = new Set()) {
  if (cards.filter(c => !isGuard(c)).length <= FOLD_FROM) return cards
  const depth = depthOf(cards)
  const groupOf = new Map()
  const out = []
  const levels = []
  for (const c of cards) (levels[depth.get(c.id)] ||= []).push(c)
  const mapP = c => [...new Set(c.parents.map(p => groupOf.get(p) || p))]
  for (const lv of levels) {
    if (!lv) continue
    const buckets = new Map()
    for (const c of lv) {
      const k = isGuard(c) ? `#${c.id}` : `${c.phase || 0}|${mapP(c).sort().join(',')}`
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(c)
    }
    for (const [k, m] of buckets) {
      const gid = `grp:${m[0].id}`
      if (k[0] === '#' || m.length < GROUP_MIN || open.has(gid) || m.some(c => keep.has(c.id))) { for (const c of m) out.push({ ...c, parents: mapP(c) }); continue }
      for (const c of m) groupOf.set(c.id, gid)
      out.push({ id: gid, kind: 'group', phase: m[0].phase || 0, members: m, parents: mapP(m[0]), who: m[0].who })
    }
  }
  return out
}

/**
 * Positions for a width `W` (px): { pos: Map id -> { x, y, w, h, kind }, rows: [{ y0, y1, ids }], W, H, compact, bands: [{ p, y0, y1 }], ... }.
 * A guard is `kind: 'guard'` (a bar across the width), a pile `kind: 'group'`, a card `kind: 'card'`.
 */
export function layout(cards, W) {
  const nodes = cards.filter(c => !isGuard(c))
  const compact = nodes.length > FOLD_FROM
  const PAD = 16
  const LBL = 24
  const GX = compact ? 8 : 16
  const SUB = compact ? 10 : 12
  const LV = compact ? 28 : 36
  const GH = 32
  const NH = compact ? 32 : 52
  const GRH = compact ? 40 : 56
  const avail = Math.max(120, W - 2 * PAD - LBL)
  const depth = depthOf(cards)
  const levels = []
  for (const c of cards) (levels[depth.get(c.id)] ||= []).push(c)
  const span = c => (c.kind === 'group' ? 2 : 1)
  const widest = Math.max(1, ...levels.map(l => (l || []).filter(c => !isGuard(c)).reduce((n, c) => n + span(c), 0)))
  const MIN = compact ? 148 : 176
  const MAXW = 304
  const k = Math.max(1, Math.min(widest, Math.floor((avail + GX) / (MIN + GX))))
  let NW = Math.min(MAXW, Math.floor((avail - (k - 1) * GX) / k))
  if (k === 1) NW = Math.min(NW, avail - 24)   // one per row (narrow): keep a side channel free
  NW = Math.max(60, NW)
  const perRow = Math.max(1, Math.floor((avail + GX) / (NW + GX)))
  const groupW = Math.min(avail - (k === 1 ? 24 : 0), 2 * NW + GX)
  const pos = new Map()
  const ord = new Map()
  const rows = []
  let y = PAD + 4
  let n = 0
  const order = new Map(cards.map((c, i) => [c.id, i]))
  const bx = c => {
    const xs = c.parents.map(p => ord.get(p)).filter(v => v != null)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1e6 + order.get(c.id)
  }
  for (const all of levels) {
    if (!all) continue
    for (const g of all.filter(isGuard)) { pos.set(g.id, { x: PAD + LBL, y, w: avail, h: GH, kind: 'guard' }); y += GH + LV }
    const lv = all.filter(c => !isGuard(c))
    if (!lv.length) continue
    lv.sort((p, q) => bx(p) - bx(q) || order.get(p.id) - order.get(q.id))
    let row = []
    let used = 0
    const flush = last => {
      if (!row.length) return
      const h = Math.max(...row.map(c => (c.kind === 'group' ? GRH : NH)))
      const wOf = c => (c.kind === 'group' ? groupW : NW)
      const rw = row.reduce((s, c) => s + wOf(c), 0) + (row.length - 1) * GX
      let x = PAD + LBL + Math.max(0, (avail - rw) / 2)
      const r = { y0: y, y1: y + h, ids: [] }
      for (const c of row) {
        const ch = c.kind === 'group' ? GRH : NH
        pos.set(c.id, { x, y: y + (h - ch) / 2, w: wOf(c), h: ch, kind: c.kind === 'group' ? 'group' : 'card' })
        ord.set(c.id, n++)
        r.ids.push(c.id)
        x += wOf(c) + GX
      }
      rows.push(r)
      y += h + (last ? LV : SUB)
      row = []
      used = 0
    }
    lv.forEach((c, i) => {
      const s = Math.min(span(c), perRow)
      if (used + s > perRow) flush(false)
      row.push(c)
      used += s
      if (i === lv.length - 1) flush(true)
    })
  }
  const bands = []
  const phases = [...new Set(cards.map(c => c.phase || 0))].sort((a, b) => a - b)
  for (const p of phases) {
    const ps = cards.filter(c => (c.phase || 0) === p).map(c => pos.get(c.id)).filter(Boolean)
    if (ps.length) bands.push({ p, y0: Math.min(...ps.map(r => r.y)) - 8, y1: Math.max(...ps.map(r => r.y + r.h)) + 8 })
  }
  return { pos, rows, W, H: Math.max(0, y - LV) + PAD + 4, NW, NH, compact, bands, LBL, PAD, avail }
}

/** The vertical band an edge may use to cross from row to row: the middle of the gap under `bottom` / above `top` (a gap of 8 px leaves 4 px each side). */
const mid = (a, b) => (a + b) / 2

/** A polyline with rounded corners as an SVG path of lines and cubics (radius `r`, shrunk where a segment is short). */
function rounded(pts, r = 8) {
  let d = `M${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, c, n] = [pts[i - 1], pts[i], pts[i + 1]]
    const lin = Math.hypot(c[0] - p[0], c[1] - p[1])
    const lout = Math.hypot(n[0] - c[0], n[1] - c[1])
    const k = Math.min(r, lin / 2, lout / 2)
    const a = [c[0] + ((p[0] - c[0]) / lin) * k, c[1] + ((p[1] - c[1]) / lin) * k]
    const b = [c[0] + ((n[0] - c[0]) / lout) * k, c[1] + ((n[1] - c[1]) / lout) * k]
    d += ` L${+a[0].toFixed(2)} ${+a[1].toFixed(2)} C${c[0]} ${c[1]} ${c[0]} ${c[1]} ${+b[0].toFixed(2)} ${+b[1].toFixed(2)}`
  }
  const e = pts[pts.length - 1]
  return `${d} L${e[0]} ${e[1]}`
}

/** An edge stops this far above the node it points at: the arrow never touches the border. */
export const EDGE_GAP = 4
/** The least distance an edge keeps from the border of any node that is not its own end. */
export const EDGE_CLEAR = 4

/**
 * One edge as an SVG path. A link between two neighbouring rows is one S curve inside the gap; any other link leaves its parent,
 * crosses the gap under the parent's row at mid height, runs down a side channel outside every row it passes, and enters the gap above
 * its child at mid height: no stretch of an edge runs along a node's border (a long diagonal just above the
 * children's top edge would look like their border).
 */
export function edgePath(L, a, b, lane = 0) {
  const x1 = a.kind === 'guard' ? b.x + b.w / 2 : a.x + a.w / 2
  const y1 = a.y + a.h
  const x2 = b.kind === 'guard' ? a.x + a.w / 2 : b.x + b.w / 2
  const y2 = b.y
  const rowOf = p => L.rows.find(r => r.y0 <= p.y + 0.5 && p.y + p.h <= r.y1 + 0.5)
  const sRow = rowOf(a)
  const tRow = rowOf(b)
  const sBottom = sRow ? sRow.y1 : y1
  const tTop = tRow ? tRow.y0 : y2
  const lo = Math.min(x1, x2) - 2 * EDGE_CLEAR
  const hi = Math.max(x1, x2) + 2 * EDGE_CLEAR
  const between = L.rows.filter(r => r.y0 >= sBottom + 1 && r.y1 <= tTop - 1)
  const crossed = between.filter(r => r.ids.some(id => { const p = L.pos.get(id); return p.x < hi && p.x + p.w > lo }))
  if (!crossed.length) {
    const my = (y1 + y2) / 2
    return { d: `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2 - EDGE_GAP}`, side: false }
  }
  // the bands where the edge goes sideways: the middle of the gap just under the parent's row and just above the child's
  const tops = [...L.rows.map(r => r.y0), ...[...L.pos.values()].filter(p => p.kind === 'guard').map(p => p.y)]
  const bottoms = [...L.rows.map(r => r.y1), ...[...L.pos.values()].filter(p => p.kind === 'guard').map(p => p.y + p.h)]
  const next = Math.min(...tops.filter(t => t >= sBottom + 1))
  const prev = Math.max(...bottoms.filter(t => t <= tTop - 1))
  const ya = Number.isFinite(next) ? mid(sBottom, next) : sBottom + 4
  const yb = Number.isFinite(prev) ? mid(prev, tTop) : tTop - 4
  const ids = between.flatMap(r => r.ids)
  const xmin = Math.min(...ids.map(id => L.pos.get(id).x))
  const xmax = Math.max(...ids.map(id => L.pos.get(id).x + L.pos.get(id).w))
  const right = (x1 + x2) / 2 >= (xmin + xmax) / 2 || xmin - 10 < L.PAD + L.LBL
  const xc = right ? Math.min(L.W - 6, xmax + 8 + 4 * lane) : xmin - 8 - 4 * lane
  return { d: rounded([[x1, y1], [x1, ya], [xc, ya], [xc, yb], [x2, yb], [x2, y2 - EDGE_GAP]]), side: true, xc, ya, yb }
}

/** The whole picture: folded cards, positions, edges (each with the ids it links). `W` = width in px. */
export function graphOf(cards, W, { open = new Set(), keep = new Set() } = {}) {
  const shown = foldCards(cards, open, keep)
  const L = layout(shown, W)
  const edges = []
  let lane = 0
  for (const c of shown) {
    for (const p of c.parents) {
      const a = L.pos.get(p)
      const b = L.pos.get(c.id)
      if (!a || !b) continue
      const e = edgePath(L, a, b, lane)
      if (e.side) lane = (lane + 1) % 4
      edges.push({ from: p, to: c.id, d: e.d, side: e.side, guard: a.kind === 'guard', xc: e.xc ?? null, ya: e.ya ?? null, yb: e.yb ?? null })
    }
  }
  return { cards: shown, ...L, edges }
}

/** Do two boxes overlap? (touching edges do not). */
export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Every pair of nodes that overlap, as [idA, idB] (a guard is a bar: it counts too). The preview must give []. */
export function overlapping(g) {
  const ids = [...g.pos.keys()]
  const bad = []
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (overlaps(g.pos.get(ids[i]), g.pos.get(ids[j]))) bad.push([ids[i], ids[j]])
  return bad
}

/**
 * Side-channel edges that run through a node they do not belong to: the preview's promise is that a line never passes over a card.
 * (A direct edge stays between two rows; a side channel is a vertical line outside every card of the rows it passes.)
 */
export function edgesOverCards(g) {
  const bad = []
  for (const e of g.edges) {
    if (!e.side || e.xc == null) continue
    for (const [id, p] of g.pos) {
      if (id === e.from || id === e.to || p.kind === 'guard') continue
      if (p.x < e.xc && e.xc < p.x + p.w && p.y < e.yb && e.ya < p.y + p.h) bad.push([e.from, e.to, id])
    }
  }
  return bad
}

/* ---------- how far an edge stays from the nodes it does not belong to ---------- */

/** The cubic / line segments of a path made of `M`, `L` and `C` (what `edgePath` writes), as [p0, p1, p2, p3] (a line is a flat cubic). */
function segmentsOf(d) {
  const t = String(d).match(/[MLC]|-?\d+(?:\.\d+)?/g) || []
  const out = []
  let cur = null
  for (let i = 0; i < t.length;) {
    const c = t[i++]
    if (c === 'M') cur = [+t[i++], +t[i++]]
    else if (c === 'L') { const q = [+t[i++], +t[i++]]; out.push([cur, cur, q, q]); cur = q }
    else { const p = [cur, [+t[i++], +t[i++]], [+t[i++], +t[i++]], [+t[i++], +t[i++]]]; out.push(p); cur = p[3] }
  }
  return out
}
const bez = (p, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]) }
const distTo = (x, y, r) => Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)))

/**
 * The shortest distance, in px, between any edge and the border of any node that is not one of its two ends (a guard is a barrier an
 * edge may cross, so it only counts as an end). The ends themselves are left out within 8 px of where the edge attaches. Sampled every
 * 1/40 of each segment. `Infinity` when there is no edge. The preview promises `EDGE_CLEAR` or more.
 */
export function edgeClearance(g) {
  let worst = Infinity
  let at = null
  for (const e of g.edges) {
    for (const s of segmentsOf(e.d)) {
      for (let k = 0; k <= 40; k++) {
        const [x, y] = bez(s, k / 40)
        for (const [id, r] of g.pos) {
          if (r.kind === 'guard' && id !== e.from && id !== e.to) continue
          if (id === e.from && y <= r.y + r.h + 8) continue
          if (id === e.to && y >= r.y - 8) continue
          const d = distTo(x, y, r)
          if (d < worst) { worst = d; at = { from: e.from, to: e.to, node: id, x: Math.round(x), y: Math.round(y) } }
        }
      }
    }
  }
  return { min: worst, at }
}
