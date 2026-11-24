// Replay in the office. Pure logic (src/core/replay.js) on invented facts: the state at T, the edge cases of the fold (a card created
// then archived, a deleted agent, a deleted board), the night's summary (a window that passes midnight, the time zone and the DST days),
// the journal, and what the replay forbids (no order on the past) and stops (the page's own polling).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { orderReducer, initialOrderState } from '../../src/core/orders.js'
import { summarizeOffice } from '../../src/core/office.js'
import {
  DEFAULT_NIGHT, FACT_KINDS, GROUPS, SILENCE_MS, cardsAt, clampCursor, clockLabel, cursorKey, density, filterJournal, groupOf, journalFacets,
  journalOf, journalView, liveAt, livePollMs, nightSummary, nightWindow, normalizeNight, officeAt, orderAllowed, replayKeyExits, replayPollNeeded,
  stepFact, toReplay, windowFor
} from '../../src/core/replay.js'
import { messages } from '../../src/i18n/index.js'
import { layoutScene, buildBase, drawScene, toSceneModel } from '../../src/scene/index.js'

const src = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const S = 1000
/** A fixed instant, in seconds: 2026-11-12 19:00 UTC. */
const T0 = Date.UTC(2026, 10, 12, 19, 0, 0) / 1000
const at = (h, m = 0) => T0 + h * 3600 + m * 60   // seconds, `h` hours after 19:00 UTC

/** An invented /replay body: two boards, a card created then archived, a silent run, a blocked card, orders and crons. */
function body(extra = {}) {
  return {
    ok: true, at: at(14), from: at(0), to: at(12),
    boards: [
      {
        slug: 'alpha', since: at(-200),
        start: [['t_open', 'running', 'writer'], ['t_wait', 'blocked', 'seo']],
        cards: { t_open: 'Open card', t_wait: 'Waiting card', t_new: 'New card', t_tmp: 'Temp card', t_dep: 'Dep card' },
        facts: [
          [at(1), 't_new', 'created', 'todo', null],
          [at(1, 5), 't_new', 'assigned', null, 'writer'],
          [at(2), 't_new', 'claimed', 'running', null],
          [at(3), 't_open', 'completed', 'done', null],
          [at(3, 30), 't_new', 'completed', 'done', null],
          [at(4), 't_tmp', 'created', 'todo', null],
          [at(5), 't_tmp', 'archived', 'archived', null],
          [at(6), 't_wait', 'unblocked', 'ready', null],
          [at(7), 't_new', 'blocked', 'blocked', 'needs_input'],
          [at(7, 10), 't_dep', 'blocked', 'todo', 'dependency'],
          [at(8), 't_new', 'crashed', null, null],
          [at(9, 50), 't_wait', 'assigned', null, 'ghost'],
          [at(10), 't_wait', 'claimed', 'running', null],
          [at(9), 't_new', 'commented', null, null]
        ],
        runs: [
          { start: at(-1), end: at(3), profile: 'writer', task: 't_open', outcome: 'completed', usage: { apiCalls: 12, tokens: { input: 1000, output: 200 } } },
          { start: at(2), end: at(3, 30), profile: 'writer', task: 't_new', outcome: 'completed', usage: null, why: 'no_calls' },
          { start: at(10), end: null, profile: 'ghost', task: 't_wait', outcome: null, usage: null, why: 'no_session_link' }
        ],
        silences: [['writer', 't_open', at(1), at(2, 30)]]
      },
      {
        slug: 'beta', since: at(6),   // this board only exists from 6 h on
        start: [],
        cards: { t_b: 'Beta card' },
        facts: [[at(6, 30), 't_b', 'created', 'ready', null], [at(7), 't_b', 'claimed', 'running', null], [at(7, 40), 't_b', 'completed', 'done', null]],
        runs: [{ start: at(7), end: at(7, 40), profile: 'seo', task: 't_b', outcome: 'completed', usage: { apiCalls: 3, tokens: { input: 50, output: 9 } } }],
        silences: []
      }
    ],
    orders: [[at(4), 'unblock', 'done', 'alpha', 't_wait', '', '', 'page'], [at(8), 'comment', 'refused', 'alpha', 't_new', '', '', 'agent']],
    sessions: [['seo', 'desktop', at(5), null]],
    crons: [['default', 'backup', at(9), 1], ['default', 'backup', at(11), 0]],
    truncated: null, partial: [],
    ...extra
  }
}
const R = () => toReplay(body())
const desks = names => names.map(name => ({ name, label: name, state: 'idle', lastActivityMs: 1, description: '', officeMeta: {}, lastSession: null, workerSession: null }))
const ms = (h, m = 0) => at(h, m) * S

/* ---------- the body ---------- */

test('toReplay: seconds become milliseconds, what is not a fact is dropped, a bad body is not ok', () => {
  const r = R()
  assert.equal(r.ok, true)
  assert.equal(r.fromMs, ms(0))
  assert.equal(r.toMs, ms(12))
  assert.equal(r.boards[0].facts[0].ms, ms(1))
  assert.equal(r.boards[0].runs[2].endMs, null, 'an open run has no end')
  assert.equal(r.crons[0].ok, true)
  assert.equal(r.crons[1].ok, false)
  const dirty = toReplay(body({ boards: [{ slug: 'x', facts: [['nope'], [at(1), 't', 'created', 'weird-status', null], 7], runs: [{}], cards: { a: 1 } }, { nope: true }], orders: [1], crons: [[]] }))
  assert.equal(dirty.boards.length, 1)
  assert.equal(dirty.boards[0].facts.length, 1)
  assert.equal(dirty.boards[0].facts[0].to, null, 'an unknown status is not kept')
  assert.equal(Object.keys(dirty.boards[0].cards).length, 0)
  for (const bad of [null, {}, { ok: false }, { ok: true, boards: 'x', from: 1, to: 2 }, { ok: true, boards: [] }]) assert.equal(toReplay(bad).ok, false)
})

