import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HEAD, MAX_WORK_CARDS, TEMPLATES, addCard, addGuard, addPhase, applyTemplate, codes, createdOf, draftIsEmpty, draftIssues, draftNotes, duplicateCard, effective, eligibleParents, guardName, guardTarget, guardTitle, initialWindow, newDraft, patchCard, printable, readCampaign, removeCard, removeLastPhase, slugState, slugify, summary, templateCards, toRequest, toggleParent, validateRequest, windowReducer, workCards, campaignBoardNote, newDraft as freshDraft } from '../../src/core/campaign.js'
import { edgesOverCards, foldCards, graphOf, overlapping, EDGE_CLEAR, edgeClearance, EDGE_GAP } from '../../src/core/campaignLayout.js'
import { initialOrderState, orderReducer, readAnswer } from '../../src/core/orders.js'
import { inboxItems, topStats } from '../../src/core/panel.js'
import { en } from '../../src/i18n/en.js'
import { es } from '../../src/i18n/es.js'
import { fr } from '../../src/i18n/fr.js'
import { CAMPAIGN_CSS } from '../../src/ui/campaignStyles.js'
import { PAGE_CSS } from '../../src/ui/pageStyles.js'
import { readFileSync } from 'node:fs'
import { computeGame, gameFacts, isSandboxBoard } from '../../src/core/game.js'
import { toHistoryBoard } from '../../src/core/history.js'
import { nightSummary, toReplay } from '../../src/core/replay.js'

