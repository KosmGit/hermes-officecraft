import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { deliveryProblems, parsePluginYaml, registeredHooks, siblingImports } from './helpers/delivery-guard.mjs'

// ===== delivery =====
{
const root = p => new URL(`../../${p}`, import.meta.url)
const text = p => readFileSync(root(p), 'utf8')

// Hermes refuses a plugin source above PLUGIN_SOURCE_MAX_BYTES (16 MiB, hermes-agent/apps/desktop/electron/main.ts,
// `hermes:readPluginSource`). We keep half of that as headroom.
const PLUGIN_SOURCE_MAX_BYTES = 16 * 1024 * 1024

test('desktop/plugin.js stays under 50 % of Hermes PLUGIN_SOURCE_MAX_BYTES', () => {
  const size = statSync(root('desktop/plugin.js')).size
  assert.ok(size > 0)
  assert.ok(size <= PLUGIN_SOURCE_MAX_BYTES / 2, `desktop/plugin.js is ${size} B, over ${PLUGIN_SOURCE_MAX_BYTES / 2} B (50 % of the host limit)`)
})

test('one version: plugin.yaml, dashboard manifest, dev/package.json, bundle banner, package', () => {
  const yaml = text('plugin.yaml').match(/^version:\s*["']?([\d.]+)["']?\s*$/m)?.[1]
  assert.ok(yaml, 'plugin.yaml has a version')
  assert.equal(JSON.parse(text('dashboard/manifest.json')).version, yaml, 'dashboard/manifest.json')
  assert.equal(JSON.parse(text('dev/package.json')).version, yaml, 'dev/package.json')
  assert.equal(text('desktop/plugin.js').match(/^\/\/ Officecraft ([\d.]+) /)?.[1], yaml, 'desktop/plugin.js banner')
  assert.equal(text('hermes_officecraft/__init__.py').match(/__version__ = "([\d.]+)"/)?.[1], yaml, 'hermes_officecraft/__version__')
})

test('no package.json at the repository root (Hermes would ask users to install Node deps)', () => {
  assert.equal(existsSync(root('package.json')), false)
})

test('nothing dev-only or binary is tracked, except the README images of docs/images/ (it would be installed on every user machine)', () => {
  let tracked
  try { tracked = execFileSync('git', ['ls-files'], { cwd: root('.'), encoding: 'utf8' }).split('\n').filter(Boolean) } catch { return }  // no git: skip
  // docs/images/ is the one folder allowed to hold pictures.
  const bad = tracked.filter(f => /(^|\/)(node_modules|\.venv|__pycache__)\//.test(f) || /\.local\.html$|\.pyc$/.test(f) || (!f.startsWith('docs/images/') && /\.(png|jpe?g|gif|webp)$/.test(f)))
  assert.deepEqual(bad, [])
})
}

// ===== delivery =====
{
// The delivery controls in CI — plugin.yaml, dashboard/manifest.json and the files the install ships.
// (1) the real repository passes; (2) each control FAILS on a broken copy, so the check cannot rot into a test that never fails.
const root = p => new URL(`../../${p}`, import.meta.url)
const read = p => { try { return readFileSync(root(p), 'utf8') } catch { return null } }

function realRepo() {
  const packageFiles = readdirSync(root('hermes_officecraft')).filter(n => n.endsWith('.py'))
  const paths = ['plugin.yaml', '__init__.py', 'LICENSE', 'README.md', 'desktop/plugin.js', 'dashboard/index.js', 'dashboard/manifest.json', 'dashboard/plugin_api.py',
    ...packageFiles.map(n => `hermes_officecraft/${n}`)]
  let tracked = null
  try { tracked = execFileSync('git', ['ls-files'], { cwd: root('.'), encoding: 'utf8' }).split('\n').filter(Boolean) } catch { /* no git: the tracked check is skipped */ }
  return { yaml: read('plugin.yaml'), manifest: read('dashboard/manifest.json'), initPy: read('__init__.py'), packageFiles, tracked,
    files: Object.fromEntries(paths.map(p => [p, read(p)])) }
}
const broken = mutate => { const r = structuredClone(realRepo()); mutate(r); return deliveryProblems(r) }

test('the repository is deliverable: plugin.yaml, dashboard/manifest.json and every shipped file check out', () => {
  assert.deepEqual(deliveryProblems(realRepo()), [])
})

test('plugin.yaml is read the way the checker says (flat keys, lists)', () => {
  const y = parsePluginYaml(read('plugin.yaml'))
  assert.equal(y.name, 'hermes-officecraft')
  assert.equal(y.manifest_version, '1')
  assert.deepEqual(y.provides_tools, [])
  assert.deepEqual(y.provides_hooks, ['on_kanban_dispatch_tick', 'pre_approval_request', 'post_approval_response'])
  assert.deepEqual(registeredHooks(read('__init__.py')).sort(), [...y.provides_hooks].sort())
  assert.ok(siblingImports(read('hermes_officecraft/api.py')).includes('orders'))
})

test('a missing plugin.yaml key, a bad version or a bad requires_hermes is refused', () => {
  assert.ok(broken(r => { r.yaml = r.yaml.replace(/^author:.*\n/m, '') }).some(p => /`author` is missing/.test(p)))
  assert.ok(broken(r => { r.yaml = r.yaml.replace(/^version:.*$/m, 'version: 0.1') }).some(p => /not x\.y\.z/.test(p)))
  assert.ok(broken(r => { r.yaml = r.yaml.replace(/^requires_hermes:.*$/m, 'requires_hermes: latest') }).some(p => /requires_hermes/.test(p)))
  assert.ok(broken(r => { r.yaml += 'oops this is not yaml\n' }).some(p => /not `key: value`/.test(p)))
})

test('the hooks announced and the hooks registered must be the same set', () => {
  assert.ok(broken(r => { r.yaml = r.yaml.replace(/^ {2}- post_approval_response\n/m, '') }).some(p => /provides_hooks/.test(p)))
  assert.ok(broken(r => { r.initPy = r.initPy.replace('ctx.register_hook("pre_approval_request", notifier.on_approval)', '') }).some(p => /provides_hooks/.test(p)))
})

test('dashboard/manifest.json: same name and version as plugin.yaml, entry and api files exist, tab stays hidden', () => {
  const edit = f => broken(r => { r.manifest = JSON.stringify(f(JSON.parse(r.manifest))) })
  assert.ok(edit(m => ({ ...m, name: 'other' })).some(p => /name `other`/.test(p)))
  assert.ok(edit(m => ({ ...m, version: '9.9.9' })).some(p => /version `9\.9\.9`/.test(p)))
  assert.ok(edit(m => ({ ...m, entry: 'nope.js' })).some(p => /dashboard\/nope\.js/.test(p)))
  assert.ok(edit(m => ({ ...m, api: '../plugin.yaml' })).some(p => /inside dashboard/.test(p)))
  assert.ok(edit(m => ({ ...m, tab: { hidden: false } })).some(p => /tab must stay hidden/.test(p)))
  assert.ok(edit(m => { const { label, ...rest } = m; return rest }).some(p => /`label` is missing/.test(p)))
  assert.ok(broken(r => { r.manifest = '{nope' }).some(p => /not valid JSON/.test(p)))
  assert.ok(broken(r => { r.files['dashboard/plugin_api.py'] = 'x = 1\n' }).some(p => /router/.test(p)))
})

test('a shipped file that is absent, empty or untracked is refused', () => {
  assert.ok(broken(r => { r.files['desktop/plugin.js'] = null }).some(p => /desktop\/plugin\.js is absent/.test(p)))
  assert.ok(broken(r => { r.files.LICENSE = '' }).some(p => /LICENSE is absent or empty/.test(p)))
  const r = realRepo()
  if (r.tracked) {
    r.tracked = r.tracked.filter(f => f !== 'hermes_officecraft/notify.py')
    assert.ok(deliveryProblems(r).some(p => /notify\.py exists but is not tracked/.test(p)))
  }
})

test('a module the package imports from itself must be shipped', () => {
  assert.ok(broken(r => {
    r.packageFiles = r.packageFiles.filter(n => n !== 'audit.py')
    delete r.files['hermes_officecraft/audit.py']
  }).some(p => /imports `\.audit`, which is not shipped/.test(p)))
})
}

// ===== delivery =====
{
// Hermes' install scanner (hermes-agent `tools/plugin_guard.py`, pattern `invisible_unicode`) rates every
// invisible character it meets HIGH, and a single HIGH turns the scan verdict of the whole tree to
// `caution`: `hermes plugins install` then stops on `Decision: BLOCKED` and asks the user for `--force`.
// One zero-width space is a legitimate *value* here: `src/core/notifyFormat.js` slips it inside
// `@everyone` and inside `scheme://` so the message renders as text (a port of notify_format.py). It is
// written as an escape in the source, but esbuild re-emits it literally unless the build keeps ASCII
// output — the bundle is what Hermes scans. So: the committed bundle carries none, and the build must
// not start carrying one again.
// This list is the scanner's own `_INVISIBLE_CHAR_NAMES`: zero-width, bidi controls, BOM, soft hyphen.
const INVISIBLE = ['\u200b', '\u200c', '\u200d', '\u2060', '\u2062', '\u2063', '\u2064', '\ufeff',
  '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069']
const bundlePath = new URL('../../desktop/plugin.js', import.meta.url)
const invisibleIn = text => [...text].filter(c => INVISIBLE.includes(c))
const name = c => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`

test('desktop/plugin.js carries no literal invisible character (the scanner rates each one HIGH → caution)', () => {
  assert.deepEqual(invisibleIn(readFileSync(bundlePath, 'utf8')).map(name), [])
})

test('…and the reader above does see one when it is there (the check cannot rot into a test that never fails)', () => {
  assert.deepEqual(invisibleIn(`a${'\u200b'}b`).map(name), ['U+200B'])
})
}
