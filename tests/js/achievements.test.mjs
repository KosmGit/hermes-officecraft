import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ALL_ACHIEVEMENT_IDS, RULES, computeGame, decorOf, journalEntries, medalsOf, trophyTip, unlockAnnouncement, MANY_AT } from '../../src/core/game.js'
import { FAMILIES, NEW_DEFS, REVIEW_TITLE, collectionFamilies, collectionOrder, dayNo, dayRun, hiddenLocked, isReviewCard, streakOf, RULES_V2, dayStart, commandDefs } from '../../src/core/achievements.js'
import { toHistory } from '../../src/core/history.js'
import { readFileSync } from 'node:fs'
import { vitrineView } from '../../src/core/vitrine.js'
import { translate } from '../../src/core/translate.js'
import { messages } from '../../src/i18n/index.js'
import { medalArt } from '../../src/scene/medalart.js'
import { ICON_ART } from '../../src/scene/icons.js'
import { buildBase, drawScene, layoutScene, toSceneModel } from '../../src/scene/index.js'
import { REQUEST_RE, auditBody, requestStamp } from '../../src/core/approvals.js'
import { toJournal } from '../../src/core/orders.js'

// ===== achievements =====
{
/* For EACH achievement and each tier, a case just under the threshold (locked) and one at it (unlocked, date checked). */
const MIN = 60_000
const H = 3_600_000
const D = 86_400_000
const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const NOW = at(2026, 11, 9, 15)
const day = n => NOW - n * D   // n days before NOW, same hour

const task = (id, { status = 'done', done = null, by = null, model = null, title = '' } = {}) => ({ id, status, completedMs: status === 'done' ? done : null, createdMs: NOW - 90 * D, startedMs: null, assignee: by, modelOverride: model, title })
const board = (slug, tasks, createdMs = null) => ({ slug, createdMs, tasks })
const office = (boards = [], agents = []) => ({ boards, agents })
const hb = (slug, { runs = [], events = [], links } = {}) => ({ slug, runs, events, ...(links ? { links } : {}) })
const hist = (boards = [], profiles = {}, extra = {}) => ({ ok: true, profiles, boards, ...extra })
const run = (profile, outcome, endedMs, taskId) => ({ profile, outcome, startedMs: endedMs - MIN, endedMs, ...(taskId ? { task: taskId } : {}) })
const ev = (taskId, kind, ms) => ({ task: taskId, kind, ms })
const prof = (name, { first = null, recent = [], input = 0, cache = 0 } = {}) => ({ name, description: '', skills: { own: [], recent }, stats: { firstSeenMs: first, inputTokens: input, cacheReadTokens: cache } })
const profs = (...ps) => Object.fromEntries(ps.map(p => [p.name, p]))
const ach = (g, id) => g.achievements.find(a => a.id === id)
const play = (h, o, extra) => computeGame(h, o, NOW, {}, extra)
/** A linked chain t0 -> t1 -> ... of n done cards finished one hour apart, oldest at `from`. */
const chainOf = (n, from = day(20), { by = i => null } = {}) => {
  const tasks = Array.from({ length: n }, (_, i) => task(`t${i}`, { done: from + i * H, by: by(i) }))
  const links = tasks.slice(1).map((t, i) => [`t${i}`, t.id])
  return { tasks, links }
}

test('the catalogue: 32 achievements (10 + 22 coded), 3 hidden, 4 reported or discarded, families in order, « command » empty', () => {
  assert.equal(ALL_ACHIEVEMENT_IDS.length, 32)
  assert.equal(new Set(ALL_ACHIEVEMENT_IDS).size, 32)
  const g = play(hist(), office())
  assert.deepEqual(g.achievements.filter(a => a.hidden).map(a => a.id).sort(), ['comeback', 'iron', 'rescue'])
  assert.equal(hiddenLocked(g.achievements), 3)
  assert.ok(g.achievements.every(a => FAMILIES.includes(a.family)))
  assert.deepEqual(collectionFamilies(g.achievements).map(f => f.family), ['chains', 'boards', 'reliability', 'decider', 'team'])   // no « command » while empty
  assert.equal(JSON.stringify(g).includes('undefined'), false)
})

// chains ------------------------------------------------------------------------------------------------------
test('smooth — 9 linked cards in a row do not unlock, 10 do, dated on the completion that makes the 10th', () => {
  const nine = chainOf(9)
  assert.equal(ach(play(hist([hb('b', { links: nine.links })]), office([board('b', nine.tasks)])), 'smooth').unlocked, false)
  assert.deepEqual(ach(play(hist([hb('b', { links: nine.links })]), office([board('b', nine.tasks)])), 'smooth').progress, [9, 10])
  const ten = chainOf(10)
  const a = ach(play(hist([hb('b', { links: ten.links })]), office([board('b', ten.tasks)])), 'smooth')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, day(20) + 9 * H)
})
test('smooth — a `blocked` event on one card breaks the path; a card that is not done breaks it too', () => {
  const ten = chainOf(10)
  const blocked = ach(play(hist([hb('b', { links: ten.links, events: [ev('t4', 'blocked', day(19))] })]), office([board('b', ten.tasks)])), 'smooth')
  assert.equal(blocked.unlocked, false)
  assert.deepEqual(blocked.progress, [5, 10])   // t5..t9 is the longest clean path
  const tasks = ten.tasks.map((t, i) => (i === 9 ? task('t9', { status: 'todo' }) : t))
  assert.equal(ach(play(hist([hb('b', { links: ten.links })]), office([board('b', tasks)])), 'smooth').unlocked, false)
})
test('smooth — a fork is not a path: 10 cards where each parent has one child but cards are split in two branches of 5', () => {
  const t = Array.from({ length: 10 }, (_, i) => task(`t${i}`, { done: day(20) + i * H }))
  const links = [['t0', 't1'], ['t1', 't2'], ['t2', 't3'], ['t3', 't4'], ['t0', 't5'], ['t5', 't6'], ['t6', 't7'], ['t7', 't8'], ['t8', 't9']]
  assert.equal(ach(play(hist([hb('b', { links })]), office([board('b', t)])), 'smooth').unlocked, false)   // longest path: t0 t5..t9 = 6
})
test('architect — 19 linked cards do not unlock, 20 all done do (dated on the last completion), 20 with one open do not', () => {
  const c19 = chainOf(19)
  assert.equal(ach(play(hist([hb('b', { links: c19.links })]), office([board('b', c19.tasks)])), 'architect').unlocked, false)
  const c20 = chainOf(20)
  const a = ach(play(hist([hb('b', { links: c20.links })]), office([board('b', c20.tasks)])), 'architect')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, day(20) + 19 * H)
  const open = c20.tasks.map((t, i) => (i === 7 ? task('t7', { status: 'running' }) : t))
  const o = ach(play(hist([hb('b', { links: c20.links })]), office([board('b', open)])), 'architect')
  assert.equal(o.unlocked, false)
  assert.deepEqual(o.progress, [19, 20])
})
test('teamwork — 3 assignees in a linked group do not unlock, 4 do (dated on the card that brings the 4th)', () => {
  const names = ['ana', 'bob', 'cy', 'dee']
  const three = chainOf(6, day(20), { by: i => names[i % 3] })
  assert.equal(ach(play(hist([hb('b', { links: three.links })]), office([board('b', three.tasks)])), 'teamwork').unlocked, false)
  const four = chainOf(6, day(20), { by: i => names[Math.min(i, 3)] })
  const a = ach(play(hist([hb('b', { links: four.links })]), office([board('b', four.tasks)])), 'teamwork')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, day(20) + 3 * H)
  const split = [task('a', { done: day(5), by: 'ana' }), task('b', { done: day(5), by: 'bob' }), task('c', { done: day(5), by: 'cy' }), task('d', { done: day(5), by: 'dee' })]
  assert.equal(ach(play(hist([hb('b', { links: [['a', 'b']] })]), office([board('b', split)])), 'teamwork').unlocked, false)   // 4 assignees but not in ONE linked group
})
test('chains (smooth, architect, teamwork) are unavailable, never guessed, when the agent half serves no links', () => {
  const ten = chainOf(20)
  const g = play(hist([hb('b')]), office([board('b', ten.tasks)]))
  for (const id of ['smooth', 'architect', 'teamwork']) { assert.equal(ach(g, id).unlocked, false); assert.equal(ach(g, id).unavailable, true) }
})

// boards ------------------------------------------------------------------------------------------------------
test('quickstart — the first card 59 min after the board was created unlocks; 60 min does not (strict); dated on that completion', () => {
  const made = day(30)
  const ok = ach(play(hist(), office([board('b', [task('t1', { done: made + 59 * MIN })], made)])), 'quickstart')
  assert.equal(ok.unlocked, true)
  assert.equal(ok.unlockedMs, made + 59 * MIN)
  assert.equal(ach(play(hist(), office([board('b', [task('t1', { done: made + 60 * MIN })], made)])), 'quickstart').unlocked, false)
  // only the FIRST card counts, and a board without a creation date says nothing
  assert.equal(ach(play(hist(), office([board('b', [task('t1', { done: made + 2 * H }), task('t2', { done: made + 5 * MIN })], made)])), 'quickstart').unlocked, true)
  assert.equal(ach(play(hist(), office([board('b', [task('t1', { done: made + 5 * MIN })], null)])), 'quickstart').unlocked, false)
})
test('wide — cards done on 2 boards the same day do not unlock, on 3 do (dated on the 3rd board); 3 boards on 3 days do not', () => {
  const d = at(2026, 11, 3, 9)
  const mk = (...stamps) => office(stamps.map((s, i) => board(`b${i}`, [task('t', { done: s })])))
  assert.equal(ach(play(hist(), mk(d, d + H)), 'wide').unlocked, false)
  const a = ach(play(hist(), mk(d + 2 * H, d, d + H)), 'wide')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, d + 2 * H)
  assert.equal(ach(play(hist(), mk(d, d + D, d + 2 * D)), 'wide').unlocked, false)
})
test('versatile — a bot with cards done on 2 boards does not unlock, on 3 does (dated on the opening of the 3rd)', () => {
  const b = (slug, stamp, by = 'ana') => board(slug, [task('t', { done: stamp, by })])
  assert.equal(ach(play(hist(), office([b('x', day(9)), b('y', day(8))])), 'versatile').unlocked, false)
  assert.equal(ach(play(hist(), office([b('x', day(9)), b('y', day(8)), b('z', day(7), 'bob')])), 'versatile').unlocked, false)   // 3 boards but 3 different bots
  const a = ach(play(hist(), office([b('x', day(9)), b('y', day(8)), b('z', day(7))])), 'versatile')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, day(7))
})
test('multimodel — one pinned model does not unlock (a card with no override never counts), two different ones on a board do', () => {
  const t = (id, stamp, model) => task(id, { done: stamp, model })
  assert.equal(ach(play(hist(), office([board('b', [t('a', day(9), 'model-a'), t('b', day(8), null)])])), 'multimodel').unlocked, false)
  assert.equal(ach(play(hist(), office([board('b', [t('a', day(9), 'model-a'), t('b', day(8), 'model-a')])])), 'multimodel').unlocked, false)
  const a = ach(play(hist(), office([board('b', [t('a', day(9), 'model-a'), t('b', day(8), 'model-b')])])), 'multimodel')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, day(8))
  assert.equal(ach(play(hist(), office([board('x', [t('a', day(9), 'model-a')]), board('y', [t('b', day(8), 'model-b')])])), 'multimodel').unlocked, false)   // two boards, one model each
})

