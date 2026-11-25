// The queue: a bot whose card waits for the work of someone else. The state and its priorities, the chain up to the head, who waits behind a
// card, the words of the sheet in three languages, and what the page must not invent (a loop, a card out of the team, a past it cannot read).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { formatSpan } from '../../src/core/hud.js'
import { buildOffice, summarizeOffice, toBoard } from '../../src/core/office.js'
import {
  QUEUE_CARDS_MAX, QUEUE_DEPTH_MAX, QUEUE_LINKS_MAX, chainOf, holdsBack, isWaiting, ordinalText, queueView, queuedState, toLinks, waitIndex, waitersOf, waitingByBot, waitsOn
} from '../../src/core/queue.js'
import { factText, holdsLine, queueLines, waitedLine, whoText } from '../../src/core/queueText.js'
import { buildRoster } from '../../src/core/roster.js'
import { officeAt, toReplay } from '../../src/core/replay.js'
import { messages } from '../../src/i18n/index.js'
import { translate } from '../../src/core/translate.js'

const NOW = 1_800_000_000_000
const sec = ms => ms / 1000
const src = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const tr = lang => (key, ...args) => translate(messages, lang, key, args)
/** The page's translator: a function with its language, like `useT()`. */
const T = lang => Object.assign(tr(lang), { lang, ago: ms => `${ms}` })

/** Profiles: `name: 'idle' | 'active' | 'working'` (the session fields of profiles.list), one row each. */
function desksOf(states) {
  const rows = Object.entries(states).map(([name, st]) => ({
    name,
    last_session: st === 'active' ? { id: `s-${name}`, source: 'desktop', last_active: sec(NOW - 60_000) } : st === 'idle' ? { id: `s-${name}`, source: 'desktop', last_active: sec(NOW - 3 * 3_600_000) } : null,
    worker_session: st === 'working' ? { id: `w-${name}`, source: 'kanban', last_active: sec(NOW - 20_000) } : null,
    ...(st === 'new' ? {} : {})
  }))
  return buildRoster({ profiles: rows }, NOW)
}

/** A card: [id, status, assignee, extra]. */
const card = ([id, status, assignee, extra = {}]) => ({
  id, title: extra.title ?? `Card ${id}`, status, assignee: assignee ?? null, createdAt: sec(NOW - (extra.age ?? 3) * 3_600_000),
  startedAt: status === 'running' ? sec(NOW - (extra.since ?? 12 * 60_000)) : null,
  heartbeatAt: status === 'running' ? sec(NOW - (extra.beat ?? 20_000)) : null
})
const board = (slug, cards, links = []) => ({ slug, createdAt: sec(NOW - 86_400_000), tasks: cards.map(card), links })
const officeOf = (states, boards) => buildOffice(desksOf(states), { ok: true, boards, ops: {} }, NOW)
const stateOf = (office, name) => office.agents.find(a => a.name === name).state

/* ---------- the state, and what it yields to ---------- */

test('queuedState: the full table. Only a bot at rest or with a recent session, with a waiting card and none running or blocked, is queued', () => {
  const states = ['working', 'waiting', 'stale', 'active', 'idle', 'new', 'unknown']
  let queued = 0
  for (const state of states) for (const running of [0, 1]) for (const blocked of [0, 1]) for (const waits of [0, 2]) {
    const want = waits > 0 && !running && !blocked && (state === 'idle' || state === 'active') ? 'queued' : state
    assert.equal(queuedState(state, { running, blocked, queued: waits }), want, `${state} running=${running} blocked=${blocked} waiting cards=${waits}`)
    if (want === 'queued') queued++
  }
  assert.equal(queued, 2, 'two cells of the table: idle and active, nothing else around them')
  assert.equal(queuedState('idle'), 'idle', 'no counts: unchanged')
  assert.equal(queuedState('idle', { queued: 1 }), 'queued')
})

