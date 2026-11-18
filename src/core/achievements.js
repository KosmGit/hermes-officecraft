/**
 * Achievements v2: the catalogue, the tiers, the hidden ones, and the twenty achievements added to the first ten.
 * Pure and deterministic like game.js: (ctx) in, plain data out; no SDK, no DOM, no clock, no storage.
 *
 * THE API TO ADD AN ACHIEVEMENT (the « command » family is added with it):
 *   const def = { id, family, hidden?, tiers?: [['bronze', 20], ['silver', 50], ['gold', 100]] | goal?: 7, source, where?, compute }
 *   compute(ctx) -> { value, ms?, fact?, unavailable?, extra? }
 *     value  the number the achievement counts (a streak, a count, a percentage); never a volume of work
 *     ms     the date of the level reached: one number (single level) or one per tier, `undefined` where undated
 *     fact   [i18nKey, ...args] the evidence shown once unlocked
 *     unavailable  true when the backend does not serve what the achievement needs (nothing is guessed: it stays locked)
 *   Pass the definitions as the 5th argument of computeGame(): computeGame(history, office, now, prefs, [def, ...]).
 *   ctx (see buildContext): { now, hist, boards, runs, events, cards, profiles, agents, roleOf, ... } — read-only.
 * Families: chains, boards, reliability, decider, team, command (not shown while it has no achievement).
 *
 * Rule: nothing here rewards volume. Tiers are streaks or quality thresholds (zero: 20 / 50 / 100 runs IN A ROW; thrifty:
 * 50 % / 80 % of tokens read from the cache), never a quantity of work done.
 */
import { roleOf } from '../scene/wardrobe.js'

export const DAY_MS = 86_400_000
export const HOUR_MS = 3_600_000

export const FAMILIES = Object.freeze(['chains', 'boards', 'reliability', 'decider', 'team', 'command'])

/** The thresholds of the new achievements, in one place. */
export const RULES_V2 = Object.freeze({
  smoothCards: 10,
  architectCards: 20,
  teamworkAssignees: 4,
  quickstartMs: HOUR_MS,
  wideBoards: 3,
  versatileBoards: 3,
  multimodelModels: 2,
  rescueMs: 24 * HOUR_MS,
  zeroSilver: 50,
  zeroGold: 100,
  ironDays: 7,
  ontimeRuns: 10,
  firstpassCards: 10,
  presentDays: 7,
  noqueueDays: 7,
  noqueueMs: 24 * HOUR_MS,
  fullteamRoles: 5,
  trainingMs: 7 * DAY_MS,
  firstmissionMs: 7 * DAY_MS,
  veteranDays: 365,
  thriftyGold: 80,
  swissRuns: 30,
  // twin, fastlane, quiet, comeback
  twinFailOutcomes: Object.freeze(['crashed', 'timed_out']),
  fastlaneMs: 10 * 60_000,
  quietUntilHour: 6,   // the same night as `owl` (RULES.owlUntilHour in game.js; tests/js/achievements.test.mjs holds them equal)
  quietMinRuns: 3,
  comebackMs: 24 * HOUR_MS,
  comebackRuns: 5
})

const finite = v => typeof v === 'number' && Number.isFinite(v)
const by = (a, b) => a - b
const liveTasks = b => (b?.tasks || []).filter(t => t && t.status !== 'archived')
const cardKey = (board, id) => `${board}/${id}`

/** Local calendar day as a whole number (consecutive days differ by exactly 1, across daylight-saving changes too). */
export const dayNo = ms => { const d = new Date(ms); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS) }
/** Local midnight (ms) that opens the day `no`. */
export const dayStart = no => { const u = new Date(no * DAY_MS); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).getTime() }

/** Longest run of consecutive days in a Set of day numbers, and the day on which a run first reached `target` (null if never). */
export function dayRun(days, target) {
  let run = 0
  let best = 0
  let hit = null
  let prev = null
  for (const d of [...days].sort(by)) {
    run = prev != null && d === prev + 1 ? run + 1 : 1
    prev = d
    if (run > best) best = run
    if (run === target && hit == null) hit = d
  }
  return { best, hit }
}

/** Longest streak of `ok` in an ordered list of { ok, ms }, and the ms of the element that first reached `target`. */
export function streakOf(list, target) {
  let run = 0
  let best = 0
  let hit = null
  for (const x of list) {
    run = x.ok ? run + 1 : 0
    if (run > best) best = run
    if (run === target && hit == null) hit = x.ms
  }
  return { best, hit }
}

/** The review rule (`firstpass`): the title starts with « Revue » / « Review » / « Revisión », or the assignee's detected role is « reviewer ». */
export const REVIEW_TITLE = /^\s*(?:\[[^\]]*\]\s*)?(revue|review|revisi[oó]n)(?![\p{L}\p{N}])/iu
export const isReviewCard = (title, role) => role === 'reviewer' || REVIEW_TITLE.test(String(title || ''))

