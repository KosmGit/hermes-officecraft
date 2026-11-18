/* =====================================================================
   WARDROBE: every agent dresses for its role in the user's setup,
   whatever the setup and whatever the language.
   Role = best score over three signals, all normalised (lower case, accents
   stripped): profile NAME (x3) · SKILL names (x2, mostly English slugs, so
   language-neutral) · DESCRIPTION (x1). Ties go to the most specific keyword.
   Keywords: English first, plus packs in fr / es / de / it / pt and a few
   CJK terms. A hand-picked role (agent.roleOverride) always wins. No role
   found = an outfit composed from the name (garment, colour, accessories),
   never one uniform "default" look.
   Each role has several looks and palettes, picked from the name, so five
   developers never look identical.
   Pure module: no DOM, no storage (the override arrives on the agent).
   ===================================================================== */
import { hslc, hx, mixc, mulc } from './color.js'
import { Lay } from './raster.js'
import { lookOf } from './palette.js'
import { hash, norm } from './util.js'
import { EXTRA_GARMENTS, EXTRA_ROLES } from './wardrobeExtra.js'

export const ROLES = {
  executive: { label: 'Direction',
    keys: ['ceo', 'cto', 'coo', 'cfo', 'founder', 'executive', '=director', 'boss', 'chief', 'president', 'fondateur', 'directeur', 'directrice', 'dirigeant', 'pdg', 'patron', 'fundador', 'director general', 'geschaftsfuhr', 'grunder', 'vorstand', 'amministratore', 'fondatore', 'presidente', '社長', '总裁', '老板'],
    looks: [{ g: 'shirtTie', main: ['#f1f2f4', '#e8eef7'], acc: ['#a32a2a', '#2c3e66', '#3b6b4a'] }, { g: 'suit', main: ['#2b3140', '#3a3436'], acc: ['#a32a2a', '#c9a24a'] }] },
  manager: { label: 'Coordination',
    keys: ['orchestr', 'manager', 'coordinat', '=lead', 'team lead', 'project', 'product owner', 'scrum', 'planner', 'dispatch', 'router', 'chef de projet', 'chef projet', 'chef d orchestre', 'pilotage', 'coordonn', 'jefe de proyecto', 'coordinador', 'projektleit', 'leiter', 'capo progetto', 'gestor de projeto', 'マネージャ', '项目', '协调'],
    looks: [{ g: 'shirt', main: ['#dfe9f5', '#f4efe6', '#e6f0e6'], acc: ['#3d7bfd', '#e76f51'], lanyard: true }, { g: 'waistcoat', main: ['#4a4f5c', '#5a4636'], acc: ['#dfe9f5'] }] },
  designer: { label: 'Design',
    keys: ['design', 'ui', 'ux', 'graphi', 'figma', 'illustr', 'brand', 'typograph', 'animation', 'motion design', 'motion graphic', 'frontend', 'front-end', 'interface', 'diseno', 'disenador', 'grafico', 'gestalt', 'grafik', 'progettazione', 'grafica', 'デザイン', '设计'],
    looks: [{ g: 'blazer', main: ['#2b2d38', '#3b2f3f', '#2f3a33'], acc: ['#ece4d6', '#1d1d22'], glasses: 'round', hair: 2 }, { g: 'tee', main: ['#1f2024', '#f2efe9'], acc: ['#e76f51'], beret: '#2b2f36', glasses: 'round' }] },
  developer: { label: 'Développement',
    keys: ['dev', 'developer', 'engineer', 'coding', 'programm', 'backend', 'back-end', 'fullstack', 'api', 'software', 'github', 'git', 'docker', 'python', 'javascript', 'typescript', '=rust', 'compil', 'developpe', 'ingenieur', 'desarroll', 'programad', 'entwickl', 'sviluppat', 'desenvolv', '開発', 'エンジニア', '开发', '程序'],
    looks: [{ g: 'hoodie', main: ['#4c6070', '#5b4c70', '#3f6b5c', '#6b4c4c'], acc: ['#e8e8e8'], headphones: true }, { g: 'tee', main: ['#2f3b4f', '#5b6b7f', '#3e9fb5'], acc: ['#ffd75e'], headphones: true }] },
  devops: { label: 'Exploitation',
    keys: ['ops', 'devops', 'sre', 'infra', 'sysadmin', 'deploy', 'server', 'backup', 'monitor', 'cloud', 'kubernetes', 'serveur', 'sauvegard', 'supervis', 'infraestructura', 'servidor', 'betrieb', 'sistemist', 'インフラ', '运维'],
    looks: [{ g: 'flannel', main: ['#a33b2f', '#2f5d8a', '#3f6b3a'], acc: ['#1f2024'], headset: true }] },
  data: { label: 'Données',
    keys: ['data', 'analytics', 'statist', 'dataviz', 'sql', 'xlsx', '=excel', 'spreadsheet', 'dashboard', 'bi', 'donnee', 'tableur', 'datos', 'daten', '=dati', 'dados', 'データ', '数据'],
    looks: [{ g: 'sweater', main: ['#5b6b7f', '#8b62c9', '#3e9fb5'], acc: ['#f2ede4'], glasses: 'square' }] },
  researcher: { label: 'Veille',
    keys: ['research', 'scout', 'watch', '=intel', 'competitor', 'investigat', 'citation', 'arxiv', 'analyst', 'veille', 'recherche', 'concurrent', 'investigacion', 'vigilancia', 'forsch', 'ricerca', 'pesquis', '調査', '研究', '调研'],
    looks: [{ g: 'fieldVest', main: ['#6b7a3c', '#7a6a4a'], acc: ['#cdb88f'], cap: true }, { g: 'cardigan', main: ['#4e6b4a', '#5a4636'], acc: ['#f2ede4'], glasses: 'round' }] },
  writer: { label: 'Rédaction',
    keys: ['writ', '=author', '=authors', 'copywrit', 'content', 'blog', 'article', 'newsletter', 'docx', 'redact', 'redige', 'auteur', 'autrice', 'contenu', 'redactor', 'contenido', 'autor', 'texter', 'schreib', 'redattor', 'scrittor', '=escritor', '=escritora', '=escritores', 'ライター', '執筆', '写作'],
    looks: [{ g: 'cardigan', main: ['#b5703c', '#8a3b4a', '#4a5f8a'], acc: ['#f2ede4'], glasses: 'round' }] },
  reviewer: { label: 'Relecture',
    keys: ['review', 'qa', 'quality', 'testing', 'tests', 'tester', 'audit', 'secur', 'verif', 'relect', 'relit', 'relis', 'qualite', 'revision', 'revisor', 'calidad', 'prueba', 'prufer', 'qualitat', 'sicurezza', 'collaud', 'revisao', 'レビュー', '品質', '审查', '测试'],
    looks: [{ g: 'vest', main: ['#2f5d50', '#4a3f6b', '#6b4c2f'], acc: ['#dfe9f5'], glasses: 'square' }] },
  marketer: { label: 'Marketing',
    keys: ['marketing', 'seo', 'growth', 'acquisition', 'campaign', 'ads', 'social media', 'community', 'brand', 'mots-cles', 'referencement', 'campagne', 'mercadeo', 'posicionamiento', 'kampagn', 'マーケ', '营销'],
    looks: [{ g: 'polo', main: ['#2e8aa6', '#e07a3a', '#3fa06a'], acc: ['#f4f1ea'] }, { g: 'bomber', main: ['#3b4458', '#6b3b4f'], acc: ['#e9c46a'] }] },
  sales: { label: 'Commercial',
    keys: ['sales', 'selling', 'crm', 'partner', 'affiliat', 'business dev', 'monetiz', 'commerc', '=vente', '=ventes', 'vendeur', 'affil', 'monetis', 'ventas', 'vendedor', 'vertrieb', 'verkauf', 'vendit', 'vendas', '営業', '销售'],
    looks: [{ g: 'jacketOpen', main: ['#2c3e66', '#4a4f5c'], acc: ['#f6f7f9'] }] },
  support: { label: 'Support',
    keys: ['support', 'helpdesk', 'help center', 'help-center', 'customer', 'ticket', 'inbox', 'triage', 'assistance', 'soporte', 'atencion al cliente', 'kundend', 'assistenza', 'atendimento', 'サポート', '客服'],
    looks: [{ g: 'polo', main: ['#3d7bfd', '#2fae6b'], acc: ['#f4f1ea'], headset: true }] },
  legal: { label: 'Juridique',
    keys: ['legal', 'law', 'lawyer', 'contract', 'compliance', 'privacy', 'gdpr', 'juridi', 'avocat', 'contrat', 'conformite', 'rgpd', 'abogad', 'contrato', 'recht', 'vertrag', 'avvocat', 'advogad', '法務', '法律'],
    looks: [{ g: 'suit', main: ['#22252b', '#2c3e66'], acc: ['#7a1f1f', '#c9a24a'], glasses: 'square' }] },
  finance: { label: 'Finance',
    keys: ['financ', 'accounting', 'accountant', 'invoice', 'billing', 'budget', 'expense', 'tax', 'payroll', 'compta', 'factur', 'depense', 'contab', 'buchhalt', 'rechnung', 'fattur', '経理', '会计', '财务'],
    looks: [{ g: 'waistcoat', main: ['#3a3f4b', '#4a3f36'], acc: ['#f1f2f4'], glasses: 'square' }] },
  teacher: { label: 'Pédagogie',
    keys: ['teach', 'tutor', 'lesson', 'course', 'quiz', 'student', 'coach', 'mentor', 'professor', 'enseign', 'formateur', '=formation', '=formations', 'profesor', 'ensenanz', 'lehrer', 'unterricht', 'insegnant', '先生', '教育', '老师'],
    looks: [{ g: 'cardigan', main: ['#7a5a3a', '#4a5f8a'], acc: ['#f2ede4'], glasses: 'round' }] },
  media: { label: 'Création',
    keys: ['photo', 'video', 'image', 'music', 'audio', 'podcast', 'film', 'camera', 'retouch', 'imagen', 'musica', 'bild', 'musik', 'immagin', 'foto', '写真', '動画', '视频'],
    looks: [{ g: 'tee', main: ['#1f2024', '#3b2f3f'], acc: ['#e76f51'], beanie: true }] }
}
export const ROLE_IDS = Object.keys(ROLES)   // the 16 of the agent half's closed list (hermes_officecraft/llm.py ROLE_IDS; a test keeps both equal)
/* Trades the 16 did not cover, defined in ./wardrobeExtra.js and added here, not in the block above (the agent half's list is
   closed). They dress, are guessed and can be chosen like the others; the model's outfits and the bubbles only know the 16, so each
   extra role names its closest one (`wire`) for the places where the agent half receives a role (bubbles). */
