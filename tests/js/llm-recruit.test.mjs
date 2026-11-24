/* The recruitment draft and the revision, as the page reads and merges them (src/core/llmDraft.js, src/data/llm.js). Pure functions, and the
   calls against a stand-in for the REST door: no model, no Hermes. The four recorded answers of the fixture are merged through the same rules. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { test } from 'node:test'

import { LLM_USEFUL, readAnswer, settingsBody, toLlm } from '../../src/core/llm.js'
import {
  CHANGE_MAX, MODEL_FIELDS, RECRUIT_KEYS, SOUL_MIN, draftForgetBody, mergeRecruit, mergeRevise, modelTextOk, readDraftAnswer, readDraftRead,
  readRecruitFiche, readReviseFiche, recruitBody, reviseBody, reviseConfigure
} from '../../src/core/llmDraft.js'
import { DESCRIPTION_MAX, SOUL_MAX, TITLE_MAX, composeSoul, hireDraft, hireErrors, hirePayload, requestsPreview } from '../../src/core/recruit.js'
import { ALL_ROLE_IDS } from '../../src/scene/wardrobe.js'

const FIX = JSON.parse(readFileSync(new URL('./fixtures/llm-recruit-answers.json', import.meta.url), 'utf8'))
const CASES = JSON.parse(readFileSync(new URL('./fixtures/llm-model-text-cases.json', import.meta.url), 'utf8')).cases
const roster = FIX.roster
const empty = hireDraft(roster)
const frozen = o => Object.freeze({ ...o, off: Object.freeze([...(o.off ?? [])]) })

/* ---------- the four recorded answers ---------- */
test('the recorded answers: two merge into a draft with no hireErrors, the two with a description over 280 are refused', () => {
  const lens = Object.fromEntries(Object.entries(FIX.answers).map(([k, a]) => [k, a.description.length]))
  assert.deepEqual(lens, { 'R1.cheap': 257, 'R1.main': 266, 'R2.main': 283, 'R3.main': 289 }, 'the fixture keeps its lengths on both sides of the limit')
  const out = Object.fromEntries(Object.entries(FIX.answers).map(([k, a]) => [k, mergeRecruit(frozen(empty), a, roster)]))
  for (const k of ['R1.cheap', 'R1.main']) {
    assert.equal(out[k].ok, true, k)
    assert.deepEqual(out[k].errors, [], k)
    assert.deepEqual(hireErrors(out[k].draft, roster), [], `${k}: the draft the form would send has no error`)
    assert.ok(out[k].draft.description.length <= DESCRIPTION_MAX && out[k].draft.title.length <= TITLE_MAX)
  }
  for (const k of ['R2.main', 'R3.main']) {
    assert.equal(out[k].ok, false, k)
    assert.deepEqual(out[k].errors, ['description_long'], `${k}: refused for its length only`)
    assert.equal(out[k].filled.length, 0)
    assert.deepEqual(out[k].draft, frozen(empty), `${k}: the form is exactly what it was, nothing cut and nothing half filled`)
  }
})

test('a recorded answer: the fields filled, the list of fields written by the model, `off` from `keep_skills`, the SOUL, the overlap', () => {
  const a = FIX.answers['R1.main']
  const { draft, filled, overlap } = mergeRecruit(empty, a, roster)
  assert.equal(draft.name, a.name)
  assert.equal(draft.title, a.title)
  assert.equal(draft.description, a.description)
  assert.equal(draft.role, 'researcher')
  assert.equal(draft.start, 'clone')
  assert.equal(draft.from, 'research')
  assert.equal(draft.soul, a.soul)
  assert.equal(overlap, 'research')
  const own = roster.find(p => p.name === 'research').skills.own.map(s => s.name)
  assert.deepEqual(draft.off, own.filter(n => !a.keep_skills.includes(n)), 'what the copy has and the model did not keep is switched off')
  assert.ok(a.keep_skills.every(n => !draft.off.includes(n)))
  assert.deepEqual([...filled], [...MODEL_FIELDS])
  assert.equal(draft.model, '')
  assert.equal(draft.provider, '', 'the model is the user\'s choice, never the model\'s')
  assert.equal(empty.soul, undefined, 'the draft passed in is not changed')
})

