/* Raster buffer, sprite layers and isometric primitives. Pure: draws into a Uint8ClampedArray. */
import { BAYER, band, mulc, mixc } from './color.js'
import { PAL } from './palette.js'
import { TH2, TW2, projectAt } from './constants.js'

/** Bands of a light pool between nothing and full. */
export const LIGHT_STEPS = 12

export class Px {
  constructor(w, h, ox = 0, oy = 0) {
    this.w = w
    this.h = h
    this.ox = ox
    this.oy = oy
    this.d = new Uint8ClampedArray(w * h * 4)
    this.L = null
  }

  /** Project tile coordinates with this buffer's origin. */
  P(x, y, z = 0) { return projectAt(this.ox, this.oy, x, y, z) }

  put(x, y, c, e) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = y * this.w + x
    const j = i * 4
    let r = c[0]
    let g = c[1]
    let b = c[2]
    if (!e && this.L) { r *= this.L[i * 3]; g *= this.L[i * 3 + 1]; b *= this.L[i * 3 + 2] }
    this.d[j] = r; this.d[j + 1] = g; this.d[j + 2] = b; this.d[j + 3] = 255
  }

  mix(x, y, c, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const j = (y * this.w + x) * 4
    if (!this.d[j + 3]) return
    this.d[j] = this.d[j] * (1 - a) + c[0] * a
    this.d[j + 1] = this.d[j + 1] * (1 - a) + c[1] * a
    this.d[j + 2] = this.d[j + 2] * (1 - a) + c[2] * a
  }

  dim(x, y, k) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const j = (y * this.w + x) * 4
    if (!this.d[j + 3]) return
    this.d[j] *= k; this.d[j + 1] *= k; this.d[j + 2] *= k
  }

  poly(pts, color, e, dimK) {
    let minY = Infinity
    let maxY = -Infinity
    for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1] }
    const y0 = Math.max(0, Math.ceil(minY - 0.5))
    const y1 = Math.min(this.h - 1, Math.floor(maxY - 0.5))
    const n = pts.length
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5
      const xs = []
      for (let i = 0; i < n; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % n]
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) xs.push(a[0] + (sy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]))
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5))
        const xb = Math.min(this.w - 1, Math.ceil(xs[k + 1] - 0.5) - 1)
        for (let x = xa; x <= xb; x++) {
          if (dimK) { this.dim(x, y, dimK); continue }
          const c = typeof color === 'function' ? color(x + 0.5, y + 0.5) : color
          if (c) this.put(x, y, c, e || c.e)
        }
      }
    }
  }

  line(a, b, c, e) {
    let x0 = Math.round(a[0])
    let y0 = Math.round(a[1])
    const x1 = Math.round(b[0])
    const y1 = Math.round(b[1])
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      this.put(x0, y0, c, e)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) { err += dy; x0 += sx }
      if (e2 <= dx) { err += dx; y0 += sy }
    }
  }

  /**
   * Bake the room light: the ambient, exact, plus the elliptical light pools in LIGHT_STEPS bands (half of each band dithered into the next).
   * ONE intensity is banded per pixel and the pools' colour is scaled by it. With each channel banded on its own, the three
   * do not step on the same pixels: a flat wall comes out speckled yellow and pink by day, in a violet / green checker by night.
   * `classic` keeps that first light (9 steps per channel, ambient included), the one of the first art direction: the fidelity tests compare with it.
   */
  light(amb, lights, classic = false) {
    const { w, h } = this
    const L = new Float32Array(w * h * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0
        let g = 0
        let b = 0
        for (const l of lights) {
          const dx = (x - l.x) / l.rx
          const dy = (y - l.y) / l.ry
          const q = 1 - dx * dx - dy * dy
          if (q > 0) { const f = q * q * l.p; r += l.c[0] * f; g += l.c[1] * f; b += l.c[2] * f }
        }
        const i = (y * w + x) * 3
        if (classic) {
          const t = BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47
          L[i] = Math.round((amb[0] + r) * 9 + t) / 9
          L[i + 1] = Math.round((amb[1] + g) * 9 + t) / 9
          L[i + 2] = Math.round((amb[2] + b) * 9 + t) / 9
          continue
        }
        const m = Math.max(r, g, b)
        const q = m > 0 ? band(m, LIGHT_STEPS, x, y) / m : 0
        L[i] = amb[0] + r * q
        L[i + 1] = amb[1] + g * q
        L[i + 2] = amb[2] + b * q
      }
    }
    this.L = L
  }
}

