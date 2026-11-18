/* Colour helpers. Colours are [r, g, b] arrays; an emissive colour (ignores lighting) carries `.e`. */

const memo = new Map()

/** '#rrggbb' -> frozen [r, g, b] (memoised: shaders call it per pixel). */
export function hx(h) {
  let c = memo.get(h)
  if (!c) {
    const n = parseInt(h.slice(1), 16)
    c = Object.freeze([(n >> 16) & 255, (n >> 8) & 255, n & 255])
    memo.set(h, c)
  }
  return c
}

export const mulc = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export function hslc(h, s, l) {
  s /= 100
  l /= 100
  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** Emissive copy of a colour: drawn at full brightness whatever the room light. */
export const E = c => Object.assign([...c], { e: true })

/** 4x4 Bayer matrix for the dithered light. */
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/**
 * One intensity `v` snapped to `steps` bands at pixel (x, y). `amp` (0..1) is the share of a band that is dithered into the next
 * one: 0 = hard edges, 1 = dither everywhere. A scalar is banded, never a channel: the hue of what it lights cannot move.
 */
export const band = (v, steps, x, y, amp = 0.5) => Math.max(0, Math.round(v * steps + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * amp) / steps)