// ===== campaign =====
{
// The campaign editor's pure logic: the page-side validation (same rules as the agent half), the chain templates, the preview layout
// (0 overlap up to 40 cards), the window's state machine.
const BOTS = ['lead', 'builder', 'reviewer', 'scout']
const CTX = { bots: BOTS, boards: ['alpha', 'beta'] }
const UUID = '0b8b1c52-6a4e-4d0b-9d3f-0a5f6c2f9e11'

/** A valid draft: goal, project, n cards in a row, each with a title and a bot. */
function chain(n, o = {}) {
  let d = newDraft({ phaseName: 'A', board: 'alpha' })
  d = { ...d, goal: 'Ship it' }
  for (let i = 1; i <= n; i++) {
    d = addCard(d, 0, BOTS[i % BOTS.length])
    const id = d.sel
    d = patchCard(d, id, { title: `Card ${i}`, parents: i > 1 ? [d.cards.filter(c => c.kind === 'card')[i - 2].id] : [], ...(o.body ? { body: 'do it' } : {}) })
  }
  return d
}

test('a new draft has the head guard and nothing else; it is empty until a goal or a card exists', () => {
  const d = newDraft({ phaseName: 'A' })
  assert.deepEqual(d.cards.map(c => [c.id, c.kind, c.phase]), [[HEAD, 'guard', 0]])
  assert.equal(draftIsEmpty(d), true)
  assert.equal(draftIsEmpty({ ...d, goal: 'x' }), false)
  assert.equal(draftIsEmpty(addCard(d, 0, 'lead')), false)
})

test('toRequest: closed fields only, the guard carries nothing but ref/kind/phase/parents, empty optional fields are left out', () => {
  const d = chain(2)
  const req = toRequest(d, UUID)
  assert.deepEqual(Object.keys(req).sort(), ['board', 'cards', 'goal', 'id', 'phases'])
  assert.deepEqual(req.cards[0], { ref: HEAD, kind: 'guard', phase: 0, parents: [] })
  const w = req.cards[1]
  assert.deepEqual(Object.keys(w).sort(), ['assignee', 'kind', 'parents', 'phase', 'ref', 'title'])
  assert.deepEqual(w.parents, [HEAD], 'a card with no parent starts under the head guard')
  assert.equal(validateRequest(req), null)
})

test('toRequest: a model needs its provider (both or none), instructions and limits only when set, a new project goes as newBoard', () => {
  let d = chain(1)
  const id = workCards(d)[0].id
  d = patchCard(d, id, { model: 'm1', provider: 'p1', body: 'x', workspace: 'dir', maxRuntime: 3600 })
  const w = toRequest(d, UUID).cards[1]
  assert.deepEqual([w.model, w.provider, w.body, w.workspace, w.maxRuntime], ['m1', 'p1', 'x', 'dir', 3600])
  d = patchCard(d, id, { model: 'm1', provider: '' })
  const half = toRequest(d, UUID).cards[1]
  assert.equal('model' in half || 'provider' in half, false, 'a half pair is never sent')
  assert.ok(draftIssues(d, CTX).some(i => i.code === 'model_pair' && i.id === id))
  const nb = { ...d, boardMode: 'new', nb: { name: ' Auth v2 ', slug: 'auth-v2', typed: true } }
  const req = toRequest(nb, UUID)
  assert.deepEqual(req.newBoard, { slug: 'auth-v2', name: 'Auth v2' })
  assert.equal('board' in req, false)
})

test('effective: a card that waits for nothing starts under the head guard; a phase guard waits for the last cards of the phase before it', () => {
  let d = chain(1)
  d = addPhase(d, 'B')
  d = addCard(d, 1, 'builder')
  const b1 = d.sel
  d = patchCard(d, b1, { title: 'B1' })
  const g = effective(d)
  const byId = Object.fromEntries(g.cards.map(c => [c.id, c]))
  const a1 = workCards(d)[0].id
  assert.deepEqual(byId.G1.parents, [a1])
  assert.deepEqual(byId[b1].parents, ['G1'], 'phase B card starts under the phase guard')
  // the phase-B card is also under the head guard through G1 -> A1 -> G0
  assert.equal(validateRequest(toRequest(d, UUID)), null)
})

test('effective: the guard of a phase after an empty phase is not sent (the agent would refuse it: unguarded)', () => {
  let d = chain(1)
  d = addPhase(d, 'B')   // phase B stays empty
  d = addPhase(d, 'C')
  d = addCard(d, 2, 'builder')
  d = patchCard(d, d.sel, { title: 'C1' })
  const refs = effective(d).cards.map(c => c.id)
  assert.equal(refs.includes('G1'), true, 'the guard of the empty phase B follows a phase with a card')
  assert.equal(refs.includes('G2'), false, 'but the guard of C follows the empty phase B')
  assert.equal(validateRequest(toRequest(d, UUID)), null)
})

test('effective: the last cards only: a middle card of a chain is not a parent of the next phase guard', () => {
  let d = chain(3)
  d = addPhase(d, 'B')
  d = addCard(d, 1, 'lead')
  d = patchCard(d, d.sel, { title: 'B1' })
  const g = effective(d).cards.find(c => c.id === 'G1')
  const [a1, a2, a3] = workCards(d).slice(0, 3).map(c => c.id)
  assert.deepEqual(g.parents, [a3], `${a1} and ${a2} are inside the chain`)
})

test('validateRequest: the agent half\'s refusals, one by one (shape then graph)', () => {
  const ok = () => toRequest(chain(2), UUID)
  assert.equal(validateRequest(ok()), null)
  const mut = f => { const r = ok(); f(r); return validateRequest(r) }
  assert.equal(mut(r => { r.goal = '' }), 'invalid')
  assert.equal(mut(r => { r.goal = 'x'.repeat(121) }), 'invalid')
  assert.equal(mut(r => { r.goal = 'bad\u0007goal' }), 'invalid')
  assert.equal(mut(r => { r.newBoard = { slug: 'x', name: 'x' } }), 'invalid', 'board and newBoard together')
  assert.equal(mut(r => { delete r.board }), 'invalid', 'neither')
  assert.equal(mut(r => { r.cards[1].ref = HEAD }), 'invalid', 'duplicate ref')
  assert.equal(mut(r => { r.cards[1].ref = 'G7' }), 'invalid', 'a card cannot take a guard ref')
  assert.equal(mut(r => { r.cards[1].title = '' }), 'invalid')
  assert.equal(mut(r => { r.cards[1].title = 'x'.repeat(121) }), 'invalid')
  assert.equal(mut(r => { delete r.cards[1].assignee }), 'invalid')
  assert.equal(mut(r => { r.cards[1].model = 'm' }), 'invalid', 'model without provider')
  assert.equal(mut(r => { r.cards[1].body = 'x'.repeat(8001) }), 'invalid')
  assert.equal(mut(r => { r.cards[1].maxRuntime = 899 }), 'invalid')
  assert.equal(mut(r => { r.cards[1].maxRuntime = 86_401 }), 'invalid')
  assert.equal(mut(r => { r.cards[1].workspace = 'tmp' }), 'invalid')
  assert.equal(mut(r => { r.cards[0].title = 'a guard has no title' }), 'invalid')
  assert.equal(mut(r => { r.cards[0].assignee = 'lead' }), 'invalid', 'a guard carries no bot')
  assert.equal(mut(r => { r.cards.push({ ref: 'x', kind: 'card', phase: 3, title: 't', assignee: 'lead', parents: [HEAD] }) }), 'invalid', 'phase out of range')
  assert.equal(mut(r => { r.cards[0].parents = [r.cards[1].ref] }), 'no_head_guard', 'the head guard has a parent')
  assert.equal(mut(r => { r.cards.shift() }), 'no_head_guard', 'no head guard')
  assert.equal(mut(r => { r.cards.push({ ref: 'G0b', kind: 'guard', phase: 0, parents: [] }) }), 'no_head_guard', 'two head guards')
  assert.equal(mut(r => { r.cards[1].parents = ['nope'] }), 'bad_parent')
  assert.equal(mut(r => { r.cards[1].parents = [r.cards[2].ref]; r.cards[2].parents = [r.cards[1].ref] }), 'cycle')
  assert.equal(mut(r => { r.cards[1].parents = [] }), 'unguarded')
})

test('validateRequest: more than 40 work cards is refused too_many_cards; 48 cards in all is the ceiling', () => {
  const r = toRequest(chain(1), UUID)
  for (let i = 0; i < 40; i++) r.cards.push({ ref: `w${i}`, kind: 'card', phase: 0, title: 't', assignee: 'lead', parents: [HEAD] })
  assert.equal(validateRequest(r), 'too_many_cards')
  for (let i = 0; i < 20; i++) r.cards.push({ ref: `z${i}`, kind: 'card', phase: 0, title: 't', assignee: 'lead', parents: [HEAD] })
  assert.equal(validateRequest(r), 'invalid', 'beyond 48 it is a shape error')
})

test('validateRequest: phase guards: wrong parents, a later-phase parent, two guards in a phase', () => {
  let d = chain(2)
  d = addPhase(d, 'B')
  d = addCard(d, 1, 'lead'); d = patchCard(d, d.sel, { title: 'B1' })
  const mk = () => toRequest(d, UUID)
  assert.equal(validateRequest(mk()), null)
  const wrong = mk(); wrong.cards.find(c => c.ref === 'G1').parents = [HEAD]
  assert.equal(validateRequest(wrong), 'bad_parent')
  const later = mk(); const g1 = later.cards.find(c => c.ref === 'G1'); later.cards.find(c => c.kind === 'card' && c.phase === 0).parents.push(g1.ref)
  assert.equal(validateRequest(later), 'bad_parent')
  const twice = mk(); twice.cards.push({ ref: 'Gx', kind: 'guard', phase: 1, parents: [] })
  assert.equal(validateRequest(twice), 'bad_guard')
  // a phase-B card that skips the phase guard
  const skip = mk(); skip.cards.find(c => c.ref !== 'G1' && c.phase === 1).parents = [HEAD]
  assert.equal(validateRequest(skip), 'unguarded')
})

test('draftIssues: every blocking problem the editor names, none for a good draft', () => {
  assert.deepEqual(draftIssues(chain(2, { body: true }), CTX), [])
  const empty = newDraft({ phaseName: 'A' })
  assert.deepEqual(draftIssues(empty, CTX).map(i => i.code), ['goal_empty', 'board_none', 'no_cards'])
  let d = chain(2)
  d = patchCard(d, workCards(d)[0].id, { title: '  ', who: 'ghost' })
  const codes2 = draftIssues(d, CTX).map(i => i.code)
  assert.ok(codes2.includes('title_empty') && codes2.includes('who_unknown'))
  assert.ok(draftIssues({ ...chain(1), board: 'zzz' }, CTX).some(i => i.code === 'board_unknown'))
  assert.ok(draftIssues({ ...chain(1), phases: [{ name: ' ' }] }, CTX).some(i => i.code === 'phase_name'))
  assert.ok(draftIssues({ ...chain(1), goal: 'a\u202eb' }, CTX).some(i => i.code === 'goal_chars'))
  const dir = patchCard({ ...chain(1), boardMode: 'new', nb: { name: 'N', slug: 'n1', typed: true } }, workCards(chain(1))[0].id, { workspace: 'dir' })
  assert.ok(draftIssues(dir, CTX).some(i => i.code === 'no_workdir'), 'a new project has no default workdir')
  const long = patchCard(chain(1), workCards(chain(1))[0].id, { body: 'x'.repeat(8001) })
  assert.ok(draftIssues(long, CTX).some(i => i.code === 'body_long'))
  assert.deepEqual(draftNotes(chain(2)).map(n => n.code), ['no_body', 'no_body'], 'a card without instructions is a note, not a block')
})

test('draftIssues: 41 work cards is too many', () => {
  let d = chain(1)
  for (let i = 0; i < 40; i++) { d = addCard(d, 0, 'lead'); d = patchCard(d, d.sel, { title: `c${i}` }) }
  assert.equal(workCards(d).length, 41)
  assert.ok(draftIssues(d, CTX).some(i => i.code === 'too_many'))
})

test('the new project: identifier from the name, the rule of Hermes, taken or free', () => {
  assert.equal(slugify('Authentication v2 !'), 'authentication-v2')
  assert.equal(slugify('Éléphant  à  l’école'), 'elephant-a-l-ecole')
  assert.equal(slugify('  '), '')
  assert.equal(slugify('x'.repeat(100)).length, 64)
  assert.deepEqual(slugState('', []), { ok: false, code: 'empty' })
  assert.deepEqual(slugState('UPPER', []), { ok: false, code: 'bad' }, 'no normalisation: the agent refuses it too')
  assert.deepEqual(slugState('-start', []), { ok: false, code: 'bad' })
  assert.deepEqual(slugState('a'.repeat(65), []), { ok: false, code: 'bad' })
  assert.deepEqual(slugState('alpha', ['alpha', 'beta']), { ok: false, code: 'taken' })
  assert.deepEqual(slugState('alpha', new Set(['alpha'])), { ok: false, code: 'taken' })
  assert.deepEqual(slugState('gamma_2-x', ['alpha']), { ok: true, code: 'free' })
  const d = { ...chain(1), boardMode: 'new', nb: { name: 'Alpha', slug: 'alpha', typed: true } }
  assert.ok(draftIssues(d, CTX).some(i => i.code === 'slug_taken'))
})

test('printable: the agent\'s rule (control, format, separator characters out; newline and tab allowed in instructions only)', () => {
  assert.equal(printable('plain text é'), true)
  for (const bad of ['a\u0000b', 'a\u200bb', 'a\u202eb', 'a\u2028b', 'a\ufeffb', 'tag\u{e0041}']) assert.equal(printable(bad), false, JSON.stringify(bad))
  assert.equal(printable('line1\nline2\tx', true), true)
  assert.equal(printable('line1\nline2', false), false)
})

test('editing: cycles are refused at the input, a card waits only for cards it may wait for', () => {
  const d = chain(3)
  const [a, b, c] = workCards(d).map(x => x.id)
  assert.deepEqual(eligibleParents(d, a).map(x => x.id).sort(), [], 'A waits for nothing yet, and B and C are below it')
  assert.deepEqual(eligibleParents(d, c).map(x => x.id).sort(), [a, b].sort())
  assert.equal(toggleParent(d, a, c).refused, 'cycle')
  assert.equal(toggleParent(d, a, a).refused, 'cycle')
  const added = toggleParent(d, c, a)
  assert.equal(added.refused, null)
  assert.ok(added.draft.cards.find(x => x.id === c).parents.includes(a))
  assert.equal(toggleParent(added.draft, c, a).draft.cards.find(x => x.id === c).parents.includes(a), false, 'a second toggle removes it')
})

test('editing: a card of an earlier phase cannot wait for a later one; removing a card frees whoever waited for it', () => {
  let d = chain(1)
  d = addPhase(d, 'B'); d = addCard(d, 1, 'lead'); const b1 = d.sel
  const a1 = workCards(d)[0].id
  assert.equal(toggleParent(d, a1, b1).refused, 'not_eligible')
  assert.equal(toggleParent(d, b1, a1).refused, null)
  const x = removeCard(toggleParent(d, b1, a1).draft, a1)
  assert.deepEqual(x.cards.find(c => c.id === b1).parents, [])
  assert.equal(removeCard(d, HEAD), d, 'the head guard stays')
})

test('editing: duplicate keeps bot, model and parents; the copy comes right after and is selected', () => {
  let d = chain(2)
  const [a, b] = workCards(d).map(c => c.id)
  d = patchCard(d, b, { model: 'm', provider: 'p', body: 'go' })
  const e = duplicateCard(d, b)
  const copy = e.cards.find(c => c.id === e.sel)
  assert.notEqual(copy.id, b)
  assert.deepEqual([copy.who, copy.model, copy.provider, copy.body, copy.parents], [d.cards.find(c => c.id === b).who, 'm', 'p', 'go', [a]])
  assert.equal(e.cards[e.cards.findIndex(c => c.id === b) + 1].id, copy.id)
  assert.equal(new Set(e.cards.map(c => c.id)).size, e.cards.length)
})

test('editing: phases (8 at most), the guard of a phase can be removed and put back, the last phase goes with its cards', () => {
  let d = chain(1)
  for (let i = 0; i < 9; i++) d = addPhase(d, `P${i}`)
  assert.equal(d.phases.length, 8)
  d = removeLastPhase(d)
  assert.equal(d.phases.length, 7)
  assert.equal(d.cards.some(c => c.phase === 7), false)
  const noGuard = removeCard(d, 'G3')
  assert.equal(noGuard.cards.some(c => c.id === 'G3'), false)
  assert.equal(addGuard(noGuard, 3).cards.some(c => c.id === 'G3'), true)
  assert.equal(removeLastPhase(newDraft({ phaseName: 'A' })).phases.length, 1, 'the first phase stays')
})

test('codes: A1, A2… per phase, G0 and G<k> for the guards', () => {
  let d = chain(2)
  d = addPhase(d, 'B'); d = addCard(d, 1, 'lead')
  const c = codes(d)
  assert.deepEqual(Object.values(c).sort(), ['A1', 'A2', 'B1', 'G0', 'G1'])
})

test('summary: what will be written, and who starts first', () => {
  const s = summary(chain(3))
  assert.deepEqual([s.cards, s.work, s.guards, s.links], [4, 3, 1, 3])   // G0 + 3 cards; links: A1<-G0, A2<-A1, A3<-A2
  assert.equal(s.first.length, 1)
  assert.equal(s.bots.reduce((n, [, k]) => n + k, 0), 3)
})

/* ---------- chain templates ---------- */

const PARAMS = { n: 3, per: 2, bots: { dev: 'builder', review: 'reviewer', audit: ['scout', 'reviewer'], synth: 'lead', work: ['builder', 'reviewer'], chain: ['lead', 'builder'] } }

function fresh(extra = {}) { return { ...newDraft({ phaseName: 'A', board: 'alpha' }), goal: 'g', ...extra } }

test('template « dev + review per step »: N steps = 2N cards, each review waits for its step, each step for the review before', () => {
  const { draft, refused } = applyTemplate(fresh(), 'devreview', PARAMS, 'replace')
  assert.equal(refused, null)
  const w = workCards(draft)
  assert.equal(w.length, 6)
  assert.deepEqual(w.map(c => c.who), ['builder', 'reviewer', 'builder', 'reviewer', 'builder', 'reviewer'])
  assert.deepEqual(w[0].parents, [HEAD])
  assert.deepEqual(w[1].parents, [w[0].id])
  assert.deepEqual(w[2].parents, [w[1].id])
  assert.deepEqual(draftIssues(draft, CTX), [])
  assert.equal(validateRequest(toRequest(draft, UUID)), null)
})

test('template « audit in parallel, then a synthesis »: N audits start together, the synthesis waits for all of them', () => {
  const { draft } = applyTemplate(fresh(), 'audit', { ...PARAMS, n: 5 }, 'replace')
  const w = workCards(draft)
  assert.equal(w.length, 6)
  const synth = w[5]
  assert.deepEqual(synth.parents, w.slice(0, 5).map(c => c.id))
  assert.equal(synth.who, 'lead')
  assert.deepEqual(w.slice(0, 5).map(c => c.who), ['scout', 'reviewer', 'scout', 'reviewer', 'scout'])
  assert.ok(w.slice(0, 5).every(c => c.parents.length === 1 && c.parents[0] === HEAD))
  assert.equal(validateRequest(toRequest(draft, UUID)), null)
})

test('template « phases with a guard »: N phases of `per` cards, a guard in front of every phase after the first', () => {
  const { draft } = applyTemplate(fresh(), 'phases', { ...PARAMS, n: 3, per: 2 }, 'replace')
  assert.equal(draft.phases.length, 3)
  assert.equal(workCards(draft).length, 6)
  assert.deepEqual(draft.cards.filter(c => c.kind === 'guard').map(c => c.id), ['G0', 'G1', 'G2'])
  const req = toRequest(draft, UUID)
  assert.equal(validateRequest(req), null)
  assert.deepEqual(req.cards.find(c => c.ref === 'G1').parents.length, 2, 'the guard waits for both cards of the phase before')
  assert.equal(draft.phases[0].name, 'Phase A')
})

test('template « simple chain »: N cards one after the other', () => {
  const { draft } = applyTemplate(fresh(), 'chain', { ...PARAMS, n: 4 }, 'replace')
  const w = workCards(draft)
  assert.deepEqual(w.map(c => c.who), ['lead', 'builder', 'lead', 'builder'])
  assert.deepEqual(w.map(c => c.parents.length), [1, 1, 1, 1])
  assert.equal(validateRequest(toRequest(draft, UUID)), null)
})

test('templates: append keeps what is there, replace drops it but keeps the goal, the project and the head guard', () => {
  let d = chain(2)
  const before = workCards(d).length
  const added = applyTemplate(d, 'chain', { ...PARAMS, n: 3 }, 'append').draft
  assert.equal(workCards(added).length, before + 3)
  assert.equal(new Set(added.cards.map(c => c.id)).size, added.cards.length, 'ids stay unique')
  assert.equal(validateRequest(toRequest(added, UUID)), null)
  const replaced = applyTemplate(d, 'chain', { ...PARAMS, n: 3 }, 'replace').draft
  assert.equal(workCards(replaced).length, 3)
  assert.deepEqual([replaced.goal, replaced.board], ['Ship it', 'alpha'])
  assert.ok(replaced.cards.some(c => c.id === HEAD))
})

test('templates: appending a phases template after existing phases adds its guards; the result is valid', () => {
  let d = chain(2)
  d = applyTemplate(d, 'phases', { ...PARAMS, n: 2, per: 2 }, 'append').draft
  assert.equal(d.phases.length, 3)
  assert.deepEqual(d.cards.filter(c => c.kind === 'guard').map(c => c.id), ['G0', 'G1', 'G2'])
  assert.deepEqual(draftIssues(d, CTX), [])
  assert.equal(validateRequest(toRequest(d, UUID)), null)
})

test('templates: past 40 work cards or 8 phases the draft is left as it was', () => {
  let d = chain(1)
  d = applyTemplate(d, 'chain', { ...PARAMS, n: 20 }, 'append').draft
  d = applyTemplate(d, 'chain', { ...PARAMS, n: 20 }, 'append').draft
  const n = workCards(d).length
  const over = applyTemplate(d, 'chain', { ...PARAMS, n: 20 }, 'append')
  assert.equal(over.refused, 'too_many')
  assert.equal(over.draft, d)
  assert.ok(n <= MAX_WORK_CARDS)
  let p = fresh()
  p = applyTemplate(p, 'phases', { ...PARAMS, n: 8, per: 1 }, 'replace').draft
  const more = applyTemplate(p, 'phases', { ...PARAMS, n: 2, per: 1 }, 'append')
  assert.equal(more.refused, 'too_many')
})

test('templates: every knob is clamped (an absurd count never writes an absurd graph), titles come from the page\'s wording', () => {
  for (const t of TEMPLATES) {
    const big = templateCards(t.id, { ...PARAMS, n: 9999, per: 9999 })
    const small = templateCards(t.id, { ...PARAMS, n: -5, per: -5 })
    assert.ok(big.cards.length <= 100 && big.cards.length >= small.cards.length, t.id)
    assert.ok(small.cards.length >= 1)
  }
  const L = { step: n => `E${n}`, review: n => `R${n}`, audit: n => `A${n}`, synth: () => 'S', card: n => `C${n}`, phase: k => `P${k}`, phaseCard: (k, n) => `${k}${n}` }
  assert.deepEqual(templateCards('devreview', { n: 1, bots: { dev: 'x', review: 'y' } }, L).cards.map(c => c.title), ['E1', 'R1'])
})

test('templates: the bots come from the roster the caller passes, never from the code', () => {
  const { draft } = applyTemplate(fresh(), 'chain', { n: 3, bots: { chain: ['zed', 'yan'] } }, 'replace')
  assert.deepEqual(workCards(draft).map(c => c.who), ['zed', 'yan', 'zed'])
  const src = templateCards('audit', { n: 2, bots: {} }).cards
  assert.ok(src.every(c => c.who === ''), 'no bot passed: no bot invented')
})

/* ---------- the answer, the window ---------- */

test('readCampaign: a done answer keeps the facts read back and the head guard\'s task; anything malformed is null', () => {
  const a = readCampaign({ ok: true, id: UUID, result: 'done', board: 'alpha', boardCreated: true, created: 5, links: 6, guards: [{ ref: 'G0', task: 't_aaaaaaaa' }, { ref: 'G1', task: 't_bbbbbbbb' }], cards: [{ ref: 'k1', task: 't_c' }], after: { blocked: 2, todo: 3, ready: 0, running: 0 }, at: 1700000000.5, risk: 'final' })
  assert.equal(a.ok, true)
  assert.deepEqual([a.detail.created, a.detail.links, a.detail.head, a.detail.boardCreated], [5, 6, 't_aaaaaaaa', true])
  assert.deepEqual(a.detail.counts, { blocked: 2, todo: 3, ready: 0, running: 0 })
  assert.equal(a.audited, true)
  const bad = readCampaign({ result: 'refused', reason: 'cycle', board: 'alpha', created: 0 })
  assert.deepEqual([bad.ok, bad.result, bad.reason, bad.detail.head], [false, 'refused', 'cycle', null])
  assert.equal(readCampaign(null), null)
  assert.equal(readCampaign({}), null)
  assert.equal(readCampaign({ result: 7 }), null)
  const odd = readCampaign({ result: 'done', created: -4, links: 'x', guards: [{ ref: 3 }], after: 'no' })
  assert.deepEqual([odd.detail.created, odd.detail.links, odd.detail.guards, odd.detail.counts], [0, 0, [], null])
})

test('the window: compose -> review -> created; a refused or failed creation leaves it where it is, the campaign state is read from the outcome only', () => {
  let s = initialWindow()
  assert.equal(s.step, 'compose')
  assert.equal(windowReducer(s, { type: 'back' }).step, 'compose', 'nothing to go back to')
  s = windowReducer(s, { type: 'review' })
  assert.equal(s.step, 'review')
  assert.equal(windowReducer(s, { type: 'back' }).step, 'compose')
  const d = chain(2)
  const out = { verb: 'campaign', ok: true, board: 'alpha', detail: readCampaign({ result: 'done', board: 'alpha', created: 3, links: 3, guards: [{ ref: 'G0', task: 't_head' }], after: { blocked: 1, todo: 2, ready: 0, running: 0 } }).detail }
  const created = createdOf(out, d)
  assert.deepEqual([created.board, created.head, created.size, created.links, created.starts.length], ['alpha', 't_head', 3, 3, 1])
  assert.match(created.starts[0], /^A1 · /)
  assert.equal(createdOf({ ...out, ok: false }, d), null)
  assert.equal(createdOf({ ...out, verb: 'launch' }, d), null)
  s = windowReducer(s, { type: 'created', created })
  assert.equal(s.step, 'created')
  // launch: only the head guard of THIS campaign moves it
  assert.equal(windowReducer(s, { type: 'launched', task: 't_other', ready: 1 }).created.launched, null)
  const l = windowReducer(s, { type: 'launched', task: 't_head', ready: 1 })
  assert.deepEqual(l.created.launched, { ready: 1 })
  assert.equal(windowReducer(l, { type: 'cancelled', task: 't_head', archived: 3 }).created.cancelled, null, 'a launched campaign cannot be cancelled')
  const c = windowReducer(s, { type: 'cancelled', task: 't_head', archived: 3 })
  assert.deepEqual(c.created.cancelled, { archived: 3 })
  assert.equal(windowReducer(c, { type: 'launched', task: 't_head', ready: 1 }).created.launched, null, 'a cancelled campaign cannot be launched')
  assert.equal(windowReducer(c, { type: 'recompose' }).step, 'compose')
  assert.equal(windowReducer(c, { type: 'recompose' }).created, null)
})

test('guards of a campaign as decisions: the name is the goal, the order names board, campaign and size', () => {
  assert.equal(guardName('Guard — Migrate the sign-in'), 'Migrate the sign-in')
  assert.equal(guardName('Guard phase B — Tests'), 'Tests')
  assert.equal(guardName('Some card'), 'Some card')
  const t = guardTarget('launch', { board: 'alpha', id: 't_x', title: 'Guard — Goal', head: true, campaignSize: 9 }, 'id1')
  assert.deepEqual(t, { id: 'id1', verb: 'launch', board: 'alpha', task: 't_x', code: 'Goal', head: true, size: 9 })
})

test('guard titles are written in English, and the French titles of earlier campaigns are still read', async () => {
  assert.equal(guardTitle('Migrate the sign-in'), 'Guard — Migrate the sign-in')
  assert.equal(guardTitle('Migrate the sign-in', 1, 'Tests'), 'Guard phase B — Tests')
  assert.equal(guardTitle('x', 7, 'Last'), 'Guard phase H — Last')
  // what is written is read back to the goal or the phase name, for every phase letter
  assert.equal(guardName(guardTitle('Migrate the sign-in')), 'Migrate the sign-in')
  for (let k = 1; k < 8; k++) assert.equal(guardName(guardTitle('g', k, `Phase ${k}`)), `Phase ${k}`)
  // a campaign created before the titles became English: same name, same order target
  assert.equal(guardName('Garde — Migrate the sign-in'), 'Migrate the sign-in')
  assert.equal(guardName('Garde phase B — Tests'), 'Tests')
  assert.equal(guardName('Garde phase H – Last'), 'Last')
  for (const title of ['Garde — Goal', 'Guard — Goal']) {
    assert.deepEqual(guardTarget('cancel_campaign', { board: 'alpha', id: 't_x', title, head: true, campaignSize: 9 }, 'id1'),
      { id: 'id1', verb: 'cancel_campaign', board: 'alpha', task: 't_x', code: 'Goal', head: true, size: 9 })
  }
  // only a guard prefix is stripped: a goal that merely contains the word stays whole
  assert.equal(guardName('Guard — Garde — nested'), 'Garde — nested')
  assert.equal(guardName('Guardian — Goal'), 'Guardian — Goal')
  assert.equal(guardName('Gardes — Goal'), 'Gardes — Goal')
  // the page shows the text the agent half writes: same two templates in hermes_officecraft/campaign.py, same body label as the button
  const { readFileSync } = await import('node:fs')
  const py = readFileSync(new URL('../../hermes_officecraft/campaign.py', import.meta.url), 'utf8')
  assert.ok(py.includes(`f"${guardTitle('{c.goal}')}"`), 'start guard title')
  assert.ok(py.includes(`f"${guardTitle('', 1, '{c.phases[k].name}').replace('B', '{_letter(k)}')}"`), 'phase guard title')
  assert.doesNotMatch(py, /f"Garde/)
  const body = /^GUARD_BODY = '([^']+)'$/m.exec(py)?.[1]
  assert.ok(body && body.includes(`"${en.orders.verb.launch}"`), 'the body quotes the Launch button as the page labels it')
  assert.doesNotMatch(body, /[«»]|Lancer|Carte/)
  const dialog = readFileSync(new URL('../../src/ui/CampaignDialog.jsx', import.meta.url), 'utf8')
  assert.match(dialog, /title: guardTitle\(created\.goal\)/)
  assert.doesNotMatch(dialog, /Garde|Guard —/)
})