export function box(px, x, y, z, dx, dy, h, c) {
  const P = (a, b, d) => px.P(a, b, d)
  const T = [P(x, y, z + h), P(x + dx, y, z + h), P(x + dx, y + dy, z + h), P(x, y + dy, z + h)]
  const Lf = [P(x, y + dy, z + h), P(x + dx, y + dy, z + h), P(x + dx, y + dy, z), P(x, y + dy, z)]
  const Rf = [P(x + dx, y, z + h), P(x + dx, y + dy, z + h), P(x + dx, y + dy, z), P(x + dx, y, z)]
  if (h > 0) { px.poly(Lf, c.l); px.poly(Rf, c.r) }
  px.poly(T, c.t)
  if (c.hi) {
    px.line(P(x, y + dy, z + h), P(x + dx, y + dy, z + h), c.hi)
    px.line(P(x + dx, y + dy, z + h), P(x + dx, y, z + h), c.hi)
  }
  if (c.o) {
    const o = c.o
    px.line(P(x, y, z + h), P(x + dx, y, z + h), o); px.line(P(x, y, z + h), P(x, y + dy, z + h), o)
    px.line(P(x + dx, y, z + h), P(x + dx, y, z), o); px.line(P(x, y + dy, z + h), P(x, y + dy, z), o)
    px.line(P(x, y + dy, z), P(x + dx, y + dy, z), o); px.line(P(x + dx, y + dy, z), P(x + dx, y, z), o)
  }
}

export const shadeFor = (t, k1 = 0.86, k2 = 0.72) => ({ t, l: mulc(t, k1), r: mulc(t, k2) })

export const shadow = (px, x, y, dx, dy, k = 0.8) => px.poly([px.P(x, y), px.P(x + dx, y), px.P(x + dx, y + dy), px.P(x, y + dy)], null, false, k)

/** Shader helper: screen pixel -> (x, z) on the back-wall-like plane y = Y0. */
export const onY = (px, Y0) => (sx, sy) => {
  const x = (sx - px.ox) / TW2 + Y0
  return [x, px.oy + TH2 * (x + Y0) - sy]
}

/* ---------- pixel sprites: layers of coloured cells keyed (x, y) ---------- */
export class Lay {
  constructor() { this.m = new Map() }

  set(x, y, c) { this.m.set(((y + 128) << 9) | (x + 256), c); return this }

  has(x, y) { return this.m.has(((y + 128) << 9) | (x + 256)) }

  rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); return this }

  ell(cx, cy, rx, ry, c, keep) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const a = (x - cx) / rx
        const b = (y - cy) / ry
        if (a * a + b * b <= 1 && (!keep || keep(x, y))) this.set(x, y, c)
      }
    }
    return this
  }

  shade(fn) {
    for (const [k, c] of this.m) {
      const n = fn((k & 511) - 256, (k >> 9) - 128, c)
      if (n) this.m.set(k, n)
    }
    return this
  }
}

export class Spr {
  constructor() { this.m = new Map() }

  add(l, outline = PAL.outline) {
    for (const [k, c] of l.m) this.m.set(k, c)
    if (outline) for (const k of l.m.keys()) for (const dk of [1, -1, 512, -512]) { const n = k + dk; if (!l.m.has(n)) this.m.set(n, outline) }
    return this
  }

  /** 2-px glow around the silhouette, drawn before the sprite. */
  aura(px, ax, ay, c, strong) {
    const ring1 = new Set()
    const ring2 = new Set()
    for (const k of this.m.keys()) for (const dk of [1, -1, 512, -512, 513, 511, -511, -513]) { const n = k + dk; if (!this.m.has(n)) ring1.add(n) }
    for (const k of ring1) for (const dk of [1, -1, 512, -512]) { const n = k + dk; if (!this.m.has(n) && !ring1.has(n)) ring2.add(n) }
    for (const k of ring2) px.mix(ax + (k & 511) - 256, ay + (k >> 9) - 128, c, strong ? 0.45 : 0.3)
    for (const k of ring1) px.mix(ax + (k & 511) - 256, ay + (k >> 9) - 128, c, strong ? 0.95 : 0.75)
  }

  /** `glow`: { c, a, y0, y1 }, a screen's light on the sprite's lit cells between two heights (the face and chest of who sits before it). */
  blit(px, ax, ay, grey, glow) {
    for (const [k, c0] of this.m) {
      let c = c0
      if (grey && !c.e) { const g = (c[0] + c[1] + c[2]) / 3; c = mixc(c, [g, g, g], 0.65) }
      const dy = (k >> 9) - 128
      px.put(ax + (k & 511) - 256, ay + dy, c, c0.e)
      if (glow && !c0.e && c0 !== PAL.outline && dy >= glow.y0 && dy <= glow.y1) px.mix(ax + (k & 511) - 256, ay + dy, glow.c, glow.a)
    }
  }
}

/** A one-off sprite stood at tile (x, y) at height z. */
export function sprite(px, x, y, z, build, outline = PAL.outline) {
  const [ax, ay] = px.P(x, y, z)
  const l = new Lay()
  build(l)
  const s = new Spr()
  s.add(l, outline)
  s.blit(px, Math.round(ax), Math.round(ay))
}
