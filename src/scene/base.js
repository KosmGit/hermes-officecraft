/* Static base layer: floor, walls, glazing (day / night), whiteboards, decals, rugs, contact shadows and the baked light.
   Everything drawn maps to a backend fact: whiteboard notes = that board's real card counts, clock = the snapshot's time. */
import { hslc, hx, mixc, mulc } from './color.js'
import { CAP, SLAB, TD, TH2, TW2, WH } from './constants.js'
import { floorProps } from './floorprops.js'
import { PAL } from './palette.js'
import { Px, shadow } from './raster.js'
import { CLOCK_Z, clockS, onTick } from './clock.js'
import { hash } from './util.js'
import { incidentBoardsOf, isLit } from './model.js'
import { posterShader, posterSlots } from './art.js'
import { floorColor, floorOf, setStyle, viewColor, viewOf } from './style.js'

function paneColor(s, z, s0, s1, z0, z1, night, view = 'park') {
  const fr = PAL.frame
  const u = s - s0
  const v = z - z0
  const Wd = s1 - s0
  const Hd = z1 - z0
  if (u < 1.5 || u > Wd - 1.5 || v < 1.5 || v > Hd - 1.5) return fr
  if (Math.abs(u - Wd / 2) < 0.8 || Math.abs(v - Hd * 0.62) < 0.6) return fr
  // the glazing looks out on the park drawn around the building (lawn, its trees, the sky); the decorator's view only
  // changes the far distance (src/scene/outdoor.js).
  return viewColor(view, s, v, Hd, night) || viewColor('park', s, v, Hd, night)
}

/** A board's whiteboard: one column of sticky notes per kind of card, one note per real card (a full column ends with a "+"). */
export function whiteboard(p, TW = TW2) {
  const s0 = (p.wx0 + 0.2) * TW
  const s1 = (p.wx0 + p.ww - 0.2) * TW
  const z0 = 30
  const z1 = 66
  const c = p.b.counts || {}
  const cols = [
    ['todo', (c.todo || 0) + (c.ready || 0) + (c.triage || 0) + (c.scheduled || 0)],
    ['run', (c.running || 0) + (c.review || 0)],
    ['blocked', c.blocked || 0],
    ['done', c.done || 0]
  ]
  const cw = (s1 - s0 - 4) / 4
  const per = Math.max(1, Math.floor((cw - 1) / 5))
  const cap = per * 5
  return {
    s0, s1, z0, z1,
    f: (s, z) => {
      const u = s - s0
      const v = z1 - z
      if (u < 1.5 || u > s1 - s0 - 1.5 || v < 1.5 || v > z1 - z0 - 1.5) return PAL.wbFrame
      const ci = Math.max(0, Math.min(3, Math.floor((u - 2) / cw)))
      const cu = u - 2 - ci * cw
      if (ci > 0 && cu < 0.6) return PAL.wbLine
      if (v < 5.5 && v > 3 && cu > 1 && cu < cw - 1.5) return PAL.note[cols[ci][0]]
      const n = Math.min(cols[ci][1], cap)
      const r = Math.floor((v - 8) / 5)
      const k = Math.floor((cu - 1) / 5)
      if (v >= 8 && r < 5 && k < per && (v - 8) % 5 < 4 && (cu - 1) % 5 < 4 && r * per + k < n) {
        // a full column says so: its last note becomes a "+" (more cards than the column can show)
        if (cols[ci][1] > cap && r * per + k === cap - 1) {
          const a = (v - 8) % 5
          const b = (cu - 1) % 5
          return (a >= 1.4 && a < 2.6) || (b >= 1.4 && b < 2.6) ? PAL.wbLine : PAL.note[cols[ci][0]]
        }
        if (cols[ci][0] === 'blocked' && (v - 8) % 5 < 1.2 && (cu - 1) % 5 > 1.2 && (cu - 1) % 5 < 2.6) return hx('#d23c2a')
        return PAL.note[cols[ci][0]]
      }
      return PAL.wb
    }
  }
}

