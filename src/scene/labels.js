/* Labels of the scene: what a label says and WHERE it sits. Pure: no DOM, no clock, no SDK, no React. The page measures the
   width of each label (the font and the language decide it), gives the sprites and the decor map of the scene, and applies the answer.

   One information per label: the name and the card's code (the time, the state word and the grade are in the tooltip and the Agent
   tab). Each label is PLACED, in priority order (selected > waits for you > silent > works > active, then name):
     - never on a character, never on another label, never on the dot of another agent (hard);
     - as little decor as possible (the decor map: furniture and pictures of the scene's geometry + contrasted wall details);
     - nearer to its own character than to any other (a label above the wrong head would name the wrong agent);
     - a leader line when it had to move away from its character;
     - no free spot: the label folds into its dot (colour kept); the selected one never folds.
   An island label sits on the FRONT EDGE of its rug and slides only along that edge. */
import { agentSprite } from './agent.js'
import { floorProps } from './floorprops.js'
import { DESK_Z, SEAT_Z, TD, TH2, TW2, WH, projectAt } from './constants.js'

/** What a label says: the display name and the card's code (nothing else; no state word, no time, no count). */
export function labelOf(agent, tag) {
  const out = { name: String(agent?.label || agent?.name || ''), code: tag && (tag.kind === 'working' || tag.kind === 'waiting' || tag.kind === 'stale') ? tag.ref || '' : '' }
  // the two facts a bot with several cards adds to its label, both optional so a single card reads exactly as before:
  // `more` = running cards besides the main one (the page writes « +N »), `quiet` = the label carries the sign of a silent card
  if (tag?.more) out.more = tag.more
  if (tag?.quiet?.length) out.quiet = true
  // a bot at work that also has a card blocked for the user: the label carries the « waits for you » sign beside its state
  if (tag?.wait) out.wait = true
  return out
}

/** Priority of a label when two compete (lower wins): selected, waits for you, silent, works, active, the rest. Same order as src/core/hud.js foldRank (tested). */
const RANK = { waiting: 0, stale: 1, working: 2, active: 3 }
export const labelRank = ({ selected, state }) => (selected ? -1 : RANK[state] ?? 4)

/** Size of a folded label (its dot), CSS px, border included. */
export const DOT = 15   // an 11 px state sign, 1 px of padding and the border

/* ---------- the geometry of the scene, in art pixels ---------- */

const inPoly = (pt, poly) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
function hull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo = []
  const up = []
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p) }
  for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p) }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}

/** The boxes of the characters (bubble and crystal included: two frames of the sprite), in art pixels: [{ name, state, x0, y0, x1, y1 }]. */
export function spriteBoxes(layout, opt) {
  const { ox, oy } = layout.origin
  const out = []
  const add = (a, x, y, z, facing, kind) => {
    let x0 = 99
    let x1 = -99
    let y0 = 99
    let y1 = -99
    for (const f of [0, 2]) {
      for (const k of agentSprite(a, facing, f, kind, opt).m.keys()) {
        const dx = (k & 511) - 256
        const dy = (k >> 9) - 128
        x0 = Math.min(x0, dx); x1 = Math.max(x1, dx); y0 = Math.min(y0, dy); y1 = Math.max(y1, dy)
      }
    }
    const [ax, ay] = projectAt(ox, oy, x, y, z).map(Math.round)
    out.push({ name: a.name, state: a.state, x0: ax + x0 - 2, y0: ay + y0 - 2, x1: ax + x1 + 3, y1: ay + y1 + 3 })
  }
  for (const p of layout.pods) for (const s of p.seats) if (s.agent) add(s.agent, s.x, s.y, SEAT_Z, s.row ? 'back' : 'front')
  for (const s of layout.lounge.seats) (s.kind === 'sofa' ? add(s.agent, s.x, s.y, 6, 'front', 'sofa') : add(s.agent, s.x, s.y, 7, 'back'))
  return out
}