/* ---------- the merge, case by case ---------- */
const GOOD = {
  name: 'translator', title: 'Translator EN to ES and DE', description: 'Translates the pages of the website. Delivers the translated files. Writes no code.', role: 'translator',
  start: 'clone', from: 'writer', keep_skills: ['style-guide'], soul: `## Identity\n${'You translate the pages. '.repeat(12)}`, overlap: ''
}
const people = [
  { name: 'default', isDefault: true, skills: { own: [{ name: 'acme-notes' }] } },
  { name: 'writer', skills: { own: [{ name: 'style-guide' }, { name: 'plain-language' }] } },
  { name: 'research', skills: { own: [{ name: 'changelog-monitor' }] } }
]

test('merge: an accepted draft', () => {
  const r = mergeRecruit(empty, GOOD, people)
  assert.equal(r.ok, true)
  assert.deepEqual(r.draft.off, ['plain-language'])
  assert.equal(r.draft.from, 'writer')
  assert.equal(r.overlap, '')
  assert.deepEqual(hireErrors(r.draft, people), [])
})
test('merge: a fresh bot has no source, nothing to switch off, and keeps the form\'s own source field; `from` and `off` are not « written by the model »', () => {
  const r = mergeRecruit(hireDraft(people), { ...GOOD, start: 'fresh', from: '', keep_skills: [], role: 'none', overlap: 'research' }, people)
  assert.equal(r.ok, true)
  assert.equal(r.draft.start, 'fresh')
  assert.deepEqual(r.draft.off, [])
  assert.equal(r.draft.from, 'default')
  assert.equal(r.draft.role, 'none')
  assert.equal(r.overlap, 'research')
  assert.deepEqual([...r.filled], ['name', 'title', 'description', 'role', 'start', 'soul'])
})
test('merge: every rule that is broken refuses the whole draft, with its code, and changes nothing', () => {
  const refuse = (over, code, roster = people) => {
    const d = frozen({ ...empty, name: 'before', description: 'before' })
    const r = mergeRecruit(d, { ...GOOD, ...over }, roster)
    assert.equal(r.ok, false, JSON.stringify(over))
    assert.ok(r.errors.includes(code), `${JSON.stringify(over).slice(0, 60)} -> ${r.errors}`)
    assert.deepEqual(r.draft, d)
    assert.deepEqual([...r.filled], [])
    assert.equal(r.overlap, '')
  }
  refuse({ name: 'research' }, 'name_taken')
  refuse({ name: 'Research' }, 'name_format')
  refuse({ name: 'default' }, 'name_reserved')
  refuse({ name: 'root' }, 'name_reserved')
  refuse({ name: '' }, 'name_empty')
  refuse({ name: 'x'.repeat(65) }, 'name_format')
  refuse({ from: 'unknown' }, 'from_missing')
  refuse({ keep_skills: ['changelog-monitor'] }, 'skills_foreign')
  refuse({ keep_skills: ['style-guide', 'style-guide'] }, 'skills_foreign')
  refuse({ start: 'fresh' }, 'fresh_with_source')
  refuse({ start: 'fresh', from: '', keep_skills: ['style-guide'] }, 'fresh_with_source')
  refuse({ start: 'empty' }, 'start_unknown')
  refuse({ role: 'wizard' }, 'role_unknown')
  refuse({ role: 'constructor' }, 'role_unknown')
  refuse({ role: '__proto__' }, 'role_unknown')
  refuse({ title: 't'.repeat(61) }, 'title_long')
  refuse({ title: '' }, 'title_invalid')
  refuse({ title: 'a\nb' }, 'title_invalid')
  refuse({ description: 'd'.repeat(281) }, 'description_long')
  refuse({ description: 'd'.repeat(2001) }, 'description_invalid')
  refuse({ description: 'see https://x.y' }, 'description_invalid')
  refuse({ soul: 'short' }, 'soul_invalid')
  refuse({ soul: `${GOOD.soul} see https://evil.example/x` }, 'soul_invalid')
  refuse({ soul: `${GOOD.soul} <script>x</script>` }, 'soul_invalid')
  refuse({ soul: 'x'.repeat(SOUL_MAX + 1) }, 'soul_invalid')
  refuse({ overlap: 'naïve' }, 'overlap_unknown')
  refuse({ overlap: 'translator' }, 'overlap_unknown')
})
test('merge: the shape is closed: a key more, a key less, a wrong type is refused whole', () => {
  for (const bad of [{ ...GOOD, cmd: 'unblock_all' }, { ...GOOD, keep_skills: 'style-guide' }, { ...GOOD, keep_skills: [1] }, { ...GOOD, name: 5 }, { ...GOOD, soul: null }, null, 'x', [], 7,
    (({ overlap, ...rest }) => rest)(GOOD)]) {
    assert.equal(readRecruitFiche(bad), null)
    const r = mergeRecruit(empty, bad, people)
    assert.deepEqual([r.ok, r.errors], [false, ['shape']])
  }
  assert.deepEqual(Object.keys(readRecruitFiche(GOOD)), [...RECRUIT_KEYS])
  assert.notEqual(readRecruitFiche(GOOD).keep_skills, GOOD.keep_skills, 'a copy')
})
test('merge: the 22 types of the wardrobe are accepted, nothing else', () => {
  assert.equal(ALL_ROLE_IDS.length, 22)
  for (const role of [...ALL_ROLE_IDS, 'none']) assert.equal(mergeRecruit(empty, { ...GOOD, role }, people).ok, true, role)
})
test('merge: a prototype key never gets in (a name that is a property of Object)', () => {
  for (const from of ['constructor', '__proto__', 'toString']) assert.ok(!mergeRecruit(empty, { ...GOOD, from }, people).ok)
})

