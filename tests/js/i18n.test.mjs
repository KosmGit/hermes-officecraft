import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { LANGUAGE_PREFS, SUPPORTED_LOCALES, normalizeLocale, resolveLocale } from '../../src/core/locale.js'
import { formatRelative } from '../../src/core/time.js'
import { leaves, translate } from '../../src/core/translate.js'
import { ENDONYMS, messages } from '../../src/i18n/index.js'

test('ships exactly en, fr and es, each with an endonym', () => {
  assert.deepEqual(Object.keys(messages).sort(), [...SUPPORTED_LOCALES].sort())
  for (const code of SUPPORTED_LOCALES) assert.ok(ENDONYMS[code], code)
  assert.deepEqual(LANGUAGE_PREFS, ['auto', 'en', 'fr', 'es'])
})

test('every language has every English key, with the same kind, and nothing extra', () => {
  const reference = new Map(leaves(messages.en))
  for (const code of SUPPORTED_LOCALES) {
    const bundle = new Map(leaves(messages[code]))
    for (const [key, kind] of reference) {
      assert.ok(bundle.has(key), `${code} misses ${key}`)
      assert.equal(bundle.get(key), kind, `${code}.${key} is a ${bundle.get(key)}, en has a ${kind}`)
    }
    for (const key of bundle.keys()) assert.ok(reference.has(key), `${code} has unknown key ${key}`)
  }
})

test('interpolators produce text in every language', () => {
  for (const code of SUPPORTED_LOCALES) {
    for (const [key, kind] of leaves(messages.en)) {
      if (kind !== 'function') continue
      const out = translate(messages, code, key, ['A', 'B'])
      assert.ok(out.length > 0 && !out.includes('undefined'), `${code}.${key} -> ${out}`)
    }
  }
})

test('normalizeLocale keeps supported base codes only', () => {
  assert.equal(normalizeLocale('es-MX'), 'es')
  assert.equal(normalizeLocale('FR_ca'), 'fr')
  assert.equal(normalizeLocale('en'), 'en')
  for (const other of ['de', 'zh-hant', 'pt-BR', '', null, undefined, 42]) assert.equal(normalizeLocale(other), null)
})

test('an explicit choice wins over the app and the system', () => {
  assert.equal(resolveLocale('es', 'fr', ['en-US']), 'es')
})

test('auto follows the app, then the system, then English', () => {
  assert.equal(resolveLocale('auto', 'fr', ['es-ES']), 'fr')
  assert.equal(resolveLocale('auto', 'de', ['de-DE', 'es-ES']), 'es')
  assert.equal(resolveLocale('auto', 'ja', ['ja-JP']), 'en')
  assert.equal(resolveLocale('auto', undefined, undefined), 'en')
})

test('unknown or corrupted preferences behave like auto', () => {
  assert.equal(resolveLocale('klingon', 'es', []), 'es')
  assert.equal(resolveLocale(undefined, 'fr', []), 'fr')
})

test('translate falls back to English, then to the key', () => {
  const partial = { en: { a: 'A', nested: { b: 'B' } }, fr: { a: 'A-fr' }, es: {} }
  assert.equal(translate(partial, 'fr', 'a'), 'A-fr')
  assert.equal(translate(partial, 'fr', 'nested.b'), 'B')
  assert.equal(translate(partial, 'es', 'missing.key'), 'missing.key')
})

test('relative times are written in the plugin language', () => {
  const now = Date.UTC(2026, 10, 8, 12)
  const threeHoursAgo = now - 3 * 3_600_000
  assert.match(formatRelative(threeHoursAgo, now, 'en'), /3 hours ago/)
  assert.match(formatRelative(threeHoursAgo, now, 'fr'), /il y a 3 heures/)
  assert.match(formatRelative(threeHoursAgo, now, 'es'), /hace 3 horas/)
  assert.equal(formatRelative(undefined, now, 'en'), '')
})

test('recruit: the hint about the copied skills agrees with one skill and with several', () => {
  const hint = (lang, n) => translate(messages, lang, 'recruit.skillsHint', [n, 'alpha'])
  assert.match(hint('en', 1), /^The other skill of alpha is copied too\./)
  assert.match(hint('en', 3), /^The other 3 skills of alpha are copied too\./)
  assert.match(hint('fr', 1), /^L’autre skill d’alpha est copié aussi/)
  assert.match(hint('fr', 3), /^Les 3 autres skills d’alpha sont copiés aussi/)
  assert.match(hint('es', 1), /^El otro skill de alpha se copia también/)
  assert.match(hint('es', 3), /^Los otros 3 skills de alpha se copian también/)
})

test('the path to the auxiliary models is the one Hermes Desktop labels, in the three languages', () => {
  const PATH = { en: 'Settings → Model → Auxiliary models', fr: 'Paramètres → Modèle → Modèles auxiliaires', es: 'Configuración → Modelo → Modelos auxiliares' }
  const OLD = /Models → Auxiliary\b|Modèles → Auxiliaire\b|Modelos → Auxiliar\b/
  for (const lang of SUPPORTED_LOCALES) {
    const llm = messages[lang].llm
    for (const text of [llm.unknownPrice(1, 2), llm.chipTipHost('strong'), llm.chipTipHost('light'), llm.grant.tipFall, llm.grant.tooOld]) assert.ok(text.includes(PATH[lang]), `${lang}: ${text}`)
    assert.doesNotMatch(readFileSync(new URL(`../../src/i18n/${lang}.js`, import.meta.url), 'utf8'), OLD, `${lang}: the earlier path is gone`)
  }
})