test('buildOffice: queued only replaces rest and a recent session; a worker, a silent run and a blocked card win', () => {
  const o = officeOf(
    { rest: 'idle', recent: 'active', busy: 'working', mute: 'idle', ask: 'idle', fresh: 'new', up: 'idle', sleeper: 'idle' },
    [board('alpha', [
      ['head', 'running', 'up'],
      ['w1', 'todo', 'rest'], ['w2', 'todo', 'recent'], ['w3', 'todo', 'busy'], ['w4', 'todo', 'mute'], ['w5', 'todo', 'ask'], ['w6', 'todo', 'fresh'],
      ['r1', 'running', 'busy'], ['r2', 'running', 'mute', { beat: 20 * 60_000, since: 40 * 60_000 }], ['b1', 'blocked', 'ask']
    ], ['head', 'r1', 'r2', 'b1'].flatMap(p => ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(c => [p, c])))]
  )
  assert.equal(stateOf(o, 'rest'), 'queued')
  assert.equal(stateOf(o, 'recent'), 'queued', '« active without a card » is the other state it replaces')
  assert.equal(stateOf(o, 'busy'), 'working', 'a live worker session wins')
  assert.equal(stateOf(o, 'mute'), 'stale', 'a silent run wins')
  assert.equal(stateOf(o, 'ask'), 'waiting', 'a blocked card (a decision is yours) wins')
  assert.equal(stateOf(o, 'fresh'), 'new', 'no session at all says something about the data: it stays')
  assert.equal(stateOf(o, 'up'), 'idle', 'the head keeps its own state: a running card without a worker session read yet')
  assert.equal(stateOf(o, 'sleeper'), 'idle', 'no card at all: at rest')
  assert.deepEqual(summarizeOffice(o).queued, 2, 'the counts know the state (the header does not draw it)')
})

test('what waits: a `todo` card with an unfinished parent. A `todo` with no parent, a finished parent, a `ready` card are not waiting', () => {
  const o = officeOf(
    { a: 'idle', b: 'idle', c: 'idle', d: 'idle', e: 'idle', x: 'idle' },
    [board('alpha', [
      ['p1', 'running', 'x'], ['p2', 'done', 'x'], ['p3', 'archived', 'x'],
      ['t1', 'todo', 'a'],          // waits for p1
      ['t2', 'todo', 'b'],          // its only parent is done
      ['t3', 'todo', 'c'],          // no parent at all: created, not sorted, not promoted yet
      ['t4', 'ready', 'd'],         // ready: only waits for its turn
      ['t5', 'todo', 'e']           // its parent is archived (terminal)
    ], [['p1', 't1'], ['p2', 't2'], ['p1', 't4'], ['p3', 't5']])]
  )
  assert.deepEqual(o.agents.filter(a => a.state === 'queued').map(a => a.name), ['a'])
  assert.deepEqual(o.agents.find(a => a.name === 'a').queued.map(c => c.id), ['t1'])
  assert.deepEqual(o.agents.find(a => a.name === 'b').queued, [])
})

test('a link whose ends are not both served holds nothing back (another project, an archived card, junk)', () => {
  const o = officeOf({ a: 'idle', b: 'idle' }, [
    board('alpha', [['t1', 'todo', 'a']], [['ghost', 't1'], ['t1', 'nowhere']]),   // the parent is not on this board: a link never crosses a board
    board('beta', [['p', 'running', 'b'], ['t1', 'todo', 'b']], [['p', 't1']])      // the same id on another board has its own links
  ])
  assert.equal(stateOf(o, 'a'), 'idle', 'its parent is unknown here: not invented')
  assert.equal(stateOf(o, 'b'), 'idle', 'b waits for itself on beta: a queued bot needs a card of its own that waits, and b has one: see below')
})

