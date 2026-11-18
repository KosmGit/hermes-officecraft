/**
 * Game layer: achievements, grades, office level, incidents, mascot, seasons, decision streak.
 * Pure and deterministic: (history, office, nowMs, prefs) in, plain data out. No SDK, no DOM, no clock, no storage.
 * Rules: « less than an hour » is strict, the 2nd profile only needs to exist, nothing is awarded for volume.
 *
 * Inputs (all in milliseconds, the shapes the page already has):
 *   history  toHistory() of /history: { ok, profiles: { [name]: { stats: { firstSeenMs, inputTokens, cacheReadTokens } } },
 *            boards: [{ slug, runs: [{ profile, endedMs, outcome }], events: [{ task, kind, ms }] }] }   (null = no agent half)
 *   office   buildOffice(): { boards: [{ slug, createdMs?, tasks: [{ id, status, createdMs, startedMs, completedMs }] }], agents: [{ name, state }] }
 *   prefs    { sober }  (sober = game mode off: nothing is computed, nothing is shown)
 *
 * Privacy: only counts, slugs, kinds and timestamps are read; never a title, summary, error or message.
 * Rule: nothing here rewards volume (tokens, sessions, cards created, time spent).
 */

import { LEGACY, NEW_DEFS, RULES_V2, buildContext, finishRecord } from './achievements.js'
import { dict } from './dict.js'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** Terminal run outcomes (`zero`): the only ones that count toward a streak or an incident. */
export const TERMINAL = Object.freeze(['completed', 'crashed', 'timed_out'])

/** The thresholds of the ten first achievements, in one place (the ones of the later achievements are in RULES_V2, merged here). */
export const RULES = Object.freeze({
  ...RULES_V2,
  chainCards: 10,
  centurionCards: 100,
  zeroRuns: 20,
  quickMs: HOUR_MS,
  owlCards: 5,
  owlUntilHour: 6,
  thriftyPercent: 50,
  hireProfiles: 2,
  builderBoards: 2,
  recruitMs: 7 * DAY_MS
})

/** Agent grades, by successful runs. */
export const GRADES = Object.freeze([
  { at: 0, id: 'stagiaire', short: 'St' },
  { at: 5, id: 'confirme', short: 'Cf' },
  { at: 20, id: 'senior', short: 'Sr' },
  { at: 80, id: 'legende', short: 'Lg' }
])

/** Office levels, by cards done: Garage, Open space, Étage, Campus, Gratte-ciel. */
export const OFFICE_LEVELS = Object.freeze([
  { at: 0, name: 'garage' },
  { at: 10, name: 'open_space' },
  { at: 50, name: 'floor' },
  { at: 200, name: 'campus' },
  { at: 1000, name: 'skyscraper' }
])

/** The ten first achievements, in catalogue order. */
export const ACHIEVEMENT_IDS = Object.freeze(['chain', 'centurion', 'zero', 'quick', 'review', 'owl', 'thrifty', 'hire', 'builder', 'fire'])

/** Every achievement of the catalogue (the ten first, then the ones of achievements.js), in the order computeGame lists them. */
export const ALL_ACHIEVEMENT_IDS = Object.freeze([...ACHIEVEMENT_IDS, ...NEW_DEFS.map(d => d.id)])

/** Where each fact comes from (the tooltip's source line). */
export const SOURCES = Object.freeze({
  chain: 'cards', centurion: 'cards', zero: 'runs', quick: 'events', review: 'events', owl: 'cards', thrifty: 'sessions', hire: 'sessions', builder: 'boards', fire: 'runs',
  ...Object.fromEntries(NEW_DEFS.map(d => [d.id, d.source]))
})

export const gradeOf = runs => {
  const n = Math.max(0, Number(runs) || 0)
  let g = GRADES[0]
  for (const x of GRADES) if (n >= x.at) g = x
  const next = GRADES[GRADES.indexOf(g) + 1] || null
  return { id: g.id, short: g.short, runs: n, next: next ? next.at : null }
}

export const levelOf = cardsDone => {
  const done = Math.max(0, Number(cardsDone) || 0)
  let i = 0
  OFFICE_LEVELS.forEach((x, k) => { if (done >= x.at) i = k })
  const next = OFFICE_LEVELS[i + 1] || null
  return { level: i + 1, name: OFFICE_LEVELS[i].name, done, next: next ? next.at : null }
}

