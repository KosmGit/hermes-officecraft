import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ACHIEVEMENT_IDS, ALL_ACHIEVEMENT_IDS, GRADES, OFFICE_LEVELS, RULES, SOBER_GAME, computeGame, dateText, decorOf, gradeOf, journalEntries, levelOf, seasonOf, trophyTip, unlockAnnouncement } from '../../src/core/game.js'
import { en } from '../../src/i18n/en.js'
import { es } from '../../src/i18n/es.js'
import { fr } from '../../src/i18n/fr.js'

// ===== game =====
{
const MIN = 60_000
const H = 3_600_000
const D = 86_400_000
// local noon: the tests build local dates, so they hold in any time zone
const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const NOW = at(2026, 11, 9, 15)

/* The reference table of the achievements, one row per achievement. */
const TABLE = [
  ['chain', 'First chain closed', 'a board of at least 10 non-archived cards, all `done`', 'last completion', 'trophy in the cabinet'],
  ['centurion', 'Centurion', '100 cards `done` on one board', '100th completion', 'golden « 100 » plaque near the whiteboard of the board'],
  ['zero', 'Zero breakage', '20 terminal runs in a row `completed` (terminal: `completed`, `crashed`, `timed_out`)', '20th of the series', 'the plant grows with the series in progress (5 stages) and wilts after a crash'],
  ['quick', 'Lightning decider', '`unblocked` less than an hour after the `blocked` of the same card', 'first case', 'bell on the counter'],
  ['review', 'Demanding reviewer', '`changes_requested` then `completed` on the same card', 'first case', 'trophy in the cabinet'],
  ['owl', 'Night owl', '5 cards finished the same night (0 h – 6 h) on one board', '5th completion', 'night light on the island of the board'],
  ['thrifty', 'Thrifty', 'tokens read from the cache ≥ 50 % of the input tokens (all profiles)', 'undated', 'chrome espresso machine'],
  ['hire', 'New recruit', 'a second profile exists', 'first activity of the 2nd profile', 'moving box (profiles under 7 days old)'],
  ['builder', 'Builder', 'a second board with cards', 'creation of the 2nd board', 'new island'],
  ['fire', 'Firefighter', 'a crash or a timeout followed by a successful run on the same board', 'first recovery', 'fire extinguisher near the door']
]
const COND = Object.fromEntries(TABLE.map(r => [r[0], r[2]]))

// fixtures ----------------------------------------------------------------------------------------------------
const task = (id, status = 'done', completedMs = null, createdMs = NOW - 90 * D) => ({ id, status, completedMs, createdMs, startedMs: null })
const board = (slug, tasks, createdMs) => ({ slug, createdMs, tasks })
const office = (boards = [], agents = []) => ({ boards, agents })
const hb = (slug, runs = [], events = []) => ({ slug, runs, events })
const hist = (boards = [], profiles = {}) => ({ ok: true, profiles, boards })
const run = (profile, outcome, endedMs) => ({ profile, outcome, startedMs: endedMs - MIN, endedMs })
const ev = (task, kind, ms) => ({ task, kind, ms })
const profile = (name, { first = null, input = 0, cache = 0 } = {}) => ({ name, stats: { firstSeenMs: first, inputTokens: input, cacheReadTokens: cache } })
const profiles = (...ps) => Object.fromEntries(ps.map(p => [p.name, p]))
const cards = (n, completedAt, status = 'done') => Array.from({ length: n }, (_, i) => task(`t${i}`, status, status === 'done' ? completedAt(i) : null))
const ach = (game, id) => game.achievements.find(a => a.id === id)
const runsOf = (n, outcome = 'completed', from = NOW - 30 * D, board = 'b') => Array.from({ length: n }, (_, i) => run('ana', outcome, from + i * MIN))

// the table ---------------------------------------------------------------------------------------------------
test('the table of these tests lists the first ten achievements, in order', () => {
  assert.deepEqual(TABLE.map(r => r[0]), [...ACHIEVEMENT_IDS])
})

test('without data: every achievement locked (the ten first, then the later ones), interns, level 1, a sleeping mascot, no incident', () => {
  const g = computeGame(null, office(), NOW, {})
  assert.deepEqual(g.achievements.map(a => a.id), [...ALL_ACHIEVEMENT_IDS])
  assert.deepEqual(ALL_ACHIEVEMENT_IDS.slice(0, 10), [...ACHIEVEMENT_IDS])
  assert.ok(g.achievements.every(a => !a.unlocked && a.unlockedMs === null && !a.dated))
  assert.deepEqual(g.office, { level: 1, name: 'garage', done: 0, next: 10 })
  assert.deepEqual(g.incidentBoards, [])
  assert.equal(g.mascotMood, 'sleep')
  assert.equal(g.streak, 0)
  assert.equal(g.lastFailMs, null)
  assert.deepEqual(g.recruits, [])
})

// 1. chain ----------------------------------------------------------------------------------------------------
test(`chain — ${COND.chain}: 9 cards all done stay below the threshold`, () => {
  const g = computeGame(null, office([board('b', cards(9, i => NOW - i * H))]), NOW, {})
  assert.equal(ach(g, 'chain').unlocked, false)
  assert.equal(ach(g, 'chain').unlockedMs, null)
})
test('chain — 10 cards with one still open does not unlock', () => {
  const t = cards(10, i => NOW - i * H)
  t[3] = task('open', 'running')
  assert.equal(ach(computeGame(null, office([board('b', t)]), NOW, {}), 'chain').unlocked, false)
})
test('chain — exactly 10 cards all done unlocks, dated on the LAST completion, on that board', () => {
  const t = cards(10, i => NOW - (i + 1) * D)   // the newest completion is NOW - 1 day
  const g = computeGame(null, office([board('other', cards(10, () => NOW - 5 * D, 'todo')), board('b', t)]), NOW, {})
  const a = ach(g, 'chain')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, NOW - D)
  assert.equal(a.dated, true)
  assert.deepEqual(a.fact, ['game.fact.chain', 'b', 10])
})
test('chain — archived cards are not counted, and the earliest chain wins', () => {
  const t = [...cards(10, i => NOW - 10 * D - i), task('old', 'archived')]
  const later = cards(10, () => NOW - D)
  const g = computeGame(null, office([board('late', later), board('early', t)]), NOW, {})
  assert.equal(ach(g, 'chain').unlockedMs, NOW - 10 * D)
  assert.equal(ach(g, 'chain').board, 'early')
})

