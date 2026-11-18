import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildBase, drawScene, layoutScene, toSceneModel } from '../../src/scene/index.js'
import { msUntilNextSwitch, msUntilPageTick, lightModeAt } from '../../src/core/daylight.js'

// ===== clock =====
{
// The hands of the wall clock belong to the animated layer. The baked base does not depend on the minute,
// so an idle office rebuilds it only at the day / night switch, and the clock is still exact to the minute.
const src = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const office = {
  agents: [
    { name: 'ana', state: 'working', home: 'alpha', description: '', lastActivityMs: 1, officeMeta: {} },
    { name: 'bob', state: 'idle', home: 'alpha', description: '', lastActivityMs: 1, officeMeta: {} }
  ],
  boards: [{ slug: 'alpha', counts: { todo: 2, running: 1, blocked: 0, done: 5 }, total: 8, blocked: [] }],
  ops: null
}
const at = (nowMs, night = false) => {
  const model = toSceneModel(office, { nowMs, night })
  const layout = layoutScene(model)
  return { model, layout, base: buildBase(layout, model) }
}
const T0 = new Date(2026, 10, 12, 10, 10, 0).getTime()
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
const diffBox = (a, b, W) => {
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1; let n = 0
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue
    const p = i / 4
    const x = p % W; const y = Math.floor(p / W)
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); n++
  }
  return { n, x0, y0, x1, y1 }
}

test('the baked base is the same pixel for pixel at two different minutes (hands are not in it)', () => {
  const a = at(T0)
  const b = at(T0 + 7 * 60_000 + 20_000)
  assert.ok(same(a.base.d, b.base.d), 'buildBase must not depend on the minute')
})

test('the clock stays exact to the minute: only the clock\'s pixels change between two minutes', () => {
  const a = at(T0)
  const b = at(T0 + 7 * 60_000)
  const pa = drawScene(a.layout, a.base, a.model, 0).d
  const pb = drawScene(b.layout, a.base, b.model, 0).d   // the SAME base reused: nothing else may move
  const d = diffBox(pa, pb, a.layout.W)
  assert.ok(d.n > 3, `the minute hand moved (${d.n} pixels)`)
  assert.ok(d.x1 - d.x0 <= 22 && d.y1 - d.y0 <= 22, `the change fits in the 22 px clock face: ${JSON.stringify(d)}`)
  // and the hands really tell the time: 10:10 and 10:11 differ, the same minute does not
  const c = at(T0 + 59_000)
  assert.ok(same(pa, drawScene(c.layout, a.base, c.model, 0).d), 'same minute: same pixels')
  const e = at(T0 + 60_000)
  assert.ok(!same(pa, drawScene(e.layout, a.base, e.model, 0).d), 'next minute: the minute hand moved')
})

test('night and day still rebuild the base (the glazing and the light change)', () => {
  assert.ok(!same(at(T0, false).base.d, at(T0, true).base.d))
})

test('baseKey carries no minute (the scene only rebuilds when its structure or the light changes)', () => {
  const scene = src('src/ui/OfficeScene.jsx')
  const key = scene.match(/const baseKey = [\s\S]*?\n\n/)
  assert.ok(key, 'baseKey exists')
  assert.doesNotMatch(key[0], /nowMs/, `baseKey changes every minute:\n${key[0].slice(0, 200)}`)
})
}

// ===== clock =====
{
// The page clock is scheduled (one timer to the next minute or day/night switch), by value.
const at = (h, m = 0, s = 0, ms = 0) => new Date(2026, 10, 8, h, m, s, ms)

test('the next tick is the next full minute', () => {
  assert.equal(msUntilPageTick(at(12, 30, 0, 0)), 60_000)
  assert.equal(msUntilPageTick(at(12, 30, 45, 500)), 14_500)
})

test('the tick never skips the day/night switch', () => {
  for (const d of [at(18, 59, 59, 999), at(6, 59, 30), at(12), at(23, 59, 59)]) {
    assert.ok(msUntilPageTick(d) <= msUntilNextSwitch(d))
    assert.ok(msUntilPageTick(d) >= 1 && msUntilPageTick(d) <= 60_000)
  }
})
}

// ===== clock =====
{
const at = (h, m = 0) => new Date(2026, 10, 8, h, m)

test('night from 19:00 to 07:00, day otherwise (local clock)', () => {
  assert.equal(lightModeAt(at(6, 59)), 'night')
  assert.equal(lightModeAt(at(7)), 'day')
  assert.equal(lightModeAt(at(18, 59)), 'day')
  assert.equal(lightModeAt(at(19)), 'night')
  assert.equal(lightModeAt(at(0)), 'night')
})

test('next switch is scheduled once, at the boundary', () => {
  assert.equal(msUntilNextSwitch(at(18, 30)), 30 * 60_000)
  assert.equal(msUntilNextSwitch(at(6)), 60 * 60_000)
  assert.equal(msUntilNextSwitch(at(23)), 8 * 3_600_000)
})
}