Object.assign(ROLES, EXTRA_ROLES)
export const ALL_ROLE_IDS = Object.keys(ROLES)
/** The role the agent half understands for this one: itself when it is one of the 16, else the closest of them. */
export const wireRole = id => (id && ROLE_IDS.includes(id) ? id : id ? ROLES[id]?.wire ?? null : null)

/* Matching rule (roles and desk objects alike):
   - Latin keys match at the START of a word ("design" matches "designer", never "redesign"; "formation" never matches "information");
   - keys shorter than 4 letters, and keys written "=word", match whole words only ("ui" never in "build", "=excel" never in "excellent");
   - multi-word keys match as a phrase at word starts; CJK keys match anywhere (no spaces between words). */
const SHORT = 4
const LATIN = /^[a-z0-9 ]+$/
const keyRe = new Map()   // memo only: key -> matcher
function keyMatcher(k0) {
  if (keyRe.has(k0)) return keyRe.get(k0)
  const whole = k0.startsWith('=')
  const k = norm(whole ? k0.slice(1) : k0).replace(/[-_]/g, ' ')
  let m
  if (!LATIN.test(k)) m = t => t.includes(k)
  else {
    const end = whole || k.length < SHORT ? '(?![\\p{L}\\p{N}])' : ''
    const re = new RegExp('(?<![\\p{L}\\p{N}])' + k.replace(/ /g, '[^\\p{L}\\p{N}]+') + end, 'u')
    m = t => re.test(t)
  }
  const out = { m, len: k.length }
  keyRe.set(k0, out)
  return out
}