// reliability -------------------------------------------------------------------------------------------------
test('rescue (hidden) — blocked 24 h then done does not unlock, more than 24 h does (dated on the completion); a card still blocked does not', () => {
  const blockedAt = day(10)
  const run1 = (gap, status = 'done') => play(hist([hb('b', { events: [ev('t', 'blocked', blockedAt), ev('t', 'unblocked', blockedAt + gap)] })]), office([board('b', [task('t', { status, done: blockedAt + gap + H })])]))
  assert.equal(ach(run1(24 * H), 'rescue').unlocked, false)
  const a = ach(run1(24 * H + MIN), 'rescue')
  assert.equal(a.unlocked, true)
  assert.equal(a.hidden, true)
  assert.equal(a.unlockedMs, blockedAt + 24 * H + MIN + H)
  assert.equal(ach(run1(30 * H, 'blocked'), 'rescue').unlocked, false)
  // blocked -> completed straight away also ends the interval
  const direct = play(hist([hb('b', { events: [ev('t', 'blocked', blockedAt), ev('t', 'completed', blockedAt + 25 * H)] })]), office([board('b', [task('t', { done: blockedAt + 25 * H })])]))
  assert.equal(ach(direct, 'rescue').unlocked, true)
})
test('iron (hidden) — 6 clean closed days on a board do not unlock, 7 do (dated on the last run of the 7th day); a crash day or today does not count', () => {
  const runs = n => Array.from({ length: n }, (_, i) => run('ana', 'completed', day(n - i + 1) + (i % 3) * MIN))   // n consecutive past days
  assert.equal(ach(play(hist([hb('b', { runs: runs(6) })]), office()), 'iron').unlocked, false)
  const a = ach(play(hist([hb('b', { runs: runs(7) })]), office()), 'iron')
  assert.equal(a.unlocked, true)
  assert.equal(a.hidden, true)
  assert.equal(a.unlockedMs, runs(7)[6].endedMs)
  const crash = runs(7).map((r, i) => (i === 3 ? { ...r, outcome: 'crashed' } : r))
  assert.equal(ach(play(hist([hb('b', { runs: crash })]), office()), 'iron').unlocked, false)
  // the 7th day is today: not closed yet (6 clean days ending YESTERDAY, then today; runs(6) ends the day before yesterday)
  const withToday = [...runs(6).map(r => ({ ...r, startedMs: r.startedMs + D, endedMs: r.endedMs + D })), run('ana', 'completed', NOW - H)]
  assert.equal(ach(play(hist([hb('b', { runs: withToday })]), office()), 'iron').unlocked, false)
  const half = runs(7)
  assert.equal(ach(play(hist([hb('x', { runs: half.slice(0, 4) }), hb('y', { runs: half.slice(4) })]), office()), 'iron').unlocked, false)   // 7 days but split over two boards: not one board
})
test('ontime — 9 terminal runs in a row do not unlock, 10 do (dated on the 10th); a timeout or a retry of the same card breaks the series', () => {
  const rs = (n, from = day(5)) => Array.from({ length: n }, (_, i) => run('ana', 'completed', from + i * MIN, `t${i}`))
  assert.equal(ach(play(hist([hb('b', { runs: rs(9) })]), office()), 'ontime').unlocked, false)
  const a = ach(play(hist([hb('b', { runs: rs(10) })]), office()), 'ontime')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, day(5) + 9 * MIN)
  const timeout = rs(10).map((r, i) => (i === 4 ? { ...r, outcome: 'timed_out' } : r))
  assert.equal(ach(play(hist([hb('b', { runs: timeout })]), office()), 'ontime').unlocked, false)
  const retry = rs(10).map((r, i) => (i === 6 ? { ...r, task: 't2' } : r))   // the card t2 runs a second time
  assert.equal(ach(play(hist([hb('b', { runs: retry })]), office()), 'ontime').unlocked, false)
  // a crash is not a timeout: it does not break `ontime` (it breaks `zero`)
  const crash = rs(10).map((r, i) => (i === 4 ? { ...r, outcome: 'crashed' } : r))
  assert.equal(ach(play(hist([hb('b', { runs: crash })]), office()), 'ontime').unlocked, true)
  // an agent half that does not give the card of a run: unavailable
  const noTask = rs(10).map(({ task: _t, ...r }) => r)
  const u = ach(play(hist([hb('b', { runs: noTask })]), office()), 'ontime')
  assert.equal(u.unlocked, false)
  assert.equal(u.unavailable, true)
})
test('firstpass — 9 review cards in a row do not unlock, 10 do (dated on the 10th); a `changes_requested` on one breaks the series', () => {
  const rev = (n, by = 'ana') => Array.from({ length: n }, (_, i) => task(`r${i}`, { done: day(10) + i * H, by, title: `Review ${i}` }))
  assert.equal(ach(play(hist([hb('b')]), office([board('b', rev(9))])), 'firstpass').unlocked, false)
  const a = ach(play(hist([hb('b')]), office([board('b', rev(10))])), 'firstpass')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, day(10) + 9 * H)
  assert.equal(ach(play(hist([hb('b', { events: [ev('r3', 'changes_requested', day(9))] })]), office([board('b', rev(10))])), 'firstpass').unlocked, false)
  // the rule: « Review » titles, or an assignee whose detected role is reviewer; a plain card of a plain bot is not a review card
  assert.equal(isReviewCard('Revue du lot A', null), true)
  assert.equal(isReviewCard('Review: lot A', null), true)
  assert.equal(isReviewCard('Revisión del lote', null), true)
  assert.equal(REVIEW_TITLE.test('Reviewing is fun'), false)   // a word that merely starts with « review »
  assert.equal(isReviewCard('Fix the bug', null), false)
  assert.equal(isReviewCard('Fix the bug', 'reviewer'), true)
  const plain = Array.from({ length: 10 }, (_, i) => task(`p${i}`, { done: day(10) + i * H, by: 'ana', title: `Fix ${i}` }))
  assert.equal(ach(play(hist([hb('b')]), office([board('b', plain)])), 'firstpass').unlocked, false)
  const byRole = Array.from({ length: 10 }, (_, i) => task(`p${i}`, { done: day(10) + i * H, by: 'carol', title: `Fix ${i}` }))
  assert.equal(ach(play(hist([hb('b')]), office([board('b', byRole)], [{ name: 'carol', description: '', roleOverride: 'reviewer' }])), 'firstpass').unlocked, true)
})
test('swiss — 29 completed executions of a cron in a row do not unlock, 30 do (UNDATED: the served window slides); a failure resets; no served history is « unavailable »', () => {
  const runs = (n, fail = -1) => Array.from({ length: n }, (_, i) => [day(40) + i * H, i === fail ? 0 : 1])   // [ms, 1 | 0]: what toHistory gives
  const withCrons = list => hist([], {}, { crons: list })
  assert.equal(ach(play(withCrons([{ profile: 'default', name: 'nightly', runs: runs(29) }]), office()), 'swiss').unlocked, false)
  const g = play(withCrons([{ profile: 'default', name: 'nightly', runs: runs(30) }]), office())
  const a = ach(g, 'swiss')
  assert.equal(a.unlocked, true)
  // the 30th of the newest 120 executions is not the real 30th success and moves with each run — no date, no journal line
  assert.equal(a.dated, false)
  assert.equal(a.unlockedMs, null)
  assert.equal(journalEntries(g).some(e => e.id === 'swiss'), false)
  assert.deepEqual(trophyTip(a, { lang: 'fr' }).when, ['game.tip.undated'])
  assert.deepEqual(a.fact, ['game.fact.swiss', 'nightly', 30])
  assert.equal(ach(play(withCrons([{ profile: 'default', name: 'nightly', runs: runs(31, 10) }]), office()), 'swiss').unlocked, false)   // 10 + 20
  const u = ach(play(hist(), office()), 'swiss')
  assert.equal(u.unavailable, true)
  assert.equal(u.unlocked, false)
})