test('a bot with a waiting card on one project and a running card on another is not queued', () => {
  const o = officeOf({ a: 'idle', p: 'idle' }, [board('alpha', [['p1', 'running', 'p'], ['t1', 'todo', 'a']], [['p1', 't1']]), board('beta', [['r', 'running', 'a', { beat: 20 * 60_000, since: 40 * 60_000 }]])])
  assert.equal(stateOf(o, 'a'), 'stale', 'its other card went silent: that wins')
  const o2 = officeOf({ a: 'idle', p: 'idle' }, [board('alpha', [['p1', 'running', 'p'], ['t1', 'todo', 'a']], [['p1', 't1']]), board('beta', [['r', 'running', 'a']])])
  assert.equal(stateOf(o2, 'a'), 'idle', 'a running card (no worker session read yet) is not « queued » either')
})

/* ---------- the chain ---------- */

const fixture = () => officeOf(
  { nova: 'idle', quill: 'idle', echo: 'idle', atlas: 'idle', forge: 'idle', orbit: 'idle' },
  [board('weather', [
    ['wording', 'blocked', 'echo', { title: 'Wording for the prompt' }],
    ['notes', 'todo', 'quill', { title: 'Release notes', age: 4 }],
    ['digest', 'todo', 'nova', { title: 'Summarise the notes', age: 3 }],
    ['deploy', 'running', 'atlas', { title: 'Preview deployments', since: 12 * 60_000 }],
    ['scan', 'todo', 'forge', { title: 'Scan the previews' }]
  ], [['wording', 'notes'], ['notes', 'digest'], ['deploy', 'scan']])]
)

test('one link: « waits for atlas · its card », the head is atlas, at work since 12 min, no rank', () => {
  const o = fixture()
  const v = queueView(o, o.agents.find(a => a.name === 'forge'), NOW)
  assert.equal(v.kind, 'queued')
  assert.deepEqual(v.waits.map(w => [w.who.name, w.who.kind, w.card.title]), [['atlas', 'bot', 'Preview deployments']])
  assert.equal(v.head.who.name, 'atlas')
  assert.deepEqual(v.head.fact, { kind: 'working', sinceMs: NOW - 12 * 60_000 })
  assert.equal(v.position, 1)
  assert.deepEqual(v.upstream, ['atlas'])
  const lines = queueLines(v, T('fr'), NOW, formatSpan)
  assert.equal(lines.head.fact, 'au travail depuis 12 min')
  assert.equal(lines.head.rank, '', 'right behind the head: no rank')
})

test('two links: quill waits for echo (blocked): the head is echo and « it needs you » (the sheet offers Decide)', () => {
  const o = fixture()
  const v = queueView(o, o.agents.find(a => a.name === 'quill'), NOW)
  assert.equal(v.head.who.name, 'echo')
  assert.deepEqual(v.head.fact, { kind: 'waiting' })
  const lines = queueLines(v, T('fr'), NOW, formatSpan)
  assert.equal(lines.head.fact, 'qui vous attend')
  assert.equal(lines.head.decide, true)
  assert.equal(lines.head.board, 'weather')
})

test('three links: nova waits for quill who waits for echo: 2nd behind the head, and both are lit on the scene', () => {
  const o = fixture()
  const nova = o.agents.find(a => a.name === 'nova')
  assert.equal(nova.state, 'queued')
  const v = queueView(o, nova, NOW)
  assert.deepEqual(v.waits.map(w => w.who.name), ['quill'])
  assert.equal(v.head.who.name, 'echo')
  assert.equal(v.position, 2)
  assert.deepEqual(v.upstream, ['quill', 'echo'], 'every bot between it and the head, nearest first')
  const fr = queueLines(v, T('fr'), NOW, formatSpan)
  assert.equal(fr.head.rank, '2ᵉ derrière')
  assert.equal(queueLines(v, T('en'), NOW, formatSpan).head.rank, '2nd behind')
  assert.equal(queueLines(v, T('es'), NOW, formatSpan).head.rank, '2.º detrás')
  assert.deepEqual(waitsOn(nova), ['quill'], 'the team list says « ← quill »')
})

