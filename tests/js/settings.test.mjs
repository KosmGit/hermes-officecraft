import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { LLM_ALL } from '../../src/core/llm.js'
import { NOTIFY_TYPES } from '../../src/core/notify.js'
import { HELP_MAX, SETTINGS_TABS, llmOnCount, llmTabBadge, ringDash, tabAfterKey, tabOf } from '../../src/core/settings.js'
import { messages } from '../../src/i18n/index.js'
import { SHEET_AT, settingsSheet } from '../../src/ui/layout.js'

// ===== settings =====
{
// Notifications one click away. This freezes the structure so it cannot slide back into one long scroll of paragraphs.

const src = f => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')
const LANGS = ['en', 'fr', 'es']

test('the tabs: General, Game, Replay, Notifications, LLM functions, in that order', () => {
  assert.deepEqual([...SETTINGS_TABS], ['general', 'game', 'replay', 'notify', 'llm'])
  for (const lang of LANGS) for (const tab of SETTINGS_TABS) assert.ok(messages[lang].settings.tab[tab]?.length > 2, `${lang} settings.tab.${tab}`)
  assert.equal(tabOf('nope'), 'general')
  assert.equal(tabOf(undefined), 'general')
  assert.equal(tabOf('llm'), 'llm')
})

test('keyboard model of the tab list: arrows both ways (side or top), wrap around, Home / End, other keys are not ours', () => {
  assert.equal(tabAfterKey('general', 'ArrowDown'), 'game')
  assert.equal(tabAfterKey('general', 'ArrowRight'), 'game')
  assert.equal(tabAfterKey('general', 'ArrowUp'), 'llm', 'wraps to the last')
  assert.equal(tabAfterKey('llm', 'ArrowDown'), 'general', 'wraps to the first')
  assert.equal(tabAfterKey('notify', 'Home'), 'general')
  assert.equal(tabAfterKey('notify', 'End'), 'llm')
  for (const key of ['Enter', ' ', 'Tab', 'a', 'Escape']) assert.equal(tabAfterKey('game', key), null, key)
})

test('the badge of the LLM tab counts the functions that are on', () => {
  assert.equal(llmOnCount(null), null)
  assert.equal(llmOnCount({}), null)
  const features = Object.fromEntries(LLM_ALL.map(f => [f, false]))
  assert.deepEqual(llmOnCount({ settings: { features } }), { on: 0, of: LLM_ALL.length })
  assert.deepEqual(llmOnCount({ settings: { features: { ...features, decor: true, art: true } } }), { on: 2, of: LLM_ALL.length })
  assert.deepEqual(llmOnCount({ settings: { features: { ...features, decor: 'yes' } } }), { on: 0, of: LLM_ALL.length }, 'only a real true counts')
})

test('while /llm fails the LLM tab shows no badge, never the count of the last good answer kept in the cache', () => {
  const features = { ...Object.fromEntries(LLM_ALL.map(f => [f, false])), decor: true }
  assert.equal(llmTabBadge({ isError: true, data: { settings: { features } } }), null, 'the tab says the agent half is missing: no stale 1/5 next to it')
  assert.deepEqual(llmTabBadge({ isError: false, data: { settings: { features } } }), { on: 1, of: LLM_ALL.length })
  assert.equal(llmTabBadge({ isError: false, data: undefined }), null, 'nothing read yet')
  assert.equal(llmTabBadge(null), null)
  assert.match(src('ui/SettingsForm.jsx'), /llmTabBadge\(useLlm\(\)\)/, 'the form reads the badge from the whole query, not from its data alone')
})

test('the gauge ring: empty, half, full, and never past either end', () => {
  const r = 34
  const len = 2 * Math.PI * r
  assert.equal(ringDash(0, r).offset, len)
  assert.ok(Math.abs(ringDash(0.5, r).offset - len / 2) < 1e-9)
  assert.equal(ringDash(1, r).offset, 0)
  assert.equal(ringDash(7, r).offset, 0)
  assert.equal(ringDash(-3, r).offset, len)
  assert.equal(ringDash(NaN, r).offset, len)
})

test(`one line of help per setting: at most ${HELP_MAX} characters, in en, fr and es (the rest is behind the « ? »)`, () => {
  const lines = []
  for (const lang of LANGS) {
    const m = messages[lang]
    for (const k of ['languageHint', 'gameHint', 'lightHint', 'motionHint', 'nightHint']) lines.push([`${lang} settings.${k}`, m.settings[k]])
    for (const type of NOTIFY_TYPES) lines.push([`${lang} notify.typeHint.${type}`, m.notify.typeHint[type]])
    for (const k of ['noTarget', 'noRoute', 'oneRecipient', 'addAppNote', 'sameForAllHint']) lines.push([`${lang} notify.${k}`, m.notify[k]])   // the lines of the recipients and the types
    for (const k of ['onHint', 'urgentHint', 'empty']) lines.push([`${lang} notify.quiet.${k}`, m.notify.quiet[k]])
    for (const k of ['unknown_target', 'platform_not_connected', 'send_failed', 'daily_limit', 'notify_unavailable', 'failed']) lines.push([`${lang} notify.tested.${k}`, m.notify.tested[k]])
    lines.push([`${lang} llm.priceUnknown`, m.llm.priceUnknown], [`${lang} llm.spendUsd`, m.llm.spendUsd('0,0003', '1,00')])
    lines.push([`${lang} llm.capReached.usd`, m.llm.capReached.usd], [`${lang} llm.capReached.calls`, m.llm.capReached.calls])
    // the line of a function: « Sends: … » (the full list is in its « ? »)
    for (const f of LLM_ALL) lines.push([`${lang} llm.f.${f} sends line`, m.llm.sends(m.llm.f[f].sends)])
  }
  const tooLong = lines.filter(([, text]) => !text || text.length > HELP_MAX).map(([name, text]) => `${name} (${text?.length}): ${text}`)
  assert.deepEqual(tooLong, [])
})

test('what leaves the line is kept behind the « ? »: every long explanation still exists in the three languages', () => {
  for (const lang of LANGS) {
    const m = messages[lang]
    for (const k of ['languageTip', 'gameTip', 'motionTip', 'nightTip']) assert.ok(m.settings[k].length > HELP_MAX, `${lang} settings.${k}`)
    assert.ok(m.notify.hint(6).length > HELP_MAX && /6/.test(m.notify.hint(6)), `${lang} notify.hint`)
    assert.ok(m.llm.hint.length > HELP_MAX, `${lang} llm.hint`)
    for (const f of LLM_ALL) for (const k of ['what', 'detail', 'cost']) assert.ok(m.llm.f[f][k]?.length > 3, `${lang} llm.f.${f}.${k}`)
    // nothing the old hint said about what is sent was lost: the full list is still there, longer than the line
    for (const f of LLM_ALL) assert.ok(m.llm.f[f].detail.length >= m.llm.f[f].sends.length, `${lang} ${f}: the detail is the whole list`)
  }
})

test('no setting was lost: every control of the old form is in a tab, with the same ids and the same setters', () => {
  const form = src('ui/SettingsForm.jsx')
  for (const setter of ['setLanguagePref', 'setGameMode', 'setLightPref', 'setMotionPref', 'setNightPref']) assert.match(form, new RegExp(`\\b${setter}\\b`), setter)
  for (const id of ['officecraft-language', 'officecraft-light', 'officecraft-motion', 'officecraft-game', 'officecraft-night-start', 'officecraft-night-end']) assert.ok(form.includes(id), id)
  assert.match(form, /data-night-start/)
  assert.match(form, /data-night-end/)
  assert.match(form, /tab === 'notify' \? <SettingsFormNotify \/>/)
  assert.match(form, /tab === 'llm' \? <SettingsFormLlm actions=\{llm\} \/>/)
  const notify = src('ui/SettingsFormNotify.jsx')
  assert.match(notify, /NOTIFY_TYPES\.map\(type =>/, 'one switch per kind of fact')
  // the recipients of each type (a chip per recipient) + the shortcut « same for all »
  for (const hook of ['officecraft-notify-all', 'data-notify-route', 'data-notify-test', 'data-quiet-start', 'data-quiet-end', 'data-notify-preview']) assert.ok(notify.includes(hook), hook)
  const llm = src('ui/SettingsFormLlm.jsx')
  assert.match(llm, /view\.groups\[g\]\.map\(renderRow\)/, 'one row per function, in the two groups (work, decor)')
  for (const hook of ['data-llm-cap-usd', 'data-llm-cap-calls', 'data-llm-open-decor', 'data-llm-run-outfits', 'data-llm-run-art', 'data-llm-open-seating']) assert.ok(llm.includes(hook), hook)
})

test('the gear and Settings → Plugins show the same form; the form tells where each section is kept', () => {
  assert.match(src('ui/SettingsPage.jsx'), /<SettingsForm \/>/)
  assert.match(src('ui/SettingsDialog.jsx'), /<SettingsForm llm=\{llm\} \/>/)
  assert.match(src('ui/SettingsFormNotify.jsx'), /where="server"/)
  assert.match(src('ui/SettingsFormLlm.jsx'), /where="server"/)
  assert.match(src('ui/SettingsForm.jsx'), /where="local"/)
  for (const lang of LANGS) assert.ok(messages[lang].settings.local && messages[lang].settings.server)
})

test('accessibility of the window and of the « ? »: a modal dialog named by its title, tabs with their panel, a button that says what it explains', () => {
  const dialog = src('ui/SettingsDialog.jsx')
  assert.match(dialog, /showModal\(\)/)
  assert.match(dialog, /aria-labelledby/)
  assert.match(dialog, /escapeCloses\(e\)/, 'Escape is read here too')
  assert.match(dialog, /data-settings-panel/, 'the page tells an open settings window from the replay\'s Escape')
  const form = src('ui/SettingsForm.jsx')
  for (const attr of ['role="tablist"', 'role="tab"', 'role="tabpanel"', 'aria-selected', 'aria-controls', 'aria-labelledby', 'tabAfterKey']) assert.ok(form.includes(attr), attr)
  const kit = src('ui/SettingsKit.jsx')
  assert.match(kit, /aria-expanded=\{open\}/)
  assert.match(kit, /t\('settings\.helpFor', name\)/)
  assert.match(kit, /e\.key !== 'Escape'/)
  assert.match(kit, /e\.stopPropagation\(\)/, 'an open « ? » takes Escape first and leaves the window open')
  for (const lang of LANGS) assert.match(messages[lang].settings.helpFor('X'), /X/)
})

test('the look: theme variables only, a 24 px target for the « ? » and the switch, motion stilled when asked', () => {
  const css = src('ui/settingsStyles.js')
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, 'no colour literal outside src/scene/')
  assert.match(css, /\.oc-sx-help\{[^}]*width:24px;height:24px/)
  assert.match(css, /\.oc-sx-sw\{[^}]*width:40px;height:24px/)
  assert.match(css, /@container \(max-width:560px\)/, 'tabs go on top when the form is narrow')
  assert.match(css, /prefers-reduced-motion:reduce/)
  assert.match(css, /data-motion="reduced"/, 'the page\'s own « Reduced » choice')
})
}