/** « halloween » 20 Oct – 2 Nov, « xmas » 1 Dec – 6 Jan (local date, both ends included), else null. Cosmetic only. */
export function seasonOf(nowMs) {
  const d = new Date(nowMs)
  const md = (d.getMonth() + 1) * 100 + d.getDate()
  if (md >= 1020 && md <= 1102) return 'halloween'
  if (md >= 1201 || md <= 106) return 'xmas'
  return null
}

const localDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
const liveTasks = b => (b?.tasks || []).filter(t => t && t.status !== 'archived')
/** Test boards (`sandbox-*`) are never a game fact. */
export const isSandboxBoard = slug => typeof slug === 'string' && slug.startsWith('sandbox-')
/**
 * What the game may count. A guard (a card of a campaign marked `guard` by the agent half) is a gate Officecraft wrote, not work
 * an agent did, and a `sandbox-*` board is a test board: neither gives a finished card, a project of the day, a streak day, a run or an
 * event to any level, grade or trophy. Returns the same shapes, filtered: { hist, office }.
 */
export function gameFacts(hist, office) {
  const guards = new Set()
  const boards = (office?.boards || []).filter(b => !isSandboxBoard(b?.slug)).map(b => {
    const tasks = Array.isArray(b?.tasks) ? b.tasks : []
    if (!tasks.some(t => t?.guard === true)) return b
    for (const t of tasks) if (t?.guard === true) guards.add(`${b.slug}/${t.id}`)
    return { ...b, tasks: tasks.filter(t => t?.guard !== true) }
  })
  const keep = (b, id) => !(id && guards.has(`${b.slug}/${id}`))
  const hb = hist ? {
    ...hist,
    boards: (hist.boards || []).filter(b => !isSandboxBoard(b?.slug)).map(b => ({
      ...b,
      runs: (b.runs || []).filter(r => r?.profile && keep(b, r.task)),   // a run without a profile is a « Lancer », not an execution
      events: (b.events || []).filter(e => keep(b, e?.task))
    }))
  } : hist
  return { hist: hb, office: office ? { ...office, boards } : office }
}
const finite = v => typeof v === 'number' && Number.isFinite(v)
const by = (a, b) => a - b

/** Family and « no tier » fields of one of the ten first achievements; zero and thrifty override the tier ones (tierFields). */
const legacyFields = (id, progress) => ({ family: LEGACY[id].family, hidden: false, where: null, unavailable: false, tiered: false, tier: null, tiers: [], nextTier: null, value: progress[0] })

/** Tier fields of a tiered legacy achievement (`dates`: the date of each tier, `undefined` when undated). */
function tierFields(id, value, dates) {
  const r = finishRecord({ id, family: LEGACY[id].family, tiers: LEGACY[id].tiers, source: SOURCES[id] }, { value, ms: dates, fact: [] })
  return { tiered: true, tier: r.tier, tiers: r.tiers, nextTier: r.nextTier, value: r.value, progress: r.progress }
}

/** What a sober (game off) result looks like: nothing to draw, nothing to announce. */
export const SOBER_GAME = Object.freeze({
  sober: true,
  achievements: Object.freeze([]),
  grades: Object.freeze(dict()),
  office: null,
  incidentBoards: Object.freeze([]),
  incidents: Object.freeze([]),
  openIncidents: Object.freeze([]),
  streak: 0,
  lastFailMs: null,
  owlBoard: null,
  centurions: Object.freeze([]),
  recruits: Object.freeze([]),
  quests: null,
  season: null,
  mascotMood: null
})

/**
 * Whether the game layer may show at all: the setting is on AND both reads it is computed from answered (/history ok,
 * /live read). Without them a level, a grade or a trophy count would be invented (« Garage 0/10 », every bot « Stagiaire »):
 * until then the page treats the game as sober.
 */
export const gameShown = (gameOn, history, office) => Boolean(gameOn) && history?.ok === true && office?.mode === 'full'