test('two parents: the first two are named, then « +N »; the head is the most useful one (a decision of yours first)', () => {
  const o = officeOf({ a: 'idle', p1: 'idle', p2: 'idle', p3: 'idle' }, [board('alpha', [
    ['x1', 'running', 'p1'], ['x2', 'running', 'p2', { beat: 20 * 60_000, since: 40 * 60_000 }], ['x3', 'blocked', 'p3'], ['t', 'todo', 'a']
  ], [['x1', 't'], ['x2', 't'], ['x3', 't']])])
  const v = queueView(o, o.agents.find(a => a.name === 'a'), NOW)
  assert.deepEqual(v.waits.map(w => w.who.name), ['p1', 'p2'])
  assert.equal(v.waitsMore, 1)
  assert.equal(v.head.who.name, 'p3', 'blocked (yours to decide) before silent before working')
  assert.equal(v.headsMore, 2)
  assert.deepEqual(queueLines(v, T('fr'), NOW, formatSpan).waits.more, 1)
  assert.equal(queueLines(v, T('en'), NOW, formatSpan).head.more, '+2 more at the head')
  const silentFirst = officeOf({ a: 'idle', p1: 'idle', p2: 'idle' }, [board('alpha', [
    ['x1', 'running', 'p1'], ['x2', 'running', 'p2', { beat: 20 * 60_000, since: 40 * 60_000 }], ['t', 'todo', 'a']], [['x1', 't'], ['x2', 't']])])
  const sv = queueView(silentFirst, silentFirst.agents.find(a => a.name === 'a'), NOW)
  assert.equal(sv.head.who.name, 'p2')
  assert.equal(sv.head.fact.kind, 'silent')
  assert.equal(queueLines(sv, T('fr'), NOW, formatSpan).head.fact, 'silencieux depuis 20 min')
})

test('a parent with no assignee, or whose bot is not on the team, is said plainly', () => {
  const o = officeOf({ a: 'idle', b: 'idle' }, [board('alpha', [
    ['g', 'blocked', null, { title: 'Guard' }], ['t1', 'todo', 'a'], ['h', 'running', 'ghost', { title: 'Gone' }], ['t2', 'todo', 'b']
  ], [['g', 't1'], ['h', 't2']])])
  const a = queueLines(queueView(o, o.agents.find(x => x.name === 'a'), NOW), T('fr'), NOW, formatSpan)
  assert.equal(a.waits.items[0].who, 'une carte sans assigné')
  assert.equal(a.head.who, 'une carte sans assigné')
  assert.equal(a.head.fact, 'qui vous attend')
  const b = queueLines(queueView(o, o.agents.find(x => x.name === 'b'), NOW), T('en'), NOW, formatSpan)
  assert.equal(b.head.who, 'a card of ghost, who is not on the team')
  assert.equal(whoText({ kind: 'outside', name: 'ghost' }, T('es')), 'una tarjeta de ghost, que no está en el equipo')
})

test('a loop in a damaged base (Hermes refuses it) never loops here, and says so', () => {
  const o = officeOf({ a: 'idle', b: 'idle', c: 'idle' }, [board('alpha', [['x', 'todo', 'a'], ['y', 'todo', 'b'], ['z', 'todo', 'c']], [['x', 'y'], ['y', 'z'], ['z', 'x'], ['x', 'x']])])
  assert.deepEqual(o.agents.map(a => a.state), ['queued', 'queued', 'queued'])
  const v = queueView(o, o.agents.find(a => a.name === 'a'), NOW)
  assert.equal(v.loop, true)
  assert.equal(v.head, null)
  assert.equal(queueLines(v, T('fr'), NOW, formatSpan).note, 'Ces cartes s’attendent les unes les autres : la file tourne en rond.')
  assert.deepEqual(holdsBack(waitIndex(o.boards), 'alpha', 'x'), { cards: 2, bots: ['b', 'c'], capped: false }, 'the walk behind a card of a loop ends too')
})