export function scoreText(text, keys) {
  const t = norm(text)
  if (!t) return { n: 0, len: 0, hit: '' }
  let n = 0
  let len = 0
  let hit = ''
  for (const k0 of keys) {
    const { m, len: kl } = keyMatcher(k0)
    if (m(t)) { n++; len += kl; if (!hit || kl > hit.length) hit = k0.replace(/^=/, '') }
  }
  return { n, len, hit }
}

/** An agent's own skills as [{ name, category, tags }]. Accepts the array form, `{ own }` and the legacy `{ names }`. */
export function ownSkills(a) {
  const sk = a?.skills
  if (Array.isArray(sk)) return sk
  if (sk?.own) return sk.own
  return (sk?.names || []).map(name => ({ name, category: '', tags: [] }))
}

const ROLE_MEMO = new Map()
const MEMO_MAX = 256

/** Best role from name / skills / description. why = { kind: 'name'|'skill'|'description', hit } (the UI words it). Memoised by (name, description, skills): pure, and called for every agent on every repaint. */
export function detectRole(a) {
  const key = JSON.stringify([a.name, a.description, ownSkills(a).map(s => [s.name, s.category, s.tags]), a.copiedSkills || null])
  if (ROLE_MEMO.has(key)) return ROLE_MEMO.get(key)
  const best = scoreRole(a)
  if (ROLE_MEMO.size >= MEMO_MAX) ROLE_MEMO.clear()
  ROLE_MEMO.set(key, best)
  return best
}