/** Furniture and wall pictures as polygons (art pixels): the same geometry draw.js and base.js use. */
function decorHulls(layout) {
  const { ox, oy } = layout.origin
  const P = (x, y, z) => projectAt(ox, oy, x, y, z)
  const boxHull = (x, y, z, dx, dy, h) => hull([[x, y], [x + dx, y], [x + dx, y + dy], [x, y + dy]].flatMap(([a, b]) => [P(a, b, z), P(a, b, z + h)]))
  const L0 = layout.lounge.x0
  const H = [boxHull(0.2, 0.15, 0, 0.7, 0.55, 46)]
  ;(layout.furniture || []).forEach((ax, i, a) => H.push(i === 0 && a.length > 1 ? boxHull(ax - 0.65, 0.05, 0, 1.3, 0.4, 40) : boxHull(ax - 0.5, 0.05, 0, 1, 0.6, 40)))
  H.push(boxHull(L0 + 0.25, 0.05, 0, 2.3, 0.55, 28), boxHull(L0 + 2.7, 0.1, 0, 0.4, 0.4, 30))
  for (const p of layout.pods) {
    H.push(boxHull(p.x0, p.y0, 0, p.w, TD, DESK_Z + 16))
    if (p.wx0 != null) H.push([P(p.wx0 + 0.2, 0, 67), P(p.wx0 + p.ww - 0.2, 0, 67), P(p.wx0 + p.ww - 0.2, 0, 29), P(p.wx0 + 0.2, 0, 29)])
  }
  H.push(boxHull(L0 + 0.35, 1.4, 0, 3.1, 1.05, 22), boxHull(L0 + 1.1, 3.0, 0, 1.6, 0.8, 9))
  for (const s of layout.lounge.seats) if (s.kind === 'arm') H.push(boxHull(s.x - 0.35, s.y - 0.3, 0, 0.7, 0.75, 16))
  H.push(boxHull(layout.you.x - 0.6, layout.you.y - 0.35, 12, 1.2, 1.4, DESK_Z + 12), boxHull(0.2, layout.Y - 0.95, 0, 0.7, 0.7, 34))
  // the meeting table and the plants of the front of the room
  for (const f of floorProps(layout)) H.push(f.kind === 'table' ? boxHull(f.x - 0.9, f.y - 0.95, 0, 1.8, 1.9, 24) : boxHull(f.x - 0.3, f.y - 0.3, 0, 0.6, 0.6, 32))
  return H
}

/**
 * The decor map: 1 = furniture, a picture on a wall, or any contrasted detail of the walls (glazing, boards, clock, pigeon-holes).
 * `d`: the baked base's pixels (RGBA, W x H). Returns a function `frac(rect)` -> share of the rectangle (art pixels) that is decor, 0..1.
 */
export function decorMap(layout, d) {
  const { W, H, X, Y } = layout
  const { ox, oy } = layout.origin
  const P = (x, y, z) => projectAt(ox, oy, x, y, z)
  const m = new Uint8Array(W * H)
  for (const h of decorHulls(layout)) {
    const xs = h.map(p => p[0])
    const ys = h.map(p => p[1])
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(H, Math.ceil(Math.max(...ys))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(W, Math.ceil(Math.max(...xs))); x++) if (inPoly([x + 0.5, y + 0.5], h)) m[y * W + x] = 1
    }
  }
  if (d && d.length >= W * H * 4) {
    const walls = [[P(0, 0, 0), P(X, 0, 0), P(X, 0, WH), P(0, 0, WH)], [P(0, 0, 0), P(0, Y, 0), P(0, Y, WH), P(0, 0, WH)]]
    const df = (i, j) => Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2])
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = (y * W + x) * 4
        if (d[i + 3] < 200) continue
        const wi = walls.findIndex(w => inPoly([x + 0.5, y + 0.5], w))
        if (wi < 0) continue
        const u = wi === 0 ? (x + 0.5 - ox) / TW2 : -(x + 0.5 - ox) / TW2
        const z = oy + u * TH2 - y   // height on that wall
        if (z < 4 || (z > 18 && z < 24)) continue   // skirting and rail: plain wall
        let e = 0
        for (const j of [i - 4, i + 4, i - 4 * W, i + 4 * W]) if (d[j + 3] >= 200) e = Math.max(e, df(i, j))
        if (e > 90) for (let k = -1; k <= 1; k++) for (let l = -1; l <= 1; l++) m[(y + k) * W + x + l] = 1
      }
    }
  }
  return rect => {
    let n = 0
    let hit = 0
    for (let y = Math.floor(rect.y0); y < rect.y1; y += 2) {
      for (let x = Math.floor(rect.x0); x < rect.x1; x += 2) {
        n++
        const ax = Math.floor(x)
        const ay = Math.floor(y)
        if (ax >= 0 && ay >= 0 && ax < W && ay < H && m[ay * W + ax]) hit++
      }
    }
    return n ? hit / n : 0
  }
}

/* ---------- placement, in stage pixels (art pixels x scale) ---------- */

