/* The ground around the room. The room is a diamond in a rectangle: its four corners and the frame around it
   would be bare. This layer paints what is outside the room, in the same pixel art and the same light: grass, a paved walk with two
   paths leading out, the shadow the slab casts, trees and bushes, flowers, and at night the light that spills from the open room and
   from two lamp posts. It is NOT part of drawScene (the room's own pixels, the postcard and its pixel-for-pixel tests do not change):
   the page stacks it under the room canvas, aligned on the same art-pixel grid, and it fills the whole frame.
   Pure: no DOM, no clock, no random (a hash of the tile: same model, same pixels). Opaque everywhere. */
import { BAYER, band, hx } from './color.js'
import { SLAB, TH2, TW2 } from './constants.js'
import { BARK, BARK_D, BLADE, BLADE_L, DAY_AMB, GRASS, LEAF, NIGHT_AMB } from './outdoor.js'

/** The backdrop is sized in steps of this many art pixels, so a pane being resized rebuilds it rarely. */
export const BACKDROP_STEP = 16
/** The padding of the frame (.oc-box: 8 8 4 8 in CSS px), which the ground also fills. left, right, top, bottom. */
export const FRAME_PAD = [8, 8, 8, 4]

/**
 * Art pixels of ground to add on each side of the room canvas so that the ground reaches the edge of the frame.
 * availW / availH: the content box of the frame, in CSS px; W / H: the room canvas in art pixels; S: the view scale.
 * shift: the CSS px the room is lifted above its centred place (0 when it is not lifted).
 * The room is centred in the frame (margin auto), the free space is split in two.
 */
export function bleedOf({ availW, availH, W, H, S, pad = FRAME_PAD, step = BACKDROP_STEP, shift = 0 }) {
  const up = css => Math.ceil((Math.max(0, css) + S) / S / step) * step
  const fx = Math.max(0, availW - W * S) / 2
  const fy = Math.max(0, availH - H * S) / 2
  // the room may be lifted by `shift` CSS px (src/scene/fit.js liftOf): the ground then reaches that much further below it
  return { l: up(fx + pad[0]), r: up(fx + pad[1]), t: up(fy + pad[2]), b: up(fy + shift + pad[3]) }
}

// the lawn, the bark and the leaves are the ones the glazing shows (src/scene/outdoor.js): one outdoor world
const STONE = ['#cfc5b3', '#c3b8a5', '#d6ccba'].map(hx)
const GROUT = hx('#9c917f')
const FLOWER = ['#f6ecb0', '#f3a9bd', '#ffffff', '#f2c24f'].map(hx)
const BUSH = ['#3d7a41', '#4a8443', '#5c9a4e', '#74b35c'].map(hx)
const POLE = hx('#3a3f4b')
const POLE_L = hx('#5b6270')
const LAMP = hx('#ffe9b0')

