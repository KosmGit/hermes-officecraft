import { EmptyState, host, useQueryClient, useValue } from '@hermes/plugin-sdk'
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { resolveLight } from '../core/daylight.js'
import { computeGame, decorOf, keepSeenWhilePartial, unlockAnnouncement } from '../core/game.js'
import { gameInputsKey } from '../core/gamekey.js'
import { sceneProfiles } from '../core/history.js'
import { modelOf, withWorkerModels } from '../core/models.js'
import { withNonEmptySessions } from '../core/roster.js'
import { buildOffice, summarizeOffice } from '../core/office.js'
import { focusSelector } from '../core/orderflow.js'
import { drawerKeyCloses, foldPlan, forcedStep, pageModel, partialSources, panelCloseEffects, panelToggle, sceneFitsBeside } from '../core/page.js'
import { commandDefs } from '../core/achievements.js'
import { trophyPayload } from '../core/notify.js'
import { llmView, manualProfiles, withModelRoles } from '../core/llm.js'
import { relaysOfOffice } from '../core/seating.js'
import { thoughtRoles } from '../core/thoughts.js'
import { clampCursor, clockLabel, journalOf, livePollMs, nightSummary, nightWindow, officeAt, replayKeyExits, replayPollNeeded } from '../core/replay.js'
import { JOURNAL_FETCH, isBusy, journalServed, offeredWrites } from '../core/orders.js'
import { badgesOf, cardRef, newAttention, newBadges, newQuiet, quietNow, topStats } from '../core/panel.js'
import { formatSpan } from '../core/hud.js'
import { alertsOf } from '../core/alerts.js'
import { isSort } from '../core/decisions.js'
import { isTab } from '../core/tabs.js'
import { recallSelection, rememberSelection, rememberedSelection } from '../core/uistate.js'
import { $gameMode, $lightPref, $motionPref, $nightPref, $panelOpen, $seatChoice, readSeen, setPanelOpen, setSeatChoice, writeSeen } from '../data/prefs.js'
import { useApprovals } from '../data/approvals.js'
import { JOURNAL_POLL_MS, useOrderJournal, useOrders } from '../data/orders.js'
import { useLlm } from '../data/llm.js'
import { reportTrophies } from '../data/notify.js'
import { useThoughts } from '../data/thoughts.js'
import { useReplay } from '../data/replay.js'
import { HISTORY_POLL_MS, LIVE_KEY, PAGE_POLL_MS, ROSTER_KEY, useBackendHealth, useHistory, useLive, useRoster } from '../data/queries.js'
import { AlertRail } from './AlertRail.jsx'
import { DecorDialog } from './DecorDialog.jsx'
import { CampaignDialog } from './CampaignDialog.jsx'
import { HireDialog, hireProfiles } from './HireDialog.jsx'
import { settingsSheet } from './layout.js'
import { OfficeScene, usePageVisible } from './OfficeScene.jsx'
import { PageHeader } from './PageHeader.jsx'
import { PAGE_CSS } from './pageStyles.js'
import { ProjectColors, useProjectColors } from './ProjectChip.jsx'
import { ProjectDock } from './ProjectDock.jsx'
import { TabBar } from './TabBar.jsx'
import { OrderBar } from './Orders.jsx'
import { ReplayBar } from './ReplayBar.jsx'
import { ReplayPanel } from './ReplayPanel.jsx'
import { REPLAY_CSS } from './replayStyles.js'
import { Vitrine } from './Collection.jsx'
import { UsageDialog } from './UsageDialog.jsx'
import { USAGE_CSS } from './usageStyles.js'
import { SeatingDialog } from './SeatingDialog.jsx'
import { SettingsGear } from './SettingsGear.jsx'
import { SidePanel } from './SidePanel.jsx'
import { focusBackTarget, skipPlan } from './targets.js'
import { EmptyOffice } from './EmptyOffice.jsx'
import { usePartialStreaks } from './usePartialStreaks.js'
import { canOpenKanban, canOpenSession, openDeskSession, openKanban } from './openSession.js'
import { postcardName, savePostcard } from './postcard.js'
import { toSceneModel } from '../scene/index.js'
import { PANEL_CSS } from './panelStyles.js'
import * as s from './styles.js'
import { usePageClock } from './usePageClock.js'
import { useT } from './useT.js'