/* ---------- the fold: the cards at T ---------- */

test('cardsAt: the start snapshot, then the facts up to T (and not after)', () => {
  const [alpha] = R().boards
  const byId = t => Object.fromEntries(cardsAt(alpha, t).map(c => [c.id, c]))
  assert.deepEqual(Object.keys(byId(ms(0))).sort(), ['t_open', 't_wait'])
  assert.equal(byId(ms(0)).t_open.status, 'running')
  assert.equal(byId(ms(3)).t_open.status, 'done', 'a fact exactly at T counts')
  assert.equal(byId(ms(2, 59)).t_open.status, 'running', 'one minute before it does not')
  assert.equal(byId(ms(6)).t_wait.status, 'ready')
  assert.equal(byId(ms(7)).t_new.status, 'blocked')
  assert.equal(byId(ms(7, 10)).t_dep.status, 'todo', 'a dependency block is not a human block')
})

test('a card created then archived: there between the two, not before, not after', () => {
  const [alpha] = R().boards
  const has = t => cardsAt(alpha, t).some(c => c.id === 't_tmp')
  assert.equal(has(ms(3, 59)), false)
  assert.equal(has(ms(4)), true)
  assert.equal(has(ms(4, 59)), true)
  assert.equal(has(ms(5)), false, 'archived cards are not listed, like /live')
  assert.equal(has(ms(12)), false)
})

test('the assignee at T: the start snapshot, `created`, an `assigned` fact, else the profile of the run', () => {
  const [alpha] = R().boards
  const who = (t, id) => cardsAt(alpha, t).find(c => c.id === id)?.assignee
  assert.equal(who(ms(0), 't_open'), 'writer', 'the start snapshot')
  assert.equal(who(ms(1), 't_new'), null, 'created without an agent, no run yet')
  assert.equal(who(ms(1, 5), 't_new'), 'writer', 'an `assigned` fact')
  assert.equal(who(ms(11), 't_wait'), 'ghost', 'no assigned fact: the profile of the run that started on it')
})

test('a card created in the window carries its agent (`created.payload.assignee`)', () => {
  const r = toReplay(body({ boards: [{
    slug: 'a', since: at(-1), start: [], cards: { t_c: 'Created with an agent', t_n: 'Created without one' },
    facts: [
      [at(1), 't_c', 'created', 'blocked', 'default'],
      [at(2), 't_n', 'created', 'ready', null],
      [at(3), 't_n', 'claimed', 'running', null]
    ],
    runs: [{ start: at(3), end: null, profile: 'writer', task: 't_n', outcome: null, usage: null, why: 'no_session_link' }],
    silences: []
  }] }))
  const who = (t, id) => cardsAt(r.boards[0], t).find(c => c.id === id)?.assignee
  assert.equal(who(ms(0), 't_c'), undefined, 'not created yet')
  assert.equal(who(ms(1), 't_c'), 'default', 'the agent of the creation, before any run')
  assert.equal(who(ms(2, 30), 't_c'), 'default', 'and it stays until an `assigned` fact says otherwise')
  assert.equal(who(ms(2), 't_n'), null, 'created without an agent: nobody')
  assert.equal(who(ms(3), 't_n'), 'writer', 'created without an agent: the profile of the run, as before')
  const j = journalOf(r)
  assert.equal(j.find(e => e.kind === 'created' && e.task === 't_c').profile, 'default', 'the journal names the agent of the creation')
  assert.equal(j.find(e => e.kind === 'created' && e.task === 't_n').profile, null)
  assert.ok(filterJournal(j, { agent: 'default', all: true }).some(e => e.kind === 'created' && e.task === 't_c'),
    'the « Agent » filter of the journal keeps the fact of a card created with an agent')
})


test('titles are the current ones, a card without a title shows its id (it was deleted since)', () => {
  const r = toReplay(body({ boards: [{ slug: 'a', since: at(-1), start: [['t_gone', 'todo', null]], cards: {}, facts: [], runs: [], silences: [] }] }))
  assert.equal(cardsAt(r.boards[0], ms(1))[0].title, 't_gone')
})

/* ---------- the office at T ---------- */

test('officeAt: at work, silent, waiting, resting, each from the facts', () => {
  const r = R()
  const roster = desks(['writer', 'seo', 'idle'])
  const state = (t, name) => officeAt(roster, r, t).agents.find(a => a.name === name)?.state
  // 00:00: writer's run is open (and not silent yet), seo's card is blocked
  assert.equal(state(ms(0, 30), 'writer'), 'working')
  assert.equal(state(ms(0, 30), 'seo'), 'waiting')
  assert.equal(state(ms(0, 30), 'idle'), 'idle')
  // 01:30: writer's run has been silent since 01:00 (a silence covers it) -> silent, not working
  assert.equal(state(ms(1, 30), 'writer'), 'stale')
  // 02:30: the silence is over (the run beat again) and writer is at work on two cards
  assert.equal(state(ms(2, 30), 'writer'), 'working')
  // 06:00: seo's card was unblocked -> nobody waits
  assert.equal(state(ms(6), 'seo'), 'idle')
  // 07:20: seo works on the beta board
  assert.equal(state(ms(7, 20), 'seo'), 'working')
  assert.equal(state(ms(7, 50), 'seo'), 'idle', 'the run ended')
})

