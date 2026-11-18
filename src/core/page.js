/**
 * What the office page DECIDES, as pure functions: no SDK, no DOM, no clock of its own, no React. The
 * components (OfficePage.jsx, SidePanel.jsx, ...) only wire these to hooks and elements; tests/js/page.test.mjs checks them
 * by value under node (a mutated condition fails a test, which a regex on the component's source never guaranteed).
 *
 * The banner. ONE discreet `role="status"` line says two things: the last reading of /live is old because the read keeps
 * failing (`errorUpdatedAt > dataUpdatedAt`), and which sources the agent half could not read (`partial`).
 */
import { gameShown } from './game.js'
import { toPartial } from './history.js'
import { fitScale } from '../scene/fit.js'
import { NARROW_AT } from './tabs.js'

/** At or below 700 px of pane (the pane the plugin gets, not the window) the page shows ONE view at a time (office, decisions, projects, journal) and a bar of four at the bottom; wider, the panel sits beside the office. */
export const DRAWER_BELOW = NARROW_AT + 1

/** Sober mode: the game layer computes and shows nothing unless it is on AND /history answered AND the office is complete. */
export const soberOf = (gameOn, history, office) => !gameShown(gameOn, history ?? null, office)

/**
 * What the page body is: `loading` (first read pending), `unreachable` (no reading at all: a failure AFTER a good read keeps the
 * office), `empty` (nobody to draw), `office`. roster = { isLoading, isError, hasData, deskCount }.
 */
export function bodyOf({ isLoading, isError, hasData, deskCount }) {
  if (isLoading && !hasData) return 'loading'
  if (isError && !(deskCount > 0)) return 'unreachable'
  if (!(deskCount > 0)) return 'empty'
  return 'office'
}

/** What closing the side panel does: the drawer of a narrow pane closes, a wide panel folds (a preference), and the focus always goes back to the toggle. */
export const panelCloseEffects = ({ narrow }) => ({ closeDrawer: Boolean(narrow), foldPanel: !narrow, focusToggle: true })

/** Escape closes the drawer, only while the narrow drawer is open. */
export const drawerKeyCloses = ({ narrow, drawerOpen }, key) => key === 'Escape' && Boolean(narrow) && Boolean(drawerOpen)

/* ---------- the panel yields to the office ---------- */

/** Width of the details column: 328 px up to 1320 px of pane, 400 px from 1500 px, else 360 (pageStyles.js container queries). */
export const PANEL_MEDIUM_AT = 1320
export const PANEL_WIDE_AT = 1500
export const panelWidthOf = paneW => (paneW <= PANEL_MEDIUM_AT ? 328 : paneW >= PANEL_WIDE_AT ? 400 : 360)
/** Gap between the stage and the panel (.ux-main), and the stage's own 1 px borders. */
export const MAIN_GAP = 12
export const STAGE_EDGE = 2
/** A folded panel comes back only when the office would keep 10 % MORE than the list threshold beside it (no folding / unfolding flicker). */
export const FIT_MARGIN = 1.1

/**
 * Would the office still be DRAWN (not a list) with the panel beside it? Same rule as the scene itself (`fitScale`: the list starts under
 * LIST_BELOW), applied to the width the stage keeps next to the panel: the threshold is the scene's, not a number of this page's.
 * `art` = { W, H, availH, dpr, people } as the scene measured it. `margin` > 1 asks for that much room to spare. null art -> true.
 */
export function sceneFitsBeside(paneW, art, margin = 1) {
  if (!art || !(paneW > 0)) return true
  const availW = (paneW - panelWidthOf(paneW) - MAIN_GAP - STAGE_EDGE) / margin
  return fitScale({ availW, availH: art.availH / margin, W: art.W, H: art.H, dpr: art.dpr, people: art.people }).mode === 'scene'
}

/** Would the office be drawn with the whole pane? (If even that is a list, folding the panel would not help.) */
export function sceneFitsAlone(paneW, art) {
  if (!art || !(paneW > 0)) return true
  return fitScale({ availW: paneW - STAGE_EDGE, availH: art.availH, W: art.W, H: art.H, dpr: art.dpr, people: art.people }).mode === 'scene'
}

/**
 * Is the panel folded by the page (not by the user)? Decided from what is on screen, one step at a time:
 *   - no wish to see the panel, or nothing measured: no;
 *   - the panel is shown: it folds when the scene REALLY fell to a list (`art.mode`) and the whole pane would draw it;
 *   - the panel is folded: it stays folded until the office would keep `FIT_MARGIN` more room than the list threshold beside it
 *     (or the whole pane would not draw it either: then the panel comes back, a hidden panel buys nothing).
 */
