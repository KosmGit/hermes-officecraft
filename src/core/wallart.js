/**
 * Wall art: which REAL milestones deserve a poster, and which posters the wall carries.
 * A milestone is an achievement of the game layer that the history proves and dates (a board finished, a tier reached…): no date, no
 * milestone; no milestone, no poster. The model only chooses a motif and two colours for each (the agent half validates them); the
 * gilded frame and the tooltip (milestone + date) come from these data. Pure: no SDK, no DOM, no clock (`nowMs` is given).
 * The agent half (hermes_officecraft/llm.py) takes `milestones: [{ kind, tier, board, cards, at }]`, key `kind:tier:board`.
 */
import { MOTIFS, POSTERS_MAX, normalizePosters } from '../scene/art.js'

/** What the agent half accepts as a milestone's `kind` (hermes_officecraft/llm.py `_KIND_RE`): every achievement id of the catalogue fits. */
export const KIND_RE = /^[a-z_]{2,24}$/
const DAY_MS = 86_400_000
/** A call carries six milestones at most (hermes_officecraft/llm.py MILESTONES_MAX). */
export const MILESTONES_MAX = 6

/** The cache key of a poster on the agent half: `kind:tier:board`, with `-` for a missing tier or board. */
export const posterKey = m => `${m.kind}:${m.tier || '-'}:${m.board || '-'}`

const finite = v => typeof v === 'number' && Number.isFinite(v)

/**
 * The real milestones, newest first: one per achievement unlocked AND dated (the highest tier reached that has a date, for a tiered one).
 * -> [{ key, kind, tier, board, cards, ms }]. `board` only when it is a board the page serves (the agent half refuses any other);
 * `cards` = the cards done on that board (a real count of /live) or null; a date in the future is not a fact (the agent half refuses it too).
 * A locked achievement, an undated one (`thrifty`, an aggregate of the whole history) and the sober game give nothing. Pure.
 */
export function milestonesOf(game, office, nowMs) {
  if (!game || game.sober) return []
  const boards = new Map((office?.boards || []).map(b => [b.slug, b]))
  const out = []
  for (const a of game.achievements || []) {
    if (!a?.unlocked || !KIND_RE.test(String(a.id))) continue
    let tier = null
    let ms = null
    if (a.tiered && Array.isArray(a.tiers)) {
      const reached = a.tiers.filter(t => t.unlocked && finite(t.ms))
      const top = reached[reached.length - 1]
      if (!top) continue
      tier = top.tier
      ms = top.ms
    } else if (a.dated && finite(a.unlockedMs)) ms = a.unlockedMs
    if (ms == null || ms > nowMs + DAY_MS) continue
    const board = typeof a.board === 'string' && boards.has(a.board) ? a.board : null
    const m = { kind: a.id, tier, board, cards: board ? boards.get(board).done ?? null : null, ms }
    out.push({ key: posterKey(m), ...m })
  }
  return out.sort((p, q) => q.ms - p.ms || (p.key < q.key ? -1 : 1))
}

/** `at` of a milestone as the agent half reads it: an ISO date (UTC, to the second). */
export const isoOf = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/** The body of `POST /llm/art`: the milestones without a poster yet (at most six), newest first; null when there is nothing to send. */
export function artBody(id, milestones, lang) {
  const items = (milestones || []).slice(0, MILESTONES_MAX).map(m => ({ kind: m.kind, tier: m.tier, board: m.board, cards: m.cards, at: isoOf(m.ms) }))
  if (!items.length) return null
  return { id, milestones: items, lang: ['en', 'fr', 'es'].includes(lang) ? lang : 'en' }
}

/** Milestones the model has not drawn yet (nothing is called for the others: the agent half would skip them too). */
export const pendingMilestones = (milestones, art) => (milestones || []).filter(m => !art?.[m.key])

/**
 * The posters the wall carries: only milestones that are real AND have a poster fiche (key match), newest first, at most POSTERS_MAX;
 * a fiche whose milestone is gone (an old key) is never hung. -> the scene's poster list (src/scene/art.js normalizePosters).
 */
export function postersOf(milestones, art) {
  const out = []
  for (const m of milestones || []) {
    const p = art?.[m.key]?.poster
    if (!p || !MOTIFS.includes(p.motif)) continue
    out.push({ key: m.key, kind: m.kind, tier: m.tier, board: m.board, ms: m.ms, motif: p.motif, sky: p.sky, accent: p.accent })
  }
  return normalizePosters(out).slice(0, POSTERS_MAX)
}

/**
 * The tooltip of a poster (the fact, its date, its source), as the interface keys it: { name, fact, extra, source }, each
 * [i18nKey, ...args]. `achName` = the achievement's name already translated; `date` = « Jun 5, 2026 ». The page never says more than the data.
 */
export function posterTip(p, { achName, date, tierName = '', readClock = '' }) {
  return {
    name: ['llm.art.spot', achName],
    // « Chain (Gold) · alpha »: the connectors are punctuation, the words are the interface's own (achievement, tier) and the data's (board)
    fact: ['llm.art.fact', `${achName}${tierName ? ` (${tierName})` : ''}${p.board ? ` · ${p.board}` : ''}`, date],
    extra: ['llm.art.drawn'],
    source: ['llm.art.source', readClock]
  }
}