/* `a.copiedSkills` = the names of the skills the bot got by being copied from another one (the scene model fills it from
   `ui_meta['hermes-officecraft'].copiedFrom`). They say nothing about THIS bot's job (a `manager` copied from `default` carries its
   testing / audit / review skills): the guess ignores them, the name and the description decide, and the skills the bot gained since
   still count. */
function scoreRole(a) {
  const copied = new Set(Array.isArray(a.copiedSkills) ? a.copiedSkills : [])
  const skills = ownSkills(a).filter(s => !copied.has(s.name)).map(s => [s.name, s.category, ...(s.tags || [])].filter(Boolean).join(' ')).join(' ').replace(/[-_]/g, ' ')
  let best = null
  for (const id of ALL_ROLE_IDS) {
    const nm = scoreText(String(a.name).replace(/[-_]/g, ' '), ROLES[id].keys)
    const sk = scoreText(skills, ROLES[id].keys)
    const ds = scoreText(a.description, ROLES[id].keys)
    const score = nm.n * 3 + sk.n * 2 + ds.n + (nm.len + sk.len + ds.len) / 1000   // tie-break: most specific keywords
    if (score >= 1 && (!best || score > best.score)) {
      best = { id, score, why: nm.n ? { kind: 'name', hit: nm.hit || a.name } : sk.n ? { kind: 'skill', hit: sk.hit } : { kind: 'description', hit: ds.hit } }
    }
  }
  return best
}

/**
 * The role an agent is dressed for, by priority: 1) a hand-picked one (agent.roleOverride, 'none' = no role),
 * 2) the one the model chose in this catalogue (agent.modelRole; a role that is not in the catalogue is ignored),
 * 3) the one detected by the rules. why.kind: 'manual' | 'model' | 'name' | 'skill' | 'description' | 'none'.
 */