// 2. centurion ------------------------------------------------------------------------------------------------
test(`centurion — ${COND.centurion}: 99 do not unlock`, () => {
  const g = computeGame(null, office([board('b', cards(99, i => NOW - i * MIN))]), NOW, {})
  assert.equal(ach(g, 'centurion').unlocked, false)
  assert.deepEqual(g.centurions, [])
  assert.deepEqual(ach(g, 'centurion').progress, [99, 100])
})
test('centurion — 100 on one board unlock, dated on the 100th completion (whatever the order of the cards)', () => {
  const stamps = Array.from({ length: 100 }, (_, i) => NOW - 200 * D + i * H)
  const shuffled = [...stamps].reverse()
  const g = computeGame(null, office([board('b', shuffled.map((ms, i) => task(`t${i}`, 'done', ms)))]), NOW, {})
  const a = ach(g, 'centurion')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, stamps[99])
  assert.deepEqual(g.centurions, ['b'])
  assert.equal(a.board, 'b')
})
test('centurion — 60 + 60 on two boards is not 100 on one', () => {
  const g = computeGame(null, office([board('a', cards(60, i => NOW - i * MIN)), board('b', cards(60, i => NOW - i * MIN))]), NOW, {})
  assert.equal(ach(g, 'centurion').unlocked, false)
})

// 3. zero -----------------------------------------------------------------------------------------------------
test(`zero — ${COND.zero}: 19 in a row do not unlock`, () => {
  const g = computeGame(hist([hb('b', runsOf(19))]), office(), NOW, {})
  assert.equal(ach(g, 'zero').unlocked, false)
  assert.equal(g.streak, 19)
})
test('zero — 20 in a row unlock, dated on the 20th of the series; the series in progress is the plant', () => {
  const from = NOW - 30 * D
  const g = computeGame(hist([hb('b', runsOf(23, 'completed', from))]), office(), NOW, {})
  assert.equal(ach(g, 'zero').unlocked, true)
  assert.equal(ach(g, 'zero').unlockedMs, from + 19 * MIN)
  assert.equal(g.streak, 23)
  assert.equal(g.lastFailMs, null)
})
test('zero — a crash resets the series (19 + crash + 19 is not 20) and remembers when it broke', () => {
  const runs = [...runsOf(19, 'completed', NOW - 40 * D), run('ana', 'crashed', NOW - 20 * D), ...runsOf(19, 'completed', NOW - 10 * D)]
  const g = computeGame(hist([hb('b', runs)]), office(), NOW, {})
  assert.equal(ach(g, 'zero').unlocked, false)
  assert.equal(g.streak, 19)
  assert.equal(g.lastFailMs, NOW - 20 * D)
  const withTimeout = computeGame(hist([hb('b', [run('ana', 'timed_out', NOW - D), ...runsOf(3, 'completed', NOW - H)])]), office(), NOW, {})
  assert.equal(withTimeout.streak, 3)
})
test('zero — only terminal outcomes count: a blocked or reclaimed run neither adds nor breaks the series', () => {
  const runs = [...runsOf(10, 'completed', NOW - 30 * D), run('ana', 'blocked', NOW - 25 * D), run('ana', 'reclaimed', NOW - 24 * D), ...runsOf(10, 'completed', NOW - 20 * D)]
  assert.equal(ach(computeGame(hist([hb('b', runs)]), office(), NOW, {}), 'zero').unlocked, true)
  assert.equal(ach(computeGame(hist([hb('b', [...runsOf(19, 'completed', NOW - 30 * D), run('ana', 'blocked', NOW - 5 * D)])]), office(), NOW, {}), 'zero').unlocked, false)
})
test('zero — the series runs across boards in time order', () => {
  const a = runsOf(10, 'completed', NOW - 30 * D)
  const b = Array.from({ length: 10 }, (_, i) => run('ana', 'completed', NOW - 30 * D + 30 * MIN + i * MIN))
  const g = computeGame(hist([hb('a', a), hb('b', b)]), office(), NOW, {})
  assert.equal(ach(g, 'zero').unlocked, true)
  assert.equal(ach(g, 'zero').unlockedMs, NOW - 30 * D + 30 * MIN + 9 * MIN)
})

