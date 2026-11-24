import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { approvalsReducer, emptyApprovals } from '../../src/core/approvals.js'
import { formatRelative } from '../../src/core/time.js'
import { upscale } from '../../src/scene/index.js'

const src = f => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')

// ===== small costs that were paid again at every read or every frame =====
{
test('formatRelative: one formatter per language, the same text as before', () => {
  const Orig = Intl.RelativeTimeFormat
  let built = 0
  Intl.RelativeTimeFormat = class extends Orig { constructor(...a) { super(...a); built++ } }
  try {
    const now = 1_800_000_000_000
    const out = []
    for (let i = 0; i < 500; i++) { out.push(formatRelative(now - 3 * 3_600_000, now, 'en'), formatRelative(now - 3 * 3_600_000, now, 'fr'), formatRelative(now - 3 * 3_600_000, now, 'es')) }
    assert.ok(built <= 3, `built ${built}`)
    assert.deepEqual(out.slice(0, 3).map(s => s.replace(/\u00a0|\u202f/g, ' ')), ['3 hours ago', 'il y a 3 heures', 'hace 3 horas'])
    assert.equal(formatRelative(now, now, 'en'), 'now')
    assert.throws(() => formatRelative(now - 1000, now, 'not a language'), RangeError, 'a bad language is refused as before and not kept')
  } finally { Intl.RelativeTimeFormat = Orig }
})

test('approvals: the same titles again give the same state (nothing renders); other titles give another', () => {
  const s0 = approvalsReducer(emptyApprovals(), { type: 'titles', titles: { a: 'First session', b: 'Second' } })
  assert.equal(approvalsReducer(s0, { type: 'titles', titles: { b: 'Second', a: 'First session' } }), s0)
  assert.equal(approvalsReducer(s0, { type: 'titles', titles: { a: 'First session', b: 'Second', c: '   ' } }), s0, 'a blank title is no title')
  assert.notEqual(approvalsReducer(s0, { type: 'titles', titles: { a: 'First session' } }), s0)
  assert.notEqual(approvalsReducer(s0, { type: 'titles', titles: { a: 'First session', b: 'Renamed' } }), s0)
  assert.equal(approvalsReducer(emptyApprovals(), { type: 'titles', titles: {} }).titles && Object.keys(approvalsReducer(emptyApprovals(), { type: 'titles', titles: {} }).titles).length, 0)
})

test('upscale: interleaved sizes (the room and its ground) give the same store as one at a time', () => {
  const frame = (W, H) => { const d = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < d.length; i++) d[i] = (i * 31) % 251; return d }
  const cases = [[60, 40, 78, 52], [200, 100, 300, 150], [60, 40, 78, 52], [33, 21, 100, 64]]
  const alone = cases.map(([W, H, w, h]) => Buffer.from(upscale(frame(W, H), W, H, new Uint8ClampedArray(w * h * 4), w, h)))
  cases.forEach(([W, H, w, h], i) => {
    assert.ok(alone[i].equals(Buffer.from(upscale(frame(W, H), W, H, new Uint8ClampedArray(w * h * 4), w, h))), `${W}x${w}`)
    for (let y = 0; y < h; y += 7) for (let x = 0; x < w; x += 5) {
      const sx = Math.min(W - 1, Math.floor((x + 0.5) * W / w))
      const sy = Math.min(H - 1, Math.floor((y + 0.5) * H / h))
      assert.equal(alone[i][(y * w + x) * 4], frame(W, H)[(sy * W + sx) * 4])
    }
  })
  assert.match(src('scene/fit.js'), /const COLUMNS = new Map\(\)/)
})
test('the canvas of the room: one probe canvas for the accent, a pixel store kept with room to spare (page wiring)', () => {
  const page = src('ui/OfficeScene.jsx')
  assert.equal((page.match(/createElement\('canvas'\)/g) || []).length, 1, 'one probe canvas for the accent')
  assert.match(page, /ACCENT\.g \|\| \(ACCENT\.g = /)
  assert.match(page, /function storeOf\(store, w, h\)/)
  assert.match(page, /img = store\.current = storeOf\(store, cv\.width, cv\.height\)/)
})

}