/* ---------- the preview's layout ---------- */

/** A wide random graph of `n` work cards over `phases` phases, built through the editor's own operations. */
function random(n, seed, phases = 1) {
  let s = seed
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
  let d = { ...newDraft({ phaseName: 'A', board: 'alpha' }), goal: 'g' }
  for (let p = 1; p < phases; p++) d = addPhase(d, String.fromCharCode(65 + p))
  for (let i = 0; i < n; i++) {
    d = addCard(d, Math.floor(rnd() * phases), BOTS[i % BOTS.length])
    const id = d.sel
    d = patchCard(d, id, { title: `Card ${i}` })
    const pool = eligibleParents(d, id)
    for (const x of pool) if (rnd() < 0.18) d = toggleParent(d, id, x.id).draft
  }
  return d
}

test('layout: 0 overlapping nodes from 1 to 40 cards, at every width from 320 to 1920, folded or not', () => {
  const bad = []
  for (let n = 1; n <= 40; n++) {
    for (const [seed, phases] of [[n, 1], [n * 7 + 1, 3], [n * 13 + 5, 5]]) {
      const d = random(n, seed, phases)
      const cards = effective(d).cards
      for (const W of [320, 380, 520, 720, 1024, 1440, 1920]) {
        for (const open of [new Set(), new Set(foldCards(cards).filter(c => c.kind === 'group').map(c => c.id))]) {
          const g = graphOf(cards, W, { open })
          const o = overlapping(g)
          if (o.length) bad.push(`${n} cards, ${phases} phases, ${W}px: ${o[0]}`)
          const out = [...g.pos.values()].filter(p => p.x < 0 || p.x + p.w > W || p.y < 0 || p.y + p.h > g.H)
          if (out.length) bad.push(`${n} cards, ${W}px: a node outside the frame`)
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 5), [])
})

test('layout: no side channel runs through a card', () => {
  const bad = []
  for (let n = 4; n <= 40; n += 3) {
    for (const W of [380, 720, 1440]) {
      const g = graphOf(effective(random(n, n * 31, 2)).cards, W)
      const e = edgesOverCards(g)
      if (e.length) bad.push(`${n} / ${W}: ${e[0]}`)
    }
  }
  assert.deepEqual(bad.slice(0, 5), [])
})

test('layout: a guard is a bar across the whole width and sits above the cards that wait for it', () => {
  const g = graphOf(effective(chain(3)).cards, 1024)
  const head = g.pos.get(HEAD)
  assert.equal(head.kind, 'guard')
  assert.ok(head.w >= 1024 - 2 * 16 - 24 - 1)
  const ys = workCards(chain(3)).map(c => g.pos.get(c.id).y)
  assert.ok(ys.every(y => y > head.y + head.h))
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, 'a chain reads top to bottom')
})

test('layout: 40 parallel cards fold to a handful of nodes (<= 8 elements), unfolding draws all of them', () => {
  let d = { ...newDraft({ phaseName: 'A', board: 'alpha' }), goal: 'g' }
  for (let i = 0; i < 39; i++) { d = addCard(d, 0, BOTS[i % 4]); d = patchCard(d, d.sel, { title: `Audit ${i}` }) }
  d = addCard(d, 0, 'lead'); d = patchCard(d, d.sel, { title: 'Synthesis', parents: workCards(d).slice(0, 39).map(c => c.id) })
  const cards = effective(d).cards
  const folded = graphOf(cards, 1440)
  assert.ok(folded.cards.length <= 8, `${folded.cards.length} elements`)
  assert.equal(folded.cards.filter(c => c.kind === 'group').length, 1)
  assert.equal(folded.cards.find(c => c.kind === 'group').members.length, 39)
  const open = graphOf(cards, 1440, { open: new Set(folded.cards.filter(c => c.kind === 'group').map(c => c.id)) })
  assert.equal(open.cards.length, 41)
  assert.deepEqual(overlapping(open), [])
  // the selected card stays out of the pile
  const keep = graphOf(cards, 1440, { keep: new Set([workCards(d)[3].id]) })
  assert.ok(keep.cards.some(c => c.id === workCards(d)[3].id))
  // 24 cards or fewer never fold
  assert.equal(foldCards(effective(chain(10)).cards).length, 11)
})

test('layout: the same input gives the same picture (no clock, no randomness)', () => {
  const cards = effective(random(25, 9, 3)).cards
  const a = graphOf(cards, 900)
  const b = graphOf(cards, 900)
  assert.deepEqual([...a.pos], [...b.pos])
  assert.deepEqual(a.edges, b.edges)
})
}