/**
 * Everything the definitions read, built once per computation.
 *   runs     terminal runs of every board, oldest first: { board, profile, outcome, endedMs, task? }
 *   events   whitelisted kanban events, oldest first: { board, task, kind, ms }
 *   incidents the resolved incidents of computeGame, oldest first: { board, startMs, endMs, fails }
 */
export function buildContext({ history, office, nowMs, runs, events, incidents = [] }) {
  const hist = history && history.ok ? history : null
  const boards = office?.boards || []
  const agents = office?.agents || []
  const cards = []
  for (const b of boards) {
    for (const t of liveTasks(b)) {
      if (t.status === 'done' && finite(t.completedMs)) cards.push({ board: b.slug, id: t.id, assignee: t.assignee || null, completedMs: t.completedMs, title: t.title || '', modelOverride: t.modelOverride || null })
    }
  }
  cards.sort((a, b) => a.completedMs - b.completedMs)
  const roleMemo = new Map()
  const roleFor = name => {
    if (!name) return null
    if (!roleMemo.has(name)) {
      const a = agents.find(x => x.name === name)
      const hp = hist?.profiles?.[name]
      const r = roleOf({ name, description: a?.description || hp?.description || '', skills: hp?.skills, roleOverride: a?.roleOverride ?? (typeof a?.officeMeta?.role === 'string' ? a.officeMeta.role : null) })
      roleMemo.set(name, r.role)
    }
    return roleMemo.get(name)
  }
  const hbBoards = hist?.boards || []
  return {
    now: nowMs,
    hist,
    boards,
    agents,
    runs,
    events,
    incidents,   // the resolved incidents of computeGame ({ board, startMs, endMs, fails }): `comeback` reads them, never recomputes them
    cards,
    roleOf: roleFor,
    profiles: Object.values(hist?.profiles || {}),
    today: dayNo(nowMs),
    // the agent half serves the parent -> child links, the card of each run and the cron history only in its recent versions: an older one leaves these false
    hasLinks: hbBoards.some(b => Array.isArray(b.links)),
    hasRunTask: hbBoards.some(b => (b.runs || []).some(r => r?.task)),
    hasCrons: Array.isArray(hist?.crons),
    histBoard: slug => hbBoards.find(b => b.slug === slug) || null
  }
}

/** Weakly connected groups of linked cards (2 cards or more), per board: [{ board, tasks: [task] }]. */
function chains(ctx) {
  const out = []
  for (const b of ctx.boards) {
    const links = ctx.histBoard(b.slug)?.links || []
    if (!links.length) continue
    const tasks = new Map(liveTasks(b).map(t => [t.id, t]))
    const parent = new Map()
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
    for (const [p, c] of links) {
      if (!tasks.has(p) || !tasks.has(c)) continue
      for (const x of [p, c]) if (!parent.has(x)) parent.set(x, x)
      parent.set(find(p), find(c))
    }
    const groups = new Map()
    for (const x of parent.keys()) { const r = find(x); groups.set(r, [...(groups.get(r) || []), tasks.get(x)]) }
    for (const list of groups.values()) out.push({ board: b.slug, tasks: list })
  }
  return out
}

const maxCompleted = tasks => Math.max(...tasks.map(t => t.completedMs).filter(finite))

// ------------------------------------------------------------------ the definitions

/** smooth: 10 linked cards in a row (a parent -> child path), all done, none ever `blocked`. Date = the completion that makes the 10th. */
function smooth(ctx) {
  if (!ctx.hasLinks) return { value: 0, unavailable: true }
  const blocked = new Set(ctx.events.filter(e => e.kind === 'blocked').map(e => cardKey(e.board, e.task)))
  const goal = RULES_V2.smoothCards
  let best = 0
  let hit = null
  let hitBoard = null
  for (const b of ctx.boards) {
    const links = ctx.histBoard(b.slug)?.links || []
    const tasks = new Map(liveTasks(b).map(t => [t.id, t]))
    const parents = new Map()
    for (const [p, c] of links) if (tasks.has(p) && tasks.has(c)) parents.set(c, [...(parents.get(c) || []), p])
    const memo = new Map()
    const walk = (id, seen) => {
      if (memo.has(id)) return memo.get(id)
      const t = tasks.get(id)
      let res = { len: 0, at: null, d: null }
      if (t && t.status === 'done' && finite(t.completedMs) && !blocked.has(cardKey(b.slug, id)) && !seen.has(id)) {
        seen.add(id)
        let top = null
        for (const p of parents.get(id) || []) {
          const r = walk(p, seen)
          if (!top || r.len > top.len || (r.len === top.len && r.at < top.at)) top = r
        }
        const len = (top ? top.len : 0) + 1
        const at = Math.max(t.completedMs, top ? top.at : 0)
        res = { len, at, d: len === goal ? at : len > goal ? top.d : null }
        seen.delete(id)
      }
      memo.set(id, res)
      return res
    }
    for (const id of tasks.keys()) {
      const r = walk(id, new Set())
      best = Math.max(best, r.len)
      if (r.d != null && (hit == null || r.d < hit)) { hit = r.d; hitBoard = b.slug }
    }
  }
  return { value: hit != null ? best : Math.min(best, goal - 1), ms: hit, fact: ['game.fact.smooth', hitBoard, goal] }
}