/** Terminal runs of every board, oldest first (ties keep board order, then run order: deterministic). */
function terminalRuns(history) {
  const out = []
  ;(history?.boards || []).forEach((b, bi) => {
    ;(b.runs || []).forEach((r, ri) => {
      if (TERMINAL.includes(r?.outcome) && finite(r.endedMs)) out.push({ board: b.slug, profile: r.profile || '', outcome: r.outcome, endedMs: r.endedMs, task: r.task || null, bi, ri })
    })
  })
  return out.sort((x, y) => x.endedMs - y.endedMs || x.bi - y.bi || x.ri - y.ri)
}

function allEvents(history) {
  const out = []
  ;(history?.boards || []).forEach((b, bi) => {
    ;(b.events || []).forEach((e, ei) => {
      if (e?.kind && finite(e.ms)) out.push({ board: b.slug, task: e.task, kind: e.kind, ms: e.ms, bi, ei })
    })
  })
  return out.sort((x, y) => x.ms - y.ms || x.bi - y.bi || x.ei - y.ei)
}

/**
 * The whole game state, recomputed from the backend's history.
 * Returns { sober, achievements: [{ id, unlocked, unlockedMs|null, dated, fact, progress, source }], grades: { [agent]: { id, short, runs, next } },
 *   office: { level, name, done, next }, incidentBoards, incidents (resolved: [{ board, startMs, endMs, fails }]), streak, lastFailMs,
 *   owlBoard, centurions, recruits, quests: { streakDays }, season, mascotMood }.
 * `unlockedMs` is null while locked and for an undated unlock (`thrifty`: an aggregate of the whole history; `dated: false`).
 * `fact` is [i18nKey, ...args]: the evidence when unlocked, the closest progress when locked.
 */
