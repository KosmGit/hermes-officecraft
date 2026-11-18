import { useI18n, useValue } from '@hermes/plugin-sdk'
import { useCallback } from 'react'

import { resolveLocale } from '../core/locale.js'
import { formatRelative } from '../core/time.js'
import { translate } from '../core/translate.js'
import { $languagePref } from '../data/prefs.js'
import { messages } from '../i18n/index.js'

export function systemLocales() {
  return typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []
}

/** The app's active locale; tolerant of hosts without useI18n. */
export function useAppLocale() {
  try {
    return typeof useI18n === 'function' ? useI18n()?.locale : undefined
  } catch {
    return undefined
  }
}

/**
 * Plugin translator: follows the user's choice in Settings → Plugins → Officecraft,
 * else the app language, else the system, else English. `t.lang` is the
 * resolved code; `t.ago(ms)` formats relative times in that same language.
 */
export function useT() {
  const pref = useValue($languagePref)
  const lang = resolveLocale(pref, useAppLocale(), systemLocales())
  return useCallback(
    Object.assign((key, ...args) => translate(messages, lang, key, args), {
      lang,
      ago: ms => formatRelative(ms, Date.now(), lang)
    }),
    [lang]
  )
}