export function roleOf(a) {
  const o = a.roleOverride
  if (o && (ROLES[o] || o === 'none')) return { role: o === 'none' ? null : o, why: { kind: 'manual' } }
  const m = a.modelRole
  if (m && Object.hasOwn(ROLES, m)) return { role: m, why: { kind: 'model', at: Number.isFinite(a.modelRoleAt) ? a.modelRoleAt : null } }
  const d = detectRole(a)
  return d ? { role: d.id, why: d.why } : { role: null, why: { kind: 'none' } }
}
export const roleLabel = id => (id ? ROLES[id].label : 'Polyvalent')

/* ---------- garments: overlays drawn on the torso (front / back) ---------- */
const GARMENTS = {
  shirt: { label: 'chemise', front: (l, y, c) => { l.set(-2, y(-16), c.light).set(1, y(-16), c.light); for (let k = -15; k <= -5; k += 3) l.set(-1, y(k), c.shade) } },
  shirtTie: { label: 'chemise et cravate', front: (l, y, c) => { l.set(-2, y(-16), hx('#ffffff')).set(1, y(-16), hx('#ffffff')).rect(-1, y(-15), 0, y(-15), mulc(c.acc, 0.8)); for (let k = -14; k <= -7; k++) l.rect(-1, y(k), 0, y(k), c.acc); l.set(-1, -6, c.acc) } },
  suit: { label: 'costume', front: (l, y, c) => { for (let k = -16; k <= -10; k++) { const w = Math.max(0, k + 12); l.rect(-1 - w, y(k), w, y(k), hx('#f4f4f6')) } l.rect(-1, y(-15), 0, y(-11), c.acc).set(-1, y(-10), c.acc); l.set(-1, -7, c.light).set(-1, -5, c.light) } },
  blazer: { label: 'blazer et col roulé', front: (l, y, c) => { l.rect(-2, y(-16), 1, y(-15), c.acc); for (let k = -14; k <= -9; k++) l.rect(-1, y(k), 0, y(k), c.acc); l.set(-2, y(-14), c.light).set(1, y(-14), c.light).set(-2, y(-13), c.light).set(1, y(-13), c.light).set(-5, -11, hx('#e76f51')).set(-4, -11, hx('#e76f51')) }, back: (l, y, c) => { l.rect(-2, y(-16), 1, y(-16), c.acc) } },
  hoodie: { label: 'sweat à capuche', front: (l, y, c) => { l.rect(-4, y(-16), -2, y(-16), c.shade).rect(1, y(-16), 3, y(-16), c.shade); for (let k = -15; k <= -12; k++) l.set(-2, y(k), c.acc).set(1, y(k), c.acc); l.rect(-4, -8, 3, -6, c.shade).rect(-4, -9, 3, -9, c.light) }, back: (l, y, c) => { l.rect(-4, y(-17), 3, y(-14), c.shade).rect(-3, y(-13), 2, y(-13), c.shade) } },
  tee: { label: 't-shirt', front: (l, y, c) => { l.rect(-2, y(-16), 1, y(-16), c.shade); l.rect(-2, -12, 1, -10, c.acc) } },
  vest: { label: 'pull sans manches sur chemise', sleeve: 'acc', front: (l, y, c) => { l.set(-2, y(-16), hx('#ffffff')).set(1, y(-16), hx('#ffffff')); for (let k = -15; k <= -12; k++) { const w = Math.max(0, k + 13); l.rect(-1 - w, y(k), w, y(k), c.acc) } l.rect(-6, -5, 5, -5, c.shade) } },
  cardigan: { label: 'cardigan', front: (l, y, c) => { for (let k = -16; k <= -5; k++) l.rect(-1, y(k), 0, y(k), c.acc); l.set(-2, y(-12), c.shade).set(-2, -9, c.shade).set(-2, -6, c.shade) } },
  polo: { label: 'polo', front: (l, y, c) => { l.rect(-3, y(-16), -2, y(-16), c.acc).rect(1, y(-16), 2, y(-16), c.acc); for (let k = -15; k <= -13; k++) l.set(-1, y(k), c.shade) } },
  bomber: { label: 'blouson', front: (l, y, c) => { l.rect(-3, y(-16), 2, y(-16), c.acc); for (let k = -15; k <= -5; k++) l.set(-1, y(k), c.light); l.rect(-6, -4, 5, -4, c.acc) }, back: (l, y, c) => { l.rect(-3, y(-16), 2, y(-16), c.acc).rect(-6, -4, 5, -4, c.acc) } },
  jacketOpen: { label: 'veste sur chemise ouverte', front: (l, y, c) => { for (let k = -16; k <= -6; k++) l.rect(-1, y(k), 0, y(k), c.acc); l.set(-2, y(-16), c.acc).set(1, y(-16), c.acc).set(3, -11, hx('#e9c46a')).set(4, -11, hx('#e9c46a')) } },
  fieldVest: { label: 'gilet de terrain', sleeve: 'acc', front: (l, y, c) => { for (let k = -16; k <= -13; k++) { const w = Math.max(0, k + 14); l.rect(-1 - w, y(k), w, y(k), c.acc) } l.rect(-5, -11, -3, -9, c.shade).rect(2, -11, 4, -9, c.shade).rect(-5, -11, -3, -11, c.light).rect(2, -11, 4, -11, c.light) } },
  flannel: { label: 'chemise à carreaux', front: (l, y, c) => { for (let k = -16; k <= -4; k++) for (let x = -6; x <= 5; x++) if ((x & 3) === 0 || ((k + 16) & 3) === 0) l.set(x, y(k), c.shade); l.rect(-1, y(-16), 0, y(-16), c.acc) }, back: (l, y, c) => { for (let k = -16; k <= -4; k++) for (let x = -6; x <= 5; x++) if ((x & 3) === 0 || ((k + 16) & 3) === 0) l.set(x, y(k), c.shade) } },
  sweater: { label: 'pull', front: (l, y, c) => { l.rect(-2, y(-16), 1, y(-16), c.shade); l.rect(-6, -11, 5, -11, c.acc); l.rect(-6, -4, 5, -4, c.shade) }, back: (l, y, c) => { l.rect(-6, -11, 5, -11, c.acc) } },
  waistcoat: { label: 'gilet de costume sur chemise', sleeve: 'acc', front: (l, y, c) => { for (let k = -16; k <= -11; k++) { const w = Math.max(0, k + 13); l.rect(-1 - w, y(k), w, y(k), c.acc) } l.rect(-1, y(-15), 0, y(-12), hx('#2b2f36')); l.set(-1, -9, c.light).set(-1, -6, c.light) } }
}
const GARMENT_IDS = Object.keys(GARMENTS)   // the outfit composed from a name (no role) draws from these only
Object.assign(GARMENTS, EXTRA_GARMENTS)
const pickBy = (arr, name, salt) => arr[hash(name + '#' + salt) % arr.length]