/** Content width of an element, measured; 0 until the first measure. No timer: a ResizeObserver, disconnected on unmount. */
function useWidth(ref) {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect
      if (r) setW(prev => (prev === Math.floor(r.width) ? prev : Math.floor(r.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/**
 * The page draws the office (isometric canvas + HUD, or the same facts as a list in a narrow pane) and,
 * beside it, a read-only side panel (inspector, decisions waiting, chains, journal) that is a drawer in a narrow pane.
 * One query per source (roster, /live, /history), polled by useQuery; the scene only repaints what changed.
 */
export function OfficePage({ ctx }) {
  const t = useT()
  // the replay. While it shows a past moment the page's own reads (roster, /live, /history, the order journal, the fiches) are
  // not polled: nothing on screen is the present, and nothing is asked of Hermes that the replay does not need.
  const [replayOn, setReplayOn] = useState(false)
  const [replayKind, setReplayKind] = useState('night')
  const [cursor, setCursor] = useState(null)   // ms, null until the facts are read
  const [factFilter, setFactFilter] = useState({ board: null, agent: null, group: null, all: false })
  const roster = useRoster(livePollMs(replayOn, PAGE_POLL_MS))
  const health = useBackendHealth(ctx)
  const reads = health.data?.reads ?? []
  const live = useLive(ctx, reads.includes('live'), livePollMs(replayOn, PAGE_POLL_MS))
  const history = useHistory(ctx, reads.includes('history'), livePollMs(replayOn, HISTORY_POLL_MS))
  // the LLM functions' state (switches, month's spend, fiches), read from the agent half: never a model call; once on mount, then once a minute at most
  const llmQuery = useLlm({ enabled: reads.includes('llm'), poll: !replayOn })
  // the decision box. Orders exist only when the agent half announces them (/health capabilities); the journal only when it serves it.
  const served = journalServed(health.data)
  const orders = useOrders(ctx, { audit: served, replay: replayOn })   // no order on the past (the reducer refuses every request while `replay`)
  const writes = useMemo(() => offeredWrites(health.data), [health.data])
  // Hermes approvals (events + reads of `approval.pending`), answered through the same order machine
  const approvals = useApprovals()
  const orderJournal = useOrderJournal(ctx, served, livePollMs(replayOn, JOURNAL_POLL_MS))
  const lightPref = useValue($lightPref)
  const motionPref = useValue($motionPref)
  const gameOn = useValue($gameMode)
  // the selection lives in a module memory (leaving the page unmounts this tree, coming back finds it again); the
  // side panel of a wide pane is a layout preference kept by ctx.storage. Only the drawer of a narrow pane is transient.
  const [selected, setSelectedState] = useState(() => rememberedSelection())
  const setSelected = useCallback(name => { setSelectedState(rememberSelection(name)) }, [])
  const wideOpen = useValue($panelOpen)
  // a wide pane shows the panel beside the office, on one of four tabs; a narrow one shows ONE view at a time (the office, or
  // the panel on that tab). `drawerOpen` is the narrow « the panel is the view » (kept under its name: replay and keyboard read it).
  const [tab, setTabState] = useState('decisions')
  const setTab = useCallback(k => { if (isTab(k)) setTabState(k) }, [])
  // the panel yields to the office. `art` = what the scene measured (sceneFitsBeside); `forced` = the user opened the panel
  // although the office no longer fits beside it (the panel shows, the office is a list and says why).
  const [art, setArt] = useState(null)
  const [forced, setForced] = useState(false)
  const [folded, setFolded] = useState(false)   // the page folded the panel because the office would fall to a list beside it (src/core/page.js foldStep)
  const [held, setHeld] = useState(null)   // pane width at which the user opened the panel by hand (the page does not fold it again there)
  const [refused, setRefused] = useState('')   // key of the inputs of the last fold (src/core/page.js foldPlan)
  const [officeView, setOfficeView] = useState(true)
  const drawerOpen = !officeView
  const setDrawerOpen = useCallback(v => setOfficeView(prev => !(typeof v === 'function' ? v(!prev) : v)), [])
  const [project, setProject] = useState(null)   // the project filter of the dock, the lists and the journal
  const [sortPref, setSortPref] = useState('project')
  const sort = isSort(sortPref) ? sortPref : 'project'
  const [jfilter, setJfilter] = useState('all')
  const [hireOpen, setHireOpen] = useState(false)   // the recruitment window
  const usageBtnRef = useRef(null)
  const pageRef = useRef(null)
  // where the keyboard goes when a window closes: the button that opened it if it is on screen; in a narrow pane that button is
  // hidden (or was an item of the « More » menu, gone by now), so the « More » button takes it, never <body>
  const giveFocusBack = useCallback((...selectors) => {
    setTimeout(() => {
      const root = pageRef.current
      const at = sel => { const el = root?.querySelector(sel); return { el, shown: Boolean(el && el.getClientRects().length) } }
      focusBackTarget([...selectors.map(at), at('[data-more-toggle]')])?.focus()
    }, 0)
  }, [])
  const [usageOpen, setUsageOpen] = useState(false)   // the Resources window (usage, costs, quota)
  const closeUsage = useCallback(() => { setUsageOpen(false); giveFocusBack('[data-usage-open]') }, [giveFocusBack])
  const closeHire = useCallback(() => { setHireOpen(false); giveFocusBack('[data-recruit-open]') }, [giveFocusBack])
  const [campaignOpen, setCampaignOpen] = useState(false)   // the campaign editor
  const closeCampaign = useCallback(() => { setCampaignOpen(false); giveFocusBack('[data-campaign-open]') }, [giveFocusBack])
  const [vitrineOpen, setVitrineOpen] = useState(false)   // the showcase window (level, trophies, postcard), opened by the header's badge
  const vitrineFrom = useRef(null)
  const openVitrine = useCallback(() => { vitrineFrom.current = document.activeElement; setVitrineOpen(true) }, [])
  const closeVitrine = useCallback(() => { setVitrineOpen(false); setTimeout(() => vitrineFrom.current?.focus?.(), 0) }, [])
  const toggleRef = useRef(null)
  const headRef = useRef(null)
  const width = useWidth(pageRef)
  const sheet = settingsSheet(width)

  const desks = roster.data?.desks ?? []
  // what the Agent tab needs of the roster that `office.agents` does not carry (the description to read and to revise)
  const bots = useMemo(() => new Map(desks.map(d => [d.name, { description: d.description ?? '', cut: d.descriptionCut === true, isDefault: d.isDefault === true }])), [desks])
  // an agent that no longer exists is forgotten (only judged once the roster answered with someone: an empty read knows nothing)
  useEffect(() => {
    if (!desks.length) return
    const kept = recallSelection(desks.map(d => d.name))
    if (kept !== selected) setSelectedState(kept)
  }, [desks, selected])
  const clock = usePageClock()   // the page clock moves by the minute and at the day/night switch, not only when a read changes
  const { office: liveOffice, nowMs: liveNow } = useMemo(() => {
    const now = Date.now()
    const built = buildOffice(desks, live.data ?? null, now)
    // what /history says the worker session really ran with, next to the card's pinned model
    return { office: { ...built, agents: withNonEmptySessions(withWorkerModels(built.agents, history.data ?? null), history.data ?? null) }, nowMs: now }
  }, [desks, live.data, history.data, clock])

  // the facts of a window (GET /replay), read once when the window is chosen; the cursor and the journal work on that answer in memory.
  const replayServed = reads.includes('replay')
  const replayTo = useRef(0)   // the end of the window on screen (the previous render's): the poll decision needs it before the new answer
  const nightPref = useValue($nightPref)
  const nightWin = useMemo(() => nightWindow(Date.now(), nightPref), [nightPref, clock])
  // « what happened this night »: read when the page opens (and once a minute while the night lasts and the present is shown)
  const nightQuery = useReplay(ctx, { enabled: replayServed, kind: 'night', night: nightPref, anchor: nightWin.from, poll: nightWin.ongoing && !replayOn })
  const replayRead = useReplay(ctx, {
    enabled: replayServed && replayOn, kind: replayKind, night: nightPref, anchor: nightWin.from,
    // the window gains facts only while it ends now, and they matter only with the cursor on the live edge (src/core/replay.js)
    poll: replayOn && replayPollNeeded({ ongoing: replayKind !== 'night' || nightWin.ongoing, cursorMs: cursor ?? Infinity, toMs: replayTo.current })
  })
  const replayData = replayOn ? replayRead.data ?? null : null
  replayTo.current = replayData?.toMs ?? 0
  // the cursor of the bar and of the banner follows the hand at once; the scene and the journal follow it at their own pace (a render that is
  // overtaken by a newer position is dropped, not finished): dragging never waits for a repaint
  const cursorNow = replayData ? clampCursor(cursor ?? replayData.toMs, replayData) : null
  const cursorLate = useDeferredValue(cursorNow)
  const cursorMs = replayData && cursorLate != null ? clampCursor(cursorLate, replayData) : cursorNow
  const replayOffice = useMemo(() => (replayData && cursorMs != null ? officeAt(desks, replayData, cursorMs) : null), [desks, replayData, cursorMs])
  const entries = useMemo(() => (replayData ? journalOf(replayData) : []), [replayData])
  const office = replayOffice ?? liveOffice
  const nowMs = replayOffice ? cursorMs : liveNow
  // skill objects and diploma come from /history; absent or failed -> {} (outfits from name + roster description only)
  const factProfiles = useMemo(() => sceneProfiles(history.data ?? null, liveOffice.agents, liveNow), [history.data, liveOffice.agents, liveNow])
  // game layer: recomputed from the real history on every read; sober mode (game off) computes and shows nothing,
  // and so does a page whose /history or /live has not answered (no agent half, first read pending): nothing invented
  // what the page decides (narrow or wide, panel open, body, sober, banner) is src/core/page.js; this component wires it
  const streaks = { live: usePartialStreaks(live.data, live.dataUpdatedAt), history: usePartialStreaks(history.data, history.dataUpdatedAt) }   // a blip is not said
  const model = pageModel({
    streaks,
    width, drawerOpen, wideOpen, forced, folded, art, deskCount: desks.length, gameOn, history: history.data ?? null, office: liveOffice,
    roster: { isLoading: roster.isLoading, isError: roster.isError, hasData: Boolean(roster.data) },
    live: { data: live.data ?? null, dataUpdatedAt: live.dataUpdatedAt, errorUpdatedAt: live.errorUpdatedAt }
  })
  const { sober, narrow, panelOpen } = model
  // one step at a time from what the scene measured: fold when it really fell to a list, unfold with room to spare; a forced panel whose scene
  // is drawn again (the window grew) is an ordinary open panel
  useEffect(() => {
    if (narrow) return
    if (held != null && held !== width) { setHeld(null); return }   // the width changed: the hand-opened panel is an ordinary one again
    const next = foldPlan({ folded, refused, wideOpen, paneW: width, art, held })   // a fold is only undone once its inputs changed, and never on a stale reading
    const release = Boolean(forced && art) && !forcedStep({ forced, paneW: width, art })   // only once the office is drawn beside the panel, as read with it shown
    if (release) setForced(false)
    const nextFolded = release ? false : next.folded
    if (nextFolded !== folded) setFolded(nextFolded)
    if (next.refused !== refused) setRefused(next.refused)
  }, [narrow, folded, refused, wideOpen, width, art, forced, held])
  // « Command »: the three achievements of the orders, read from the audit journal (none while the journal is not served or not read)
  const command = useMemo(() => commandDefs(orderJournal.data ?? null, JOURNAL_FETCH), [orderJournal.data])
  // a trophy already seen does not vanish while a source is unreadable (« to be re-checked » until the whole reading is back)
  const unreadable = !history.data?.ok || partialSources(live.data ?? null, history.data ?? null).length > 0
  // the game is recomputed when what it reads changes (src/core/gamekey.js), not at every /live read: the body carries a timestamp and the
  // heartbeats move, so the office object is new each time while the game stays the same (40 000 events cost ~90 ms a read, 720 reads an hour)
  const gameKey = useMemo(() => gameInputsKey(liveOffice, liveNow, history.data ?? null), [liveOffice, liveNow, history.data])
  const game = useMemo(() => keepSeenWhilePartial(computeGame(history.data ?? null, liveOffice, liveNow, { sober }, command), readSeen(), unreadable), [history.data, gameKey, sober, command, unreadable])   // eslint-disable-line react-hooks/exhaustive-deps
  const gameDecor = useMemo(() => decorOf(game), [game])
  // what the model chose (fiches kept by the agent half), drawn by the engine only while its function is ON, and never in sober
  // mode (« nothing LLM shown »). A role picked by hand still wins over the model's (wardrobe roleOf); the game never sees these roles.
  const llmState = llmQuery.data ?? null
  const roleView = useMemo(() => llmView(llmState, sober), [llmState, sober])   // src/core/llm.js: one decision, tested by value
  const profiles = useMemo(() => withModelRoles(factProfiles, roleView.roles), [factProfiles, roleView])
  // wall art (the real milestones of the game), seating (the real hand-offs between agents) and thought bubbles (agents at work)
  const seatChoice = useValue($seatChoice)
  const pageVisible = usePageVisible()
  const sceneAgents = useMemo(() => toSceneModel(liveOffice, { nowMs: liveNow, profiles }).agents, [liveOffice, liveNow, profiles])
  const sceneByName = useMemo(() => new Map(sceneAgents.map(a => [a.name, a])), [sceneAgents])   // the portraits of the campaign editor
  const weights = useMemo(() => relaysOfOffice(liveOffice), [liveOffice])
  const llmShown = useMemo(() => llmView(llmState, sober, { game, office: liveOffice, nowMs: liveNow, agents: sceneAgents, seatChoice, weights, visible: pageVisible }), [llmState, sober, game, liveOffice, liveNow, sceneAgents, seatChoice, weights, pageVisible])
  const { on: llmOn, decorReady } = llmShown
  const decor = useMemo(() => ({ ...gameDecor, ...(llmShown.style ? { style: llmShown.style } : {}), ...(llmShown.posters.length ? { posters: llmShown.posters } : {}) }), [gameDecor, llmShown])
  // the bubbles' rhythm: at most one request a minute, only with someone at work, the page visible, the function on (src/core/thoughts.js)
  const workRoles = useMemo(() => thoughtRoles(sceneAgents), [sceneAgents])
  useThoughts({ ready: llmShown.thoughtsReady && !replayOn, visible: pageVisible, roles: workRoles, lang: t.lang })
  const [decorOpen, setDecorOpen] = useState(false)
  const decorFrom = useRef('[data-decor-open]')   // what opened the Decorator: its own header button, or the gear of the settings
  const closeDecor = useCallback(() => { setDecorOpen(false); giveFocusBack(decorFrom.current) }, [giveFocusBack])
  const [seatOpen, setSeatOpen] = useState(false)
  const closeSeat = useCallback(() => { setSeatOpen(false); giveFocusBack('[data-gear]') }, [giveFocusBack])   // the Seating is only opened from the settings
  const llmActions = useMemo(() => (llmOn ? {
    skip: manualProfiles(liveOffice.agents),
    onDecorate: decorReady ? () => { decorFrom.current = '[data-gear]'; setDecorOpen(true) } : null,
    onSeating: llmShown.seatingReady ? () => setSeatOpen(true) : null,
    pendingArt: llmShown.pending, artReady: llmShown.artReady
  } : null), [llmOn, liveOffice.agents, decorReady, llmShown])
  const unlockedKey = game.achievements.filter(a => a.unlocked).map(a => a.id).join(',')
  // « already seen » is kept per machine; the first launch gets ONE toast, later runs only what is new. Only once both reads
  // answered (a half-loaded history would announce a partial count and mark it seen).
  const complete = !sober && history.data?.ok === true && liveOffice.mode === 'full'
  useEffect(() => {
    if (!complete) return
    const res = unlockAnnouncement(readSeen(), game)
    writeSeen(res.next)   // written before the toast, so a second run of this effect (StrictMode, re-render) finds it seen
    reportTrophies(trophyPayload(res, game, id => t(`game.ach.${id}.name`)))   // only what was just seen unlocking, for the trophy notifications (the agent half cannot compute them)
    if (res.kind === 'first') host.notify({ kind: 'success', message: t('game.toast.first', res.ids.length) })
    else if (res.kind === 'many') host.notify({ kind: 'success', message: t('game.toast.many', res.ids.length) })   // an update unlocks many at once: ONE grouped toast
    else if (res.kind === 'new') host.notify({ kind: 'success', message: t('game.toast.new', res.ids.map(id => t(`game.ach.${id}.name`)).join(', ')) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, unlockedKey])
  // postcard: the drawing alone, rebuilt from drawScene by the scene (never the HUD, no text)
  const exportRef = useRef(null)
  const postcard = useCallback(() => {
    const buffer = exportRef.current?.()
    if (buffer) savePostcard(buffer, postcardName(Date.now()))
  }, [])
  const counts = summarizeOffice(office)
  const night = resolveLight(lightPref, new Date(nowMs)) === 'night'
  const picked = office.agents.find(a => a.name === selected) ?? null

  // agents whose running card sets a model other than their default; the discreet live region announces new ones
  const badges = useMemo(() => badgesOf(office.agents, new Map(office.agents.map(a => [a.name, modelOf(a)]))), [office])
  // entering « waiting for you » / « silent » is announced too (same discreet region; nothing at first sight).
  // One effect writes the region, so a badge and a state change of the same read are both said (with two writers the last one would win).
  const seenBadges = useRef(null)
  const seenStates = useRef(null)
  const seenQuiet = useRef(null)   // Map name -> Set of the silent cards already seen (announced once)
  const [announce, setAnnounce] = useState('')
  useEffect(() => {
    // moving the cursor is not news: nothing is announced while a past moment is shown, and the present starts again from nothing
    if (replayOn) { seenBadges.current = null; seenStates.current = null; seenQuiet.current = null; return }
    const fresh = newBadges(seenBadges.current, badges)
    seenBadges.current = new Set(badges.map(b => b.name))
    const entered = newAttention(seenStates.current, office.agents)
    seenStates.current = new Map(office.agents.map(a => [a.name, a.state]))
    // a card that goes silent on a bot that is not itself silent (that one is said by its state), once
    const quiet = newQuiet(seenQuiet.current, office.agents)
    seenQuiet.current = quietNow(office.agents)
    const said = [...fresh.map(b => t('badge.announce', b.label, b.code, b.card)), ...entered.map(a => t(`announce.${a.state}`, a.label || a.name)), ...quiet.map(({ agent, card }) => t('announce.quiet', agent.label || agent.name, cardRef(card), formatSpan(card.silentMs)))]
    if (said.length) setAnnounce(said.join('. '))
  }, [badges, office.agents, t, replayOn])

  // replay in, replay out. Entering needs no order in progress (an order counting down would be left half-said); leaving gives the
  // present back at once (one re-read of the roster and /live instead of waiting for the next poll) and the focus to the button.
  const queryClient = useQueryClient()
  const replayBtnRef = useRef(null)
  const busy = isBusy(orders.state)
  const enterReplay = useCallback((kind = 'night', group = null) => {
    if (busy) return
    setReplayKind(kind)
    setCursor(null)
    setFactFilter({ board: null, agent: null, group, all: false })
    setReplayOn(true)
  }, [busy])
  const exitReplay = useCallback(() => {
    setReplayOn(false)
    setCursor(null)
    queryClient.refetchQueries({ queryKey: LIVE_KEY })
    queryClient.refetchQueries({ queryKey: ROSTER_KEY })
    giveFocusBack('[data-replay-open]')
  }, [queryClient, giveFocusBack])
  const chooseWindow = useCallback(kind => { setReplayKind(kind); setCursor(null) }, [])
  // Escape leaves the replay, unless something nearer is open (the dialogs, the settings, the narrow drawer: they take Escape first)
  const dialogOpen = hireOpen || decorOpen || seatOpen || campaignOpen
  useEffect(() => {
    if (!replayOn) return undefined
    const onKey = e => {
      const settings = Boolean(document.querySelector('[data-settings-panel]'))
      if (replayKeyExits({ key: e.key, dialogOpen: dialogOpen || settings, drawerOpen, narrow, defaultPrevented: e.defaultPrevented })) exitReplay()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [replayOn, dialogOpen, drawerOpen, narrow, exitReplay])
  // the keyboard lands on the cursor once the facts are there (arrows move it at once)
  const focused = useRef(false)
  useEffect(() => {
    if (!replayOn) { focused.current = false; return }
    if (replayData && !focused.current) {
      focused.current = true
      pageRef.current?.querySelector('[data-replay-cursor]')?.focus({ preventScroll: true })
    }
  }, [replayOn, replayData])
  // the window gained facts while the cursor sat on the live edge: it follows the edge; anywhere else it stays where it is
  const edge = useRef(null)
  useEffect(() => {
    if (!replayData) { edge.current = null; return }
    if (edge.current != null && edge.current !== replayData.toMs && cursor != null && cursor >= edge.current - 2 * 60_000) setCursor(replayData.toMs)
    edge.current = replayData.toMs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayData])

  // « what happened this night »: the counted summary of the night's window, for the panel (and for the replay's own window)
  const nightData = nightQuery.data ?? null
  const nightSum = useMemo(() => (nightData ? nightSummary(nightData, { from: nightData.fromMs, to: nightData.toMs, ongoing: nightData.ongoing }) : null), [nightData])
  const windowSum = useMemo(() => (replayData ? nightSummary(replayData, { from: replayData.fromMs, to: replayData.toMs, ongoing: replayData.ongoing }) : null), [replayData])
  const nightCard = useMemo(() => (nightSum && !replayOn ? { summary: nightSum, onShow: group => enterReplay('night', group), onReplay: () => enterReplay('night') } : null), [nightSum, replayOn, enterReplay])
  const replayCounts = useMemo(() => (replayOn && replayOffice ? summarizeOffice(replayOffice) : null), [replayOn, replayOffice])
  const replayStatus = replayRead.isError ? 'error' : !replayServed ? 'unavailable' : 'loading'
  // the moment on screen, said in the banner and again on the scene's own frame
  const replayAt = cursorNow != null ? clockLabel(cursorNow, t.lang, { day: replayData ? replayData.toMs - replayData.fromMs > 20 * 3_600_000 : false }) : '…'

  const open = name => {
    const desk = office.agents.find(a => a.name === name)
    if (desk) openDeskSession(desk)
  }
  // a wide pane: open or close the panel (src/core/page.js panelToggle decides what is the preference and what is only forced)
  const toggleWide = shown => {
    const r = panelToggle({ shown, forced, folded, wideOpen, fits: sceneFitsBeside(width, art) })
    if (r.wideOpen !== undefined) setPanelOpen(r.wideOpen)
    setForced(r.forced)
    setRefused('')   // a gesture of the user clears the page's refusal; a panel opened by hand holds at this width
    setHeld(shown ? null : width)
  }
  const closePanel = () => {
    const fx = panelCloseEffects({ narrow })   // what closing does is decided in src/core/page.js
    if (fx.closeDrawer) setDrawerOpen(false)
    if (fx.foldPanel) toggleWide(true)
    if (fx.focusToggle) toggleRef.current?.focus()   // the X that held the focus is about to unmount: the toggle takes it, not <body>
  }
  // the skip link « Go to the details » puts the keyboard on the panel's title (opening the panel first when it is folded)
  const skipPending = useRef(false)
  const skipToDetails = e => {
    e.preventDefault()
    const plan = skipPlan({ panelOpen, narrow })   // decided in src/ui/targets.js, tested by value
    if (plan.focusNow) headRef.current?.focus()
    else {
      skipPending.current = true
      if (plan.open === 'drawer') setDrawerOpen(true)
      else toggleWide(false)
    }
  }
  useEffect(() => {
    if (!panelOpen || !skipPending.current) return
    skipPending.current = false
    headRef.current?.focus()
  }, [panelOpen])
  const togglePanel = () => (narrow ? setDrawerOpen(v => !v) : toggleWide(panelOpen))
  // a pill, the badge, a card or the bar asks for a tab: the panel opens on it (wide: unfolded; narrow: it becomes the view)
  const goTab = k => {
    setTab(k)
    if (narrow) setOfficeView(false)
    else if (!panelOpen) toggleWide(false)
  }
  const goView = k => (k === 'office' ? setOfficeView(true) : goTab(k))
  // a click on the scene opens the Agent tab of a wide pane that is open (a narrow pane keeps the office: the dock says « Details »)
  const selectAgent = name => {
    setSelected(name)
    if (name && !narrow && panelOpen) setTab('agent')
  }
  const pickAgent = name => { setSelected(name); setTab('agent') }
  const projectColors = useProjectColors(liveOffice.boards)
  const stats = topStats(office)
  const approvalRows = replayOn ? [] : approvals.view
  // what waits for you: the blocked cards (when the agent half is there) plus the approvals Hermes asks for
  const decisionCount = stats.decisions == null ? (approvalRows.length || null) : stats.decisions + approvalRows.length
  const failingCrons = office.ops?.crons.filter(c => c.failing).length ?? 0
  const failingNames = useMemo(() => (office.ops?.crons || []).filter(c => c.failing).map(c => c.name).filter(Boolean), [office])
  const alerts = useMemo(() => (replayOn ? [] : alertsOf({
    incidentBoards: game.incidentBoards,
    incidentFails: game.openIncidents.reduce((n, i) => n + i.fails, 0),
    gatewayDown: Boolean(office.ops?.gateway?.down),
    gatewayDegraded: Boolean(office.ops?.gateway?.degraded),
    failingCrons,
    banner: model.banner,
    rosterOnly: office.mode === 'roster' && desks.length > 0 && Boolean(health.data)
  })), [replayOn, game, office, failingCrons, model.banner, desks.length, health.data])
  // « open » orders of a waiting card: its worker's session (when the app has one), the kanban (no deep link to a card)
  const openCard = useMemo(() => ({
    session: card => {
      const desk = office.agents.find(a => a.name === card.assignee)
      return desk && canOpenSession(desk) ? () => openDeskSession(desk) : null
    },
    kanban: canOpenKanban() ? openKanban : null
  }), [office])
  // an order ends (outcome shown or cancelled): the keyboard goes back to the button that launched it, else to the panel, else to its toggle
  const focusAfterOrder = out => {
    // which button takes the keyboard back is decided in src/core/orderflow.js (focusSelector)
    const el = pageRef.current?.querySelector(focusSelector(out)) || headRef.current || toggleRef.current
    el?.focus()
  }

  // Hermes held a costly model for a confirmation: the follow-up order names the bot, the model and what Hermes said
  const followUpModel = out => {
    if (!out.detail?.modelHeld) return
    orders.requestRecruit({ name: out.code }, out.detail.modelHeld)
    setHireOpen(true)
  }
  const hireList = useMemo(() => hireProfiles(desks, profiles), [desks, profiles])

  // drawer: focus moves into it when it opens, Escape closes it and gives the focus back to its button
  useEffect(() => {
    if (!(narrow && drawerOpen)) return undefined
    headRef.current?.focus()
    const onKey = e => {
      if (!drawerKeyCloses({ narrow, drawerOpen }, e.key)) return
      setDrawerOpen(false)
      toggleRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [narrow, drawerOpen])

  let body
  if (model.body === 'loading') {
    body = <div style={s.muted} role="status">{t('loading')}</div>
  } else if (model.body === 'unreachable') {
    // « unreachable » only when there is no reading at all; a failure after a good read keeps the office
    body = <EmptyState title={t('unreachableTitle')} description={t('unreachableBody')} />
  } else if (model.body === 'empty') {
    body = <EmptyOffice t={t} onRecruit={roster.data && !replayOn ? () => setHireOpen(true) : null} />
  } else {
    // a replay is read-only: « open the session » and « decide » act on the present, so they are off while the past is shown (loading, failed or loaded)
    const canOpen = picked && !replayOn ? canOpenSession(picked) : false
    const why = picked ? (replayOn ? t('replay.noAction') : canOpen ? t('openSession', picked.label) : t('noSession', picked.label)) : ''
    body = (
      <div className={`ux-main${panelOpen ? '' : ' nopanel'}`}>
        {narrow && panelOpen ? null : <div className="ux-stage" data-replaying={replayOn ? '' : undefined}>
          {/* the past is marked on the scene itself (accent frame + the moment), not only in the banner above it */}
          {replayOn ? <span className="oc-rp-tag" aria-hidden="true" data-replay-tag><span className="oc-rp-dot" />{replayData ? t('replay.banner', replayAt) : replayStatus === 'loading' ? t('replay.loadingPast') : t('replay.notLoaded')}</span> : null}
          <OfficeScene
            office={office}
            profiles={profiles}
            nowMs={nowMs}
            night={night}
            selected={picked?.name ?? null}
            onSelect={selectAgent}
            onOpen={open}
            badges={badges}
            motion={replayOn ? 'reduced' : motionPref}   // « without invented animation »: the replay shows a state, it does not act it out
            readMs={replayOn ? nowMs : live.dataUpdatedAt || nowMs}
            decor={decor}
            seating={llmShown.seating}
            thoughts={replayOn ? null : llmShown.thoughts}
            grades={sober ? null : game.grades}
            exportRef={exportRef}
            project={project}
            onFit={setArt}
            listNote={model.listBeside ? { onClose: () => toggleWide(true) } : null}
          />
          {replayOn ? (
            <ReplayBar
              replay={replayData}
              status={replayStatus}
              kind={replayKind}
              onKind={chooseWindow}
              atMs={cursorNow ?? 0}
              onAt={ms => setCursor(replayData ? clampCursor(ms, replayData) : ms)}
              entries={entries}
              counts={replayCounts ? { working: replayCounts.working, waiting: replayCounts.waiting, silent: replayCounts.stale } : null}
              t={t}
            >
              {replayData && !replayOffice.boards.length ? <p className="oc-rp-msg" data-replay-no-board>{t('replay.boardsAbsent')}</p> : null}
              {replayData ? replayData.boards.filter(b => b.sinceMs != null && b.sinceMs > replayData.fromMs).map(b => (
                <p key={b.slug} className="oc-rp-warn" data-replay-since={b.slug}>{t('replay.since', b.slug, clockLabel(b.sinceMs, t.lang, { day: replayData.toMs - replayData.fromMs > 20 * 3_600_000 }))}</p>
              )) : null}
            </ReplayBar>
          ) : null}
          <ProjectDock
            boards={office.boards}
            project={project}
            onProject={setProject}
            picked={picked}
            sceneAgent={sceneAgents.find(a => a.name === picked?.name) ?? null}
            canOpen={canOpen}
            why={why}
            onOpen={() => open(picked.name)}
            onDetails={() => goTab('agent')}
            narrow={narrow}
            announce={announce}
            t={t}
          />
        </div>}
        {panelOpen && replayOn && replayData ? (
          <ReplayPanel
            replay={replayData}
            office={replayOffice}
            summary={windowSum}
            entries={entries}
            atMs={cursorMs}
            nowMs={nowMs}
            filter={factFilter}
            onFilter={setFactFilter}
            onAt={ms => setCursor(clampCursor(ms, replayData))}
            onShowGroup={group => setFactFilter(f => ({ ...f, group }))}
            onClose={closePanel}
            drawer={narrow}
            headRef={headRef}
            t={t}
          />
        ) : panelOpen ? (
          <SidePanel
            office={office}
            history={history.data ?? null}
            profiles={profiles}
            selected={picked?.name ?? null}
            nowMs={nowMs}
            onOpen={open}
            canOpen={canOpen}
            frozen={replayOn}
            game={sober ? null : game}
            readMs={live.dataUpdatedAt || nowMs}
            tab={tab}
            onTab={setTab}
            narrow={narrow}
            headRef={headRef}
            orders={!replayOn && (writes.length || openCard.kanban) ? orders : null}
            writes={replayOn ? [] : writes}
            openCard={replayOn ? null : openCard}
            journal={{ served, data: orderJournal.data ?? null, error: orderJournal.isError }}
            approvals={approvalRows}
            answer={replayOn ? null : orders}
            night={nightCard}
            project={project}
            onProject={setProject}
            sort={sort}
            onSort={setSortPref}
            jfilter={jfilter}
            onJfilter={setJfilter}
            decisions={decisionCount}
            onModelFollowUp={followUpModel}
            onPick={pickAgent}
            bots={bots}
          />
        ) : null}
        {replayOn ? null : <OrderBar orders={orders} onFocusBack={focusAfterOrder} onModelFollowUp={followUpModel} />}
      </div>
    )
  }

  const showBadge = model.showGameBar && !replayOn
  return (
    <ProjectColors value={projectColors}>
      <div className="ux" style={s.page} lang={t.lang} ref={pageRef} data-motion={motionPref}>
        <style>{PANEL_CSS + REPLAY_CSS + USAGE_CSS + PAGE_CSS}</style>
        {model.body === 'office' ? <a href="#oc-panel" className="oc-skip" data-skip onClick={skipToDetails}>{t('skipDetails')}</a> : null}
        <PageHeader
          t={t}
          counts={counts}
          decisionCount={desks.length ? decisionCount : null}
          game={showBadge ? game : null}
          onBadge={openVitrine}
          onGo={goTab}
          replayOn={replayOn}
          replay={replayServed && desks.length > 0 ? { ref: replayBtnRef, disabled: !replayOn && busy, onClick: () => (replayOn ? exitReplay() : enterReplay()) } : null}
          usage={reads.includes('usage') && desks.length > 0 && !replayOn ? { ref: usageBtnRef, onClick: () => setUsageOpen(true) } : null}
          recruit={roster.data && !replayOn ? { onClick: () => setHireOpen(true) } : null}
          campaign={roster.data && !replayOn && writes.includes('campaign') ? { onClick: () => setCampaignOpen(true) } : null}
          decor={decorReady ? { onClick: () => { decorFrom.current = '[data-decor-open]'; setDecorOpen(true) } } : null}
          panel={desks.length > 0 && width > 0 ? { ref: toggleRef, open: panelOpen, onClick: togglePanel } : null}
          gear={<SettingsGear sheet={sheet} llm={llmActions} />}
          narrow={narrow}
        />
        {replayOn ? (
          <div className="oc-rp-banner" data-replay-banner>
            {/* waiting is not failing: while the past is read there is one mention, with its indicator; a failure says so and offers the retry */}
            {!replayData && replayStatus === 'loading' ? <span className="oc-dg-spin" aria-hidden="true" /> : <span className="oc-rp-dot" aria-hidden="true" />}
            <b data-replay-at role={!replayData ? 'status' : undefined}>{replayData ? t('replay.banner', replayAt) : replayStatus === 'loading' ? t('replay.loadingPast') : replayStatus === 'unavailable' ? t('replay.unavailable') : t('replay.error')}</b>
            <span className="oc-rp-note">{replayData ? t('replay.bannerNote') : t('replay.notLoadedNote')}</span>
            {!replayData && replayStatus === 'error' ? <button type="button" className="oc-rp-exit" data-replay-retry onClick={() => replayRead.refetch()}>{t('replay.retry')}</button> : null}
            <button type="button" className="oc-rp-exit" data-replay-exit title={t('replay.exitTip')} onClick={exitReplay}>{t('replay.exit')}</button>
          </div>
        ) : null}
        <AlertRail alerts={alerts} narrow={narrow} t={t} failingNames={failingNames} />
        {body}
        {narrow && model.body === 'office' ? <TabBar view={officeView ? 'office' : tab} onView={goView} decisions={decisionCount} t={t} /> : null}
        {roster.data ? <HireDialog open={hireOpen} onClose={closeHire} profiles={hireList} orders={orders} onSeeBot={name => { setHireOpen(false); pickAgent(name) }} /> : null}
        {roster.data && writes.includes('campaign') ? <CampaignDialog open={campaignOpen} onClose={closeCampaign} desks={desks} boards={liveOffice.boards} sceneBy={sceneByName} orders={orders} writes={writes} replay={replayOn} /> : null}
        {usageOpen ? <UsageDialog open={usageOpen} onClose={closeUsage} ctx={ctx} usageServed={reads.includes('usage')} replayServed={replayServed} /> : null}
        {showBadge && vitrineOpen ? <Vitrine open={vitrineOpen} onClose={closeVitrine} game={game} office={liveOffice} readMs={live.dataUpdatedAt || nowMs} nowMs={nowMs} onPostcard={postcard} t={t} /> : null}
        {llmOn ? <DecorDialog open={decorOpen} onClose={closeDecor} /> : null}
        {llmOn ? <SeatingDialog open={seatOpen} onClose={closeSeat} weights={weights} choice={seatChoice} onChoice={setSeatChoice} /> : null}
      </div>
    </ProjectColors>
  )
}