// ===== campaign =====
{
// Rules of the campaign editor that the tests above did not hold (each one kills a mutant), and its
// finishes (the phase label must not say its default name twice; the review step must not cut the project's identifier and the cards' titles).
const UUID = '0b8b1c52-6a4e-4d0b-9d3f-0a5f6c2f9e11'

test('validateRequest: a work card must have the head guard among its ancestors, even under a phase guard (the agent: unguarded)', () => {
  // a phase guard after an empty phase waits for nothing: launched first, it would start its cards before the head guard
  const req = {
    id: UUID, goal: 'g', board: 'alpha', phases: [{ name: 'A' }, { name: 'B' }],
    cards: [{ ref: 'G0', kind: 'guard', phase: 0, parents: [] }, { ref: 'G1', kind: 'guard', phase: 1, parents: [] }, { ref: 'k1', kind: 'card', phase: 1, title: 't', assignee: 'dev', parents: ['G1'] }]
  }
  assert.equal(validateRequest(req), 'unguarded')
  assert.equal(validateRequest({ ...req, cards: [req.cards[0], req.cards[1], { ...req.cards[2], parents: ['G1', 'G0'] }] }), null)
})

test('decisions: a phase guard waits out of the list and the counter while the head guard of its campaign still waits', () => {
  const g0 = { id: 't_g0', title: 'Guard — Ship', createdMs: 1, guard: true, head: true, campaign: 'abcd1234', campaignSize: 6 }
  const g1 = { id: 't_g1', title: 'Guard phase B — Build', createdMs: 2, guard: true, head: false, campaign: 'abcd1234' }
  const other = { id: 't_x', title: 'Blocked card', createdMs: 3 }
  const office = blocked => ({ mode: 'live', agents: [], boards: [{ slug: 'alpha', blocked, open: [], total: blocked.length }] })
  assert.deepEqual(inboxItems(office([g0, g1, other])).map(i => i.id).sort(), ['t_g0', 't_x'])
  assert.equal(topStats(office([g0, g1, other])).decisions, 2)
  // the head guard is gone (launched): the phase guard is a decision now
  assert.deepEqual(inboxItems(office([g1, other])).map(i => i.id).sort(), ['t_g1', 't_x'])
  assert.equal(topStats(office([g1, other])).decisions, 2)
  // a phase guard of ANOTHER campaign is not held by this head guard
  assert.equal(topStats(office([g0, { ...g1, campaign: 'ffff0000' }])).decisions, 2)
  // the head guard's decision carries what its card says (the campaign's size, its full title)
  const head = inboxItems(office([g0])).find(i => i.id === 't_g0')
  assert.deepEqual([head.guard, head.head, head.campaignSize, head.fullTitle], [true, true, 6, 'Guard — Ship'])
})

test('the campaign order: the review step was its confirmation (straight to the 6 s), and its body (titles, instructions) is dropped once it has left', () => {
  const body = { id: UUID, goal: 'g', board: 'alpha', phases: [{ name: 'A' }], cards: [{ ref: 'k1', kind: 'card', phase: 0, title: 'Secret plan', assignee: 'dev', parents: ['G0'], body: 'do it' }] }
  const order = { id: UUID, verb: 'campaign', board: 'alpha', task: '', code: 'g', body, preconfirmed: true }
  let s = orderReducer(initialOrderState(), { type: 'request', order, now: 1000 })
  assert.equal(s.phase, 'counting')
  assert.equal(s.order.body, body, 'held for its 6 s only')
  // an order that is not pre-confirmed still asks (a launch names the cards first)
  assert.equal(orderReducer(initialOrderState(), { type: 'request', order: { id: 'x', verb: 'launch', board: 'alpha', task: 't_g0', code: 'g' }, now: 1000 }).phase, 'confirm')
  s = orderReducer(s, { type: 'tick', now: 7100 })
  assert.equal(s.phase, 'sending')
  s = orderReducer(s, { type: 'answered', answer: readCampaign({ result: 'done', board: 'alpha', created: 2, links: 1, guards: [{ ref: 'G0', task: 't_g0' }] }) })
  s = orderReducer(s, { type: 'read', liveOk: true })
  assert.equal(s.phase, 'done')
  assert.equal(s.order.body, undefined)
  assert.ok(!JSON.stringify(s).includes('Secret plan') && !JSON.stringify(s).includes('do it'), 'no title nor instructions stay in the order machine')
  // launch and cancel read what the agent half read back
  assert.deepEqual([readAnswer({ result: 'done', after: { status: 'done', ready: 4 } }).ready, readAnswer({ result: 'done', after: { status: 'archived', archived: 9 } }).archived], [4, 9])
})

test('readCampaign: the head guard is the G0 one, wherever the agent lists it', () => {
  const a = readCampaign({ result: 'done', board: 'alpha', created: 4, links: 3, guards: [{ ref: 'G1', task: 't_g1' }, { ref: 'G0', task: 't_g0' }] })
  assert.equal(a.detail.head, 't_g0')
})

test('finish: a phase band does not say its default name twice; a name of its own is still said', () => {
  for (const [L, word] of [[en, 'Phase'], [fr, 'Phase'], [es, 'Fase']]) {
    const lab = L.campaign.phaseLabel
    assert.equal(lab('A', `${word} A`), `${word} A`)
    assert.equal(lab('B', ` ${word.toLowerCase()} b `), `${word} B`)
    assert.equal(lab('B', 'Build'), `${word} B · Build`)
    assert.equal(lab('C', ''), `${word} C`)
  }
})

test('finish: the review never cuts the project it names, a full-size preview node gives its title two lines', () => {
  const css = CAMPAIGN_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /\.oc-cgsum \.ux-prj\{max-width:100%\}/)
  const rule = css.match(/\.oc-cgg-in:not\(\.cmp\) \.oc-cgg-node \.tt\{([^}]*)\}/)
  assert.ok(rule, 'a rule for the title of a node of a full-size preview')
  assert.match(rule[1], /-webkit-line-clamp:2/)
  assert.match(rule[1], /white-space:normal/)
})
}