/** Everything the sprite needs to dress an agent: body / sleeve colours, garment overlays, accessories. */
export function outfitOf(a) {
  const L = lookOf(a.name)
  const r = roleOf(a)
  const look = r.role
    ? pickBy(ROLES[r.role].looks, a.name, 'look')
    : { g: pickBy(GARMENT_IDS, a.name, 'g'), main: [null], acc: ['#f2ede4', '#e9c46a', '#ffffff', '#1f2024'], glasses: hash(a.name + 'gl') % 4 === 0 ? 'round' : null, beanie: hash(a.name + 'bn') % 6 === 0 }
  const G = GARMENTS[look.g]
  const m0 = pickBy(look.main, a.name, 'c')
  const main = m0 ? hx(m0) : hslc(hash(a.name + 'm') % 360, 28 + hash(a.name + 's') % 30, 30 + hash(a.name + 'l') % 28)
  const acc = hx(pickBy(look.acc, a.name, 'a'))
  const c = { main, shade: mulc(main, 0.78), light: mixc(main, [255, 255, 255], 0.35), acc }
  return {
    role: r.role,
    why: r.why,
    garment: look.g,
    label: G.label,
    front: (l, y) => G.front(l, y, c),
    back: G.back ? (l, y) => G.back(l, y, c) : null,
    body: [main, c.shade],
    sleeve: G.sleeve === 'acc' ? [acc, mulc(acc, 0.85)] : [main, c.shade],
    pants: L.pants,
    glasses: look.glasses || null,
    headphones: !!look.headphones,
    headset: !!look.headset,
    cap: look.cap ? mulc(main, 0.9) : null,
    beret: look.beret ? hx(look.beret) : null,
    beanie: look.beanie ? acc : null,
    lanyard: look.lanyard ? acc : null,
    hair: look.hair
  }
}

