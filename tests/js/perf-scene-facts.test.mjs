import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sceneFacts } from '../../src/core/hud.js'
import { buildOffice } from '../../src/core/office.js'
import { buildRoster } from '../../src/core/roster.js'
import { toSceneModel } from '../../src/scene/index.js'

// ===== the fingerprint of the scene holds what the scene draws, and nothing that moves at every read =====
{
const D = 86_400_000
const T0 = new Date(2026, 10, 9, 10, 0, 0).getTime()
const s = ms => ms / 1000

const desks = (nowMs, working = false) => buildRoster({
  profiles: ['alpha', 'beta', 'gamma'].map((name, i) => ({
    name, description: 'Build and test the web pages', last_session: { id: `s${i}`, last_active: s(nowMs - 3 * D) },
    ...(working && i === 0 ? { worker_session: { id: 'w', last_active: s(nowMs) - 5 } } : {})
  }))
}, nowMs)
const card = (id, status, assignee, extra = {}) => ({ id, title: `Card ${id}`, status, assignee, createdAt: s(T0 - 3 * D), ...extra })
const live = (cards, extra = {}) => ({
  ok: true, at: s(T0),
  boards: [
    { slug: 'website', createdAt: s(T0 - 60 * D), tasks: cards },
    { slug: 'demostore', createdAt: s(T0 - 30 * D), tasks: [card('d1', 'done', 'beta')] }
  ],
  ops: { gateway: { state: 'running', platforms: [{ name: 'chat', state: 'connected' }] }, crons: [{ name: 'nightly', profile: 'alpha', enabled: true }] },
  ...extra
})
const running = (hb, extra = {}) => card('r1', 'running', 'alpha', { startedAt: s(T0 - 3_600_000), heartbeatAt: s(hb), ...extra })
const base = [card('t1', 'done', 'alpha'), running(T0 - 10_000)]
const facts = (body, { nowMs = T0, extras = {}, working = true } = {}) => sceneFacts(toSceneModel(buildOffice(desks(nowMs, working), body, nowMs), { nowMs, night: false, ...extras }))

test('720 reads where only `at` and the heartbeats move: the same fingerprint, and a small one', () => {
  const first = facts(live(base))
  for (let r = 1; r < 720; r++) {
    const now = T0 + (r % 11) * 5000   // the same minute: the wall clock does not move
    const body = live([card('t1', 'done', 'alpha'), running(now - (r % 7) * 1000 - 500)], { at: s(now) })
    assert.equal(facts(body, { nowMs: now }), first, `read ${r}`)
  }
  const many = Array.from({ length: 3000 }, (_, i) => card(`c${i}`, i < 12 ? 'running' : 'done', `${['alpha', 'beta', 'gamma'][i % 3]}`, { heartbeatAt: s(T0 - i) }))
  assert.ok(facts(live(many)).length < 2_000, 'it does not grow with the cards')
})

// each fact the scene draws changes the fingerprint
const DRAWN = {
  'the state of a bot': () => facts(live(base), { working: false }),
  'a card finishes (the counts of the whiteboard and of the island)': () => facts(live([card('t1', 'done', 'alpha'), running(T0, { status: 'done', completedAt: s(T0) })])),
  'a card is blocked (the desk, the island, the bot waits)': () => facts(live([card('t1', 'done', 'alpha'), card('b1', 'blocked', 'beta')])),
  'a card appears': () => facts(live([...base, card('n1', 'todo', null)])),
  'a board appears': () => facts({ ...live(base), boards: [...live(base).boards, { slug: 'docs', createdAt: s(T0), tasks: [card('x1', 'done', 'gamma')] }] }),
  'the creation date of a board (its hue)': () => facts({ ...live(base), boards: live(base).boards.map(b => (b.slug === 'demostore' ? { ...b, createdAt: s(T0 - 90 * D) } : b)) }),
  'the wall clock moves a minute': () => facts(live(base), { nowMs: T0 + 61_000 }),
  'night falls': () => facts(live(base), { extras: { night: true } }),
  'the decor': () => facts(live(base), { extras: { decor: { sober: false, incidentBoards: ['website'] } } }),
  'a poster': () => facts(live(base), { extras: { decor: { sober: false, posters: [{ motif: 'sun', title: 'A' }] } } }),
  'the seating': () => facts(live(base), { extras: { seating: { mode: 'model', pairs: [{ a: 'alpha', b: 'beta' }] } } }),
  'a profile description (the outfit)': () => facts(live(base), { extras: { profiles: { alpha: { description: 'Review pull requests and audit security', skills: [], roleOverride: 'reviewer' } } } }),
  'the gateway goes down': () => facts(live(base, { ops: { gateway: { state: 'stopped', platforms: [] }, crons: [] } })),
  'a platform disconnects': () => facts(live(base, { ops: { gateway: { state: 'running', platforms: [{ name: 'chat', state: 'retrying' }] }, crons: [] } })),
  'a cron fails': () => facts(live(base, { ops: { gateway: { state: 'running', platforms: [{ name: 'chat', state: 'connected' }] }, crons: [{ name: 'nightly', profile: 'alpha', enabled: true, failure_streak: 2 }] } })),
  'a cron is paused': () => facts(live(base, { ops: { gateway: { state: 'running', platforms: [{ name: 'chat', state: 'connected' }] }, crons: [{ name: 'nightly', profile: 'alpha', enabled: false }] } })),
  'no agent half (roster only)': () => sceneFacts(toSceneModel(buildOffice(desks(T0), null, T0), { nowMs: T0, night: false }))
}
const BASE = facts(live(base))
for (const [name, f] of Object.entries(DRAWN)) {
  test(`a fact the scene draws changes the fingerprint: ${name}`, () => assert.notEqual(f(), BASE))
}

test('what the scene does not draw does not: heartbeats, start and creation dates of cards, titles, the selection, the next run of a cron', () => {
  assert.equal(facts(live([card('t1', 'done', 'alpha'), running(T0 - 20_000, { startedAt: s(T0 - 7_200_000), title: 'Another title' })])), BASE)
  assert.equal(facts(live(base), { extras: { selected: 'alpha' } }), BASE, 'the selection is painted separately')
  const withCron = lastRun => live(base, { ops: { gateway: { state: 'running', platforms: [{ name: 'chat', state: 'connected' }] }, crons: [{ name: 'nightly', profile: 'alpha', enabled: true, last_run_at: lastRun, next_run_at: lastRun + 600 }] } })
  assert.equal(facts(withCron(s(T0 - 600_000))), facts(withCron(s(T0 - 5_000))))
})

test('the silent state still appears and disappears on time (a card quiet for 5 minutes, a bot gone stale), then goes with the next sign', () => {
  const HB = T0 - 4 * 60_000   // the last sign of a card
  const fp = (nowMs, cards, working) => sceneFacts({ ...toSceneModel(buildOffice(desks(nowMs, working), live(cards), nowMs), { nowMs, night: false }), nowMs: 0 })   // the wall clock aside
  // a working bot with two cards, one of which stops giving signs: the silence of that card is on its desk after 5 minutes, not before
  const two = nowMs => [card('t1', 'done', 'alpha'), running(HB), card('r2', 'running', 'alpha', { startedAt: s(T0 - 3_600_000), heartbeatAt: s(nowMs - 20_000) })]
  const fresh = fp(HB + 4 * 60_000, two(HB + 4 * 60_000), true)
  assert.equal(fp(HB + 5 * 60_000, two(HB + 5 * 60_000), true), fresh, 'exactly 5 minutes: not yet')
  assert.notEqual(fp(HB + 5 * 60_000 + 1000, two(HB + 5 * 60_000 + 1000), true), fresh, 'the sign of silence appears past 5 minutes')
  const back = [card('t1', 'done', 'alpha'), running(HB + 6 * 60_000 - 20_000), card('r2', 'running', 'alpha', { startedAt: s(T0 - 3_600_000), heartbeatAt: s(HB + 6 * 60_000 - 20_000) })]
  assert.equal(fp(HB + 6 * 60_000, back, true), fresh, 'the card gives a sign again: the silence disappears')
  // a bot at rest whose only card went silent turns stale
  const one = [card('t1', 'done', 'alpha'), running(HB)]
  const ok = fp(HB + 4 * 60_000, one, false)
  assert.equal(fp(HB + 5 * 60_000, one, false), ok)
  assert.notEqual(fp(HB + 5 * 60_000 + 1000, one, false), ok, 'stale appears')
  assert.equal(fp(HB + 6 * 60_000, [card('t1', 'done', 'alpha'), running(HB + 6 * 60_000 - 10_000)], false), ok, 'and goes with the next sign')
})
}