test('officeAt: the tags the scene writes come out right (the run, the span, the blocked card)', () => {
  const r = R()
  const o = officeAt(desks(['writer', 'seo']), r, ms(2, 30))
  const w = o.agents.find(a => a.name === 'writer')
  // at 02:30 both cards are running (t_open completes at 03:00, t_new was claimed at 02:00)
  assert.deepEqual(w.running.map(c => c.id).sort(), ['t_new', 't_open'])
  assert.ok(w.running.every(c => c.status === 'running'))
  const o0 = officeAt(desks(['writer', 'seo']), r, ms(0, 30))
  const seo = o0.agents.find(a => a.name === 'seo')
  assert.equal(seo.blocked.length, 1)
  assert.equal(seo.blocked[0].title, 'Waiting card')
  assert.equal(o0.mode, 'full')
  assert.equal(o0.ops.gateway, null, 'nothing about the gateway is known in the past')
})

test('a silent run is stale with its silence measured at T, and a working agent wins over a silent run of another card', () => {
  const r = R()
  const o = officeAt(desks(['writer']), r, ms(1, 30))
  const w = o.agents[0]
  assert.equal(w.state, 'stale')
  assert.ok(w.silentMs > SILENCE_MS, 'more than five minutes')
  assert.ok(w.silentMs < SILENCE_MS + 31 * 60_000)
})

test('a deleted agent is not a desk any more (its facts stay in the journal), a profile of a run that is not listed is not drawn', () => {
  const r = R()
  const o = officeAt(desks(['writer', 'seo']), r, ms(11))   // `ghost` runs on t_wait at 10:00 and has no desk
  assert.deepEqual(o.agents.map(a => a.name), ['writer', 'seo'])
  assert.ok(journalOf(r).some(e => e.profile === 'ghost'))
})

test('a deleted board is not replayed, and a board that did not exist yet at T is absent', () => {
  const r = R()
  assert.deepEqual(officeAt(desks(['writer']), r, ms(5)).boards.map(b => b.slug), ['alpha'], 'beta only exists from 6 h')
  assert.deepEqual(officeAt(desks(['writer']), r, ms(8)).boards.map(b => b.slug), ['alpha', 'beta'])
  const gone = toReplay(body({ boards: [body().boards[1]] }))   // alpha deleted: no events, no runs, nothing
  assert.deepEqual(officeAt(desks(['writer']), gone, ms(8)).boards.map(b => b.slug), ['beta'])
  const none = toReplay(body({ boards: [] }))
  const empty = officeAt(desks(['writer']), none, ms(8))
  assert.equal(empty.boards.length, 0)
  assert.equal(empty.agents[0].home, null, 'with no board the agent is in the common room')
})

test('an agent that never ran stays « new », one without session fields stays « unknown »', () => {
  const o = officeAt([{ ...desks(['x'])[0], state: 'new' }, { ...desks(['y'])[0], state: 'unknown' }], R(), ms(1))
  assert.deepEqual(o.agents.map(a => a.state), ['new', 'unknown'])
})

test('liveAt: archived cards are not served, a silent run carries its last sign of life', () => {
  const { live, working, silent } = liveAt(R(), ms(1, 30))
  const alpha = live.boards.find(b => b.slug === 'alpha')
  assert.ok(!alpha.tasks.some(t => t.status === 'archived'))
  const open = alpha.tasks.find(t => t.id === 't_open')
  assert.ok(open.heartbeatAt != null)
  assert.ok(ms(1, 30) / S - open.heartbeatAt > 300)
  assert.deepEqual([...silent], ['writer'])
  assert.deepEqual([...working], [])
})

test('the counts at T equal summarizeOffice of the same state (header numbers)', () => {
  const c = summarizeOffice(officeAt(desks(['writer', 'seo']), R(), ms(0, 30)))
  assert.equal(c.working, 1)
  assert.equal(c.waiting, 1)
  assert.equal(c.blocked, 1)
})

/* ---------- the window of the night ---------- */

const fixed = minutes => () => minutes
/** The offset of an IANA zone at an instant, in minutes: what the browser's own clock gives, made testable. */
const zone = tz => atMs => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(atMs).map(p => [p.type, p.value]))
  return Math.round((Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(atMs / 1000) * 1000) / 60_000)
}
const berlin = zone('Europe/Berlin')
const iso = t => new Date(t).toISOString().slice(0, 16)

test('nightWindow: 19 h – 7 h passes midnight; in the morning it is last night, complete', () => {
  const now = Date.UTC(2026, 10, 13, 8, 30)   // 09:30 in Berlin (UTC+1)
  const w = nightWindow(now, DEFAULT_NIGHT, berlin)
  assert.equal(iso(w.from), '2026-11-12T18:00')   // 19:00 Berlin
  assert.equal(iso(w.to), '2026-11-13T06:00')     // 07:00 Berlin
  assert.equal(w.ongoing, false)
})

test('nightWindow: during the night it lasts until now; just after the evening start it began at 19 h today', () => {
  const during = nightWindow(Date.UTC(2026, 10, 13, 1, 15), DEFAULT_NIGHT, berlin)   // 02:15 Berlin
  assert.equal(iso(during.from), '2026-11-12T18:00')
  assert.equal(iso(during.to), '2026-11-13T01:15', 'to = now')
  assert.equal(iso(during.end), '2026-11-13T06:00')
  assert.equal(during.ongoing, true)
  const evening = nightWindow(Date.UTC(2026, 10, 13, 18, 30), DEFAULT_NIGHT, berlin)   // 19:30 Berlin
  assert.equal(iso(evening.from), '2026-11-13T18:00')
  const before = nightWindow(Date.UTC(2026, 10, 13, 17, 30), DEFAULT_NIGHT, berlin)   // 18:30 Berlin: last night is the latest that began
  assert.equal(iso(before.from), '2026-11-12T18:00')
  assert.equal(before.ongoing, false)
})

