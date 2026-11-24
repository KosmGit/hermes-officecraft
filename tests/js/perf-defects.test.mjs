import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { approvalsReducer, emptyApprovals, UNREADABLE_MAX } from '../../src/core/approvals.js'
import { watchDpr } from '../../src/core/dpr.js'
import { colorMemoSize, hx } from '../../src/scene/color.js'
import { tame, tamedSize } from '../../src/scene/style.js'
import { postcardName } from '../../src/ui/postcard.js'

const src = f => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')

// ===== three logic defects: the day of a postcard, the density of the screen, tables that were never purged =====
{
test('approvals: the sessions flagged unreadable are bounded, the newest flags stay, a read clears its own flag', () => {
  let s = emptyApprovals()
  for (let i = 0; i < UNREADABLE_MAX * 3; i++) s = approvalsReducer(s, { type: 'unreadable', sessionId: `s${i}` })
  const keys = Object.keys(s.unreadable)
  assert.equal(keys.length, UNREADABLE_MAX)
  assert.equal(keys.at(-1), `s${UNREADABLE_MAX * 3 - 1}`)
  assert.equal(s.unreadable.s0, undefined)
  const last = keys.at(-1)
  assert.equal(approvalsReducer(s, { type: 'snapshot', sessionId: last, rows: [], nowMs: 0 }).unreadable[last], undefined)
})

test('colours: the tables are bounded; a frozen array handed out stays valid and unchanged after the table was emptied', () => {
  const kept = hx('#336699')
  assert.deepEqual([...kept], [0x33, 0x66, 0x99])
  for (let i = 0; i < 5000; i++) hx(`#${(0x100000 + i * 37).toString(16).padStart(6, '0')}`)
  assert.ok(colorMemoSize() <= 2048)
  assert.equal(Object.isFrozen(kept), true)
  assert.deepEqual([...kept], [0x33, 0x66, 0x99])
  assert.deepEqual([...hx('#336699')], [0x33, 0x66, 0x99])
  const base = tame('#336699', '#3a5f8a', 'desk')
  for (let i = 0; i < 3000; i++) tame(`#${(0x200000 + i * 41).toString(16).padStart(6, '0')}`, '#3a5f8a', 'desk')
  assert.ok(tamedSize() <= 1024)
  assert.deepEqual([...tame('#336699', '#3a5f8a', 'desk')], [...base])
})

test('the postcard file is named by the local day: 00:30 on the 25th is the 25th, whatever UTC says', () => {
  const was = process.env.TZ
  try {
    for (const tz of ['Europe/Paris', 'America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
      process.env.TZ = tz
      assert.equal(postcardName(new Date(2026, 10, 25, 0, 30).getTime()), 'officecraft-2026-11-25.png', tz)
      assert.equal(postcardName(new Date(2026, 10, 24, 23, 59).getTime()), 'officecraft-2026-11-24.png', tz)
      assert.equal(postcardName(new Date(2026, 0, 5, 12, 0).getTime()), 'officecraft-2026-01-05.png', tz)
    }
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was }
})

test('a window dragged to a screen of another density: the ratio is read again, the query is armed again, and the listener is removed on unmount', () => {
  const listeners = new Set()
  const win = {
    devicePixelRatio: 1,
    queries: [],
    matchMedia(q) {
      const mq = { q, addEventListener: (t, f) => { assert.equal(t, 'change'); listeners.add(f) }, removeEventListener: (t, f) => { listeners.delete(f) } }
      this.queries.push(q)
      return mq
    }
  }
  const seen = []
  const stop = watchDpr(win, v => seen.push(v))
  assert.deepEqual(win.queries, ['(resolution: 1dppx)'])
  assert.equal(listeners.size, 1)
  win.devicePixelRatio = 2
  for (const f of [...listeners]) f()   // the old query stops matching
  assert.deepEqual(seen, [2])
  assert.deepEqual(win.queries, ['(resolution: 1dppx)', '(resolution: 2dppx)'], 're-armed on the new ratio')
  assert.equal(listeners.size, 1, 'one listener at a time')
  win.devicePixelRatio = 1.25
  for (const f of [...listeners]) f()
  assert.deepEqual(seen, [2, 1.25])
  stop()
  assert.equal(listeners.size, 0, 'removed at unmount')
  assert.doesNotThrow(() => watchDpr({}, () => {})(), 'no matchMedia: nothing to listen to')
})
test('the room follows the density of the screen and lets go of the page\'s DOM when it unmounts (page wiring)', () => {
  const page = src('ui/OfficeScene.jsx')
  assert.match(page, /useEffect\(\(\) => watchDpr\(window, setDpr\), \[\]\)/)
  assert.match(page, /useEffect\(\(\) => forgetAccent, \[\]\)/)
})

}
