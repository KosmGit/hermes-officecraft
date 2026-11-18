import { DEFAULT_LOCALE } from './locale.js'

function lookup(bundle, key) {
  let node = bundle
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined
    node = node[part]
  }
  return node
}

/**
 * Resolve `key` (dot-path) in `locale`, falling back to English, then to the
 * raw key. Values are strings or interpolator functions.
 */
export function translate(messages, locale, key, args = []) {
  for (const lang of [locale, DEFAULT_LOCALE]) {
    const value = lookup(messages[lang], key)
    if (typeof value === 'function') return String(value(...args))
    if (typeof value === 'string') return value
  }
  return key
}

/** Every leaf of a bundle as `[dotPath, kind]` — used by the completeness test. */
export function leaves(bundle, prefix = '') {
  const out = []
  for (const [k, v] of Object.entries(bundle)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') out.push(...leaves(v, path))
    else out.push([path, typeof v])
  }
  return out
}