// 4. quick ----------------------------------------------------------------------------------------------------
test(`quick — ${COND.quick}: exactly one hour does not unlock`, () => {
  const g = computeGame(hist([hb('b', [], [ev('c1', 'blocked', NOW - 5 * H), ev('c1', 'unblocked', NOW - 4 * H)])]), office(), NOW, {})
  assert.equal(ach(g, 'quick').unlocked, false)
})
test('quick — one hour minus a second unlocks, dated on the unblock, the first case wins', () => {
  const events = [ev('slow', 'blocked', NOW - 9 * H), ev('slow', 'unblocked', NOW - 7 * H), ev('c2', 'blocked', NOW - 3 * H), ev('c2', 'unblocked', NOW - 2 * H - 1000), ev('c3', 'blocked', NOW - 2 * H), ev('c3', 'unblocked', NOW - 2 * H + 5 * MIN)]
  const g = computeGame(hist([hb('b', [], events)]), office(), NOW, {})
  const a = ach(g, 'quick')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, NOW - 2 * H - 1000)
  assert.deepEqual(a.fact, ['game.fact.quick', 'b', 59])
})
test('quick — an unblock of another card, or without a blocked event before it, is not a case', () => {
  const g = computeGame(hist([hb('b', [], [ev('c1', 'blocked', NOW - 3 * H), ev('c2', 'unblocked', NOW - 3 * H + MIN), ev('c3', 'unblocked', NOW - 2 * H)])]), office(), NOW, {})
  assert.equal(ach(g, 'quick').unlocked, false)
})
test('quick — the same task id on two boards is two cards', () => {
  const g = computeGame(hist([hb('a', [], [ev('t1', 'blocked', NOW - 3 * H)]), hb('b', [], [ev('t1', 'unblocked', NOW - 3 * H + MIN)])]), office(), NOW, {})
  assert.equal(ach(g, 'quick').unlocked, false)
})

// 5. review ---------------------------------------------------------------------------------------------------
test(`review — ${COND.review}: completed BEFORE the request does not unlock`, () => {
  const g = computeGame(hist([hb('b', [], [ev('c1', 'completed', NOW - 3 * H), ev('c1', 'changes_requested', NOW - 2 * H)])]), office(), NOW, {})
  assert.equal(ach(g, 'review').unlocked, false)
  assert.equal(ach(computeGame(hist([hb('b', [], [ev('c1', 'changes_requested', NOW - 2 * H), ev('c2', 'completed', NOW - H)])]), office(), NOW, {}), 'review').unlocked, false)
})
test('review — changes requested, then completed on the same card unlocks, dated on the completion (first case)', () => {
  const events = [ev('c1', 'changes_requested', NOW - 5 * H), ev('c1', 'review_requested', NOW - 4 * H), ev('c1', 'completed', NOW - 3 * H), ev('c2', 'changes_requested', NOW - 2 * H), ev('c2', 'completed', NOW - H)]
  const a = ach(computeGame(hist([hb('b', [], events)]), office(), NOW, {}), 'review')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, NOW - 3 * H)
  assert.equal(a.board, 'b')
})