/** architect: a group of at least 20 linked cards, all done. Date = the last completion of the group. */
function architect(ctx) {
  if (!ctx.hasLinks) return { value: 0, unavailable: true }
  const goal = RULES_V2.architectCards
  let value = 0
  let hit = null
  for (const g of chains(ctx)) {
    const done = g.tasks.filter(t => t.status === 'done' && finite(t.completedMs))
    const all = done.length === g.tasks.length && g.tasks.length >= goal
    value = Math.max(value, all ? g.tasks.length : Math.min(done.length, goal - 1))
    if (all) { const at = maxCompleted(done); if (!hit || at < hit.at) hit = { at, board: g.board, n: g.tasks.length } }
  }
  return { value, ms: hit?.at, fact: ['game.fact.architect', hit?.board, hit?.n] }
}

/** teamwork: a group of linked cards where at least 4 different assignees each finished a card. Date = the card that brings the 4th. */
function teamwork(ctx) {
  if (!ctx.hasLinks) return { value: 0, unavailable: true }
  const goal = RULES_V2.teamworkAssignees
  let value = 0
  let hit = null
  for (const g of chains(ctx)) {
    const done = g.tasks.filter(t => t.status === 'done' && finite(t.completedMs) && t.assignee).sort((a, b) => a.completedMs - b.completedMs)
    const seen = new Set()
    for (const t of done) {
      seen.add(t.assignee)
      if (seen.size === goal && (!hit || t.completedMs < hit.at)) hit = { at: t.completedMs, board: g.board }
    }
    value = Math.max(value, seen.size)
  }
  return { value, ms: hit?.at, fact: ['game.fact.teamwork', hit?.board, goal] }
}

/** quickstart: the first card of a board done less than an hour after the board was created. Date = that completion. */
function quickstart(ctx) {
  let hit = null
  for (const b of ctx.boards) {
    if (!finite(b.createdMs)) continue
    const first = liveTasks(b).filter(t => t.status === 'done' && finite(t.completedMs)).reduce((m, t) => (m == null || t.completedMs < m ? t.completedMs : m), null)
    if (first == null) continue
    const dt = first - b.createdMs
    if (dt >= 0 && dt < RULES_V2.quickstartMs && (!hit || first < hit.at)) hit = { at: first, board: b.slug, minutes: Math.floor(dt / 60_000) }
  }
  return { value: hit ? 1 : 0, ms: hit?.at, fact: ['game.fact.quickstart', hit?.board, hit?.minutes] }
}

/** wide: 3 boards each with a card done the same local day. Date = the first completion of the 3rd board that day. */
function wide(ctx) {
  const goal = RULES_V2.wideBoards
  const perDay = new Map()
  for (const c of ctx.cards) {
    const d = dayNo(c.completedMs)
    const m = perDay.get(d) || new Map()
    if (!m.has(c.board)) m.set(c.board, c.completedMs)
    perDay.set(d, m)
  }
  let value = 0
  let hit = null
  for (const m of perDay.values()) {
    value = Math.max(value, m.size)
    if (m.size >= goal) { const at = [...m.values()].sort(by)[goal - 1]; if (hit == null || at < hit) hit = at }
  }
  return { value, ms: hit, fact: ['game.fact.wide', goal] }
}

/** versatile: the same bot has finished cards on 3 boards. Date = the completion that opens its 3rd board. */
function versatile(ctx) {
  const goal = RULES_V2.versatileBoards
  const per = new Map()
  let value = 0
  let hit = null
  for (const c of ctx.cards) {
    if (!c.assignee) continue
    const set = per.get(c.assignee) || new Set()
    set.add(c.board)
    per.set(c.assignee, set)
    value = Math.max(value, set.size)
    if (set.size === goal && (!hit || c.completedMs < hit.at)) hit = { at: c.completedMs, who: c.assignee }
  }
  return { value, ms: hit?.at, fact: ['game.fact.versatile', hit?.who, goal] }
}

/** multimodel: on one board, done cards that pin at least 2 different models (`modelOverride`; a card without one never counts: the bot's default may be unknown). */
function multimodel(ctx) {
  const goal = RULES_V2.multimodelModels
  const per = new Map()
  let value = 0
  let hit = null
  for (const c of ctx.cards) {
    if (!c.modelOverride) continue
    const set = per.get(c.board) || new Set()
    set.add(c.modelOverride)
    per.set(c.board, set)
    value = Math.max(value, set.size)
    if (set.size === goal && (!hit || c.completedMs < hit.at)) hit = { at: c.completedMs, board: c.board }
  }
  return { value, ms: hit?.at, fact: ['game.fact.multimodel', hit?.board, goal] }
}