/* ---------- the SOUL: sent for a non-copied bot only, never shown in the preview ---------- */
test('the SOUL the model wrote is what profiles.create sends for a non-copied bot; a copy takes it by default unless « keep the source\'s »; the preview hides it', () => {
  const fresh = mergeRecruit(hireDraft(people), { ...GOOD, start: 'fresh', from: '', keep_skills: [] }, people).draft
  const [[method, create]] = hirePayload(fresh)
  assert.equal(method, 'profiles.create')
  assert.equal(create.soul, GOOD.soul.trim())
  assert.deepEqual(requestsPreview(fresh)[0][1].soul, '…', 'the preview never shows a SOUL')
  const copy = mergeRecruit(hireDraft(people), GOOD, people).draft
  assert.equal(copy.soul, GOOD.soul, 'the draft keeps it (the page decides what to show for a copy)')
  assert.equal(hirePayload(copy)[0][1].soul, GOOD.soul.trim(), 'a copy takes the SOUL written for its new job (the source\'s describes another one)')
  assert.equal('soul' in hirePayload({ ...copy, soulKeep: true })[0][1], false, '« keep the source\'s »: no soul is sent, the copy keeps the SOUL.md it was copied with')
  assert.equal('soul' in hirePayload({ ...copy, soul: undefined })[0][1], false, 'no draft from the model: a copy sends no soul, as before')
  assert.equal(hirePayload({ ...fresh, soul: '   ' })[0][1].soul, composeSoul({ name: fresh.name, title: fresh.title, description: fresh.description }), 'no SOUL written: the short identity sheet of before')
  assert.equal(hirePayload({ ...fresh, soul: 'x'.repeat(SOUL_MAX + 50) })[0][1].soul.length, SOUL_MAX, 'bounded')
  assert.equal(hirePayload({ ...fresh, soul: undefined })[0][1].soul, composeSoul({ name: fresh.name, title: fresh.title, description: fresh.description }))
})

/* ---------- the text rules: the same cases as the agent half ---------- */
test('modelTextOk agrees with the cases the agent half runs (tests/python/test_llm_recruit.py)', () => {
  assert.ok(CASES.length > 30)
  for (const c of CASES) {
    const text = c.repeat ? c.text.repeat(c.repeat) : c.text
    assert.equal(modelTextOk(text, c.hi, { multiline: c.multiline === true, lo: c.lo ?? 1 }), c.ok, JSON.stringify(c).slice(0, 100))
  }
  assert.ok(SOUL_MIN === 200 && CHANGE_MAX === 120)
})

