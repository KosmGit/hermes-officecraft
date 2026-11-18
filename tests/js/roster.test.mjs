import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RECENT_WINDOW_MS, WORKER_LIVE_WINDOW_MS, buildRoster, sessionToOpen, summarize, toDesk, withNonEmptySessions } from '../../src/core/roster.js'
import { toMs } from '../../src/core/time.js'
import { toHistoryProfile } from '../../src/core/history.js'

// ===== roster =====
{
const NOW = 1_800_000_000_000
const sec = ms => ms / 1000

const row = (name, extra = {}) => ({ name, path: `/secret/${name}`, model: 'm', last_session: null, worker_session: null, ...extra })

test('toMs accepts epoch seconds and milliseconds, rejects junk', () => {
  assert.equal(toMs(1_700_000_000), 1_700_000_000_000)
  assert.equal(toMs(1_700_000_000_123), 1_700_000_000_123)
  assert.equal(toMs('1700000000'), 1_700_000_000_000)
  for (const bad of [null, undefined, 0, -1, NaN, 'x', {}]) assert.equal(toMs(bad), null)
})

test('fresh worker heartbeat means working', () => {
  const desk = toDesk(row('a', { worker_session: { id: 'w1', source: 'kanban', last_active: sec(NOW - 30_000) } }), NOW)
  assert.equal(desk.state, 'working')
})

test('stale worker heartbeat is not working', () => {
  const desk = toDesk(row('a', { worker_session: { id: 'w1', last_active: sec(NOW - WORKER_LIVE_WINDOW_MS - 1) } }), NOW)
  assert.equal(desk.state, 'idle')
})

test('recent human session means active, old one idle, none new', () => {
  const recent = toDesk(row('a', { last_session: { id: 's', last_active: sec(NOW - 60_000) } }), NOW)
  const old = toDesk(row('b', { last_session: { id: 's', last_active: sec(NOW - RECENT_WINDOW_MS - 1) } }), NOW)
  const none = toDesk(row('c'), NOW)
  assert.deepEqual([recent.state, old.state, none.state], ['active', 'idle', 'new'])
})

test('rows without session fields are unknown, never invented', () => {
  assert.equal(toDesk({ name: 'x' }, NOW).state, 'unknown')
})

test('private fields never reach a desk', () => {
  const desk = toDesk(row('a', { soul: 'S', last_session: { id: 's', preview: 'secret text', last_active: sec(NOW) } }), NOW)
  const json = JSON.stringify(desk)
  for (const leak of ['/secret/', 'secret text', 'soul']) assert.ok(!json.includes(leak), leak)
})

test('buildRoster tolerates malformed results', () => {
  for (const bad of [null, undefined, {}, { profiles: 'x' }, { profiles: [null, 1, {}, { name: '  ' }] }]) {
    assert.deepEqual(buildRoster(bad, NOW), [])
  }
})

test('buildRoster dedupes and sorts busiest first', () => {
  const desks = buildRoster(
    {
      profiles: [
        row('idle', { last_session: { id: 's', last_active: sec(NOW - 3_600_000) } }),
        row('worker', { worker_session: { id: 'w', last_active: sec(NOW - 1_000) } }),
        row('worker'),
        row('fresh')
      ]
    },
    NOW
  )
  assert.deepEqual(desks.map(d => d.name), ['worker', 'idle', 'fresh'])
})

test('summarize counts each state and handles 0 and 30 agents', () => {
  assert.equal(summarize([]).total, 0)
  const many = buildRoster({ profiles: Array.from({ length: 30 }, (_, i) => row(`p${i}`)) }, NOW)
  const counts = summarize(many)
  assert.equal(counts.total, 30)
  assert.equal(counts.new, 30)
})

test('sessionToOpen targets the human session with its profile', () => {
  const desk = toDesk(row('a', { last_session: { id: 's1', message_count: 4, last_active: sec(NOW) } }), NOW)
  assert.deepEqual(sessionToOpen(desk), { id: 's1', profile: 'a' })
  assert.equal(sessionToOpen(toDesk(row('b'), NOW)), null)
})

// A last_session can be a blank « Untitled session » (message_count 0, no title):
// a live button would open an empty tab. A session is offered only when Hermes says it holds messages.
test('sessionToOpen refuses an empty or unmeasured session, counts what a reader shows', () => {
  const at = { last_active: sec(NOW) }
  const open = extra => sessionToOpen(toDesk(row('a', { last_session: { id: 's', title: '', ...at, ...extra } }), NOW))
  assert.equal(open({ message_count: 0 }), null, 'blank chat: nothing to open')
  assert.equal(open({}), null, 'no count at all: not proven, not offered')
  assert.equal(open({ message_count: 'x' }), null)
  assert.equal(open({ message_count: -1 }), null)
  assert.equal(open({ message_count: 5, live_message_count: 0 }), null, 'folded rows only: a reader shows nothing')
  assert.deepEqual(open({ message_count: 0, live_message_count: 2 }), { id: 's', profile: 'a' })
  assert.deepEqual(open({ message_count: 7 }), { id: 's', profile: 'a' })
  // a worker session is never the target (no count in profiles.list, denied from the conversation lists by Hermes)
  const w = toDesk(row('w', { last_session: null, worker_session: { id: 'k', source: 'kanban', last_active: sec(NOW) } }), NOW)
  assert.equal(sessionToOpen(w), null)
  assert.equal(w.workerSession.messages, undefined)
})
}

