import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { COMMENT_MAX, ORDERS, REASONS, UNDO_SECONDS, classifyError, initialOrderState, isBusy, journalServed, offeredWrites, orderBody, orderReducer, readAnswer, secondsLeft, targetOf, toJournal, IDLE, isUnknownOutcome, keyCancels } from '../../src/core/orders.js'
import { messages } from '../../src/i18n/index.js'
import { backAction, clearLeft, countdownWait, focusSelector, focusTarget, hiddenCancel, leftBehind, leftOutcome, liveRead, peekLeft, rememberLeft, rereadOf, routeOf } from '../../src/core/orderflow.js'
import { guardTarget } from '../../src/core/campaign.js'

// ===== orders =====
{
// The order state machine (pure), its request/answer shapes, the capability gate, the audit journal whitelist,
// and the guards on the effect hook (no setInterval, polling flags) read on the real source.
const ITEM = { board: 'sandbox-demo', id: 't_0a1b2c3d', code: 'S2.2' }
const run = (state, ...actions) => actions.reduce(orderReducer, state)
const T0 = 1_000_000
const OK_ANSWER = readAnswer({ ok: true, result: 'done', before: { status: 'blocked' }, after: { status: 'ready', comments: 3 }, at: 1794433000 })

test('constants: 6 s of undo, 4 000 characters, every write order is final, open orders write nothing', () => {
  assert.equal(UNDO_SECONDS, 6)
  assert.equal(COMMENT_MAX, 4000)
  assert.equal(ORDERS.unblock.risk, 'final')
  assert.equal(ORDERS.comment.risk, 'final')
  assert.equal(ORDERS.openSession.writes, false)
  assert.equal(ORDERS.openKanban.risk, 'safe')
})

test('unblock: idle -> confirm -> counting (6 s) -> sending -> verifying -> done; nothing is shown before the read', () => {
  let s = initialOrderState()
  assert.equal(s.phase, 'idle')
  s = run(s, { type: 'request', order: targetOf('unblock', ITEM, 'id-1') })
  assert.equal(s.phase, 'confirm', 'a final order asks for an explicit confirmation first')
  assert.equal(s.sendAt, null, 'nothing is counting before the confirmation')
  s = run(s, { type: 'confirm', now: T0 })
  assert.equal(s.phase, 'counting')
  assert.equal(s.left, 6)
  assert.equal(s.sendAt, T0 + 6000)
  s = run(s, { type: 'tick', now: T0 + 1000 })
  assert.equal(s.left, 5)
  s = run(s, { type: 'tick', now: T0 + 5500 })
  assert.equal(s.left, 1)
  assert.equal(s.phase, 'counting')
  s = run(s, { type: 'tick', now: T0 + 6000 })
  assert.equal(s.phase, 'sending')
  assert.equal(s.outcome, null)
  s = run(s, { type: 'answered', answer: OK_ANSWER })
  assert.equal(s.phase, 'verifying')
  assert.equal(s.outcome, null, 'the route answered but /live was not re-read yet: no state is displayed')
  s = run(s, { type: 'read', liveOk: true })
  assert.equal(s.phase, 'done')
  assert.deepEqual([s.outcome.ok, s.outcome.after, s.outcome.before, s.outcome.liveOk, s.outcome.code, s.outcome.board], [true, 'ready', 'blocked', true, 'S2.2', 'sandbox-demo'])
})

test('cancel during the countdown: nothing leaves (back to idle with a « cancelled » outcome, no request phase ever reached)', () => {
  let s = run(initialOrderState(), { type: 'request', order: targetOf('unblock', ITEM, 'id-2') }, { type: 'confirm', now: T0 }, { type: 'tick', now: T0 + 3000 })
  assert.equal(s.left, 3)
  s = run(s, { type: 'cancel' })
  assert.equal(s.phase, 'idle')
  assert.equal(s.outcome.cancelled, true)
  assert.equal(s.outcome.wasCounting, true)
  assert.equal(s.order, null)
  // a late tick (the timer already queued) cannot resurrect it
  const after = orderReducer(s, { type: 'tick', now: T0 + 6000 })
  assert.equal(after.phase, 'idle')
})

test('cancel is refused once the order has left (sending, verifying): too_late, the order is untouched', () => {
  const sending = run(initialOrderState(), { type: 'request', order: targetOf('unblock', ITEM, 'id-3') }, { type: 'confirm', now: T0 }, { type: 'tick', now: T0 + 6000 })
  const refused = orderReducer(sending, { type: 'cancel' })
  assert.equal(refused.phase, 'sending')
  assert.equal(refused.notice, 'too_late')
  const verifying = run(sending, { type: 'answered', answer: OK_ANSWER })
  assert.equal(orderReducer(verifying, { type: 'cancel' }).phase, 'verifying')
})

test('a second order is refused while the first counts, travels or is re-read; the first one is untouched', () => {
  const other = targetOf('comment', { ...ITEM, id: 't_ffffffff', code: 'S2.9' }, 'id-other')
  let s = run(initialOrderState(), { type: 'request', order: targetOf('unblock', ITEM, 'id-4') }, { type: 'confirm', now: T0 })
  for (const step of [s, run(s, { type: 'tick', now: T0 + 6000 }), run(s, { type: 'tick', now: T0 + 6000 }, { type: 'answered', answer: OK_ANSWER })]) {
    assert.equal(isBusy(step), true, step.phase)
    const second = orderReducer(step, { type: 'request', order: other })
    assert.equal(second.notice, 'busy', step.phase)
    assert.equal(second.phase, step.phase)
    assert.equal(second.order.id, 'id-4', 'the order in flight is still the first')
  }
  // once it is cancelled, the next one is accepted
  s = run(s, { type: 'cancel' }, { type: 'request', order: other })
  assert.equal(s.phase, 'draft')
  assert.equal(s.order.id, 'id-other')
})

test('draft and confirm are not « in flight »: a new request replaces them (nothing was decided)', () => {
  const s = run(initialOrderState(), { type: 'request', order: targetOf('comment', ITEM, 'id-5') })
  assert.equal(isBusy(s), false)
  const next = orderReducer(s, { type: 'request', order: targetOf('unblock', { ...ITEM, id: 't_11111111', code: 'S2.3' }, 'id-6') })
  assert.equal(next.phase, 'confirm')
  assert.equal(next.order.task, 't_11111111')
})

test('a final order cannot skip the confirmation: confirm is refused outside the confirm phase, tick never sends from confirm', () => {
  let s = run(initialOrderState(), { type: 'request', order: targetOf('unblock', ITEM, 'id-7') })
  assert.equal(orderReducer(initialOrderState(), { type: 'confirm', now: T0 }).phase, 'idle')
  assert.equal(orderReducer(s, { type: 'tick', now: T0 + 99_000 }).phase, 'confirm')
  assert.equal(orderReducer(s, { type: 'answered', answer: OK_ANSWER }).phase, 'confirm', 'no answer without a departure')
  // back from the confirmation of an unblock leaves nothing behind
  s = run(s, { type: 'back' })
  assert.equal(s.phase, 'idle')
  assert.equal(s.order, null)
})

test('only the written orders go through the machine (open orders never do)', () => {
  const s = orderReducer(initialOrderState(), { type: 'request', order: { id: 'x', verb: 'openSession', board: 'b', task: 't', code: 'c' } })
  assert.equal(s.phase, 'idle')
  assert.equal(s.notice, 'not_an_order')
  assert.equal(orderReducer(initialOrderState(), { type: 'request', order: { id: 'x', verb: 'archive', board: 'b', task: 't', code: 'c' } }).phase, 'idle', 'no destructive order exists')
})

test('comment: draft -> text bounded to 4 000 -> empty text refused -> confirm -> counting; the text is dropped once it has left', () => {
  let s = run(initialOrderState(), { type: 'request', order: targetOf('comment', ITEM, 'id-8') })
  assert.equal(s.phase, 'draft')
  assert.equal(orderReducer(s, { type: 'review' }).notice, 'empty_text')
  assert.equal(orderReducer(run(s, { type: 'text', text: '   \n ' }), { type: 'review' }).phase, 'draft', 'blanks only is not a comment')
  s = run(s, { type: 'text', text: 'x'.repeat(5000) })
  assert.equal(s.order.text.length, COMMENT_MAX)
  s = run(s, { type: 'text', text: 'Looks fine, go ahead.' }, { type: 'review' })
  assert.equal(s.phase, 'confirm')
  assert.equal(orderBody(s.order).text, 'Looks fine, go ahead.')
  // back to the draft keeps the text
  assert.equal(run(s, { type: 'back' }).order.text, 'Looks fine, go ahead.')
  s = run(s, { type: 'confirm', now: T0 }, { type: 'tick', now: T0 + 6000 })
  assert.equal(s.phase, 'sending')
  assert.equal(s.order.text, 'Looks fine, go ahead.', 'the text is still needed to send')
  s = run(s, { type: 'answered', answer: readAnswer({ ok: true, result: 'done', after: { status: 'ready', comments: 4 } }) }, { type: 'read', liveOk: true })
  assert.equal(s.phase, 'done')
  assert.equal(s.order.text, undefined, 'the text of a comment is not kept once sent')
  assert.equal(s.outcome.comments, 4)
  assert.doesNotMatch(JSON.stringify(s), /Looks fine/)
})

test('failures: a refusal read from the route, a failed call, and a refetch of /live that did not land are all said, never hidden', () => {
  const sending = run(initialOrderState(), { type: 'request', order: targetOf('unblock', ITEM, 'id-9') }, { type: 'confirm', now: T0 }, { type: 'tick', now: T0 + 6000 })
  const refused = readAnswer({ ok: false, result: 'refused', reason: 'not_blocked', before: { status: 'ready' }, after: { status: 'ready' } })
  let s = run(sending, { type: 'answered', answer: refused }, { type: 'read', liveOk: true })
  assert.deepEqual([s.outcome.ok, s.outcome.reason, s.outcome.after], [false, 'not_blocked', 'ready'])
  s = run(sending, { type: 'failed', reason: 'busy' }, { type: 'read', liveOk: true })
  assert.deepEqual([s.outcome.ok, s.outcome.reason], [false, 'busy'])
  s = run(sending, { type: 'failed', reason: 'something-else' }, { type: 'read', liveOk: true })
  assert.equal(s.outcome.reason, 'unknown', 'a reason code the page does not know is shown as unknown, never as raw text')
  s = run(sending, { type: 'answered', answer: OK_ANSWER }, { type: 'read', liveOk: false })
  assert.equal(s.outcome.ok, true)
  assert.equal(s.outcome.liveOk, false, '/live could not be refreshed: the outcome says so')
  assert.equal(orderReducer(s, { type: 'dismiss' }).phase, 'idle')
  assert.equal(orderReducer(run(sending), { type: 'dismiss' }).notice, 'busy', 'an order in flight cannot be dismissed')
})

test('secondsLeft never shows 0 while counting and never goes below 0', () => {
  assert.equal(secondsLeft(T0 + 6000, T0), 6)
  assert.equal(secondsLeft(T0 + 6000, T0 + 5999), 1)
  assert.equal(secondsLeft(T0 + 6000, T0 + 7000), 0)
})

test('POST body: closed fields, text for a comment only', () => {
  assert.deepEqual(orderBody(targetOf('unblock', ITEM, 'u-1')), { id: 'u-1', verb: 'unblock', board: ITEM.board, task: ITEM.id })
  assert.deepEqual(orderBody({ ...targetOf('comment', ITEM, 'u-2'), text: 'hi' }), { id: 'u-2', verb: 'comment', board: ITEM.board, task: ITEM.id, text: 'hi' })
})

test('readAnswer keeps the whitelisted facts; anything else is null (outcome unknown, nothing invented)', () => {
  const a = readAnswer({ ok: true, id: 'i', verb: 'unblock', board: 'b', task: 't', result: 'done', before: { status: 'blocked', secret: 'x' }, after: { status: 'ready', comments: 2, body: 'no' }, at: 1794433000.5, audited: false, replayed: true, junk: 1 })
  assert.deepEqual(a, { ok: true, result: 'done', reason: null, before: 'blocked', after: 'ready', comments: 2, ready: null, archived: null, replayed: true, audited: false, atMs: 1794433000500 })
  assert.equal(readAnswer(null), null)
  assert.equal(readAnswer({ ok: true }), null)
  assert.equal(readAnswer('done'), null)
  assert.equal(readAnswer({ result: 'refused', reason: 'weird' }).reason, 'unknown')
  // only `done` is a success; a failure, a busy server or a result the page does not know is never shown as done
  for (const result of ['failed', 'busy', 'refused', 'weird']) {
    const r = readAnswer({ result, reason: 'hermes_error', after: { status: 'blocked' } })
    assert.equal(r.ok, false, `result ${result} is not a success`)
    assert.notEqual(r.reason, null, `result ${result} carries a reason`)
  }
  assert.equal(readAnswer({ result: 'weird' }).result, 'failed', 'an unknown result is a failure, never a success')
})

test('classifyError: 409 busy, 422/413 invalid, 404 unreachable, everything else is an unknown outcome (the order may have left)', () => {
  assert.equal(classifyError({ status: 409 }), 'busy')
  assert.equal(classifyError(new Error('Request failed with status 409')), 'busy')
  assert.equal(classifyError({ status: 422 }), 'invalid')
  assert.equal(classifyError({ status: 413 }), 'invalid')
  assert.equal(classifyError({ status: 404 }), 'unreachable')
  assert.equal(classifyError(new Error('timeout')), 'unknown_outcome')
  assert.equal(classifyError(undefined), 'unknown_outcome')
})

test('order buttons exist only for the verbs /health announces (no agent half, no capability: no button, not greyed)', () => {
  assert.deepEqual(offeredWrites({ present: true, reads: [], capabilities: ['unblock', 'comment'] }), ['unblock', 'comment'])
  assert.deepEqual(offeredWrites({ present: true, reads: [], capabilities: ['comment'] }), ['comment'])
  assert.deepEqual(offeredWrites({ present: true, reads: [], capabilities: ['archive', 'reassign'] }), [], 'a verb the page does not know is never drawn')
  assert.deepEqual(offeredWrites({ present: true, reads: [], capabilities: [] }), [])
  assert.deepEqual(offeredWrites({ present: false }), [])
  assert.deepEqual(offeredWrites(undefined), [])
  assert.deepEqual(offeredWrites({ present: true, capabilities: 'unblock' }), [])
  assert.equal(journalServed({ present: true, reads: ['live', 'orders'] }), true)
  assert.equal(journalServed({ present: true, reads: ['live'] }), false)
  assert.equal(journalServed({ present: false }), false)
})

test('journal: whitelisted fields only, newest first, capped, a foreign line is dropped', () => {
  const body = {
    ok: true,
    entries: [
      { ts: 100, id: 'a', verb: 'unblock', risk: 'final', board: 'b', task: 't_1', result: 'done', before: { status: 'blocked' }, after: { status: 'ready' }, source: 'agent', text: 'SECRET', path: '/home/x', command: 'rm' },
      { ts: 300, id: 'c', verb: 'comment', risk: 'final', board: 'b', task: 't_2', result: 'refused', reason: 'running', len: 12, source: 'agent', body: 'SECRET' },
      { ts: 200, id: 'b', verb: 'delete-everything', result: 'done' },
      { id: 'no-ts', verb: 'comment' },
      null
    ]
  }
  const j = toJournal(body, 5)
  assert.equal(j.ok, true)
  assert.deepEqual(j.entries.map(e => e.id), ['c', 'a'])
  assert.doesNotMatch(JSON.stringify(j), /SECRET|\/home|rm/)
  assert.deepEqual(Object.keys(j.entries[0]).sort(), ['after', 'before', 'board', 'choice', 'id', 'len', 'ms', 'profile', 'reason', 'result', 'risk', 'source', 'task', 'verb'])
  assert.equal(j.entries[0].reason, 'running')
  assert.equal(toJournal({ ok: true, entries: Array.from({ length: 20 }, (_, i) => ({ ts: i + 1, id: `i${i}`, verb: 'comment', result: 'done' })) }, 8).entries.length, 8)
  assert.deepEqual(toJournal({ ok: false }), { ok: false, entries: [] })
  assert.deepEqual(toJournal(null), { ok: false, entries: [] })
})

test('i18n: every reason, risk, verb and tag the page can show has its text in EN, FR and ES', () => {
  for (const lang of ['en', 'fr', 'es']) {
    const o = messages[lang].orders
    for (const r of REASONS) assert.ok(typeof o.reason[r] === 'string' && o.reason[r].length > 5, `${lang} reason ${r}`)
    for (const r of ['safe', 'rev', 'final']) assert.ok(o.risk[r] && o.riskTip[r], `${lang} risk ${r}`)
    for (const v of Object.keys(ORDERS)) assert.ok(o.verb[v], `${lang} verb ${v}`)
    for (const k of ['ok', 'ko', 'cancel']) assert.ok(o.tag[k], `${lang} tag ${k}`)
    for (const k of ['done', 'refused', 'failed']) assert.ok(o.result[k], `${lang} result ${k}`)
    for (const k of ['busy', 'too_late']) assert.ok(o.refused[k], `${lang} refused ${k}`)
  }
  assert.deepEqual([messages.en, messages.fr, messages.es].map(m => m.orders.risk.final), ['Final', 'Définitif', 'Definitivo'])
})

test('hook source: no setInterval (a countdown is a timeout chain), departure and re-read are guarded, the journal polls >= 5 s with every flag off', () => {
  const src = readFileSync(new URL('../../src/data/orders.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /setInterval/)
  assert.match(src, /sent\.current\.has\(/, 'one POST per order id (StrictMode runs effects twice)')
  assert.match(src, /refetchQueries\(\{ queryKey: LIVE_KEY \}\)/, 'the re-read refreshes /live')
  assert.match(src, /document\.hidden/, 'a hidden page cancels the countdown')
  const block = src.split('useQuery({')[1].split('\n  })')[0]
  assert.match(block, /refetchIntervalInBackground: false/)
  assert.match(block, /refetchOnReconnect: false/)
  const ms = Number((src.match(/JOURNAL_POLL_MS = ([\d_]+)/) || [, 'NaN'])[1].replace(/_/g, ''))
  assert.ok(ms >= 5000, `journal poll ${ms}`)
})

test('UI source: orders are only built through the hook; the text of a comment is never logged, stored or put in an attribute', () => {
  const ui = readFileSync(new URL('../../src/ui/Orders.jsx', import.meta.url), 'utf8')
  const data = readFileSync(new URL('../../src/data/orders.js', import.meta.url), 'utf8')
  for (const src of [ui, data]) {
    assert.doesNotMatch(src, /console\./)
    assert.doesNotMatch(src, /localStorage|sessionStorage|ctx\.storage|setValue/)
  }
  assert.doesNotMatch(ui, /title=\{[^}]*text/i, 'the comment is never a tooltip')
  assert.doesNotMatch(ui, /data-text|aria-label=\{[^}]*\.text/)
})
}

// ===== orders =====
{
// The order flow around the reducer (src/core/orderflow.js), by value; an order cancelled by leaving the page.
const target = { id: 'c0ffee00-1111-4222-8333-444455556666', verb: 'unblock', board: 'sandbox-demo', task: 't_0badc0de', code: 'S2.F' }
const confirming = () => orderReducer(initialOrderState(), { type: 'request', order: target, now: 0 })
const counting = (now = 1000) => orderReducer(confirming(), { type: 'confirm', now })

/* ---------- the whole machine, as the hook drives it ---------- */
test('machine: final order = confirmation, 6 s countdown by the deadline, one at a time, cancel until it leaves, re-read before the outcome', () => {
  assert.equal(confirming().phase, 'confirm', 'a final order asks for its confirmation first: nothing leaves')
  let s = counting(1000)
  assert.deepEqual([s.phase, s.left, s.sendAt], ['counting', 6, 7000])
  assert.equal(orderReducer(s, { type: 'request', order: { ...target, id: 'second' }, now: 2000 }).notice, 'busy', 'the second order is refused')
  assert.equal(orderReducer(s, { type: 'request', order: { ...target, id: 'second' }, now: 2000 }).order.id, target.id, 'the first one is untouched')
  s = orderReducer(s, { type: 'tick', now: 3200 })
  assert.equal(s.left, 4, 'by the deadline: 3.8 s remain -> 4')
  assert.equal(orderReducer(s, { type: 'tick', now: 7000 }).phase, 'sending')
  assert.equal(orderReducer(counting(0), { type: 'cancel' }).outcome.cancelled, true, 'cancel works during the window')
  const sending = orderReducer(counting(0), { type: 'tick', now: 6000 })
  assert.equal(orderReducer(sending, { type: 'cancel' }).notice, 'too_late', 'and not after it left')
  const verifying = orderReducer(sending, { type: 'answered', answer: { ok: true, result: 'done', reason: null, audited: true } })
  assert.equal(verifying.phase, 'verifying')
  assert.equal(verifying.outcome, null, 'nothing is shown before the read-back')
  assert.equal(orderReducer(verifying, { type: 'read', liveOk: true }).outcome.ok, true)
})

/* ---------- the countdown ---------- */
test('countdownWait: wakes when the shown second drops, by the deadline, never under 20 ms; nothing outside the window', () => {
  assert.equal(countdownWait(counting(1000), 1000), 1015, 'at the start (sendAt 7 s, 6 shown): the digit drops at sendAt - 5 s')
  assert.equal(countdownWait(counting(0), 1000), Math.max(20, 6000 - 1000 - 5000 + 15))
  const mid = orderReducer(counting(0), { type: 'tick', now: 3200 })   // left 3
  assert.equal(countdownWait(mid, 3200), 6000 - 3200 - 2000 + 15)
  assert.equal(countdownWait(mid, 5990), 20, 'late: never under 20 ms')
  assert.equal(countdownWait(confirming(), 0), null)
  assert.equal(countdownWait({ ...IDLE }, 0), null)
  assert.equal(countdownWait(orderReducer(counting(0), { type: 'tick', now: 6000 }), 6000), null, 'sending: the timer is done')
})
test('hiddenCancel: a hidden window cancels the 6 s, only then', () => {
  assert.deepEqual(hiddenCancel(counting(), true), { type: 'cancel', reason: 'hidden' })
  assert.equal(hiddenCancel(counting(), false), null)
  assert.equal(hiddenCancel(confirming(), true), null, 'a confirmation has not started anything')
  assert.equal(hiddenCancel({ ...IDLE }, true), null)
  assert.equal(orderReducer(counting(), hiddenCancel(counting(), true)).outcome.reason, 'hidden')
})

/* ---------- routes and re-read ---------- */
test('routeOf / rereadOf: each order leaves and is read back through its own source', () => {
  assert.deepEqual(['unblock', 'comment'].map(verb => routeOf({ verb })), ['card', 'card'])
  assert.deepEqual(['recruit', 'recruitModel'].map(verb => routeOf({ verb })), ['recruit', 'recruit'])
  assert.equal(routeOf({ verb: 'approval' }), 'approval')
  assert.deepEqual([{ verb: 'unblock' }, { verb: 'approval' }, { verb: 'recruit' }].map(rereadOf), ['live', 'queue', 'roster'])
})
test('liveRead: /live counts as re-read only when it answered after the order left', () => {
  assert.equal(liveRead({ status: 'success', dataUpdatedAt: 5000 }, 4000), true)
  assert.equal(liveRead({ status: 'success', dataUpdatedAt: 4000 }, 4000), true, 'same instant')
  assert.equal(liveRead({ status: 'success', dataUpdatedAt: 3999 }, 4000), false, 'older than the order')
  assert.equal(liveRead({ status: 'error', dataUpdatedAt: 9000 }, 4000), false, 'a failed refetch keeps older data')
  assert.equal(liveRead(undefined, 4000), false)
  assert.equal(liveRead({ status: 'success' }, 4000), false)
})
test('backAction / focusTarget: where « Back » goes and where the keyboard lands', () => {
  assert.deepEqual(['comment', 'recruit', 'unblock', 'approval', 'recruitModel'].map(verb => backAction({ verb })), ['back', 'back', 'cancel', 'cancel', 'cancel'])
  assert.deepEqual(focusTarget({ verb: 'recruit' }), { kind: 'recruit' })
  assert.deepEqual(focusTarget({ verb: 'recruitModel' }), { kind: 'recruit' })
  assert.equal(focusSelector({ verb: 'unblock', board: 'b', task: 't_1' }), '[data-order="unblock"][data-board="b"][data-card="t_1"]')
  assert.equal(focusSelector({ verb: 'recruit' }), '[data-recruit-open]')
})

/* ---------- an order lost by leaving the page ---------- */
test('leftBehind: only a window that was counting is an order the user lost by leaving', () => {
  const s = counting()
  assert.deepEqual(leftBehind(s), { verb: 'unblock', board: 'sandbox-demo', task: 't_0badc0de', code: 'S2.F', choice: undefined, agent: undefined, title: undefined })
  for (const other of [confirming(), { ...IDLE }, orderReducer(counting(0), { type: 'tick', now: 6000 }), null]) assert.equal(leftBehind(other), null)
  const approval = orderReducer(initialOrderState(), { type: 'request', order: { id: 'x', verb: 'approval', choice: 'deny', sessionId: 's', requestId: 'r', agent: 'bot', title: 'Fix the build', code: 'Fix the build' }, now: 0 })
  assert.deepEqual([leftBehind(approval).agent, leftBehind(approval).choice], ['bot', 'deny'], 'a refusal goes straight to the window')
})
test('the memory of the tab: kept until cleared, never in ctx.storage, and the outcome never says « sent »', () => {
  clearLeft()
  assert.equal(peekLeft(), null)
  rememberLeft(leftBehind(counting()))
  assert.equal(peekLeft().task, 't_0badc0de')
  assert.equal(peekLeft().task, 't_0badc0de', 'peeking does not consume (the page may render twice)')
  const out = leftOutcome(peekLeft())
  assert.deepEqual([out.cancelled, out.reason, out.verb, out.board, out.task], [true, 'left', 'unblock', 'sandbox-demo', 't_0badc0de'])
  clearLeft()
  assert.equal(peekLeft(), null, 'said once')
  assert.equal(leftOutcome(null), null)
  const memory = readFileSync(new URL('../../src/core/orderflow.js', import.meta.url), 'utf8')
  assert.doesNotMatch(memory.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /storage/, 'module memory, not ctx.storage')
})
test('coming back: the machine starts idle WITH the cancelled outcome, and nothing is ever sent from it', () => {
  rememberLeft(leftBehind(counting()))
  const back = initialOrderState(leftOutcome(peekLeft()))
  assert.equal(back.phase, 'idle', 'no window, no sending: it cannot leave')
  assert.equal(back.outcome.cancelled, true)
  assert.equal(back.sendAt, null)
  assert.equal(orderReducer(back, { type: 'tick', now: 999999 }), back, 'a tick does nothing')
  assert.equal(orderReducer(back, { type: 'dismiss' }).outcome, null, 'closing the line clears it')
  clearLeft()
  assert.equal(initialOrderState().outcome, null)
})
test('the line says what was not sent and the target, in EN, FR, ES', () => {
  const what = 'Unblock sandbox-demo · S2.F'
  assert.equal(messages.en.orders.cancelledLeft(what), 'Not sent: you left the page (Unblock sandbox-demo · S2.F).')
  assert.equal(messages.fr.orders.cancelledLeft(what), 'Action non envoyée : vous avez quitté la page (Unblock sandbox-demo · S2.F).')
  assert.match(messages.es.orders.cancelledLeft(what), /Acción no enviada: .*página.*S2\.F/)
})
}

// ===== orders =====
{
const src = readFileSync(new URL('../../src/ui/Orders.jsx', import.meta.url), 'utf8')
const target = { id: 'c0ffee00-1111-4222-8333-444455556666', verb: 'unblock', board: 'sandbox-demo', task: 't_0badc0de', code: 't_0badc0de' }
const counting = () => orderReducer(orderReducer(initialOrderState(), { type: 'request', order: target, now: 0 }), { type: 'confirm', now: 0 })

// Escape gives up a draft, a confirmation AND the 6 s window: a keyboard user bailing out during the countdown must not see the
// order leave.
test('Escape cancels what can still be cancelled, nothing else', () => {
  const c = counting()
  assert.equal(c.phase, 'counting')
  assert.equal(keyCancels(c, 'Escape'), true, 'counting')
  assert.equal(keyCancels(orderReducer(initialOrderState(), { type: 'request', order: target, now: 0 }), 'Escape'), true, 'confirm')
  assert.equal(keyCancels(c, 'Enter'), false)
  assert.equal(keyCancels({ ...c, phase: 'sending' }, 'Escape'), false, 'once sent it cannot be cancelled')
  assert.equal(keyCancels({ ...c, phase: 'verifying' }, 'Escape'), false)
  assert.equal(keyCancels({ ...IDLE }, 'Escape'), false)
  assert.equal(orderReducer(c, { type: 'cancel' }).outcome.cancelled, true, 'the cancel it triggers is the button\'s own')
})
test('the countdown bar listens to Escape through keyCancels', () => {
  const bar = src.slice(src.indexOf('state.phase === \'counting\' && o'), src.indexOf('(state.phase === \'sending\''))
  assert.match(bar, /onKeyDown/)
  assert.match(bar, /keyCancels\(state, e\.key\)/)
})

// An answer that was lost (network cut, proxy page, 502) says nothing about the order: the agent half may well
// have executed it (comment written, answer dropped). The page cannot know: it must say « unknown », never « did not go through ».
test('a lost answer is an unknown outcome, never « did not go through »', () => {
  assert.equal(isUnknownOutcome({ ok: false, cancelled: false, reason: 'unknown_outcome' }), true)
  assert.equal(isUnknownOutcome({ ok: false, cancelled: false, reason: 'not_blocked' }), false)
  assert.equal(isUnknownOutcome({ ok: true, cancelled: false, reason: null }), false)
  assert.equal(isUnknownOutcome({ cancelled: true, reason: 'unknown_outcome' }), false)
  assert.equal(isUnknownOutcome(null), false)
  for (const lang of ['en', 'fr', 'es']) {
    const o = messages[lang].orders
    assert.ok(o.tag.unknown, `${lang} tag.unknown`)
    assert.notEqual(o.tag.unknown, o.tag.ko, `${lang}: the tag is not « failed »`)
    const line = o.unknown('Comment board · t_00000001', o.reason.unknown_outcome)
    assert.ok(line.includes('t_00000001') && line.includes(o.reason.unknown_outcome))
    assert.ok(!line.includes(o.failed('x', '').replace('x', '').trim()), `${lang}: does not use the « failed » sentence`)
  }
  assert.match(src, /isUnknownOutcome\(o\)/)
  assert.match(src, /orders\.tag\.unknown|tag\.\$\{/)
})
}

// ===== orders =====
{
// « Launch » never leaves without the named confirmation. The editor's `preconfirmed` shortcut
// (its review step IS the confirmation of the `campaign` order) is not a flag any order may carry: a
// launch, a cancel or an unblock built with it would go straight to the 6 s window. Only the `campaign` order may skip it.
const item = { board: 'sandbox-demo', id: 't_g0', title: 'Guard — Ship <img src=x onerror=alert(1)>', head: true, campaignSize: 3 }

test('launch, cancel_campaign and unblock always stop at the confirmation, even when the order carries preconfirmed', () => {
  for (const verb of ['launch', 'cancel_campaign']) {
    const order = { ...guardTarget(verb, item, `id-${verb}`), starts: ['A1 · dev'], preconfirmed: true }
    const s = orderReducer(initialOrderState(), { type: 'request', order, now: 1000 })
    assert.equal(s.phase, 'confirm', `${verb} must ask first`)
    // nothing leaves while the confirmation waits, however long
    assert.equal(orderReducer(s, { type: 'tick', now: 60_000 }).phase, 'confirm')
    // the confirmation names the campaign (its goal, as text) and its project
    assert.equal(s.order.code, 'Ship <img src=x onerror=alert(1)>')
    assert.equal(s.order.board, 'sandbox-demo')
  }
  const unblock = { id: 'u', verb: 'unblock', board: 'sandbox-demo', task: 't_1', code: 't_1', preconfirmed: true }
  assert.equal(orderReducer(initialOrderState(), { type: 'request', order: unblock, now: 1000 }).phase, 'confirm')
})

test('the campaign order keeps its shortcut (the review step named the cards and the project)', () => {
  const order = { id: 'c', verb: 'campaign', board: 'alpha', task: '', code: 'g', body: {}, preconfirmed: true }
  assert.equal(orderReducer(initialOrderState(), { type: 'request', order, now: 1000 }).phase, 'counting')
  assert.equal(orderReducer(initialOrderState(), { type: 'request', order: { ...order, preconfirmed: false }, now: 1000 }).phase, 'confirm')
})
}
