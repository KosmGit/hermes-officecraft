/**
 * Language resolution, pure. The plugin ships en (reference), fr and es.
 *
 * Order: explicit user choice (plugin settings) -> the Hermes app language ->
 * the system/browser languages -> English. "auto" means "no explicit choice".
 */
export const SUPPORTED_LOCALES = Object.freeze(['en', 'fr', 'es'])
export const LANGUAGE_PREFS = Object.freeze(['auto', ...SUPPORTED_LOCALES])
export const DEFAULT_LOCALE = 'en'

/** `es-MX`, `FR`, `fr_CA` -> supported base code, else null. */
export function normalizeLocale(tag) {
  if (typeof tag !== 'string') return null
  const base = tag.trim().toLowerCase().split(/[-_]/)[0]
  return SUPPORTED_LOCALES.includes(base) ? base : null
}

export function isLanguagePref(value) {
  return LANGUAGE_PREFS.includes(value)
}

/**
 * @param {string} pref        'auto' | 'en' | 'fr' | 'es' (anything else = 'auto')
 * @param {string} appLocale   the app's active locale (useI18n().locale)
 * @param {readonly string[]} systemLocales  navigator.languages
 */
export function resolveLocale(pref, appLocale, systemLocales = []) {
  if (pref !== 'auto') {
    const explicit = normalizeLocale(pref)
    if (explicit) return explicit
  }
  const fromApp = normalizeLocale(appLocale)
  if (fromApp) return fromApp
  for (const tag of systemLocales ?? []) {
    const fromSystem = normalizeLocale(tag)
    if (fromSystem) return fromSystem
  }
  return DEFAULT_LOCALE
}
