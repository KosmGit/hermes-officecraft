// Lines shimmer across the room under the pointer when the canvas is stretched by the browser at a scale that is not a whole
// number of device pixels (1.3): backingOf gives every canvas a store of whole device pixels, shown 1:1.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { backingOf, fitScale, upscale } from '../../src/scene/index.js'

const whole = v => Math.abs(v - Math.round(v)) < 1e-6

test('a whole number of device pixels per art pixel: the art is shown as it is', () => {
  for (const [S, dpr] of [[1, 1], [2, 1], [3, 1], [1.6, 1.25], [2, 1.5], [4 / 3, 1.5], [0.8, 1.25]]) {
    const b = backingOf({ W: 600, H: 426, S, dpr })
    assert.equal(b.direct, true, `${S} @ ${dpr}`)
    assert.deepEqual([b.w, b.h], [600, 426])
    assert.ok(whole(b.cssW * dpr) && whole(b.cssH * dpr), 'the box is a whole number of device pixels')
  }
})

test('any other scale: the store is the box in device pixels, one store pixel per device pixel', () => {
  for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
    for (let S = 0.75; S <= 4; S += 0.05) {
      for (const [W, H] of [[600, 426], [664, 554], [411, 297], [1203, 811]]) {
        const b = backingOf({ W, H, S, dpr })
        assert.ok(Number.isInteger(b.w) && Number.isInteger(b.h))
        assert.ok(whole(b.cssW * dpr) && whole(b.cssH * dpr), `box in whole device pixels (${S} @ ${dpr})`)
        if (!b.direct) {
          assert.equal(b.w, Math.round(b.cssW * dpr))
          assert.equal(b.h, Math.round(b.cssH * dpr))
        }
        // the box never moves more than half a device pixel away from the size the scale asked for
        assert.ok(Math.abs(b.cssW - W * S) * dpr <= 0.5 + 1e-6 && Math.abs(b.cssH - H * S) * dpr <= 0.5 + 1e-6)
      }
    }
  }
})

test('the case measured on the page (806 x 693 box, 600 x 426 art): 1.3 no longer leaves a 553.8 px box', () => {
  const v = fitScale({ availW: 790, availH: 693, W: 600, H: 426, dpr: 1 })
  assert.equal(v.scale, 1.3)
  const b = backingOf({ W: 600, H: 426, S: v.scale, dpr: 1 })
  assert.deepEqual([b.w, b.h, b.cssW, b.cssH, b.direct], [780, 554, 780, 554, false])
})

test('the scene sizes both canvases from backingOf and never lets the browser stretch a frame', () => {
  const src = readFileSync(new URL('../../src/ui/OfficeScene.jsx', import.meta.url), 'utf8')
  assert.ok(!/style=\{\{ width: layout\.W \* S, height: layout\.H \* S \}\}/.test(src), 'no canvas or stage sized W * S')
  assert.ok(!/width=\{layout\.W\}/.test(src) && !/width=\{ground\.w\}/.test(src), 'no canvas store in art pixels')
  assert.equal((src.match(/putImageData/g) || []).length, 2, 'frames reach a canvas through blit only')
  assert.match(src, /upscale\(d, W, H, img\.data, cv\.width, cv\.height\)/)
})

const frame = (W, H) => { const d = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { d[i * 4] = i % 251; d[i * 4 + 1] = (i * 7) % 253; d[i * 4 + 2] = (i >> 8) % 256; d[i * 4 + 3] = i % 5 ? 255 : 0 } return d }
const at = (d, w, x, y) => [d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2], d[(y * w + x) * 4 + 3]].join(',')

test('upscale: every art pixel is kept, in order, as a block 1 or 2 store pixels wide at 1.3 (never 0, never 3)', () => {
  const [W, H, w, h] = [600, 426, 780, 554]
  const src = frame(W, H)
  const out = upscale(src, W, H, new Uint8ClampedArray(w * h * 4), w, h)
  for (const [n, N, pick] of [[w, W, x => at(out, w, x, 0)], [h, H, y => at(out, w, 0, y)]]) {
    const runs = []
    for (let i = 0; i < n; i++) { if (i && pick(i) === pick(i - 1)) runs[runs.length - 1]++; else runs.push(1) }
    assert.equal(runs.length, N, 'no art row or column is dropped')
    assert.deepEqual([...new Set(runs)].sort(), [1, 2])
  }
  for (const [x, y] of [[0, 0], [779, 553], [390, 277], [123, 456]]) {
    assert.equal(at(out, w, x, y), at(src, W, Math.floor((x + 0.5) * W / w), Math.floor((y + 0.5) * H / h)))
  }
})

test('upscale: a whole scale gives square blocks, and the same frame always gives the same store', () => {
  const src = frame(40, 30)
  const out = upscale(src, 40, 30, new Uint8ClampedArray(120 * 90 * 4), 120, 90)
  for (let y = 0; y < 90; y++) for (let x = 0; x < 120; x++) assert.equal(at(out, 120, x, y), at(src, 40, Math.floor(x / 3), Math.floor(y / 3)))
  const again = upscale(src, 40, 30, new Uint8ClampedArray(out), 120, 90)   // a store reused from the frame before
  assert.ok(Buffer.from(again).equals(Buffer.from(out)))
})