// 6. owl ------------------------------------------------------------------------------------------------------
const night = (day, n, hour = 2) => Array.from({ length: n }, (_, i) => at(2026, 10, day, hour, i * 7))
test(`owl — ${COND.owl}: 4 the same night do not unlock`, () => {
  const g = computeGame(null, office([board('b', night(5, 4).map((ms, i) => task(`t${i}`, 'done', ms)))]), NOW, {})
  assert.equal(ach(g, 'owl').unlocked, false)
  assert.equal(g.owlBoard, null)
})
test('owl — 5 the same night on one board unlock, dated on the 5th, and name the board (the night light)', () => {
  const stamps = night(5, 5)
  const g = computeGame(null, office([board('b', stamps.map((ms, i) => task(`t${i}`, 'done', ms)))]), NOW, {})
  assert.equal(ach(g, 'owl').unlocked, true)
  assert.equal(ach(g, 'owl').unlockedMs, stamps[4])
  assert.equal(g.owlBoard, 'b')
})
test('owl — 5 cards over two nights, or at 06:00, or on two boards, are not one night', () => {
  const split = [...night(5, 3), ...night(6, 2)]
  assert.equal(ach(computeGame(null, office([board('b', split.map((ms, i) => task(`t${i}`, 'done', ms)))]), NOW, {}), 'owl').unlocked, false)
  const sixOclock = night(5, 5, 6)
  assert.equal(ach(computeGame(null, office([board('b', sixOclock.map((ms, i) => task(`t${i}`, 'done', ms)))]), NOW, {}), 'owl').unlocked, false)
  const apart = [board('a', night(5, 3).map((ms, i) => task(`a${i}`, 'done', ms))), board('c', night(5, 2).map((ms, i) => task(`c${i}`, 'done', ms)))]
  assert.equal(ach(computeGame(null, office(apart), NOW, {}), 'owl').unlocked, false)
})
test('owl — 00:00 counts, 05:59 counts', () => {
  const stamps = [at(2026, 10, 5, 0, 0), at(2026, 10, 5, 1), at(2026, 10, 5, 3), at(2026, 10, 5, 4), at(2026, 10, 5, 5, 59)]
  assert.equal(ach(computeGame(null, office([board('b', stamps.map((ms, i) => task(`t${i}`, 'done', ms)))]), NOW, {}), 'owl').unlocked, true)
})

// 7. thrifty --------------------------------------------------------------------------------------------------
test(`thrifty — ${COND.thrifty}: 49 % does not unlock`, () => {
  const g = computeGame(hist([], profiles(profile('a', { input: 51, cache: 49 }))), office(), NOW, {})
  assert.equal(ach(g, 'thrifty').unlocked, false)
  assert.deepEqual(ach(g, 'thrifty').progress, [49, 50])
})
test('thrifty — exactly 50 % across all profiles unlocks, and is NOT dated', () => {
  const g = computeGame(hist([], profiles(profile('a', { input: 100, cache: 0 }), profile('b', { input: 0, cache: 100 }))), office(), NOW, {})
  const a = ach(g, 'thrifty')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, null)
  assert.equal(a.dated, false)
})
test('thrifty — no token at all is not 50 %, and volume alone buys nothing', () => {
  assert.equal(ach(computeGame(hist([], profiles(profile('a'))), office(), NOW, {}), 'thrifty').unlocked, false)
  assert.equal(ach(computeGame(hist([], profiles(profile('a', { input: 9_000_000, cache: 0 }))), office(), NOW, {}), 'thrifty').unlocked, false)
})

// 8. hire -----------------------------------------------------------------------------------------------------
test(`hire — ${COND.hire}: a single profile does not unlock`, () => {
  const g = computeGame(hist([], profiles(profile('a', { first: NOW - 30 * D }))), office(), NOW, {})
  assert.equal(ach(g, 'hire').unlocked, false)
  assert.deepEqual(g.recruits, [])
})
test('hire — a second profile unlocks, dated on the first activity of the 2nd profile', () => {
  const g = computeGame(hist([], profiles(profile('c', { first: NOW - 2 * D }), profile('a', { first: NOW - 90 * D }), profile('b', { first: NOW - 40 * D }))), office(), NOW, {})
  const a = ach(g, 'hire')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, NOW - 40 * D)
  assert.deepEqual(g.recruits, ['c'])
})
test('hire — the moving box is for profiles under 7 days old (7 days exactly is not)', () => {
  const g = computeGame(hist([], profiles(profile('a', { first: NOW - 60 * D }), profile('b', { first: NOW - 7 * D + 1 }), profile('c', { first: NOW - 7 * D }))), office(), NOW, {})
  assert.deepEqual(g.recruits, ['b'])
})

// 9. builder --------------------------------------------------------------------------------------------------
test(`builder — ${COND.builder}: an empty second board does not unlock`, () => {
  const g = computeGame(null, office([board('a', cards(3, () => NOW), NOW - 50 * D), board('empty', [], NOW - 10 * D)]), NOW, {})
  assert.equal(ach(g, 'builder').unlocked, false)
})
test('builder — a second board with cards unlocks, dated on the creation of the 2nd board', () => {
  const g = computeGame(null, office([board('c', cards(1, () => NOW), NOW - 5 * D), board('a', cards(3, () => NOW), NOW - 50 * D), board('b', cards(2, () => NOW), NOW - 20 * D)]), NOW, {})
  assert.equal(ach(g, 'builder').unlocked, true)
  assert.equal(ach(g, 'builder').unlockedMs, NOW - 20 * D)
})
test('builder — a board with no creation date falls back to its oldest card', () => {
  const g = computeGame(null, office([board('a', cards(1, () => NOW), NOW - 50 * D), board('b', [task('x', 'todo', null, NOW - 12 * D), task('y', 'todo', null, NOW - 3 * D)])]), NOW, {})
  assert.equal(ach(g, 'builder').unlockedMs, NOW - 12 * D)
})

