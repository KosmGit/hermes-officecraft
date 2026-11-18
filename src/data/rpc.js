import { host } from '@hermes/plugin-sdk'

/**
 * Every gateway call goes through here: an unknown method on another app
 * version, a dropped socket or a thrown error resolves to `{ ok: false }`
 * instead of breaking the page.
 */
export async function safeRequest(method, params = {}) {
  try {
    if (typeof host?.request !== 'function') return { ok: false, reason: 'unavailable' }
    const data = await host.request(method, params)
    return { ok: true, data }
  } catch (error) {
    return { ok: false, reason: 'failed', error }
  }
}
