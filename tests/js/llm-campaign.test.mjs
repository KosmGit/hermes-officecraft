import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { HEAD, MAX_BODY, MAX_PHASES, MAX_WORK_CARDS, addCard, addPhase, codes, draftIssues, newDraft, patchCard, removeCard, workCards, toRequest, validateRequest } from '../../src/core/campaign.js'
import { LLM_WORK, REASONS, LLM_USEFUL } from '../../src/core/llm.js'
import { applyCampaign, emptyMarks, markedFields, readCampaignFiche, validateMarks, CARD_REF, LLM_WAIT_MS, campaignBody, campaignFicheErrors, isPhaseMarked, pruneMarks } from '../../src/core/llmCampaign.js'
import { BODY_ERRORS, CG_ERRORS, applyBodyText, bodyApplicable, cgRefusalOf, keepLint, lintShown, lintSignature, mergeMarks, planApply, pricesOf, proposalSummary, reviewCount, reviewIds } from '../../src/core/llmCampaignUi.js'
import { applyCardbody, lintView, FINDINGS_MAX, LINT_BODY_SENT, cardbodyBody, cardbodyErrors, findingTextOk, lintBody, readLintAnswer } from '../../src/core/llmReview.js'
import { messages } from '../../src/i18n/index.js'
import { leaves, translate } from '../../src/core/translate.js'
import { modelTextOk, readDraftRead } from '../../src/core/llmDraft.js'