// ===== roster =====
{
// « Open the session » opens the real conversation (the newest non-empty one /history serves), and the night replay
// keeps a night set from one hour to the same hour (24 h).
const NOW = 1_800_000_000_000
const sec = ms => ms / 1000
const row = (name, extra = {}) => ({ name, ...extra })
const blank = { id: 'blank', title: '', message_count: 0, last_active: sec(NOW) }
const real = { id: 'real', title: 'A real chat', message_count: 12, last_active: sec(NOW - 3600_000) }
const hist = (name, lastNonEmptySession) => ({ ok: true, profiles: { [name]: toHistoryProfile({ name, lastNonEmptySession }) } })

test('toHistoryProfile keeps the newest non-empty session as an id, a title, a time and a count (never a preview)', () => {
  const p = toHistoryProfile({ name: 'default', lastNonEmptySession: { ...real, preview: 'SECRET' } })
  assert.deepEqual(p.lastNonEmptySession, { id: 'real', title: 'A real chat', lastActiveMs: NOW - 3600_000, messages: 12 })
  assert.ok(!JSON.stringify(p).includes('SECRET'), 'the preview is dropped')
  for (const bad of [null, undefined, 'x', {}, { id: '', message_count: 3 }, { id: 'a', message_count: 0 }, { id: 'a', message_count: -2 }, { id: 'a' }, { id: 'a', message_count: '5' }]) {
    assert.equal(toHistoryProfile({ name: 'a', lastNonEmptySession: bad }).lastNonEmptySession, null, JSON.stringify(bad))
  }
  assert.equal(toHistoryProfile({ name: 'old agent half' }).lastNonEmptySession, null, 'an older agent half serves nothing: null')
})

test('default (blank last_session) opens its real conversation; an older agent half keeps the earlier behaviour', () => {
  const desk = toDesk(row('default', { last_session: blank }), NOW)
  assert.equal(sessionToOpen(desk), null, 'a blank chat is never opened')
  const [withReal] = withNonEmptySessions([desk], hist('default', real))
  assert.deepEqual(sessionToOpen(withReal), { id: 'real', profile: 'default' })
  assert.equal(desk.nonEmptySession, undefined, 'the desk itself is not mutated')
  // no data (an older agent half: nothing served, or /history down): the same array comes back, nothing is offered
  const agents = [desk]
  assert.equal(withNonEmptySessions(agents, hist('default', null)), agents)
  assert.equal(withNonEmptySessions(agents, { ok: false }), agents)
  assert.equal(withNonEmptySessions(agents, null), agents)
  assert.equal(sessionToOpen(withNonEmptySessions(agents, hist('default', null))[0]), null)
  // sessionToOpen itself never offers an empty or anonymous fallback, whoever built the desk
  for (const bad of [{ id: 'x', messages: 0 }, { id: '', messages: 4 }, { id: 'x' }, { id: 'x', messages: null }]) {
    assert.equal(sessionToOpen({ ...desk, nonEmptySession: bad }), null, JSON.stringify(bad))
  }
})

test('the listed session wins when it holds messages; the fallback is by name and never from another bot', () => {
  const desk = toDesk(row('a', { last_session: { id: 'live', title: 't', message_count: 3, last_active: sec(NOW) } }), NOW)
  const [x] = withNonEmptySessions([desk], hist('a', real))
  assert.deepEqual(sessionToOpen(x), { id: 'live', profile: 'a' })
  const other = toDesk(row('b', { last_session: blank }), NOW)
  const [y] = withNonEmptySessions([other], hist('a', real))
  assert.equal(sessionToOpen(y), null, 'bot b gets nothing from the history of bot a')
  // a bot with no session at all and a non-empty one in the history (listing hid it): still opens it
  const none = toDesk(row('c'), NOW)
  assert.deepEqual(sessionToOpen(withNonEmptySessions([none], hist('c', real))[0]), { id: 'real', profile: 'c' })
})
}