// 10. fire ----------------------------------------------------------------------------------------------------
test(`fire — ${COND.fire}: a crash with no recovery is an open incident, not a trophy`, () => {
  const g = computeGame(hist([hb('b', [run('ana', 'completed', NOW - 3 * H), run('ana', 'crashed', NOW - 2 * H)])]), office(), NOW, {})
  assert.equal(ach(g, 'fire').unlocked, false)
  assert.deepEqual(g.incidentBoards, ['b'])
})
test('fire — a success on ANOTHER board is not a recovery', () => {
  const g = computeGame(hist([hb('a', [run('ana', 'crashed', NOW - 2 * H)]), hb('b', [run('ana', 'completed', NOW - H)])]), office(), NOW, {})
  assert.equal(ach(g, 'fire').unlocked, false)
  assert.deepEqual(g.incidentBoards, ['a'])
})
test('fire — a crash then a success on the same board unlocks, dated on the first recovery; post-mortem data', () => {
  const runs = [run('ana', 'crashed', NOW - 5 * H), run('ana', 'timed_out', NOW - 4 * H), run('ana', 'completed', NOW - 3 * H + 30 * MIN), run('ana', 'crashed', NOW - 2 * H), run('ana', 'completed', NOW - H)]
  const g = computeGame(hist([hb('b', runs)]), office(), NOW, {})
  const a = ach(g, 'fire')
  assert.equal(a.unlocked, true)
  assert.equal(a.unlockedMs, NOW - 3 * H + 30 * MIN)
  assert.deepEqual(g.incidents[0], { board: 'b', startMs: NOW - 5 * H, endMs: NOW - 3 * H + 30 * MIN, fails: 2 })
  assert.equal(g.incidents.length, 2)
  assert.deepEqual(g.incidentBoards, [])
  assert.deepEqual(a.fact, ['game.fact.fire', 'b', 150, 2])
})
test('incident — open on the board whose LAST terminal run failed; the mascot hides', () => {
  const g = computeGame(hist([hb('a', [run('x', 'crashed', NOW - 2 * H), run('x', 'completed', NOW - H)]), hb('b', [run('y', 'completed', NOW - 2 * H), run('y', 'timed_out', NOW - H)])]), office([], [{ name: 'x', state: 'working' }]), NOW, {})
  assert.deepEqual(g.incidentBoards, ['b'])
  assert.equal(g.mascotMood, 'hide')
})