// tiers -------------------------------------------------------------------------------------------------------
test('zero — bronze 20, silver 50, gold 100 runs in a row: each tier just under and at its threshold, each dated on its own run', () => {
  const rs = n => Array.from({ length: n }, (_, i) => run('ana', 'completed', day(60) + i * MIN))
  const g = n => ach(play(hist([hb('b', { runs: rs(n) })]), office()), 'zero')
  assert.equal(g(19).unlocked, false)
  assert.equal(g(19).tier, null)
  assert.equal(g(20).tier, 'bronze')
  assert.equal(g(49).tier, 'bronze')
  assert.deepEqual(g(49).progress, [49, 50])
  assert.equal(g(50).tier, 'silver')
  assert.equal(g(99).tier, 'silver')
  assert.equal(g(100).tier, 'gold')
  assert.equal(g(100).nextTier, null)
  const full = g(100)
  assert.equal(full.unlockedMs, day(60) + 19 * MIN)   // the achievement is dated on the first tier, as before
  assert.deepEqual(full.tiers.map(t => [t.tier, t.at, t.ms]), [['bronze', 20, day(60) + 19 * MIN], ['silver', 50, day(60) + 49 * MIN], ['gold', 100, day(60) + 99 * MIN]])
  assert.deepEqual(g(50).nextTier, { tier: 'gold', at: 100 })
  assert.deepEqual(g(30).fact, ['game.fact.zero', 20])
  assert.deepEqual(g(60).fact, ['game.fact.zero', 50])
})
test('thrifty — bronze at 50 %, gold at 80 %: 79 % is bronze, 80 % is gold; the tiers are undated like the achievement', () => {
  const g = (input, cache) => ach(play(hist([], profs(prof('a', { input, cache }))), office()), 'thrifty')
  assert.equal(g(51, 49).tier, null)
  assert.equal(g(50, 50).tier, 'bronze')
  assert.equal(g(21, 79).tier, 'bronze')
  assert.equal(g(20, 80).tier, 'gold')
  assert.equal(g(20, 80).dated, false)
  assert.deepEqual(g(20, 80).tiers.map(t => [t.tier, t.at, t.unlocked]), [['bronze', 50, true], ['gold', 80, true]])
  assert.equal(g(50, 50).tiers.some(t => t.tier === 'silver'), false)   // thrifty has no silver
  assert.deepEqual(g(50, 50).nextTier, { tier: 'gold', at: 80 })
})

// the decider -------------------------------------------------------------------------------------------------
test('present — 6 consecutive days with an unblock do not unlock, 7 do (dated on the last unblock of the 7th day); a gap breaks', () => {
  const evs = (n, skip = -1) => Array.from({ length: n }, (_, i) => ev(`t${i}`, 'unblocked', day(n - i + 2) + i * MIN)).filter((_, i) => i !== skip)
  assert.equal(ach(play(hist([hb('b', { events: evs(6) })]), office()), 'present').unlocked, false)
  const a = ach(play(hist([hb('b', { events: evs(7) })]), office()), 'present')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, evs(7)[6].ms)
  assert.equal(ach(play(hist([hb('b', { events: evs(8, 3) })]), office()), 'present').unlocked, false)   // 3 + 4 days
  // a few unblocks the same day are one day
  const sameDay = [...evs(6), ev('x', 'unblocked', evs(6)[5].ms + MIN)]
  assert.equal(ach(play(hist([hb('b', { events: sameDay })]), office()), 'present').unlocked, false)
})
test('noqueue — 6 clean active days do not unlock, 7 do (dated at midnight after the 7th); a card blocked more than 24 h breaks the days it sits there', () => {
  const act = n => Array.from({ length: n }, (_, i) => ev(`t${i}`, 'completed', day(n - i + 1)))
  const o = office()
  assert.equal(ach(play(hist([hb('b', { events: act(6) })]), o), 'noqueue').unlocked, false)
  const a = ach(play(hist([hb('b', { events: act(7) })]), o), 'noqueue')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, new Date(new Date(day(2)).getFullYear(), new Date(day(2)).getMonth(), new Date(day(2)).getDate() + 1).getTime())
  // blocked 23 h: fine. blocked 30 h in the middle: it breaks the days from the 24th hour to the unblock
  const quick = [...act(8), ev('q', 'blocked', day(5)), ev('q', 'unblocked', day(5) + 23 * H)]
  assert.equal(ach(play(hist([hb('b', { events: quick })]), o), 'noqueue').unlocked, true)
  const slow = [...act(8), ev('q', 'blocked', day(6)), ev('q', 'unblocked', day(6) + 30 * H)]
  const s = ach(play(hist([hb('b', { events: slow })]), o), 'noqueue')
  assert.equal(s.unlocked, false)   // days 8..7 | (day 5 broken) | 4..1 -> at most 4
  // a day with no activity is not a clean day (an empty history is not 7 days without a queue)
  assert.equal(ach(play(hist([hb('b')]), o), 'noqueue').unlocked, false)
  // a card still blocked since long ago breaks every day since the 24th hour
  const stuck = play(hist([hb('b', { events: [...act(9), ev('s', 'blocked', day(9))] })]), office([board('b', [task('s', { status: 'blocked' })])]))
  assert.equal(ach(stuck, 'noqueue').unlocked, false)
})

// the team ----------------------------------------------------------------------------------------------------
test('fullteam — 4 roles with a done card do not unlock, 5 do (dated on the card that brings the 5th)', () => {
  const roles = ['executive', 'manager', 'designer', 'developer', 'devops']
  const agents = roles.map(r => ({ name: `bot-${r}`, description: '', roleOverride: r }))
  const cards = n => roles.slice(0, n).map((r, i) => task(`c${i}`, { done: day(10 - i), by: `bot-${r}` }))
  assert.equal(ach(play(hist(), office([board('b', cards(4))], agents)), 'fullteam').unlocked, false)
  assert.deepEqual(ach(play(hist(), office([board('b', cards(4))], agents)), 'fullteam').progress, [4, 5])
  const a = ach(play(hist(), office([board('b', cards(5))], agents)), 'fullteam')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, day(6))
  // five roles but one of them has no done card: still 4
  const noDone = cards(5).map((t, i) => (i === 4 ? task('c4', { status: 'todo', by: 'bot-devops' }) : t))
  assert.equal(ach(play(hist(), office([board('b', noDone)], agents)), 'fullteam').unlocked, false)
})
test('training — a card done 6 days after an own skill changed unlocks; 7 days, or before the change, does not (dated on the card)', () => {
  const m = day(30)
  const h = recent => hist([], profs(prof('ana', { recent })))
  const o = ms => office([board('b', [task('t', { done: ms, by: 'ana' })])])
  const rec = [{ name: 'my-skill', mtimeMs: m }]
  const a = ach(play(h(rec), o(m + 6 * D)), 'training')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, m + 6 * D)
  assert.equal(ach(play(h(rec), o(m + 7 * D)), 'training').unlocked, false)
  assert.equal(ach(play(h(rec), o(m - H)), 'training').unlocked, false)
  assert.equal(ach(play(h([]), o(m + D)), 'training').unlocked, false)
  assert.equal(ach(play(h(rec), office([board('b', [task('t', { done: m + D, by: 'bob' })])])), 'training').unlocked, false)   // another bot's card
})
test('firstmission — a bot finishing its first card within 7 days of its first sighting unlocks; 7 days does not; only its FIRST card counts', () => {
  const first = day(60)
  const h = hist([], profs(prof('ana', { first })))
  const a = ach(play(h, office([board('b', [task('t', { done: first + 6 * D, by: 'ana' })])])), 'firstmission')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, first + 6 * D)
  assert.equal(ach(play(h, office([board('b', [task('t', { done: first + 7 * D, by: 'ana' })])])), 'firstmission').unlocked, false)
  const late = office([board('b', [task('t1', { done: first + 20 * D, by: 'ana' }), task('t2', { done: first + 21 * D, by: 'ana' })])])
  assert.equal(ach(play(h, late), 'firstmission').unlocked, false)
  assert.equal(ach(play(hist([], profs(prof('ana', { first: null }))), office([board('b', [task('t', { done: first, by: 'ana' })])])), 'firstmission').unlocked, false)
})
test('veteran — 364 days since the oldest profile do not unlock, 365 do (dated on the 365th day); the age is the oldest of the profiles', () => {
  const h = days => hist([], profs(prof('ana', { first: NOW - days * D }), prof('bob', { first: NOW - 10 * D })))
  assert.equal(ach(play(h(364), office()), 'veteran').unlocked, false)
  assert.deepEqual(ach(play(h(364), office()), 'veteran').progress, [364, 365])
  const a = ach(play(h(365), office()), 'veteran')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, NOW)
  assert.equal(ach(play(hist(), office()), 'veteran').unlocked, false)
})