/** rescue (hidden): a card blocked for more than 24 h, then done. Date = the completion of that card. */
function rescue(ctx) {
  const tasks = new Map()
  for (const b of ctx.boards) for (const t of liveTasks(b)) tasks.set(cardKey(b.slug, t.id), t)
  const since = new Map()
  let hit = null
  for (const e of ctx.events) {
    const k = cardKey(e.board, e.task)
    if (e.kind === 'blocked') {
      if (!since.has(k)) since.set(k, e.ms)
    } else if ((e.kind === 'unblocked' || e.kind === 'completed') && since.has(k)) {
      const dt = e.ms - since.get(k)
      since.delete(k)
      const t = tasks.get(k)
      if (dt > RULES_V2.rescueMs && t && t.status === 'done' && finite(t.completedMs) && (!hit || t.completedMs < hit.at)) hit = { at: t.completedMs, board: e.board, hours: Math.floor(dt / HOUR_MS) }
    }
  }
  return { value: hit ? 1 : 0, ms: hit?.at, fact: ['game.fact.rescue', hit?.board, hit?.hours] }
}

/** iron (hidden): 7 consecutive closed local days, on one board, each with a terminal run and no crash nor timeout. Date = the last run of the 7th day. */
function iron(ctx) {
  const goal = RULES_V2.ironDays
  const per = new Map()   // board -> Map(day -> { ok, last })
  for (const r of ctx.runs) {
    const m = per.get(r.board) || new Map()
    const d = dayNo(r.endedMs)
    const cur = m.get(d) || { ok: true, last: 0 }
    if (r.outcome !== 'completed') cur.ok = false
    cur.last = Math.max(cur.last, r.endedMs)
    m.set(d, cur)
    per.set(r.board, m)
  }
  let value = 0
  let hit = null
  for (const [board, m] of per) {
    const days = new Set([...m].filter(([d, v]) => v.ok && d < ctx.today).map(([d]) => d))
    const { best, hit: day } = dayRun(days, goal)
    value = Math.max(value, best)
    if (day != null) { const at = m.get(day).last; if (!hit || at < hit.at) hit = { at, board } }
  }
  return { value: hit ? value : Math.min(value, goal - 1), ms: hit?.at, fact: ['game.fact.iron', hit?.board, goal] }
}

/** ontime: 10 terminal runs in a row without a timeout and without a new attempt of an already-run card. Date = the 10th. */
function ontime(ctx) {
  if (!ctx.hasRunTask) return { value: 0, unavailable: true }
  const seen = new Set()
  const list = ctx.runs.map(r => {
    const k = cardKey(r.board, r.task)
    const retry = seen.has(k)
    seen.add(k)
    return { ok: r.outcome !== 'timed_out' && !retry, ms: r.endedMs }
  })
  const { best, hit } = streakOf(list, RULES_V2.ontimeRuns)
  return { value: hit != null ? best : Math.min(best, RULES_V2.ontimeRuns - 1), ms: hit, fact: ['game.fact.ontime', RULES_V2.ontimeRuns] }
}

/** firstpass: 10 review cards in a row done without a `changes_requested` event on them. Date = the 10th. */
function firstpass(ctx) {
  const changed = new Set(ctx.events.filter(e => e.kind === 'changes_requested').map(e => cardKey(e.board, e.task)))
  const list = ctx.cards
    .filter(c => isReviewCard(c.title, ctx.roleOf(c.assignee)))
    .map(c => ({ ok: !changed.has(cardKey(c.board, c.id)), ms: c.completedMs }))
  const { best, hit } = streakOf(list, RULES_V2.firstpassCards)
  return { value: hit != null ? best : Math.min(best, RULES_V2.firstpassCards - 1), ms: hit, fact: ['game.fact.firstpass', RULES_V2.firstpassCards] }
}

/** present: 7 consecutive local days with at least one `unblocked`. Date = the last unblock of the 7th day. */
function present(ctx) {
  const days = new Map()
  for (const e of ctx.events) if (e.kind === 'unblocked') days.set(dayNo(e.ms), Math.max(days.get(dayNo(e.ms)) || 0, e.ms))
  const { best, hit } = dayRun(new Set(days.keys()), RULES_V2.presentDays)
  return { value: hit != null ? best : Math.min(best, RULES_V2.presentDays - 1), ms: hit != null ? days.get(hit) : undefined, fact: ['game.fact.present', RULES_V2.presentDays] }
}

/**
 * noqueue: 7 consecutive closed local days, each with kanban activity (an event or a terminal run), in which no card sat `blocked` for more
 * than 24 h. A card is over the line from the 24th hour of a blocked -> unblocked/done interval (or until now while it is still blocked).
 * Date = the midnight that closes the 7th day.
 */
