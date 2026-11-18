import assert from 'node:assert/strict'
import { test } from 'node:test'

import { toBoard } from '../../src/core/office.js'
import { whiteboard } from '../../src/scene/base.js'
import { layoutScene, toSceneModel } from '../../src/scene/index.js'
import { PAL } from '../../src/scene/palette.js'

/** A board as /live gives it: n cards per status. */
const board = (slug, byStatus) => ({
  slug,
  tasks: Object.entries(byStatus).flatMap(([status, n]) => Array.from({ length: n }, (_, i) => ({ id: `${slug}-${status}-${i}`, title: `T${i}`, status })))
})

const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
const isPaper = c => !c || [PAL.wb, PAL.wbFrame, PAL.wbLine].some(p => same(c, p))

/** Sticky notes the whiteboard really draws, per column, read from its own pixel function (not from the counts). */
function notesDrawn(pod) {
  const wb = whiteboard(pod)
  const cw = (wb.s1 - wb.s0 - 4) / 4
  const per = Math.max(1, Math.floor((cw - 1) / 5))
  const cap = per * 5
  const cols = []
  for (let ci = 0; ci < 4; ci++) {
    let n = 0
    let plus = false
    for (let r = 0; r < 5; r++) {
      for (let k = 0; k < per; k++) {
        const s = wb.s0 + 2 + ci * cw + 1 + 5 * k
        const z = wb.z1 - (8 + 5 * r)
        if (!isPaper(wb.f(s + 0.5, z - 0.5))) {
          n += 1
          // a "+" note carries a cross of line colour in its middle
          if (same(wb.f(s + 2, z - 2), PAL.wbLine)) plus = true
        }
      }
    }
    cols.push({ n, plus, cap })
  }
  return cols
}

const podOf = (boards, slug) => layoutScene(toSceneModel({ agents: [], boards: boards.map(toBoard), ops: null }, { nowMs: 0 })).pods.find(p => p.b.slug === slug)

test('whiteboard notes equal the card counts of the boards, column by column', () => {
  const live = [
    board('alpha', { done: 31, blocked: 3 }),
    board('beta', { done: 96, scheduled: 1 }),
    board('website', { done: 2, running: 1, todo: 17 })
  ]
  // [todo-ish, running-ish, blocked, done] expected per board; a column is capped at `cap` notes and then shows a "+"
  const expected = { alpha: [0, 0, 3, 31], beta: [1, 0, 0, 96], website: [17, 1, 0, 2] }
  for (const [slug, want] of Object.entries(expected)) {
    const cols = notesDrawn(podOf(live, slug))
    cols.forEach((c, i) => {
      const shown = Math.min(want[i], c.cap)
      assert.equal(c.n, shown, `${slug} column ${i}: ${want[i]} cards -> ${shown} notes`)
      assert.equal(c.plus, want[i] > c.cap, `${slug} column ${i}: "+" only when the column overflows`)
    })
  }
})

test('the done/total of an island label is the board count (toBoard), blocked included', () => {
  const b = toBoard(board('alpha', { done: 31, blocked: 3 }))
  assert.equal(b.done, 31)
  assert.equal(b.total, 34)
  assert.equal(b.blocked.length, 3)
  assert.equal(toBoard(board('beta', { done: 96, scheduled: 1 })).total, 97)
})

test('no cards: an empty whiteboard draws no note', () => {
  const cols = notesDrawn(podOf([board('empty', {})], 'empty'))
  assert.deepEqual(cols.map(c => c.n), [0, 0, 0, 0])
})