test('a long queue is walked within its bounds: a chain of 200 cards and a card with 300 parents', () => {
  const chain = Array.from({ length: 200 }, (_, i) => [`c${i}`, i === 0 ? 'running' : 'todo', i === 0 ? 'head' : `bot${i}`])
  const links = Array.from({ length: 199 }, (_, i) => [`c${i}`, `c${i + 1}`])
  const idx = waitIndex([toBoard(board('long', chain, links))])
  const last = waitingByBot(idx).get('bot199')[0]
  const t0 = performance.now()
  const r = chainOf(idx, last, NOW)
  assert.ok(performance.now() - t0 < 50, 'walked in a few milliseconds')
  assert.equal(r.capped, true, 'the head is 199 cards away: deeper than the office follows')
  assert.ok(r.upstream.length <= QUEUE_DEPTH_MAX, `${r.upstream.length} cards walked, depth ${QUEUE_DEPTH_MAX}`)
  assert.equal(r.heads.length, 0)
  assert.equal(r.loop, false, 'cut short is not a loop')
  const near = chainOf(idx, waitingByBot(idx).get(`bot${QUEUE_DEPTH_MAX}`)[0], NOW)
  assert.equal(near.heads[0].depth, QUEUE_DEPTH_MAX, 'a head exactly at the depth limit is found')
  assert.equal(near.capped, false)
  // wide: 300 parents of one card
  const wide = Array.from({ length: 301 }, (_, i) => [`w${i}`, i === 300 ? 'todo' : 'running', i === 300 ? 'child' : `p${i}`])
  const wideIdx = waitIndex([toBoard({ slug: 'wide', tasks: wide.map(card), links: Array.from({ length: 300 }, (_, i) => [`w${i}`, 'w300']) })])
  const wr = chainOf(wideIdx, waitingByBot(wideIdx).get('child')[0], NOW)
  assert.ok(wr.upstream.length <= QUEUE_CARDS_MAX - 1, `${wr.upstream.length} cards at most`)
  assert.equal(wr.capped, true)
  assert.equal(wr.parents.length, 300, 'the direct parents are all known; the sheet names two')
})

test('a link served by an agent half is read as ids only, bounded, and junk is dropped', () => {
  assert.deepEqual(toLinks(null), [])
  assert.deepEqual(toLinks('a'), [])
  assert.deepEqual(toLinks([['a', 'b'], ['a'], [1, 2], null, ['', 'x'], ['q', 'q'], { 0: 'a', 1: 'b' }, ['c', 'd', 'e']]), [['a', 'b'], ['c', 'd']])
  assert.equal(toLinks(Array.from({ length: QUEUE_LINKS_MAX + 50 }, (_, i) => [`p${i}`, `c${i}`])).length, QUEUE_LINKS_MAX)
  assert.deepEqual(toBoard({ slug: 'x', tasks: [] }).links, [], 'an older agent half: no links, no error')
})

/* ---------- who waits behind a card ---------- */

test('behind a head: « N bots wait for this card » (three names at most), and what a blocked card holds back', () => {
  const o = fixture()
  const echo = o.agents.find(a => a.name === 'echo')
  const v = queueView(o, echo, NOW)
  assert.deepEqual([v.kind, v.bots, v.more, v.count], ['waited', ['quill', 'nova'], 0, 2])
  assert.deepEqual(waitedLine(v, T('fr'), n => n), { lead: '2 bots attendent cette carte :', names: ['quill', 'nova'], more: 0 })
  assert.equal(waitedLine({ ...v, count: 1, bots: ['quill'] }, T('en'), n => n).lead, '1 bot waits for this card:')
  assert.equal(waitedLine(v, T('es'), n => n).lead, '2 bots esperan esta tarjeta:')
  const idx = waitIndex(o.boards)
  assert.deepEqual(holdsBack(idx, 'weather', 'wording'), { cards: 2, bots: ['quill', 'nova'], capped: false })
  assert.deepEqual(holdsBack(idx, 'weather', 'deploy'), { cards: 1, bots: ['forge'], capped: false })
  assert.deepEqual(holdsBack(idx, 'weather', 'scan'), { cards: 0, bots: [], capped: false })
  assert.deepEqual(holdsBack(idx, 'weather', 'nope'), { cards: 0, bots: [], capped: false })
  assert.deepEqual(holdsBack(idx, 'weather', 'wording', new Set(['quill'])), { cards: 2, bots: ['quill'], capped: false }, 'only the bots of the team are named')
  const many = officeOf(Object.fromEntries(['h', ...'abcde'].map(n => [n, 'idle'])), [board('alpha', [['h', 'running', 'h'], ...'abcde'.split('').map(n => [`t${n}`, 'todo', n])], 'abcde'.split('').map(n => ['h', `t${n}`]))])
  const mv = queueView(many, many.agents.find(a => a.name === 'h'), NOW)
  assert.deepEqual([mv.bots.length, mv.more, mv.count], [3, 2, 5], 'three names, then « +2 »')
})

