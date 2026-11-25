/* The LLM tab says once what is true of several rows (an older agent half, no choice of model), says it is a paid option without a click,
   and says the cost of each function next to what it sends. Pure functions and the source of the form: no SDK, no DOM. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { LLM_ALL, LLM_WORK, toLlm } from '../../src/core/llm.js'
import { chipKey, chipRows, groupNotice, modelChoices, settingsView } from '../../src/core/llmSettings.js'
import { messages } from '../../src/i18n/index.js'

const src = f => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')
const LANGS = ['en', 'fr', 'es']
const body = over => ({
  ok: true, available: true, features: [...LLM_ALL], override: 'not_granted',
  settings: { features: { recruit: true, decor: true }, capUsd: 1, callCap: 300, models: { strong: null, light: null } },
  spend: {}, fiches: {}, costs: {}, pending: {}, ...over
})
const OLD_HALF = ['decor', 'outfits', 'art', 'seating', 'thoughts']   // an agent half that serves only the five decor functions
const view = over => settingsView(toLlm(body(over)), modelChoices({ state: 'idle' }))

test('an agent half older than the page: ONE notice for the group, the rows only dimmed and without a pill of their own', () => {
  const v = view({ features: OLD_HALF })
  assert.equal(v.notices.work, 'outdated', 'the five work functions are all out of date: said once, above them')
  assert.equal(v.notices.decor, null, 'the decor functions are served: nothing to say')
  for (const r of v.groups.work) assert.equal(r.quiet, true, r.key)
  for (const r of v.groups.decor) assert.equal(r.quiet, false, r.key)
})

test('one function in a state is not a shared reason: it keeps its own pill, the group says nothing', () => {
  const v = view({ features: LLM_ALL.filter(f => f !== 'lint') })
  assert.equal(v.notices.work, null)
  assert.deepEqual(v.groups.work.filter(r => r.state === 'outdated').map(r => [r.key, r.quiet]), [['lint', false]])
})

test('groupNotice: a state that is not a shared reason (ready, off, cap, error) is never turned into a notice', () => {
  const rows = ['ready', 'ready', 'off', 'off', 'cap', 'cap', 'error', 'error'].map((state, i) => ({ key: `f${i}`, state }))
  const g = groupNotice(rows)
  assert.equal(g.notice, null)
  assert.ok(g.rows.every(r => r.quiet === false))
  const two = groupNotice([{ key: 'a', state: 'unavailable' }, { key: 'b', state: 'unavailable' }, { key: 'c', state: 'ready' }])
  assert.equal(two.notice, null, 'no model offered already has its single banner at the top of the tab')
  assert.deepEqual(two.rows.map(r => r.quiet), [true, true, false])
})

test('the model chip is drawn only where it tells rows apart', () => {
  // no grant: every function takes Hermes’ own model; the lanes are the only difference, and the majority lane is the default
  const v = view()
  const shown = [...v.groups.work, ...v.groups.decor].filter(r => r.chip).map(r => r.key).sort()
  assert.deepEqual(shown, ['campaign', 'cardbody'], 'the two strong rows differ from the eight light ones; the eight carry nothing')
  // one kind only: no chip at all
  const same = LLM_ALL.map(key => ({ key, lane: 'light', route: { kind: 'host' } }))
  assert.equal(chipRows(same).size, 0)
  assert.equal(chipRows([]).size, 0)
  // two real models: the rarer one is marked, the common one is not
  const rows = [
    { key: 'a', lane: 'light', route: { kind: 'model', provider: 'example', model: 'example/small' } },
    { key: 'b', lane: 'light', route: { kind: 'model', provider: 'example', model: 'example/small' } },
    { key: 'c', lane: 'strong', route: { kind: 'model', provider: 'example', model: 'example/large' } }
  ]
  assert.deepEqual([...chipRows(rows)], ['c'])
  assert.notEqual(chipKey(rows[0]), chipKey(rows[2]))
})

test('the form: a visible line says it is paid, a switch that is off has no « off » pill, the cost follows « Sends: … », no row repeats « no model »', () => {
  const form = src('ui/SettingsFormLlm.jsx')
  assert.match(form, /data-llm-pay>\{t\('llm\.pay'\)\}/, 'the line sits in the tab, not behind a « ? »')
  assert.match(form, /const pill = st !== 'off' && !row\.quiet/, 'off and quiet rows draw no pill')
  assert.match(form, /\{pill \? <span className="oc-sx-state"/)
  assert.match(form, /data-llm-calls> · \{t\(`llm\.f\.\$\{f\}\.calls`\)\}/)
  assert.match(form, /row\.chip \? <LaneChip/)
  assert.match(form, /data-llm-group-notice=\{view\.notices\[g\]\}/)
  assert.doesNotMatch(form, /st === 'unavailable' \? t\('llm\.noModel'\)/, 'the per-row repeat of « no model » is gone')
  assert.match(form, /data-llm-nomodel>\{t\('llm\.noModel'\)\}/, 'it is said once, on top')
})

test('the paid-option line and the group notice exist in the three languages, with the action; every function has a short cost', () => {
  for (const lang of LANGS) {
    const m = messages[lang].llm
    assert.ok(m.pay.length > 60, `${lang} llm.pay`)
    assert.ok(m.groupOutdated.length > 40, `${lang} llm.groupOutdated`)
    for (const f of LLM_ALL) {
      assert.ok(m.f[f].calls?.length >= 6 && m.f[f].calls.length <= 44, `${lang} llm.f.${f}.calls (${m.f[f].calls})`)
      assert.ok(m.f[f].cost.length > 3, `${lang} llm.f.${f}.cost stays: the « ? » says the whole cost`)
    }
  }
  assert.match(messages.fr.llm.pay, /^Optionnel\. Chaque appel est facturé par votre fournisseur de modèle ; tout est désactivé par défaut, rien ne part sans votre clic\.$/)
  assert.match(messages.fr.llm.groupOutdated, /Mettez à jour Officecraft puis redémarrez Hermes\.$/)
  assert.equal(LLM_WORK.length, 5)
})