/* ---------- revise ---------- */
test('revise: before / after, up to three reasons, refused whole when a rule is broken; the order is the description alone', () => {
  const ok = mergeRevise('Old description', { description: 'Takes the API cards ; delivers tested code ; does no design.', changes: ['says what it delivers'] })
  assert.deepEqual(ok, { ok: true, before: 'Old description', after: 'Takes the API cards ; delivers tested code ; does no design.', changes: ['says what it delivers'], errors: [] })
  assert.deepEqual(mergeRevise('x', { description: 'd', changes: [] }).changes, [])
  assert.deepEqual(mergeRevise('x', { description: 'd', changes: ['a', 'b', 'c'] }).ok, true)
  const refuse = (fiche, code) => {
    const r = mergeRevise('before', fiche)
    assert.deepEqual([r.ok, r.before, r.after, r.changes], [false, 'before', 'before', []])
    assert.ok(r.errors.includes(code), `${JSON.stringify(fiche).slice(0, 50)} -> ${r.errors}`)
  }
  refuse({ description: 'd'.repeat(281), changes: [] }, 'description_long')
  refuse({ description: '', changes: [] }, 'description_invalid')
  refuse({ description: 'see www.x.y', changes: [] }, 'description_invalid')
  refuse({ description: 'd', changes: ['a', 'b', 'c', 'd'] }, 'changes_invalid')
  refuse({ description: 'd', changes: ['x'.repeat(121)] }, 'changes_invalid')
  refuse({ description: 'd', changes: ['a\nb'] }, 'changes_invalid')
  refuse({ description: 'd', changes: ['see https://x.y'] }, 'changes_invalid')
  for (const bad of [{ description: 'd' }, { description: 'd', changes: 'x' }, { description: 'd', changes: [1] }, { description: 'd', changes: [], cmd: 1 }, null, 'x']) {
    assert.equal(readReviseFiche(bad), null)
    refuse(bad, 'shape')
  }
  assert.deepEqual(reviseConfigure('backend', '  A description.  '), ['profiles.configure', { name: 'backend', description: 'A description.' }])
  assert.deepEqual(Object.keys(reviseConfigure('b', 'd')[1]), ['name', 'description'], 'the description only: no soul, no model, no skills')
  assert.equal(reviseConfigure('b', 'x'.repeat(400))[1].description.length, DESCRIPTION_MAX)
})

/* ---------- the bodies and the answers ---------- */
test('the bodies carry the mission or a name and the language: nothing else, bounded', () => {
  assert.deepEqual(recruitBody('i', '  a translator  ', 'fr'), { id: 'i', mission: 'a translator', lang: 'fr' })
  assert.equal(recruitBody('i', 'x'.repeat(1500), 'en').mission.length, 1000)
  assert.equal(recruitBody('i', 'm', 'xx').lang, 'en')
  assert.equal(recruitBody('i', null, 'en').mission, '')
  assert.deepEqual(reviseBody('i', 'backend', 'es'), { id: 'i', profile: 'backend', lang: 'es' })
  assert.deepEqual(Object.keys(recruitBody('i', 'm', 'en')), ['id', 'mission', 'lang'])
  assert.deepEqual(Object.keys(reviseBody('i', 'p', 'en')), ['id', 'profile', 'lang'])
  assert.deepEqual(draftForgetBody('i', 'recruit'), { id: 'i', feature: 'recruit' })
})
test('readDraftAnswer: the answer of a draft call, the route taken, the relaunch, an expired replay', () => {
  const done = { ok: true, id: 'i', feature: 'recruit', result: 'done', fiche: GOOD, costUsd: 0.001, costStatus: 'estimated', lane: 'light', via: 'model', model: 'example/x', provider: 'acme-cloud', retried: true }
  const a = readDraftAnswer(done)
  assert.deepEqual([a.kind, a.fiche, a.lane, a.via, a.model, a.provider, a.retried, a.expired], ['done', GOOD, 'light', 'model', 'example/x', 'acme-cloud', true, false])
  const gone = readDraftAnswer({ ok: true, id: 'i', feature: 'recruit', result: 'done', costUsd: null, costStatus: 'unknown', expired: true })
  assert.deepEqual([gone.kind, gone.fiche, gone.expired], ['done', null, true])
  const refused = readDraftAnswer({ ok: false, id: 'i', feature: 'revise', result: 'refused', reason: 'cap_reached', cap: 'usd' })
  assert.deepEqual([refused.kind, refused.reason, refused.cap, refused.fiche, refused.retried], ['refused', 'cap_reached', 'usd', null, false])
  assert.equal(readDraftAnswer({ result: 'bogus' }), null)
  assert.equal(readDraftAnswer(null), null)
  assert.deepEqual(readAnswer({ ...done }).fiche, GOOD, 'readAnswer itself is unchanged')
  assert.equal(readDraftAnswer({ ...done, lane: 'x', via: 'y', model: 5 }).lane, null)
})
test('readDraftRead: only a kept draft of the right function', () => {
  const ok = { ok: true, feature: 'revise', id: 'abc', at: 5, lane: 'light', via: 'task', model: null, provider: null, target: 'backend', fiche: { description: 'd', changes: [] } }
  assert.deepEqual(readDraftRead(ok, 'revise'), { id: 'abc', at: 5, target: 'backend', fiche: { description: 'd', changes: [] } })
  assert.equal(readDraftRead(ok, 'recruit'), null)
  assert.equal(readDraftRead({ ok: false, reason: 'expired' }, 'revise'), null)
  assert.equal(readDraftRead({ ...ok, fiche: null }, 'revise'), null)
  assert.equal(readDraftRead(null, 'revise'), null)
})

