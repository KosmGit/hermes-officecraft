import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STALE_AFTER_MS, buildOffice, summarizeOffice, toBoard, toOps } from '../../src/core/office.js'
import { buildRoster, toDesk } from '../../src/core/roster.js'
import { modelOf } from '../../src/core/models.js'
import { tipOf } from '../../src/core/tips.js'
import { readFileSync } from 'node:fs'
import { GATEWAY_STATES, isGatewayDegraded, isGatewayDown, isGatewayKnown, isGatewayUp } from '../../src/core/gateway.js'
import { EVENT_KINDS } from '../../src/core/panel.js'
import { lastTouch, num, str, trimmed } from '../../src/core/util.js'
import { gatewayDegraded, gatewayDown, gatewayKnown } from '../../src/scene/model.js'

// ===== office =====
{
const NOW = 1_800_000_000_000
const s = ms => ms / 1000
const desks = (...rows) => buildRoster({ profiles: rows.map(r => ({ last_session: null, worker_session: null, ...r })) }, NOW)
const live = (boards, ops = {}) => ({ ok: true, boards, ops })
const task = (id, status, assignee, extra = {}) => ({ id, title: `T ${id}`, status, assignee, createdAt: s(NOW - 3_600_000), ...extra })

test('without the agent half the office is roster-only: no boards, everyone in the hall', () => {
  const office = buildOffice(desks({ name: 'a' }, { name: 'b' }), null, NOW)
  assert.equal(office.mode, 'roster')
  assert.deepEqual(office.boards, [])
  assert.equal(office.hall.length, 2)
  assert.equal(office.ops, null)
  assert.equal(buildOffice(desks({ name: 'a' }), { ok: false }, NOW).mode, 'roster')
})

test('home board = board of the most recently touched card', () => {
  const office = buildOffice(desks({ name: 'a' }), live([
    { slug: 'old', tasks: [task('1', 'done', 'a', { completedAt: s(NOW - 9e6) })] },
    { slug: 'new', tasks: [task('2', 'todo', 'a', { createdAt: s(NOW - 1000) })] }
  ]), NOW)
  assert.equal(office.agents[0].home, 'new')
  assert.equal(office.hall.length, 0)
})

test('blocked card -> waiting; silent running card -> stale; a live worker stays working', () => {
  const old = s(NOW - STALE_AFTER_MS - 60_000)
  const office = buildOffice(desks(
    { name: 'w' },
    { name: 's' },
    { name: 'live', worker_session: { id: 'x', source: 'kanban', last_active: s(NOW - 10_000) } },
    { name: 'fresh' }
  ), live([{ slug: 'b', tasks: [
    task('1', 'blocked', 'w'),
    task('2', 'running', 's', { startedAt: old, heartbeatAt: old }),
    task('3', 'running', 'live', { startedAt: old, heartbeatAt: old }),
    task('4', 'running', 'fresh', { startedAt: old, heartbeatAt: s(NOW - 20_000) })
  ] }]), NOW)
  const by = Object.fromEntries(office.agents.map(a => [a.name, a]))
  assert.equal(by.w.state, 'waiting')
  assert.equal(by.s.state, 'stale')
  assert.ok(by.s.silentMs > STALE_AFTER_MS)
  assert.equal(by.live.state, 'working')
  assert.notEqual(by.fresh.state, 'stale')
})

test('two running cards: the freshest signal decides', () => {
  const office = buildOffice(desks({ name: 'a' }), live([{ slug: 'b', tasks: [
    task('1', 'running', 'a', { heartbeatAt: s(NOW - 9e6) }),
    task('2', 'running', 'a', { heartbeatAt: s(NOW - 5_000) })
  ] }]), NOW)
  assert.notEqual(office.agents[0].state, 'stale')
})

test('junk in /live never throws', () => {
  const office = buildOffice(desks({ name: 'a' }), live([null, { slug: 'x', tasks: [null, { id: 'n' }, 7, task('ok', 'todo', 'ghost')] }], { gateway: 'nope', crons: [null, { enabled: true }] }), NOW)
  assert.equal(office.boards[1].total, 1)   // the board with one valid card; cards for unknown profiles are kept on the board
  assert.equal(office.agents[0].home, null)
  assert.equal(office.ops.gateway, null)
  assert.deepEqual(office.ops.crons, [])
})

test('board counts and summary', () => {
  const b = toBoard({ slug: 'x', tasks: [task('1', 'done', 'a'), task('2', 'blocked', 'a'), task('3', 'todo', null)] })
  assert.equal(b.total, 3)
  assert.equal(b.done, 1)
  assert.equal(b.open.length, 2)
  assert.equal(b.blocked.length, 1)
  const office = buildOffice(desks({ name: 'a' }), live([{ slug: 'x', tasks: [task('1', 'blocked', 'a')] }]), NOW)
  const c = summarizeOffice(office)
  assert.equal(c.waiting, 1)
  assert.equal(c.blocked, 1)
  assert.equal(c.open, 1)
})

test('crons are keyed by profile and name; failing and paused are told apart', () => {
  const ops = toOps({ gateway: { state: 'stopped', platforms: [{ name: 'telegram', state: 'connected' }] }, crons: [
    { name: 'digest', profile: 'a', enabled: true, last_status: 'ok' },
    { name: 'digest', profile: 'b', enabled: true, failure_streak: 2 },
    { name: 'paused', profile: 'a', enabled: true, paused_at: 1 }
  ] })
  assert.equal(ops.gateway.up, false)
  assert.equal(ops.gateway.down, true)
  assert.equal(toOps({ gateway: { state: 'degraded' } }).gateway.down, false)
  assert.equal(toOps({ gateway: { state: 'starting' } }).gateway.down, false)
  assert.deepEqual(ops.crons.map(c => c.key), ['a/digest', 'b/digest', 'a/paused'])
  assert.deepEqual(ops.crons.map(c => c.failing), [false, true, false])
  assert.equal(ops.crons[2].enabled, false)
})

test('roster keeps role hints and this plugin\'s ui_meta, never the path', () => {
  const [d] = desks({ name: 'a', path: '/secret', description: 'x'.repeat(400), skill_count: 3, ui_meta: { 'hermes-officecraft': { role: 'designer' }, other: { a: 1 } } })
  assert.equal(d.description.length, 280)
  assert.equal(d.skillCount, 3)
  assert.deepEqual(d.officeMeta, { role: 'designer' })
  assert.ok(!JSON.stringify(d).includes('/secret'))
})

test('a blocked card wins over a silent run (the decision is yours)', () => {
  const old = s(NOW - STALE_AFTER_MS - 60_000)
  const office = buildOffice(desks({ name: 'a' }), live([{ slug: 'b', tasks: [task('1', 'blocked', 'a'), task('2', 'running', 'a', { heartbeatAt: old })] }]), NOW)
  assert.equal(office.agents[0].state, 'waiting')
  assert.ok(office.agents[0].silentMs > STALE_AFTER_MS)
})
}

