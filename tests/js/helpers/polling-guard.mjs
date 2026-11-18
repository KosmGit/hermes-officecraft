// Shared guard of the polling contract (<= 1 request / 5 s per source, none in background), read on the SOURCE of src/data/queries.js because useQuery cannot
// run under node. Used by tests/js/source-guards.test.mjs, on the real source and on mutants.
// Not a *.test.mjs file: the runner does not execute it by itself.
import assert from 'node:assert/strict'

const num = s => Number(s.replace(/_/g, ''))

export const pollingGuard = q => {
  const blocks = q.split('useQuery({').slice(1).map(b => b.slice(0, b.indexOf('\n  })')))
  assert.equal(blocks.length, 4, 'roster, live, history, health')
  for (const b of blocks) {
    assert.match(b, /refetchIntervalInBackground: false/, b.slice(0, 60))
    assert.doesNotMatch(b, /refetchIntervalInBackground: true/)
    assert.match(b, /refetchOnReconnect: false/, `refetchOnReconnect not off: ${b.slice(0, 60)}`)
    const retry = (b.match(/\bretry: (\w+)/) || [])[1]
    if (retry && /^\d+$/.test(retry) && Number(retry) > 0) {
      assert.ok(Number(retry) <= 1, `retry ${retry} > 1`)
      const delay = num((b.match(/\bretryDelay: ([\d_]+)/) || [, '0'])[1])
      assert.ok(delay >= 5000, `retry without retryDelay >= 5 s: ${b.slice(0, 60)}`)
    }
  }
  const ms = name => num((q.match(new RegExp(`export const ${name} = ([\\d_]+)`)) || [, 'NaN'])[1])
  for (const name of ['PAGE_POLL_MS', 'CHIP_POLL_MS', 'HISTORY_POLL_MS']) assert.ok(ms(name) >= 5000, `${name} >= 5 s`)
  assert.ok(ms('HISTORY_POLL_MS') <= 60_000, '/history at most one minute apart')
  // the default of every `intervalMs` parameter (the interval OfficePage really uses): a known constant (checked above) or a literal >= 5 s
  const defaults = [...q.matchAll(/export function use\w+\([^)]*\bintervalMs = (\w+)/g)].map(m => m[1])
  assert.ok(defaults.length >= 3, `hooks with a default interval: ${defaults.length}`)
  for (const d of defaults) {
    if (/^[\d_]+$/.test(d)) assert.ok(num(d) >= 5000, `default interval ${d} ms < 5 s`)
    else assert.ok(Number.isFinite(ms(d)), `default interval ${d} is not a known constant`)
  }
}