test('a bot that is queued itself shows its chain, not who waits behind it; one with several cards counts the ones that wait for nothing', () => {
  const o = fixture()
  assert.equal(queueView(o, o.agents.find(a => a.name === 'quill'), NOW).kind, 'queued')
  assert.equal(queueView(o, o.agents.find(a => a.name === 'orbit'), NOW), null, 'no card, no queue')
  const two = officeOf({ h: 'idle', m: 'idle', a: 'idle' }, [board('alpha', [['x', 'running', 'h'], ['y', 'todo', 'm'], ['z', 'todo', 'a']], [['x', 'y'], ['y', 'z']])])
  const w = waitersOf(waitIndex(two.boards), 'm')
  assert.deepEqual(w.bots, [], 'm is queued behind h: its own card is held, the head of that queue (h) is what holds a back')
  assert.equal(waitersOf(waitIndex(two.boards), 'h').cards, 1)
  assert.deepEqual(waitersOf(waitIndex(two.boards), 'h').bots, ['m', 'a'])
  assert.ok(isWaiting(waitIndex(two.boards), waitIndex(two.boards).cards.get('alpha/y')))
})

/* ---------- the sheet: words, and what a hostile title cannot do ---------- */

test('a hostile title is drawn as one clean line of text: no control or bidi character, no markup interpreted, bounded', () => {
  const hostile = 'Pay\u202eevil\u202c\nthe <img src=x onerror=alert(1)> bill\u0007\u2028and\u200b more ' + 'x'.repeat(400)
  const o = officeOf({ a: 'idle', p: 'idle' }, [board('alpha', [['h', 'running', 'p', { title: hostile }], ['t', 'todo', 'a']], [['h', 't']])])
  const v = queueView(o, o.agents.find(a => a.name === 'a'), NOW)
  const title = v.waits[0].card.title
  assert.doesNotMatch(title, /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b-\u200f]/u)
  assert.ok(title.length <= 160)
  assert.match(title, /<img src=x onerror=alert\(1\)>/, 'markup stays text: the page draws it as a text node')
  const lines = queueLines(v, T('en'), NOW, formatSpan)
  assert.equal(lines.waits.items[0].title, title)
  const jsx = src('src/ui/AgentTab.jsx')
  assert.doesNotMatch(jsx, /dangerouslySetInnerHTML|innerHTML/)
  assert.doesNotMatch(src('src/ui/DecisionCard.jsx'), /dangerouslySetInnerHTML|innerHTML/)
})

