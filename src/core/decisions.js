/**
 * The decision list of the panel, as pure data. One row per thing that waits for the user (an approval Hermes asks for, a blocked card),
 * the project (board) of each row, and how the rows are ordered and grouped. No SDK, no DOM, no clock of its own (callers pass `nowMs`).
 *
 * The project of a card is its board. An approval has no board of its own (a request names a session and a profile): its project is the
 * island its agent sits at (the agent's `home`), a fact the page already draws; an agent in the common room has none (« no project »).
 * Privacy: titles of cards are Hermes' board text (shown); nothing else about a card or a command enters here.
 */

/** A decision waiting longer than this is flagged (orange age). */
export const OLD_AFTER_MS = 24 * 3_600_000

/** Ways to order the list: grouped by project (default) or all together, the longest waiting first. */
export const SORTS = Object.freeze(['project', 'age'])
export const isSort = v => SORTS.includes(v)

/** Rows from `inboxView()` ({ approvals, cards }) and the office (agent -> home board). Approvals first: they expire. */
export function decisionRows(view, office) {
  const home = new Map((office?.agents || []).map(a => [a.name, a.home || null]))
  const rows = []
  for (const r of view?.approvals || []) rows.push({ key: `approval/${r.key}`, kind: 'approval', board: home.get(r.profile) ?? null, sinceMs: r.firstSeenMs ?? null, req: r })
  for (const c of view?.cards || []) rows.push({ key: `card/${c.board}/${c.id}`, kind: 'card', board: c.board, sinceMs: c.blockedMs ?? c.createdMs ?? null, card: c })
  return rows
}

/** The longest waiting first; a row with no date last. Stable. */
export const byAge = rows => [...rows].sort((a, b) => (a.sinceMs ?? Infinity) - (b.sinceMs ?? Infinity))

/** Keep one project's rows (null / '' = every row). */
export const onlyProject = (rows, slug) => (slug ? rows.filter(r => r.board === slug) : rows)

/** Is this row waiting « long »? (no date: not judged old, never invented) */
export const isOld = (row, nowMs) => row.sinceMs != null && nowMs - row.sinceMs > OLD_AFTER_MS

/**
 * Rows grouped by project: the project with the most decisions first, then the one waiting longest, then by name; « no project » last.
 * Each group: { slug (null = no project), rows (longest waiting first), count, oldestMs }.
 */
export function groupRows(rows) {
  const by = new Map()
  for (const r of byAge(rows)) {
    const k = r.board ?? ''
    if (!by.has(k)) by.set(k, { slug: r.board ?? null, rows: [] })
    by.get(k).rows.push(r)
  }
  const groups = [...by.values()].map(g => ({ ...g, count: g.rows.length, oldestMs: g.rows[0]?.sinceMs ?? null }))
  return groups.sort((a, b) => (a.slug === null) - (b.slug === null) || b.count - a.count || (a.oldestMs ?? Infinity) - (b.oldestMs ?? Infinity) || String(a.slug).localeCompare(String(b.slug), 'en'))
}

/** « 12 min », « 5 h », « 1 d 3 h »: a short age for a card header. « min » and « h » are the same in en / fr / es, the day is not
 *  (« 1 j 3 h » in French: `day` = t('ux.dec.day')). */
export function shortAge(ms, day = 'd') {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`
  if (s < 86_400) return `${Math.floor(s / 3600)} h`
  return `${Math.floor(s / 86_400)} ${day} ${Math.floor((s % 86_400) / 3600)} h`
}