// ===== campaign =====
{
// Defects seen in the real webapp, kept as tests.
//  1.  the campaign counters did not agree with 1: « 6 tarjetas · 1 guardas · 6 enlaces » in the preview of every campaign with only
//      its head guard (dev + review, audit, simple chain), « existing · 1 cards already », « campaign of 1 cards ».
//  2.  the Journal cut a project chip at the 140 px of the page's chips (« sandbox-website… », 120 > 110 px of text) although the chip
//      has its own line in the row (finish check: 130 clipped chips over the matrix).
const ONE = {
  en: { counts: '1 card · 1 guard · 1 link', existing: 'existing · 1 card already', head: 'Start guard · campaign of 1 card' },
  fr: { counts: '1 carte · 1 verrou · 1 lien', existing: 'existant · 1 carte déjà', head: 'Verrou de départ · campagne de 1 carte' },
  es: { counts: '1 tarjeta · 1 barrera · 1 enlace', existing: 'existente · ya tiene 1 tarjeta', head: 'Barrera inicial · campaña de 1 tarjeta' }
}
const MANY = {
  en: '6 cards · 2 guards · 6 links', fr: '6 cartes · 2 verrous · 6 liens', es: '6 tarjetas · 2 barreras · 6 enlaces'
}

for (const [lang, b] of Object.entries({ en, fr, es })) {
  test(`${lang}: the campaign counters agree with 1 and with many`, () => {
    assert.equal(b.campaign.counts(1, 1, 1), ONE[lang].counts)
    assert.equal(b.campaign.counts(6, 2, 6), MANY[lang])
    assert.equal(b.campaign.sum.existing(1), ONE[lang].existing)
    assert.equal(b.campaign.decision.head(1), ONE[lang].head)
    assert.match(b.campaign.decision.head(9), /9 (cards|cartes|tarjetas)$/)
  })
}

test('a journal row never cuts its project chip at the 140 px of the page chips', () => {
  const css = PAGE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /\.ux-prj\{[^}]*max-width:140px/)
  assert.match(css, /\.ux-jl \.ux-prj\{max-width:100%\}/)
})
}

