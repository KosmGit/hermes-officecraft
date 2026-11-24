import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { formattersBuilt, numberText, percentText, timeText } from '../../src/core/format.js'
import { messages } from '../../src/i18n/index.js'
import { translate } from '../../src/core/translate.js'

const norm = s => s.replace(/[\u00a0\u202f]/g, ' ')   // the no-break spaces of French and Spanish, compared as plain spaces

test('numbers are grouped the way each language groups them', () => {
  assert.equal(numberText(8000, 'en'), '8,000')
  assert.equal(norm(numberText(8000, 'fr')), '8 000')
  assert.equal(numberText(8000, 'es'), '8000')          // Spanish does not group four digits
  assert.equal(norm(numberText(1234567, 'es')), '1.234.567')
  assert.equal(norm(numberText(1234567, 'fr')), '1 234 567')
  assert.equal(numberText(1234567, 'en'), '1,234,567')
  assert.equal(numberText(null, 'en'), null)
  assert.equal(numberText(NaN, 'fr'), null)
})

test('percentages carry the language\u2019s own sign and space', () => {
  assert.equal(percentText(48, 'en'), '48%')
  assert.equal(norm(percentText(48, 'fr')), '48 %')
  assert.equal(norm(percentText(48, 'es')), '48 %')
  assert.equal(norm(percentText(9.5, 'fr')), '9,5 %')
  assert.equal(percentText(9.5, 'en'), '9.5%')
  assert.equal(percentText(0, 'en'), '0%')
  assert.equal(percentText(100, 'es').includes('100'), true)
  assert.equal(percentText(undefined, 'fr'), null)
})

test('a clock time follows the plugin language, not the system\u2019s', () => {
  const ms = new Date(2026, 10, 24, 15, 7).getTime()   // local time: the machine's zone is the user's
  assert.match(timeText(ms, 'en'), /^0?3:07\s?PM$/i)
  assert.equal(timeText(ms, 'fr'), '15:07')
  assert.equal(timeText(ms, 'es'), '15:07')
  assert.equal(timeText(null, 'fr'), '')
})

test('a language tag that Intl rejects still reads (English), and a formatter is built once per language', () => {
  assert.equal(numberText(1500, 'not a tag!'), '1,500')
  const before = formattersBuilt()
  for (let i = 0; i < 500; i++) { numberText(i, 'fr'); percentText(i % 100, 'fr'); timeText(i * 1e6, 'fr') }
  assert.equal(formattersBuilt(), before + 0, 'no new formatter after the first call per kind and language')
  numberText(1, 'es'); numberText(2, 'es')
  assert.ok(formattersBuilt() <= before + 1)
})

test('the screens that wrote a number, a time or a percentage by hand now go through the plugin language', () => {
  const src = f => readFileSync(new URL(`../../src/ui/${f}`, import.meta.url), 'utf8')
  for (const f of ['CampaignDialog.jsx', 'CampaignAssist.jsx']) {
    assert.ok(!/toLocaleString\('en'\)/.test(src(f)), `${f} formats with English`)
    assert.match(src(f), /numberText\([A-Z_]+, t\.lang\)/, `${f} uses numberText with t.lang`)
  }
  assert.ok(!/toLocaleTimeString\(\[\]/.test(src('SettingsFormNotify.jsx')), 'the clock of the test message follows the system')
  assert.match(src('SettingsFormNotify.jsx'), /timeText\(view\.line\.at, t\.lang\)/)
  for (const f of ['UsageDialog.jsx', 'ProjectsTab.jsx']) {
    assert.ok(!/\{(?:c\.)?pct\} ?%/.test(src(f)), `${f} writes the percent sign by hand`)
    assert.match(src(f), /percentText\(/, `${f} uses percentText`)
  }
})

test('sentences that were assembled from fragments are one key each, with their parameters, in the three languages', () => {
  const src = f => readFileSync(new URL(`../../src/ui/${f}`, import.meta.url), 'utf8')
  assert.ok(!/\$\{counts\.working\} \$\{t\(/.test(src('PageHeader.jsx')), 'the working pill is a number glued to a word')
  assert.ok(!/ux\.badge\.streak'\)\} \$\{t\('ux\.badge\.days'/.test(src('PageHeader.jsx')), 'the streak is two fragments')
  assert.ok(!/t\('llm\.sends', [^)]*\)[^)]*\)\}\./.test(src('SettingsFormLlm.jsx')) && !/`\$\{t\('llm\.sends'/.test(src('SettingsFormLlm.jsx')), 'the sentence of the model call is closed by a full stop added in the markup')
  const at = (lang, key, ...a) => translate(messages, lang, key, a)
  assert.equal(at('en', 'ux.pill.workingLabel', 3), '3 working')
  assert.equal(at('fr', 'ux.pill.workingLabel', 3), '3 au travail')
  assert.equal(at('es', 'ux.pill.workingLabel', 3), '3 trabajando')
  assert.equal(at('en', 'ux.badge.streakLabel', 10), '10-day streak')
  assert.equal(at('fr', 'ux.badge.streakLabel', 10), 'série de 10 jours')
  assert.equal(at('fr', 'ux.badge.streakLabel', 1), 'série de 1 jour')
  assert.equal(at('es', 'ux.badge.streakLabel', 10), 'racha de 10 días')
  assert.equal(at('en', 'llm.sendsLine', 'the title'), 'Sends: the title.')
  assert.equal(at('fr', 'llm.sendsLine', 'le titre'), 'Envoie : le titre.')
  assert.equal(at('es', 'llm.sendsLine', 'el título'), 'Envía: el título.')
})