function noqueue(ctx) {
  const bad = new Set()
  const since = new Map()
  const over = (b, e) => {
    if (e - b <= RULES_V2.noqueueMs) return
    for (let d = dayNo(b + RULES_V2.noqueueMs), end = dayNo(e), n = 0; d <= end && n < 800; d++, n++) bad.add(d)
  }
  for (const e of ctx.events) {
    const k = cardKey(e.board, e.task)
    if (e.kind === 'blocked') {
      if (!since.has(k)) since.set(k, e.ms)
    } else if ((e.kind === 'unblocked' || e.kind === 'completed') && since.has(k)) {
      over(since.get(k), e.ms)
      since.delete(k)
    }
  }
  for (const b of ctx.boards) for (const t of liveTasks(b)) if (t.status === 'blocked' && since.has(cardKey(b.slug, t.id))) over(since.get(cardKey(b.slug, t.id)), ctx.now)
  const active = new Set([...ctx.events.map(e => dayNo(e.ms)), ...ctx.runs.map(r => dayNo(r.endedMs))])
  const clean = new Set([...active].filter(d => !bad.has(d) && d < ctx.today))
  const { best, hit } = dayRun(clean, RULES_V2.noqueueDays)
  return { value: hit != null ? best : Math.min(best, RULES_V2.noqueueDays - 1), ms: hit != null ? dayStart(hit + 1) : undefined, fact: ['game.fact.noqueue', RULES_V2.noqueueDays] }
}

/** fullteam: at least 5 different roles (detectRole / hand-picked), each with a done card. Date = the completion that brings the 5th role. */
function fullteam(ctx) {
  const seen = new Set()
  let hit = null
  for (const c of ctx.cards) {
    const r = ctx.roleOf(c.assignee)
    if (!r) continue
    seen.add(r)
    if (seen.size === RULES_V2.fullteamRoles && hit == null) hit = c.completedMs
  }
  return { value: seen.size, ms: hit ?? undefined, fact: ['game.fact.fullteam', RULES_V2.fullteamRoles] }
}

/** training: an own skill of a bot modified (mtime), then a card done by that bot within 7 days. Date = that completion. */
function training(ctx) {
  let hit = null
  for (const p of ctx.profiles) {
    for (const r of p.skills?.recent || []) {
      if (!finite(r.mtimeMs)) continue
      const c = ctx.cards.find(x => x.assignee === p.name && x.completedMs >= r.mtimeMs && x.completedMs - r.mtimeMs < RULES_V2.trainingMs)
      if (c && (!hit || c.completedMs < hit.at)) hit = { at: c.completedMs, who: p.name, skill: r.name }
    }
  }
  return { value: hit ? 1 : 0, ms: hit?.at, fact: ['game.fact.training', hit?.who, hit?.skill] }
}

/** firstmission: a bot that finishes its first card within 7 days of its first sighting (`firstSeen`). Date = that completion. */
function firstmission(ctx) {
  let hit = null
  for (const p of ctx.profiles) {
    const first = p.stats?.firstSeenMs
    if (!finite(first)) continue
    const c = ctx.cards.find(x => x.assignee === p.name)   // cards are oldest first: the bot's first one
    if (c && c.completedMs >= first && c.completedMs - first < RULES_V2.firstmissionMs && (!hit || c.completedMs < hit.at)) hit = { at: c.completedMs, who: p.name }
  }
  return { value: hit ? 1 : 0, ms: hit?.at, fact: ['game.fact.firstmission', hit?.who] }
}

/** veteran: 365 days since the oldest profile was first seen. Calendar age, not time spent. Date = the day it turned 365. */
function veteran(ctx) {
  const seen = ctx.profiles.map(p => p.stats?.firstSeenMs).filter(finite)
  const oldest = seen.length ? Math.min(...seen) : null
  const days = oldest == null ? 0 : Math.max(0, Math.floor((ctx.now - oldest) / DAY_MS))
  return { value: days, ms: oldest == null ? undefined : oldest + RULES_V2.veteranDays * DAY_MS, fact: ['game.fact.veteran', days] }
}

/**
 * swiss: one cron job completed 30 times in a row (its execution history, newest 120 per job). UNDATED: the served window
 * slides with each run (and Hermes prunes past 1000), so its 30th success is not the real one and would move — like thrifty.
 */
function swiss(ctx) {
  if (!ctx.hasCrons) return { value: 0, unavailable: true }
  const goal = RULES_V2.swissRuns
  let value = 0
  let hit = null
  for (const j of ctx.hist.crons) {
    const list = (j.runs || []).map(([at, ok]) => ({ ok: ok === 1, ms: at }))
    const { best, hit: ms } = streakOf(list, goal)
    value = Math.max(value, best)
    if (ms != null && (!hit || ms < hit.at)) hit = { at: ms, name: j.name }
  }
  return { value, ms: undefined, fact: ['game.fact.swiss', hit?.name, goal] }
}

/**
 * twin: on one card, a run of a profile A ended `crashed` / `timed_out`, then a LATER run of another profile B finished `completed`.
 * Read from the served runs (every outcome, `ctx.hist`, already without the test boards, the guards and the runs without a profile), so a card
 * archived since still counts. A retry by the same profile is no understudy. Date = the end of B's run (the oldest case).
 */