// the API, order, announcements, privacy ---------------------------------------------------------------------
test('adding an achievement (the « command » family): a definition passed to computeGame is listed, finished, grouped, and a throwing one is only locked', () => {
  const pilot = { id: 'pilot', family: 'command', source: 'audit', goal: 3, compute: () => ({ value: 3, ms: NOW - D, fact: ['game.fact.pilot', 3] }) }
  const boom = { id: 'boom', family: 'command', source: 'audit', goal: 1, compute: () => { throw new Error('x') } }
  const g = play(hist(), office(), [pilot, boom])
  assert.equal(ach(g, 'pilot').unlocked, true)
  assert.equal(ach(g, 'pilot').unlockedMs, NOW - D)
  assert.equal(ach(g, 'boom').unlocked, false)
  assert.equal(ach(g, 'boom').unavailable, true)
  assert.deepEqual(collectionFamilies(g.achievements).at(-1).items.map(a => a.id).sort(), ['boom', 'pilot'])
  assert.equal(g.achievements.length, 34)
  const tiered = { id: 'guardian', family: 'command', hidden: true, source: 'audit', tiers: [['bronze', 1], ['gold', 5]], compute: () => ({ value: 2, ms: [NOW - 3 * D, undefined] }) }
  const t = ach(play(hist(), office(), [tiered]), 'guardian')
  assert.deepEqual([t.tier, t.hidden, t.progress, t.nextTier], ['bronze', true, [2, 5], { tier: 'gold', at: 5 }])
})
test('collection order: unlocked first (latest first, undated after), then the closest to the goal; hidden locked last; families grouped', () => {
  const a = (id, over = {}) => ({ id, family: 'chains', unlocked: false, unlockedMs: null, hidden: false, progress: [0, 10], ...over })
  const list = [
    a('far', { progress: [1, 10] }), a('near', { progress: [9, 10] }), a('hid', { hidden: true }), a('old', { unlocked: true, unlockedMs: 100 }),
    a('new', { unlocked: true, unlockedMs: 900 }), a('undated', { unlocked: true }), a('mid', { progress: [5, 10] })
  ]
  assert.deepEqual(collectionOrder(list).map(x => x.id), ['new', 'old', 'undated', 'near', 'mid', 'far', 'hid'])
  assert.deepEqual(collectionFamilies([a('x', { family: 'team' }), a('y')]).map(f => f.family), ['chains', 'team'])
})
test('an existing user who updates gets ONE grouped toast, not one per achievement; the stored array stays a plain list of ids (prefs-compat)', () => {
  const unlockedGame = ids => ({ achievements: ids.map(id => ({ id, unlocked: true })) })
  const seen = ['chain', 'zero']
  const r = unlockAnnouncement(seen, unlockedGame(['chain', 'zero', ...NEW_DEFS.slice(0, 15).map(d => d.id)]))
  assert.equal(r.kind, 'many')
  assert.equal(r.ids.length, 15)
  assert.ok(r.next.every(id => typeof id === 'string'))
  assert.equal(unlockAnnouncement(seen, unlockedGame(['chain', 'zero', 'smooth', 'wide'])).kind, 'new')
  assert.equal(unlockAnnouncement(seen, unlockedGame(['chain', 'zero'])).kind, null)
  assert.equal(unlockAnnouncement(null, unlockedGame(['chain', 'smooth'])).kind, 'first')
})
test('hidden achievements: the tooltip of a locked one gives away nothing; once unlocked it is a normal one', () => {
  const g = play(hist(), office())
  const tip = trophyTip(ach(g, 'rescue'), { lang: 'en', readMs: NOW })
  assert.deepEqual([tip.name, tip.fact, tip.when, tip.where, tip.source, tip.hidden], [['game.hidden.name'], ['game.hidden.cond'], ['game.hidden.when'], null, null, true])
  const blockedAt = day(10)
  const open = play(hist([hb('b', { events: [ev('t', 'blocked', blockedAt), ev('t', 'unblocked', blockedAt + 30 * H)] })]), office([board('b', [task('t', { done: blockedAt + 31 * H })])]))
  assert.deepEqual(trophyTip(ach(open, 'rescue'), { lang: 'en', readMs: NOW }).name, ['game.ach.rescue.name'])
})
test('tooltip tiers: a tiered achievement says the tier reached and the next one; a single-level one has none', () => {
  const rs = Array.from({ length: 60 }, (_, i) => run('ana', 'completed', day(60) + i * MIN))
  const g = play(hist([hb('b', { runs: rs })]), office())
  const tip = trophyTip(ach(g, 'zero'), { lang: 'en', readMs: NOW })
  assert.equal(tip.tier.reached, 'silver')
  assert.deepEqual(tip.tier.next, { tier: 'gold', at: 100 })
  assert.equal(trophyTip(ach(g, 'quick'), {}).tier, null)
  assert.deepEqual(trophyTip(ach(g, 'smooth'), {}).where, ['game.where.medal'])
  assert.deepEqual(trophyTip(ach(g, 'zero'), {}).where, ['game.ach.zero.where'])
})
test('the cabinet medals: one per unlocked achievement, best tier first, then most recent; pips 0 / 1 / 2 / 3', () => {
  const rs = Array.from({ length: 60 }, (_, i) => run('ana', 'completed', day(60) + i * MIN))
  const g = play(hist([hb('b', { runs: rs, events: [ev('t', 'blocked', day(4)), ev('t', 'unblocked', day(4) + 10 * MIN)] })]), office())
  const medals = decorOf(g).medals
  assert.deepEqual(medals.map(m => m.id), ['zero', 'quick'])
  assert.deepEqual(medals.map(m => m.pips), [2, 0])
  assert.deepEqual(medalsOf([{ id: 'a', unlocked: true, tier: 'gold' }, { id: 'b', unlocked: true, tier: 'bronze', unlockedMs: 5 }, { id: 'c', unlocked: false }]).map(m => [m.id, m.pips]), [['a', 3], ['b', 1]])
  assert.deepEqual(decorOf(g).achievements, ['quick', 'zero'].sort((x, y) => (g.achievements.findIndex(a => a.id === x) - g.achievements.findIndex(a => a.id === y))))
})
test('the journal inscribes the silver and gold tiers at their own date', () => {
  const rs = Array.from({ length: 60 }, (_, i) => run('ana', 'completed', day(60) + i * MIN))
  const lines = journalEntries(play(hist([hb('b', { runs: rs })]), office())).filter(l => l.id === 'zero')
  assert.deepEqual(lines.map(l => [l.tier || null, l.ms]).sort((x, y) => x[1] - y[1]), [[null, day(60) + 19 * MIN], ['silver', day(60) + 49 * MIN]])
})
test('sober: nothing at all (no achievement, no medal)', () => {
  const g = computeGame(hist(), office(), NOW, { sober: true })
  assert.deepEqual([...g.achievements], [])
  assert.deepEqual(decorOf(g), { sober: true })
})
test('the history reader keeps the links, the card of a run and the cron history only when they are served, and nothing else of a card', () => {
  const h = toHistory({ ok: true, profiles: [], boards: [{ slug: 'b', runs: [{ profile: 'a', endedAt: 5, outcome: 'completed', task: 't1', summary: 'SECRET' }], events: [], links: [['a', 'b'], ['', 'x'], 'junk'] }], crons: [{ profile: 'default', name: 'n', runs: [[100, 1], [200, 0], 'bad'], error: 'SECRET' }] })
  assert.deepEqual(h.boards[0].links, [['a', 'b']])
  assert.equal(h.boards[0].runs[0].task, 't1')
  assert.deepEqual(h.crons, [{ profile: 'default', name: 'n', runs: [[100000, 1], [200000, 0]] }])
  assert.equal(JSON.stringify(h).includes('SECRET'), false)
  const old = toHistory({ ok: true, profiles: [], boards: [{ slug: 'b', runs: [{ profile: 'a', endedAt: 5, outcome: 'completed' }], events: [] }] })
  assert.equal('links' in old.boards[0], false)
  assert.equal('task' in old.boards[0].runs[0], false)
  assert.equal('crons' in old, false)
})
test('helpers: dayNo is consecutive across a change of hour, dayRun and streakOf report the longest run and where a target is first reached', () => {
  assert.equal(dayNo(at(2026, 10, 26, 23, 59)) + 1, dayNo(at(2026, 10, 27, 0, 1)))   // the night the clocks go back (Europe)
  assert.equal(dayNo(at(2026, 3, 29, 12)) + 1, dayNo(at(2026, 3, 30, 12)))
  assert.deepEqual(dayRun(new Set([1, 2, 3, 5, 6]), 3), { best: 3, hit: 3 })
  assert.deepEqual(dayRun(new Set([1, 2, 4]), 3), { best: 2, hit: null })
  assert.deepEqual(streakOf([{ ok: true, ms: 1 }, { ok: true, ms: 2 }, { ok: false, ms: 3 }, { ok: true, ms: 4 }], 2), { best: 2, hit: 2 })
  assert.equal(RULES.smoothCards, 10)
  assert.equal(RULES.zeroSilver, 50)
})
}

