// An older Hermes Desktop (before 2026-10-27) has no `randomUuid` in the plugin SDK: a named import of it refused the whole
// plugin (« does not provide an export named 'randomUuid' »). The bundle only imports by name what every desktop exports.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkSdkNames } from '../../dev/check.mjs'

const bundle = readFileSync(new URL('../../desktop/plugin.js', import.meta.url), 'utf8')

test('the bundle imports by name only SDK exports every Hermes Desktop has', () => {
  assert.deepEqual(checkSdkNames(bundle), [])
})

test('the guard catches a named import of a newer SDK export', () => {
  const bad = 'import { randomUuid, useQuery as q } from "@hermes/plugin-sdk";'
  assert.equal(checkSdkNames(bad).length, 1)
  assert.match(checkSdkNames(bad)[0], /randomUuid/)
})

test('newId: SDK first, then crypto.randomUUID, then getRandomValues (plain HTTP)', async () => {
  const stub = 'data:text/javascript,' + encodeURIComponent('export const host = {}')
  const src = readFileSync(new URL('../../src/data/uuid.js', import.meta.url), 'utf8').replace("'@hermes/plugin-sdk'", `'${stub}'`)
  const { newId, uuidFromBytes } = await import('data:text/javascript,' + encodeURIComponent(src))
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  assert.equal(newId({ randomUuid: () => 'from-sdk' }), 'from-sdk')
  assert.equal(newId({}, { randomUUID: () => 'from-crypto' }), 'from-crypto')
  const insecure = { randomUUID() { throw new TypeError('insecure') }, getRandomValues: b => b.fill(0xff) }
  assert.match(newId({}, insecure), V4)
  assert.match(newId(), V4)   // old desktop: the namespace has no randomUuid
  assert.equal(uuidFromBytes(new Uint8Array(16)), '00000000-0000-4000-8000-000000000000')
})