test('nightWindow: the zone decides the hours (the same instant is another night elsewhere), a window that does not pass midnight ends the same day', () => {
  const now = Date.UTC(2026, 10, 13, 3, 0)
  assert.equal(iso(nightWindow(now, DEFAULT_NIGHT, fixed(0)).from), '2026-11-12T19:00')
  assert.equal(iso(nightWindow(now, DEFAULT_NIGHT, fixed(-480)).from), '2026-11-13T03:00', 'UTC-8: 19:00 local is 03:00 UTC (the night begins at this very instant)')
  assert.equal(iso(nightWindow(now, DEFAULT_NIGHT, fixed(330)).from), '2026-11-12T13:30', 'UTC+5:30')
  const day = nightWindow(Date.UTC(2026, 10, 13, 12, 0), { from: 1, to: 5 }, fixed(0))
  assert.equal(iso(day.from), '2026-11-13T01:00')
  assert.equal(iso(day.end), '2026-11-13T05:00')
  assert.equal(day.ongoing, false)
})

test('nightWindow on the days the clocks change: the night is 13 h long when they go back, 11 h when they go forward', () => {
  const back = nightWindow(Date.UTC(2026, 9, 25, 12, 0), DEFAULT_NIGHT, berlin)   // Berlin: 25 Oct 2026, 03:00 CEST -> 02:00 CET
  assert.equal(iso(back.from), '2026-10-24T17:00')   // 19:00 CEST
  assert.equal(iso(back.end), '2026-10-25T06:00')    // 07:00 CET
  assert.equal((back.end - back.from) / 3_600_000, 13)
  const forward = nightWindow(Date.UTC(2027, 2, 28, 12, 0), DEFAULT_NIGHT, berlin)   // Berlin: 28 Mar 2027, 02:00 CET -> 03:00 CEST
  assert.equal(iso(forward.from), '2027-03-27T18:00')   // 19:00 CET, the 27th
  assert.equal(iso(forward.end), '2027-03-28T05:00')    // 07:00 CEST
  assert.equal((forward.end - forward.from) / 3_600_000, 11)
})

test('the night setting: whole hours, the same hour twice is a 24 h night, anything else is the default', () => {
  assert.deepEqual(normalizeNight({ from: 22, to: 6 }), { from: 22, to: 6 })
  for (const bad of [null, undefined, {}, { from: 24, to: 3 }, { from: -1, to: 3 }, { from: 1.5, to: 3 }, { from: '19', to: 7 }]) assert.deepEqual(normalizeNight(bad), { from: 19, to: 7 })
  const w = nightWindow(Date.UTC(2026, 10, 13, 12, 0), { from: 99, to: 5 }, fixed(0))
  assert.equal(iso(w.from), '2026-11-12T19:00', 'an invalid setting is the default, not an empty window')
  // 0 -> 0 and 7 -> 7 are kept and mean 24 h, from that hour to the same hour the next day (the selectors show what is replayed)
  for (const h of [0, 7, 19]) {
    assert.deepEqual(normalizeNight({ from: h, to: h }), { from: h, to: h }, `${h} -> ${h} is kept`)
    const at = Date.UTC(2026, 10, 13, 12, 0)
    const n = nightWindow(at, { from: h, to: h }, fixed(0))
    assert.equal((n.end - n.from) / 3_600_000, 24, `${h} -> ${h}: a 24 h window`)
    assert.ok(n.from <= at && at <= n.end && n.to === Math.min(n.end, at), `${h} -> ${h}: the latest window that has begun`)
  }
  assert.equal(iso(nightWindow(Date.UTC(2026, 10, 13, 12, 0), { from: 0, to: 0 }, fixed(0)).from), '2026-11-13T00:00')
  assert.equal(iso(nightWindow(Date.UTC(2026, 10, 13, 12, 0), { from: 7, to: 7 }, fixed(0)).from), '2026-11-13T07:00')
})

test('windowFor: the night, 24 h and 7 days; never more than the 7 days the route accepts', () => {
  const now = Date.UTC(2026, 10, 13, 8, 0)
  assert.equal(windowFor('24h', now).to - windowFor('24h', now).from, 86_400_000)
  const week = windowFor('7d', now)
  assert.ok(week.to - week.from <= 7 * 86_400_000)
  assert.equal(windowFor('night', now, DEFAULT_NIGHT, fixed(0)).kind, 'night')
  assert.equal(windowFor('whatever', now, DEFAULT_NIGHT, fixed(0)).kind, 'night')
})

test('clockLabel: HH:MM on 24 h in the zone asked, with the weekday on long windows', () => {
  const t = Date.UTC(2026, 10, 13, 2, 5)
  assert.equal(clockLabel(t, 'en', { tz: 'Europe/Berlin' }), '03:05')
  assert.equal(clockLabel(t, 'fr', { tz: 'Europe/Berlin' }), '03:05')
  assert.equal(clockLabel(t, 'es', { tz: 'America/Los_Angeles' }), '18:05')
  assert.match(clockLabel(t, 'en', { tz: 'Europe/Berlin', day: true }), /Fri/)
  assert.match(clockLabel(t, 'en', { tz: 'Europe/Berlin', day: true }), / 03:05$/)
  // a 7-day window starts and ends on the same weekday (measured: « Fri 08:31 → Fri 08:31 »): the day of the month tells them apart
  for (const lang of ['en', 'fr', 'es']) {
    const a = clockLabel(t - 7 * 86_400_000, lang, { tz: 'Europe/Berlin', day: true })
    const b = clockLabel(t, lang, { tz: 'Europe/Berlin', day: true })
    assert.notEqual(a, b, `${lang}: ${a} / ${b}`)
    assert.match(b, /13/, lang)
    assert.match(a, /\b6\b/, lang)
  }
})