// ===== llm-campaign =====
{
/* The page's side of the three assisted functions of the campaign editor (src/core/llmCampaignUi.js, src/ui/CampaignAssist.jsx): the six
   graphs kept as fixtures (the shape of real model answers, invented content) go through the page's pipeline (conversion, validators, marks), add / replace and their limits, the marks « to review »,
   the instructions of a card, the review before launch (remarks of ONE state of the draft), the refusals in plain words, i18n in the three languages and the
   off state. Pure functions and the source of the window: no model, no Hermes, no DOM. */
const DIR = new URL('./fixtures/llm-campaign-graphs/', import.meta.url)
const read = name => JSON.parse(readFileSync(new URL(name, DIR), 'utf8'))
const BOTS = read('bots.json').map(b => b.name)
const NAMES = readdirSync(DIR).filter(n => /^C\d\.(main|cheap)\.json$/.test(n)).map(n => n.slice(0, -5)).sort()
const graph = name => read(`${name}.json`).parsed
const CTX = { bots: BOTS, boards: ['board'] }
const hand = () => {
  let d = newDraft({ board: 'board', phaseName: 'Design' })
  d = addCard(d, 0, BOTS[0])
  d = addCard(d, 0, BOTS[1])
  return d.cards.filter(c => c.kind !== 'guard').reduce((acc, c, i) => patchCard(acc, c.id, { title: `Hand card ${i}`, body: 'by hand' }), { ...d, goal: 'goal' })
}
const GOOD_BODY = 'Scope: the dark theme.\nSteps:\n1. Declare the colour variables.\nOut of scope: the templates.\nCriteria: AA contrast.\nProof: two screenshots.'
const cardOf = (ref, phase, who, parents = []) => ({ ref, phase, title: `Card ${ref}`, who, parents, body: GOOD_BODY })
const SMALL = { phases: ['Design', 'Build'], cards: [cardOf('c1', 0, BOTS[0]), cardOf('c2', 0, BOTS[1], ['c1']), cardOf('c3', 1, BOTS[0], ['c2'])] }
const flat = (n, phases = 1) => ({ phases: Array.from({ length: phases }, (_, k) => `P${k}`), cards: Array.from({ length: n }, (_, i) => cardOf(`f${i}`, Math.min(phases - 1, i % phases), BOTS[0])) })
const T = (lang, key, ...args) => translate(messages, lang, key, args)
const LANGS = ['en', 'fr', 'es']

/* ---------- the six real graphs, through the page's pipeline ---------- */
for (const name of NAMES) {
  test(`real graph ${name}: summary, plan (replace), draft with no draftIssues, every card marked, then read`, () => {
    const g = graph(name)
    const sum = proposalSummary(g)
    assert.deepEqual(sum, { cards: g.cards.length, phases: g.phases.length, bots: new Set(g.cards.map(c => c.who)).size })
    const plan = planApply(hand(), g, 'replace', CTX)
    assert.equal(plan.ok, true, JSON.stringify(plan.errors))
    assert.equal(plan.mode, 'replace')
    assert.equal(plan.removed, 2, 'the two hand cards would go')
    assert.equal(plan.added, g.cards.length)
    const { draft, marks } = plan.result
    assert.deepEqual(draftIssues(draft, CTX), [], 'the editor\'s own validators say nothing')
    assert.equal(workCards(draft).length, g.cards.length)
    // every card the model wrote is marked, for its four fields
    assert.equal(reviewCount(marks, draft), g.cards.length)
    for (const c of workCards(draft)) assert.deepEqual(markedFields(marks, c), ['title', 'who', 'parents', 'body'])
    // « Mark all as read » is an explicit gesture: it empties the marks, and only it
    assert.equal(reviewCount(emptyMarks(), draft), 0)
  })
}

test('the draft the user held before is untouched by a plan (the plan is a dry run)', () => {
  const d = hand()
  const before = JSON.stringify(d)
  planApply(d, SMALL, 'replace', CTX)
  planApply(d, SMALL, 'append', CTX)
  assert.equal(JSON.stringify(d), before)
})

/* ---------- add / replace, and their limits ---------- */
test('an empty draft is always « replace »: there is nothing to add to', () => {
  const empty = newDraft({ board: 'board' })
  const p = planApply(empty, SMALL, 'append', CTX)
  assert.equal(p.mode, 'replace')
  assert.equal(p.removed, 0)
  assert.equal(p.ok, true)
})

test('append keeps the hand cards, adds the model\'s after them, and only the new ones are marked', () => {
  const d = hand()
  const p = planApply(d, SMALL, 'append', CTX)
  assert.equal(p.ok, true, JSON.stringify(p.errors))
  assert.equal(p.mode, 'append')
  assert.equal(p.removed, 0)
  assert.equal(p.added, 3)
  const next = p.result.draft
  assert.equal(workCards(next).length, 5)
  for (const c of workCards(d)) assert.ok(next.cards.some(x => x.id === c.id && x.title === c.title), 'the hand card stays')
  const marks = mergeMarks(emptyMarks(), p.result.marks, next)
  const ids = reviewIds(marks, next)
  assert.equal(ids.size, 3)
  for (const c of workCards(d)) assert.equal(ids.has(c.id), false)
  assert.deepEqual(draftIssues(next, CTX), [])
})

test('a second proposal appended keeps the marks of the first one still unread (and the first one\'s read marks stay lifted)', () => {
  const first = planApply(hand(), SMALL, 'replace', CTX).result
  const [c1, c2] = workCards(first.draft)
  const read = validateMarks(first.marks, c1.id)   // the user read card 1
  const second = planApply(first.draft, { phases: ['More'], cards: [cardOf('m1', 0, BOTS[1])] }, 'append', CTX).result
  const marks = mergeMarks(read, second.marks, second.draft)
  const ids = reviewIds(marks, second.draft)
  assert.equal(ids.has(c1.id), false, 'read stays read')
  assert.equal(ids.has(c2.id), true, 'unread stays unread')
  assert.equal(ids.size, 3, 'two of the first graph, one of the second')
})

test('append past 40 cards is refused, the draft is exactly what it was', () => {
  let d = hand()
  const big = flat(MAX_WORK_CARDS - 1)   // 2 + 39 = 41
  const p = planApply(d, big, 'append', CTX)
  assert.equal(p.ok, false)
  assert.deepEqual(p.errors, ['too_many_cards'])
  assert.equal(p.result.draft, d, 'the very same object: nothing was built')
  // « replace » of the same graph is fine: it holds 39 cards
  const r = planApply(d, big, 'replace', CTX)
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(workCards(r.result.draft).length, 39)
  d = null
})

test('append past 8 phases is refused, the draft is exactly what it was', () => {
  let d = hand()
  for (let k = 0; k < 6; k++) d = addPhase(d, `Extra ${k}`)   // 1 + 6 = 7 phases
  const p = planApply(d, { phases: ['A', 'B'], cards: [cardOf('a', 0, BOTS[0]), cardOf('b', 1, BOTS[1], ['a'])] }, 'append', CTX)
  assert.equal(p.ok, false)
  assert.deepEqual(p.errors, ['too_many_phases'])
  assert.equal(p.result.draft, d)
  assert.equal(MAX_PHASES, 8)
})

test('exactly 40 cards by appending is allowed (the limit is 40, not 39)', () => {
  const p = planApply(hand(), flat(MAX_WORK_CARDS - 2), 'append', CTX)
  assert.equal(p.ok, true, JSON.stringify(p.errors))
  assert.equal(workCards(p.result.draft).length, MAX_WORK_CARDS)
})

test('a graph the validators refuse never enters: every refusal leaves the draft, and says why', () => {
  const d = hand()
  const bad = [
    [{ ...SMALL, cards: SMALL.cards.map((c, i) => (i === 0 ? { ...c, parents: ['c3'] } : c)) }, 'parent_later'],
    [{ ...SMALL, cards: SMALL.cards.map((c, i) => (i === 1 ? { ...c, who: 'nobody-here' } : c)) }, 'who_unknown'],
    [{ ...SMALL, cards: SMALL.cards.map((c, i) => (i === 2 ? { ...c, body: 'see https://evil.example/x' } : c)) }, 'body'],
    [{ ...SMALL, phases: ['Design', 'Design'] }, 'phase_twice'],
    [{ phases: ['Only'], cards: [] }, 'cards_count'],
    [{ ...SMALL, extra: 1 }, 'shape']
  ]
  for (const [fiche, code] of bad) {
    for (const mode of ['replace', 'append']) {
      const p = planApply(d, fiche, mode, CTX)
      assert.equal(p.ok, false, `${code} ${mode}`)
      assert.ok(p.errors.includes(code), `${code} ${mode}: ${p.errors}`)
      assert.equal(p.result.draft, d, `${code} ${mode}: the draft is the same object`)
      const r = cgRefusalOf({ errors: p.errors })
      assert.equal(r.key, `llm.cg.err.${code}`)
      assert.ok(r.calls >= 1, 'the call was paid')
    }
  }
})

/* ---------- the marks « to review » ---------- */
test('a mark lasts while the field holds what the model wrote: an edit lifts it, the others stay', () => {
  const p = planApply(hand(), SMALL, 'replace', CTX)
  let { draft } = p.result
  const [c1, c2] = workCards(draft)
  assert.deepEqual(markedFields(p.result.marks, c1), ['title', 'who', 'parents', 'body'])
  draft = patchCard(draft, c1.id, { title: 'My own title' })
  const now = workCards(draft)[0]
  assert.deepEqual(markedFields(p.result.marks, now), ['who', 'parents', 'body'])
  assert.deepEqual(markedFields(p.result.marks, workCards(draft)[1]), ['title', 'who', 'parents', 'body'], 'another card keeps all four')
  // an edit that goes back to the model's text brings the mark back: the mark is about the VALUE (documented in llmCampaign.js)
  assert.equal(c2.id !== c1.id, true)
})

test('validating a field or a whole card lifts exactly that', () => {
  const p = planApply(hand(), SMALL, 'replace', CTX)
  const { draft, marks } = p.result
  const [c1, c2] = workCards(draft)
  const one = validateMarks(marks, c1.id, 'body')
  assert.deepEqual(markedFields(one, c1), ['title', 'who', 'parents'])
  const card = validateMarks(marks, c1.id)
  assert.deepEqual(markedFields(card, c1), [])
  assert.deepEqual(markedFields(card, c2), ['title', 'who', 'parents', 'body'])
  assert.equal(reviewCount(card, draft), 2)
})

test('a card removed leaves the count: the mark goes with it', () => {
  const p = planApply(hand(), SMALL, 'replace', CTX)
  const { draft, marks } = p.result
  const gone = removeCard(draft, workCards(draft)[0].id)
  assert.equal(reviewCount(marks, gone), 2)
})

/* ---------- « Rewrite the instructions » ---------- */
test('cardbody: unchanged = the model\'s text with its mark; edited = the user\'s own text, no mark on the body', () => {
  const p = planApply(hand(), SMALL, 'replace', CTX)
  let { draft, marks } = p.result
  const c = workCards(draft)[1]
  const fiche = { body: `${GOOD_BODY}\nExtra line.` }
  const dry = applyCardbody(draft, c.id, fiche, marks)
  assert.equal(dry.ok, true)
  assert.equal(draft.cards.find(x => x.id === c.id).body, GOOD_BODY, 'the dry run changed nothing')
  // as proposed
  const as = applyBodyText(draft, c.id, fiche.body, fiche.body, marks)
  assert.equal(as.ok, true)
  assert.equal(as.draft.cards.find(x => x.id === c.id).body, fiche.body)
  assert.ok(markedFields(as.marks, as.draft.cards.find(x => x.id === c.id)).includes('body'))
  // edited by the user in « After »: their text goes in, it is theirs (no mark on the body), the other fields keep theirs
  const mine = 'Scope: my words.\nProof: a link in the PR.'
  const ed = applyBodyText(draft, c.id, mine, fiche.body, marks)
  assert.equal(ed.ok, true)
  const after = ed.draft.cards.find(x => x.id === c.id)
  assert.equal(after.body, mine)
  assert.deepEqual(markedFields(ed.marks, after), ['title', 'who', 'parents'])
  // only the body of that one card changed
  for (const x of draft.cards) if (x.id !== c.id) assert.deepEqual(ed.draft.cards.find(y => y.id === x.id), x)
  assert.deepEqual({ ...after, body: '' }, { ...draft.cards.find(x => x.id === c.id), body: '' })
})

test('cardbody: a text that breaks a rule, or a card that is gone, leaves the draft as it was', () => {
  const p = planApply(hand(), SMALL, 'replace', CTX)
  const { draft, marks } = p.result
  const c = workCards(draft)[0]
  const cases = [['   ', 'blank'], ['x'.repeat(MAX_BODY + 1), 'long'], ['bad\u0007text', 'chars']]
  for (const [text, code] of cases) {
    const r = applyBodyText(draft, c.id, text, 'whatever the model wrote', marks)
    assert.equal(r.ok, false, code)
    assert.equal(r.refused, code)
    assert.equal(r.draft, draft)
    assert.equal(bodyApplicable(draft, c.id, text), false)
  }
  assert.equal(applyBodyText(draft, 'k999', 'text', 'text', marks).refused, 'card_gone')
  assert.equal(applyBodyText(draft, HEAD, 'text', 'text', marks).refused, 'card_gone', 'a guard has no instructions')
  assert.equal(bodyApplicable(draft, c.id, c.body), false, 'the same text is nothing to apply')
  assert.equal(bodyApplicable(draft, c.id, 'something else'), true)
  // a fiche of the model that is not a clean body is refused whole by the dry run
  assert.equal(applyCardbody(draft, c.id, { body: 'see http://evil.example' }, marks).ok, false)
  assert.equal(applyCardbody(draft, c.id, { body: 'ok', extra: 1 }, marks).ok, false)
})

/* ---------- the review before launch ---------- */
const FINDINGS = [
  { ref: 'X', kind: 'vague', severity: 'low', text: 'Too vague.' },
  { ref: 'X', kind: 'no_review', severity: 'high', text: 'No review before the end.' },
  { ref: 'Y', kind: 'wrong_bot', severity: 'medium', text: 'Wrong bot for this.' }
]
const reviewed = () => {
  const d = planApply(hand(), SMALL, 'replace', CTX).result.draft
  const [a, b] = workCards(d)
  const kept = keepLint(d, { findings: FINDINGS.map(f => ({ ...f, ref: f.ref === 'X' ? a.id : b.id })) }, { truncated: 1, dropped: 2, model: 'light-model', seconds: 11, costUsd: 0.002 })
  return { d, a, b, kept }
}

test('lint: remarks sorted by gravity, attached to the cards of the draft by their code, counters carried', () => {
  const { d, a, b, kept } = reviewed()
  assert.deepEqual(kept.findings.map(f => f.severity), ['high', 'medium', 'low'])
  const { view, cleared } = lintShown(kept, d)
  assert.equal(cleared, false)
  const code = codes(d)
  assert.deepEqual(view.findings.map(f => f.code), [code[a.id], code[b.id], code[a.id]])
  assert.equal(view.truncated, 1)
  assert.equal(view.dropped, 2)
  assert.equal(view.set_aside, 0)
  assert.equal(view.model, 'light-model')
})

test('lint: a remark about a card the draft does not hold is not kept; more than 8 lines refuses the whole review', () => {
  const d = planApply(hand(), SMALL, 'replace', CTX).result.draft
  const a = workCards(d)[0]
  const kept = keepLint(d, { findings: [{ ref: 'zz9', kind: 'vague', severity: 'high', text: 'Ghost.' }, { ref: a.id, kind: 'vague', severity: 'low', text: 'Real.' }] })
  assert.deepEqual(kept.findings.map(f => f.text), ['Real.'])
  assert.equal(kept.dropped, 1)
  const nine = { findings: Array.from({ length: 9 }, (_, i) => ({ ref: a.id, kind: 'other', severity: 'low', text: `Remark ${i}.` })) }
  assert.equal(keepLint(d, nine), null)
  assert.equal(keepLint(d, { findings: 'nope' }), null)
  assert.equal(keepLint(d, { findings: [], extra: 1 }), null)
  assert.deepEqual(keepLint(d, { findings: [] }).findings, [], 'an empty review is a valid review')
})

test('lint: a remark whose card disappeared is set aside at display time (not shown, counted)', () => {
  const { d, a, kept } = reviewed()
  // the signature still matches (nothing the review reads changed), but a remark names a card that is no longer there: it is set aside
  const forged = { ...kept, findings: [...kept.findings, { ref: 'k404', kind: 'order', severity: 'high', text: 'Gone.' }] }
  const { view } = lintShown(forged, d)
  assert.equal(view.findings.some(f => f.ref === 'k404'), false)
  assert.equal(view.set_aside, 1)
  assert.ok(view.findings.some(f => f.ref === a.id))
})

test('lint: the remarks are CLEARED when anything the review reads changes — and only then', () => {
  const { d, a, b, kept } = reviewed()
  const sigs = new Set([lintSignature(d)])
  const changes = {
    title: patchCard(d, a.id, { title: 'Other' }),
    body: patchCard(d, a.id, { body: `${a.body} +` }),
    bot: patchCard(d, a.id, { who: BOTS[2] }),
    model: patchCard(d, a.id, { model: 'some/model', provider: 'prov' }),
    deps: patchCard(d, b.id, { parents: [] }),
    removed: removeCard(d, a.id),
    added: addCard(d, 0, BOTS[0]),
    phase: { ...d, phases: d.phases.map((p, i) => (i === 0 ? { name: `${p.name}!` } : p)) }
  }
  for (const [what, next] of Object.entries(changes)) {
    assert.equal(lintShown(kept, next).cleared, true, `${what} clears the remarks`)
    assert.equal(lintShown(kept, next).view, null, what)
    sigs.add(lintSignature(next))
  }
  assert.equal(sigs.size, 1 + Object.keys(changes).length, 'each change is a different signature')
  // what the review does not read changes nothing
  const quiet = [{ ...d, sel: a.id }, { ...d, goal: 'another goal' }, { ...d, board: 'elsewhere' }, patchCard(d, a.id, { maxRuntime: 3600 }), patchCard(d, a.id, { workspace: 'dir' })]
  for (const next of quiet) assert.equal(lintShown(kept, next).cleared, false)
  assert.equal(lintShown(null, d).cleared, false, 'nothing kept, nothing to clear')
})

test('lint never blocks: the draft\'s issues are the same with or without remarks (a remark is advice)', () => {
  const { d } = reviewed()
  const issues = draftIssues({ ...d, goal: 'goal' }, CTX)
  assert.deepEqual(issues, [])
  const view = lintView({ findings: [{ ref: workCards(d)[0].id, kind: 'order', severity: 'high', text: 'Serious.' }] }, d)
  assert.equal(view.ok, true)
  assert.deepEqual(draftIssues({ ...d, goal: 'goal' }, CTX), issues, 'the validators never read a remark')
})

test('pricesOf: the prices the editor reads out of `model.options`, first one wins, none for an unpriced model', () => {
  const p = pricesOf([{ models: [{ id: 'a', price: { input: '$1', output: '$2', free: false } }, { id: 'b', price: null }] }, { models: [{ id: 'a', price: { input: '$9', output: '$9', free: false } }] }])
  assert.deepEqual({ ...p }, { a: { input: '$1', output: '$2', free: false } })
  assert.deepEqual({ ...pricesOf(null) }, {})
})

/* ---------- refusals in plain words ---------- */
test('every refusal code the page can give is translated, in the three languages, for graph, instructions and calls', () => {
  const all = Object.fromEntries(LANGS.map(l => [l, new Map(leaves(messages[l]))]))
  for (const l of LANGS) {
    for (const code of CG_ERRORS) assert.ok(all[l].has(`llm.cg.err.${code}`), `${l} misses llm.cg.err.${code}`)
    for (const code of BODY_ERRORS) assert.ok(all[l].has(`llm.body.err.${code}`), `${l} misses llm.body.err.${code}`)
    for (const code of [...REASONS, 'expired']) assert.ok(all[l].has(`llm.ref.${code}`), `${l} misses llm.ref.${code}`)
  }
  // and every code of campaignFicheErrors / applyCampaign is one of CG_ERRORS (nothing falls into « other » by oversight)
  const emitted = new Set()
  for (const f of [{ phases: [], cards: [] }, { phases: ['a', 'a'], cards: [cardOf('G1', 0, 'zzz'), cardOf('G1', 5, BOTS[0], ['G1', 'nope'])] }, ...[SMALL]]) {
    for (const mode of ['replace', 'append']) planApply(hand(), f, mode, CTX).errors.forEach(e => emitted.add(e))
  }
  for (const e of emitted) assert.ok(CG_ERRORS.includes(e), `${e} is not listed in CG_ERRORS`)
})

test('refusals: a graph the validators refused says its first code; a failed call says its reason; the guards say « nothing was counted »', () => {
  assert.equal(cgRefusalOf({ errors: ['parent_later', 'loop'] }).key, 'llm.cg.err.parent_later')
  assert.equal(cgRefusalOf({ errors: ['graph:cycle'] }).key, 'llm.cg.err.graph')
  assert.equal(cgRefusalOf({ errors: ['something_new'] }).key, 'llm.cg.err.other')
  assert.equal(cgRefusalOf({ errors: ['loop'], answer: { retried: true } }).calls, 2)
  const cap = cgRefusalOf({ answer: { reason: 'cap_reached', cap: 'usd' } })
  assert.equal(cap.key, 'llm.ref.cap_reached')
  assert.equal(cap.calls, 0)
  assert.equal(cap.action, 'settings')
  const timeout = cgRefusalOf({ answer: { reason: 'timeout' } })
  assert.equal(timeout.key, 'llm.ref.timeout')
  assert.equal(timeout.calls, 1)
  assert.equal(cgRefusalOf({ answer: { reason: 'invalid_output', retried: true } }).calls, 2)
  assert.equal(cgRefusalOf({ answer: { reason: 'weird' } }).key, 'llm.ref.model_error')
  for (const l of LANGS) assert.match(T(l, cgRefusalOf({ errors: ['parent_later'] }).key), /\S{8}/)
})

/* ---------- i18n: every key the window reads exists, in the three languages ---------- */
const src = p => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8')
const SOURCES = ['ui/CampaignAssist.jsx', 'ui/CampaignDialog.jsx', 'ui/CampaignGraph.jsx']

test('every static key read by the assisted window is in en, fr and es, with the same kind', () => {
  const en = new Map(leaves(messages.en))
  const used = new Set()
  for (const f of SOURCES) for (const m of src(f).matchAll(/\bt\(\s*'((?:llm|campaign)\.[A-Za-z0-9_.]+)'/g)) used.add(m[1])
  for (const m of src('ui/CampaignAssist.jsx').matchAll(/say\('([A-Za-z]+)'/g)) used.add(`llm.live.${m[1]}`)
  for (const m of src('ui/CampaignAssist.jsx').matchAll(/key: '(llm\.[a-z.]+\.[A-Za-z_]+)'/g)) used.add(m[1])
  assert.ok(used.size > 60, `read ${used.size} keys`)
  for (const k of used) {
    assert.ok(en.has(k), `en misses ${k}`)
    for (const l of ['fr', 'es']) assert.equal(new Map(leaves(messages[l])).get(k), en.get(k), `${l}.${k}`)
  }
  // dynamic families: severities, kinds
  for (const l of LANGS) {
    const m = new Map(leaves(messages[l]))
    for (const s of ['high', 'medium', 'low']) assert.ok(m.has(`llm.lint.sev.${s}`))
    for (const k of ['no_review', 'wrong_bot', 'vague', 'conflict', 'model', 'order', 'other']) assert.ok(m.has(`llm.lint.kind.${k}`))
  }
})

test('the three languages say the same things in their own words (no key left in English)', () => {
  for (const l of ['fr', 'es']) {
    const m = new Map(leaves(messages[l]))
    const en = messages.en.llm
    const mine = messages[l].llm
    for (const group of ['cg', 'body', 'lint', 'live', 'cgmark', 'tip']) {
      for (const [k, v] of Object.entries(en[group])) {
        if (typeof v === 'string' && /[a-z]{4,} [a-z]{3,} [a-z]{3,}/.test(v) && !['sends', 'returns', 'cost'].includes(k)) assert.notEqual(mine[group][k], v, `${l}.llm.${group}.${k} is still the English text`)
      }
    }
    assert.ok(m.size > 0)
  }
  assert.match(T('fr', 'llm.cg.readyHead'), /graphe est prêt/)
  assert.match(T('es', 'llm.cg.readyHead'), /grafo listo/)
  assert.equal(T('en', 'llm.cg.applyReplace', 3, 13), 'Replace 3 cards with 13')
  assert.equal(T('fr', 'llm.cg.applyReplace', 3, 13), 'Remplacer 3 cartes par 13')
  assert.equal(T('es', 'llm.cg.applyAppend', 13), 'Añadir 13 tarjetas')
})

/* ---------- off = absent ---------- */
test('each function is drawn only when it is ready: the three buttons and the panels sit behind `A.ready.<function>`', () => {
  const dlg = src('ui/CampaignDialog.jsx')
  assert.match(dlg, /A\.ready\.campaign \? <button[^>]*data-cg="lm-open"/)
  assert.match(dlg, /A\.ready\.campaign && A\.cg\.open \? <GraphPanel/)
  // off = the DOM of before: no wrapper around the lone « Models » button (measured: same HTML, same rectangles, 480 elements)
  assert.match(dlg, /const TplBar = \(\{ on, children \}\) => \(on \? <span className="oc-lm-tb">\{children\}<\/span> : <Fragment>\{children\}<\/Fragment>\)/)
  assert.match(dlg, /<TplBar on=\{A\.ready\.campaign\}>/)
  // the live line is visually hidden with the shared class (a clipped 1px text of another class would overlap the stepper)
  assert.match(src('ui/CampaignAssist.jsx'), /className="ux-vh" role="status" aria-live="polite" data-lm-announce/)
  assert.match(dlg, /A\?\.ready\.cardbody \? <BodyAsk/)
  assert.match(dlg, /A\?\.ready\.cardbody && A\.body\.card === c\.id && A\.body\.phase === 'review' \? <BodyProposal/)
  assert.match(dlg, /A\.ready\.lint \? <LintPanel/)
  // the editor reads the cache of GET /llm that the page holds: no read of its own, no extra `model.options` read when the review is off
  assert.match(dlg, /useLlm\(\{ enabled: false \}\)/)
  assert.match(dlg, /useModelOptions\(open && \(win\.step === 'compose' \|\| \(lintOn && win\.step === 'review'\)\)\)/)
  const assist = src('ui/CampaignAssist.jsx')
  assert.match(assist, /const ready = \{ campaign: workReady\(state, 'campaign'\), cardbody: workReady\(state, 'cardbody'\), lint: workReady\(state, 'lint'\) \}/)
  // a window that opens refreshes GET /llm only for the function that is on
  assert.match(assist, /if \(open && ready\.campaign\) actions\.refresh\(\)/)
  assert.ok(LLM_WORK.includes('campaign') && LLM_WORK.includes('cardbody') && LLM_WORK.includes('lint'))
})

test('the three calls are the only places the model is asked, each on its own click (never by an effect)', () => {
  const assist = src('ui/CampaignAssist.jsx')
  for (const call of ['calls.campaign(', 'calls.cardbody(', 'calls.lint(']) assert.equal(assist.split(call).length - 1, 1, `${call} is called once`)
  // none of the three sits in an effect: they are in `askCg`, `askBody`, `askLint`
  for (const [fn, call] of [['askCg', 'calls.campaign('], ['askBody', 'calls.cardbody('], ['askLint', 'calls.lint(']]) {
    const at = assist.indexOf(`const ${fn} = async`)
    assert.ok(at > 0 && assist.indexOf(call) > at, `${call} is inside ${fn}`)
  }
  // and what is read at the agent half when a window reopens is free: `readDraft` (GET), never a call
  assert.match(assist, /actions\.readDraft\('campaign', offer\.id\)/)
  // the model fills a draft: the window never touches the order that creates (`requestCampaign`) nor launches
  assert.equal(/requestCampaign|requestGuard|orders\./.test(assist), false)
})

test('the new modules import only what the bundle may (the check of the repository enforces the rest)', () => {
  const core = src('core/llmCampaignUi.js')
  assert.equal(/@hermes\/plugin-sdk|from 'react'/.test(core), false, 'pure: no SDK, no React')
  assert.equal(/Date\.now|Math\.random|document\.|window\./.test(core), false, 'pure: no clock, no DOM')
})

test('the proposal read from the wire is the closed shape or nothing (the summary of a bad fiche is null)', () => {
  assert.equal(proposalSummary({ phases: ['a'] }), null)
  assert.equal(proposalSummary(null), null)
  assert.ok(readCampaignFiche(SMALL))
  assert.equal(applyCampaign(hand(), { phases: ['a'], cards: 'x' }, { mode: 'replace', bots: BOTS }).ok, false)
})

/* ---------- the costs the window shows ---------- */
test('every cost the window shows carries its currency (a bare « 0,0054 » said nothing)', () => {
  const assist = src('ui/CampaignAssist.jsx')
  const shown = [...assist.matchAll(/formatUsd\(/g)].length
  assert.ok(shown >= 2, 'the proposal and the review show a cost')
  assert.equal([...assist.matchAll(/t\('llm\.cg\.usd', formatUsd\(/g)].length, shown, 'each formatted amount goes through llm.cg.usd')
  for (const l of LANGS) assert.equal(T(l, 'llm.cg.usd', '0,0054'), '0,0054\u00a0$')   // no-break, the amount never leaves its unit on the next line
})

test('« Ignore » and « Apply to <card> » of rewritten instructions stay together (the primary button wrapped alone on a line at 1440 px)', () => {
  const assist = src('ui/CampaignAssist.jsx')
  assert.match(assist, /<span className="oc-lm-btns">\s*<button[^>]*data-lm-body-ignore[^>]*>[^\n]*\n\s*<button[^>]*data-lm-body-apply/)
  assert.match(src('ui/campaignStyles.js'), /\.oc-lm-bd \.oc-lm-btns\{display:flex;gap:8px;margin-left:auto\}/)
})

test('review: counts of one read in the singular (live line, set-aside and cut remarks, cards applied)', () => {
  const plural = { en: /remarks|cards/, fr: /remarques|cartes/, es: /observaciones|tarjetas/ }
  for (const l of ['en', 'fr', 'es']) {
    for (const k of ['llm.live.lintDone', 'llm.lint.dropped', 'llm.lint.truncated', 'llm.live.cgApplied']) {
      const one = T(l, k, 1)
      assert.ok(one.includes('1') && !plural[l].test(one), `${l}.${k}(1) = ${one}`)
      assert.match(T(l, k, 3), plural[l], `${l}.${k}(3)`)
    }
  }
})

test('review: a remark that names cards by the ref the model was sent reads with the codes the graph shows (seen live: « k5 (design) and k4 (QA) »)', () => {
  const d = planApply(hand(), SMALL, 'replace', CTX).result.draft
  const [a, b] = workCards(d)
  const code = codes(d)
  const kept = keepLint(d, { findings: [{ ref: a.id, kind: 'conflict', severity: 'low', text: `${a.id} (design) and ${b.id} run in parallel; ${a.id}x and x${b.id} are not refs.` }] })
  const { view } = lintShown(kept, d)
  assert.equal(view.findings[0].text, `${code[a.id]} (design) and ${code[b.id]} run in parallel; ${a.id}x and x${b.id} are not refs.`)
  assert.equal(view.findings[0].ref, a.id)
})
}

// ===== llm-campaign =====
{
/* A campaign the model drafted, the instructions of a card and the review before launch, as the page reads them (src/core/llmCampaign.js,
   src/core/llmReview.js, src/data/llmCampaign.js). Pure functions, and the calls against a stand-in for the REST door: no model, no Hermes.
   The six graphs kept as fixtures (the shape of real model answers, invented content) go through the conversion into the editor's draft with no draftIssues; the request that comes out is
   the one tests/python/test_llm_campaign.py hands to CampaignIn + plan_graph (same files, copied under tests/js/fixtures/llm-campaign-graphs). */
const DIR = new URL('./fixtures/llm-campaign-graphs/', import.meta.url)
const read = name => JSON.parse(readFileSync(new URL(name, DIR), 'utf8'))
const BOTS = read('bots.json').map(b => b.name)
const NAMES = readdirSync(DIR).filter(n => /^C\d\.(main|cheap)\.json$/.test(n)).map(n => n.slice(0, -5)).sort()
const graph = name => read(`${name}.json`).parsed
const GOOD_BODY = 'Scope: the dark theme.\nSteps:\n1. Declare the colour variables.\nOut of scope: the page templates.\nCriteria: AA contrast.\nProof: two screenshots.'
const card = (ref, phase, who, parents = [], title = `Card ${ref}`, body = GOOD_BODY) => ({ ref, phase, title, who, parents, body })
const GOOD = { phases: ['Design', 'Build'], cards: [card('c1', 0, BOTS[0]), card('c2', 0, BOTS[1], ['c1']), card('c3', 1, BOTS[0], ['c2']), card('c4', 1, BOTS[1], ['c3'])] }
const withCard = (i, over) => ({ ...GOOD, cards: GOOD.cards.map((c, k) => (k === i ? { ...c, ...over } : c)) })
const fresh = () => newDraft({ board: 'board' })
const apply = (f, o = {}, d = fresh()) => applyCampaign(d, f, { bots: BOTS, ...o })

/* ---------- the six real graphs ---------- */
test('the six real graphs of the trial are there', () => {
  assert.deepEqual(NAMES, ['C1.cheap', 'C1.main', 'C2.cheap', 'C2.main', 'C3.cheap', 'C3.main'])
})

for (const name of NAMES) {
  test(`real graph ${name}: no fiche error, a draft with no draftIssues, and the request that comes out is the page's own`, () => {
    const g = graph(name)
    assert.deepEqual(campaignFicheErrors(readCampaignFiche(g), BOTS), [])
    const out = apply(g)
    assert.equal(out.ok, true, JSON.stringify(out.errors))
    assert.deepEqual(draftIssues({ ...out.draft, goal: 'trial' }, { bots: BOTS, boards: ['board'] }), [], 'a draft with no draftIssues')
    assert.equal(workCards(out.draft).length, g.cards.length)
    assert.deepEqual(out.draft.phases.map(p => p.name), g.phases)
    // the request the page sends for it is the fixture the python side judges with CampaignIn + plan_graph
    const request = toRequest({ ...out.draft, goal: 'trial' }, '11111111-1111-4111-8111-111111111111')
    assert.equal(validateRequest(request), null)
    const saved = read(`${name}.request.json`)
    assert.deepEqual(request.phases, saved.phases)
    // the ids of the editor are k<n>, the fixture keeps the model's refs: map them back and compare EVERY card, parents included (a count of
    // parents would let a wrong parent through)
    const byId = workCards(out.draft).map(c => c.id).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))   // ids are given in the fiche's order
    const back = new Map(byId.map((id, i) => [id, g.cards[i].ref]))
    const refOf = id => back.get(id) ?? id
    const exact = r => r.cards.map(c => ({ ...c, ref: refOf(c.ref), parents: c.parents.map(refOf) }))
    assert.deepEqual(exact(request), saved.cards, 'guards, parents and order: what the python port of `effective` sends')
  })
}

/* ---------- the fiche: shape, then the rules ---------- */
test('the fiche shape is closed', () => {
  assert.ok(readCampaignFiche(GOOD))
  for (const bad of [null, [], 'x', {}, { ...GOOD, extra: 1 }, { phases: GOOD.phases }, { phases: 'A', cards: [] }, { phases: [1], cards: [] },
    { ...GOOD, cards: [{ ...GOOD.cards[0], extra: 1 }] }, { ...GOOD, cards: [{ ...GOOD.cards[0], phase: 0.5 }] }, { ...GOOD, cards: [{ ...GOOD.cards[0], parents: 'c2' }] },
    { ...GOOD, cards: [{ ...GOOD.cards[0], parents: [1] }] }, { ...GOOD, cards: ['c1'] }]) assert.equal(readCampaignFiche(bad), null, JSON.stringify(bad))
})

const n = (count, phase = 0) => Array.from({ length: count }, (_, i) => card(`a${i}`, phase, BOTS[0], [], `Card ${i}`))
const FAULTS = {
  unknown_bot: [withCard(0, { who: 'ghost' }), 'who_unknown'],
  unknown_parent: [withCard(2, { parents: ['zz'] }), 'parent_unknown'],
  parent_of_a_later_phase: [withCard(0, { parents: ['c3'] }), 'parent_later'],
  its_own_parent: [withCard(0, { parents: ['c1'] }), 'parent_self'],
  a_loop: [{ ...GOOD, cards: [card('c1', 0, BOTS[0], ['c2']), card('c2', 0, BOTS[1], ['c1']), ...GOOD.cards.slice(2)] }, 'loop'],
  duplicate_ref: [withCard(1, { ref: 'c1' }), 'ref_twice'],
  '41_cards': [{ phases: ['All'], cards: n(41) }, 'cards_count'],
  no_card: [{ ...GOOD, cards: [] }, 'cards_count'],
  '9_phases': [{ phases: Array.from({ length: 9 }, (_, i) => `P${i}`), cards: Array.from({ length: 9 }, (_, i) => card(`a${i}`, i, BOTS[0])) }, 'phases_count'],
  no_phase: [{ phases: [], cards: n(1) }, 'phases_count'],
  phase_without_a_card: [{ ...GOOD, phases: ['Design', 'Build', 'Empty'] }, 'phase_empty'],
  same_phase_twice: [{ ...GOOD, phases: ['Design', 'Design'] }, 'phase_twice'],
  phase_out_of_range: [withCard(3, { phase: 2 }), 'phase_range'],
  ref_G1: [withCard(0, { ref: 'G1' }), 'ref'],
  ref_G0: [withCard(0, { ref: 'G0' }), 'ref'],
  ref_digit_first: [withCard(0, { ref: '1a' }), 'ref'],
  ref_17: [withCard(0, { ref: 'a'.repeat(17) }), 'ref'],
  body_8001: [withCard(0, { body: 'x'.repeat(8001) }), 'body'],
  body_empty: [withCard(0, { body: '' }), 'body'],
  title_121: [withCard(0, { title: 't'.repeat(121) }), 'title'],
  title_two_lines: [withCard(0, { title: 'a\nb' }), 'title'],
  phase_name_61: [{ ...GOOD, phases: ['p'.repeat(61), 'Build'] }, 'phase_name'],
  control_in_body: [withCard(0, { body: `${GOOD_BODY}\u0000` }), 'body'],
  bidi_in_title: [withCard(0, { title: 'a\u202eb' }), 'title'],
  link_in_body: [withCard(0, { body: `${GOOD_BODY}\nsee https://evil.example/x` }), 'body'],
  tag_in_body: [withCard(0, { body: `${GOOD_BODY} <script>x()</script>` }), 'body']
}
for (const [name, [fiche, code]] of Object.entries(FAULTS)) {
  test(`a fiche with ${name} is refused whole, the editor stays what it was`, () => {
    const d = Object.freeze(fresh())
    const out = applyCampaign(d, fiche, { bots: BOTS })
    assert.equal(out.ok, false)
    assert.ok(out.errors.includes(code), `${code} in ${JSON.stringify(out.errors)}`)
    assert.equal(out.draft, d, 'the very same draft object')
    assert.deepEqual(out.marks, emptyMarks())
  })
}

test('a fiche within every bound is taken: 40 cards, 8 phases, 8000 characters, refs G-lowercase and 16 long, title 120', () => {
  assert.equal(apply({ phases: ['All'], cards: n(40) }).ok, true)
  assert.equal(apply({ phases: Array.from({ length: 8 }, (_, i) => `P${i}`), cards: Array.from({ length: 8 }, (_, i) => card(`a${i}`, i, BOTS[0])) }).ok, true)
  assert.equal(apply(withCard(0, { body: 'x'.repeat(8000) })).ok, true)
  assert.equal(apply({ phases: ['A'], cards: [card('g1', 0, BOTS[0])] }).ok, true)
  assert.equal(apply({ phases: ['A'], cards: [card('A'.repeat(16), 0, BOTS[0])] }).ok, true)
  assert.equal(apply(withCard(0, { title: 't'.repeat(120) })).ok, true)
  assert.ok(CARD_REF.test('c1') && CARD_REF.test('G1'), 'G1 has the form of a ref: only the GUARD_REF check refuses it')
})

/* ---------- replace and append, like applyTemplate ---------- */
test('replace: the model phases and cards, fresh ids, the guards in front of their phase, the goal and the board stay', () => {
  const d = { ...fresh(), goal: 'My goal' }
  const out = apply(GOOD, {}, d)
  assert.equal(out.ok, true)
  assert.equal(out.draft.goal, 'My goal')
  assert.equal(out.draft.board, 'board')
  assert.deepEqual(out.draft.cards.map(c => c.id), ['G0', 'k1', 'k2', 'G1', 'k3', 'k4'])
  assert.deepEqual(out.draft.cards.find(c => c.id === 'k2').parents, ['k1'])
  assert.deepEqual(out.draft.cards.find(c => c.id === 'k4').parents, ['k3'])
  assert.equal(out.draft.seq, 4)
  assert.equal(out.draft.cards.find(c => c.id === 'k1').workspace, 'scratch')
})

test('replace drops what the editor had; append keeps it and puts the model phases after, each with its guard', () => {
  const first = apply(GOOD).draft
  const replaced = apply({ phases: ['Only'], cards: [card('z1', 0, BOTS[0])] }, { mode: 'replace' }, first)
  assert.deepEqual(replaced.draft.phases, [{ name: 'Only' }])
  assert.deepEqual(workCards(replaced.draft).map(c => c.id), ['k5'])
  const appended = apply({ phases: ['More'], cards: [card('z1', 0, BOTS[0])] }, { mode: 'append' }, first)
  assert.equal(appended.ok, true)
  assert.deepEqual(appended.draft.phases.map(p => p.name), ['Design', 'Build', 'More'])
  assert.equal(workCards(appended.draft).length, 5)
  assert.ok(appended.draft.cards.some(c => c.id === 'G2' && c.kind === 'guard'))
  assert.equal(validateRequest(toRequest({ ...appended.draft, goal: 'g' }, 'x')), null)
})

test('append past 8 phases or 40 work cards is refused whole', () => {
  const full = apply({ phases: ['All'], cards: n(40) }).draft
  const out = apply({ phases: ['More'], cards: [card('z', 0, BOTS[0])] }, { mode: 'append' }, full)
  assert.deepEqual([out.ok, out.errors], [false, ['too_many_cards']])
  assert.equal(out.draft, full)
  const eight = apply({ phases: Array.from({ length: 8 }, (_, i) => `P${i}`), cards: Array.from({ length: 8 }, (_, i) => card(`a${i}`, i, BOTS[0])) }).draft
  assert.deepEqual(apply({ phases: ['More'], cards: [card('z', 0, BOTS[0])] }, { mode: 'append' }, eight).errors, ['too_many_phases'])
})

test('a bot the roster does not have, with an empty roster the check is skipped', () => {
  assert.equal(applyCampaign(fresh(), withCard(0, { who: 'ghost' }), { bots: [] }).ok, true)
  assert.deepEqual(campaignFicheErrors(readCampaignFiche(withCard(0, { who: 'ghost' })), []), [])
})

/* ---------- the marks ---------- */
test('a field is marked while it holds what the model wrote; an edit lifts the mark, a validation too, a removed card prunes', () => {
  const out = apply(GOOD)
  const d = out.draft
  const k1 = d.cards.find(c => c.id === 'k1')
  assert.deepEqual(markedFields(out.marks, k1), ['title', 'who', 'parents', 'body'])
  assert.ok(isPhaseMarked(out.marks, d, 0) && isPhaseMarked(out.marks, d, 1))
  const edited = patchCard(d, 'k1', { title: 'My own title' })
  assert.deepEqual(markedFields(out.marks, edited.cards.find(c => c.id === 'k1')), ['who', 'parents', 'body'])
  assert.deepEqual(markedFields(validateMarks(out.marks, 'k1'), k1), [])
  assert.deepEqual(markedFields(validateMarks(out.marks, 'k1', 'body'), k1), ['title', 'who', 'parents'])
  const renamed = { ...d, phases: [{ name: 'Mine' }, d.phases[1]] }
  assert.equal(isPhaseMarked(out.marks, renamed, 0), false)
  const gone = pruneMarks(out.marks, { cards: d.cards.filter(c => c.id !== 'k1') })
  assert.ok(!('k1' in gone.cards) && 'k2' in gone.cards)
})

/* ---------- bodies posted ---------- */
test('campaignBody carries the goal and the notes only', () => {
  assert.deepEqual(campaignBody('i', '  goal ', 'notes\nmore', 'fr'), { id: 'i', goal: 'goal', notes: 'notes\nmore', lang: 'fr' })
  assert.equal(campaignBody('i', 'g'.repeat(500), 'n'.repeat(9000), 'xx').goal.length, 120)
  assert.equal(campaignBody('i', 'g', 'n'.repeat(9000), 'xx').notes.length, 4000)
  assert.equal(campaignBody('i', 'g', '', 'xx').lang, 'en')
})

test('cardbodyBody carries the goal and ONE card of the draft, its id as the ref', () => {
  const k = { id: 'k3', title: ' Title ', who: BOTS[0], body: 'b'.repeat(9000), model: 'm', parents: ['k1'], phase: 1 }
  const body = cardbodyBody('i', 'goal', k, 'es')
  assert.deepEqual(Object.keys(body), ['id', 'goal', 'card', 'lang'])
  assert.deepEqual(Object.keys(body.card), ['ref', 'title', 'who', 'body'])
  assert.equal(body.card.ref, 'k3')
  assert.equal(body.card.title, 'Title')
  assert.equal(body.card.body.length, 8000)
})

test('lintBody: the work cards only, bodies cut at 2000, the prices of the pinned models only, no goal', () => {
  const d = apply(GOOD).draft
  const pinned = patchCard(patchCard(d, 'k2', { model: 'model-x', body: 'y'.repeat(5000) }), 'k4', { model: 'model-x' })
  const prices = { 'model-x': { input: '$3', output: '$15', free: false, secret: 'no' }, other: { input: '$1', output: '$2', free: false } }
  const body = lintBody('i', pinned, 'fr', prices)
  assert.deepEqual(Object.keys(body), ['id', 'cards', 'prices', 'lang'])
  assert.deepEqual(body.cards.map(c => c.ref), ['k1', 'k2', 'k3', 'k4'])
  assert.deepEqual(Object.keys(body.cards[0]), ['ref', 'phase', 'title', 'who', 'model', 'parents', 'body'])
  assert.equal(body.cards[1].body.length, LINT_BODY_SENT)
  assert.deepEqual(body.prices, { 'model-x': { input: '$3', output: '$15', free: false } })
  assert.ok(body.cards.every(c => c.parents.every(p => body.cards.some(o => o.ref === p))), 'a guard is never a parent sent')
  assert.equal(lintBody('i', fresh(), 'fr'), null, 'nothing to review')
  assert.deepEqual(lintBody('i', pinned, 'fr', { 'model-x': { input: 'http://x.y', output: '$2', free: 'yes' } }).prices, { 'model-x': { input: '', output: '$2', free: false } })
})

test('the delays the page waits are the agent half delay plus 15 s, and the three functions are listed as useful', () => {
  assert.deepEqual(LLM_WAIT_MS, { campaign: 255_000, cardbody: 75_000, lint: 105_000 })
  for (const f of ['campaign', 'cardbody', 'lint']) assert.ok(LLM_USEFUL.includes(f))
})

/* ---------- cardbody ---------- */
test('applyCardbody rewrites the body of that one card, marks it, and drops a card removed meanwhile', () => {
  const d = apply(GOOD).draft
  const out = applyCardbody(d, 'k2', { body: GOOD_BODY }, emptyMarks())
  assert.equal(out.ok, true)
  assert.equal(out.draft.cards.find(c => c.id === 'k2').body, GOOD_BODY)
  assert.deepEqual(out.draft.cards.filter(c => c.id !== 'k2'), d.cards.filter(c => c.id !== 'k2'), 'no other card changes')
  assert.deepEqual(markedFields(out.marks, out.draft.cards.find(c => c.id === 'k2')), ['body'])
  const gone = applyCardbody(d, 'k99', { body: GOOD_BODY })
  assert.deepEqual([gone.ok, gone.refused, gone.draft], [false, 'card_gone', d])
  assert.equal(applyCardbody(d, 'G1', { body: GOOD_BODY }).refused, 'card_gone', 'a guard has no instructions')
})

for (const bad of [{ body: '' }, { body: '   ' }, { body: 'x'.repeat(8001) }, { body: 'a\u0000b' }, { body: 'a\u202eb' }, { body: `${GOOD_BODY} http://evil.example` },
  { body: `${GOOD_BODY} <b>x</b>` }, { body: 5 }, { text: GOOD_BODY }, { body: GOOD_BODY, extra: 1 }, null, 'body']) {
  test(`a cardbody fiche ${JSON.stringify(bad)?.slice(0, 40)} is refused and the draft stays`, () => {
    const d = apply(GOOD).draft
    const out = applyCardbody(d, 'k1', bad)
    assert.equal(out.ok, false)
    assert.equal(out.draft, d)
    assert.ok(cardbodyErrors(bad && typeof bad === 'object' && Object.keys(bad).join() === 'body' ? bad : null).length)
  })
}

/* ---------- lint ---------- */
const LINES = [
  { ref: 'k3', kind: 'order', severity: 'low', text: 'Missing dependency on k2.' },
  { ref: 'k2', kind: 'model', severity: 'high', text: 'A very costly model for a review.' },
  { ref: 'k1', kind: 'vague', severity: 'medium', text: 'Too thin to act on.' }
]
test('lintView sorts by gravity, keeps the order inside a gravity, drops a bad line alone, an empty list is valid', () => {
  const d = apply(GOOD).draft
  const v = lintView({ findings: LINES }, d)
  assert.deepEqual(v.findings.map(f => f.ref), ['k2', 'k1', 'k3'])
  assert.equal(v.dropped, 0)
  const noisy = lintView({ findings: [...LINES, { ref: 'zz', kind: 'vague', severity: 'low', text: 'x' }, { ref: 'k1', kind: 'typo', severity: 'low', text: 'x' },
    { ref: 'k1', kind: 'vague', severity: 'critical', text: 'x' }, { ref: 'k1', kind: 'vague', severity: 'low', text: 'see https://evil.example' },
    { ref: 'k1', kind: 'vague', severity: 'low', text: 'x'.repeat(201) }] }, d)
  assert.equal(noisy.ok, true)
  assert.equal(noisy.findings.length, 3)
  assert.equal(noisy.dropped, 5)
  assert.deepEqual(lintView({ findings: [] }, d), { ok: true, findings: [], dropped: 0 })
  assert.equal(lintView({ findings: Array(FINDINGS_MAX + 1).fill(LINES[0]) }, d).ok, false)
  for (const bad of [null, [], { findings: 'x' }, { findings: [], extra: 1 }, {}]) assert.equal(lintView(bad, d).ok, false)
  const afterRemoval = lintView({ findings: LINES }, { ...d, cards: d.cards.filter(c => c.id !== 'k2') })
  assert.deepEqual(afterRemoval.findings.map(f => f.ref), ['k1', 'k3'], 'a remark about a card the user removed meanwhile is dropped')
})

test('readLintAnswer keeps the counts the agent half says', () => {
  const a = readLintAnswer({ ok: true, result: 'done', id: 'a', lane: 'light', via: 'task', model: 'm', provider: 'p', retried: false, costUsd: 0.001, costStatus: 'estimated',
    spend: { calls: 1, usd: 0.001 }, fiche: { findings: [] }, truncated: 3, dropped: 1, expired: false })
  assert.ok(a, 'a done review is read')
  assert.deepEqual([a.truncated, a.dropped], [3, 1])
  assert.equal(readLintAnswer(null), null)
})

test('a review read again after its window was closed (GET /llm/draft) keeps the counts; the other drafts keep their shape', () => {
  const kept = { ok: true, feature: 'lint', id: 'a', at: 5, lane: 'light', via: 'task', model: 'm', provider: 'p', target: 'h', fiche: { findings: [] }, truncated: 2, dropped: 1 }
  assert.deepEqual(readDraftRead(kept, 'lint'), { id: 'a', at: 5, target: 'h', fiche: { findings: [] }, truncated: 2, dropped: 1 })
  assert.deepEqual(readDraftRead({ ...kept, truncated: -1, dropped: 'x' }, 'lint'), { id: 'a', at: 5, target: 'h', fiche: { findings: [] }, truncated: 0, dropped: 0 })
  assert.deepEqual(readDraftRead({ ...kept, feature: 'campaign', fiche: { phases: [], cards: [] } }, 'campaign'), { id: 'a', at: 5, target: 'h', fiche: { phases: [], cards: [] } })
})

/* ---------- the same text cases as the agent half ---------- */
const CASES = read('../llm-finding-text-cases.json').cases
test('the remarks the page accepts are the ones the agent half accepts (tests/python/test_llm_campaign.py reads the same cases)', () => {
  for (const c of CASES) {
    const text = c.repeat ? c.text.repeat(c.repeat) : c.text
    assert.equal(findingTextOk(text), c.ok, JSON.stringify(text.slice(0, 60)))
  }
  assert.equal(modelTextOk('ok', 10), true)
})
}