test('the head says what it does, in three languages', () => {
  const span = ms => formatSpan(ms)
  const cases = [
    [{ kind: 'working', sinceMs: NOW - 12 * 60_000 }, ['au travail depuis 12 min', 'working for 12 min', 'trabajando desde hace 12 min']],
    [{ kind: 'working', sinceMs: null }, ['au travail', 'working', 'trabajando']],
    [{ kind: 'waiting' }, ['qui vous attend', 'who needs you', 'que te espera']],
    [{ kind: 'silent', ms: 7 * 60_000 }, ['silencieux depuis 7 min', 'silent for 7 min', 'en silencio desde hace 7 min']],
    [{ kind: 'ready' }, ['prête, pas encore lancée', 'ready, not started yet', 'lista, aún sin empezar']],
    [{ kind: 'triage' }, ['à préciser', 'waiting to be specified', 'por precisar']],
    [{ kind: 'other' }, ['', '', '']]
  ]
  for (const [fact, [fr, en, es]] of cases) {
    assert.equal(factText(fact, T('fr'), span, NOW), fr)
    assert.equal(factText(fact, T('en'), span, NOW), en)
    assert.equal(factText(fact, T('es'), span, NOW), es)
  }
})

test('the decision card says what it holds back: bots when there are some, else cards; « at least » when the walk was cut', () => {
  const l = (held, lang = 'fr') => holdsLine(held, T(lang), n => n)
  assert.equal(l({ cards: 0, bots: [], capped: false }), null)
  assert.equal(l(null), null)
  assert.equal(l({ cards: 2, bots: ['a', 'b'], capped: false }).text, 'Retient 2 bots')
  assert.equal(l({ cards: 1, bots: ['a'], capped: false }, 'en').text, 'Holds back 1 bot')
  assert.equal(l({ cards: 3, bots: [], capped: false }, 'es').text, 'Retiene 3 tarjetas')
  assert.equal(l({ cards: 1, bots: [], capped: false }).text, 'Retient 1 carte')
  assert.equal(l({ cards: 9, bots: ['a', 'b', 'c', 'd', 'e'], capped: true }).text, 'Retient au moins 5 bots')
  assert.deepEqual([l({ cards: 9, bots: ['a', 'b', 'c', 'd', 'e'], capped: false }).names, l({ cards: 9, bots: ['a', 'b', 'c', 'd', 'e'], capped: false }).more], [['a', 'b', 'c'], 2])
})

