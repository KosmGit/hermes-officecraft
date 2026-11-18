import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { register } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// The preferences live in the app's storage (localStorage `hermes.plugin.hermes-officecraft.<key>`), outside the
// plugin folder, so a reinstall keeps them — but only as long as the keys and the accepted values never change under a user's feet.
// This test freezes both. If it fails, DO NOT edit the table to make it green: add a migration in initPrefs (read the old key or
// value, write the new one) so what a user already chose survives, then extend the table.

// prefs.js imports `atom` from the host SDK, which does not exist under node: a one-line stand-in, only for this test.
const STUB = 'export const atom = v => { let value = v; return { get: () => value, set: n => { value = n } } }'
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) { return s === '@hermes/plugin-sdk' ? { url: 'data:text/javascript,${encodeURIComponent(STUB)}', shortCircuit: true } : next(s, c) }`)}`)
const prefs = await import('../../src/data/prefs.js')

/** Frozen contract: stored key -> { default, accepted values, how the app reads it back }. */
const FROZEN = {
  language: { atom: '$languagePref', setter: 'setLanguagePref', default: 'auto', accepted: ['auto', 'en', 'fr', 'es'] },
  game: { atom: '$gameMode', setter: 'setGameMode', default: true, accepted: [true, false] },
  light: { atom: '$lightPref', setter: 'setLightPref', default: 'auto', accepted: ['auto', 'day', 'night'] },
  motion: { atom: '$motionPref', setter: 'setMotionPref', default: 'auto', accepted: ['auto', 'reduced'] },
  panel: { atom: '$panelOpen', setter: 'setPanelOpen', default: true, accepted: [true, false] },
  // « Seating »: added on purpose, a new key (nothing stored before it: the default is what every user had)
  seating: { atom: '$seatChoice', setter: 'setSeatChoice', default: 'relays', accepted: ['relays', 'model', 'default'] }
}
// « Night »: added on purpose, a new key (nothing stored before it; default 19 h – 7 h = what every user had); its object value is covered by tests/js/replay.test.mjs
const FROZEN_KEYS = [...Object.keys(FROZEN), 'seen', 'night'].sort()
const MIGRATE = 'a stored key or an accepted value changed: write a MIGRATION in initPrefs (read the old key/value, write the new one) so existing users keep their settings instead of a silent reset, then update this table'

const fakeStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]))
  return { data, get: (k, d) => (data.has(k) ? data.get(k) : d), set: (k, v) => { data.set(k, JSON.parse(JSON.stringify(v))) } }
}

test('every accepted value written by the current version is read back unchanged by initPrefs', () => {
  for (const [key, spec] of Object.entries(FROZEN)) {
    for (const value of spec.accepted) {
      const written = fakeStorage()
      prefs.initPrefs({ storage: written })
      prefs[spec.setter](value)
      assert.deepEqual(written.data.get(key), value, `${key}=${JSON.stringify(value)}: not stored as is. ${MIGRATE}`)
      // « the next launch »: a fresh start on the stored data
      prefs.initPrefs({ storage: fakeStorage(Object.fromEntries(written.data)) })
      assert.deepEqual(prefs[spec.atom].get(), value, `${key}=${JSON.stringify(value)} was not read back as chosen (it would reset silently). ${MIGRATE}`)
    }
  }
})

test('all choices together survive a restart', () => {
  const chosen = { language: 'es', game: false, light: 'night', motion: 'reduced', panel: false, seating: 'default' }
  const storage = fakeStorage()
  prefs.initPrefs({ storage })
  for (const [key, spec] of Object.entries(FROZEN)) prefs[spec.setter](chosen[key])
  prefs.initPrefs({ storage: fakeStorage(Object.fromEntries(storage.data)) })
  for (const [key, spec] of Object.entries(FROZEN)) assert.equal(prefs[spec.atom].get(), chosen[key], `${key}. ${MIGRATE}`)
})

test('nothing stored means the defaults; a value no version accepts falls back to the default, never throws', () => {
  prefs.initPrefs({ storage: fakeStorage() })
  for (const [key, spec] of Object.entries(FROZEN)) assert.equal(prefs[spec.atom].get(), spec.default, `${key} default`)
  prefs.initPrefs({ storage: fakeStorage({ language: 'de', light: 'dusk', motion: 'none' }) })
  assert.equal(prefs.$languagePref.get(), 'auto')
  assert.equal(prefs.$lightPref.get(), 'auto')
  assert.equal(prefs.$motionPref.get(), 'auto')
  prefs.initPrefs({})
  assert.equal(prefs.$gameMode.get(), true, 'a host without storage: defaults')
})

test('« seen » achievements keep their key and their shape (array of strings)', () => {
  const storage = fakeStorage()
  prefs.initPrefs({ storage })
  prefs.writeSeen(['a', 'b'])
  assert.deepEqual(storage.data.get('seen'), ['a', 'b'], `seen. ${MIGRATE}`)
  prefs.initPrefs({ storage: fakeStorage({ seen: ['a', 'b', 7] }) })
  assert.deepEqual(prefs.readSeen(), ['a', 'b'])
})

test('the set of keys the plugin stores is exactly the frozen one (a new or renamed key must be added here on purpose)', () => {
  const src = readFileSync(new URL('../../src/data/prefs.js', import.meta.url), 'utf8')
  const keys = new Set([...src.matchAll(/storage\??\.(?:get|set)\??\.?\(\s*'([a-z]+)'/g)].map(m => m[1]))
  assert.deepEqual([...keys].sort(), FROZEN_KEYS, `stored keys differ from the frozen list. ${MIGRATE}`)
  assert.doesNotMatch(src, /storage\??\.(remove|delete|clear)/, 'a preference is never removed (the host mirrors shared keys)')
})

test('the shared SettingsForm is the only UI that writes preferences; ctx.storage is touched by prefs.js alone', () => {
  const root = fileURLToPath(new URL('../../src/', import.meta.url))
  const files = []
  const walk = dir => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(f)) files.push(p) } }
  walk(root)
  const rel = p => p.slice(root.length)
  const setters = /\b(setLanguagePref|setGameMode|setLightPref|setMotionPref)\b/
  for (const file of files) {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')   // code only, comments may mention ctx.storage
    const name = rel(file)
    if (name !== 'data/prefs.js') assert.doesNotMatch(text, /\bctx\.storage\b|\bstorage\??\.(get|set)\b/, `${name} reads or writes the app storage: only src/data/prefs.js may`)
    if (!['data/prefs.js', 'ui/SettingsForm.jsx'].includes(name)) assert.doesNotMatch(text, setters, `${name} writes a setting: only SettingsForm (shared by the gear and Hermes' settings page) may`)
  }
  // both doors render the same component, none re-implements it
  assert.match(readFileSync(join(root, 'ui/SettingsPage.jsx'), 'utf8'), /<SettingsForm \/>/)
  // the gear opens SettingsDialog, which renders the form (the window is the gear's, the form is shared)
  assert.match(readFileSync(join(root, 'ui/SettingsGear.jsx'), 'utf8'), /<SettingsDialog [^>]*llm=\{llmActions\}/)
  assert.match(readFileSync(join(root, 'ui/SettingsDialog.jsx'), 'utf8'), /<SettingsForm llm=\{llm\} \/>/)
})

test('the storage key prefix is not ours to change: the host builds hermes.plugin.<id>.<key> from the plugin id', () => {
  const constants = readFileSync(new URL('../../src/constants.js', import.meta.url), 'utf8')
  assert.match(constants, /PLUGIN_ID = 'hermes-officecraft'/, 'renaming the plugin id orphans every stored preference: it needs a migration')
})