/* ---------- GET /llm: the two switches, the costs and what is kept ---------- */
const served = over => ({
  ok: true, available: true, features: ['decor', 'recruit', 'revise', 'campaign'], override: 'unsupported',
  settings: { features: { decor: true, recruit: true, revise: false }, capUsd: 1, callCap: 300, models: { strong: null, light: null } },
  spend: {}, fiches: {}, costs: { recruit: { lastUsd: 0.001, status: 'estimated' } },
  pending: { recruit: { id: 'abc', at: 7, target: null, fiche: { soul: 'never read' } }, revise: { id: 'def', at: 8, target: 'backend' }, campaign: { id: 'zzz', at: 1, target: null }, lint: 'x' }, ...over
})
test('toLlm reads the two switches, their costs and the drafts kept (never their content); the five of before are untouched', () => {
  const s = toLlm(served())
  assert.deepEqual(LLM_USEFUL, ['recruit', 'revise', 'campaign', 'cardbody', 'lint'], 'the three of the campaign editor come after the two of the roster')
  assert.deepEqual([s.settings.features.recruit, s.settings.features.revise, s.settings.features.decor, s.settings.features.art], [true, false, true, false])
  assert.deepEqual(s.features, ['decor', 'recruit', 'revise', 'campaign'], 'the ten switches are known to this page (campaign included)')
  assert.deepEqual(toLlm(served({ features: ['decor', 'mystery'] })).features, ['decor'], 'a function this page does not know is not listed')
  assert.deepEqual(s.costs.recruit, { lastUsd: 0.001, status: 'estimated' })
  assert.deepEqual(s.pending, { recruit: { id: 'abc', at: 7, target: null }, revise: { id: 'def', at: 8, target: 'backend' }, campaign: { id: 'zzz', at: 1, target: null } })
  assert.ok(!JSON.stringify(s.pending).includes('never read'))
  assert.deepEqual(toLlm(served({ pending: undefined })).pending, {})
  assert.deepEqual(toLlm(served({ pending: { recruit: { id: 5 } } })).pending, {})
})
test('settingsBody posts a switch of a work function only when the change names it (an older page would leave them alone)', () => {
  const s = toLlm(served())
  assert.deepEqual(Object.keys(settingsBody(s, {}).features), ['decor', 'outfits', 'art', 'seating', 'thoughts'])
  assert.equal(settingsBody(s, { features: { revise: true } }).features.revise, true)
  assert.equal('recruit' in settingsBody(s, { features: { revise: true } }).features, false)
  assert.equal(settingsBody(s, { features: { recruit: false } }).features.recruit, false)
})

/* ---------- the calls, against a stand-in for the REST door ---------- */
const STUB = 'export const host = {}\nexport const useQuery = () => ({})\nexport const useQueryClient = () => ({})'
const url = src => `data:text/javascript,${encodeURIComponent(src)}`
register(url(`const M = { '@hermes/plugin-sdk': ${JSON.stringify(url(STUB))} }\nexport async function resolve(s, c, next) { return M[s] ? { url: M[s], shortCircuit: true } : next(s, c) }`))
const data = await import('../../src/data/llm.js')