/* ---------- the summary of the night ---------- */

test('nightSummary: counts of recorded facts inside the window only', () => {
  const r = R()
  const s = nightSummary(r, { from: ms(0), to: ms(12), ongoing: false })
  assert.equal(s.done, 3)           // t_open, t_new, t_b
  assert.equal(s.blocked, 1)        // t_new blocked (needs_input); the dependency block is not counted
  assert.equal(s.unblocked, 1)
  assert.equal(s.failures, 1)       // crashed
  assert.equal(s.runs, 3)
  assert.equal(s.silences, 1)
  assert.deepEqual(s.orders, { total: 2, done: 1, refused: 1, failed: 0 })
  assert.deepEqual(s.crons, { ok: 1, failed: 1 })
  assert.equal(s.empty, false)
  const narrow = nightSummary(r, { from: ms(3, 30), to: ms(7), ongoing: false })
  assert.equal(narrow.done, 1, 'only the completion at 03:30 (the one at 03:00 is outside), edges included')
  assert.equal(narrow.blocked, 1, 'a fact exactly at `to` counts')
})

test('nightSummary: usage is summed over the runs that HAVE one; the others are counted apart, never as zero', () => {
  const s = nightSummary(R(), { from: ms(0), to: ms(12) })
  assert.equal(s.usage.runsWith, 1)
  assert.equal(s.usage.runsWithout, 2)
  assert.equal(s.usage.calls, 3, 'only the run of beta carries a recorded usage and started in the window')
  assert.equal(s.usage.input, 50)
  const writer = s.byProfile.find(p => p.profile === 'writer')
  assert.equal(writer.runs, 1, 'the run of t_open started at -1 h: outside the window, only started runs count')
  const ghost = s.byProfile.find(p => p.profile === 'ghost')
  assert.equal(ghost.calls, null, 'a profile whose runs have no usage: unknown, not 0')
  const none = nightSummary(toReplay(body({ boards: [{ ...body().boards[0], runs: body().boards[0].runs.map(r => ({ ...r, usage: null })) }] })), { from: ms(0), to: ms(12) })
  assert.equal(none.usage.calls, null)
  assert.equal(none.usage.input, null)
})

test('nightSummary: a window that passes midnight takes both sides of it and nothing outside', () => {
  // 19:00 UTC .. 07:00 UTC next day; facts at 23:50, 00:10, 06:59 are in; 18:59 and 07:01 are out
  const day = Date.UTC(2026, 10, 12, 0, 0) / 1000
  const f = (h, m) => day + h * 3600 + m * 60
  const r = toReplay({
    ok: true, at: f(40, 0), from: f(18, 0), to: f(32, 0),
    boards: [{ slug: 'a', since: f(0, 0), start: [], cards: { t1: 'x', t2: 'y', t3: 'z', t4: 'w', t5: 'v' }, runs: [], silences: [],
      facts: [[f(18, 59), 't1', 'completed', 'done', null], [f(23, 50), 't2', 'completed', 'done', null], [f(24, 10), 't3', 'completed', 'done', null],
        [f(30, 59), 't4', 'completed', 'done', null], [f(31, 1), 't5', 'completed', 'done', null]] }],
    orders: [], sessions: [], crons: []
  })
  const w = nightWindow(f(34, 0) * 1000, DEFAULT_NIGHT, fixed(0))   // 10:00 UTC on the 13th
  assert.equal(w.from, f(19, 0) * 1000)
  assert.equal(w.to, f(31, 0) * 1000)
  const s = nightSummary(r, w)
  assert.equal(s.done, 3)
  assert.equal(s.buckets.length, 12)
  assert.equal(s.buckets.reduce((n, b) => n + b.done, 0), 3, 'every counted fact falls in a bucket of the chart')
})

test('nightSummary: an empty window says so, and the boards that have no history that far are named (never a silent hole)', () => {
  const s = nightSummary(toReplay(body({ boards: [{ slug: 'young', since: at(8), start: [], cards: {}, facts: [], runs: [], silences: [] }], orders: [], crons: [], sessions: [] })), { from: ms(0), to: ms(12) })
  assert.equal(s.empty, true)
  assert.deepEqual(s.since, [{ slug: 'young', sinceMs: ms(8) }])
  assert.equal(nightSummary(toReplay(body({ truncated: { at: at(5) } })), { from: ms(0), to: ms(12) }).truncatedAt, ms(5))
})

/* ---------- the journal ---------- */

test('journalOf: every fact with its time and its source, oldest first; the agent of a card fact is its assignee at that moment', () => {
  const j = journalOf(R())
  assert.ok(j.every((e, i) => i === 0 || j[i - 1].ms <= e.ms))
  const sources = new Set(j.map(e => e.source))
  assert.deepEqual([...sources].sort(), ['cron', 'kanban', 'orders', 'session', 'silence'])
  const created = j.find(e => e.kind === 'created')
  assert.equal(created.profile, null, 'created carries no assignee: nobody is named')
  const claimed = j.find(e => e.kind === 'claimed' && e.task === 't_new')
  assert.equal(claimed.profile, 'writer')
  assert.equal(claimed.title, 'New card')
  assert.equal(claimed.board, 'alpha')
  assert.ok(j.every(e => e.title == null || typeof e.title === 'string'))
  const sil = j.find(e => e.source === 'silence')
  assert.equal(sil.extra, '90', 'the silence lasted 90 minutes')
  assert.equal(j.find(e => e.group === 'order').source, 'orders')
})