// ===== settings =====
{
// The gear's settings panel is a sheet at or below 600 px of pane, a popover above. Without this
// test, flipping the threshold in OfficePage.jsx leaves every node test green.
test('settings panel = sheet at or below 600 px of pane, popover above, nothing before the first measure', () => {
  assert.equal(SHEET_AT, 600)
  assert.equal(settingsSheet(0), false, 'width not measured yet')
  for (const w of [1, 340, 380, 599, 600]) assert.equal(settingsSheet(w), true, `${w} px: sheet`)
  for (const w of [601, 724, 1080, 1376]) assert.equal(settingsSheet(w), false, `${w} px: popover`)   // 724 = pane of a 1024 px webapp window
})

test('the gear reaches pluginSettingsHref through the SDK namespace (never a named import of a recent export)', () => {
  const gear = readFileSync(new URL('../../src/ui/SettingsGear.jsx', import.meta.url), 'utf8')
  assert.match(gear, /sdk\.pluginSettingsHref/)
})

test('the page decides the sheet with settingsSheet(width), not a re-typed comparison', () => {
  const page = readFileSync(new URL('../../src/ui/OfficePage.jsx', import.meta.url), 'utf8')
  assert.match(page, /const sheet = settingsSheet\(width\)/)
  assert.match(page, /<SettingsGear sheet=\{sheet\}( llm=\{llmActions\})? \/>/)   // the page may hand the gear the LLM buttons
  assert.doesNotMatch(page, /SHEET_AT\s*=/, 'the threshold lives in src/ui/layout.js only')
})
}