export function computeGame(history, office, nowMs, prefs = {}, extraDefs = []) {
  if (prefs && prefs.sober) return SOBER_GAME
  const facts = gameFacts(history && history.ok ? history : null, office)
  const hist = facts.hist
  office = facts.office
  const boards = office?.boards || []
  const runs = terminalRuns(hist)
  const events = allEvents(hist)
  const A = []
  // the ten first: family and tier fields are added once their values are known (zero and thrifty carry tiers, below)
  const add = (id, unlockedMs, progress, factWhenOn, factNear, { unlocked = unlockedMs != null, extra = {} } = {}) => {
    A.push({ id, unlocked, unlockedMs: unlocked ? unlockedMs ?? null : null, dated: unlocked && unlockedMs != null, fact: unlocked ? factWhenOn : [...factNear, ...progress], progress, source: SOURCES[id], ...legacyFields(id, progress), ...extra })
  }

  // 1. chain: a board of at least 10 live cards, all done; date = its last completion
  let chain = null
  let chainBest = 0
  for (const b of boards) {
    const live = liveTasks(b)
    const done = live.filter(t => t.status === 'done')
    if (live.length >= RULES.chainCards && done.length === live.length) {
      const stamps = done.map(t => t.completedMs).filter(finite)
      const at = stamps.length ? Math.max(...stamps) : null
      if (!chain || (at != null && (chain.at == null || at < chain.at))) chain = { board: b.slug, at, n: live.length }
    }
    chainBest = Math.max(chainBest, live.length >= RULES.chainCards ? Math.floor((RULES.chainCards * done.length) / live.length) : Math.min(done.length, live.length))
  }
  add('chain', chain?.at, [chain ? RULES.chainCards : Math.min(chainBest, RULES.chainCards - 1), RULES.chainCards], ['game.fact.chain', chain?.board, chain?.n], ['game.near'], { unlocked: Boolean(chain), extra: { board: chain?.board ?? null } })

  // 2. centurion: 100 cards done on one board; date = the 100th completion
  const centurions = []
  let centAt = null
  let centBoard = null
  let centBest = 0
  for (const b of boards) {
    const stamps = liveTasks(b).filter(t => t.status === 'done' && finite(t.completedMs)).map(t => t.completedMs).sort(by)
    centBest = Math.max(centBest, stamps.length)
    if (stamps.length >= RULES.centurionCards) {
      centurions.push(b.slug)
      const at = stamps[RULES.centurionCards - 1]
      if (centAt == null || at < centAt) { centAt = at; centBoard = b.slug }
    }
  }
  add('centurion', centAt, [Math.min(centBest, centurions.length ? RULES.centurionCards : RULES.centurionCards - 1), RULES.centurionCards], ['game.fact.centurion', centBoard, RULES.centurionCards], ['game.near'], { unlocked: centurions.length > 0, extra: { board: centBoard } })

  // 3. zero: 20 terminal runs in a row, all completed; date = the 20th of the series. The streak in progress feeds the plant.
  let streak = 0
  let longest = 0
  let zeroAt = null
  let lastFailMs = null
  const zeroLevels = LEGACY.zero.tiers.map(([, at]) => at)   // bronze 20, silver 50, gold 100: streaks, never a volume
  const zeroDates = {}
  for (const r of runs) {
    if (r.outcome === 'completed') {
      streak++
      longest = Math.max(longest, streak)
      if (streak === RULES.zeroRuns && zeroAt == null) zeroAt = r.endedMs
      if (zeroLevels.includes(streak) && zeroDates[streak] == null) zeroDates[streak] = r.endedMs
    } else { streak = 0; lastFailMs = r.endedMs }
  }
  const zeroTiers = tierFields('zero', longest, zeroLevels.map(at => zeroDates[at]))
  add('zero', zeroAt, [Math.min(longest, zeroAt != null ? RULES.zeroRuns : RULES.zeroRuns - 1), RULES.zeroRuns], ['game.fact.zero', [...zeroTiers.tiers].reverse().find(t => t.unlocked)?.at ?? RULES.zeroRuns], ['game.near'], { unlocked: zeroAt != null, extra: zeroTiers })

  // 4. quick: `unblocked` less than an hour after the `blocked` of the same card; date = first case
  const blockedAt = new Map()
  let quick = null
  for (const e of events) {
    const k = `${e.board}/${e.task}`
    if (e.kind === 'blocked') blockedAt.set(k, e.ms)
    else if (e.kind === 'unblocked' && blockedAt.has(k)) {
      const dt = e.ms - blockedAt.get(k)
      if (dt >= 0 && dt < RULES.quickMs && !quick) quick = { at: e.ms, board: e.board, minutes: Math.max(1, Math.floor(dt / 60_000)) }
      blockedAt.delete(k)
    }
  }
  add('quick', quick?.at, [quick ? 1 : 0, 1], ['game.fact.quick', quick?.board, quick?.minutes], ['game.near'], { unlocked: Boolean(quick), extra: { board: quick?.board ?? null } })

  // 5. review: `changes_requested`, then `completed` on the same card; date = first case
  const changed = new Set()
  let review = null
  for (const e of events) {
    const k = `${e.board}/${e.task}`
    if (e.kind === 'changes_requested') changed.add(k)
    else if (e.kind === 'completed' && changed.has(k) && !review) review = { at: e.ms, board: e.board }
  }
  add('review', review?.at, [review ? 1 : 0, 1], ['game.fact.review', review?.board], ['game.near'], { unlocked: Boolean(review), extra: { board: review?.board ?? null } })

  // 6. owl: 5 cards completed the same night (00:00 – 06:00, local time) on one board; date = the 5th
  const nights = new Map()
  for (const b of boards) {
    for (const t of liveTasks(b)) {
      if (t.status !== 'done' || !finite(t.completedMs) || new Date(t.completedMs).getHours() >= RULES.owlUntilHour) continue
      const k = `${b.slug}@${localDay(t.completedMs)}`
      nights.set(k, [...(nights.get(k) || []), t.completedMs])
    }
  }
  let owl = null
  let owlBest = 0
  for (const [k, list] of nights) {
    list.sort(by)
    owlBest = Math.max(owlBest, list.length)
    if (list.length >= RULES.owlCards && (!owl || list[RULES.owlCards - 1] < owl.at)) owl = { at: list[RULES.owlCards - 1], board: k.slice(0, k.lastIndexOf('@')) }
  }
  add('owl', owl?.at, [Math.min(owlBest, owl ? RULES.owlCards : RULES.owlCards - 1), RULES.owlCards], ['game.fact.owl', owl?.board, RULES.owlCards], ['game.near'], { unlocked: Boolean(owl), extra: { board: owl?.board ?? null } })

  // 7. thrifty: tokens read from the cache >= 50 % of the input tokens, every profile (an aggregate: no date)
  const profiles = Object.values(hist?.profiles || {})
  const inputTokens = profiles.reduce((n, p) => n + (p?.stats?.inputTokens || 0), 0)
  const cacheTokens = profiles.reduce((n, p) => n + (p?.stats?.cacheReadTokens || 0), 0)
  const total = inputTokens + cacheTokens
  const percent = total ? Math.floor((cacheTokens * 100) / total) : 0
  const thrifty = total > 0 && cacheTokens * 100 >= RULES.thriftyPercent * total
  add('thrifty', null, [Math.min(percent, thrifty ? RULES.thriftyPercent : RULES.thriftyPercent - 1), RULES.thriftyPercent], ['game.fact.thrifty', percent], ['game.nearPct'], { unlocked: thrifty, extra: tierFields('thrifty', percent, []) })

  // 8. hire: a second profile exists; date = first activity of the 2nd profile (oldest first sighting, 2nd of the list)
  const seen = profiles.map(p => p?.stats?.firstSeenMs).filter(finite).sort(by)
  const hire = profiles.length >= RULES.hireProfiles
  add('hire', seen[1] ?? null, [Math.min(profiles.length, RULES.hireProfiles), RULES.hireProfiles], ['game.fact.hire', profiles.length], ['game.near'], { unlocked: hire })
  const recruits = hire ? profiles.filter(p => finite(p?.stats?.firstSeenMs) && nowMs - p.stats.firstSeenMs >= 0 && nowMs - p.stats.firstSeenMs < RULES.recruitMs).map(p => p.name) : []

  // 9. builder: a second board with cards; date = creation of the 2nd board
  const withCards = boards.filter(b => liveTasks(b).length > 0)
  const created = withCards
    .map(b => (finite(b.createdMs) ? b.createdMs : Math.min(...liveTasks(b).map(t => (finite(t.createdMs) ? t.createdMs : Infinity)))))
    .filter(Number.isFinite)
    .sort(by)
  add('builder', created[1] ?? null, [Math.min(withCards.length, RULES.builderBoards), RULES.builderBoards], ['game.fact.builder', withCards.length], ['game.near'], { unlocked: withCards.length >= RULES.builderBoards })

  // 10. fire: a crash or timeout followed by a successful run on the same board; date = first recovery
  const open = new Map()
  const incidents = []
  for (const r of runs) {
    if (r.outcome !== 'completed') {
      const cur = open.get(r.board) || { board: r.board, startMs: r.endedMs, fails: 0 }
      cur.fails++
      open.set(r.board, cur)
    } else if (open.has(r.board)) {
      const cur = open.get(r.board)
      incidents.push({ board: r.board, startMs: cur.startMs, endMs: r.endedMs, fails: cur.fails })
      open.delete(r.board)
    }
  }
  add('fire', incidents[0]?.endMs, [incidents.length ? 1 : 0, 1], ['game.fact.fire', incidents[0]?.board, incidents[0] ? Math.max(1, Math.round((incidents[0].endMs - incidents[0].startMs) / 60_000)) : 0, incidents[0]?.fails], ['game.near'], { unlocked: incidents.length > 0, extra: { board: incidents[0]?.board ?? null } })

  // 11+. the achievements of achievements.js, then the ones a caller adds (the « command » family); each is its own small computation, and a
  // definition that throws is a locked « unavailable » achievement, never a dead game layer
  const ctx = buildContext({ history: hist, office, nowMs, runs, events, incidents })
  for (const def of [...NEW_DEFS, ...(Array.isArray(extraDefs) ? extraDefs : [])]) {
    let res
    try { res = def.compute(ctx) } catch { res = { value: 0, unavailable: true } }
    A.push(finishRecord(def, res || { value: 0, unavailable: true }))
  }

  // grades: successful runs per profile (agents with no run are interns, never missing)
  const finished = dict()
  for (const r of runs) if (r.outcome === 'completed' && r.profile) finished[r.profile] = (finished[r.profile] || 0) + 1
  const grades = dict()
  for (const a of office?.agents || []) grades[a.name] = gradeOf(finished[a.name] || 0)
  for (const name of Object.keys(finished)) if (!grades[name]) grades[name] = gradeOf(finished[name])

  const cardsDone = boards.reduce((n, b) => n + liveTasks(b).filter(t => t.status === 'done').length, 0)

  // decision streak: consecutive local days with at least one unblocked card (today may still be empty)
  const unblockDays = new Set(events.filter(e => e.kind === 'unblocked').map(e => localDay(e.ms)))
  let streakDays = 0
  const day = new Date(nowMs)
  for (let k = 0; k < 400; k++) {
    if (unblockDays.has(localDay(day.getTime()))) streakDays++
    else if (k > 0 || streakDays) break
    day.setDate(day.getDate() - 1)
  }

  const incidentBoards = [...open.keys()].sort((a, b) => a.localeCompare(b, 'en'))
  const anyBlocked = boards.some(b => liveTasks(b).some(t => t.status === 'blocked'))
  const anyWorking = (office?.agents || []).some(a => a.state === 'working')
  const mascotMood = incidentBoards.length ? 'hide' : anyBlocked ? 'alert' : anyWorking ? 'play' : 'sleep'
  const owlUnlocked = A.find(a => a.id === 'owl').unlocked

  return {
    sober: false,
    achievements: A,
    grades,
    office: levelOf(cardsDone),
    incidentBoards,
    incidents,
    openIncidents: incidentBoards.map(slug => ({ board: slug, startMs: open.get(slug).startMs, fails: open.get(slug).fails })),
    streak,
    lastFailMs,
    owlBoard: owlUnlocked ? owl.board : null,
    centurions,
    recruits,
    quests: { streakDays },
    season: seasonOf(nowMs),
    mascotMood
  }
}