// ===== office =====
{
// Behaviour tests of the pure office model (slugs, gateway / display name).
const task = (id, status = 'ready') => ({ id, title: id, status })

test('boards without a slug or with a repeated one get distinct slugs, and keep all their cards', () => {
  const office = buildOffice([], {
    ok: true,
    boards: [{ tasks: [task('a')] }, { tasks: [task('b'), task('c')] }, { slug: 'real', tasks: [] }, { slug: 'real', tasks: [task('d')] }, { slug: 5, tasks: [] }]
  })
  const slugs = office.boards.map(b => b.slug)
  assert.deepEqual(slugs, ['board', 'board-2', 'real', 'real-2', 'board-3'])
  assert.deepEqual(office.boards.map(b => b.total), [1, 2, 0, 1, 0])
})

test('distinct slugs are left untouched', () => {
  const live = { ok: true, boards: [{ slug: 'one', tasks: [] }, { slug: 'two', tasks: [] }] }
  assert.deepEqual(buildOffice([], live).boards.map(b => b.slug), ['one', 'two'])
})

// Behaviour that no other test guards.
test('a gateway in startup_failed or stopped is down, not degraded; degraded is not down', () => {
  assert.equal(toOps({ gateway: { state: 'startup_failed' } }).gateway.down, true)
  assert.equal(toOps({ gateway: { state: 'stopped' } }).gateway.down, true)
  assert.equal(toOps({ gateway: { state: 'degraded' } }).gateway.down, false)
  assert.equal(toOps({ gateway: { state: 'degraded' } }).gateway.degraded, true)
  assert.equal(toOps({ gateway: { state: 'running' } }).gateway.up, true)
  assert.equal(toOps({ gateway: { state: 'running' } }).gateway.down, false)
})

test('the mail tooltip counts the platforms and those connected', () => {
  const office = buildOffice([], { ok: true, boards: [], ops: { gateway: { state: 'running', platforms: [{ name: 'telegram', state: 'connected' }, { name: 'discord', state: 'retrying' }] }, crons: [] } })
  assert.deepEqual(tipOf({ kind: 'mail' }, office).fact, ['tip.mail', 2, 1, 1])
})

test('the label of a desk is display_name when there is one, the profile name otherwise', () => {
  assert.equal(toDesk({ name: 'a', display_name: 'Alice' }).label, 'Alice')
  assert.equal(toDesk({ name: 'a' }).label, 'a')
  assert.equal(toDesk({ name: 'a', display_name: '  ' }).label, 'a')
})

test('modelOf takes the agent only (the unused `office` parameter is gone)', () => {
  assert.equal(modelOf.length, 1)
})
}