const hits = (a, b, g = 0) => a.x0 < b.x1 + g && a.x1 > b.x0 - g && a.y0 < b.y1 + g && a.y1 > b.y0 - g
const gapOf = (r, b) => Math.hypot(Math.max(b.x0 - r.x1, r.x0 - b.x1, 0), Math.max(b.y0 - r.y1, r.y0 - b.y1, 0))
/** Margin kept to the stage's edge, CSS px. */
const M = 4

/**
 * agents: [{ name, w, h, state, selected, dot }]  (w, h: the full label measured; `dot`: it is already a dot, nothing to place)
 * islands: [{ key, sizes: [{ w, h, mode }] (the label's sizes, fullest first: full, short, dot), a: [x, y] (art pixels of the point on
 *   the rug's front edge), span (art pixels of slide each way) }]
 * sprites: spriteBoxes(layout) (art pixels); frac: decorMap(...); S: scale; size: { w, h } of the stage (CSS px).
 * -> { agents: Map name -> { rect, folded, lead }, islands: Map key -> { rect, edge: { x, y } }, placed: [rect, kind, key] }
 * Same input, same answer: ties broken by name.
 */
export function placeLabels({ agents, islands = [], sprites, frac, S, size }) {
  const sp = new Map(sprites.map(s => [s.name, { x0: s.x0 * S, y0: s.y0 * S, x1: s.x1 * S, y1: s.y1 * S, name: s.name }]))
  const boxes = [...sp.values()]
  const decorFrac = r => frac({ x0: r.x0 / S, y0: r.y0 / S, x1: r.x1 / S, y1: r.y1 / S })
  const inside = r => !(r.x0 < M || r.y0 < M || r.x1 > size.w - M || r.y1 > size.h - M)
  const placed = []   // { x0, y0, x1, y1, kind, key }
  const out = { agents: new Map(), islands: new Map(), placed }
  // 1. every agent's dot is reserved first, above its head: no label (island or agent) ever covers another agent's dot, which would hide that agent's state
  const order = [...agents].sort((p, q) => labelRank(p) - labelRank(q) || String(p.name).localeCompare(String(q.name), 'en'))
  const dots = new Map()
  for (const a of order) {
    const s = sp.get(a.name)
    if (!s) continue
    const cx = (s.x0 + s.x1) / 2
    const r = { x0: cx - DOT / 2, y0: s.y0 - DOT - 2, x1: cx + DOT / 2, y1: s.y0 - 2, kind: 'dot', key: a.name }
    dots.set(a.name, r)
  }
  // 2. island labels, on the front edge of their rug: never on a character or another island; a dot in the way weighs little (it moves aside, step 2b)
  for (const it of islands) {
    // the label in its sizes, the fullest first (full, short, dot): the first that finds a clear spot is kept
    const sizes = it.sizes || [{ w: it.w, h: it.h, mode: 'full' }]
    let best = null
    for (const [vi, v] of sizes.entries()) {
      let mine = null
      // along the edge first; two neighbours too wide for their edges hang one under the other (the stem of the lower one is longer)
      for (const row of [0, 1, 2]) {
        for (const k of [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1, 1.5, -1.5]) {
          if (Math.abs(k) * TW2 > it.span + 0.01) continue
          const ax = (it.a[0] + k * TW2) * S
          const ay = (it.a[1] + k * TH2) * S
          const top = ay + 7 + row * (v.h + 4)
          const r = { x0: ax - v.w / 2, y0: top, x1: ax + v.w / 2, y1: top + v.h }
          const clear = inside(r) && !boxes.some(b => hits(r, b, 1)) && !placed.some(p => hits(r, p, 4))
          const onDots = [...dots.values()].filter(d => hits(r, d, 1)).length
          const c = (clear ? 0 : 1000) + onDots * 30 + decorFrac(r) * 40 + Math.abs(k) * 12 + row * 25
          if (!mine || c < mine.c) mine = { c, r, edge: { x: ax, y: ay }, mode: v.mode || 'full' }
        }
      }
      if (!best || mine.c < 1000 || vi === sizes.length - 1) best = best && best.c < 1000 ? best : mine
      if (best.c < 1000) break
    }
    placed.push({ ...best.r, kind: 'island', key: it.key })
    out.islands.set(it.key, { rect: best.r, edge: best.edge, mode: best.mode })
  }
  // 2b. the dots: above their head; one that an island label covers steps aside (sideways, then up), the nearest free spot first
  for (const [name, d] of dots) {
    let r = d
    if (placed.some(p => hits(d, p, 1))) {
      const step = DOT + 2
      const near = [[-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-2, 0], [2, 0], [0, -2], [-2, -1], [2, -1], [0, 1], [-1, 1], [1, 1]]
      for (const [i, j] of near) {
        const c = { ...d, x0: d.x0 + i * step, x1: d.x1 + i * step, y0: d.y0 + j * step, y1: d.y1 + j * step }
        if (!placed.some(p => hits(c, p, 1))) { r = c; break }
      }
    }
    dots.set(name, r)
    placed.push(r)
  }
  // 3. full labels, most important first
  const leadOf = (r, s, cx) => {
    const gx = Math.max(s.x0 - r.x1, r.x0 - s.x1, 0)
    const gy = Math.max(s.y0 - r.y1, r.y0 - s.y1, 0)
    if (gx <= 3 && gy <= 5) return null
    const px = Math.min(Math.max(cx, r.x0 + 6), r.x1 - 6)
    const py = r.y1 <= s.y0 ? r.y1 : r.y0 >= s.y1 ? r.y0 : (r.y0 + r.y1) / 2
    const qx = r.x1 <= s.x0 ? s.x0 + 2 : r.x0 >= s.x1 ? s.x1 - 2 : cx
    const qy = r.y1 <= s.y0 ? s.y0 + 2 : r.y0 >= s.y1 ? s.y1 - 2 : (s.y0 + s.y1) / 2
    return { x1: px, y1: py, x2: qx, y2: qy }
  }
  for (const a of order) {
    const s = sp.get(a.name)
    if (!s) continue
    const dot = dots.get(a.name)
    if (a.dot) { out.agents.set(a.name, { rect: dot, folded: true, lead: null }); continue }
    const cx = (s.x0 + s.x1) / 2
    const { w, h } = a
    const C = []
    for (let g = 2; g <= 50; g += 4) for (let dx = -w; dx <= w; dx += 8) C.push([cx - w / 2 + dx, s.y0 - g - h])
    for (let dy = -4; dy <= 36; dy += 4) C.push([s.x0 - 4 - w, s.y0 + dy], [s.x1 + 4, s.y0 + dy])
    for (let g = 2; g <= 22; g += 4) for (let dx = -w / 2; dx <= w / 2; dx += 8) C.push([cx - w / 2 + dx, s.y1 + g])
    let best = null
    for (const [lx, ly] of C) {
      const r = { x0: lx, y0: ly, x1: lx + w, y1: ly + h }
      const own = gapOf(r, s)
      const clear = inside(r) && !boxes.some(b => hits(r, b, 1)) && !placed.some(p => p !== dot && hits(r, p, 4))
      const amb = boxes.some(o => o !== s && gapOf(r, o) < own + 6)
      const c = (clear ? 0 : 1000) + (amb ? 300 : 0) + decorFrac(r) * 100 + Math.hypot(lx + w / 2 - cx, ly + h / 2 - s.y0) * 0.45
      if (!best || c < best.c) best = { c, r, clear, amb }
    }
    // a spot that covers something, or names the wrong head, is no spot: the label folds (the selected one never does)
    if (best && ((best.clear && !best.amb) || a.selected)) {
      const i = placed.indexOf(dot)
      if (i >= 0) placed.splice(i, 1)
      placed.push({ ...best.r, kind: 'agent', key: a.name })
      out.agents.set(a.name, { rect: best.r, folded: false, lead: leadOf(best.r, s, cx) })
    } else out.agents.set(a.name, { rect: dot, folded: true, lead: null })
  }
  return out
}

/** Rectangles that overlap, as pairs of keys (gap 0): the check of the tests and of the probe. Dots count as labels. */
export function overlappingPairs(rects) {
  const bad = []
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rects[i].kind === 'dot' && rects[j].kind === 'dot') continue   // two dots are two colours, not two texts
      if (hits(rects[i], rects[j], 0)) bad.push([rects[i].key, rects[j].key])
    }
  }
  return bad
}

/** The labels that sit on a character (any), as [labelKey, characterName]. */
export function onCharacters(rects, sprites, S) {
  const bad = []
  for (const r of rects) {
    if (r.kind === 'dot') continue
    for (const s of sprites) if (hits(r, { x0: s.x0 * S, y0: s.y0 * S, x1: s.x1 * S, y1: s.y1 * S }, 0)) bad.push([r.key, s.name])
  }
  return bad
}
