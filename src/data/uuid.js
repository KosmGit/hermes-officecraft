/**
 * A random id for an order, an LLM request, a recruitment. The SDK's `randomUuid` only exists in Hermes Desktop builds from
 * 2026-10-27 on: a NAMED import of it made an older desktop refuse the whole plugin (« does not provide an export named
 * 'randomUuid' »). The namespace import below never fails to link; a missing export is just `undefined`, and the id then comes
 * from Web Crypto (`randomUUID` needs a secure origin, `getRandomValues` does not: the webapp may be served over plain HTTP).
 */
import * as sdk from '@hermes/plugin-sdk'

const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

/** RFC 4122 version-4 id from 16 random bytes. */
export function uuidFromBytes(b) {
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = hex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function newId(host = sdk, crypto = globalThis.crypto) {
  if (typeof host?.randomUuid === 'function') return host.randomUuid()
  if (typeof crypto?.randomUUID === 'function') {
    try { return crypto.randomUUID() } catch { /* insecure origin: fall through */ }
  }
  return uuidFromBytes(crypto.getRandomValues(new Uint8Array(16)))
}