// ===== campaign =====
{
// Bugs reproduced in the real webapp, kept as tests.
// A failed campaign on a NEW project said « nothing was changed » even when the project it had created could not be archived
// (`boardArchived: false`): the page reads that fact and says it.
/** The outcome the page ends on after the agent half answered `body` to a campaign order. */
function outcomeOf(body) {
  const order = { id: 'c', verb: 'campaign', board: 'new-proj', task: '', code: 'Goal', body: {}, preconfirmed: true }
  let s = orderReducer(initialOrderState(), { type: 'request', order, now: 0 })
  s = orderReducer(s, { type: 'tick', now: 7000 })
  assert.equal(s.phase, 'sending')
  s = orderReducer(s, { type: 'answered', answer: readCampaign(body) })
  s = orderReducer(s, { type: 'read', liveOk: true })
  assert.equal(s.phase, 'done')
  return s.outcome
}
const failed = extra => ({ ok: false, result: 'failed', reason: 'hermes_error', board: 'new-proj', created: 0, archived: 0, at: 1, audited: true, ...extra })

test('a failed campaign whose new project could not be archived says the project is still there', () => {
  const o = outcomeOf(failed({ boardCreated: true, boardArchived: false }))
  assert.equal(o.ok, false)
  assert.deepEqual(campaignBoardNote(o), { key: 'campaign.boardLeft', board: 'new-proj' })
})

test('a new project archived with the failed campaign is said too; an existing project, a success and an unknown say nothing', () => {
  assert.deepEqual(campaignBoardNote(outcomeOf(failed({ boardCreated: true, boardArchived: true }))), { key: 'campaign.boardArchived', board: 'new-proj' })
  assert.equal(campaignBoardNote(outcomeOf(failed({ boardCreated: false }))), null)
  assert.equal(campaignBoardNote(outcomeOf(failed({ boardCreated: true, boardArchived: null }))), null, 'no fact, no claim')
  assert.equal(campaignBoardNote({ ok: true, verb: 'campaign', detail: { boardCreated: true, boardArchived: false } }), null)
  assert.equal(campaignBoardNote({ ok: false, verb: 'launch', detail: { boardCreated: true, boardArchived: false } }), null)
  assert.equal(campaignBoardNote(null), null)
})

test('both notes exist in en, fr and es and name the project', () => {
  for (const [name, L] of Object.entries({ en, fr, es })) {
    for (const k of ['boardLeft', 'boardArchived']) {
      const f = L.campaign[k]
      assert.equal(typeof f, 'function', `${name}.campaign.${k}`)
      assert.ok(f('new-proj').includes('new-proj'), `${name}.campaign.${k} names the project`)
    }
  }
})

// Format characters (Unicode Cf) are refused in a title, an objective, instructions and a phase name, except
// the zero-width non-joiner that Persian, Kurdish and Hindi words need and the zero-width joiner of emoji sequences, which are allowed
// as joiners. The rule is Officecraft's own (the agent half), Hermes takes any title.
test('a Persian title with its ZWNJ is printable', async () => {
  const { printable } = await import('../../src/core/campaign.js')
  assert.equal(printable('می\u200cخواهم این را امتحان کنم'), true)
})
}

