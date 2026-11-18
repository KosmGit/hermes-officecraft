/* Room layout: one pod per board, sized by its members, rows chosen for a pleasant aspect;
   agents without a board sit in the common room. Works from 0 to 30 agents and 0 to 8 boards (and beyond). */
import { CAP, SEAT_Z, SLAB, SW, TD, TW2, TH2, TY, WH, projectAt } from './constants.js'
import { seatOrder } from './seating.js'
import { hueOfSlug, projectRanks } from './projects.js'

const localeName = (p, q) => p.name.localeCompare(q.name, 'en')

export function layoutScene(model) {
  const agents = model.agents || []
  const boards = model.boards || []
  const known = new Set(boards.map(b => b.slug))
  // 1. one pod per board, sized by its members
  const pods = []
  const ranks = projectRanks(boards)   // an island's hue is its board's creation rank (8 fixed hues), the same as every project chip of the interface
  for (const b of boards) {
    const members = seatOrder(agents.filter(a => a.home === b.slug).sort(localeName), model.seating)   // seating: by name unless the user chose hand-offs or a model order
    const n = Math.max(2, members.length)
    const cols = Math.ceil(n / 2)
    const w = Math.max(2.6, cols * SW)
    pods.push({ b, w, n, cols, members, hue: hueOfSlug(b.slug, ranks) })
  }
  // 2. rows of pods: keep the room close to a pleasant aspect whatever the number of boards (1 row for a small setup)
  const GAP = 1.7
  const PITCH = TD + 3.6
  const LOUNGE_W = 4.4 + 2.4 + 0.4
  const pack = r => {
    const target = pods.reduce((s, p) => s + p.w + GAP, 0) / r
    const rows = [[]]
    let acc = 0
    for (const p of pods) {
      if (acc > 0 && acc + p.w / 2 > target && rows.length < r) { rows.push([]); acc = 0 }
      rows[rows.length - 1].push(p)
      acc += p.w + GAP
    }
    return rows
  }
  let rows = pack(1)
  let bestScore = Infinity
  for (let r = 1; r <= Math.min(4, pods.length); r++) {
    const rs = pack(r)
    const wide = Math.max(...rs.map(row => row.reduce((s, p) => s + p.w + GAP, GAP))) + LOUNGE_W
    const deep = TY + (rs.length - 1) * PITCH + TD + 1.9
    const score = Math.abs(Math.log(wide / deep / 2.6)) + (r - 1) * 0.12   // slight preference for fewer rows
    if (score < bestScore) { bestScore = score; rows = rs }
  }
  rows.forEach((row, ri) => {
    let x = GAP
    const y0 = TY + ri * PITCH
    for (const p of row) {
      p.x0 = x; p.y0 = p.yc = y0; p.row = ri; p.seats = []
      for (let i = 0; i < p.n; i++) {
        const sr = i < p.cols ? 0 : 1
        const col = sr ? i - p.cols : i
        const sx = x + (p.w - p.cols * SW) / 2 + col * SW + SW / 2
        p.seats.push({ row: sr, x: sx, y: sr ? y0 + TD + 0.5 : y0 - 0.5, agent: p.members[i] || null })
      }
      x += p.w + GAP
    }
  })
  const ordered = rows.flat()
  const podsEnd = Math.max(GAP, ...rows.map(row => row.reduce((s, p) => s + p.w + GAP, GAP)))
  // whiteboards: one per board on the back wall, spread evenly when there are several rows
  const wallFrom = 1.3
  const wallTo = podsEnd - 0.6
  const slot = (wallTo - wallFrom) / Math.max(1, ordered.length)
  // back-wall furniture (bookshelf, plants, trophy cabinet) goes in the gaps BETWEEN whiteboards, never in front of one
  const furniture = []
  ordered.forEach((p, i) => {
    if (rows.length === 1) { p.wx0 = p.x0; p.ww = p.w; furniture.push(p.x0 + p.w + 0.85); return }
    const roomy = slot >= 3.1
    p.wx0 = wallFrom + i * slot
    p.ww = Math.min(slot - (roomy ? 1.6 : 0.25), 4.5)
    if (roomy && i < ordered.length - 1) furniture.push(p.wx0 + p.ww + (slot - p.ww) / 2)
  })
  // 3. common room: sofa for 3, then armchairs in rows of 3 (an agent whose board is not in the list sits here too)
  const hall = agents.filter(a => !a.home || !known.has(a.home))
  const L0 = podsEnd - 0.4
  const lw = 4.4
  const lounge = { x0: L0, w: lw, seats: [] }
  hall.forEach((a, i) => {
    if (i < 3) lounge.seats.push({ kind: 'sofa', x: L0 + 1.1 + i * 0.8, y: 1.95, agent: a })
    else { const k = i - 3; lounge.seats.push({ kind: 'arm', x: L0 + 0.9 + (k % 3) * 1.1, y: 4.1 + Math.floor(k / 3) * 1.25, agent: a }) }
  })
  const armRows = Math.ceil(Math.max(0, hall.length - 3) / 3)
  const X = L0 + lw + 2.4
  const Y = Math.max(TY + (rows.length - 1) * PITCH + TD + 1.9, armRows ? 4.1 + (armRows - 1) * 1.25 + 1.4 : 0, TY + TD + 1.9)
  lounge.you = { x: L0 + lw + 1.35, y: 2.6 }
  const ox = Math.ceil((Y + CAP) * TW2) + 10
  const oy = WH + 46
  const W = Math.ceil(ox + (X + CAP) * TW2) + 10
  const H = Math.ceil(oy + (X + Y) * TH2 + SLAB) + 6
  return { W, H, pods: ordered, lounge, rows: rows.length, furniture, cabinetY: Math.max(4, Y - 2.2), X, Y, you: lounge.you, origin: { ox, oy } }
}

/** Tile coordinates -> art pixels of this layout (to place the HUD over the canvas). */
export function project(layout, x, y, z = 0) {
  return projectAt(layout.origin.ox, layout.origin.oy, x, y, z)
}

/** Every placed agent: where its label hangs (art pixels), on which side, in which pod (null = common room). */
export function anchors(layout) {
  const out = []
  for (const p of layout.pods) {
    for (const s of p.seats) {
      if (!s.agent) continue
      const [sx, sy] = project(layout, s.x, s.y, SEAT_Z)
      out.push({ name: s.agent.name, sx, sy, below: s.row === 1, pod: p.b.slug })
    }
  }
  for (const s of layout.lounge.seats) {
    const [sx, sy] = project(layout, s.x, s.y, 7)
    out.push({ name: s.agent.name, sx, sy, below: s.kind === 'arm', pod: null })
  }
  return out
}

/** One label spot per board island (below its desks). */
export function boardAnchors(layout) {
  return layout.pods.map(p => {
    const [sx, sy] = project(layout, p.x0 + p.w / 2, p.y0 + TD + 1.2, 0)
    return { slug: p.b.slug, sx, sy }
  })
}
