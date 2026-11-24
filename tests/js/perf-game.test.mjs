import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildOffice } from '../../src/core/office.js'
import { buildRoster } from '../../src/core/roster.js'
import { computeGame } from '../../src/core/game.js'
import { gameClock, gameInputsKey, gameOffice } from '../../src/core/gamekey.js'

// ===== the game is recomputed when what it reads changes, not at every /live read =====
{
const D = 86_400_000
const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const T0 = at(2026, 11, 9, 10)

const desks = nowMs => buildRoster({
  profiles: ['alpha', 'beta', 'gamma'].map((name, i) => ({
    name, description: 'Build and test the web pages', last_session: { id: `s${i}`, last_active: (nowMs - 3 * D) / 1000 },
    ...(i === 0 ? { worker_session: { id: 'w', last_active: nowMs / 1000 - 5 } } : {})
  }))
}, nowMs)

const task = (id, status, assignee, extra = {}) => ({
  id, title: `Card ${id}`, status, assignee, createdAt: (T0 - 20 * D) / 1000,
  ...(status === 'done' ? { completedAt: (T0 - D) / 1000 } : {}), ...extra
})
/** A /live body as the SDK hands it out: a fresh object per read, with a timestamp and the heartbeats of the running cards. */
const body = (nowMs, { cards = [], extra = {} } = {}) => ({
  ok: true, at: nowMs / 1000,
  boards: [{ slug: 'website', createdAt: (T0 - 60 * D) / 1000, tasks: [task('t1', 'done', 'alpha'), task('t2', 'running', 'alpha', { startedAt: nowMs / 1000 - 3600, heartbeatAt: nowMs / 1000 - 3 }), task('t3', 'todo', null), ...cards] }],
  ...extra
})
const history = {
  ok: true,
  profiles: { alpha: { name: 'alpha', stats: { firstSeenMs: T0 - 30 * D, inputTokens: 10, cacheReadTokens: 1 } }, beta: { name: 'beta', stats: { firstSeenMs: T0 - 2 * D, inputTokens: 10, cacheReadTokens: 1 } } },
  boards: [{ slug: 'website', runs: [{ profile: 'alpha', outcome: 'completed', startedMs: T0 - D, endedMs: T0 - D + 60_000 }], events: [{ task: 't1', kind: 'completed', ms: T0 - D }] }]
}
const keyAt = (nowMs, o = {}) => gameInputsKey(buildOffice(desks(nowMs), body(nowMs, o), nowMs), nowMs, history)

test('719 reads where only `at` and the heartbeats move: one key, so one computation', () => {
  const first = keyAt(T0)
  let calls = 0
  let prev = null
  for (let r = 0; r < 720; r++) {
    const key = keyAt(T0 + r * 5000)
    if (key !== prev) calls++
    prev = key
  }
  assert.equal(calls, 1)
  assert.equal(prev, first)
})

test('a real change gives another key: a card passes done, a card appears, a bot starts working, an assignee or a title changes', () => {
  const base = keyAt(T0)
  const withTasks = f => { const o = buildOffice(desks(T0), body(T0), T0); f(o.boards[0].tasks); return gameInputsKey(o, T0, history) }
  const cases = {
    'a card passes done': tasks => { tasks.find(t => t.id === 't2').status = 'done'; tasks.find(t => t.id === 't2').completedMs = T0 },
    'a card is archived': tasks => { tasks.find(t => t.id === 't3').status = 'archived' },
    'a card completes at another time': tasks => { tasks.find(t => t.id === 't1').completedMs += 1 },
    'a card is reassigned': tasks => { tasks.find(t => t.id === 't3').assignee = 'beta' },
    'a card pins a model': tasks => { tasks.find(t => t.id === 't3').modelOverride = 'example/model-large' },
    'a card is renamed': tasks => { tasks.find(t => t.id === 't3').title = 'Review the docs' },
    'a card is a guard': tasks => { tasks.find(t => t.id === 't3').guard = true },
    'a card appears': tasks => { tasks.push({ id: 't9', title: 'New', status: 'todo', assignee: null, createdMs: T0 }) }
  }
  for (const [name, f] of Object.entries(cases)) assert.notEqual(withTasks(f), base, name)
  const agent = f => { const o = buildOffice(desks(T0), body(T0), T0); f(o.agents); return gameInputsKey(o, T0, history) }
  assert.notEqual(agent(a => { a[0].state = 'idle' }), base, 'the bot stops working: the mascot')
  assert.notEqual(agent(a => { a[1].description = 'Review pull requests' }), base, 'what dresses a bot is read by the role trophies')
  assert.notEqual(agent(a => { a[1].roleOverride = 'reviewer' }), base)
})

test('what the game never reads does not move the key: heartbeats, start dates, silence, the state word of a bot that does not work', () => {
  const base = keyAt(T0)
  const o = buildOffice(desks(T0), body(T0), T0)
  const t = o.boards[0].tasks.find(x => x.id === 't2')
  t.heartbeatMs += 12_345; t.startedMs += 1; t.providerOverride = 'example'
  o.agents[1].silentMs = 999_000; o.agents[1].state = 'stale'; o.agents[1].lastActivityMs = T0
  o.agents[2].state = 'waiting'
  o.ops = { gateway: { state: 'degraded' }, crons: [] }
  assert.equal(gameInputsKey(o, T0 + 5000, history), base)
})

test('the clock: the local day, the night, the age of the oldest profile and the recruits each move the key; the seconds do not', () => {
  const base = keyAt(at(2026, 11, 9, 10, 0))
  assert.equal(keyAt(at(2026, 11, 9, 10, 0) + 55 * 60_000), base, 'the same day, still the day')
  assert.notEqual(keyAt(at(2026, 11, 10, 10, 0)), base, 'the local day changes')
  assert.notEqual(keyAt(at(2026, 11, 9, 23, 59)), keyAt(at(2026, 11, 10, 0, 1)), 'midnight')
  assert.notEqual(keyAt(at(2026, 11, 9, 5, 59)), keyAt(at(2026, 11, 9, 6, 1)), 'the night ends at 6 h')
  // the oldest profile is 30 days old at T0: its 31st day starts 24 h after
  const c = n => JSON.stringify(gameClock(history, T0 + n))
  assert.equal(JSON.stringify(gameClock(history, T0))[0], '[')
  assert.notEqual(gameClock(history, T0)[2], gameClock(history, T0 + D)[2])
  assert.equal(gameClock(history, T0)[2], gameClock(history, T0 + D - 1)[2])
  assert.ok(c(0).length > 0)
  // beta is a recruit for 7 days from its first sighting (2 days before T0)
  assert.deepEqual(gameClock(history, T0)[3], ['beta'])
  assert.deepEqual(gameClock(history, T0 + 5 * D - 1)[3], ['beta'])
  assert.deepEqual(gameClock(history, T0 + 5 * D)[3], [])
  assert.deepEqual(gameClock(null, T0), [gameClock(history, T0)[0], false, null, []])
})

test('the key stands in for the office: the game computed from what the key keeps is the game computed from the whole office', () => {
  const nowMs = T0
  const live = body(nowMs, { cards: [task('t4', 'blocked', 'beta'), task('t5', 'done', 'beta', { guard: true })] })
  live.boards.push({ slug: 'sandbox-test', tasks: [task('s1', 'done', 'alpha')] })
  const office = buildOffice(desks(nowMs), live, nowMs)
  for (const when of [nowMs, nowMs + 3 * D, at(2026, 11, 10, 3), at(2026, 12, 25, 12)]) {
    assert.deepEqual(computeGame(history, gameOffice(office), when, {}, []), computeGame(history, office, when, {}, []), new Date(when).toISOString())
  }
})

test('the game is memoised on the key, /history, sober and the extra definitions only (page wiring)', () => {
  const page = readFileSync(new URL('../../src/ui/OfficePage.jsx', import.meta.url), 'utf8')
  assert.match(page, /const gameKey = useMemo\(\(\) => gameInputsKey\(liveOffice, liveNow, history\.data \?\? null\), \[liveOffice, liveNow, history\.data\]\)/)
  assert.match(page, /computeGame\(history\.data \?\? null, liveOffice, liveNow, \{ sober \}, command\)[^\n]*\[history\.data, gameKey, sober, command, unreadable\]/)
})
}
