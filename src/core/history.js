/**
 * Pure history logic: the agent half's `GET /history` body -> whitelisted profile facts and run/event
 * history, and the per-bot extras the scene needs (own skills, diploma). No SDK, no DOM, so it runs
 * under `node --test`.
 *
 * Privacy: only whitelisted fields are copied. Skill descriptions, `soul`, `path`, `preview`, card
 * bodies/results and message contents are never read here, even if a future backend sent them.
 */
import { toMs } from './time.js'
import { num, str } from './util.js'
import { dict } from './dict.js'

/** A skill modified within this window earns the desk a diploma (< 7 days). */
export const RECENT_SKILL_MS = 7 * 86_400_000
export const OWN_SKILLS_MAX = 40
export const DESCRIPTION_MAX = 280


function toSkill(raw) {
  const name = str(raw?.name).trim()
  if (!name) return null
  return {
    name,
    category: str(raw?.category).trim(),
    tags: (Array.isArray(raw?.tags) ? raw.tags : []).map(str).map(x => x.trim()).filter(Boolean).slice(0, 8)
  }
}

function toSession(raw) {
  if (!raw || typeof raw !== 'object') return null
  return { title: str(raw.title), lastActiveMs: toMs(raw.last_active), source: str(raw.source) }
}

/**
 * `/history` `lastNonEmptySession`: the bot's newest conversation that holds at least one message,
 * as `{ id, title, lastActiveMs, messages }`. Only a session with an id and a positive count is kept; the preview is never read.
 * Absent (an older agent half) or unusable -> null.
 */
function toNonEmptySession(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = str(raw.id).trim().slice(0, 200)
  const messages = num(raw.message_count)
  if (!id || messages == null || messages <= 0) return null
  return { id, title: str(raw.title).trim().slice(0, 300), lastActiveMs: toMs(raw.last_active), messages: Math.floor(messages) }
}

/** One /history profile row -> the facts the scene and the game layer use; null without a name. */
export function toHistoryProfile(raw) {
  const name = str(raw?.name).trim()
  if (!name) return null
  const sk = raw?.skills && typeof raw.skills === 'object' ? raw.skills : {}
  // `own` (name, category, tags); the legacy `names` list (names only) is read when `own` is absent
  const ownRaw = Array.isArray(sk.own) ? sk.own : (Array.isArray(sk.names) ? sk.names : []).map(name => ({ name }))
  const own = ownRaw.map(toSkill).filter(Boolean).slice(0, OWN_SKILLS_MAX)
  const stats = raw?.stats && typeof raw.stats === 'object' ? raw.stats : {}
  return {
    name,
    description: str(raw.description).trim().slice(0, DESCRIPTION_MAX),
    skills: {
      own,
      count: num(sk.count) ?? 0,
      enabled: num(sk.enabled) ?? 0,
      disabled: num(sk.disabled) ?? 0,
      recent: (Array.isArray(sk.recent) ? sk.recent : [])
        .map(r => ({ name: str(r?.name), mtimeMs: toMs(r?.mtime) }))
        .filter(r => r.name && r.mtimeMs != null)
    },
    stats: { firstSeenMs: toMs(stats.firstSeen), inputTokens: num(stats.inputTokens) ?? 0, cacheReadTokens: num(stats.cacheReadTokens) ?? 0 },
    lastSession: toSession(raw.lastSession),
    lastNonEmptySession: toNonEmptySession(raw.lastNonEmptySession),
    worker: toSession(raw.worker),
    // sessions.model of the newest worker session (what it really ran with), exact string
    workerModel: str(raw.workerModel).trim().slice(0, 120) || null,
    // the bot's own default model (read from its raw config.yaml), exact string; null when unknown
    defaultModel: str(raw.defaultModel).trim().slice(0, 120) || null,
    defaultProvider: str(raw.defaultProvider).trim().slice(0, 120) || null
  }
}

