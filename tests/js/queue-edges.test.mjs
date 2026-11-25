// The queue, at its edges: what the main tests of the queue did not hold (a card that is not `todo` in the middle of a chain, the bot of the
// blocked card itself, the place of the state in the team list, the rank of the sheet kept on one line).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { chainOf, holdsBack, isWaiting, waitIndex } from '../../src/core/queue.js'
import { PAGE_CSS } from '../../src/ui/pageStyles.js'

const src = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const card = (id, status, assignee) => ({ id, title: `Card ${id}`, status, assignee, createdMs: 0 })

test('a blocked card is the head of the queue even when one of its own parents is unfinished: only a `todo` card waits', () => {
  // gamma's todo waits for beta's blocked card, whose own parent (alpha's) runs again: the queue stops at the decision, it does not walk past it
  const idx = waitIndex([{ slug: 'alpha', tasks: [card('a', 'running', 'alpha'), card('b', 'blocked', 'beta'), card('c', 'todo', 'gamma')], links: [['a', 'b'], ['b', 'c']] }])
  const b = idx.cards.get('alpha/b')
  assert.equal(isWaiting(idx, b), false, 'a blocked card is not waiting, whatever its parents')
  assert.equal(isWaiting(idx, idx.cards.get('alpha/c')), true)
  const ch = chainOf(idx, idx.cards.get('alpha/c'), 0)
  assert.deepEqual(ch.heads.map(h => [h.card.id, h.fact.kind]), [['b', 'waiting']])
  assert.deepEqual(ch.upstream.map(c => c.id), ['b'])
})

test('what a blocked card holds back never counts its own bot among the bots it holds', () => {
  // echo's blocked card holds echo's own next card, which holds quill's
  const idx = waitIndex([{ slug: 'alpha', tasks: [card('b0', 'blocked', 'echo'), card('t1', 'todo', 'echo'), card('t2', 'todo', 'quill')], links: [['b0', 't1'], ['t1', 't2']] }])
  assert.deepEqual(holdsBack(idx, 'alpha', 'b0'), { cards: 2, bots: ['quill'], capped: false })
})

test('the team list puts a queued bot after the ones at work and a recent session, before the ones at rest', () => {
  const m = src('src/ui/AgentTab.jsx').match(/const ORDER = (\{[^}]*\})/)
  assert.ok(m, 'the order of the team list is one object')
  const order = Function(`return ${m[1]}`)()
  assert.ok(order.working < order.queued && order.active < order.queued, 'after at work and a recent session')
  assert.ok(order.queued < order.idle && order.queued < order.new, 'before at rest and no session yet')
  assert.ok(order.waiting < order.queued && order.stale < order.queued)
})

test('the rank behind the head of the queue stays on one line (« 2ᵉ derrière » is never cut between its two words)', () => {
  const css = PAGE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(/\.ux-ag-q \.rk\{[^}]*white-space:nowrap/.test(css))
  // the space before it stays outside the unbreakable span: the line may still break between the head's words and the rank
  assert.match(src('src/ui/AgentTab.jsx'), /\{' '\}<span className="rk" data-queue-rank>\{lines\.head\.rank\}<\/span>/)
  // the separator ends the line before the rank: a wrapped rank never starts its line with a lone dot
  assert.match(src('src/ui/AgentTab.jsx'), /\{lines\.head\.rank \? ' ·' : ''\}<\/span>/)
})