// grades, levels, seasons -------------------------------------------------------------------------------------
test('grades at the borders: intern 0, confirmed 5, senior 20, legend 80', () => {
  const at_ = n => gradeOf(n)
  for (const [n, id, short] of [[0, 'stagiaire', 'St'], [4, 'stagiaire', 'St'], [5, 'confirme', 'Cf'], [19, 'confirme', 'Cf'], [20, 'senior', 'Sr'], [79, 'senior', 'Sr'], [80, 'legende', 'Lg'], [1000, 'legende', 'Lg']]) {
    assert.deepEqual([at_(n).id, at_(n).short, at_(n).runs], [id, short, n], `${n} runs`)
  }
  assert.equal(gradeOf(4).next, 5)
  assert.equal(gradeOf(80).next, null)
  assert.deepEqual(GRADES.map(g => g.at), [0, 5, 20, 80])
})
test('grades per agent come from their successful runs only (a crash is not a run done)', () => {
  const runs = [...Array.from({ length: 5 }, (_, i) => run('ana', 'completed', NOW - i * H - H)), ...Array.from({ length: 80 }, (_, i) => run('bob', 'completed', NOW - 90 * D + i * MIN)), run('cy', 'crashed', NOW - 2 * H)]
  const g = computeGame(hist([hb('b', runs)]), office([], [{ name: 'ana' }, { name: 'bob' }, { name: 'cy' }, { name: 'dee' }]), NOW, {})
  assert.deepEqual([g.grades.ana.id, g.grades.bob.id, g.grades.cy.id, g.grades.dee.id], ['confirme', 'legende', 'stagiaire', 'stagiaire'])
  assert.equal(g.grades.ana.runs, 5)
  assert.equal(g.grades.dee.runs, 0)
})
test('office levels at the borders: garage 0, open space 10, floor 50, campus 200, skyscraper 1000', () => {
  for (const [n, level, name] of [[0, 1, 'garage'], [9, 1, 'garage'], [10, 2, 'open_space'], [49, 2, 'open_space'], [50, 3, 'floor'], [199, 3, 'floor'], [200, 4, 'campus'], [999, 4, 'campus'], [1000, 5, 'skyscraper'], [5000, 5, 'skyscraper']]) {
    const l = levelOf(n)
    assert.deepEqual([l.level, l.name], [level, name], `${n} cards`)
  }
  assert.equal(levelOf(9).next, 10)
  assert.equal(levelOf(1000).next, null)
  assert.deepEqual(OFFICE_LEVELS.map(l => l.at), [0, 10, 50, 200, 1000])
})
test('the office level counts cards done on every board (archived ones are not served), not cards created', () => {
  const g = computeGame(null, office([board('a', cards(6, () => NOW)), board('b', [...cards(4, () => NOW), ...cards(500, () => null, 'todo')])]), NOW, {})
  assert.deepEqual(g.office, { level: 2, name: 'open_space', done: 10, next: 50 })
})
test('seasons at the limit dates: Halloween 20 Oct – 2 Nov, Christmas 1 Dec – 6 Jan, local dates', () => {
  const s = (m, d, h = 12) => seasonOf(at(2026, m, d, h))
  assert.equal(s(10, 19), null)
  assert.equal(s(10, 20, 0), 'halloween')
  assert.equal(s(10, 20), 'halloween')
  assert.equal(s(11, 2, 23), 'halloween')
  assert.equal(s(11, 3, 0), null)
  assert.equal(s(11, 3), null)
  assert.equal(s(11, 30, 23), null)
  assert.equal(s(12, 1, 0), 'xmas')
  assert.equal(s(12, 25), 'xmas')
  assert.equal(s(1, 6, 23), 'xmas')
  assert.equal(s(1, 7, 0), null)
  assert.equal(s(7, 14), null)
  assert.equal(computeGame(null, office(), at(2026, 10, 31), {}).season, 'halloween')
})

// life of the office ------------------------------------------------------------------------------------------
test('mascot: hides on an incident, alerts when a card is blocked, plays when someone works, else sleeps', () => {
  const blocked = office([board('b', [task('c', 'blocked')])], [{ name: 'a', state: 'working' }])
  assert.equal(computeGame(null, blocked, NOW, {}).mascotMood, 'alert')
  assert.equal(computeGame(null, office([board('b', [task('c', 'running')])], [{ name: 'a', state: 'working' }]), NOW, {}).mascotMood, 'play')
  assert.equal(computeGame(null, office([], [{ name: 'a', state: 'idle' }]), NOW, {}).mascotMood, 'sleep')
  assert.equal(computeGame(hist([hb('b', [run('a', 'crashed', NOW - H)])]), blocked, NOW, {}).mascotMood, 'hide')
})
test('decision streak: consecutive local days with an unblocked card; an empty today does not break it', () => {
  const ev_ = (d, h) => ev('c', 'unblocked', at(2026, 11, d, h))
  const g = computeGame(hist([hb('b', [], [ev_(8, 10), ev_(7, 9), ev_(6, 20), ev_(3, 10)])]), office(), NOW, {})
  assert.deepEqual(g.quests, { streakDays: 3 })
  const g2 = computeGame(hist([hb('b', [], [ev_(9, 9), ev_(9, 10), ev_(8, 10)])]), office(), NOW, {})
  assert.deepEqual(g2.quests, { streakDays: 2 })
  assert.equal(computeGame(hist([hb('b', [], [ev_(5, 9)])]), office(), NOW, {}).quests.streakDays, 0)
})

