// Literal colours live only in src/scene/. The gate (dev/check.mjs) is exercised here on fake modules and on the real tree.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkBundleColors, checkSourceColors, findColors, isSceneFile, splitBundle } from '../../dev/check.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const HEX = "export const sky = '#3d7bfd'\n"

test('a literal colour in src/ui fails; the same one in src/scene passes', () => {
  assert.equal(checkSourceColors([{ path: 'src/ui/x.js', text: HEX }]).length, 1)
  assert.deepEqual(checkSourceColors([{ path: 'src/scene/x.js', text: HEX }]), [])
  assert.equal(checkSourceColors([{ path: 'src/scene/x.js', text: HEX }, { path: 'src/ui/x.js', text: HEX }]).length, 1, 'only the ui copy fails')
})

test('the exemption is the src/scene/ folder, not a file or folder that merely mentions "scene"', () => {
  for (const path of ['src/ui/scene/x.js', 'src/ui/SceneView.jsx', 'src/scenery/x.js', 'src/core/scene.js']) {
    assert.equal(checkSourceColors([{ path, text: HEX }]).length, 1, path)
    assert.equal(checkBundleColors(bundleOf([path, HEX])).length, 1, `bundle ${path}`)
  }
})

test('colour functions and named colours fail outside src/scene, in every other folder', () => {
  assert.equal(checkSourceColors([{ path: 'src/core/y.js', text: 'const c = `rgba(0, 0, 0, .5)`\n' }]).length, 1)
  assert.equal(checkSourceColors([{ path: 'src/ui/z.jsx', text: "const s = { color: 'white' }\n" }]).length, 1)
  assert.equal(checkSourceColors([{ path: 'src/data/q.js', text: 'const h = hsl(10 20% 30%)\n' }]).length, 1)
  assert.equal(checkSourceColors([{ path: 'src/index.jsx', text: "const a = '#abc'\n" }]).length, 1)
  assert.deepEqual(checkSourceColors([{ path: 'src/scene/palette.js', text: "const c = 'rgba(1,2,3,.5)'; const d = { color: 'white' }\n" }]), [])
})

test('theme variables and ordinary strings are fine everywhere', () => {
  const ok = "const s = { color: 'var(--accent)', background: 'color-mix(in srgb, var(--a) 40%, transparent)' }\nconst t = 'Issue number 12'\n"
  assert.deepEqual(checkSourceColors([{ path: 'src/ui/ok.jsx', text: ok }]), [])
})

test('a colour named in a comment is not a colour used', () => {
  assert.deepEqual(findColors("// was '#fff'\n/* rgba(0,0,0,.5) */\nconst a = 1\n"), [])
  assert.equal(findColors("const a = '#fff' // x\n").length, 1)
})

test('scene files are recognised by folder, whatever the path separator', () => {
  assert.equal(isSceneFile('src/scene/a.js'), true)
  assert.equal(isSceneFile('./src/scene/deep/a.js'), true)
  assert.equal(isSceneFile('src/scenery/a.js'), false)
  assert.equal(isSceneFile('src/ui/scene/a.js'), false)
  assert.equal(isSceneFile('tests/scene/a.js'), false)
})

/* the bundle: esbuild (unminified) puts `// src/...` before every module */
const bundleOf = (...mods) => ['// Officecraft 0.1.0 banner', "import x from 'react'", ...mods.map(([p, code]) => `// ${p}\n${code}`)].join('\n')

test('bundle: colours are accepted only in sections that come from src/scene/', () => {
  assert.deepEqual(checkBundleColors(bundleOf(['src/scene/x.js', HEX])), [])
  assert.equal(checkBundleColors(bundleOf(['src/ui/x.js', HEX])).length, 1)
  assert.equal(checkBundleColors(bundleOf(['src/core/y.js', 'const c = `rgba(0,0,0,.5)`'])).length, 1)
})

test('bundle: the section after a scene module is not exempt (cut on the markers BEFORE stripping comments)', () => {
  const failures = checkBundleColors(bundleOf(['src/scene/x.js', HEX], ['src/ui/x.js', HEX], ['src/scene/y.js', HEX]))
  assert.equal(failures.length, 1)
  assert.match(failures[0], /src\/ui\/x\.js/)
})

test('bundle: text before the first marker (banner, host imports) is not exempt either', () => {
  assert.equal(checkBundleColors(`const a = '#fff'\n// src/scene/x.js\n${HEX}`).length, 1)
})

test('bundle: a marker that names no real scene file earns no exemption', () => {
  const real = new Set(['src/scene/x.js'])
  assert.deepEqual(checkBundleColors(bundleOf(['src/scene/x.js', HEX]), real), [])
  assert.equal(checkBundleColors(bundleOf(['src/scene/fake.js', HEX]), real).length, 1)
})

test('bundle: sections are split on column-0 markers only', () => {
  const sections = splitBundle(bundleOf(['src/scene/a.js', 'const x = 1\n  // src/ui/not-a-marker.js'], ['src/ui/b.jsx', 'const y = 2']))
  assert.deepEqual(sections.map(s => s.path), ['', 'src/scene/a.js', 'src/ui/b.jsx'])
})

test('the real tree: no literal colour outside src/scene (sources and committed bundle)', () => {
  const files = []
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(?:jsx?|mjs|tsx?|css)$/.test(name)) files.push({ path: p.slice(ROOT.length), text: readFileSync(p, 'utf8') })
    }
  }
  walk(join(ROOT, 'src'))
  assert.ok(files.length > 5)
  assert.deepEqual(checkSourceColors(files), [])
  const scene = new Set(files.map(f => f.path).filter(isSceneFile))
  assert.deepEqual(checkBundleColors(readFileSync(join(ROOT, 'desktop/plugin.js'), 'utf8'), scene), [])
})