function twin(ctx) {
  if (!ctx.hasRunTask) return { value: 0, unavailable: true }
  let hit = null
  for (const hb of ctx.hist?.boards || []) {
    const per = new Map()   // card -> runs of that card
    for (const r of hb.runs || []) {
      if (!r?.task || !finite(r.endedMs) || !r.profile) continue
      per.set(r.task, [...(per.get(r.task) || []), r])
    }
    for (const list of per.values()) {
      list.sort((x, y) => x.endedMs - y.endedMs)
      const failed = []   // the failed runs so far
      for (const r of list) {
        if (r.outcome === 'completed') {
          const from = failed.find(f => f.profile !== r.profile && f.endedMs < r.endedMs)
          if (from) { if (!hit || r.endedMs < hit.at) hit = { at: r.endedMs, board: hb.slug, from: from.profile, to: r.profile }; break }
        } else if (RULES_V2.twinFailOutcomes.includes(r.outcome)) failed.push(r)
      }
    }
  }
  return { value: hit ? 1 : 0, ms: hit?.at, fact: ['game.fact.twin', hit?.board, hit?.from, hit?.to] }
}

/**
 * fastlane: a served card (not archived, not a guard, not on a test board) done less than 10 minutes after it was created, never
 * `blocked`, with at least one served run and ALL its served runs `completed` (a crash, a timeout or a reclaim excludes it; a card closed by
 * hand, with no run, is not an execution). Date = the completion of the oldest one.
 */
function fastlane(ctx) {
  if (!ctx.hasRunTask) return { value: 0, unavailable: true }
  const blocked = new Set(ctx.events.filter(e => e.kind === 'blocked').map(e => cardKey(e.board, e.task)))
  let hit = null
  for (const b of ctx.boards) {
    const byCard = new Map()
    for (const r of ctx.histBoard(b.slug)?.runs || []) if (r?.task) byCard.set(r.task, [...(byCard.get(r.task) || []), r])
    for (const t of liveTasks(b)) {
      if (t.status !== 'done' || !finite(t.createdMs) || !finite(t.completedMs)) continue
      const dt = t.completedMs - t.createdMs
      if (dt < 0 || dt >= RULES_V2.fastlaneMs || blocked.has(cardKey(b.slug, t.id))) continue
      const runs = byCard.get(t.id) || []
      if (!runs.length || !runs.every(r => r.outcome === 'completed')) continue
      if (!hit || t.completedMs < hit.at) hit = { at: t.completedMs, board: b.slug, minutes: Math.max(1, Math.floor(dt / 60_000)) }
    }
  }
  return { value: hit ? 1 : 0, ms: hit?.at, fact: ['game.fact.fastlane', hit?.board, hit?.minutes] }
}

/** Whether a local instant falls in the night of `owl` (00:00 up to, not including, `quietUntilHour`). */
const inNight = ms => new Date(ms).getHours() < RULES_V2.quietUntilHour

/**
 * quiet: a CLOSED local night (the hours of `owl`) with at least 3 terminal runs, all `completed`, and no `blocked` event in it.
 * Value = the most runs of a clean closed night (out of 3). The test boards and the guards are already out of `ctx.runs` / `ctx.events`; a
 * board whose reading failed on its schema (`partial` `kanban:<slug>` / `schema`) is left out: its `blocked` cannot be read, so a night is not
 * judged « without a block » on it. Date = the end of the last run of the oldest clean night.
 */
function quiet(ctx) {
  const skip = new Set((ctx.hist?.partial || []).filter(p => p?.reason === 'schema' && String(p.source).startsWith('kanban:')).map(p => String(p.source).slice('kanban:'.length)))
  const nights = new Map()   // day number -> { n, ok, last }
  for (const r of ctx.runs) {
    if (skip.has(r.board) || !inNight(r.endedMs)) continue
    const d = dayNo(r.endedMs)
    const cur = nights.get(d) || { n: 0, ok: true, last: 0 }
    cur.n++
    if (r.outcome !== 'completed') cur.ok = false
    cur.last = Math.max(cur.last, r.endedMs)
    nights.set(d, cur)
  }
  for (const e of ctx.events) if (e.kind === 'blocked' && !skip.has(e.board) && inNight(e.ms) && nights.has(dayNo(e.ms))) nights.get(dayNo(e.ms)).ok = false
  const closed = d => d < ctx.today || (d === ctx.today && !inNight(ctx.now))
  const goal = RULES_V2.quietMinRuns
  let value = 0
  let hit = null
  let runsOfHit = 0
  for (const [d, v] of [...nights].sort((x, y) => x[0] - y[0])) {
    if (!v.ok || !closed(d)) continue
    value = Math.max(value, v.n)
    if (v.n >= goal && hit == null) { hit = v.last; runsOfHit = v.n }
  }
  return { value: hit != null ? value : Math.min(value, goal - 1), ms: hit ?? undefined, fact: ['game.fact.quiet', runsOfHit] }
}