// ===== achievements =====
{
/* The four trophies twin, fastlane, quiet, comeback (hidden). For EACH: unlocked (exact date), just under the
   threshold (locked), every edge case, empty history, archived card, data absent (`unavailable`). Deterministic: the clock is injected
   (NOW) and the zone is fixed to Europe/Berlin BEFORE any date is built, so the daylight-saving nights are really the 7 h and 5 h ones, on a CI that
   runs in UTC. The test that falls when a threshold's comparison is reversed is named in each section. */
process.env.TZ = 'Europe/Berlin'

const MIN = 60_000
const H = 3_600_000
const D = 86_400_000
const at = (y, m, d, h = 12, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s).getTime()
const NOW = at(2026, 11, 16, 12)

const task = (id, { status = 'done', done = null, created = null, by = null, guard = false } = {}) => ({ id, status, completedMs: status === 'done' ? done : null, createdMs: created, startedMs: null, assignee: by, modelOverride: null, title: '', ...(guard ? { guard: true } : {}) })
const board = (slug, tasks) => ({ slug, createdMs: null, tasks })
const office = (boards = []) => ({ boards, agents: [] })
const hb = (slug, { runs = [], events = [] } = {}) => ({ slug, runs, events })
const hist = (boards = [], extra = {}) => ({ ok: true, profiles: {}, boards, ...extra })
const run = (profile, outcome, endedMs, taskId) => ({ profile, outcome, startedMs: endedMs - MIN, endedMs, ...(taskId ? { task: taskId } : {}) })
const ev = (taskId, kind, ms) => ({ task: taskId, kind, ms })
const play = (h, o, now = NOW) => computeGame(h, o, now, {})
const ach = (g, id) => g.achievements.find(a => a.id === id)

test('the zone is fixed: the 25 Oct 2026 night is 7 h and the 28 Mar 2027 night is 5 h (a CI in UTC would not see them)', () => {
  assert.equal(new Date(2026, 9, 25, 12).getTimezoneOffset(), -60)
  assert.equal(dayStart(dayNo(at(2026, 10, 25, 12)) + 1) - dayStart(dayNo(at(2026, 10, 25, 12))), 25 * H)
  assert.equal(dayStart(dayNo(at(2027, 3, 28, 12)) + 1) - dayStart(dayNo(at(2027, 3, 28, 12))), 23 * H)
})

test('the catalogue: 4 more (32 coded without « command »), families as fixed, comeback is the only hidden one added, no tier', () => {
  const ids = ['twin', 'fastlane', 'quiet', 'comeback']
  assert.deepEqual(NEW_DEFS.filter(d => ids.includes(d.id)).map(d => [d.id, d.family, Boolean(d.hidden), d.source, Boolean(d.tiers)]), [
    ['twin', 'team', false, 'runs', false], ['fastlane', 'boards', false, 'cards', false], ['quiet', 'reliability', false, 'runs', false], ['comeback', 'reliability', true, 'runs', false]
  ])
  assert.equal(ALL_ACHIEVEMENT_IDS.length, 32)
  assert.equal(new Set(ALL_ACHIEVEMENT_IDS).size, 32)
  assert.ok(NEW_DEFS.every(d => FAMILIES.includes(d.family)))
  const g = play(hist(), office())
  assert.equal(g.achievements.length, ALL_ACHIEVEMENT_IDS.length)
  assert.equal(JSON.stringify(g).includes('undefined'), false)
  assert.equal(hiddenLocked(g.achievements), 3)   // rescue, iron, comeback
  assert.equal(RULES_V2.quietUntilHour, RULES.owlUntilHour, '« night » is the night of owl')
  assert.deepEqual([RULES.fastlaneMs, RULES.quietMinRuns, RULES.comebackMs, RULES.comebackRuns, RULES.twinFailOutcomes], [10 * MIN, 3, 24 * H, 5, ['crashed', 'timed_out']])
})

// twin ------------------------------------------------------------------------------------------------------------
const twinOf = (runs, { tasks = [task('c1', { done: NOW - D })], slug = 'b', extraBoards = [], extraHist = [] } = {}) => ach(play(hist([hb(slug, { runs }), ...extraHist]), office([board(slug, tasks), ...extraBoards])), 'twin')

test('twin — a crash by A then a completion by B is unlocked, dated on the end of B\'s run; the fact names the board and both bots', () => {
  const a = twinOf([run('alice', 'crashed', NOW - 5 * H, 'c1'), run('bob', 'completed', NOW - 4 * H, 'c1')])
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, NOW - 4 * H)
  assert.deepEqual(a.fact, ['game.fact.twin', 'b', 'alice', 'bob'])
  assert.equal(a.family, 'team')
  assert.equal(a.hidden, false)
  assert.equal(twinOf([run('alice', 'timed_out', NOW - 5 * H, 'c1'), run('bob', 'completed', NOW - 4 * H, 'c1')]).unlocked, true, 'a timeout is a failure too')
})
test('twin — just under: the same profile retrying is no understudy (locked); so is a failure that is not a crash or a timeout', () => {
  assert.equal(twinOf([run('alice', 'crashed', NOW - 5 * H, 'c1'), run('alice', 'completed', NOW - 4 * H, 'c1')]).unlocked, false)
  assert.equal(twinOf([run('alice', 'reclaimed', NOW - 5 * H, 'c1'), run('bob', 'completed', NOW - 4 * H, 'c1')]).unlocked, false)
  assert.equal(twinOf([run('alice', 'gave_up', NOW - 5 * H, 'c1'), run('bob', 'completed', NOW - 4 * H, 'c1')]).unlocked, false)
  assert.equal(twinOf([run('alice', 'crashed', NOW - 5 * H, 'c1'), run('bob', 'crashed', NOW - 4 * H, 'c1')]).unlocked, false, 'nobody finished it')
  assert.deepEqual(twinOf([run('alice', 'crashed', NOW - 5 * H, 'c1'), run('alice', 'completed', NOW - 4 * H, 'c1')]).progress, [0, 1])
})
test('twin — edge cases: A, A, then B counts; B finishing BEFORE (or at the very ms of) the failure does not; a failure on another card does not', () => {
  const a = twinOf([run('alice', 'crashed', NOW - 6 * H, 'c1'), run('alice', 'crashed', NOW - 5 * H, 'c1'), run('bob', 'completed', NOW - 4 * H, 'c1')])
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, NOW - 4 * H)
  assert.equal(twinOf([run('bob', 'completed', NOW - 6 * H, 'c1'), run('alice', 'crashed', NOW - 5 * H, 'c1')]).unlocked, false)
  assert.equal(twinOf([run('alice', 'crashed', NOW - 5 * H, 'c1'), run('bob', 'completed', NOW - 5 * H, 'c1')]).unlocked, false, 'same millisecond is not « later »')
  assert.equal(twinOf([run('alice', 'crashed', NOW - 5 * H, 'c1'), run('bob', 'completed', NOW - 4 * H, 'c2')], { tasks: [task('c1', { done: NOW }), task('c2', { done: NOW })] }).unlocked, false)
  assert.equal(twinOf([run('alice', 'crashed', NOW - 5 * H, 'c1'), run('bob', 'completed', NOW - 4 * H, 'c1')], { slug: 'b', extraHist: [hb('other', { runs: [run('carol', 'completed', NOW - 3 * H, 'c1')] })] }).unlockedMs, NOW - 4 * H)
})
test('twin — the same card id on two boards is two cards (a crash on one board and a completion on the other is nothing)', () => {
  const g = play(hist([hb('b1', { runs: [run('alice', 'crashed', NOW - 5 * H, 'c1')] }), hb('b2', { runs: [run('bob', 'completed', NOW - 4 * H, 'c1')] })]), office([board('b1', []), board('b2', [])]))
  assert.equal(ach(g, 'twin').unlocked, false)
})
test('twin — the oldest case is the date; runs without a task or a profile, a guard and a test board are ignored; an archived card still counts', () => {
  const two = ach(play(hist([hb('b', { runs: [run('alice', 'crashed', NOW - 9 * H, 'x'), run('bob', 'completed', NOW - 8 * H, 'x'), run('alice', 'crashed', NOW - 5 * H, 'y'), run('carol', 'completed', NOW - 4 * H, 'y')] })]), office([board('b', [])])), 'twin')
  assert.equal(two.unlockedMs, NOW - 8 * H)
  // no task id on the failed run: the card cannot be known (and the other run, with its task, keeps the data available)
  assert.equal(twinOf([run('alice', 'crashed', NOW - 5 * H), run('bob', 'completed', NOW - 4 * H, 'c1')]).unlocked, false)
  assert.equal(twinOf([run('', 'crashed', NOW - 5 * H, 'c1'), run('bob', 'completed', NOW - 4 * H, 'c1')]).unlocked, false, 'a run without a profile is a « Launch », not an execution')
  const sandbox = play(hist([hb('sandbox-demo', { runs: [run('alice', 'crashed', NOW - 5 * H, 'c1'), run('bob', 'completed', NOW - 4 * H, 'c1')] }), hb('b', { runs: [run('x', 'completed', NOW - H, 'z')] })]), office([board('sandbox-demo', []), board('b', [])]))
  assert.equal(ach(sandbox, 'twin').unlocked, false)
  const guard = twinOf([run('alice', 'crashed', NOW - 5 * H, 'g1'), run('bob', 'completed', NOW - 4 * H, 'g1'), run('x', 'completed', NOW - H, 'z')], { tasks: [task('g1', { done: NOW - 4 * H, guard: true }), task('z', { done: NOW - H })] })
  assert.equal(guard.unlocked, false)
  const archived = twinOf([run('alice', 'crashed', NOW - 5 * H, 'c1'), run('bob', 'completed', NOW - 4 * H, 'c1')], { tasks: [task('c1', { status: 'archived' })] })
  assert.equal(archived.unlocked, true, 'the runs outlive the archived card')
})
test('twin — empty history and an agent that does not serve the card of a run: locked and unavailable, never an estimate', () => {
  const empty = ach(play(hist(), office()), 'twin')
  assert.deepEqual([empty.unlocked, empty.unavailable, empty.value], [false, true, 0])
  const old = twinOf([run('alice', 'crashed', NOW - 5 * H), run('bob', 'completed', NOW - 4 * H)])
  assert.deepEqual([old.unlocked, old.unavailable], [false, true])
  assert.deepEqual(old.fact, ['game.unavailable'])
  assert.equal(ach(play(null, office()), 'twin').unavailable, true)
  assert.equal(ach(computeGame({ ok: false }, office(), NOW, {}), 'twin').unlocked, false)
})

// fastlane --------------------------------------------------------------------------------------------------------
const C0 = at(2026, 11, 10, 14, 0)
const lane = ({ dt = 7 * MIN + 30_000, status = 'done', created = C0, runs = [run('alice', 'completed', C0 + 5 * MIN, 'c1')], events = [], slug = 'b', guard = false, extra = [] } = {}) =>
  ach(play(hist([hb(slug, { runs, events }), ...extra.map(x => x.h)]), office([board(slug, [task('c1', { status, done: Number.isFinite(created) ? created + dt : C0 + dt, created, guard })]), ...extra.map(x => x.o)])), 'fastlane')

test('fastlane — a card done 9 min 59 s after it was created, one completed run, is unlocked on its completion; 10 min on the dot is not', () => {
  const a = lane({ dt: 10 * MIN - 1000 })
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, C0 + 10 * MIN - 1000)
  assert.deepEqual(a.fact, ['game.fact.fastlane', 'b', 9])
  assert.deepEqual([a.family, a.hidden, a.source], ['boards', false, 'cards'])
  const edge = lane({ dt: 10 * MIN })
  assert.equal(edge.unlocked, false)
  assert.deepEqual(edge.progress, [0, 1])
  assert.equal(lane({ dt: 0 }).unlocked, true, 'created and done at the same instant is still fast')
  assert.deepEqual(lane({ dt: 20_000 }).fact, ['game.fact.fastlane', 'b', 1], 'under a minute reads « 1 min », never 0')
})
test('fastlane — edge cases: no run (closed by hand), a reclaimed run then a completed one, a crash, a block, 2 minutes of block: all locked', () => {
  assert.equal(lane({ runs: [run('x', 'completed', C0 + H, 'other')] }).unlocked, false, 'the run belongs to another card')
  assert.equal(lane({ runs: [run('alice', 'reclaimed', C0 + 2 * MIN, 'c1'), run('alice', 'completed', C0 + 5 * MIN, 'c1')] }).unlocked, false)
  assert.equal(lane({ runs: [run('alice', 'crashed', C0 + 2 * MIN, 'c1'), run('bob', 'completed', C0 + 5 * MIN, 'c1')] }).unlocked, false)
  assert.equal(lane({ runs: [run('alice', 'blocked', C0 + 2 * MIN, 'c1'), run('alice', 'completed', C0 + 5 * MIN, 'c1')] }).unlocked, false)
  assert.equal(lane({ events: [ev('c1', 'blocked', C0 + MIN), ev('c1', 'unblocked', C0 + 3 * MIN)] }).unlocked, false)
  assert.equal(lane({ events: [ev('c1', 'completed', C0 + 5 * MIN)] }).unlocked, true, 'other events do not hurt')
  assert.equal(lane({ events: [ev('c2', 'blocked', C0 + MIN)], runs: [run('alice', 'completed', C0 + 5 * MIN, 'c1')] }).unlocked, true, 'a block on another card does not hurt')
})
test('fastlane — dates absent or reversed, a card still open, an archived one, a guard and a test board never count', () => {
  assert.equal(lane({ created: null }).unlocked, false)
  assert.equal(lane({ dt: -MIN }).unlocked, false)
  assert.equal(lane({ status: 'running' }).unlocked, false)
  assert.equal(lane({ status: 'archived' }).unlocked, false)
  assert.equal(lane({ guard: true }).unlocked, false)
  assert.equal(lane({ slug: 'sandbox-demo' }).unlocked, false)
  // the status is read, not only the dates (a card reopened after it was done keeps its completedMs)
  const reopened = ach(play(hist([hb('b', { runs: [run('alice', 'completed', C0 + 5 * MIN, 'c1')] })]), office([board('b', [{ ...task('c1', { done: C0 + 7 * MIN, created: C0 }), status: 'running' }])])), 'fastlane')
  assert.equal(reopened.unlocked, false, 'a card that is not done is no fast lane, whatever its dates')
})
test('fastlane — the oldest of several is the date; empty history and runs that do not name their card are « unavailable »', () => {
  const late = { h: hb('b2', { runs: [run('bob', 'completed', C0 + 2 * D, 'k1')] }), o: board('b2', [task('k1', { done: C0 + 2 * D + 3 * MIN, created: C0 + 2 * D })]) }
  const a = lane({ extra: [late] })
  assert.equal(a.unlockedMs, C0 + 7 * MIN + 30_000)
  const first = { h: hb('b2', { runs: [run('bob', 'completed', C0 - 2 * D, 'k1')] }), o: board('b2', [task('k1', { done: C0 - 2 * D + 3 * MIN, created: C0 - 2 * D })]) }
  assert.equal(lane({ extra: [first] }).unlockedMs, C0 - 2 * D + 3 * MIN)
  const empty = ach(play(hist(), office()), 'fastlane')
  assert.deepEqual([empty.unlocked, empty.unavailable], [false, true])
  const old = lane({ runs: [run('alice', 'completed', C0 + 5 * MIN)] })
  assert.deepEqual([old.unlocked, old.unavailable], [false, true])
})