test('ordinals: 2ᵉ / 2nd / 2.º, and the teens of English', () => {
  assert.deepEqual([2, 3, 12].map(n => ordinalText(n, 'fr')), ['2ᵉ', '3ᵉ', '12ᵉ'])
  assert.deepEqual([2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(n => ordinalText(n, 'en')), ['2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th'])
  assert.deepEqual([2, 3].map(n => ordinalText(n, 'es')), ['2.º', '3.º'])
  assert.equal(ordinalText(0, 'en'), '1st')
})

test('the words exist in en, fr and es; « En attente » (too close to « Waiting for you ») is not the name', () => {
  for (const lang of ['en', 'fr', 'es']) {
    const t = tr(lang)
    assert.ok(t('state.queued').length >= 6 && t('state.queued') !== t('state.waiting'), `${lang} state.queued`)
    assert.ok(t('legend.queued').length > 40, `${lang} legend.queued says the difference with rest and with « waiting for you »`)
    for (const k of ['waits', 'head', 'noAssignee', 'workingNow', 'waiting', 'ready', 'triage', 'loop', 'longer', 'holdsTip']) assert.ok(t(`queue.${k}`).length > 3, `${lang} queue.${k}`)
    for (const k of ['tip', 'outside', 'working', 'silent', 'moreHeads', 'rank', 'more']) assert.match(t(`queue.${k}`, 3), /3/, `${lang} queue.${k}`)
    assert.match(t('queue.waited', 3, false, 1), /3/)
    assert.notEqual(t('queue.waited', 3, true, 1), t('queue.waited', 3, false, 1), 'the cut walk says « at least »')
  }
  assert.equal(tr('fr')('state.queued'), 'En file')
  assert.equal(tr('en')('state.queued'), 'Queued')
  assert.equal(tr('es')('state.queued'), 'En cola')
  const legend = lang => tr(lang)('legend.queued')
  assert.match(legend('fr'), /pas du repos/)
  assert.match(legend('fr'), /rien n’est à décider/)
  assert.match(legend('en'), /not at rest/)
  assert.match(legend('es'), /no es reposo/)
  assert.doesNotMatch(tr('fr')('state.queued') + tr('fr')('legend.queued'), /En attente/)
})

test('notifications gain nothing: no new type, no word of the state', () => {
  for (const f of ['src/core/notify.js', 'src/core/notifyFormat.js', 'src/core/notifyWords.js']) assert.doesNotMatch(src(f), /queued|En file|queue\.js/, f)
  for (const f of ['hermes_officecraft/notify.py', 'hermes_officecraft/notify_format.py']) assert.doesNotMatch(src(f), /queued|task_links|links/i, f)
})

/* ---------- the past, and the header ---------- */

test('a replay does not invent the state: the links of the day are not in /replay, the bot stays at rest', () => {
  const T0 = Date.UTC(2026, 10, 12, 19, 0, 0) / 1000
  const r = toReplay({
    ok: true, at: T0 + 14 * 3600, from: T0, to: T0 + 12 * 3600,
    boards: [{ slug: 'alpha', since: T0 - 200 * 3600, start: [['t_dep', 'todo', 'nova'], ['t_run', 'running', 'forge']], cards: { t_dep: 'Dep', t_run: 'Run' }, facts: [[T0 + 3600, 't_dep', 'blocked', 'todo', 'dependency']], runs: [], silences: [] }]
  })
  const desks = desksOf({ nova: 'idle', forge: 'idle' })
  for (const h of [0.5, 2, 6, 11]) {
    const o = officeAt(desks, r, (T0 + h * 3600) * 1000)
    assert.equal(o.agents.find(a => a.name === 'nova').state, 'idle', `at +${h} h`)
    assert.ok(o.boards.every(b => b.links.length === 0))
  }
  assert.doesNotMatch(src('src/core/replay.js'), /links/, 'liveAt builds no link')
})

test('the header does not count the state: « at work » is working only, and no pill is added', () => {
  const o = fixture()
  const c = summarizeOffice(o)
  assert.equal(c.working, 0)
  assert.equal(c.queued, 3, 'nova, quill and forge')
  const header = src('src/ui/PageHeader.jsx')
  assert.doesNotMatch(header, /queued/)
})

test('the scene: the state has a sign, a halo and a calm posture of the second art direction only; classic never knew it', async () => {
  const { STATE_ICONS, stateIconCells, drawScene, buildBase, layoutScene, toSceneModel, DECOR_OFF } = await import('../../src/scene/index.js')
  const { HALO, haloOf } = await import('../../src/scene/furniture.js')
  assert.ok(stateIconCells('queued').length >= 14 && STATE_ICONS.queued.length === 9)
  assert.deepEqual(haloOf('queued', true), HALO.queued)
  assert.equal(haloOf('queued', false), undefined, 'classic draws no ring for it')
  assert.deepEqual(haloOf('working', false), HALO.working)
  // classic: a queued bot is drawn exactly like a bot in a state classic does not know (here, « unknown » without its bubble is not comparable): same pixels as « new » minus nothing
  const make = (state, classic) => {
    const office = { agents: [{ name: 'nova', state, home: 'alpha', description: '', skills: [] }], boards: [{ slug: 'alpha', tasks: [], counts: {}, total: 0, done: 0, blocked: [] }], ops: null }
    const model = toSceneModel(office, { nowMs: NOW, decor: DECOR_OFF, classic })
    const layout = layoutScene(model)
    return drawScene(layout, buildBase(layout, model), model, 0)
  }
  const same = (a, b) => a.d.length === b.d.length && a.d.every((v, i) => v === b.d[i])
  assert.ok(same(make('queued', true), make('quill-unknown-state', true)), 'classic: an unknown state and « queued » give the same pixels')
  assert.ok(!same(make('queued', false), make('idle', false)), 'the second art direction: a ring and a posture of its own')
  assert.ok(!same(make('queued', false), make('active', false)), 'and not the posture of a recent session')
})