test('filterJournal: by board, by agent, by group; the bookkeeping facts only on request', () => {
  const j = journalOf(R())
  assert.ok(!filterJournal(j, {}).some(e => e.kind === 'commented' || e.kind === 'assigned'), 'bookkeeping hidden by default')
  assert.ok(filterJournal(j, { all: true }).some(e => e.kind === 'commented'))
  assert.ok(filterJournal(j, { board: 'beta' }).every(e => e.board === 'beta'))
  assert.ok(!filterJournal(j, { board: 'beta' }).some(e => e.source === 'cron'), 'a board filter drops what has no board')
  const seo = filterJournal(j, { agent: 'seo', all: true })
  assert.ok(seo.length > 0 && seo.every(e => e.profile === 'seo'))
  assert.deepEqual(filterJournal(j, { group: 'done' }).map(e => e.kind), ['completed', 'completed', 'completed'])
  assert.ok(filterJournal(j, { group: 'card' }).length > 0, 'a group asked for is shown even if it is bookkeeping')
  const facets = journalFacets(j)
  assert.deepEqual(facets.boards, ['alpha', 'beta'])
  assert.ok(facets.agents.includes('ghost') && facets.agents.includes('writer'))
})

test('journalView: newest first around the cursor, later facts dimmed on top, never more than `max` rows, the rest counted', () => {
  const j = filterJournal(journalOf(R()), { all: true })
  const v = journalView(j, ms(5), 100)
  assert.equal(v.rows.length + v.newerHidden + v.olderHidden, j.length)
  const firstNow = v.rows.findIndex(r => !r.future)
  assert.ok(v.rows.slice(0, firstNow).every(r => r.future))
  assert.ok(v.rows.slice(firstNow).every(r => !r.future))
  assert.ok(v.rows.every((r, i) => i === 0 || v.rows[i - 1].ms >= r.ms), 'newest first')
  const few = journalView(j, ms(5), 4, 1)
  assert.equal(few.rows.length, 4)
  assert.equal(few.rows.length + few.newerHidden + few.olderHidden, j.length)
  const big = Array.from({ length: 5000 }, (_, i) => ({ ms: i * 1000, group: 'done', kind: 'completed' }))
  assert.equal(journalView(big, 2_500_000, 120).rows.length, 120, 'a 7-day journal renders 120 rows, not 5000')
})

test('the cursor: clamp, previous / next fact, keys, density strip', () => {
  const r = R()
  assert.equal(clampCursor(ms(-5), r), ms(0))
  assert.equal(clampCursor(ms(99), r), ms(12))
  const j = journalOf(r)
  assert.equal(stepFact(j, ms(3), 1), ms(3, 30))
  assert.equal(stepFact(j, ms(3), -1), ms(2), 'the previous fact, not the one at T')
  assert.equal(stepFact(j, ms(12), 1), null)
  assert.equal(stepFact(j, ms(0), -1), null)
  assert.equal(cursorKey('ArrowLeft', true, ms(5), r), ms(5) - 600_000)
  assert.equal(cursorKey('PageUp', false, ms(5), r), ms(6))
  assert.equal(cursorKey('PageDown', false, ms(0, 30), r), ms(0), 'clamped')
  assert.equal(cursorKey('Home', false, ms(5), r), r.fromMs)
  assert.equal(cursorKey('End', false, ms(5), r), r.toMs)
  assert.equal(cursorKey('ArrowLeft', false, ms(5), r), null, 'a plain arrow is the range input\'s own (1 min)')
  const d = density(j, r.fromMs, r.toMs, 12)
  assert.equal(d.length, 12)
  assert.equal(d.reduce((n, b) => n + b.done, 0), 3)
  assert.equal(d.reduce((n, b) => n + b.block, 0), 1)
})

/* ---------- what the replay forbids and stops ---------- */

test('no order on the past: the reducer refuses every request while the page replays, for every kind of order', () => {
  assert.equal(orderAllowed(true), false)
  assert.equal(orderAllowed(false), true)
  const orders = [
    { verb: 'unblock', board: 'b', task: 't_1', code: 'T1', title: 'x' },
    { verb: 'comment', board: 'b', task: 't_1', code: 'T1', title: 'x' },
    { verb: 'approval', request: 'r_1', choice: 'once', agent: 'a' },
    { verb: 'approval', request: 'r_1', choice: 'deny', agent: 'a' },
    { verb: 'recruit', name: 'newbot' }
  ]
  for (const order of orders) {
    const live = orderReducer(initialOrderState(), { type: 'request', order, now: 0 })
    assert.notEqual(live.phase, 'idle', `${order.verb}: the same request is accepted when live (the guard is not vacuous)`)
    const past = orderReducer(initialOrderState(), { type: 'request', order, now: 0, replay: true })
    assert.equal(past.phase, 'idle', `${order.verb} must not start in a replay`)
    assert.equal(past.order ?? null, null)
    assert.equal(past.notice, 'replay')
  }
})