const TIER_RANK = { gold: 3, silver: 2, bronze: 1 }

/**
 * What the trophy cabinet shows: one medal per unlocked achievement -> [{ id, family, tier, pips }], best tier first, then the most
 * recently unlocked (undated last), then the catalogue order. `pips` = 0 for a single-level achievement, else 1 / 2 / 3 (bronze / silver / gold).
 */
export function medalsOf(achievements) {
  const list = (achievements || []).filter(a => a.unlocked)
  const order = new Map((achievements || []).map((a, i) => [a.id, i]))
  return list
    .map(a => ({ id: a.id, family: a.family || null, tier: a.tier || null, pips: a.tier ? TIER_RANK[a.tier] || 0 : 0, ms: a.unlockedMs ?? null }))
    .sort((x, y) => y.pips - x.pips || (y.ms ?? -Infinity) - (x.ms ?? -Infinity) || order.get(x.id) - order.get(y.id))
    .map(({ ms, ...m }) => m)
}

/** The Decor of the scene (src/scene/model.js DECOR_OFF) fed by the game; sober or no game -> everything off. */
export function decorOf(game) {
  if (!game || game.sober) return { sober: true }
  return {
    sober: false,
    incidentBoards: game.incidentBoards,
    achievements: game.achievements.filter(a => a.unlocked).map(a => a.id),
    medals: medalsOf(game.achievements),
    centurions: game.centurions,
    streak: game.streak,
    lastFailMs: game.lastFailMs,
    owlBoard: game.owlBoard,
    recruits: game.recruits,
    season: game.season,
    mascotMood: game.mascotMood
  }
}