// quiet -----------------------------------------------------------------------------------------------------------
const NIGHT = [at(2026, 11, 12, 1, 10), at(2026, 11, 12, 2, 20), at(2026, 11, 12, 3, 49)]
const quietOf = (runs, { events = [], now = NOW, extra = {}, boards = null } = {}) => ach(computeGame(hist(boards || [hb('b', { runs, events })], extra), office([board('b', [])]), now, {}), 'quiet')
const done = ms => run('alice', 'completed', ms, 't')

test('quiet — 3 completed runs in a closed night, no block: unlocked, dated on the last run of the night', () => {
  const a = quietOf(NIGHT.map(done))
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, at(2026, 11, 12, 3, 49))
  assert.deepEqual(a.fact, ['game.fact.quiet', 3])
  assert.deepEqual([a.family, a.hidden, a.source], ['reliability', false, 'runs'])
})
test('quiet — just under: 2 runs, or 3 with one timeout or crash, are locked; the progress is the best clean night out of 3', () => {
  const two = quietOf(NIGHT.slice(0, 2).map(done))
  assert.equal(two.unlocked, false)
  assert.deepEqual(two.progress, [2, 3])
  const bad = quietOf([done(NIGHT[0]), done(NIGHT[1]), run('alice', 'timed_out', NIGHT[2], 't')])
  assert.equal(bad.unlocked, false)
  assert.deepEqual(bad.progress, [0, 3], 'a night with a failure is not a clean night')
  assert.equal(quietOf([done(NIGHT[0]), done(NIGHT[1]), run('alice', 'crashed', NIGHT[2], 't')]).unlocked, false)
  assert.equal(quietOf([]).unlocked, false)
  assert.deepEqual(quietOf([]).progress, [0, 3])
})
test('quiet — the night is the night of owl: a run at 06:00 or at 23:59 the day before is not in it', () => {
  assert.equal(quietOf([done(NIGHT[0]), done(NIGHT[1]), done(at(2026, 11, 12, 6, 0))]).unlocked, false)
  assert.equal(quietOf([done(NIGHT[0]), done(NIGHT[1]), done(at(2026, 11, 12, 5, 59))]).unlocked, true)
  assert.equal(quietOf([done(at(2026, 11, 11, 23, 59)), done(NIGHT[0]), done(NIGHT[1])]).unlocked, false)
  assert.equal(quietOf([done(at(2026, 11, 12, 0, 0)), done(at(2026, 11, 12, 0, 1)), done(at(2026, 11, 12, 0, 2))]).unlocked, true, 'midnight sharp is in the night')
})
test('quiet — a block in the night spoils it (05:59), one at 06:00 is no longer the night; a block elsewhere or the day before does not', () => {
  const runs = NIGHT.map(done)
  assert.equal(quietOf(runs, { events: [ev('t', 'blocked', at(2026, 11, 12, 5, 59))] }).unlocked, false)
  assert.equal(quietOf(runs, { events: [ev('t', 'blocked', at(2026, 11, 12, 0, 0))] }).unlocked, false)
  assert.equal(quietOf(runs, { events: [ev('t', 'blocked', at(2026, 11, 12, 6, 0))] }).unlocked, true)
  assert.equal(quietOf(runs, { events: [ev('t', 'blocked', at(2026, 11, 11, 5, 0))] }).unlocked, true)
  assert.equal(quietOf(runs, { events: [ev('t', 'unblocked', at(2026, 11, 12, 4, 0)), ev('t', 'completed', at(2026, 11, 12, 4, 1))] }).unlocked, true)
  // a block on ANOTHER board in the same night counts too (the night is the office's, not a board's)
  assert.equal(quietOf(runs, { boards: [hb('b', { runs }), hb('c', { events: [ev('u', 'blocked', at(2026, 11, 12, 2, 0))] })] }).unlocked, false)
})
test('quiet — a night still going on is not closed (clean as it is); it is the minute the night ends, or the next day', () => {
  const clean = NIGHT.map(done)
  assert.equal(quietOf(clean, { now: at(2026, 11, 12, 4, 0) }).unlocked, false)
  assert.equal(quietOf(clean, { now: at(2026, 11, 12, 5, 59) }).unlocked, false)
  assert.equal(quietOf(clean, { now: at(2026, 11, 12, 6, 0) }).unlocked, true)
  assert.equal(quietOf(clean, { now: at(2026, 11, 13, 1, 0) }).unlocked, true)
  assert.deepEqual(quietOf(clean, { now: at(2026, 11, 12, 4, 0) }).progress, [0, 3], 'an open night shows no progress (nothing to promise)')
})
test('quiet — runs of every board add up; the test boards, and a board whose schema could not be read, are left out; a card archived or a run without a card counts', () => {
  const spread = quietOf([], { boards: [hb('a', { runs: [done(NIGHT[0])] }), hb('b', { runs: [run('x', 'completed', NIGHT[1])] }), hb('c', { runs: [done(NIGHT[2])] })] })
  assert.equal(spread.unlocked, true)
  const sandbox = quietOf([], { boards: [hb('a', { runs: [done(NIGHT[0]), done(NIGHT[1])] }), hb('sandbox-demo', { runs: [done(NIGHT[2])] })] })
  assert.equal(sandbox.unlocked, false)
  const partial = quietOf([], { boards: [hb('a', { runs: [done(NIGHT[0]), done(NIGHT[1])] }), hb('b', { runs: [done(NIGHT[2])] })], extra: { partial: [{ source: 'kanban:b', reason: 'schema' }] } })
  assert.equal(partial.unlocked, false)
  const locked = quietOf([], { boards: [hb('a', { runs: [done(NIGHT[0]), done(NIGHT[1])] }), hb('b', { runs: [done(NIGHT[2])] })], extra: { partial: [{ source: 'kanban:b', reason: 'locked' }] } })
  assert.equal(locked.unlocked, true, 'only a schema drift hides the blocks; a slow read is retried by the page')
})
test('quiet — the oldest clean night gives the date; a later one does not move it; a spoiled earlier night is skipped', () => {
  const later = [at(2026, 11, 14, 1, 0), at(2026, 11, 14, 2, 0), at(2026, 11, 14, 2, 52)]
  assert.equal(quietOf([...NIGHT.map(done), ...later.map(done)]).unlockedMs, at(2026, 11, 12, 3, 49))
  assert.equal(quietOf([...NIGHT.slice(0, 2).map(done), run('a', 'crashed', NIGHT[2], 't'), ...later.map(done)]).unlockedMs, at(2026, 11, 14, 2, 52))
  assert.equal(quietOf(NIGHT.map(done)).value, 3)
  // an earlier clean night of only 2 runs neither dates it nor speaks for it; the fact counts the runs of the night that unlocked it
  const four = [at(2026, 11, 14, 1, 0), at(2026, 11, 14, 2, 0), at(2026, 11, 14, 2, 30), at(2026, 11, 14, 2, 52)]
  const a = quietOf([...NIGHT.slice(0, 2).map(done), ...four.map(done)])
  assert.equal(a.unlockedMs, at(2026, 11, 14, 2, 52))
  assert.deepEqual(a.fact, ['game.fact.quiet', 4])
})
test('quiet — daylight saving: the 7 h night of 25 Oct 2026 and the 5 h night of 28 Mar 2027 (Europe/Berlin) are nights like the others', () => {
  const fall = [at(2026, 10, 25, 0, 30), at(2026, 10, 25, 3, 30), at(2026, 10, 25, 5, 59)]
  const a = quietOf(fall.map(done), { now: at(2026, 10, 26, 12) })
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, at(2026, 10, 25, 5, 59))
  assert.equal(quietOf([...fall.slice(0, 2), at(2026, 10, 25, 6, 0)].map(done), { now: at(2026, 10, 26, 12) }).unlocked, false)
  const spring = [at(2027, 3, 28, 0, 30), at(2027, 3, 28, 1, 30), at(2027, 3, 28, 5, 59)]
  assert.equal(quietOf(spring.map(done), { now: at(2027, 3, 29, 12) }).unlocked, true)
  assert.equal(quietOf([...spring.slice(0, 2), at(2027, 3, 28, 6, 0)].map(done), { now: at(2027, 3, 29, 12) }).unlocked, false)
  // the day after a 25 h day is the next day (no night counted twice, none lost)
  const two = quietOf([...fall.map(done), ...[at(2026, 10, 26, 0, 10), at(2026, 10, 26, 1, 0), at(2026, 10, 26, 2, 0)].map(done)], { now: at(2026, 10, 27, 12) })
  assert.equal(two.unlockedMs, at(2026, 10, 25, 5, 59))
})

