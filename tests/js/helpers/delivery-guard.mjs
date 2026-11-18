// The delivery checks, as pure functions over a description of the repository, so that tests/js/delivery.test.mjs
// can run them on the real files AND on broken copies (a check that never fails proves nothing).
// Not a *.test.mjs file: the runner does not execute it by itself.

/** `plugin.yaml` is flat: `key: value` lines and `key:` followed by `  - item` lines (or `key: []`). No YAML library. */
export function parsePluginYaml(src) {
  const out = {}
  let list = null
  for (const raw of src.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    const item = raw.match(/^\s+-\s+(.+?)\s*$/)
    if (item && list) { list.push(item[1].replace(/^["']|["']$/g, '')); continue }
    const kv = raw.match(/^([a-z_]+):\s*(.*?)\s*$/)
    if (!kv) { out.__unparsed = [...(out.__unparsed || []), raw]; list = null; continue }
    const [, key, value] = kv
    if (value === '') { list = []; out[key] = list } else if (value === '[]') { list = null; out[key] = [] } else { list = null; out[key] = value.replace(/^["']|["']$/g, '') }
  }
  return out
}

/** Hook names `register(ctx)` hangs on (`ctx.register_hook("name", …)`). */
export const registeredHooks = initPy => [...initPy.matchAll(/register_hook\(\s*["']([a-z_]+)["']/g)].map(m => m[1])

/** Modules a package file imports from its own folder (`from . import a, b`, `from .a import x`). */
export function siblingImports(py) {
  const found = new Set()
  for (const m of py.matchAll(/^\s*from\s+\.\s+import\s+([\w, ]+)/gm)) m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(n => found.add(n))
  for (const m of py.matchAll(/^\s*from\s+\.(\w+)\s+import\b/gm)) found.add(m[1])
  return [...found].filter(n => !n.startsWith('_'))   // `__version__` lives in __init__.py itself, it is not a module
}

/**
 * @param {{ yaml: string, manifest: string, initPy: string, files: Record<string, string|null>, tracked: string[]|null, packageFiles: string[] }} repo
 *   `files`: path -> content (null = absent) for every path the install ships; `tracked`: `git ls-files` (null = no git);
 *   `packageFiles`: the `hermes_officecraft/*.py` names, with the content of each in `files`.
 * @returns {string[]} the problems; empty = deliverable.
 */
export function deliveryProblems(repo) {
  const bad = []
  const y = parsePluginYaml(repo.yaml)
  for (const key of ['name', 'version', 'description', 'author', 'license', 'manifest_version', 'requires_hermes', 'kind']) {
    if (!y[key]) bad.push(`plugin.yaml: \`${key}\` is missing`)
  }
  if (y.__unparsed) bad.push(`plugin.yaml: lines that are not \`key: value\` or list items: ${JSON.stringify(y.__unparsed)}`)
  if (y.version && !/^\d+\.\d+\.\d+$/.test(y.version)) bad.push(`plugin.yaml: version \`${y.version}\` is not x.y.z`)
  if (y.manifest_version && y.manifest_version !== '1') bad.push(`plugin.yaml: manifest_version \`${y.manifest_version}\` (this checker knows 1)`)
  if (y.requires_hermes && !/^>=\d+\.\d+\.\d+$/.test(y.requires_hermes)) bad.push(`plugin.yaml: requires_hermes \`${y.requires_hermes}\` is not \`>=x.y.z\``)
  if (y.kind && y.kind !== 'standalone') bad.push(`plugin.yaml: kind \`${y.kind}\` (Officecraft is standalone)`)
  for (const key of ['provides_tools', 'provides_hooks', 'provides_middleware', 'requires_env']) {
    if (y[key] !== undefined && !Array.isArray(y[key])) bad.push(`plugin.yaml: \`${key}\` is not a list`)
  }

  // the hooks the manifest announces are the hooks `register` hangs, no more and no fewer
  const announced = [...(y.provides_hooks || [])].sort()
  const hung = [...registeredHooks(repo.initPy)].sort()
  if (JSON.stringify(announced) !== JSON.stringify(hung)) bad.push(`provides_hooks ${JSON.stringify(announced)} differs from the hooks __init__.py registers ${JSON.stringify(hung)}`)

  let manifest = null
  try { manifest = JSON.parse(repo.manifest) } catch { bad.push('dashboard/manifest.json is not valid JSON') }
  if (manifest) {
    for (const key of ['name', 'label', 'version', 'description', 'entry', 'api']) if (!manifest[key]) bad.push(`dashboard/manifest.json: \`${key}\` is missing`)
    if (manifest.name !== y.name) bad.push(`dashboard/manifest.json name \`${manifest.name}\` differs from plugin.yaml \`${y.name}\``)
    if (manifest.version !== y.version) bad.push(`dashboard/manifest.json version \`${manifest.version}\` differs from plugin.yaml \`${y.version}\``)
    if (manifest.tab?.hidden !== true) bad.push('dashboard/manifest.json: the tab must stay hidden (the page is the desktop plugin)')
    for (const key of ['entry', 'api']) {
      const f = manifest[key]
      if (typeof f !== 'string' || /^\/|\.\./.test(f)) bad.push(`dashboard/manifest.json: \`${key}\` must be a file name inside dashboard/`)
      else if (!repo.files[`dashboard/${f}`]) bad.push(`dashboard/manifest.json: \`${key}\` points to dashboard/${f}, which is absent or empty`)
    }
    if (repo.files['dashboard/plugin_api.py'] && !/^router\s*=|^from\s.*\bimport\b.*\brouter\b/m.test(repo.files['dashboard/plugin_api.py'])) {
      bad.push('dashboard/plugin_api.py does not expose a `router`')
    }
  }

  // what the install ships (it copies the git tree): present, not empty, tracked
  const shipped = ['plugin.yaml', '__init__.py', 'LICENSE', 'README.md', 'desktop/plugin.js', 'dashboard/index.js', 'dashboard/manifest.json', 'dashboard/plugin_api.py',
    ...repo.packageFiles.map(n => `hermes_officecraft/${n}`)]
  for (const f of shipped) {
    if (!repo.files[f]) bad.push(`${f} is absent or empty`)
    else if (repo.tracked && !repo.tracked.includes(f)) bad.push(`${f} exists but is not tracked by git (an install from Git would not ship it)`)
  }
  // every module the package imports from itself is a file of the package
  for (const name of repo.packageFiles) {
    for (const mod of siblingImports(repo.files[`hermes_officecraft/${name}`] || '')) {
      if (!repo.packageFiles.includes(`${mod}.py`)) bad.push(`hermes_officecraft/${name} imports \`.${mod}\`, which is not shipped`)
    }
  }
  if (!repo.files['hermes_officecraft/__init__.py']) bad.push('hermes_officecraft/__init__.py is the package entry: absent')
  return bad
}
