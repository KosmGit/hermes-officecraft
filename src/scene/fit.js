/* Scale the art into the pane. The page never scrolls: the scene fits in width AND height. */

/** Scene scale under which pixel art stops being readable: the page shows the same facts as a list. */
export const LIST_BELOW = 0.75

/**
 * availW / availH: free CSS pixels (padding already removed). W / H: art size. dpr: devicePixelRatio.
 * people: placed agents (only used for `dense`). Returns { mode: 'scene'|'list', scale, dense, compact }.
 *  - whole device pixels per art pixel when that wastes at most 10 % of the pane, else fill it (nearest neighbour stays crisp enough);
 *  - between LIST_BELOW and 1 the scene shrinks (no sideways scroll) and labels go dense.
 */
export function fitScale({ availW, availH, W, H, dpr = 1, people = 0 }) {
  const exact = Math.min(availW / W, availH / H)
  if (!(exact >= LIST_BELOW)) return { mode: 'list', scale: exact > 0 ? exact : 0, dense: false, compact: false }
  const d = dpr > 0 ? dpr : 1
  const whole = Math.floor(exact * d) / d
  const fit = whole >= exact * 0.9 ? whole : Math.floor(exact * 10) / 10
  const scale = fit >= 1 ? Math.min(4, fit) : Math.max(LIST_BELOW, Math.floor(exact * 20) / 20)
  const dense = people > 14 || (people > 10 && scale < 1.4) || (people > 3 && scale < 1)
  return { mode: 'scene', scale, dense, compact: scale < 1.6 }
}

/**
 * The pixel store a canvas of W x H art pixels needs so that the browser never resamples it (JIT).
 * A scale that is not a whole number of device pixels per art pixel (1.3) used to be left to the browser: it stretched the art
 * over a box whose snapped size depends on where the box sits (553 or 554 device px), and each partial repaint (a hover) could pick
 * other rows and columns than the frame before: lines that shimmer across the room. Here the store is a whole number of device
 * pixels (the page scales the art into it itself, nearest neighbour, the whole picture at once) and its CSS size is that number
 * divided by dpr: one store pixel per device pixel, wherever the box sits.
 * `direct`: the scale is already a whole number of device pixels, the art is shown as it is (W x H store).
 * -> { w, h (store), cssW, cssH (CSS px), k (device px per art pixel), direct }
 */
export function backingOf({ W, H, S, dpr = 1 }) {
  const d = dpr > 0 ? dpr : 1
  const k = S * d
  const direct = k >= 1 && Math.abs(k - Math.round(k)) < 1e-6
  if (direct) return { w: W, h: H, cssW: W * S, cssH: H * S, k, direct }
  const w = Math.max(1, Math.round(W * k))
  const h = Math.max(1, Math.round(H * k))
  return { w, h, cssW: w / d, cssH: h / d, k, direct }
}

/**
 * Nearest-neighbour copy of a W x H RGBA frame into a w x h one (`out`: w * h * 4 bytes, owned and reused by the caller). The whole
 * picture is scaled in one pass from one origin: the same art pixel always lands on the same store pixels (JIT). -> out
 */
export function upscale(src, W, H, out, w, h) {
  const s = new Uint32Array(src.buffer, src.byteOffset, W * H)
  const o = new Uint32Array(out.buffer, out.byteOffset, w * h)
  const xs = new Int32Array(w)
  for (let x = 0; x < w; x++) xs[x] = Math.min(W - 1, Math.floor((x + 0.5) * W / w))
  let prev = -1
  for (let y = 0; y < h; y++) {
    const sy = Math.min(H - 1, Math.floor((y + 0.5) * H / h))
    const row = y * w
    if (sy === prev) { o.copyWithin(row, row - w, row); continue }   // a repeated art row: copy the store row above
    const base = sy * W
    for (let x = 0; x < w; x++) o[row + x] = s[base + xs[x]]
    prev = sy
  }
  return out
}
