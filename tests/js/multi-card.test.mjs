import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { STALE_AFTER_MS, quietCards, runningCards } from '../../src/core/cards.js'
import { cardProgress, plusOf, taskTag } from '../../src/core/hud.js'
import { modelOf } from '../../src/core/models.js'
import { STALE_AFTER_MS as OFFICE_STALE, buildOffice } from '../../src/core/office.js'
import { INSPECTOR_CARDS_MAX, badgesOf, inspectorOf, newQuiet, quietNow, sinceOf } from '../../src/core/panel.js'
import { officeAt, toReplay } from '../../src/core/replay.js'
import { translate } from '../../src/core/translate.js'
import { messages } from '../../src/i18n/index.js'
import { labelOf } from '../../src/scene/labels.js'
import { cardsTip, codeText, quietTip, tagText } from '../../src/ui/cardFacts.js'
import { NOW, snapshot } from './helpers/single-card-scenes.mjs'

// ===== multi-card =====
{
// A bot that runs several cards — the main card, the « CODE +N » label, the silent-card sign, the inspector list, the model badge,
// the discreet announcement. Cases A–E, by value.
const s = ms => Math.round(ms / 1000)
const card = (id, title, startedAgoMin, beatAgoMin, extra = {}) => ({ id, title, status: 'running', assignee: 'reviewer', createdAt: s(NOW) - 7200,
  startedAt: startedAgoMin == null ? null : s(NOW) - startedAgoMin * 60, heartbeatAt: beatAgoMin == null ? null : s(NOW) - beatAgoMin * 60, ...extra })
const build = (state, tasks, extra = {}, boards = null) => buildOffice([{ name: 'reviewer', label: 'reviewer', state, model: 'example/model-fast', ...extra }], { ok: true, boards: boards || [{ slug: 'website', tasks }] }, NOW).agents[0]
const tr = lang => (key, ...args) => translate(messages, lang, key, args)
const min = ms => Math.round(ms / 60_000)

const CASES = {
  A: { state: 'working', tasks: [card('t_1', 'R-API3 — Review', 50, 1), card('t_2', 'R-API4 — Review', 3, 1)] },
  B: { state: 'working', tasks: [card('t_1', 'R-API3 — Review', 50, 40), card('t_2', 'R-API4 — Review', 3, 1)] },
  C: { state: 'idle', tasks: [card('t_1', 'R-API3 — Review', 50, 40), card('t_2', 'R-API4 — Review', 3, 1)] },
  D: { state: 'idle', tasks: [card('t_1', 'R-API3 — Review', 50, 40), card('t_2', 'R-API4 — Review', 20, 12)] },
  E: { state: 'working', tasks: [card('t_1', 'R-API3 — Review', 50, 1, { modelOverride: 'example/model-large' }), card('t_2', 'R-API4 — Review', 3, 1)] }
}
const A = Object.fromEntries(Object.entries(CASES).map(([k, c]) => [k, build(c.state, c.tasks)]))

test('case A: two fresh cards: R-API3 +1, 50 min, a full late bar, since 50 min; the state is unchanged', () => {
  const a = A.A
  assert.equal(a.state, 'working'); assert.equal(a.silentMs, null)
  const tag = taskTag(a, NOW)
  assert.equal(tag.ref, 'R-API3'); assert.equal(tag.span, '50 min'); assert.equal(tag.more, 1)
  assert.equal(tag.quiet, undefined)
  assert.equal(codeText(tag.ref, tag.more, tr('en')), 'R-API3 +1')
  assert.equal(tagText(tag, tr('en')), 'R-API3 +1 · 50 min')
  assert.deepEqual(cardProgress(a, NOW), { f: 1, late: true })
  assert.equal(sinceOf(a, NOW).ms, NOW - 50 * 60_000)
  const i = inspectorOf(a, { nowMs: NOW })
  assert.equal(i.current.code, 'R-API3'); assert.deepEqual(i.cards.map(c => c.code), ['R-API3', 'R-API4'])
  assert.deepEqual(i.cards.map(c => c.silentMs), [null, null])
  assert.deepEqual(labelOf(a, tag), { name: 'reviewer', code: 'R-API3', more: 1 })
})

test('cases B and C: a card silent for 40 min is marked (named, since when) whatever the bot state; state and silentMs unchanged', () => {
  for (const [k, state] of [['B', 'working'], ['C', 'idle']]) {
    const a = A[k]
    assert.equal(a.state, state, k); assert.equal(a.silentMs, null, k)
    assert.deepEqual(a.quiet.map(c => [c.id, min(c.silentMs)]), [['t_1', 40]], k)
    const tag = taskTag(a, NOW)
    assert.deepEqual(tag.quiet, [{ ref: 'R-API3', span: '40 min' }], k)
    assert.equal(labelOf(a, tag).quiet, true, k)
    assert.equal(quietTip(tag, tr('en')), 'R-API3 silent for 40 min', k)
    assert.equal(quietTip(tag, tr('fr')), 'R-API3 silencieuse depuis 40 min', k)
    assert.match(quietTip(tag, tr('es')), /R-API3 en silencio desde hace 40 min/, k)
    const i = inspectorOf(a, { nowMs: NOW })
    assert.equal(i.cards[0].code, 'R-API3'); assert.equal(min(i.cards[0].silentMs), 40); assert.equal(i.cards[1].silentMs, null)
  }
  // B: the bot works: its label still names the main card and says +1; C: a bot at rest has the sign and no code
  assert.equal(taskTag(A.B, NOW).kind, 'working')
  assert.equal(taskTag(A.C, NOW).kind, 'quiet')
  assert.equal(labelOf(A.C, taskTag(A.C, NOW)).code, '')
  assert.equal(cardProgress(A.C, NOW), null)
})

test('case D: both cards silent -> the bot is stale, 12 min, as before; the label names the main card and says +1; no extra sign', () => {
  const a = A.D
  assert.equal(a.state, 'stale'); assert.equal(min(a.silentMs), 12)
  const tag = taskTag(a, NOW)
  assert.deepEqual([tag.kind, tag.span, tag.ref, tag.more], ['stale', '12 min', 'R-API3', 1])
  assert.equal(tag.quiet, undefined, 'a stale bot says it by its state')
  assert.equal(codeText(tag.ref, tag.more, tr('en')), 'R-API3 +1')
  assert.equal(a.quiet.length, 2, 'the fact per card is still there (the longest silent first)')
  assert.deepEqual(a.quiet.map(c => c.id), ['t_1', 't_2'])
  assert.deepEqual(newQuiet(new Map([['reviewer', new Set()]]), [a]), [], 'a stale bot is announced by its state, not per card')
})

test('case E: a model pinned on the OLDER card only: the badge comes out, named after that card; the default row says which', () => {
  const a = A.E
  const m = modelOf(a)
  assert.equal(m.differs, true); assert.equal(m.card.cardId, 't_1'); assert.equal(m.card.model, 'example/model-large')
  const badges = badgesOf([a], new Map([[a.name, m]]))
  assert.equal(badges.length, 1); assert.equal(badges[0].code, 'R-API3'); assert.equal(badges[0].card, 'example/model-large')
  const i = inspectorOf(a, { nowMs: NOW, models: m })
  assert.equal(i.model.cardCode, 'R-API3')
  assert.equal(i.cards[0].pin, 'example/model-large'); assert.equal(i.cards[1].pin, null)
})

test('the badge: the FIRST card (main first) that differs from the default; none differs -> the main card; an unknown default never differs', () => {
  const two = build('working', [card('t_1', 'R-A1', 50, 1, { modelOverride: 'm-a' }), card('t_2', 'R-A2', 40, 1, { modelOverride: 'm-b' })])
  assert.equal(modelOf(two).card.cardId, 't_1')
  const same = build('working', [card('t_1', 'R-A1', 50, 1, { modelOverride: 'example/model-fast' }), card('t_2', 'R-A2', 40, 1)])
  assert.deepEqual([modelOf(same).card.cardId, modelOf(same).differs], ['t_1', false])
  const unknown = build('working', [card('t_1', 'R-A1', 50, 1, { modelOverride: 'm-a' })], { model: '', provider: '' })
  assert.equal(modelOf(unknown).differs, false)
  const provider = build('working', [card('t_1', 'R-A1', 50, 1), card('t_2', 'R-A2', 40, 1, { providerOverride: 'acme-cloud' })], { provider: 'example' })
  assert.deepEqual([modelOf(provider).card.cardId, modelOf(provider).differs], ['t_2', true])
})

test('the main card: started first, then board slug, then id; unknown start last; stable whatever the order of the read', () => {
  const t = (board, id, startedMs) => ({ board, id, startedMs, title: id })
  const base = [t('beta', 'z', 100), t('alpha', 'y', 100), t('alpha', 'x', 100), t('beta', 'a', 50), t('alpha', 'q', null), t('alpha', 'p', undefined)]
  const want = ['a', 'x', 'y', 'z', 'p', 'q']
  assert.deepEqual(runningCards({ running: base }, NOW).map(c => c.id), want)
  assert.deepEqual(runningCards({ running: [...base].reverse() }, NOW).map(c => c.id), want, 'the order of the read does not matter')
  assert.deepEqual(runningCards({ running: [...base.slice(3), ...base.slice(0, 3)] }, NOW).map(c => c.id), want)
  // on a tie the BOARD decides before the id (a board order that the id order contradicts; ids alone would put 'a' first)
  assert.deepEqual(runningCards({ running: [t('zeta', 'a', 100), t('alpha', 'b', 100)] }, NOW).map(c => c.id), ['b', 'a'])
  assert.deepEqual(runningCards({ running: [t('zeta', 'a', null), t('alpha', 'b', null)] }, NOW).map(c => c.id), ['b', 'a'])
  // a new card never takes the main place
  assert.equal(runningCards({ running: [...base, t('aaa', 'new', NOW - 1000)] }, NOW)[0].id, 'a')
  assert.deepEqual(runningCards({}, NOW), []); assert.deepEqual(runningCards(null, NOW), [])
})

test('two cards on two boards: one list, board slug kept, the oldest is main whatever its board', () => {
  const a = build('working', null, {}, [
    { slug: 'zeta', tasks: [card('t_1', 'Z1 — late board', 5, 1)] },
    { slug: 'alpha', tasks: [card('t_2', 'A1 — early board', 30, 1)] }
  ])
  const cards = runningCards(a, NOW)
  assert.deepEqual(cards.map(c => [c.board, c.id]), [['alpha', 't_2'], ['zeta', 't_1']])
  const i = inspectorOf(a, { nowMs: NOW })
  assert.deepEqual(i.cards.map(c => c.board), ['alpha', 'zeta']); assert.equal(i.current.board, 'alpha')
  assert.equal(taskTag(a, NOW).ref, 'A1')
})

test('equal starts: the order does not move from one refresh to the next', () => {
  const tasks = [card('t_2', 'B1', 10, 1), card('t_1', 'A1', 10, 1), card('t_3', 'C1', 10, 1)]
  const first = build('working', tasks).running
  const again = build('working', [...tasks].reverse()).running
  assert.deepEqual(runningCards({ running: first }, NOW).map(c => c.id), ['t_1', 't_2', 't_3'])
  assert.deepEqual(runningCards({ running: again }, NOW).map(c => c.id), ['t_1', 't_2', 't_3'])
})

test('a card with no start and no heartbeat is never said silent (nothing invented); the bot is not stale for it either', () => {
  const a = build('idle', [card('t_1', 'N1 — no signs', null, null), card('t_2', 'N2 — fresh', 4, 1)])
  assert.equal(a.state, 'idle'); assert.deepEqual(a.quiet, [])
  assert.deepEqual(runningCards(a, NOW).map(c => c.silentMs), [null, null])
  assert.equal(taskTag(a, NOW), null)
  // started 6 min ago, never a heartbeat: silent since the start (the rule of notify.py)
  assert.equal(min(runningCards({ running: [{ id: 'x', startedMs: NOW - 6 * 60_000 }] }, NOW)[0].silentMs), 6)
})

test('the silence threshold of a card is the bot one: > 5 min (exactly 5 min is not silent)', () => {
  assert.equal(STALE_AFTER_MS, 300_000); assert.equal(OFFICE_STALE, STALE_AFTER_MS)
  const at = ms => runningCards({ running: [{ id: 'x', startedMs: NOW - 3_600_000, heartbeatMs: NOW - ms }] }, NOW)[0].silentMs
  assert.equal(at(STALE_AFTER_MS), null); assert.equal(at(STALE_AFTER_MS + 1000), STALE_AFTER_MS + 1000)
})

test('a silent card on a bot waiting for you is marked (the state stays waiting)', () => {
  const a = build('idle', null, {}, [{ slug: 'website', tasks: [card('t_1', 'R-API3 — Review', 50, 40), { id: 't_9', title: 'Q9 — decide', status: 'blocked', assignee: 'reviewer', createdAt: s(NOW) - 3000 }] }])
  assert.equal(a.state, 'waiting'); assert.equal(min(a.silentMs), 40)
  const tag = taskTag(a, NOW)
  assert.deepEqual([tag.kind, tag.ref, tag.n], ['waiting', 'Q9', 1])
  assert.deepEqual(tag.quiet, [{ ref: 'R-API3', span: '40 min' }])
  assert.equal(labelOf(a, tag).quiet, true)
  assert.equal(inspectorOf(a, { nowMs: NOW }).cards[0].silentMs, 40 * 60_000)   // a single silent card of a waiting bot is listed and marked
})

test('a bot that works with ONE card: nothing marked, whatever the card heartbeat says (a single card reads as before)', () => {
  const a = build('working', [card('t_1', 'R-API3 — Review', 50, 40)])
  assert.deepEqual(a.quiet, []); assert.equal(taskTag(a, NOW).quiet, undefined)
  assert.equal(inspectorOf(a, { nowMs: NOW }).cards, undefined)
  assert.deepEqual(quietCards(runningCards(a, NOW), 'working'), [])
  assert.equal(quietCards(runningCards(a, NOW), 'idle').length, 1)
})

test('zero cards: no tag, no bar, no list, the inspector current is null', () => {
  const idle = build('idle', [])
  assert.equal(taskTag(idle, NOW), null); assert.equal(cardProgress(idle, NOW), null); assert.deepEqual(idle.quiet, [])
  const i = inspectorOf(idle, { nowMs: NOW })
  assert.equal(i.current, null); assert.equal(i.cards, undefined); assert.equal(i.cardsMore, undefined)
  assert.deepEqual(taskTag({ state: 'working', running: [] }, NOW), { kind: 'working', ref: '', span: '' })
  assert.deepEqual(modelOf(idle).card, null)
})

test('twelve cards: +9 on the label, the three named, four rows in the inspector and « +8 »', () => {
  const tasks = Array.from({ length: 12 }, (_, n) => card(`t_${n}`, `X${n + 1} — card ${n + 1}`, 100 - n, 1))
  const a = build('working', tasks)
  const tag = taskTag(a, NOW)
  assert.equal(tag.more, 11); assert.equal(plusOf(tag.more), '+9'); assert.equal(codeText(tag.ref, tag.more, tr('en')), 'X1 +9')
  assert.equal(tag.cards.length, 3); assert.equal(tag.cardsMore, 9)
  assert.equal(cardsTip(tag, tr('en')), '12 cards running: X1 1 h 40, X2 1 h 39, X3 1 h 38 +9')
  const i = inspectorOf(a, { nowMs: NOW })
  assert.equal(i.cards.length, INSPECTOR_CARDS_MAX); assert.equal(INSPECTOR_CARDS_MAX, 4); assert.equal(i.cardsMore, 8)
  assert.equal(tr('en')('insp.more', i.cardsMore), '+8 more')
  assert.equal(plusOf(9), '+9'); assert.equal(plusOf(10), '+9'); assert.equal(plusOf(1), '+1')
})

test('the code of the label: the main one, else the first card that has one, else « N cards »', () => {
  const some = build('working', [card('t_1', 'no code here', 50, 1), card('t_2', 'R-API4 — Review', 3, 1), card('t_3', 'R-API5 — Review', 2, 1)])
  assert.equal(taskTag(some, NOW).ref, 'R-API4')
  const none = build('working', [card('t_1', 'no code here', 50, 1), card('t_2', 'neither here', 3, 1)])
  const tag = taskTag(none, NOW)
  assert.equal(tag.ref, '')
  assert.equal(codeText(tag.ref, tag.more, tr('en')), '2 cards'); assert.equal(codeText(tag.ref, tag.more, tr('fr')), '2 cartes'); assert.equal(codeText(tag.ref, tag.more, tr('es')), '2 tarjetas')
  assert.equal(codeText('', 0, tr('en')), ''); assert.equal(codeText('S1', 0, tr('en')), 'S1')
  assert.deepEqual(tag.cards.map(c => c.ref), ['t_1', 't_2'], 'a card with no code is named by its id in the tooltip')
})

test('words: the tooltip says the number and names the cards with their time, in en, fr, es (plural, no-break space before « : » in French)', () => {
  const tag = taskTag(A.A, NOW)
  assert.equal(cardsTip(tag, tr('en')), '2 cards running: R-API3 50 min, R-API4 3 min')
  assert.equal(cardsTip(tag, tr('fr')), '2 cartes en cours\u00a0: R-API3 50 min, R-API4 3 min')
  assert.equal(cardsTip(tag, tr('es')), '2 tarjetas en curso: R-API3 50 min, R-API4 3 min')
  assert.equal(cardsTip(taskTag(build('working', [card('t_1', 'S1', 5, 1)]), NOW), tr('en')), '', 'one card: nothing added')
  for (const lang of ['en', 'fr', 'es']) {
    const t = tr(lang)
    assert.equal(t('tagCards', 1).startsWith('1 '), true); assert.ok(t('tagCards', 5).startsWith('5 '))
    assert.ok(t('insp.cards').length && t('insp.quietFor', '40 min').includes('40 min') && t('insp.modelOn', 'R-API3').includes('R-API3'))
    assert.ok(t('announce.quiet', 'reviewer', 'R-API3', '40 min').includes('R-API3'))
  }
  assert.ok(tr('fr')('announce.quiet', 'reviewer', 'R-API3', '40 min').includes('reviewer\u00a0:'))
  assert.notEqual(tr('fr')('insp.cards'), tr('en')('insp.cards'))
})

test('announcement: a card that goes silent is said once, nothing at first sight, nothing for a stale bot, nothing while it stays silent', () => {
  const quiet0 = build('working', [card('t_1', 'R-API3', 50, 1), card('t_2', 'R-API4', 3, 1)])
  const quiet1 = build('working', [card('t_1', 'R-API3', 50, 40), card('t_2', 'R-API4', 3, 1)])
  assert.deepEqual(newQuiet(null, [quiet1]), [], 'a page that opens says nothing')
  let seen = quietNow([quiet0])
  const fresh = newQuiet(seen, [quiet1])
  assert.equal(fresh.length, 1); assert.equal(fresh[0].card.id, 't_1')
  seen = quietNow([quiet1])
  assert.deepEqual(newQuiet(seen, [quiet1]), [], 'said once')
  assert.deepEqual(newQuiet(seen, [build('working', [card('t_1', 'R-API3', 50, 41), card('t_2', 'R-API4', 3, 1)])]), [], 'still the same card')
  const stale = build('idle', [card('t_1', 'R-API3', 50, 40), card('t_2', 'R-API4', 20, 12)])
  assert.deepEqual(newQuiet(quietNow([quiet0]), [stale]), [])
  // a second card going silent later is said too
  const both = build('working', [card('t_1', 'R-API3', 50, 40), card('t_2', 'R-API4', 30, 9), card('t_3', 'R-API5', 3, 1)])
  assert.deepEqual(newQuiet(seen, [both]).map(x => x.card.id), ['t_2'])
})

test('a single card reads exactly as before a bot could run several cards (taskTag, cardProgress, sinceOf, modelOf, inspectorOf; state, silentMs): 3 datasets, frozen', async () => {
  const frozen = JSON.parse(readFileSync(new URL('./fixtures/single-card-scenes.json', import.meta.url), 'utf8'))
  const now = JSON.parse(JSON.stringify(await snapshot(join(import.meta.dirname, '..', '..'))))
  assert.equal(now.length, frozen.length); assert.ok(frozen.length >= 12)
  assert.deepEqual(now, frozen)
})

test('nobody copies the « most recent card » any more: the running cards are read through src/core/cards.js only', () => {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
  const root = join(import.meta.dirname, '..', '..', 'src')
  for (const f of walk(root).filter(p => /\.(js|jsx)$/.test(p))) {
    const text = readFileSync(f, 'utf8')
    if (f.endsWith(join('core', 'cards.js'))) continue
    assert.ok(!/running\b[^\n]*\.sort\(|startedMs \|\| 0\) - \(/.test(text), `${f}: a running-card sort outside cards.js`)
    assert.ok(!/\.running\[0\]/.test(text), `${f}: running[0]`)
    assert.ok(!/Math\.max\(0, \.\.\.[^\n]*startedMs/.test(text), `${f}: Math.max of the start times`)
  }
})

test('wiring: the page announces silent cards through newQuiet (reset while a replay is shown), the list and the replay panel read the same facts as the label', () => {
  const read = f => readFileSync(join(import.meta.dirname, '..', '..', 'src', 'ui', f), 'utf8')
  const page = read('OfficePage.jsx')
  assert.match(page, /newQuiet\(seenQuiet\.current, office\.agents\)/)
  assert.match(page, /if \(replayOn\) \{[^}]*seenQuiet\.current = null/)
  assert.match(page, /t\('announce\.quiet'/)
  const scene = read('OfficeScene.jsx')
  assert.equal((scene.match(/data-quiet aria-hidden="true"/g) || []).length, 2, 'the sign of a silent card: on the scene label and on the list row')
  assert.match(scene, /codeText\(lab\.code, lab\.more, t\)/)
  const replay = read('ReplayPanel.jsx')
  assert.match(replay, /runningCards\(a, nowMs\)/); assert.match(replay, /data-moment-quiet/); assert.match(replay, /plusOf\(tag\.more\)/)
  const agent = read('AgentTab.jsx')
  assert.match(agent, /i\.cards \?/); assert.match(agent, /<ProjectChip slug=\{c\.board\}/); assert.match(agent, /t\('insp\.more', i\.cardsMore\)/); assert.match(agent, /<PixelBadge size=\{10\}/)
})

test('replay: a card whose run is open and NOT in a silence of /replay is alive at T (no silent mark); one in a silence is marked', () => {
  // two runs of the same bot, started 30 and 20 min before T; the agent half reports a silence on the first one only, from T-10 min.
  // The second card must not read « silent for 9 min » while /replay has no silence on it.
  const T = 1_800_000_000
  const raw = silences => ({ ok: true, at: T + 60, from: T - 3600, to: T + 60, boards: [{ slug: 'website', since: T - 86400,
    start: [['t_1', 'running', 'reviewer'], ['t_2', 'running', 'reviewer']], cards: { t_1: 'R-API4 — Review', t_2: 'R-API3 — Review' }, facts: [],
    runs: [{ start: T - 1800, end: null, profile: 'reviewer', task: 't_1' }, { start: T - 1200, end: null, profile: 'reviewer', task: 't_2' }], silences }] })
  const at = silences => officeAt([{ name: 'reviewer', label: 'reviewer', state: 'idle' }], toReplay(raw(silences)), T * 1000).agents[0]
  const alive = at([])
  assert.equal(alive.state, 'working')
  assert.deepEqual(runningCards(alive, T * 1000).map(c => [c.id, c.silentMs]), [['t_1', null], ['t_2', null]], 'no silence in the facts: no silent card')
  assert.deepEqual(alive.quiet, []); assert.equal(taskTag(alive, T * 1000).quiet, undefined)
  const hushed = at([['reviewer', 't_1', T - 600, T + 60]])
  assert.equal(hushed.state, 'working', 'the other run is alive')
  assert.deepEqual(hushed.quiet.map(c => c.id), ['t_1'])
  assert.deepEqual(taskTag(hushed, T * 1000).quiet, [{ ref: 'R-API4', span: '15 min' }])
})
}

// ===== multi-card =====
{
// The inspector's model line of a bot running several cards names the card that sets the model
// (« · on <code> »). Appended INSIDE the one-line, ellipsed span of the card's model, the code is cut: the panel reads
// « Card: example/model-large ·… » (at 1024 / 1440 / 1920 px). The code goes on a line of its own,
// like the default and the actual model under it; one card (no cardCode) renders exactly as before.
const agentTab = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'ui', 'AgentTab.jsx'), 'utf8')

test('inspector: the card that sets the model is not in the ellipsed one-line span of the model', () => {
  const dd = agentTab.match(/<dd data-insp-model[^>]*>([\s\S]*?)<\/dd>/)
  assert.ok(dd, 'the model row of the inspector')
  const one = dd[1].match(/<span className="one">([\s\S]*?)<\/span>/)
  assert.ok(one, 'the one-line span of the card model')
  assert.ok(!/modelOn/.test(one[1]), 'the code of the card must not be cut with the model name')
  assert.match(dd[1], /\{i\.model\.cardCode \? <small[^>]*>\{t\('insp\.modelOn', i\.model\.cardCode\)\}<\/small> : null\}/, 'the code on its own line, only with several cards')
})
}
