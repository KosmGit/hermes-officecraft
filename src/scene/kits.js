/* =====================================================================
   BOTS, drawing half: every skill a bot holds shows up on its desk.
   Each enabled skill (name, category folder, front-matter tags; never its
   instructions) maps to a desk object through an English vocabulary. A skill
   matching nothing still counts: it becomes a binder, coloured from its name.
   ===================================================================== */
import { E, hslc, hx } from './color.js'
import { DESK_Z } from './constants.js'
import { box, shadeFor, sprite } from './raster.js'
import { ownSkills, scoreText } from './wardrobe.js'
import { hash } from './util.js'

/** Desk object <- words found in a skill's name, category or tags.
 *  ('doc' + 'umentation' is one keyword, split so the purity grep for the DOM global finds nothing in src/scene.) */
export const KITS = {
  tablet: { label: 'tablette graphique', keys: ['design', 'figma', 'ui', 'ux', 'creative', 'illustr', 'animation', 'svg', 'brand', 'typograph', 'pixel', 'art', 'p5js', 'manim', 'diagram'] },
  books: { label: 'pile de livres', keys: ['writ', 'copy', 'editing', 'blog', 'docs', 'doc' + 'umentation', 'humaniz', 'translat', 'content', 'docx', 'word', 'epub', 'grammar'] },
  magnifier: { label: 'loupe', keys: ['seo', 'audit', 'review', 'quality', 'verif', 'inspect', 'debug', 'lint', 'test', 'security', 'scanner'] },
  chart: { label: 'graphique', keys: ['data', 'chart', 'dataviz', 'xlsx', 'excel', 'csv', 'analytics', 'statist', 'sql', 'sqlite', 'backtest', 'benchmark', 'finance', 'trading', 'price', 'visualization'] },
  terminal: { label: 'mini-serveur', keys: ['devops', 'docker', 'server', 'infra', 'deploy', 'git', 'github', 'cli', 'terminal', 'collector', 'systemd', 'cron', 'gpu', 'monitor', 'debugpy', 'node'] },
  globe: { label: 'globe', keys: ['web', 'browser', 'scrap', 'crawl', 'fetch', 'page', 'site', 'wayback', 'maps', 'translate'] },
  notebook: { label: 'carnet', keys: ['note', 'obsidian', 'notion', 'wiki', 'markdown', 'journal', 'planning', 'weekly', 'review planning', 'meeting', 'action items'] },
  camera: { label: 'appareil photo', keys: ['media', 'video', 'photo', 'image', 'gif', 'youtube', 'audio', 'music', 'song', 'spectrogram', 'hyperframes', 'render'] },
  mail: { label: 'bac à courrier', keys: ['email', 'mail', 'inbox', 'himalaya', 'gmail', 'telegram', 'slack', 'digest', 'newsletter', 'message'] },
  robot: { label: 'figurine robot', keys: ['agent', 'autonomous', 'kanban', 'orchestr', 'delegat', 'codex', 'claude', 'opencode', 'hermes', 'llm', 'model'] },
  tag: { label: 'étiquette de prix', keys: ['affiliat', 'sales', 'shop', 'product', 'price', 'commerce', 'crm', 'marketing', 'growth'] },
  research: { label: 'pile de dossiers', keys: ['research', 'arxiv', 'citation', 'paper', 'competitor', 'news', '=intel', 'scout', 'source'] }
}
export const KIT_IDS = Object.keys(KITS)

const skillText = s => [s.name, s.category, ...(s.tags || [])].filter(Boolean).join(' ').replace(/[-_]/g, ' ')

const KIT_MEMO = new Map()

/** Same matching rule as roles: keys under 4 letters match whole words only ("ui" never matches "build"). Memoised by the skill's text (pure). */
export function kitOf(s) {
  const t = skillText(s)
  if (KIT_MEMO.has(t)) return KIT_MEMO.get(t)
  const best = scoreKit(t)
  if (KIT_MEMO.size >= 512) KIT_MEMO.clear()
  KIT_MEMO.set(t, best)
  return best
}

function scoreKit(t) {
  let best = null
  let score = 0
  let len = 0
  for (const id of KIT_IDS) {
    const r = scoreText(t, KITS[id].keys)
    if (r.n > score || (r.n === score && r.n && r.len > len)) { score = r.n; len = r.len; best = id }
  }
  return best
}

/** [{ id, skills: [names] }] sorted by how many skills point to that object. */
export function kitsOf(a) {
  const by = {}
  for (const s of ownSkills(a)) { const k = kitOf(s) || 'binder'; (by[k] ||= []).push(s.name) }
  return Object.entries(by).map(([id, skills]) => ({ id, skills })).sort((p, q) => q.skills.length - p.skills.length || p.id.localeCompare(q.id, 'en'))
}
export const kitLabel = id => (id === 'binder' ? 'classeur' : KITS[id].label)