test('callRecruit / callRevise post to their routes with the closed body and read the draft answer', async () => {
  const seen = []
  data.initLlm({ rest: async (path, opts = {}) => {
    seen.push([path, opts.method ?? 'GET', opts.body])
    return { ok: true, id: opts.body?.id, feature: 'recruit', result: 'done', fiche: GOOD, costUsd: null, costStatus: 'unknown', lane: 'light', via: 'task', model: 'm', provider: 'p', retried: false }
  } })
  const a = await data.callRecruit('id-1', ' a translator ', 'fr')
  assert.deepEqual(seen[0], ['/llm/recruit', 'POST', { id: 'id-1', mission: 'a translator', lang: 'fr' }])
  assert.deepEqual([a.kind, a.fiche, a.lane, a.retried], ['done', GOOD, 'light', false])
  await data.callRevise('id-2', 'backend', 'en')
  assert.deepEqual(seen[1], ['/llm/revise', 'POST', { id: 'id-2', profile: 'backend', lang: 'en' }])
})
test('a refused, a failed or a lost call is an answer, never a throw; a 409 is « busy »', async () => {
  data.initLlm({ rest: async () => ({ ok: false, id: 'x', feature: 'recruit', result: 'refused', reason: 'disabled' }) })
  assert.deepEqual([(await data.callRecruit('i', 'm', 'en')).kind, (await data.callRecruit('i', 'm', 'en')).reason], ['refused', 'disabled'])
  data.initLlm({ rest: async () => { throw new Error('409: {"reason":"busy"}') } })
  assert.equal((await data.callRevise('i', 'b', 'en')).reason, 'busy')
  data.initLlm({ rest: async () => { throw new Error('network') } })
  assert.deepEqual([(await data.callRecruit('i', 'm', 'en')).kind, (await data.callRecruit('i', 'm', 'en')).reason], ['failed', 'unreachable'])
  data.initLlm(null)
  assert.equal((await data.callRecruit('i', 'm', 'en')).reason, 'unreachable')
})
test('readDraft and forgetDraft: a kept draft is read, an expired or unreadable one is null, forgetting never throws', async () => {
  const seen = []
  data.initLlm({ rest: async (path, opts = {}) => {
    seen.push([path, opts.method ?? 'GET', opts.body])
    if (path.startsWith('/llm/draft?')) return { ok: true, feature: 'recruit', id: 'abc', at: 3, target: null, fiche: GOOD }
    return { ok: true, id: 'abc', feature: 'recruit', forgotten: true }
  } })
  assert.deepEqual(await data.readDraft('recruit', 'abc'), { id: 'abc', at: 3, target: null, fiche: GOOD })
  assert.equal(seen[0][0], '/llm/draft?feature=recruit&id=abc')
  assert.equal(await data.readDraft('decor', 'abc'), null, 'only the two functions that keep a draft')
  assert.equal(await data.readDraft('recruit', 5), null)
  assert.equal(await data.forgetDraft('recruit', 'abc'), true)
  assert.deepEqual(seen.at(-1), ['/llm/draft/forget', 'POST', { id: 'abc', feature: 'recruit' }])
  data.initLlm({ rest: async () => ({ ok: false, reason: 'expired' }) })
  assert.equal(await data.readDraft('recruit', 'abc'), null)
  data.initLlm({ rest: async () => { throw new Error('boom') } })
  assert.equal(await data.readDraft('recruit', 'abc'), null)
  assert.equal(await data.forgetDraft('recruit', 'abc'), false)
  data.initLlm(null)
  assert.equal(await data.readDraft('recruit', 'abc'), null)
})

test('a text of the model: an address without a name is a link too, ordinary text is not', () => {
  for (const s of ['fetch 10.0.0.5/setup.sh first', 'post to 192.168.1.20:8080/hook', 'open localhost:3000/admin', 'load //cdn.example/x.js', 'see build-host:9000/artifacts']) {
    assert.equal(modelTextOk(s, 400), false, s)
  }
  for (const s of ['a ratio of 16:9 on screen', 'at 10:30 / 11:00', 'version 1.2.3.4 of the tool', '// a comment in code', 'step 2: 10 cards/day', '**Role:** reviewer', 'edit llm.py and global.css']) {
    assert.equal(modelTextOk(s, 400), true, s)
  }
})