// sober, purity, privacy --------------------------------------------------------------------------------------
test('sober mode computes nothing: no achievement, no grade, no level, no mascot, no season, no incident', () => {
  const full = hist([hb('b', [run('a', 'crashed', NOW - H)])], profiles(profile('a', { first: NOW - D }), profile('b', { first: NOW - D })))
  const g = computeGame(full, office([board('b', cards(12, () => NOW - D))], [{ name: 'a', state: 'working' }]), at(2026, 10, 31), { sober: true })
  assert.equal(g, SOBER_GAME)
  assert.equal(g.sober, true)
  assert.deepEqual([g.achievements, g.incidentBoards, g.recruits, g.centurions], [[], [], [], []])
  assert.deepEqual([g.office, g.season, g.mascotMood, g.owlBoard, g.quests, g.streak, g.lastFailMs], [null, null, null, null, null, 0, null])
  assert.deepEqual(decorOf(g), { sober: true })
  assert.deepEqual(journalEntries(g), [])
  assert.deepEqual(unlockAnnouncement(null, g), { kind: null, ids: [], next: [] })
})
test('pure and deterministic: same input, same output, input untouched', () => {
  const freeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o) } return o }
  const h = freeze(hist([hb('b', [...runsOf(21), run('ana', 'crashed', NOW - 2 * H)], [ev('c', 'blocked', NOW - 3 * H), ev('c', 'unblocked', NOW - 2 * H)])], profiles(profile('a', { first: NOW - 3 * D, input: 1, cache: 5 }), profile('b', { first: NOW - 80 * D }))))
  const o = freeze(office([board('b', cards(10, i => NOW - i * D))], [{ name: 'ana', state: 'working' }]))
  assert.deepEqual(computeGame(h, o, NOW, {}), computeGame(h, o, NOW, {}))
  assert.equal(JSON.stringify(computeGame(h, o, NOW, {})).includes('undefined'), false)
})
test('nothing rewards volume: thousands of cards created, sessions and tokens unlock nothing', () => {
  const o = office([board('a', cards(3000, () => null, 'todo'), NOW)])
  const h = hist([hb('a')], profiles(profile('a', { first: NOW - 30 * D, input: 50_000_000, cache: 1000 })))
  const g = computeGame(h, o, NOW, {})
  assert.deepEqual(g.achievements.filter(a => a.unlocked), [])
  assert.equal(g.office.level, 1)
})
test('nothing rewards volume: a 400-day-old profile with 50 M tokens unlocks `veteran` only, for its calendar age', () => {
  // `veteran` is calendar age, written as such in the table above; the tokens and the 3000 cards add nothing
  const o = office([board('a', cards(3000, () => null, 'todo'), NOW)])
  const h = hist([hb('a')], profiles(profile('a', { first: NOW - 400 * D, input: 50_000_000, cache: 1000 })))
  assert.deepEqual(computeGame(h, o, NOW, {}).achievements.filter(a => a.unlocked).map(a => a.id), ['veteran'])
})
test('a failed /history (ok: false) is the same as none: card-based facts still hold, history-based ones stay locked', () => {
  const g = computeGame({ ok: false, profiles: {}, boards: [] }, office([board('b', cards(10, i => NOW - i * H))]), NOW, {})
  assert.deepEqual(g.achievements.filter(a => a.unlocked).map(a => a.id), ['chain'])
})

// decor, announcements, tooltips, journal ---------------------------------------------------------------------
test('decorOf feeds the scene Decor with unlocked achievements only', () => {
  const g = computeGame(hist([hb('b', [run('a', 'crashed', NOW - H)])]), office([board('b', cards(10, i => NOW - i * H))], [{ name: 'a', state: 'idle' }]), at(2026, 12, 24), {})
  const d = decorOf(g)
  assert.equal(d.sober, false)
  assert.deepEqual(d.achievements, ['chain'])
  assert.deepEqual(d.incidentBoards, ['b'])
  assert.equal(d.season, 'xmas')
  assert.equal(d.mascotMood, 'hide')
  assert.equal(d.lastFailMs, NOW - H)
  assert.deepEqual(decorOf(null), { sober: true })
})
test('the first launch announces ONCE « history analysed: N », later runs only what is new, the seen set only grows', () => {
  const g = computeGame(null, office([board('b', cards(10, i => NOW - i * H))]), NOW, {})
  const first = unlockAnnouncement(null, g)
  assert.deepEqual([first.kind, first.ids, first.next], ['first', ['chain'], ['chain']])
  assert.equal(unlockAnnouncement(first.next, g).kind, null)
  const more = computeGame(hist([hb('b', [run('a', 'crashed', NOW - 2 * H), run('a', 'completed', NOW - H)])]), office([board('b', cards(10, i => NOW - i * H))]), NOW, {})
  const next = unlockAnnouncement(['chain'], more)
  assert.deepEqual([next.kind, next.ids, next.next], ['new', ['fire'], ['chain', 'fire']])
  assert.deepEqual(unlockAnnouncement(['chain', 'fire', 'owl'], g).next, ['chain', 'fire', 'owl'])
  assert.deepEqual(unlockAnnouncement(null, computeGame(null, office(), NOW, {})), { kind: null, ids: [], next: [] })
  assert.deepEqual(unlockAnnouncement('garbage', g).kind, 'first')
})
test('trophy tooltips say fact + date + where in the office + source, and never a card title or message', () => {
  const stamps = Array.from({ length: 100 }, (_, i) => at(2026, 3, 1) + i * H)
  const g = computeGame(hist([hb('b')]), office([board('b', stamps.map((ms, i) => ({ ...task(`t${i}`, 'done', ms), title: 'SECRET TITLE' })))]), NOW, {})
  const tip = trophyTip(ach(g, 'centurion'), { lang: 'en', readMs: NOW, boards: 1 })
  assert.deepEqual(tip.name, ['game.ach.centurion.name'])
  assert.deepEqual(tip.fact, ['game.fact.centurion', 'b', 100])
  assert.equal(tip.when[0], 'game.tip.unlockedOn')
  assert.match(tip.when[1], /2026/)
  assert.deepEqual(tip.where, ['game.ach.centurion.where'])
  assert.equal(tip.source[0], 'game.src.cards')
  assert.equal(JSON.stringify([g, tip]).includes('SECRET'), false)
  const locked = trophyTip(ach(g, 'zero'), { lang: 'fr', readMs: NOW })
  assert.deepEqual(locked.fact, ['game.ach.zero.cond'])
  assert.equal(locked.when[0], 'game.tip.locked')
  assert.deepEqual(trophyTip(ach(computeGame(hist([], profiles(profile('a', { input: 1, cache: 1 }))), office(), NOW, {}), 'thrifty'), {}).when, ['game.tip.undated'])
  for (const id of ACHIEVEMENT_IDS) assert.ok(trophyTip(ach(g, id), { lang: 'es', readMs: NOW }).source.length >= 2)
})
test('journal lines: dated achievements and resolved incidents, newest first; the undated one stays out', () => {
  const runs = [run('a', 'crashed', NOW - 5 * H), run('a', 'timed_out', NOW - 4 * H), run('a', 'completed', NOW - 3 * H)]
  const g = computeGame(hist([hb('b', runs)], profiles(profile('a', { input: 1, cache: 9 }))), office(), NOW, {})
  const lines = journalEntries(g)
  assert.deepEqual(lines.map(l => l.kind).sort(), ['achievement', 'postmortem'])
  const pm = lines.find(l => l.kind === 'postmortem')
  assert.deepEqual([pm.board, pm.minutes, pm.fails], ['b', 120, 2])
  assert.ok(lines.some(l => l.kind === 'achievement' && l.id === 'fire'))
  assert.equal(lines.some(l => l.id === 'thrifty'), false)
  assert.ok(lines.every((l, i) => i === 0 || lines[i - 1].ms >= l.ms))
})
test('dateText is a date in the language asked, empty without one', () => {
  assert.match(dateText(at(2026, 10, 5), 'fr'), /2026/)
  assert.equal(dateText(null, 'fr'), '')
  assert.equal(RULES.zeroRuns, 20)
})

