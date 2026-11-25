/* The Notifications tab: the eight types in three groups, one messaging app is a note (not a setting), the recipient chips sit on the help
   line for one or two recipients, the preview follows the types, and the tab carries « on / 8 ». Pure functions and the source of the form. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  NOTIFY_GROUPS, NOTIFY_TYPES, chipsOnHelpLine, choosesBetweenRecipients, notifyOnCount, notifyTabBadge, recipientsNote, toNotify
} from '../../src/core/notify.js'
import { messages } from '../../src/i18n/index.js'

const src = f => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')
const LANGS = ['en', 'fr', 'es']
const target = (platform, n) => ({ key: `${platform}#${n}`, platform, label: `…${n}`, source: 'cron' })
const state = (targets, over = {}) => toNotify({
  ok: true,
  settings: { types: { decision: true, review: true, ...over }, routes: {}, quiet: { enabled: false } },
  targets,
  maxRoutes: 4
})

test('the three groups: every type is in exactly one, in the order of what the user does about them', () => {
  assert.deepEqual(NOTIFY_GROUPS.map(g => g.id), ['waiting', 'faults', 'info'])
  assert.deepEqual([...NOTIFY_GROUPS[0].types], ['decision', 'review', 'campaign'])
  assert.deepEqual([...NOTIFY_GROUPS[1].types], ['silent', 'gateway', 'cron'])
  assert.deepEqual([...NOTIFY_GROUPS[2].types], ['llm_cap', 'trophy'])
  const all = NOTIFY_GROUPS.flatMap(g => [...g.types])
  assert.equal(new Set(all).size, all.length, 'no type twice')
  assert.deepEqual([...all].sort(), [...NOTIFY_TYPES].sort(), 'no type missing, none invented')
  for (const lang of LANGS) for (const g of NOTIFY_GROUPS) assert.ok(messages[lang].notify.group[g.id]?.length > 2, `${lang} notify.group.${g.id}`)
  assert.equal(messages.fr.notify.group.waiting, 'Vous attend')
})

test('the badge « on / 8 » of the tab: counts real trues, and says nothing while unread or failed', () => {
  assert.deepEqual(notifyOnCount(state([])), { on: 2, of: 8 })
  assert.deepEqual(notifyOnCount(state([], { trophy: 'yes' })), { on: 2, of: 8 }, 'only a real true counts')
  assert.deepEqual(notifyOnCount(state([], { cron: true, gateway: true })), { on: 4, of: 8 })
  assert.equal(notifyOnCount(null), null)
  assert.equal(notifyTabBadge({ isError: true, data: state([]) }), null, 'a failed read shows no stale count')
  assert.equal(notifyTabBadge({ isError: false, data: undefined }), null)
  assert.equal(notifyTabBadge(null), null)
  assert.deepEqual(notifyTabBadge({ isError: false, data: state([]) }), { on: 2, of: 8 })
})

test('one messaging app: no « same for all » (nothing to choose between), chips on the help line, the connection is a note', () => {
  const none = state([])
  const one = state([target('telegram', 1)])
  const two = state([target('telegram', 1), target('discord', 2)])
  const three = state([target('telegram', 1), target('discord', 2), target('slack', 3)])
  assert.deepEqual([none, one, two, three].map(choosesBetweenRecipients), [false, false, true, true])
  assert.deepEqual([none, one, two, three].map(chipsOnHelpLine), [false, true, true, false], 'with nobody there is no chip; with three they take their own line')
  assert.deepEqual(recipientsNote(none), ['noTarget', 'addAppNote'])
  assert.deepEqual(recipientsNote(one), ['oneRecipient'])
  assert.deepEqual(recipientsNote(two), ['addAppNote'])
})

test('the form: the groups, the note, the inline chips and the order (recipients, the preview, the types, the quiet hours)', () => {
  const form = src('ui/SettingsFormNotify.jsx')
  assert.match(form, /NOTIFY_GROUPS\.map\(group =>/)
  assert.match(form, /choosesBetweenRecipients\(state\) \? \(\s*<SettingsRow id="officecraft-notify-all"/, 'the list « same for all » only with a choice to make')
  assert.match(form, /className="oc-nt-note" data-notify-note/)
  assert.doesNotMatch(form, /id="officecraft-notify-add"/, 'the connection is no longer a row of settings')
  assert.match(form, /data-chips=\{inline \? 'help' : 'own'\}/)
  assert.match(form, /\{inline \? chips : null\}/)
  const at = k => form.indexOf(k)
  assert.ok(at("data-notify-recipients") < at("data-notify-preview-title") && at("data-notify-preview-title") < at("notify.types") && at("notify.types") < at("data-notify-quiet-title"),
    'the preview sits above the types, in view while they are switched (it was the last thing of the tab, a scroll away from them)')
  const settings = src('ui/SettingsForm.jsx')
  assert.match(settings, /notifyTabBadge\(useNotify\(\)\)/, 'the tab reads its badge from the whole query, like the LLM one')
})

test('« Mixed » is « Per type »; the gateway and the silences have their plain names, in the three languages', () => {
  assert.equal(messages.fr.notify.mixed, 'Selon le type')
  assert.equal(messages.en.notify.mixed, 'Per type')
  assert.equal(messages.es.notify.mixed, 'Según el tipo')
  assert.equal(messages.fr.notify.type.gateway, 'Passerelle Hermes')
  assert.equal(messages.fr.notify.type.silent, 'Agents silencieux')
  assert.equal(messages.en.notify.type.gateway, 'Hermes gateway')
  assert.equal(messages.es.notify.type.gateway, 'Pasarela de Hermes')
  for (const lang of LANGS) {
    const m = messages[lang].notify
    assert.doesNotMatch(m.typeHint.gateway, /gateway|Gateway|pasarela/i, `${lang}: the help is one plain sentence, not a repeat of the name`)
    assert.ok(m.typeHint.gateway.length <= 60, `${lang} typeHint.gateway`)
  }
})
