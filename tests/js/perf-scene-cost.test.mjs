import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildBase, detectRole, drawScene, layoutScene } from '../../src/scene/index.js'
import { postcardBuffer } from '../../src/ui/postcard.js'
import { FRAMES, checksums, modelOf, plainDraw, scenes } from './helpers/perf-scenes.mjs'

const src = f => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')

// ===== drawScene: the frames are the same bytes, and a layout that is painted again and again does not allocate a buffer per frame =====
{
/* The checksums were taken with the code before the buffer was reused (the plain call of drawScene, five frames of each scene, day and night). */
const GOLD = {
  'small-day': '61ac11b1d4fa815d66961829f94fb4a40fa8e9e1',
  'small-night': '18beda29a5c1b972ad201eb4563c6ecbb49ba7e9',
  'busy-day': '1c0c8934038f3622d318155b2e4bce4417a6d005',
  'busy-night': 'a9ddc152477c1b79acd4a929645dae885bf0cda0',
  'empty-day': '73c7e04fe85166e710cc423042e06ecee5761673',
  'empty-night': '7d7c617742846f848aeab2f9639e806544e397a1'
}

test('3 scenes x day / night x 5 frames: the bytes are those of the code before (plain call)', () => {
  assert.deepEqual(checksums(plainDraw), GOLD)
})

test('the same bytes through the reused buffer (the page\'s call), whatever was drawn in it before', () => {
  assert.deepEqual(checksums((layout, base, model, f) => drawScene(layout, base, model, f, { reuse: true })), GOLD)
  // a buffer that held another scene of the same size is overwritten whole
  const [a, b] = [modelOf(scenes().small, false), modelOf(scenes().small, true)]
  const la = layoutScene(a)
  const lb = layoutScene(b)
  assert.equal(la.W * la.H, lb.W * lb.H)
})

test('reuse: the buffer is the layout\'s own, the same one frame after frame; another layout has its own; the plain call never shares', () => {
  const m = modelOf(scenes().small, false)
  const layout = layoutScene(m)
  const base = buildBase(layout, m)
  const first = drawScene(layout, base, m, 0, { reuse: true })
  assert.equal(drawScene(layout, base, m, 1, { reuse: true }).d, first.d)
  const other = layoutScene(m)
  assert.notEqual(drawScene(other, buildBase(other, m), m, 0, { reuse: true }).d, first.d)
  const a = drawScene(layout, base, m, 0)
  const b = drawScene(layout, base, m, 0)
  assert.notEqual(a.d, b.d, 'a caller that keeps the frame (tests, postcard) owns it')
  assert.notEqual(a.d, first.d)
  assert.ok(Buffer.from(a.d).equals(Buffer.from(b.d)))
})

test('no scene-sized buffer is allocated after the first frame of a layout; the plain call allocates one per frame', () => {
  const Orig = globalThis.Uint8ClampedArray
  let big = 0
  globalThis.Uint8ClampedArray = class extends Orig { constructor(...a) { super(...a); if (typeof a[0] === 'number' && a[0] >= 65_536) big++ } }
  try {
    const m = modelOf(scenes().busy, false)
    const layout = layoutScene(m)
    const base = buildBase(layout, m)
    drawScene(layout, base, m, 0, { reuse: true })
    big = 0
    for (const f of FRAMES) drawScene(layout, base, m, f + 20, { reuse: true })
    assert.equal(big, 0)
    for (const f of FRAMES) drawScene(layout, base, m, f)
    assert.equal(big, FRAMES.length)
  } finally { globalThis.Uint8ClampedArray = Orig }
})

test('the postcard keeps its own buffer: a frame painted afterwards does not touch it', () => {
  const m = modelOf(scenes().small, false)
  const layout = layoutScene(m)
  const card = postcardBuffer(layout, m)
  const copy = Buffer.from(card.d)
  const base = buildBase(layout, m)
  drawScene(layout, base, { ...m, selected: 'alpha' }, 3, { reuse: true })
  assert.ok(Buffer.from(card.d).equals(copy))
  assert.ok(Buffer.from(postcardBuffer(layout, m).d).equals(copy))
})

test('what the page asks of the engine: the reused call and the base key by identity (page wiring)', () => {
  const page = src('ui/OfficeScene.jsx')
  assert.match(page, /frame, \{ reuse: true \}\)/)
  assert.match(page, /const BASE_KEYS = new WeakMap\(\)/)
})

test('detectRole: the same agent object is judged once; a change of what it is judged on is seen; an equal copy gives the equal role', () => {
  const a = { name: 'alpha', description: 'Review pull requests and audit security', skills: [] }
  const first = detectRole(a)
  assert.ok(first)
  assert.equal(detectRole(a), first)
  assert.deepEqual(detectRole({ ...a }), first)
  a.description = 'Design the interface and the brand'
  assert.notDeepEqual(detectRole(a), first, 'the description changed')
  const withSkills = { name: 'x7', description: '', skills: [{ name: 'figma', category: 'design', tags: [] }] }
  const designed = detectRole(withSkills)
  withSkills.skills = []
  assert.notDeepEqual(detectRole(withSkills), designed, 'the skills changed')
  assert.equal(detectRole({ name: 'x8', description: '', skills: [], copiedSkills: ['testing'] }), null)
})

}