export function foldStep({ folded, wideOpen, paneW, art }) {
  if (!wideOpen || !art) return false
  if (!folded) return art.mode === 'list' && sceneFitsAlone(paneW, art)
  return sceneFitsAlone(paneW, art) && !sceneFitsBeside(paneW, art, FIT_MARGIN)
}

/**
 * The fold must not depend on its own effect. `foldStep` predicts « the office fits beside the panel » from the art as
 * measured with the panel in ONE state; the scene then measures the other state (stage height with the selection bar, list vs scene)
 * and may contradict the prediction: folded -> « fits beside » -> unfold -> list -> fold -> ... one render per turn, until React gives
 * up (#185). Here the page remembers WHICH inputs a fold was taken on (`refused` = the key of pane width + art W/H/people/dpr: what the
 * panel state cannot change) and a folded panel only unfolds once one of them has changed. Each transition therefore needs a change
 * from outside (a resize, another roster): no loop is possible whatever the measures say.
 */
export const foldKey = (paneW, art) => (art ? [paneW, art.W, art.H, art.people, art.dpr].join('|') : '')

/** Slack (CSS px) between the width the page expects the stage to have and the one the scene measured (frame padding, scrollbar). */
export const READ_TOL = 48

/**
 * Was `art` taken at the width the stage has NOW? The scene reports the width it measured (`art.availW`); the page knows what
 * the stage gets in each panel state (the whole pane alone, or the pane minus the panel beside it). A reading taken at another width is
 * STALE (the pane just grew from 380 to 1024 px and the scene still reports the narrow list): it decides nothing, neither a fold nor
 * the end of a forced panel. A reading without `availW` (older callers) counts as current.
 */
export function readingCurrent({ paneW, panelShown, art }) {
  if (!art || !(art.availW > 0) || !(paneW > 0)) return true
  const expected = panelShown ? paneW - panelWidthOf(paneW) - MAIN_GAP - STAGE_EDGE : paneW - STAGE_EDGE
  return Math.abs(art.availW - expected) <= READ_TOL
}

/**
 * -> { folded, refused }: the next state of the fold from the current one (`refused` = key of the inputs of the last fold, or '').
 * `held` = the pane width at which the user opened the panel by hand: at that width the page does not fold it again (it lets go when the
 * width changes). A stale reading changes nothing.
 */
export function foldPlan({ folded, refused = '', wideOpen, paneW, art, held = null }) {
  if (!wideOpen || !art) return { folded: false, refused: '' }
  if (!readingCurrent({ paneW, panelShown: !folded, art })) return { folded, refused }
  const key = foldKey(paneW, art)
  if (!folded) return held !== paneW && foldStep({ folded, wideOpen, paneW, art }) ? { folded: true, refused: key } : { folded: false, refused }
  if (foldStep({ folded, wideOpen, paneW, art }) || key === refused) return { folded: true, refused }
  return { folded: false, refused }
}

/**
 * Does a FORCED panel stay forced? It becomes an ordinary open panel only when the office is drawn AND fits beside
 * it, as READ with the panel shown. A reading taken while the panel was still folded (full width, panel not yet laid out) or at another
 * width is not « the scene is drawn again »: dropping `forced` on it would shut the panel the instant the user opened it.
 */
export const forcedStep = ({ forced, paneW, art }) =>
  Boolean(forced) && !(art?.mode === 'scene' && readingCurrent({ paneW, panelShown: true, art }) && sceneFitsBeside(paneW, art))

/**
 * What a wide pane does with the panel: the preference `wideOpen` is the user's wish; the page folds it (`folded`) when the office would
 * fall to a list beside it, the drawing stays. `forced` = the user opened it anyway: the panel shows and the office is a list, SAID on
 * screen (`listBeside`), never silently. -> { open, autoFolded, listBeside }
 */
export function panelPlan({ wideOpen, forced, folded, listed }) {
  const wish = Boolean(wideOpen)
  const open = (wish && !folded) || Boolean(forced)
  return { open, autoFolded: wish && Boolean(folded) && !forced, listBeside: open && Boolean(listed) }
}

/**
 * The toggle of a wide pane, from what is on screen. Closing a panel that only showed because the user forced it leaves the preference
 * alone (the page folds it again); closing a plain open panel folds it (a preference). Opening a page-folded panel, or one that would not
 * fit, forces it (so the page does not undo the user's gesture). -> { wideOpen: boolean | undefined (unchanged), forced }
 */
export function panelToggle({ shown, forced, folded, wideOpen, fits }) {
  if (shown) return forced ? { wideOpen: undefined, forced: false } : { wideOpen: false, forced: false }
  if (wideOpen && folded) return { wideOpen: undefined, forced: true }
  return { wideOpen: true, forced: !fits }
}