// comeback --------------------------------------------------------------------------------------------------------
const T1 = at(2026, 11, 1, 10)
/** Board runs: a crash at T1, a first success `gap` later, then `after` more completed runs an hour apart. */
const comebackRuns = (gap, after, { end = 'completed', slug = 'b' } = {}) => {
  const out = [run('alice', 'crashed', T1, 't0'), run('alice', 'completed', T1 + gap, 't1')]
  for (let i = 1; i <= after; i++) out.push(run('alice', i === after && end !== 'completed' ? end : 'completed', T1 + gap + i * H, `t${i + 1}`))
  return { slug, out }
}
const back = (gap, after, opts = {}, extra = []) => {
  const { slug, out } = comebackRuns(gap, after, opts)
  return ach(play(hist([hb(slug, { runs: out }), ...extra]), office([board(slug, [])])), 'comeback')
}

test('comeback — an incident of 24 h 01, the success that closes it and 4 more completed runs: unlocked, dated on the 5th; hidden until then', () => {
  const a = back(24 * H + MIN, 4)
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, T1 + 24 * H + MIN + 4 * H)
  assert.deepEqual(a.fact, ['game.fact.comeback', 'b', 24, 5])
  assert.deepEqual([a.family, a.hidden, a.source], ['reliability', true, 'runs'])
  const locked = back(24 * H + MIN, 3)
  assert.equal(locked.unlocked, false)
  assert.equal(locked.hidden, true)
  assert.deepEqual(trophyTip(locked).name, ['game.hidden.name'], 'a locked hidden trophy gives nothing away')
  assert.equal(trophyTip(locked).where, null)
})
test('comeback — just under: 4 runs in all, an incident of 23 h 59 or of exactly 24 h, a crash before the 5th: all locked', () => {
  assert.deepEqual(back(24 * H + MIN, 3).progress, [4, 5])
  assert.equal(back(24 * H - MIN, 4).unlocked, false)
  assert.deepEqual(back(24 * H - MIN, 4).progress, [0, 5], 'a short incident leaves no series to count')
  assert.equal(back(24 * H, 4).unlocked, false, 'strictly more than 24 h')
  assert.equal(back(24 * H + 1, 4).unlocked, true, 'one millisecond more')
  const broken = back(24 * H + MIN, 4, { end: 'crashed' })
  assert.equal(broken.unlocked, false)
  assert.deepEqual(broken.progress, [4, 5], '4 clean runs, then a crash: the series so far is 4')
  assert.equal(back(24 * H + MIN, 4, { end: 'timed_out' }).unlocked, false)
})
test('comeback — an incident still open is nothing; the runs of another board between the 5 do not break the series; a test board is ignored', () => {
  const open = ach(play(hist([hb('b', { runs: [run('alice', 'crashed', T1, 't0')] })]), office([board('b', [])])), 'comeback')
  assert.deepEqual([open.unlocked, open.progress], [false, [0, 5]])
  const noise = [hb('other', { runs: [1, 2, 3].map(i => run('bob', 'crashed', T1 + 25 * H + i * MIN, `o${i}`)) })]
  assert.equal(back(24 * H + MIN, 4, {}, noise).unlocked, true)
  const sandbox = comebackRuns(24 * H + MIN, 4, { slug: 'sandbox-demo' })
  assert.equal(ach(play(hist([hb(sandbox.slug, { runs: sandbox.out })]), office([board(sandbox.slug, [])])), 'comeback').unlocked, false)
})
test('comeback — it reads the incidents of computeGame (the same as fire and the post-mortem), it does not compute its own', () => {
  const { out } = comebackRuns(24 * H + MIN, 4)
  const g = play(hist([hb('b', { runs: out })]), office([board('b', [])]))
  assert.deepEqual(g.incidents.map(i => [i.board, i.endMs - i.startMs]), [['b', 24 * H + MIN]])
  assert.equal(ach(g, 'fire').unlocked, true, 'fire stays the first recovery, whatever its duration')
  const src = readFileSync(new URL('../../src/core/achievements.js', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('function comeback'), src.indexOf('const T = '))
  assert.match(body, /ctx\.incidents/)
  assert.doesNotMatch(body, /open\.(get|set|has)/, 'no second incident detector')
})
test('comeback — the oldest case dates it; two boards are two chances; an empty history is locked, not unavailable', () => {
  const a = comebackRuns(24 * H + MIN, 4)
  const b = comebackRuns(30 * H, 4, { slug: 'c' })
  const shift = list => list.map(r => ({ ...r, endedMs: r.endedMs - 10 * D, startedMs: r.startedMs - 10 * D }))
  const g = play(hist([hb('b', { runs: a.out }), hb('c', { runs: shift(b.out) })]), office([board('b', []), board('c', [])]))
  assert.equal(ach(g, 'comeback').unlockedMs, T1 - 10 * D + 30 * H + 4 * H)
  assert.deepEqual(ach(g, 'comeback').fact, ['game.fact.comeback', 'c', 30, 5], 'the fact says how long that board was down')
  const empty = ach(play(hist(), office()), 'comeback')
  assert.deepEqual([empty.unlocked, empty.unavailable, empty.progress], [false, false, [0, 5]])
})

// the cards of the vitrine, the medals, the journal ----------------------------------------------------------------
test('the vitrine and the collection count the catalogue: total = its length; the shelves hold the 4 new ones; the hidden one is counted « hidden »', () => {
  const g = play(hist(), office())
  const v = vitrineView(g, NOW)
  assert.equal(v.total, ALL_ACHIEVEMENT_IDS.length)
  assert.equal(v.hidden, 3)
  const shelf = id => v.shelves.find(s => s.items.some(a => a.id === id))?.family
  assert.deepEqual(['twin', 'fastlane', 'quiet', 'comeback'].map(shelf), ['team', 'boards', 'reliability', 'reliability'])
  assert.equal(collectionFamilies(g.achievements).reduce((n, f) => n + f.items.length, 0), 32)
})
test('i18n: name, condition and fact in the 3 languages; typography of each (a space before « : » in French only: the ordinary space of every French text)', () => {
  for (const lang of ['en', 'fr', 'es']) {
    for (const id of ['twin', 'fastlane', 'quiet', 'comeback']) {
      const m = messages[lang].game
      assert.ok(m.ach[id].name.length > 3 && m.ach[id].cond.length > 30, `${lang} ${id}`)
      assert.equal(typeof m.fact[id], 'function')
    }
    const t = (k, ...a) => translate(messages, lang, k, a)
    assert.match(t('game.fact.twin', 'b', 'alice', 'bob'), /alice/)
    assert.match(t('game.fact.twin', 'b', 'alice', 'bob'), /bob/)
    assert.match(t('game.fact.fastlane', 'b', 7), /7 min/)
    assert.match(t('game.fact.quiet', 3), /3/)
    assert.match(t('game.fact.comeback', 'b', 30, 5), /30 h/)
  }
  const fr = messages.fr.game
  assert.match(fr.fact.twin('b', 'a', 'c'), /Sur b : /)
  assert.match(fr.fact.fastlane('b', 7), /Sur b : /)
  assert.doesNotMatch(messages.en.game.fact.twin('b', 'a', 'c'), / : /)
  assert.deepEqual(new Set(['twin', 'fastlane', 'quiet', 'comeback'].map(id => messages.en.game.ach[id].name)).size, 4)
})
test('medals: each new trophy has its own pixel-art icon and its own 3×3 glyph; locked and unlocked differ; the hidden one is a « ? » while locked', () => {
  for (const id of ['twin', 'fastlane', 'quiet', 'comeback']) assert.equal(typeof ICON_ART[id], 'function', id)
  const px = m => Buffer.from(medalArt(m).d).toString('base64')
  for (const [id, family] of [['twin', 'team'], ['fastlane', 'boards'], ['quiet', 'reliability'], ['comeback', 'reliability']]) {
    const open = px({ id, family, tier: null, unlocked: true, hidden: id === 'comeback' })
    const shut = px({ id, family, tier: null, unlocked: false, hidden: id === 'comeback' })
    assert.notEqual(open, shut, `${id} locked and unlocked differ`)
  }
  const secret = px({ id: 'comeback', family: 'reliability', unlocked: false, hidden: true })
  assert.equal(secret, px({ id: 'rescue', family: 'reliability', unlocked: false, hidden: true }), 'a secret medal gives nothing away')
  const icons = new Set(['twin', 'fastlane', 'quiet', 'comeback', 'rescue', 'iron'].map(id => px({ id, family: 'reliability', unlocked: true })))
  assert.equal(icons.size, 6, 'the six reliability / team icons are all different')
  const src = readFileSync(new URL('../../src/scene/decor.js', import.meta.url), 'utf8')
  assert.equal(medalsOf([{ id: 'twin', unlocked: true, family: 'team', tier: null }]).length, 1)
  for (const id of ['twin', 'fastlane', 'quiet', 'comeback']) assert.match(src, new RegExp(`${id}: '[01]{9}'`))
})

// announcements ---------------------------------------------------------------------------------------------------
test('adding trophies to an existing history: ONE grouped toast (not N), and the server treats the same burst as a first sync (no Telegram message)', () => {
  const g = play(hist([hb('b', { runs: [run('alice', 'crashed', NOW - 5 * H, 'c1'), run('bob', 'completed', NOW - 4 * H, 'c1'), run('bob', 'completed', NOW - 2 * H, 'c2')] })]), office([board('b', [task('c1', { done: NOW - 4 * H }), task('c2', { done: NOW - 2 * H, created: NOW - 2 * H - 3 * MIN })])]))
  const now = g.achievements.filter(a => a.unlocked).map(a => a.id)
  assert.ok(now.includes('twin') && now.includes('fastlane'))
  // the machine had seen every unlocked trophy except N fresh ones
  const toast = n => {
    const seen = now.filter((_, i) => i >= n)   // the first n unlocked ids are « new »
    return unlockAnnouncement(seen, g)
  }
  for (const n of [4, 5, 8]) {
    const r = toast(Math.min(n, now.length))
    if (now.length >= n) assert.equal(r.kind, 'many', `${n} new at once = one grouped toast`)
  }
  assert.equal(unlockAnnouncement(now.slice(1), g).kind, 'new')
  assert.deepEqual(unlockAnnouncement(now, g), { kind: null, ids: [], next: now })
  // 4 more unlocked at once: kind `many` (ONE toast), whatever the count
  const four = [...now, 'a1', 'a2', 'a3', 'a4']
  const fake = { achievements: four.map(id => ({ id, unlocked: true })) }
  const r = unlockAnnouncement(now, fake)
  assert.deepEqual([r.kind, r.ids.length], ['many', 4])
  // the agent half: more than TROPHY_FIRST_SYNC new trophies in one post = a first sync, no message. Read from the real constant.
  const py = readFileSync(new URL('../../hermes_officecraft/notify.py', import.meta.url), 'utf8')
  const first = Number(/^TROPHY_FIRST_SYNC = (\d+)/m.exec(py)?.[1])
  assert.ok(Number.isInteger(first) && first >= 1)
  assert.equal(MANY_AT, first + 1, 'the page groups the toast exactly where the server stops notifying: 4 new trophies = 1 toast and 0 messages')
  assert.ok(r.ids.length > first, 'the 4 fresh trophies of an update are a « first sync » for the server')
  assert.match(py, /first_sync = len\(fresh\) > TROPHY_FIRST_SYNC/)
  assert.match(py, /news = 0 if \(first_sync or not live\) else len\(fresh\)/)
})
}