const GLYPH = { 1: ['010', '110', '010', '010', '111'], 0: ['111', '101', '101', '101', '111'] }
/** Gold plaque ("100") beside the whiteboard of a board with 100 cards done. */
function plaque(s0, z0) {
  return {
    s0, s1: s0 + 17, z0, z1: z0 + 11,
    f: (s, z) => {
      const u = s - s0
      const v = z0 + 11 - z
      if (u < 1 || u > 16 || v < 1 || v > 10) return hx('#7a5a1a')
      const gx = Math.floor(u - 3)
      const gy = Math.floor(v - 3)
      const ch = '100'[Math.floor(gx / 4)]
      const col = gx % 4
      if (ch && gy >= 0 && gy < 5 && col < 3 && GLYPH[ch][gy][col] === '1') return hx('#6b4a12')
      return (u + v) % 7 < 1 ? hx('#ffe7a0') : hx('#e2b84a')
    }
  }
}

/** Wall clock face (rim, ticks, centre dot). The hands are not baked: src/scene/clock.js draws them per frame. */
function clockDecal(sc, zc) {
  return {
    s0: sc - 11, s1: sc + 11, z0: zc - 11, z1: zc + 11,
    f: (s, z) => {
      const u = s - sc
      const v = z - zc
      const r = Math.hypot(u, v)
      if (r > 10.5) return null
      if (r > 8.8) return hx('#3a3f4b')
      if (r > 8 && r <= 8.8) return hx('#c9ccd2')
      if (onTick(u, v)) return hx('#3a3f4b')
      if (r < 1.2) return hx('#d9644c')
      return hx('#f7f5f0')
    }
  }
}

/* The second art pass (lighting, depth, a quieter floor, a real night). All of it is behind `!model.classic`. */
export const NIGHT_AMBIENT = Object.freeze([0.27, 0.3, 0.47])
export const BACK_SHADE = 0.88
/** The patch of light a bay throws on the floor: how far from the wall (tiles), its shear, its tint and strength in three steps. */
const SUN = { reach: 4.2, shear: 0.45, day: [255, 236, 176], dayA: [0.6, 0.42, 0.24], moon: [150, 190, 255], moonA: [0.5, 0.34, 0.18] }
const shadeOf = (c, k) => (k === 1 ? c : mulc(c, k))