// ===== office =====
{
// Two boards whose newest cards of an agent have the same date. The seat is the board of its running
// card, then the first slug in alphabetical order (never the order the boards happen to be listed in).
const NOW = 1_800_000_000_000
const s = ms => ms / 1000
const desks = buildRoster({ profiles: [{ name: 'a', last_session: null, worker_session: null }] }, NOW)
const T = s(NOW - 3_600_000)
const card = (id, status, extra = {}) => ({ id, title: `T ${id}`, status, assignee: 'a', createdAt: T, ...extra })
const homeOf = boards => buildOffice(desks, { ok: true, boards, ops: {} }, NOW).agents[0].home

test('a tie goes to the board of the running card', () => {
  assert.equal(homeOf([{ slug: 'alpha', tasks: [card('1', 'todo')] }, { slug: 'zeta', tasks: [card('2', 'running', { startedAt: T })] }]), 'zeta')
  assert.equal(homeOf([{ slug: 'zeta', tasks: [card('2', 'running', { startedAt: T })] }, { slug: 'alpha', tasks: [card('1', 'todo')] }]), 'zeta')
})
test('without a running card, a tie goes to the first slug in alphabetical order, whatever the list order', () => {
  assert.equal(homeOf([{ slug: 'zeta', tasks: [card('1', 'todo')] }, { slug: 'alpha', tasks: [card('2', 'todo')] }]), 'alpha')
  assert.equal(homeOf([{ slug: 'alpha', tasks: [card('1', 'todo')] }, { slug: 'zeta', tasks: [card('2', 'todo')] }]), 'alpha')
})
test('a newer card still wins over both rules', () => {
  assert.equal(homeOf([{ slug: 'alpha', tasks: [card('1', 'todo')] }, { slug: 'zeta', tasks: [card('2', 'todo', { createdAt: T + 60 })] }]), 'zeta')
})
}

// ===== office =====
{
// One definition of the gateway states and of the small helpers; the event kinds agree with the agent half.
test('office, scene and tooltips agree on every gateway state (one definition)', () => {
  for (const state of [...GATEWAY_STATES, 'weird', null, undefined, '']) {
    const gw = toOps({ gateway: { state } }).gateway
    const ops = { gateway: gw }
    assert.equal(gw.down, isGatewayDown(state), `${state}: office down`)
    assert.equal(gw.degraded, isGatewayDegraded(state), `${state}: office degraded`)
    assert.equal(gw.up, isGatewayUp(state), `${state}: office up`)
    assert.equal(gatewayDown(ops), gw.down, `${state}: scene down`)
    assert.equal(gatewayDegraded(ops), gw.degraded, `${state}: scene degraded`)
    assert.equal(gatewayKnown(ops), isGatewayKnown(state), `${state}: scene known`)
    const fact = tipOf({ kind: 'gateway' }, { ops }).fact[0]
    assert.equal(fact, `tip.gateway.${isGatewayKnown(state) ? state : 'unknown'}`, `${state}: tooltip`)
  }
  assert.deepEqual([...GATEWAY_STATES].filter(isGatewayDown), ['stopped', 'startup_failed'])
  assert.equal(isGatewayDown('starting'), false, 'starting is not an outage')
})

test('shared helpers keep their behaviour (str keeps spaces, trimmed trims)', () => {
  assert.equal(str('  a '), '  a ')
  assert.equal(str(5), '')
  assert.equal(trimmed('  a '), 'a')
  assert.equal(trimmed(null), '')
  assert.equal(num(3), 3)
  assert.equal(num(NaN), null)
  assert.equal(num('3'), null)
  assert.equal(lastTouch({ completedMs: 5, startedMs: 9, createdMs: 1 }), 9)
  assert.equal(lastTouch({}), 0)
})

test('EVENT_KINDS of the page equals EVENT_KINDS of the agent half (hermes_officecraft/snapshot.py, read only)', () => {
  const py = readFileSync(new URL('../../hermes_officecraft/snapshot.py', import.meta.url), 'utf8')
  const m = py.match(/^EVENT_KINDS = \(([^)]*)\)/m)
  assert.ok(m, 'EVENT_KINDS tuple found in snapshot.py')
  const kinds = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1])
  assert.deepEqual([...EVENT_KINDS], kinds)
})
}
