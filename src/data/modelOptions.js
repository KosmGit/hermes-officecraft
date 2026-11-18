import { MODEL_OPTIONS_TIMEOUT_MS, failureOf, parseModelOptions } from '../core/modelOptions.js'
import { safeRequest } from './rpc.js'

/**
 * One read of `model.options` for the recruitment form (the call of the Bots tab's model picker), bounded by a deadline: past it
 * the form shows its free fields again. `include_unconfigured` also lists the providers with no key (not selectable: the form says where
 * to add one). Read only: the office never calls `model.save_key` / `model.disconnect`. `schedule` / `cancel` are the timer, passed in so
 * a test runs without waiting.
 * -> { state: 'ready' | 'empty' | 'timeout' | 'unsupported' | 'failed', providers, inherited }
 */
export async function loadModelOptions(request = safeRequest, { timeoutMs = MODEL_OPTIONS_TIMEOUT_MS, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let timer = null
  const deadline = new Promise(resolve => { timer = schedule(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs) })
  let res
  try {
    res = await Promise.race([request('model.options', { include_unconfigured: true }), deadline])
  } catch (error) {
    res = { ok: false, reason: 'failed', error }
  } finally {
    cancel(timer)
  }
  const none = state => ({ state, providers: [], inherited: { model: '', provider: '' } })
  if (!res?.ok) return none(failureOf(res))
  const parsed = parseModelOptions(res.data)
  // a method that answers but lists nothing selectable is the same for the form as no list
  if (!parsed.providers.some(p => p.ready && p.models.length)) return { ...none('empty'), inherited: parsed.inherited }
  return { state: 'ready', ...parsed }
}