export function headGear(O, facing, cx, hy) {
  const l = new Lay()
  if (O.glasses && facing === 'front') {
    const f = hx('#1b1b1f')
    for (const ex of [cx - 3, cx + 2]) {
      if (O.glasses === 'round') l.set(ex - 1, hy, f).set(ex + 1, hy, f).set(ex, hy - 1, f).set(ex, hy + 1, f)
      else l.rect(ex - 1, hy - 1, ex + 1, hy - 1, f).set(ex - 1, hy, f).set(ex + 1, hy, f).rect(ex - 1, hy + 1, ex + 1, hy + 1, f)
    }
    l.set(cx - 1, hy - 1, f).set(cx, hy - 1, f)
  }
  if (O.headphones || O.headset) {
    const b = hx('#2b2f36')
    const cup = O.headset ? hx('#3a3f47') : hx('#e76f51')
    l.rect(cx - 5, hy - 7, cx + 4, hy - 7, b).set(cx - 6, hy - 6, b).set(cx + 5, hy - 6, b).rect(cx - 7, hy - 5, cx - 7, hy - 3, b).rect(cx + 6, hy - 5, cx + 6, hy - 3, b)
    l.rect(cx - 8, hy - 2, cx - 6, hy + 1, cup).rect(cx + 5, hy - 2, cx + 7, hy + 1, cup)
    if (O.headset && facing === 'front') l.set(cx - 5, hy + 2, b).set(cx - 4, hy + 3, b).set(cx - 3, hy + 3, hx('#e76f51'))
  }
  if (O.cap) {
    const d = mulc(O.cap, 0.75)
    l.ell(cx - 0.5, hy - 4, 6.2, 3.2, O.cap, (x, y) => y <= hy - 3)
    if (facing === 'front') l.rect(cx - 6, hy - 3, cx + 5, hy - 3, d)
    else l.rect(cx - 2, hy - 3, cx + 1, hy - 3, d)
  }
  if (O.beret) { l.ell(cx - 1, hy - 6, 6.5, 2.4, O.beret).set(cx - 1, hy - 9, O.beret) }
  if (O.beanie) { l.ell(cx - 0.5, hy - 3, 6.4, 4, O.beanie, (x, y) => y <= hy - 2).rect(cx - 6, hy - 2, cx + 5, hy - 2, mulc(O.beanie, 0.8)) }
  return l
}

/** Lanyard + badge, front only. */
export function torsoExtras(O, facing) {
  const l = new Lay()
  if (!O.lanyard || facing !== 'front') return l
  for (let k = -16; k <= -11; k++) l.set(k < -13 ? -4 + (k + 16) : 2 - (k + 13), k, O.lanyard)
  return l.rect(-1, -10, 0, -8, hx('#ffffff')).set(-1, -10, O.lanyard)
}
