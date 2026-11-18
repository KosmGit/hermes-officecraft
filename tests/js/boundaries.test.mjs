// Boundary tests: the workerModel bound (page side) and the state, scale and layout
// boundaries). Each test pins an exact boundary (the value itself and one step either side) so that a one-character
// mutant of the comparison dies. They only IMPORT from src/ (read-only); the mutant each one kills is named in its title.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { toHistoryProfile } from '../../src/core/history.js'
import { formatSpan } from '../../src/core/hud.js'
import { modelOf } from '../../src/core/models.js'
import { STALE_AFTER_MS, buildOffice } from '../../src/core/office.js'
import { RECENT_WINDOW_MS, WORKER_LIVE_WINDOW_MS, buildRoster, deskState } from '../../src/core/roster.js'
import { fitScale } from '../../src/scene/fit.js'
import { layoutScene, toSceneModel } from '../../src/scene/index.js'

const NOW = 1_800_000_000_000
const state = (lastAgo, workerAgo) => deskState({
  hasSessionFields: true,
  lastSession: lastAgo == null ? null : { lastActiveMs: NOW - lastAgo },
  workerSession: workerAgo == null ? null : { lastActiveMs: NOW - workerAgo }
}, NOW)

// --- workerModel bound ------------------------------------------------------------------------------------------------
test('workerModel is bounded to 120 characters (a model name, never a config block)', () => {
  assert.equal(toHistoryProfile({ name: 'a', workerModel: 'm'.repeat(500) }).workerModel.length, 120)
  assert.equal(toHistoryProfile({ name: 'a', workerModel: 'm'.repeat(120) }).workerModel.length, 120)
  assert.equal(toHistoryProfile({ name: 'a', workerModel: ` ${'m'.repeat(10)} ` }).workerModel, 'm'.repeat(10))
  assert.equal(toHistoryProfile({ name: 'a' }).workerModel, null)
})

// --- state, scale and layout ------------------------------------------------------------------------------------------
test('a worker session is "working" up to the window included, not one ms later', () => {
  assert.equal(WORKER_LIVE_WINDOW_MS, 120_000)
  assert.equal(state(null, WORKER_LIVE_WINDOW_MS - 1), 'working')
  assert.equal(state(null, WORKER_LIVE_WINDOW_MS), 'working')
  assert.notEqual(state(null, WORKER_LIVE_WINDOW_MS + 1), 'working')
})

test('a human session is "active" up to the window included, not one ms later', () => {
  assert.equal(RECENT_WINDOW_MS, 600_000)
  assert.equal(state(RECENT_WINDOW_MS - 1, null), 'active')
  assert.equal(state(RECENT_WINDOW_MS, null), 'active')
  assert.equal(state(RECENT_WINDOW_MS + 1, null), 'idle')
})

const s = ms => ms / 1000
const desks = (...rows) => buildRoster({ profiles: rows.map(r => ({ last_session: null, worker_session: null, ...r })) }, NOW)
const withRunning = (beat, start = beat) => buildOffice(desks({ name: 'a' }), {
  ok: true, ops: {}, boards: [{ slug: 'b', tasks: [{ id: '1', title: 'T', status: 'running', assignee: 'a', createdAt: s(start), startedAt: s(start), heartbeatAt: s(beat) }] }]
}, NOW).agents[0]

test('a running card is silent only AFTER the silence threshold (5 min pile is not silent)', () => {
  assert.equal(STALE_AFTER_MS, 300_000)
  assert.notEqual(withRunning(NOW - STALE_AFTER_MS).state, 'stale')
  assert.equal(withRunning(NOW - STALE_AFTER_MS).silentMs, null)
  assert.equal(withRunning(NOW - STALE_AFTER_MS - 1000).state, 'stale')
  assert.equal(withRunning(NOW - STALE_AFTER_MS - 1000).silentMs, STALE_AFTER_MS + 1000)
})

test('formatSpan: 59 min 59 s stays in minutes, 3600 s is « 1 h 00 »', () => {
  assert.equal(formatSpan(3_599_000), '60 min')
  assert.equal(formatSpan(3_600_000), '1 h 00')
  assert.equal(formatSpan(3_660_000), '1 h 01')
  assert.equal(formatSpan(60_000), '1 min')
  assert.equal(formatSpan(0), '1 min')
})

test('the model a worker really used counts when its session was active exactly at the card start', () => {
  const agent = (workerActiveMs, startedMs) => ({
    model: 'default-m', provider: 'p', workerModel: 'real-m', workerActiveMs, running: [{ id: '1', board: 'b', startedMs }]
  })
  assert.deepEqual(modelOf(agent(1000, 1000), null).actual, { model: 'real-m' })      // pile on the start: fresh
  assert.deepEqual(modelOf(agent(1001, 1000), null).actual, { model: 'real-m' })
  assert.equal(modelOf(agent(999, 1000), null).actual, null)                          // an earlier card's session
})

test('the compact flag is false at scale 1.6 exactly and true just under', () => {
  const at = k => fitScale({ availW: 100 * k, availH: 100 * k, W: 100, H: 100, dpr: 1 })
  assert.equal(at(1.6).scale, 1.6)
  assert.equal(at(1.6).compact, false)
  assert.equal(at(1.5).scale, 1.5)
  assert.equal(at(1.5).compact, true)
})

test('the scene scale never goes above 4, however big the pane', () => {
  assert.equal(fitScale({ availW: 10_000, availH: 10_000, W: 100, H: 100, dpr: 1 }).scale, 4)
  assert.equal(fitScale({ availW: 400, availH: 400, W: 100, H: 100, dpr: 1 }).scale, 4)
  assert.equal(fitScale({ availW: 399, availH: 399, W: 100, H: 100, dpr: 1 }).scale, 3.9)
})

const rowsFor = boardCount => {
  const boards = Array.from({ length: boardCount }, (_, i) => ({
    slug: `b${i}`, tasks: [{ id: `t${i}`, title: 'x', status: 'todo', assignee: null, createdAt: s(NOW - 1000 * (i + 1)) }]
  }))
  const office = buildOffice(desks({ name: 'a' }), { ok: true, boards, ops: {} }, NOW)
  return layoutScene(toSceneModel(office, { nowMs: NOW })).rows
}

test('the pods are packed in 1, 2, 3 then 4 rows as the boards multiply (the 4-row option is really considered)', () => {
  assert.equal(rowsFor(1), 1)
  assert.equal(rowsFor(4), 1)
  assert.equal(rowsFor(5), 2)
  assert.equal(rowsFor(8), 2)         // 8 boards: the case the product supports
  assert.equal(rowsFor(16), 3)
  assert.equal(rowsFor(40), 4)        // only reachable if `r` runs up to min(4, boards)
})

test('an idle agent is sleepy after 24 h, not at 24 h pile', () => {
  const sleepy = ago => toSceneModel(buildOffice([{ name: 'a', state: 'idle', lastActivityMs: NOW - ago }], { ok: true, boards: [], ops: {} }, NOW), { nowMs: NOW }).agents[0].sleepy
  assert.equal(sleepy(86_400_000 - 1), false)
  assert.equal(sleepy(86_400_000), false)
  assert.equal(sleepy(86_400_000 + 1), true)
})