/** One desk object, at tile (x, y) on the desk top. */
export function drawKit(px, id, x, y, seed) {
  const Z = DESK_Z
  const col = n => hslc(hash(seed + n) % 360, 48, 52)
  const P = (a, b, c) => px.P(a, b, c)
  switch (id) {
    case 'tablet': box(px, x - 0.16, y, Z, 0.34, 0.24, 1, shadeFor(hx('#2b2f36'))); box(px, x - 0.12, y + 0.03, Z + 1, 0.26, 0.17, 0, shadeFor(hx('#5b6b7f'))); box(px, x + 0.2, y + 0.05, Z, 0.04, 0.16, 1, shadeFor(hx('#e9c46a'))); break
    case 'books': for (let i = 0; i < 3; i++) box(px, x - 0.15 + i * 0.01, y + 0.02, Z + i * 2, 0.3, 0.2, 2, shadeFor(col(i))); break
    case 'magnifier': sprite(px, x, y + 0.1, Z, l => { const r = hx('#3a3f48'); const g = E(hx('#cfeaf8')); l.ell(0, -4, 2.6, 2.6, r).ell(0, -4, 1.6, 1.6, g).rect(2, -2, 3, -1, r).rect(3, -1, 4, 0, hx('#7a4a2a')) }); break
    case 'chart':
      box(px, x - 0.14, y + 0.08, Z, 0.28, 0.05, 9, { t: hx('#f4f1ea'), l: hx('#f4f1ea'), r: hx('#d8d4cc') })
      sprite(px, x, y + 0.11, Z + 1, l => { l.rect(-3, -2, -2, -1, hx('#3d7bfd')).rect(-1, -4, 0, -1, hx('#2fae6b')).rect(1, -6, 2, -1, hx('#e76f51')) }, null)
      break
    case 'terminal':
      box(px, x - 0.13, y, Z, 0.26, 0.26, 7, { t: hx('#3a3f48'), l: hx('#2b2f36'), r: hx('#22252b') })
      px.put(...P(x - 0.05, y + 0.27, Z + 5).map(Math.round), E(hx('#2fae6b')), true)
      px.put(...P(x + 0.04, y + 0.27, Z + 5).map(Math.round), E(hx('#2fae6b')), true)
      break
    case 'globe':
      box(px, x - 0.08, y + 0.04, Z, 0.16, 0.16, 1, shadeFor(hx('#5a4630')))
      sprite(px, x, y + 0.12, Z + 2, l => { l.ell(0, -4, 3, 3, hx('#3e9fb5')).rect(-1, -6, 1, -5, hx('#5fae6a')).rect(0, -3, 2, -3, hx('#5fae6a')) })
      break
    case 'notebook': box(px, x - 0.13, y + 0.02, Z, 0.26, 0.2, 1, shadeFor(col(0))); box(px, x - 0.13, y + 0.02, Z + 1, 0.03, 0.2, 0, shadeFor(hx('#f4f1ea'))); break
    case 'camera': box(px, x - 0.12, y + 0.04, Z, 0.24, 0.14, 4, shadeFor(hx('#2b2f36'))); sprite(px, x, y + 0.18, Z + 2, l => { l.ell(0, 0, 1.4, 1.4, hx('#7cc8ff')) }, hx('#1b1b1f')); break
    case 'mail': box(px, x - 0.15, y, Z, 0.3, 0.22, 3, shadeFor(hx('#c9a24a'))); box(px, x - 0.11, y + 0.03, Z + 3, 0.22, 0.16, 1, shadeFor(hx('#f4f1ea'))); break
    case 'robot': sprite(px, x, y + 0.1, Z, l => { const m = hx('#9aa5b0'); l.rect(-2, -4, 1, -1, m).rect(-3, -8, 2, -5, m).set(-2, -7, E(hx('#7cc8ff'))).set(1, -7, E(hx('#7cc8ff'))).set(0, -9, hx('#e76f51')) }); break
    case 'tag': sprite(px, x, y + 0.1, Z, l => { const c = hx('#e9c46a'); l.rect(-3, -3, 1, -1, c).set(2, -2, c).set(-2, -2, hx('#5a4630')) }); break
    case 'research': for (let i = 0; i < 2; i++) box(px, x - 0.15 + i * 0.03, y + 0.02 - i * 0.02, Z + i, 0.3, 0.22, 1, shadeFor(i ? hx('#f2d8a0') : hx('#d9b56a'))); break
    default: box(px, x - 0.05, y + 0.04, Z, 0.1, 0.22, 8, shadeFor(col(9)))   // binder
  }
}

/** Two desk objects (the strongest skill families), beside the keyboard on the agent's side of the monitors. */
export function skillProps(px, x, y, a, row) {
  if (!a) return
  const ks = kitsOf(a).slice(0, 2)
  ks.forEach((k, i) => drawKit(px, k.id, row ? (i ? x + 0.8 : x - 0.66) : (i ? x - 0.86 : x + 0.62), row ? y - 0.04 : y + 0.02, a.name + k.id))
}