// ===== campaign =====
{
// Finishes found while running a real campaign
test('a node title of the full-size preview keeps the accent of a capital (« Écrire hello.md » was drawn « Ecrire »)', () => {
  // the two-line clamp clips at the line box: at line-height 1.1 the glyph box of « É » started 1 px above it (measured in the real
  // webapp, Chromium headless, 12 px), so the accent was cut off; and the accents of the hidden 3rd line (« Î », « Ü ») rose into the
  // 2nd one as stray pixels, still seen at 1.25 and 1.3 on 4x zoomed captures at 380 px, gone at 1.35
  const css = readFileSync(new URL('../../src/ui/campaignStyles.js', import.meta.url), 'utf8')
  const rule = css.split('\n').find(l => l.startsWith('.oc-cgg-in:not(.cmp) .oc-cgg-node .tt{'))
  assert.ok(rule, 'the full-size node title rule exists')
  const lh = Number((rule.match(/line-height:([\d.]+)/) || [])[1])
  assert.ok(lh >= 1.35, `line-height ${lh} clips the accent of a capital letter or shows the accents of the clamped 3rd line`)
  // two lines of 12 px + the grey line (11 px, its own line-height: « normal » is 16.5 px in Chromium) + the 2 px gap fit in a 52 px
  // node (50 px inside its border); measured: 0.44 px out on each side with a « normal » grey line
  const l2 = css.split('\n').find(l => l.startsWith('.oc-cgg-node .l2{'))
  const l2lh = Number((l2.match(/line-height:([\d.]+)/) || [])[1])
  assert.ok(l2lh > 0, 'the grey line of a node has a set line-height')
  assert.ok(2 * 12 * lh + 2 + 11 * l2lh <= 50, 'two title lines and the grey line fit in the node')
})
}