/**
 * comeback (hidden): a board whose incident (the `incidents` of computeGame: a failure, then the first success) lasted more than
 * 24 h, followed by 5 terminal runs of that board in a row, all `completed`, the one that closed the incident included. Value = the longest
 * such series (out of 5). Date = the end of the 5th run of the oldest case.
 */
function comeback(ctx) {
  const goal = RULES_V2.comebackRuns
  let value = 0
  let hit = null
  for (const inc of ctx.incidents || []) {
    if (!(inc.endMs - inc.startMs > RULES_V2.comebackMs)) continue
    const own = ctx.runs.filter(r => r.board === inc.board)
    const i = own.findIndex(r => r.endedMs === inc.endMs && r.outcome === 'completed')
    if (i < 0) continue
    let n = 0
    while (i + n < own.length && own[i + n].outcome === 'completed' && n < goal) n++
    value = Math.max(value, n)
    if (n === goal && (!hit || own[i + goal - 1].endedMs < hit.at)) hit = { at: own[i + goal - 1].endedMs, board: inc.board, hours: Math.floor((inc.endMs - inc.startMs) / HOUR_MS) }
  }
  return { value: hit ? goal : Math.min(value, goal - 1), ms: hit?.at, fact: ['game.fact.comeback', hit?.board, hit?.hours, goal] }
}

const T = (id, family, source, compute, more = {}) => Object.freeze({ id, family, source, compute, ...more })

/** The twenty achievements added to the first ten (those stay computed in game.js; their family and tiers are in LEGACY below). */
export const NEW_DEFS = Object.freeze([
  T('smooth', 'chains', 'links', smooth, { goal: RULES_V2.smoothCards }),
  T('architect', 'chains', 'links', architect, { goal: RULES_V2.architectCards }),
  T('teamwork', 'chains', 'links', teamwork, { goal: RULES_V2.teamworkAssignees }),
  T('quickstart', 'boards', 'cards', quickstart, { goal: 1 }),
  T('wide', 'boards', 'cards', wide, { goal: RULES_V2.wideBoards }),
  T('versatile', 'boards', 'cards', versatile, { goal: RULES_V2.versatileBoards }),
  T('multimodel', 'boards', 'cards', multimodel, { goal: RULES_V2.multimodelModels }),
  T('rescue', 'reliability', 'events', rescue, { goal: 1, hidden: true }),
  T('iron', 'reliability', 'runs', iron, { goal: RULES_V2.ironDays, hidden: true }),
  T('ontime', 'reliability', 'runs', ontime, { goal: RULES_V2.ontimeRuns }),
  T('firstpass', 'reliability', 'cards', firstpass, { goal: RULES_V2.firstpassCards }),
  T('swiss', 'reliability', 'crons', swiss, { goal: RULES_V2.swissRuns }),
  T('present', 'decider', 'events', present, { goal: RULES_V2.presentDays }),
  T('noqueue', 'decider', 'events', noqueue, { goal: RULES_V2.noqueueDays }),
  T('fullteam', 'team', 'cards', fullteam, { goal: RULES_V2.fullteamRoles }),
  T('training', 'team', 'skills', training, { goal: 1 }),
  T('firstmission', 'team', 'sessions', firstmission, { goal: 1 }),
  T('veteran', 'team', 'sessions', veteran, { goal: RULES_V2.veteranDays }),
  // four more
  T('twin', 'team', 'runs', twin, { goal: 1 }),
  T('fastlane', 'boards', 'cards', fastlane, { goal: 1 }),
  T('quiet', 'reliability', 'runs', quiet, { goal: RULES_V2.quietMinRuns }),
  T('comeback', 'reliability', 'runs', comeback, { goal: RULES_V2.comebackRuns, hidden: true })
])

/** Family and tiers of the ten first achievements (their computation stays in game.js). No hidden one among them. */
export const LEGACY = Object.freeze({
  chain: { family: 'chains' },
  centurion: { family: 'chains' },
  zero: { family: 'reliability', tiers: [['bronze', 20], ['silver', RULES_V2.zeroSilver], ['gold', RULES_V2.zeroGold]] },
  quick: { family: 'decider' },
  review: { family: 'reliability' },
  owl: { family: 'boards' },
  thrifty: { family: 'team', tiers: [['bronze', 50], ['gold', RULES_V2.thriftyGold]] },
  hire: { family: 'team' },
  builder: { family: 'boards' },
  fire: { family: 'reliability' }
})