/** 0..1 from two (three) integers: same input, same value (never a random generator). */
function ih(a, b, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Steps of a pool of light on the ground, from nothing to full. */
export const LAMP_BANDS = 4

export function buildBackdrop(layout, { night = false, bleed }) {
  const { X, Y } = layout
  const w = bleed.l + layout.W + bleed.r
  const h = bleed.t + layout.H + bleed.b
  const OX = bleed.l + layout.origin.ox
  const OY = bleed.t + layout.origin.oy + SLAB   // the ground lies one slab below the floor
  const d = new Uint8ClampedArray(w * h * 4)
  const tileOf = (px, py) => { const a = (px - OX) / TW2; const b = (py - OY) / TH2; return [(a + b) / 2, (b - a) / 2] }
  const screenOf = (x, y) => [OX + (x - y) * TW2, OY + (x + y) * TH2]

  // where the paths leave the walk, and the two lamp posts
  const px0 = Math.max(1.4, Math.min(X - 1.4, layout.lounge.x0 + 1.2))
  const py0 = Math.max(1.4, Math.min(Y - 1.4, Y * 0.45))
  // the lamp posts flank each path (they light the entrances at night)
  // 3.4 tiles out along each path, so the whole post stands clear of the room canvas painted over this layer (closer, the slab
  // hid its upper part and the stub left under it read as a stilt)
  const posts = [{ x: px0 - 1.15, y: Y + 3.4 }, { x: px0 + 1.15, y: Y + 3.4 }, { x: X + 3.4, y: py0 - 1.15 }, { x: X + 3.4, y: py0 + 1.15 }]
  // light: ambient + soft ellipses (lamp pools), quantised through the same Bayer matrix as the room's light. At night the room, open on
  // its two front faces, also spills its own warm light onto the walk (the same warm tone as its lamps).
  const amb = night ? NIGHT_AMB : DAY_AMB
  const lights = []
  // amber pools in three hard bands (LAMP_BANDS): smooth gradients of a pale yellow turn the lawn a milky green and would be
  // the only soft blur of the picture, in a scene drawn in flat steps.
  if (night) for (const p of posts) lights.push({ x: p.x, y: p.y, rx: 2.5, ry: 2.5, p: 0.9, c: [1, 0.48, 0.16] })
  /** Light at tile (x, y). With the pixel (bx, by), what is added to the ambient is snapped to LAMP_BANDS steps (the ground); without, exact. */
  const lightAt = (x, y, out, bx, by) => {
    let r = 0; let g = 0; let b = 0
    if (night && (x > X || y > Y)) {
      const dx = x > X ? x - X : 0; const dy = y > Y ? y - Y : 0
      // the room is the lantern of the park: its light reaches 3.6 tiles out, strong and amber
      const q = 1 - Math.hypot(dx, dy) / 3.6
      if (q > 0 && x > -0.5 && y > -0.5) { const f = q * q * 0.62; r += f; g += f * 0.74; b += f * 0.4 }
    }
    for (const l of lights) {
      const dx = (x - l.x) / l.rx; const dy = (y - l.y) / l.ry
      const q = 1 - dx * dx - dy * dy
      if (q > 0) { const f = q * q * l.p; r += l.c[0] * f; g += l.c[1] * f; b += l.c[2] * f }
    }
    const m = Math.max(r, g, b)
    const k = m > 0 && bx != null ? band(Math.sqrt(Math.min(1, m)), LAMP_BANDS, bx, by, 0) ** 2 / Math.min(1, m) : 1
    out[0] = amb[0] + r * k; out[1] = amb[1] + g * k; out[2] = amb[2] + b * k
  }
  const L = [0, 0, 0]
  const put = (px, py, c, k) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return
    const j = (py * w + px) * 4
    d[j] = c[0] * k[0]; d[j + 1] = c[1] * k[1]; d[j + 2] = c[2] * k[2]; d[j + 3] = 255
  }
  const dim = (px, py, k) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return
    const j = (py * w + px) * 4
    d[j] *= k; d[j + 1] *= k; d[j + 2] *= k
  }

  // ground: grass, the paved walk along the two front faces, two paths, the slab's shadow
  const ring = 1.75
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const [x, y] = tileOf(px + 0.5, py + 0.5)
      const dx = x < 0 ? -x : x > X ? x - X : 0
      const dy = y < 0 ? -y : y > Y ? y - Y : 0
      const dist = Math.hypot(dx, dy)
      const front = x > X || y > Y
      const tx = Math.floor(x); const ty = Math.floor(y)
      const jit = ih(Math.floor(x * 4), Math.floor(y * 4))
      const pathA = y > Y && Math.abs(x - px0) < 0.9 - 0.14 * jit
      const pathB = x > X && Math.abs(y - py0) < 0.9 - 0.14 * jit
      let c
      if ((front && dist > 0 && dist <= ring - 0.3 * jit) || pathA || pathB) {
        // stones: running bond, a hairline of grout
        const row = Math.floor(y * 2)
        const u = x + (row & 1) * 0.5
        const col = Math.floor(u)
        const gr = y * 2 - row < 0.14 || u - col < 0.07
        c = gr ? GROUT : STONE[Math.floor(ih(col, row, 7) * 3)]
        if (!gr && ih(px, py, 3) < 0.05) c = GROUT
      } else {
        c = GRASS[Math.floor(ih(tx, ty) * 4)]
        const n = ih(px, py)
        if (n < 0.045) c = BLADE
        else if (n < 0.07) c = BLADE_L
        else if (jit < (ih(Math.floor(x / 3), Math.floor(y / 3), 31) < 0.2 ? 0.07 : 0.006) && ih(tx, ty, 5) < 0.5) c = FLOWER[Math.floor(ih(tx, ty, 9) * 4)]   // a few flower beds
      }
      lightAt(x, y, L, px, py)
      // the room's shadow, longer on the lit-away faces (the light comes from the upper left)
      const reach = front ? 2.4 : 0.9
      let sh = 1
      if (dist > 0 && dist < reach) { const s = 1 - dist / reach; sh = 1 - 0.38 * s * s }
      const t = BAYER[(py & 3) * 4 + (px & 3)] / 16 - 0.47
      const k0 = Math.max(0, Math.round(sh * 9 + t) / 9)
      const j = (py * w + px) * 4
      d[j] = c[0] * L[0] * k0; d[j + 1] = c[1] * L[1] * k0; d[j + 2] = c[2] * L[2] * k0; d[j + 3] = 255
    }
  }

  // things standing on it, from far to near (screen y)
  const things = []
  const tree = (x, y) => things.push({ kind: 'tree', x, y })
  const bush = (x, y) => things.push({ kind: 'bush', x, y })
  // trees, bushes and low hedges scattered over the whole buffer (a wide frame gets more of them), never on the walk or the paths
  const x0 = Math.floor(tileOf(0, 0)[0]) - 1; const x1 = Math.ceil(tileOf(w, h)[0]) + 1   // x grows to the lower right
  const y0 = Math.floor(tileOf(w, 0)[1]) - 1; const y1 = Math.ceil(tileOf(0, h)[1]) + 1   // y grows to the lower left
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const cx = tx + 0.5; const cy = ty + 0.5
      const dx = cx < 0 ? -cx : cx > X ? cx - X : 0
      const dy = cy < 0 ? -cy : cy > Y ? cy - Y : 0
      const dist = Math.hypot(dx, dy)
      const nearPath = (cy > Y && Math.abs(cx - px0) < 1.6) || (cx > X && Math.abs(cy - py0) < 1.6)
      const onWalk = (cx > X || cy > Y) && dist <= ring + 0.2
      const clear = !nearPath && !onWalk && dist > 2.4
      if (clear && dist < 3.4 && ih(tx, ty, 11) < 0.2) bush(cx, cy)   // a hedge-like row at the foot of the walk
      else if (clear && dist > 3 && ih(tx, ty, 17) < 0.016) tree(cx + 0.3 * (ih(tx, ty, 19) - 0.5), cy)
      else if (clear && dist > 2.6 && ih(tx, ty, 13) < 0.06) bush(cx, cy)
    }
  }
  const isoFar = t => screenOf(t.x, t.y)[1]
  things.sort((a, b) => isoFar(a) - isoFar(b))
  const blob = (cx, cy, rx, ry, pal, k) => {
    for (let yy = Math.floor(cy - ry - 1); yy <= Math.ceil(cy + ry + 1); yy++) {
      for (let xx = Math.floor(cx - rx - 1); xx <= Math.ceil(cx + rx + 1); xx++) {
        const a = (xx + 0.5 - cx) / (rx + 1); const b = (yy + 0.5 - cy) / (ry + 1)
        const q = a * a + b * b
        if (q > 1) continue
        const a2 = (xx + 0.5 - cx) / rx; const b2 = (yy + 0.5 - cy) / ry
        const q2 = a2 * a2 + b2 * b2
        const lit = (xx - cx) / rx + (yy - cy) / ry   // upper left = light
        put(xx, yy, q2 > 1 ? pal[0] : lit < -0.5 ? pal[3] : lit > 0.55 ? pal[1] : pal[2], k)
      }
    }
  }
  const shadowAt = (cx, cy, rx, ry) => {
    for (let yy = Math.floor(cy - ry); yy <= Math.ceil(cy + ry); yy++) {
      for (let xx = Math.floor(cx - rx); xx <= Math.ceil(cx + rx); xx++) {
        const a = (xx + 0.5 - cx) / rx; const b = (yy + 0.5 - cy) / ry
        if (a * a + b * b <= 1) dim(xx, yy, 0.72)
      }
    }
  }
  const K = [0, 0, 0]
  // trees at the scale of the room (a crown of 50 to 65 px against an 80 px wall; at 28 to 38 px they are a bush beside a
  // seated character). This layer lies UNDER the room canvas: a tree behind the room is hidden by its walls as it should be, but a tree
  // in front of it would be painted over by the room. So a tree in front whose crown would reach the room's canvas stays a bush.
  const room = { x0: bleed.l, y0: bleed.t, x1: bleed.l + layout.W, y1: bleed.t + layout.H }
  for (const t of things) {
    const [sx, sy] = screenOf(t.x, t.y)
    const cx = Math.round(sx); const cy = Math.round(sy)
    if (cx < -50 || cx > w + 50 || cy < -10 || cy > h + 90) continue
    lightAt(t.x, t.y, K)
    if (t.kind === 'tree') {
      const s = 1.5 + 0.45 * ih(Math.round(t.x * 3), Math.round(t.y * 3), 21)
      const front = t.x > X || t.y > Y
      if (front && cx + 22 * s > room.x0 && cx - 22 * s < room.x1 && cy - 36 * s < room.y1 && cy > room.y0) t.kind = 'bush'
    }
    if (t.kind === 'tree') {
      const s = 1.5 + 0.45 * ih(Math.round(t.x * 3), Math.round(t.y * 3), 21)
      shadowAt(cx + 5, cy + 1, 14 * s, 5 * s)
      for (let i = 0; i < 9 * s; i++) for (let j = -1; j <= 1; j++) put(cx + j, cy - i, j === 1 ? BARK_D : BARK, K)
      blob(cx - 9 * s, cy - 13 * s, 8 * s, 7 * s, LEAF, K)
      blob(cx + 9 * s, cy - 14 * s, 8 * s, 7 * s, LEAF, K)
      blob(cx, cy - 19 * s, 12 * s, 10 * s, LEAF, K)
      blob(cx + 1, cy - 27 * s, 8 * s, 6 * s, LEAF, K)
    } else {
      const s = 0.8 + 0.5 * ih(Math.round(t.x * 3), Math.round(t.y * 3), 23)
      shadowAt(cx + 2, cy + 1, 7 * s, 3 * s)
      blob(cx - 3 * s, cy - 3 * s, 4 * s, 3.4 * s, BUSH, K)
      blob(cx + 3 * s, cy - 3.4 * s, 4.4 * s, 3.6 * s, BUSH, K)
      blob(cx, cy - 6 * s, 4 * s, 3.4 * s, BUSH, K)
    }
  }
  // lamp posts (stand on the walk; the lamp itself is emissive, the pool of light is in the ground above)
  for (const p of posts) {
    const [sx, sy] = screenOf(p.x, p.y)
    const cx = Math.round(sx); const cy = Math.round(sy)
    lightAt(p.x, p.y, K)
    // a street lamp at the scale of the room (lantern at 40 px, half the wall; a 24 px stick reads as a stilt
    // under the slab). Two-pixel pole with a lit edge, a foot, a lantern with a cap; the glass is emissive at night.
    shadowAt(cx + 5, cy + 1, 8, 2.5)
    for (let i = 0; i < 36; i++) { put(cx, cy - i, POLE, K); put(cx - 1, cy - i, POLE_L, K) }
    for (let j = -2; j <= 1; j++) for (let i = 0; i < 2; i++) put(cx + j, cy - i, POLE, K)
    for (let j = -3; j <= 2; j++) for (let i = 36; i < 42; i++) {
      const edge = i === 36 || j === -3 || j === 2
      put(cx + j, cy - i, edge ? POLE : LAMP, !edge && night ? [1, 1, 1] : K)
    }
    for (let j = -2; j <= 1; j++) put(cx + j, cy - 42, POLE, K)
    put(cx, cy - 43, POLE, K); put(cx - 1, cy - 43, POLE, K)
  }
  return { w, h, d }
}