test('the page wires the guard: every request goes through `ask` with the replay flag, the order bar and the order buttons are not rendered', () => {
  const hook = src('src/data/orders.js')
  assert.match(hook, /useOrders\(ctx, \{ audit: auditOn = false, replay = false \}/)
  assert.match(hook, /type: 'request', order, now: Date\.now\(\), replay: latest\.current\.replay/)
  assert.equal([...hook.matchAll(/type: 'request'/g)].length, 1, 'one place dispatches a request: no door around the guard')
  assert.match(hook, /requestApproval = useCallback\(\(req, choice\) => ask\(/)
  assert.match(hook, /requestRecruit = useCallback\(\(draft, held = null\) => ask\(/)
  const page = src('src/ui/OfficePage.jsx')
  assert.match(page, /useOrders\(ctx, \{ audit: served, replay: replayOn \}\)/)
  assert.match(page, /\{replayOn \? null : <OrderBar /)
  assert.match(page, /orders=\{!replayOn && /)
  assert.match(page, /answer=\{replayOn \? null : orders\}/)
  // the approvals are emptied once (approvalRows) for every use; the header's buttons are props of PageHeader
  assert.match(page, /const approvalRows = replayOn \? \[\] : approvals\.view/)
  assert.match(page, /approvals=\{approvalRows\}/)
  assert.match(page, /recruit=\{roster\.data && !replayOn \? /, 'the recruit button is not offered')
  assert.match(page, /if \(busy\) return/, 'a replay does not start over an order in progress')
  for (const file of ['ReplayBar.jsx', 'ReplayPanel.jsx', 'NightCard.jsx']) assert.doesNotMatch(src(`src/ui/${file}`), /requestApproval|requestRecruit|orders\.request|ctx\.rest|safeRequest|method: 'POST'/, `${file} gives no order`)
  assert.doesNotMatch(src('src/data/replay.js'), /method: 'POST'|method: "POST"/, 'the replay only reads')
})

test('Escape leaves the replay, unless a dialog, the settings or the narrow drawer is open, or the key was already taken', () => {
  assert.equal(replayKeyExits({ key: 'Escape' }), true)
  assert.equal(replayKeyExits({ key: 'Enter' }), false)
  assert.equal(replayKeyExits({ key: 'Escape', dialogOpen: true }), false)
  assert.equal(replayKeyExits({ key: 'Escape', narrow: true, drawerOpen: true }), false)
  assert.equal(replayKeyExits({ key: 'Escape', narrow: false, drawerOpen: true }), true, 'a wide panel is not a drawer')
  assert.equal(replayKeyExits({ key: 'Escape', defaultPrevented: true }), false)
})

test('polling: the page\'s own reads stop while a past moment is shown; the replay reads once, then again only if it can matter', () => {
  assert.equal(livePollMs(true, 5000), false)
  assert.equal(livePollMs(false, 5000), 5000)
  // a window that ended in the past is never read twice; one that ends now matters only with the cursor on the live edge
  assert.equal(replayPollNeeded({ ongoing: false, cursorMs: 100, toMs: 100 }), false)
  assert.equal(replayPollNeeded({ ongoing: true, cursorMs: 0, toMs: 10 * 60_000 }), false, 'cursor far in the past: a new minute changes nothing on screen')
  assert.equal(replayPollNeeded({ ongoing: true, cursorMs: 10 * 60_000 - 60_000, toMs: 10 * 60_000 }), true)
  const page = src('src/ui/OfficePage.jsx')
  assert.match(page, /useRoster\(livePollMs\(replayOn, PAGE_POLL_MS\)\)/)
  assert.match(page, /useLive\(ctx, reads\.includes\('live'\), livePollMs\(replayOn, PAGE_POLL_MS\)\)/)
  assert.match(page, /useHistory\(ctx, reads\.includes\('history'\), livePollMs\(replayOn, HISTORY_POLL_MS\)\)/)
  assert.match(page, /useOrderJournal\(ctx, served, livePollMs\(replayOn, JOURNAL_POLL_MS\)\)/)
  assert.match(page, /poll: !replayOn \}\)/, 'the fiches of the LLM functions are not polled either')
  assert.match(page, /ready: llmShown\.thoughtsReady && !replayOn/, 'no model call about a past moment')
})

test('no request per position of the cursor: the query key and the request carry no cursor, and nothing uses a timer for data', () => {
  const data = src('src/data/replay.js')
  assert.doesNotMatch(data.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, ''), /cursor/i)
  assert.doesNotMatch(data, /setInterval|setTimeout/)
  assert.match(data, /refetchInterval: poll \? REPLAY_POLL_MS : false/)
  assert.match(data, /refetchIntervalInBackground: false/)
  assert.match(data, /refetchOnReconnect: false/)
  assert.match(data, /retry: 1/)
  assert.match(data, /retryDelay: 5_000/)
  assert.ok(Number(data.match(/REPLAY_POLL_MS = ([\d_]+)/)[1].replace(/_/g, '')) >= 5000, 'at most one request per 5 s (it is one a minute)')
  const bar = src('src/ui/ReplayBar.jsx')
  assert.doesNotMatch(bar, /useQuery|ctx\.rest|fetch\(/, 'the bar only moves a number in memory')
})

/* ---------- i18n and sources ---------- */

test('every fact kind the route serves, every group and every window has a sentence in en, fr and es', () => {
  for (const code of ['en', 'fr', 'es']) {
    const m = messages[code].replay
    for (const k of FACT_KINDS) assert.ok(Object.hasOwn(m.fact, k), `${code}: replay.fact.${k}`)
    for (const g of GROUPS) assert.ok(Object.hasOwn(m.journal.group2, g), `${code}: replay.journal.group2.${g}`)
    for (const w of ['night', '24h', '7d']) assert.ok(m.windowKind[w], `${code}: replay.windowKind.${w}`)
  }
  const served = ['created', 'assigned', 'claimed', 'completed', 'blocked', 'block_loop_detected', 'gave_up', 'unblocked', 'promoted', 'promoted_manual', 'dependency_wait', 'specified', 'status', 'scheduled', 'review_requested', 'changes_requested', 'review_reopened', 'archived', 'timed_out', 'crashed', 'rate_limited', 'reclaimed', 'spawn_failed', 'stale', 'reconciled', 'decomposed', 'claim_rejected', 'commented', 'linked', 'unlinked']
  assert.deepEqual([...FACT_KINDS].sort(), served.sort(), 'the page knows exactly the kinds hermes_officecraft/replay.py SERVED_KINDS serves')
  const py = src('hermes_officecraft/replay.py')
  const block = py.slice(py.indexOf('SERVED_KINDS = frozenset(('), py.indexOf('))', py.indexOf('SERVED_KINDS = frozenset((')))
  for (const k of FACT_KINDS) assert.ok(block.includes(`"${k}"`), `${k} is served by the agent half`)
  for (const k of block.matchAll(/"([a-z_]+)"/g)) assert.ok(FACT_KINDS.includes(k[1]), `${k[1]} is served but the page has no sentence for it`)
  assert.equal(groupOf('claimed'), 'start')
  assert.equal(groupOf('whatever'), 'card')
})

test('confidentiality: the page reads no content key from /replay (nothing of a card body, a comment or a message is kept)', () => {
  const core = src('src/core/replay.js')
  for (const forbidden of ['summary', 'last_output', 'worker_output', 'workspace_path', 'preview', 'reason', 'metadata', 'session_id']) assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(core.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')), `${forbidden} is not read`)
  const dirty = toReplay(body({ boards: [{ ...body().boards[0], facts: [[at(1), 't_new', 'blocked', 'blocked', 'needs_input']], runs: [{ start: at(1), end: at(2), profile: 'writer', task: 't_new', outcome: 'completed', summary: 'SECRET-SUMMARY', error: 'SECRET', usage: { apiCalls: 1, tokens: { input: 1, output: 1 }, session_id: 'SECRET-SID' } }], leak: 'SECRET' }], orders: [[at(1), 'unblock', 'done', 'alpha', 't', '', '', 'page', 'SECRET-REASON']] }))
  assert.ok(!JSON.stringify(dirty).includes('SECRET'))
})

/* ---------- performance ---------- */

test('dragging the cursor over 7 days: the state at T and the scene stay cheap (drawScene <= 60 ms, the fold well under a frame)', () => {
  // 7 days: 5000 facts, 8 boards, 12 agents
  const profiles = Array.from({ length: 12 }, (_, i) => `agent${i}`)
  const week = 7 * 86_400
  const base = at(0)
  const boards = Array.from({ length: 8 }, (_, b) => {
    const facts = []
    const runs = []
    const cards = {}
    for (let i = 0; i < 625; i += 1) {
      const id = `t_${b}_${i % 90}`
      cards[id] = `Card ${id}`
      const ts = base + Math.floor((i / 625) * week)
      const kinds = [['created', 'todo'], ['claimed', 'running'], ['blocked', 'blocked'], ['unblocked', 'ready'], ['completed', 'done']]
      const [kind, to] = kinds[i % 5]
      facts.push([ts, id, kind, to, kind === 'blocked' ? 'needs_input' : kind === 'assigned' ? profiles[i % 12] : null])
      if (kind === 'claimed') runs.push({ start: ts, end: ts + 900, profile: profiles[(i + b) % 12], task: id, outcome: 'completed', usage: null, why: 'no_calls' })
    }
    return { slug: `board${b}`, since: base - 1000, start: [], cards, facts, runs, silences: [] }
  })
  const r = toReplay({ ok: true, at: base + week, from: base, to: base + week, boards, orders: [], sessions: [], crons: [] })
  const roster = desks(profiles)
  const cursors = Array.from({ length: 40 }, (_, i) => (base + Math.floor((i / 40) * week)) * S)
  let t0 = performance.now()
  for (const c of cursors) officeAt(roster, r, c)
  const fold = (performance.now() - t0) / cursors.length
  assert.ok(fold < 25, `officeAt took ${fold.toFixed(2)} ms per position`)
  // the scene itself at a few positions, the way the page draws it
  const times = []
  const bases = []
  let warm = false
  for (const c of cursors) {
    const office = officeAt(roster, r, c)
    const model = toSceneModel(office, { nowMs: c, night: false, profiles: {} })
    const layout = layoutScene(model)
    t0 = performance.now()
    const built = buildBase(layout, model)   // rebuilt by the page only when who sits where or a state changes (OfficeScene baseKey)
    bases.push(performance.now() - t0)
    if (!warm) { drawScene(layout, built, model, 0); warm = true }   // JIT warm-up, as in scene.test.mjs
    // best of 3 at each position: the suite runs ~30 files in parallel, a scheduler pause is not the cost of the scene
    let best = Infinity
    for (let k = 0; k < 3; k += 1) {
      t0 = performance.now()
      drawScene(layout, built, model, 0)
      best = Math.min(best, performance.now() - t0)
    }
    times.push(best)
  }
  const sorted = [...times].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const worst = sorted[sorted.length - 1]
  console.log(`  replay 7 days, 12 agents / 8 boards / 5000 facts: officeAt ${fold.toFixed(2)} ms per position, drawScene median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms over ${times.length} positions, buildBase worst ${Math.max(...bases).toFixed(0)} ms`)
  assert.ok(sorted[0] <= 60, `drawScene best position ${sorted[0].toFixed(1)} ms`)   // the machine's load only adds time: the best run is the cost
  assert.ok(worst <= 60, `drawScene worst ${worst.toFixed(1)} ms`)
})