/** The record every achievement ends up as (the shape the tooltip, the collection, the journal and the scene read). */
export function finishRecord(def, res) {
  const levels = def.tiers && def.tiers.length ? def.tiers : [[null, def.goal]]
  const value = res.unavailable ? 0 : Math.max(0, Number(res.value) || 0)
  const dates = Array.isArray(res.ms) ? res.ms : [res.ms]
  const tiers = levels.map(([tier, at], i) => ({ tier, at, unlocked: !res.unavailable && value >= at, ms: finite(dates[i]) ? dates[i] : null }))
  const reached = tiers.filter(t => t.unlocked)
  const unlocked = reached.length > 0
  const next = tiers.find(t => !t.unlocked) || null
  const goal = (next || tiers[tiers.length - 1]).at
  const unlockedMs = unlocked ? tiers[0].ms : null
  const progress = [unlocked ? Math.min(value, goal) : Math.min(value, goal - 1), goal]
  const tiered = Boolean(def.tiers && def.tiers.length)
  return {
    id: def.id,
    family: def.family,
    hidden: Boolean(def.hidden),
    unlocked,
    unlockedMs,
    dated: unlocked && unlockedMs != null,
    fact: unlocked ? res.fact : [res.unavailable ? 'game.unavailable' : 'game.near', ...(res.unavailable ? [] : progress)],
    progress,
    value,
    source: def.source,
    where: def.where ?? null,
    unavailable: Boolean(res.unavailable),
    tiered,
    tier: tiered && reached.length ? reached[reached.length - 1].tier : null,
    tiers: tiered ? tiers : [],
    nextTier: tiered && next ? { tier: next.tier, at: next.at } : null,
    ...(res.extra || {})
  }
}

/** « N hidden »: the locked hidden achievements, counted by the collection (never named). */
export const hiddenLocked = list => list.filter(a => a.hidden && !a.unlocked).length

/**
 * Collection order: unlocked first, the most recently unlocked on top (undated ones after the dated ones), then the locked ones, the closest
 * to their goal first (a locked hidden one comes last: there is nothing to compare). Stable: ties keep the catalogue order.
 */
export function collectionOrder(list) {
  const idx = new Map(list.map((a, i) => [a.id, i]))
  const near = a => (a.hidden ? -1 : a.progress[1] ? a.progress[0] / a.progress[1] : 0)
  return [...list].sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1
    if (a.unlocked) {
      if ((a.unlockedMs != null) !== (b.unlockedMs != null)) return a.unlockedMs != null ? -1 : 1
      if (a.unlockedMs !== b.unlockedMs) return b.unlockedMs - a.unlockedMs
    } else if (near(a) !== near(b)) return near(b) - near(a)
    return idx.get(a.id) - idx.get(b.id)
  })
}

/** The collection grouped by family, in the order of FAMILIES; a family with no achievement is left out. -> [{ family, items, unlocked }] */
export function collectionFamilies(list) {
  return FAMILIES.map(family => {
    const items = collectionOrder(list.filter(a => a.family === family))
    return { family, items, unlocked: items.filter(a => a.unlocked).length }
  }).filter(f => f.items.length)
}

/* ---------- « Command »: the achievements of the orders given from the office ---------- */

/**
 * The three achievements of the family « command », read from the audit journal of the agent half (`GET /orders`): a fact is
 * a journal line, never a click. Pass the result as the 5th argument of computeGame (the page does, once the journal is served).
 *   pilot     the first order that was carried out (unblock or comment) — the agent half wrote the line after reading the state back.
 *   recruiter the first bot created from the office: the page wrote the line only once `profiles.list` listed the new bot.
 *   guardian  (hidden) the first approval request refused from the office, answered and re-read.
 * A line of the model follow-up (`reason: model_applied`) is not a second recruitment.
 * Dates: the journal is read through its newest `window` lines; when it came back full the first line may be older than the window, so the
 * achievement is UNDATED then (never a wrong date, like thrifty). A journal that was not read yields no definition at all: the
 * family stays out of the game rather than showing three locked medals nobody can earn.
 */
const done = e => e && e.result === 'done'
const oldest = list => list.reduce((a, e) => (!a || e.ms < a.ms ? e : a), null)
export const COMMAND_RULES = Object.freeze({
  pilot: e => done(e) && e.source === 'agent' && (e.verb === 'unblock' || e.verb === 'comment'),
  recruiter: e => done(e) && e.verb === 'recruit' && e.source === 'page' && e.reason !== 'model_applied',
  // the line must carry `request`, the id of a request the page had seen pending (requestStamp)
  guardian: e => done(e) && e.verb === 'approval' && e.choice === 'deny' && e.source === 'page' && Boolean(e.request)
})

export function commandDefs(journal, window = 50) {
  if (!journal || journal.ok !== true || !Array.isArray(journal.entries)) return []
  const full = journal.entries.length >= window
  const first = rule => oldest(journal.entries.filter(COMMAND_RULES[rule]))
  const make = (id, hidden, fact) => Object.freeze({
    id, family: 'command', hidden, goal: 1, source: 'audit',
    compute: () => {
      const e = first(id)
      return { value: e ? 1 : 0, ms: e && !full ? e.ms : undefined, fact: e ? fact(e) : ['game.near'] }
    }
  })
  return [
    make('pilot', false, e => ['game.fact.pilot', e.verb, e.board]),
    make('recruiter', false, e => ['game.fact.recruiter', e.profile]),
    make('guardian', true, () => ['game.fact.guardian'])
  ]
}
export const COMMAND_IDS = Object.freeze(['pilot', 'recruiter', 'guardian'])