/**
 * « Already seen » bookkeeping (stored per machine; nothing else about the game is stored).
 *   seen: the stored array of ids, or anything else (null) on the first launch.
 * -> { kind: 'first' | 'new' | 'many' | null, ids, next }   first: ONE « history analysed: N » toast; new: the 1-3 fresh ones, named;
 *    many: more than 3 fresh ones at once (an existing user updating to a version with more achievements) in ONE grouped toast « N new achievements unlocked by the history »,
 *    never one toast per achievement; next: what to store (the same array of ids as before: prefs-compat).
 */
export const MANY_AT = 4
export function unlockAnnouncement(seen, game) {
  const now = (game?.achievements || []).filter(a => a.unlocked).map(a => a.id)
  if (!Array.isArray(seen)) return { kind: now.length ? 'first' : null, ids: now, next: now }
  const fresh = now.filter(id => !seen.includes(id))
  return { kind: fresh.length >= MANY_AT ? 'many' : fresh.length ? 'new' : null, ids: fresh, next: [...new Set([...seen, ...now])] }
}

/**
 * A trophy already unlocked AND seen does not vanish because a source cannot be read right now (a
 * history with one `sessions:<bot>` or `kanban:<board>` missing would otherwise lose some). While the reading is incomplete (`unreadable`: a source named in
 * `partial`, or no /history at all), a trophy the machine has seen unlocked (`seen` = the stored ids, readSeen()) that the partial data
 * would show locked stays unlocked, undated and flagged `recheck` (« unlocked before, to be re-checked »). A complete reading is
 * the truth again: what it shows locked is locked. Nothing is invented: only ids this machine already announced come back.
 */
