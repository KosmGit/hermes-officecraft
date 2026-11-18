// Gate for the committed bundle:
//  1. desktop/plugin.js is exactly what the sources build to (no stale/hand edits);
//  2. it imports only the three host modules;
//  3. literal colours live ONLY in src/scene/ (the art palette); everywhere else, theme variables only.
//     Checked twice: on the source files outside src/scene/, and on the bundle, where the unminified output
//     precedes every module with a `// src/...` marker, so colours are accepted only in sections from src/scene/.
// The checks are exported functions (tests/js/check.test.mjs); the gate itself runs only when this file is the entry point.
import { build } from 'esbuild'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ALLOWED_IMPORTS, options } from './build.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

export const SCENE_DIR = 'src/scene/'
export const COLOR_PATTERNS = [
  [/["'`][^"'`\n]*#[0-9a-fA-F]{3,8}\b[^"'`\n]*["'`]/g, 'hex color'],
  [/\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\s*\(/g, 'color function'],
  [/:\s*["'](?:black|white|red|green|blue|gray|grey)["']/g, 'named color']
]

/** Source text without block comments and whole-line `//` comments (a colour named in a comment is not a colour used). */
export const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Every literal colour in a piece of source: [{ label, text }]. */
export function findColors(text) {
  const code = stripComments(text)
  const found = []
  for (const [re, label] of COLOR_PATTERNS) for (const m of code.matchAll(re)) found.push({ label, text: m[0].slice(0, 60) })
  return found
}

/** Repo-relative, forward-slash path. */
export const normPath = p => p.split(sep).join('/').replace(/^\.\//, '')
export const isSceneFile = p => normPath(p).startsWith(SCENE_DIR)

/** Source files: [{ path, text }]. Colours outside src/scene/ are failures. */
export function checkSourceColors(files) {
  const failures = []
  for (const f of files) {
    if (isSceneFile(f.path)) continue
    for (const c of findColors(f.text)) failures.push(`${c.label} in ${normPath(f.path)} (colours belong in ${SCENE_DIR} only): ${c.text}`)
  }
  return failures
}

/**
 * The bundle cut on esbuild's `// src/...` module markers (at column 0, BEFORE comments are stripped).
 * Text before the first marker (banner, host imports) is a section with path ''.
 */
export function splitBundle(bundle) {
  const marker = /^\/\/ (src\/[\w./@~+-]+)$/gm
  const sections = []
  let path = ''
  let from = 0
  for (const m of bundle.matchAll(marker)) {
    sections.push({ path, code: bundle.slice(from, m.index) })
    path = m[1]
    from = m.index + m[0].length
  }
  sections.push({ path, code: bundle.slice(from) })
  return sections
}

/**
 * Colours are accepted only in sections that come from src/scene/. `sceneFiles` (optional) is the set of real
 * src/scene/ paths: a marker that names no real file (a comment faking one) earns no exemption.
 */
export function checkBundleColors(bundle, sceneFiles = null) {
  const failures = []
  for (const s of splitBundle(bundle)) {
    const exempt = isSceneFile(s.path) && (!sceneFiles || sceneFiles.has(s.path))
    if (exempt) continue
    for (const c of findColors(s.code)) failures.push(`${c.label} in bundle${s.path ? ` (${s.path})` : ''}: ${c.text}`)
  }
  return failures
}

const SOURCE_EXT = /\.(?:jsx?|mjs|tsx?|css)$/
/**
 * The SDK names the bundle may import BY NAME: those every Hermes Desktop since the plugin SDK's first release (2026-07-13)
 * exports. A named import of anything newer makes an older desktop refuse the whole plugin at link time (« does not provide an
 * export named … », seen with `randomUuid`, added 2026-10-27). A newer name is read through `import * as sdk` with a fallback.
 */
export const SDK_BASELINE = Object.freeze(['EmptyState', 'PALETTE_AREA', 'ROUTES_AREA', 'SIDEBAR_NAV_AREA', 'STATUSBAR_AREAS', 'Tip',
  'atom', 'haptic', 'host', 'useI18n', 'useQuery', 'useQueryClient', 'useValue'])

export function checkSdkNames(bundle) {
  const out = []
  for (const m of bundle.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@hermes\/plugin-sdk["']/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]
      if (name && !SDK_BASELINE.includes(name)) out.push(`named SDK import not in every Hermes Desktop: ${name} (use import * as sdk + fallback)`)
    }
  }
  return out
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (SOURCE_EXT.test(name)) out.push(p)
  }
  return out
}

async function main() {
  const failures = []
  const bundlePath = 'desktop/plugin.js'
  const bundle = readFileSync(join(ROOT, bundlePath), 'utf8')

  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'officecraft-check-'))
  try {
    const fresh = join(dir, 'plugin.js')
    await build({ ...options(fresh), logLevel: 'silent' })
    if (readFileSync(fresh, 'utf8') !== bundle) failures.push('desktop/plugin.js is stale: run `npm --prefix dev run build` and commit it')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const specifiers = new Set()
  for (const m of bundle.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm)) {
    specifiers.add(m[1] || m[2] || m[3])
  }
  for (const spec of specifiers) {
    if (!ALLOWED_IMPORTS.includes(spec)) failures.push(`forbidden import: ${spec}`)
  }
  failures.push(...checkSdkNames(bundle))

  const srcDir = join(ROOT, 'src')
  const files = existsSync(srcDir) ? walk(srcDir).map(p => ({ path: normPath(relative(ROOT, p)), text: readFileSync(p, 'utf8') })) : []
  failures.push(...checkSourceColors(files))
  const sceneFiles = new Set(files.map(f => f.path).filter(isSceneFile))
  failures.push(...checkBundleColors(bundle, sceneFiles))

  if (failures.length) {
    console.error(failures.map(f => `✗ ${f}`).join('\n'))
    process.exit(1)
  }
  console.log(`✓ bundle up to date · imports: ${[...specifiers].join(', ')} · literal colors only in ${SCENE_DIR} (${sceneFiles.size} files)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