/* ---------- staleness of /live ---------- */

/** When /live is failing: the time of the last good reading (ms), else null (fine, or never read: nothing to call stale). */
export function staleOf(query) {
  const data = Number(query?.dataUpdatedAt) || 0
  const error = Number(query?.errorUpdatedAt) || 0
  return data > 0 && error > data ? data : null
}

/* ---------- partial ---------- */

/** `partial` of /live and /history merged: one entry per source (first reason kept), sorted by source. Absent field -> []. */
export function partialSources(live, history) {
  const by = new Map()
  for (const p of [...(toPartial(live?.partial) ?? []), ...(toPartial(history?.partial) ?? [])]) if (!by.has(p.source)) by.set(p.source, p)
  return [...by.values()].sort((a, b) => a.source.localeCompare(b.source, 'en'))
}

const SOURCE_KINDS = new Set(['kanban', 'profiles', 'sessions', 'gateway', 'ops', 'cron'])

/** Sources as the page says them: [{ kind, name }] (`kanban:<slug>`, `sessions:<profile>`, `cron:<profile>` carry a name), at most `max`, the rest counted. */
export function partialView(partial, max = 4) {
  const labels = (partial || []).map(p => {
    const [kind, ...rest] = String(p.source).split(':')
    return SOURCE_KINDS.has(kind) ? { kind, name: rest.join(':') } : { kind: 'unknown', name: '' }
  })
  return { labels: labels.slice(0, max), more: Math.max(0, labels.length - max) }
}

/** The banner of the page: null when there is nothing to say, else { staleMs, partial } (staleMs null when only partial). */
export function bannerOf({ live, history, streaks = null }) {
  const staleMs = staleOf(live)
  // with the streaks of the reads (usePartialStreaks) a transient failure is not said until it repeats; without them, everything is said
  const said = (body, key) => (streaks ? { ...body, partial: confirmedPartial(toPartial(body?.partial) ?? [], streaks[key]) } : body)
  const partial = partialView(partialSources(said(live?.data, 'live'), said(history, 'history')))
  if (staleMs == null && !partial.labels.length) return null
  return { staleMs, partial }
}

/* ---------- the page ---------- */

/**
 * Everything the page decides from what the hooks returned.
 *   width, drawerOpen, wideOpen   layout (width 0 = not measured yet)
 *   roster { isLoading, isError, hasData }, deskCount
 *   gameOn, history (the /history reading or null), office (buildOffice)
 *   live { data, dataUpdatedAt, errorUpdatedAt }
 */
export function pageModel({ width, drawerOpen, wideOpen, forced = false, folded = false, art = null, roster, deskCount, gameOn, history, office, live, streaks = null }) {
  const narrow = width > 0 && width < DRAWER_BELOW
  const sober = soberOf(gameOn, history, office)
  const plan = panelPlan({ wideOpen, forced, folded, listed: art?.mode === 'list' })
  return {
    narrow,
    autoFolded: width > 0 && !narrow && plan.autoFolded,
    listBeside: width > 0 && !narrow && plan.listBeside,
    panelOpen: width > 0 && (narrow ? Boolean(drawerOpen) : plan.open),
    body: bodyOf({ ...roster, deskCount }),
    sober,
    showGameBar: !sober && deskCount > 0,
    banner: bannerOf({ live, history, streaks })
  }
}

/* ---------- a partial reading is said once it lasts ---------- */

/**
 * A bot's `state.db` that misses its 0.3 s slot while a worker is writing (or the 0.45 s budget of the
 * whole session phase) is flagged `sessions:<bot>` / `locked` for that ONE read, and is left alone for the next 30 s. That is a blip, not
 * a missing source: the banner « Partial data · 1 source » would flash and be gone at the next read.
 * So a transient reason (`locked`, `unreadable`) is shown only after `PARTIAL_CONFIRM_READS` reads of that route in a row name the same
 * source; a structural one (`schema`: Hermes changed a table; `missing`: no such file) is shown at once.
 */
export const PARTIAL_CONFIRM_READS = 2
const TRANSIENT = new Set(['locked', 'unreadable'])

/** Consecutive reads naming each source: `streaks` (Map source -> n) of the previous reads, `partial` of the new one -> the new Map. */
export function nextStreaks(streaks, partial) {
  const next = new Map()
  for (const p of partial || []) next.set(p.source, (streaks?.get(p.source) ?? 0) + 1)
  return next
}

/** The entries of `partial` worth saying now (see above). */
export function confirmedPartial(partial, streaks, min = PARTIAL_CONFIRM_READS) {
  return (partial || []).filter(p => !TRANSIENT.has(p.reason) || (streaks?.get(p.source) ?? 0) >= min)
}