// ===== campaign =====
{
// The joiner rule of `printable` (same table as tests/python/test_campaign_printable.py), a run without a profile counted nowhere,
// guards and sandbox boards out of the game facts, and the finishes of the campaign editor.
const TABLE = JSON.parse(readFileSync(new URL('../joiner_cases.json', import.meta.url), 'utf8'))

test('printable: ZWNJ / ZWJ join two letters or two pictograms, everything else of Cf stays refused', () => {
  for (const [text, ok, why] of TABLE.cases) assert.equal(printable(text), ok, `${why}: ${JSON.stringify(text)}`)
  for (const [text, ok, why] of TABLE.multiline) assert.equal(printable(text, true), ok, `${why}: ${JSON.stringify(text)}`)
})

test('printable: a line break is refused outside instructions and never joins', () => {
  assert.equal(printable('a\nb'), false)
  assert.equal(printable('a\nb', true), true)
})

test('draftIssues: a Persian goal passes; a stray joiner keeps the same code as before', () => {
  const d = newDraft()
  d.goal = 'می\u200cخواهم'
  assert.ok(!draftIssues(d).map(e => e.code).includes('goal_chars'))
  d.goal = '\u200cabc'
  assert.ok(draftIssues(d).map(e => e.code).includes('goal_chars'))
})

/* ---------- a « Launch » is not an execution, a guard is not a game fact ---------- */
const MIN = 60_000
const H = 3_600_000
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime()
const NOW = at(2026, 11, 16, 9)
const DAY = at(2026, 11, 15, 10)
const card = (id, doneMs, extra = {}) => ({ id, status: 'done', completedMs: doneMs, createdMs: doneMs - H, startedMs: null, ...extra })
const ach = (g, id) => g.achievements.find(a => a.id === id)

test('toHistoryBoard: a run with no profile (the synthetic run of a guard) is dropped, a worker run stays', () => {
  const b = toHistoryBoard({ slug: 'b', runs: [
    { profile: '', startedAt: 1, endedAt: 2, outcome: 'completed' },
    { profile: null, startedAt: 1, endedAt: 2, outcome: 'completed' },
    { profile: 'alice', startedAt: 1, endedAt: 2, outcome: 'completed' }], events: [] })
  assert.deepEqual(b.runs.map(r => r.profile), ['alice'])
})

test('toReplay + nightSummary: a run with no profile is not « 1 run started », nor an agent « — »', () => {
  const T = Date.UTC(2026, 10, 15, 20) / 1000
  const body = { ok: true, at: T + 9 * 3600, from: T, to: T + 8 * 3600, boards: [{ slug: 'b', since: T - 100, start: [], cards: { t_g: 'Decisions', t_w: 'Work' },
    facts: [[T + 100, 't_g', 'completed', 'done', null], [T + 200, 't_w', 'completed', 'done', null]],
    runs: [{ start: T + 100, end: T + 100, profile: '', task: 't_g', outcome: 'completed', usage: null, why: 'no_session_link' },
           { start: T + 150, end: T + 200, profile: null, task: 't_g', outcome: 'completed', usage: null },
           { start: T + 150, end: T + 200, profile: 'alice', task: 't_w', outcome: 'completed', usage: null, why: 'no_session_link' }], silences: [] }], orders: [], crons: [], sessions: [] }
  const r = toReplay(body)
  assert.equal(r.boards[0].runs.length, 1)
  const s = nightSummary(r, { from: T * 1000, to: (T + 8 * 3600) * 1000, ongoing: false })
  assert.equal(s.runs, 1)
  assert.deepEqual(s.byProfile.map(p => p.profile), ['alice'])
  assert.equal(s.usage.runsWithout, 1)
})

test('gameFacts: sandbox-* boards and guards leave the facts; the originals are untouched', () => {
  assert.equal(isSandboxBoard('sandbox-demo'), true)
  assert.equal(isSandboxBoard('demo'), false)
  const office = { agents: [], boards: [
    { slug: 'sandbox-x', tasks: [card('a', DAY)] },
    { slug: 'p', tasks: [card('g', DAY, { guard: true }), card('w', DAY)] }] }
  const hist = { ok: true, profiles: {}, boards: [
    { slug: 'sandbox-x', runs: [{ profile: 'ana', outcome: 'completed', endedMs: DAY }], events: [] },
    { slug: 'p', runs: [{ profile: '', outcome: 'completed', endedMs: DAY }, { profile: 'ana', outcome: 'completed', endedMs: DAY, task: 'w' }],
      events: [{ task: 'g', kind: 'completed', ms: DAY }, { task: 'w', kind: 'completed', ms: DAY }] }] }
  const f = gameFacts(hist, office)
  assert.deepEqual(f.office.boards.map(b => [b.slug, b.tasks.map(t => t.id)]), [['p', ['w']]])
  assert.deepEqual(f.hist.boards.map(b => [b.slug, b.runs.length, b.events.map(e => e.task)]), [['p', 1, ['w']]])
  assert.equal(office.boards[1].tasks.length, 2, 'input not mutated')
})

test('replayed: three projects finish a card the same day, one of them a guard on sandbox-demo -> the « wide » trophy stays locked', () => {
  const office = { agents: [], boards: [
    { slug: 'alpha', tasks: [card('t1', DAY)] },
    { slug: 'beta', tasks: [card('t2', DAY + H)] },
    { slug: 'sandbox-demo', tasks: [card('t_0a1b2c3d', DAY + 2 * H, { guard: true })] }] }
  const hist = { ok: true, profiles: {}, boards: [{ slug: 'sandbox-demo', runs: [{ profile: '', outcome: 'completed', endedMs: DAY + 2 * H, task: 't_0a1b2c3d' }], events: [{ task: 't_0a1b2c3d', kind: 'completed', ms: DAY + 2 * H }] }] }
  const g = computeGame(hist, office, NOW, {})
  assert.equal(ach(g, 'wide').unlocked, false)
  assert.equal(g.office.done, 2, 'level counts the two real cards, not the guard nor the test board')
  // control: a REAL third project on the same day still unlocks it (the rule is not broken, only the facts are cleaner)
  office.boards[2] = { slug: 'third', tasks: [card('t3', DAY + 2 * H)] }
  assert.equal(ach(computeGame(hist, office, NOW, {}), 'wide').unlocked, true)
})

test('a guard alone does not make a project, a finished card, a streak day or a grade', () => {
  const office = { agents: [{ name: 'ana' }], boards: [{ slug: 'p', createdMs: DAY - 9 * H, tasks: [card('g', DAY, { guard: true })] }, { slug: 'q', tasks: [card('g2', DAY, { guard: true })] }] }
  const hist = { ok: true, profiles: {}, boards: [{ slug: 'p', runs: [{ profile: '', outcome: 'completed', endedMs: DAY }], events: [{ task: 'g', kind: 'completed', ms: DAY }] }] }
  const g = computeGame(hist, office, NOW, {})
  assert.equal(g.office.done, 0)
  assert.equal(ach(g, 'builder').unlocked, false, 'two boards that hold only a guard are not two boards with cards')
  assert.equal(g.grades.ana.runs, 0)
  assert.equal(g.streak, 0)
})

/* ---------- the editor's finishes ---------- */
const widths = [380, 520, 720, 1024, 1440, 1920]
function randomDraft(n, seed, phases) {
  let s = seed
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
  let d = { ...freshDraft({ phaseName: 'A', board: 'alpha' }), goal: 'g' }
  for (let p = 1; p < phases; p++) d = addPhase(d, String.fromCharCode(65 + p))
  for (let i = 0; i < n; i++) {
    d = addCard(d, Math.floor(rnd() * phases), ['a', 'b', 'c'][i % 3])
    const id = d.sel
    d = patchCard(d, id, { title: `Card ${i}` })
    for (const x of eligibleParents(d, id)) if (rnd() < 0.18) d = toggleParent(d, id, x.id).draft
  }
  return d
}

test('edges keep EDGE_CLEAR px from the border of every node that is not theirs: templates and random graphs, 380 to 1920 px', () => {
  assert.ok(EDGE_CLEAR >= 4)
  const bad = []
  const drafts = []
  for (const [id, params] of [['phases', { n: 2, per: 4 }], ['phases', { n: 3, per: 6 }], ['phases', { n: 8, per: 6 }], ['devreview', { n: 12 }], ['audit', { n: 16 }], ['chain', { n: 20 }]]) {
    drafts.push([`${id} ${JSON.stringify(params)}`, applyTemplate({ ...freshDraft({ phaseName: 'A', board: 'alpha' }), goal: 'g' }, id, params, 'replace').draft])
  }
  for (let n = 4; n <= 40; n += 4) for (const ph of [1, 2, 3]) for (const seed of [1, 2, 3]) drafts.push([`random ${n}/${ph}/${seed}`, randomDraft(n, seed, ph)])
  for (const [name, d] of drafts) {
    for (const W of widths) {
      const c = edgeClearance(graphOf(effective(d).cards, W))
      if (c.min < EDGE_CLEAR) bad.push(`${name} at ${W} px: ${c.min.toFixed(1)} px from ${c.at.node} (edge ${c.at.from} > ${c.at.to})`)
    }
  }
  assert.deepEqual(bad.slice(0, 5), [])
})

test('16 parallel audit cards under a guard at 1024 px (the old routing came within 2.5 px of a card) — no edge runs along a border', () => {
  const d = applyTemplate({ ...freshDraft({ phaseName: 'A', board: 'alpha' }), goal: 'g' }, 'audit', { n: 16 }, 'replace').draft
  const g = graphOf(effective(d).cards, 1024)
  assert.ok(g.edges.some(e => e.side), 'the case has side channels')
  assert.ok(edgeClearance(g).min >= EDGE_CLEAR)
  // and the old shape is what the metric catches: a path that ends in a diagonal just above a card's top edge
  const card = [...g.pos.values()].find(p => p.kind === 'card')
  const fake = { ...g, edges: [{ from: 'x', to: 'y', d: `M${card.x - 80} ${card.y - 12} C${card.x - 80} ${card.y - 3} ${card.x + 60} ${card.y - 12} ${card.x + 60} ${card.y - 3}` }] }
  assert.ok(edgeClearance(fake).min < EDGE_CLEAR)
})

test('(380 px): a card title in the list wraps on two lines and is the tooltip; the review note is at least 12 px', () => {
  const css = readFileSync(new URL('../../src/ui/campaignStyles.js', import.meta.url), 'utf8')
  const dlg = readFileSync(new URL('../../src/ui/CampaignDialog.jsx', import.meta.url), 'utf8')
  const title = css.match(/\.oc-cgrow \.tt b\{([^}]*)\}/)[1]
  assert.match(title, /-webkit-line-clamp:2/)
  assert.doesNotMatch(title, /white-space:nowrap/, 'no single-line ellipsis')
  assert.match(css, /\.oc-cgrow\.on \.tt b\{[^}]*-webkit-line-clamp:unset/, 'the open card shows its whole title')
  assert.match(dlg, /<b title=\{c\.title \|\| undefined\}>/, 'the full title is the tooltip')
  assert.ok(Number(css.match(/\.oc-cgnote\{font-size:(\d+(?:\.\d+)?)px/)[1]) >= 12)
  assert.match(dlg, /className="faint oc-cgnote"/)
  for (const m of css.matchAll(/\.oc-cgnote\{[^}]*\}/g)) assert.doesNotMatch(m[0], /font-size:(?:[0-9]|1[01])(?:\.\d+)?px/)
})
}

// ===== campaign =====
{
// Guards the tests above left open.
test('every edge stops EDGE_GAP px above the node it points at (the arrow never touches its border)', () => {
  assert.ok(EDGE_GAP >= 4)
  const bad = []
  for (const [id, params] of [['audit', { n: 16 }], ['phases', { n: 3, per: 6 }], ['devreview', { n: 12 }], ['chain', { n: 20 }]]) {
    const d = applyTemplate({ ...newDraft({ phaseName: 'A', board: 'alpha' }), goal: 'g' }, id, params, 'replace').draft
    for (const W of [380, 1024, 1920]) {
      const g = graphOf(effective(d).cards, W)
      for (const e of g.edges) {
        const end = +String(e.d).match(/-?\d+(?:\.\d+)?/g).at(-1)
        const gap = g.pos.get(e.to).y - end
        if (Math.abs(gap - EDGE_GAP) > 0.01) bad.push(`${id} ${W} ${e.from}>${e.to}: ${gap}`)
      }
    }
  }
  assert.deepEqual(bad.slice(0, 5), [])
})

test('380 px: the grey line of a card row (« backend · after 16 cards ») wraps instead of being cut by an ellipsis', () => {
  const css = readFileSync(new URL('../../src/ui/campaignStyles.js', import.meta.url), 'utf8')
  const small = css.split('\n').find(l => l.startsWith('.oc-cgrow .tt small{'))
  assert.doesNotMatch(small, /white-space:nowrap/)
  assert.match(small, /-webkit-line-clamp:3/, '« backend · después de 16 cartas » takes 3 lines at 380 px')
})
}