export function buildBase(layout, model) {
  const { X, Y, W, H, pods, lounge } = layout
  const { ox, oy } = layout.origin
  const night = !!model.night
  const art = !model.classic   // the second art pass (see NIGHT_AMBIENT above); false = the first art direction, kept pixel for pixel
  const decor = model.decor
  setStyle(decor.style || null)   // the decorator's fiche (null = the default office): PAL says what the style says before anything is drawn
  const concrete = floorOf(decor.style) === 'concrete'
  const view = viewOf(decor.style)
  const px = new Px(W, H, ox, oy)
  const P = (x, y, z) => px.P(x, y, z)
  // lights
  const lights = []
  // no lamp object: the night keeps its ambient pools of warm light over each island and the common room (no source drawn)
  const lamp = (lx, ly) => { const [x, y] = P(lx, ly, 10); lights.push({ x, y, rx: 92, ry: 50, p: night ? (art ? 0.78 : 0.95) : 0.12, c: [1, 0.82, 0.55] }) }
  pods.forEach(p => lamp(p.x0 + p.w / 2, p.y0 + TD / 2))
  lamp(lounge.x0 + 2, 3)
  if (night) {
    for (const p of pods) {
      for (const s of p.seats) {
        if (s.agent && s.row === 1 && isLit(s.agent.state)) {
          const [x, y] = P(s.x + 0.5, p.y0 + TD / 2 + 0.3, 20)
          lights.push({ x, y, rx: 30, ry: 22, p: s.agent.state === 'working' ? 0.9 : 0.45, c: s.agent.state === 'waiting' ? [1, 0.7, 0.3] : [0.35, 0.75, 1] })
        }
      }
    }
    for (const p of pods) {
      for (const s of p.seats) {
        if (s.agent && s.row === 0 && isLit(s.agent.state)) {
          const [x, y] = P(s.x, s.y + 0.4, 22)
          lights.push({ x, y, rx: 22, ry: 18, p: s.agent.state === 'working' ? 0.75 : 0.35, c: s.agent.state === 'waiting' ? [1, 0.7, 0.3] : [0.35, 0.75, 1] })
        }
      }
    }
  }
  const inc = incidentBoardsOf(decor)
  for (const p of pods) {
    if (inc.includes(p.b.slug)) {
      const [x, y] = P(p.x0 + p.w / 2, p.y0 + TD / 2, 20)
      lights.push({ x, y, rx: 110, ry: 64, p: night ? 0.9 : 0.28, c: [1, 0.15, 0.1] })
    }
  }
  // a real night (the lit screens and the pools of warm light carry the picture)
  const amb = night ? (art ? NIGHT_AMBIENT : [0.33, 0.37, 0.56]) : [1, 0.99, 0.965]
  px.light(inc.length ? (night ? [amb[0] * 1.02, amb[1] * 0.72, amb[2] * 0.72] : [amb[0], amb[1] * 0.9, amb[2] * 0.9]) : amb, lights, !art)
  const wins = []
  // no glazing behind the trophy cabinet (it stands against the left wall when the room is not sober, draw.js): a cabinet
  // standing in front of the glass, the frame showing above its shelves, read as furniture pushed against a bay
  const cab = decor.sober ? null : [layout.cabinetY - 0.8, layout.cabinetY + 0.8]
  for (let y = 0.8; y + 1.8 <= Y - 0.5; y += 2.4) if (!cab || y >= cab[1] || y + 1.8 <= cab[0]) wins.push([y * TW2, (y + 1.8) * TW2])
  // slab
  px.poly([P(0, Y, 0), P(X, Y, 0), P(X, Y, -SLAB), P(0, Y, -SLAB)], PAL.slabL)
  px.poly([P(X, 0, 0), P(X, Y, 0), P(X, Y, -SLAB), P(X, 0, -SLAB)], PAL.slabR)
  // floor. The boards step back (a fifth less colour, a third less contrast between boards, a softer seam): an orange parquet
  // fights the skin tones and the desks for the eye
  const mean = [0, 1, 2].map(i => (PAL.plank[0][i] + PAL.plank[1][i] + PAL.plank[2][i] + PAL.plank[3][i]) / 4)
  const calm = c => { const m = mixc(c, mean, 0.34); const g = m[0] * 0.3 + m[1] * 0.59 + m[2] * 0.11; return mixc(m, [g, g, g], 0.2) }
  const planks = art && !concrete ? PAL.plank.map(calm) : PAL.plank
  const seam = art && !concrete ? mixc(PAL.seam, calm(mean), 0.4) : PAL.seam
  px.poly([P(0, 0), P(X, 0), P(X, Y), P(0, Y)], (sx, sy) => {
    const a = (sx - ox) / TW2
    const b = (sy - oy) / TH2
    const u = (a + b) / 2
    const v = (b - a) / 2
    const row = Math.floor(v * 4)
    const off = (hash('r' + row) % 100) / 50
    const seg = Math.floor((u + off) / 2.2)
    let c = planks[hash(row + ':' + seg) % 4]
    if (v * 4 - row < 0.24 || ((u + off) / 2.2 - seg) < 0.03) c = seam
    else if (hash(Math.floor(u * 9) + '/' + row) % 7 === 0) c = mulc(c, 0.95)
    if (concrete) c = floorColor(u, v)
    let k = 1
    if (art) {
      // the walls stand ON the floor: two hard bands of shade at their foot
      const e = Math.min(u, v)
      if (e < 0.16) k = 0.74
      else if (e < 0.42) k = 0.88
      // each bay throws its patch of light on the floor, sheared away from the wall: warm sun by day, cold moon by night.
      // Three hard steps as it runs out, the bay's mullion as a bar of shade in the middle; a tint, not a change of brightness.
      for (const [w0, w1] of wins) {
        const y0 = w0 / TW2 + 0.5 + u * SUN.shear
        const y1 = w1 / TW2 + 0.5 + u * SUN.shear
        if (u >= SUN.reach || v <= y0 || v >= y1) continue
        if (Math.abs(v - (y0 + y1) / 2) < 0.07) continue
        const step = Math.min(2, Math.floor(u / (SUN.reach / 3)))
        return mixc(mulc(c, k * (night ? 1.45 : 1.14)), night ? SUN.moon : SUN.day, (night ? SUN.moonA : SUN.dayA)[step])
      }
      return mulc(c, k)
    }
    if (u < 0.35 || v < 0.35) k *= 0.82 + 0.18 * Math.min(u, v) / 0.35
    for (const [w0, w1] of wins) {
      const y0 = w0 / TW2 + 0.5 + u * 0.45
      const y1 = w1 / TW2 + 0.5 + u * 0.45
      if (u < 3.2 && v > y0 && v < y1) k *= night ? 1.06 : 1.13
    }
    return mulc(c, k)
  })
  // left wall (plane x=0), seen from +x
  const leftShade = (sx, sy) => {
    const s = -(sx - ox)
    const z = oy + s / 2 - sy
    for (const [w0, w1] of wins) if (s > w0 && s < w1 && z > 24 && z < 66) return paneColor(s, z, w0, w1, 24, 66, night, view)
    for (const [w0, w1] of wins) if (s > w0 - 1 && s < w1 + 1 && z > 21 && z <= 24) return PAL.sill
    // the corner where the two walls meet is in shade (two steps), and so is the top of the wall under its cap
    const k = !art ? 1 : (s < 3 ? 0.86 : s < 8 ? 0.94 : 1) * (z > WH - 2 ? 0.9 : 1)
    if (z < 3) return shadeOf(PAL.base, k)
    if (z < 22) return shadeOf(z > 20 ? PAL.rail : PAL.wainL, k)
    return shadeOf(PAL.wallL, k)
  }
  px.poly([P(0, 0, 0), P(0, Y, 0), P(0, Y, WH), P(0, 0, WH)], leftShade)
  // back wall (plane y=0) with decals
  const decals = []
  const centurions = decor.sober ? [] : decor.centurions
  pods.forEach(p => {
    const wb = whiteboard(p)
    decals.push(wb)
    if (centurions.includes(p.b.slug)) decals.push(plaque(wb.s1 + 4, 40))
  })
  const dx0 = lounge.x0 + 3.25
  decals.push({
    s0: dx0 * TW2, s1: (dx0 + 0.85) * TW2, z0: 0, z1: 52,
    f: (s, z, d) => {
      const u = s - d.s0
      const v = z
      if (u < 1.6 || u > d.s1 - d.s0 - 1.6 || v > 50.4) return hx('#5d4636')
      if (Math.abs(u - (d.s1 - d.s0) * 0.78) < 1 && Math.abs(v - 24) < 1.2) return hx('#e8c46a')
      return (Math.floor(v) % 12 === 0 || Math.abs(u - 3) < 0.5 || Math.abs(u - (d.s1 - d.s0) + 3) < 0.5) ? hx('#9b6a44') : hx('#b07a4c')
    }
  })
  decals.push(clockDecal(clockS(layout), CLOCK_Z))
  // wall art: a poster per real milestone (gilded frame, the model's motif and colours) takes the slots, newest first; with none
  // (function off, sober, nothing celebrated yet) the room keeps its generic poster
  const posters = decor.sober ? [] : decor.posters || []
  if (posters.length) {
    const slots = posterSlots(layout)
    posters.slice(0, slots.length).forEach((p, i) => decals.push({ ...slots[i], f: posterShader(p) }))
  } else {
    // a framed print (wood frame, cream mat, a landscape: hills, sky, a sun), so it does not read
    // as a pane of glass or a screen sitting on the server rack. The picture a real milestone's poster replaces.
    decals.push({
      s0: 0.15 * TW2, s1: 1.15 * TW2, z0: 50, z1: 70,
      f: (s, z, d) => {
        const u = s - d.s0
        const v = z - d.z0
        const W = d.s1 - d.s0
        if (u < 1 || u > W - 1 || v < 1 || v > 19) return v > 18 || u < 2 ? hx('#9b6b43') : hx('#7c5434')   // frame, lit from the upper left
        if (u < 3 || u > W - 3 || v < 3 || v > 17) return hx('#efe6d2')   // mat
        const x = u - 3
        const y = v - 3   // 0 at the bottom of the picture
        if (Math.hypot(x - 7.5, y - 10.5) < 1.8) return hx('#f2c24f')
        if (y < 3 + 2.5 * Math.sin(x * 0.45 + 0.6)) return hx('#5f9d4f')
        if (y < 5 + 2 * Math.sin(x * 0.3 + 2.2)) return hx('#8cbf73')
        return mixc(hx('#d8ecf4'), hx('#9fcbe6'), y / 14)
      }
    })
  }
  const backShade = (sx, sy) => {
    const s = sx - ox
    const z = oy + s / 2 - sy
    for (const d of decals) {
      if (s >= d.s0 && s < d.s1 && z >= d.z0 && z < d.z1) { const c = d.f(s, z, d); if (c) return c }
    }
    // one light, from the glazing on the left: the back wall is the wall in shade (12 % under the left one), darker again in the
    // corner and under the cap. What hangs on it (boards, posters, the clock) keeps its own colours.
    const k = !art ? 1 : BACK_SHADE * (s < 3 ? 0.86 : s < 8 ? 0.94 : 1) * (z > WH - 2 ? 0.9 : 1)
    if (z < 3) return shadeOf(PAL.base, k)
    if (z < 22) return shadeOf(z > 20 ? PAL.rail : PAL.wainB, k)
    return shadeOf(PAL.wallB, k)
  }
  px.poly([P(0, 0, 0), P(X, 0, 0), P(X, 0, WH), P(0, 0, WH)], backShade)
  // wall caps (cut-away thickness)
  px.poly([P(-CAP, -CAP, WH), P(X, -CAP, WH), P(X, 0, WH), P(0, 0, WH), P(0, Y, WH), P(-CAP, Y, WH)], PAL.cap)
  px.poly([P(X, -CAP, WH), P(X, 0, WH), P(X, 0, -SLAB), P(X, -CAP, -SLAB)], PAL.capEdge)
  px.poly([P(-CAP, Y, WH), P(0, Y, WH), P(0, Y, -SLAB), P(-CAP, Y, -SLAB)], mulc(PAL.capEdge, 1.25))
  // rugs
  const rug = (x0, y0, w, d, h) => px.poly([P(x0, y0), P(x0 + w, y0), P(x0 + w, y0 + d), P(x0, y0 + d)], (sx, sy) => {
    const a = (sx - ox) / TW2
    const b = (sy - oy) / TH2
    const u = (a + b) / 2 - x0
    const v = (b - a) / 2 - y0
    const e = Math.min(u, v, w - u, d - v)
    if (e < 0.12) return hslc(h, 30, 40)
    if (e < 0.2) return hslc(h, 28, 72)
    return ((Math.floor(u * 6) + Math.floor(v * 6)) % 2) ? hslc(h, 32, 58) : hslc(h, 32, 55)
  })
  pods.forEach(p => rug(p.x0 - 0.45, p.y0 - 1.2, p.w + 0.9, TD + 2.4, p.hue))
  rug(lounge.x0 + 0.3, 1.6, 3.4, 3.6, 30)
  // contact shadows
  // darker under what stands on the floor (desks 0.66, chairs 0.7), and thrown away from the glazing
  pods.forEach(p => {
    shadow(px, p.x0 + (art ? 0.22 : 0.1), p.y0 + 0.15, p.w, TD, art ? 0.66 : 0.78)
    p.seats.forEach(s => shadow(px, s.x - (art ? 0.26 : 0.32), s.y - 0.28, 0.66, 0.62, art ? 0.7 : 0.8))
  })
  shadow(px, lounge.x0 + (art ? 0.62 : 0.5), 1.45, 2.8, 0.95, art ? 0.66 : 0.75)
  if (art) for (const f of floorProps(layout)) (f.kind === 'table' ? shadow(px, f.x - 0.78, f.y - 0.45, 1.8, 1.0, 0.68) : shadow(px, f.x - 0.2, f.y - 0.3, 0.6, 0.6, 0.72))
  return { W, H, d: px.d, L: px.L }
}