export function keepSeenWhilePartial(game, seen, unreadable) {
  if (!game || game.sober || !unreadable || !Array.isArray(seen) || !seen.length) return game
  let changed = false
  const achievements = game.achievements.map(a => {
    if (a.unlocked || a.unavailable || !seen.includes(a.id)) return a
    changed = true
    return { ...a, unlocked: true, unlockedMs: null, dated: false, recheck: true, fact: [`game.ach.${a.id}.cond`] }
  })
  return changed ? { ...game, achievements } : game
}

/** « Jun 5, 2026 » in the plugin language; empty without a date. */
export function dateText(ms, lang = 'en') {
  if (!finite(ms)) return ''
  try {
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms))
  } catch {
    return ''
  }
}

const clock = (ms, lang) => {
  if (!finite(ms)) return ''
  try { return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(ms)) } catch { return '' }
}

/**
 * Sourced tooltip of one trophy: the fact and its date, where it shows in the office, where the data comes from.
 *   -> { name, fact, when, where, source }, each [i18nKey, ...args]. ctx: { lang, readMs, boards }.
 */
export function trophyTip(ach, ctx = {}) {
  const at = clock(ctx.readMs, ctx.lang)
  const src = ach.source === 'cards' || ach.source === 'boards' ? ['game.src.cards', ctx.boards ?? 0, at] : [`game.src.${ach.source}`, at]
  // a hidden achievement keeps its name, its condition, its progress and its place secret until it is unlocked
  if (ach.hidden && !ach.unlocked) return { name: ['game.hidden.name'], fact: ['game.hidden.cond'], when: ['game.hidden.when'], where: null, source: null, tier: null, hidden: true }
  let when
  if (ach.unavailable) when = ['game.unavailable']
  else if (!ach.unlocked) when = ['game.tip.locked', ach.progress?.[0] ?? 0, ach.progress?.[1] ?? 0, ach.id === 'thrifty' ? '%' : '']
  else if (ach.recheck) when = ['game.tip.recheck']
  else if (ach.dated) when = ['game.tip.unlockedOn', dateText(ach.unlockedMs, ctx.lang)]
  else when = ['game.tip.undated']
  // the ten first achievements have their own « where it shows in the office »; the others show as a medal in the cabinet
  const where = LEGACY[ach.id] ? [`game.ach.${ach.id}.where`] : ['game.where.medal']
  return {
    name: [`game.ach.${ach.id}.name`],
    fact: ach.unlocked ? ach.fact : [`game.ach.${ach.id}.cond`],
    when,
    where,
    source: src,
    // the tier reached and the next one (ids and thresholds: the interface words them, with the date of each tier)
    tier: ach.tiered ? { reached: ach.tier, next: ach.nextTier, tiers: ach.tiers.map(t => ({ tier: t.tier, at: t.at, unlocked: t.unlocked, dateText: t.ms != null ? dateText(t.ms, ctx.lang) : '' })) } : null,
    hidden: false
  }
}

/** Game lines for the journal, at their date: one per dated achievement, one post-mortem per resolved incident. */
export function journalEntries(game) {
  if (!game || game.sober) return []
  const out = []
  for (const a of game.achievements) {
    if (a.unlocked && a.dated) out.push({ kind: 'achievement', id: a.id, ms: a.unlockedMs })
    // the tiers above the first one are inscribed at their own date (silver, gold); an undated tier (thrifty gold) has no line
    for (const t of (a.tiers || []).slice(1)) if (t.unlocked && t.ms != null) out.push({ kind: 'achievement', id: a.id, tier: t.tier, ms: t.ms })
  }
  for (const i of game.incidents) out.push({ kind: 'postmortem', board: i.board, ms: i.endMs, minutes: Math.max(1, Math.round((i.endMs - i.startMs) / 60_000)), fails: i.fails })
  return out.sort((x, y) => y.ms - x.ms)
}