/** One /history board -> runs (finished) and whitelisted events, in milliseconds. */
export function toHistoryBoard(raw) {
  const slug = str(raw?.slug)
  if (!slug) return null
  return {
    slug,
    runs: (Array.isArray(raw.runs) ? raw.runs : [])
      .filter(r => r && typeof r === 'object' && str(r.outcome) && str(r.profile))   // no profile = a « Lancer », not an execution
      // `task`: the card of the run (absent on an older agent half: the key is then absent too)
      .map(r => ({ profile: str(r.profile), startedMs: toMs(r.startedAt), endedMs: toMs(r.endedAt), outcome: str(r.outcome), ...(str(r.task) ? { task: str(r.task) } : {}) })),
    events: (Array.isArray(raw.events) ? raw.events : [])
      .filter(e => e && typeof e === 'object' && str(e.kind))
      .map(e => ({ task: str(e.task), kind: str(e.kind), ms: toMs(e.ts) })),
    // parent -> child links between the cards of the board; the key is absent when the agent half does not serve them
    ...(Array.isArray(raw.links) ? { links: raw.links.filter(l => Array.isArray(l) && str(l[0]) && str(l[1])).map(l => [str(l[0]), str(l[1])]) } : {})
  }
}

/** One cron job's outcome history (`[epoch s, 1 | 0]`, oldest first): { profile, name, runs: [[ms, 1|0]] }. */
export function toCronRuns(raw) {
  const name = str(raw?.name).trim()
  if (!name) return null
  const runs = (Array.isArray(raw.runs) ? raw.runs : []).filter(r => Array.isArray(r) && toMs(r[0]) != null).map(r => [toMs(r[0]), r[1] ? 1 : 0])
  return { profile: str(raw.profile), name, runs }
}

/** `partial` reasons of /live and /history: a closed list, anything else reads `unreadable`. */
export const PARTIAL_REASONS = Object.freeze(['unreadable', 'locked', 'schema', 'missing'])
export const PARTIAL_MAX = 60
const PARTIAL_SOURCE = /^[a-z]{2,16}(?::[A-Za-z0-9_.-]{1,64})?$/

/**
 * `partial: [{ source, reason }]` -> the same, whitelisted (a source is a name of the contract, a reason one of the four; no
 * duplicate, 60 at most). null when the field is absent or not a list (older agent half: no field, no chip); [] when everything was read.
 */
export function toPartial(raw) {
  if (!Array.isArray(raw)) return null
  const seen = new Set()
  const out = []
  for (const p of raw) {
    const source = str(p?.source)
    if (!PARTIAL_SOURCE.test(source) || seen.has(`${source}/${str(p?.reason)}`)) continue
    seen.add(`${source}/${str(p?.reason)}`)
    out.push({ source, reason: PARTIAL_REASONS.includes(p.reason) ? p.reason : 'unreadable' })
    if (out.length >= PARTIAL_MAX) break
  }
  return out
}

/** `/history` body -> { ok, profiles: { [name]: HistoryProfile }, boards: [...] }. Anything malformed -> `ok: false`, never a throw. */
export function toHistory(body) {
  if (!body || typeof body !== 'object' || body.ok === false || !Array.isArray(body.profiles)) return { ok: false, profiles: dict(), boards: [] }
  const profiles = dict()
  for (const row of body.profiles) {
    const p = toHistoryProfile(row)
    if (p && !Object.hasOwn(profiles, p.name)) profiles[p.name] = p
  }
  const boards = (Array.isArray(body.boards) ? body.boards : []).map(toHistoryBoard).filter(Boolean)
  // `crons` only when the agent half serves it: its absence is « not served », not « no cron »
  const partial = toPartial(body.partial)   // absent on an older agent half
  return { ok: true, profiles, boards, ...(Array.isArray(body.crons) ? { crons: body.crons.map(toCronRuns).filter(Boolean) } : {}), ...(partial ? { partial } : {}) }
}

/** Newest of the bot's own skills modified within the window (never a bundled skill: the backend already filtered those). */
export const hasRecentSkill = (hp, nowMs) => (hp?.skills?.recent || []).some(r => nowMs - r.mtimeMs < RECENT_SKILL_MS && nowMs >= r.mtimeMs)

/**
 * `extras.profiles` of toSceneModel: for each agent, the description (the roster's own text wins; /history
 * fills in when it is empty), the bot's own skills (desk objects) and the diploma flag.
 * No history (no agent half, failed read) -> `{}`: outfits come from the name and the roster description only,
 * and no skill objects are drawn.
 */
export function sceneProfiles(history, agents, nowMs) {
  const out = dict()
  if (!history?.ok) return out
  for (const a of agents || []) {
    const hp = Object.hasOwn(history.profiles, a.name) ? history.profiles[a.name] : null
    if (!hp) continue
    out[a.name] = {
      description: a.description || hp.description || '',
      skills: hp.skills.own,
      recentSkill: hasRecentSkill(hp, nowMs)
    }
  }
  return out
}