// ===== achievements =====
{
/* Boundaries the tests above left open (each test kills a mutant that survived them). */
const MIN = 60_000
const H = 3_600_000
const D = 86_400_000
const NOW = new Date(2026, 10, 9, 15).getTime()
const day = n => NOW - n * D
const ach = (g, id) => g.achievements.find(a => a.id === id)
const hist = (boards = [], profiles = {}) => ({ ok: true, profiles, boards })
const play = (h, o = { boards: [], agents: [] }) => computeGame(h, o, NOW, {})
const run = (outcome, endedMs) => ({ profile: 'ana', outcome, startedMs: endedMs - MIN, endedMs })

test('iron: a timed_out day breaks the series like a crash (neither crashed nor timed_out)', () => {
  const runs = Array.from({ length: 7 }, (_, i) => run(i === 3 ? 'timed_out' : 'completed', day(8 - i)))
  assert.equal(ach(play(hist([{ slug: 'b', runs, events: [] }])), 'iron').unlocked, false)
})

test('noqueue: a card blocked exactly 24 h is not over the line (strictly more than 24 h breaks a day)', () => {
  const act = Array.from({ length: 8 }, (_, i) => ({ task: `t${i}`, kind: 'completed', ms: day(8 - i) }))
  const events = [...act, { task: 'q', kind: 'blocked', ms: day(5) }, { task: 'q', kind: 'unblocked', ms: day(5) + 24 * H }].sort((a, b) => a.ms - b.ms)
  assert.equal(ach(play(hist([{ slug: 'b', runs: [], events }])), 'noqueue').unlocked, true)
})

test('zero: each tier keeps the date of the FIRST series that reached it, not of a later one', () => {
  const ok = n => Array.from({ length: n }, () => 'completed')
  const outcomes = [...ok(25), 'crashed', ...ok(25)]
  const runs = outcomes.map((o, i) => run(o, day(30) + i * MIN))
  const z = ach(play(hist([{ slug: 'b', runs, events: [] }])), 'zero')
  assert.equal(z.tiers[0].ms, day(30) + 19 * MIN)
  assert.equal(z.unlockedMs, day(30) + 19 * MIN)
})

test('firstmission: a card done BEFORE the bot was first seen is not its first mission', () => {
  const first = day(10)
  const profiles = { ana: { name: 'ana', description: '', skills: { own: [], recent: [] }, stats: { firstSeenMs: first } } }
  const office = { boards: [{ slug: 'b', createdMs: null, tasks: [{ id: 't', status: 'done', completedMs: first - H, assignee: 'ana', title: '', modelOverride: null }] }], agents: [] }
  assert.equal(ach(computeGame(hist([], profiles), office, NOW, {}), 'firstmission').unlocked, false)
})

test('toasts: 3 fresh achievements are named, 4 are one grouped toast (MANY_AT)', () => {
  const g = ids => ({ achievements: ids.map(id => ({ id, unlocked: true })) })
  assert.equal(unlockAnnouncement(['chain'], g(['chain', 'smooth', 'wide', 'iron'])).kind, 'new')
  assert.equal(unlockAnnouncement(['chain'], g(['chain', 'smooth', 'wide', 'iron', 'rescue'])).kind, 'many')
})

test('drawScene stays within 60 ms with the cabinet FULL (every medal of the catalogue, every tier), 30 agents / 8 boards', () => {
  const boards = Array.from({ length: 8 }, (_, i) => ({ slug: `b${i}`, counts: { todo: 1, running: 0, blocked: 0, done: 7 * i }, total: 10 * i + 3, blocked: [] }))
  const agents = Array.from({ length: 30 }, (_, i) => ({ name: `bot${i}`, state: 'idle', home: i % 5 !== 4 ? boards[i % 8].slug : null, description: '', lastActivityMs: 1, officeMeta: {} }))
  const tiers = [null, 'bronze', 'silver', 'gold']
  const medals = ALL_ACHIEVEMENT_IDS.map((id, i) => ({ id, family: 'chains', tier: tiers[i % 4], pips: i % 4 }))
  const decor = { ...decorOf({ sober: false, incidentBoards: [], achievements: [], centurions: [], streak: 0 }), achievements: [...ALL_ACHIEVEMENT_IDS], medals }
  const model = toSceneModel({ agents, boards, ops: null }, { nowMs: 1e12, night: true, decor })
  assert.equal(model.decor.medals.length, ALL_ACHIEVEMENT_IDS.length)
  const layout = layoutScene(model)
  const base = buildBase(layout, model)
  drawScene(layout, base, model, 0)
  const runs = []
  for (let i = 0; i < 9; i++) { const t = performance.now(); drawScene(layout, base, model, i); runs.push(performance.now() - t) }
  runs.sort((a, b) => a - b)
  console.log(`  full cabinet, 30 agents / 8 boards: drawScene median ${runs[4].toFixed(1)} ms`)
  assert.ok(runs[4] < 250, 'drawScene is unreasonably slow')   // same hard ceiling as scene.test.mjs; the 60 ms objective is reported
})

}

// ===== achievements =====
{
// The audit journal stays append-only; the « Guardian » medal counts only a refusal whose line carries `request`: the id of a request the page had seen
// pending when its answer left (the agent half writes and serves it).
const T0 = new Date(2026, 10, 10, 12).getTime()
const refusal = (id, k = 0, extra = {}) => ({ ts: (T0 + k * 1000) / 1000, id, verb: 'approval', risk: 'safe', result: 'done', choice: 'deny', source: 'page', ...extra })
const guardian = entries => {
  const journal = toJournal({ ok: true, entries }, 50)
  const g = computeGame({ ok: true, profiles: {}, boards: [] }, { boards: [], agents: [] }, T0 + 86_400_000, {}, commandDefs(journal, 50))
  return g.achievements.find(a => a.id === 'guardian')
}
const REQ = '0123456789abcdef0123456789abcdef'

test('fifteen refusal lines without a request id unlock nothing', () => {
  const fake = Array.from({ length: 15 }, (_, i) => refusal(`ffffffff-0000-4000-8000-${String(i).padStart(12, '0')}`, i))
  assert.equal(guardian(fake).unlocked, false)
  assert.equal(guardian([refusal('x1', 0, { request: '' }), refusal('x2', 1, { request: 'short' }), refusal('x3', 2, { request: '../etc/passwd/........' })]).unlocked, false, 'an id of another shape is not an id')
})
test('a refusal that carries the request id the page saw unlocks it, dated on that line; failed / non-refusal lines do not', () => {
  const g = guardian([refusal('fake'), refusal('real', 3, { request: REQ })])
  assert.equal(g.unlocked, true)
  assert.equal(g.unlockedMs, T0 + 3000)
  assert.equal(guardian([refusal('a', 0, { request: REQ, result: 'failed' })]).unlocked, false)
  assert.equal(guardian([refusal('b', 0, { request: REQ, choice: 'once', risk: 'final' })]).unlocked, false)
  assert.equal(guardian([refusal('c', 0, { request: REQ, source: 'agent' })]).unlocked, false)
})
test('the journal read keeps `request` only when it has the shape of an id (and no key at all otherwise)', () => {
  const [kept] = toJournal({ ok: true, entries: [refusal('a', 0, { request: REQ })] }, 50).entries
  assert.equal(kept.request, REQ)
  const [none] = toJournal({ ok: true, entries: [refusal('b')] }, 50).entries
  assert.equal('request' in none, false)
  const [bad] = toJournal({ ok: true, entries: [refusal('c', 0, { request: 'rm -rf /' })] }, 50).entries
  assert.equal('request' in bad, false)
  assert.equal(REQUEST_RE.test(REQ), true)
})
test('the page stamps the request only when it had seen it pending; the body stays closed', () => {
  const order = { id: 'o1', verb: 'approval', choice: 'deny', requestId: REQ }
  assert.equal(requestStamp(order, true), REQ)
  assert.equal(requestStamp(order, false), null, 'a request the page never listed')
  assert.equal(requestStamp({ ...order, requestId: 'x y' }, true), null)
  assert.equal(requestStamp({ ...order, requestId: undefined }, true), null)
  assert.deepEqual(auditBody(order, { result: 'done' }, REQ), { id: 'o1', verb: 'approval', risk: 'safe', result: 'done', choice: 'deny', request: REQ })
  assert.equal('request' in auditBody(order, { result: 'done' }), false)
  assert.equal('request' in auditBody(order, { result: 'done' }, null), false)
})
}