test('hire — exactly two profiles is the threshold (the moving box needs a profile under 7 days)', () => {
  const g = computeGame(hist([], profiles(profile('a', { first: NOW - 30 * D }), profile('b', { first: NOW - 3 * D }))), office(), NOW, {})
  assert.equal(ach(g, 'hire').unlocked, true)
  assert.equal(ach(g, 'hire').unlockedMs, NOW - 3 * D)
  assert.deepEqual(g.recruits, ['b'])
  assert.equal(ach(computeGame(hist([], profiles(profile('a', { first: NOW - 30 * D }))), office(), NOW, {}), 'hire').unlocked, false)
})

test('recruits — the moving box needs « hire »: one young profile alone is not a recruit', () => {
  const g = computeGame(hist([], profiles(profile('a', { first: NOW - 2 * D }))), office(), NOW, {})
  assert.equal(ach(g, 'hire').unlocked, false)
  assert.deepEqual(g.recruits, [])
})

test('grades — only completed runs count: crashed and timed-out runs earn nothing', () => {
  const runs = [...Array.from({ length: 4 }, (_, i) => run('a', 'completed', NOW - (i + 10) * H)), ...Array.from({ length: 30 }, (_, i) => run('a', i % 2 ? 'crashed' : 'timed_out', NOW - (i + 100) * H))]
  const g = computeGame(hist([{ slug: 'x', runs, events: [] }]), office([], [{ name: 'a', state: 'idle' }]), NOW, {})
  assert.equal(g.grades.a.id, 'stagiaire')
  assert.equal(g.grades.a.runs, 4)
})
}

// ===== game =====
{
// There are no « daily quests » (only the streak shows): no `quests.today`, no quest key.
const text = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('the game state carries the streak only, no `quests.today`', () => {
  const g = computeGame({ ok: true, profiles: [], boards: [], crons: [] }, { mode: 'full', agents: [], boards: [], ops: null }, Date.UTC(2026, 10, 9, 12), {})
  assert.deepEqual(Object.keys(g.quests), ['streakDays'])
})
test('no quest key in the dictionaries', () => {
  const keys = []
  const walk = (o, p) => { for (const [k, v] of Object.entries(o)) { const key = `${p}${k}`; keys.push(key); if (v && typeof v === 'object') walk(v, `${key}.`) } }
  for (const [lang, dict] of Object.entries({ en, fr, es })) {
    walk(dict, '')
    assert.deepEqual(keys.filter(k => /(^|\.)(quests?|quêtes?|misiones)(\.|$)/i.test(k)), [], lang)
    keys.length = 0
  }
})
}
