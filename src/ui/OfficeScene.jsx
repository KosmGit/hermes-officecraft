import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { motionReduced } from '../core/daylight.js'
import { watchDpr } from '../core/dpr.js'
import { cardProgress, chooseView, countPeople, listZones, sceneFacts, taskTag } from '../core/hud.js'
import { dateText } from '../core/game.js'
import { badgeTip, clockText } from '../core/tips.js'
import { outfitSource } from '../core/llm.js'
import { posterTip } from '../core/wallart.js'
import { createTicker, shouldAnimate } from '../core/ticker.js'
import { anchors, backingOf, bleedOf, boardAnchors, buildBackdrop, buildBase, decorMap, dimOf, drawScene, hotspots, labelOf, layoutScene, liftOf, needsAnimation, placeLabels, project, roleOf, spriteBoxes, toSceneModel, upscale } from '../scene/index.js'
import { TW2 } from '../scene/constants.js'
import { pileTip } from '../scene/pile.js'
import { Ring } from './icons.jsx'
import { PixelBadge } from './PixelBadge.jsx'
import { cardsTip, codeText, quietTip, tagText } from './cardFacts.js'
import { Face, StateIcon } from './StateIcon.jsx'
import { useProjectStyle } from './ProjectChip.jsx'
import { postcardBuffer } from './postcard.js'
import { SCENE_CSS } from './sceneStyles.js'
import { hitBox, spotTip } from './targets.js'
import { useT } from './useT.js'

/** The accent of the app theme as [r, g, b]: a 1-pixel canvas resolves whatever CSS colour syntax the theme uses. */
// Profiled: reading the computed colour right after the DOM changed forces a style recalculation (~12 ms of a 90 ms step while the
// replay cursor is dragged, one repaint per step). A theme changes rarely: the colour is read again at most once a second, not per paint.
// the page hangs its own state dot and label above every head, so the canvas draws no state crystal there (the postcard, which has no HUD, keeps it)
const HUD_SPRITES = Object.freeze({ art: true, marker: false })
const ACCENT = { at: -Infinity, rgb: null, el: null, g: null }
const TIP_LEAVE_MS = 350   // the pointer may cross the gap between a spot and its tooltip to reach it
/** The page left: nothing of its DOM stays referenced from here (the element would keep a detached scene alive). */
const forgetAccent = () => { ACCENT.el = null; ACCENT.rgb = null; ACCENT.at = -Infinity }
function readAccent(el) {
  try {
    const now = performance.now()
    if (ACCENT.el === el && now - ACCENT.at < 1000) return ACCENT.rgb
    const css = getComputedStyle(el).color
    const g = ACCENT.g || (ACCENT.g = document.createElement('canvas').getContext('2d', { willReadFrequently: true }))   // one 1-pixel canvas, not one a second
    g.canvas.width = g.canvas.height = 1
    g.fillStyle = css
    g.fillRect(0, 0, 1, 1)
    const [r, gr, b, a] = g.getImageData(0, 0, 1, 1).data
    ACCENT.at = now
    ACCENT.el = el
    ACCENT.rgb = a ? [r, gr, b] : null
    return ACCENT.rgb
  } catch {
    return null
  }
}

/**
 * The pixel store for a canvas of w x h: a window dragged to another size changes the canvas at each step, and a store is up to 20 MB: one buffer
 * is kept with a quarter of room to spare and each step is a view on it; a new one only when the size outgrows it or falls under half of it.
 */
function storeOf(store, w, h) {
  const need = w * h * 4
  if (!store.cap || store.cap.length < need || store.cap.length > need * 2) store.cap = new Uint8ClampedArray(Math.ceil(need * 1.25))
  return new ImageData(new Uint8ClampedArray(store.cap.buffer, 0, need), w, h)
}

/**
 * JIT: put a frame (RGBA, W x H art pixels) on a canvas. Same size: as it is. A larger store (src/scene/fit.js backingOf: the scale is not a
 * whole number of device pixels): the page scales the whole picture itself, nearest neighbour, so the browser shows the store 1:1 and
 * no repaint can pick other rows or columns than the frame before.
 */
function blit(cv, d, W, H, store) {
  const g = cv.getContext('2d')
  if (cv.width === W && cv.height === H) { g.putImageData(new ImageData(d, W, H), 0, 0); return }
  let img = store.current   // kept from one frame to the next: a store can weigh 20 MB
  if (!img || img.width !== cv.width || img.height !== cv.height) img = store.current = storeOf(store, cv.width, cv.height)
  upscale(d, W, H, img.data, cv.width, cv.height)
  g.putImageData(img, 0, 0)
}

/** What the baked base depends on: structure and light, not the per-poll noise (heartbeats, titles) and not the minute (the clock hands are drawn per frame). */
const BASE_KEYS = new WeakMap()   // model -> { layout, key }: the key of a model and its layout is built once (a frame asks for it 12 times a second)
const baseKey = (layout, model) => {
  const hit = BASE_KEYS.get(model)
  if (hit && hit.layout === layout) return hit.key
  const key = baseKeyOf(layout, model)
  BASE_KEYS.set(model, { layout, key })
  return key
}
const baseKeyOf = (layout, model) =>
  JSON.stringify([
    layout.W, layout.H, model.night, model.decor, model.seating,
    layout.pods.map(p => p.seats.map(s => s.agent?.name ?? null)),   // who sits where (the Seating function moves the neighbours, hence the lights and shadows)
    model.agents.map(a => [a.name, a.home, a.state, a.sleepy, a.roleOverride, a.modelRole, a.description, a.skills, a.copiedSkills]),
    model.boards.map(b => [b.slug, b.total, b.counts])
  ])

/** matchMedia / visibility as React state, listeners removed on unmount. */
function useMedia(query) {
  const [on, setOn] = useState(() => (typeof matchMedia === 'function' ? matchMedia(query).matches : false))
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined
    const mq = matchMedia(query)
    const h = () => setOn(mq.matches)
    h()
    mq.addEventListener?.('change', h)
    return () => mq.removeEventListener?.('change', h)
  }, [query])
  return on
}
export function usePageVisible() {
  const [visible, setVisible] = useState(() => (typeof document === 'undefined' ? true : !document.hidden))
  useEffect(() => {
    const h = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', h)
    h()
    return () => document.removeEventListener('visibilitychange', h)
  }, [])
  return visible
}

/**
 * What an agent's label shows: its NAME and the CARD CODE, nothing else. The state word, the time on the card and the number of
 * cards waiting went to the tooltip (`tip`) and to the screen reader (`label`); the grade stays on the label of a roomy scene.
 */
function agentFacts(a, t, nowMs, badge) {
  const state = t(`state.${a.state}`)
  const when = a.lastActivityMs ? t('lastActivity', t.ago(a.lastActivityMs)) : t('noActivity')
  const pin = badge ? `. ${t('badge.label', badge.code, badge.card)}` : ''
  const tag = taskTag(a, nowMs)
  const full = tagText(tag, t)
  // several running cards: « API-3 +1 », the cards named in the tooltip and for the screen reader; a silent card: the sign + which one, since when
  const lab = labelOf(a, tag)
  // the pile of folders counts the running cards; a bot whose tag does not list them (it waits: its label names the blocked card,
  // or it is active or at rest) still gets their number in its tooltip, with the words of cardFacts.js, pile drawn or not (back row)
  const cards = cardsTip(tag, t) || pileTip(a, nowMs, t)
  const quiet = quietTip(tag, t)
  const more = [cards, quiet].filter(Boolean).map(x => `. ${x}`).join('')
  // a bot at work with a blocked card: « Au travail, une décision vous attend » (the sign beside its state, and the words for the screen reader)
  const wait = tag?.wait ? t('waitTip', tag.wait) : ''
  const said = wait ? `${state}, ${wait}` : state
  return { state, code: codeText(lab.code, lab.more, t), quiet: lab.quiet === true, wait: lab.wait === true, tag: full, cardsText: cards, quietText: quiet, label: `${a.label || a.name} — ${said}. ${when}${pin}${more}`, tip: [said, full, cards, quiet].filter(Boolean).join(' · ') }
}

/**
 * The label of an island (a project of the office), a button that filters on it: dot + name + the ring of its progress. The counts
 * (`done/total`, blocked cards) are the dock's, right under the scene: written once. They stay in the button's name for the screen
 * reader. `data-isl` = its size (full / short = no ring / dot).
 */
function Island({ board, hall, count, dim, active, onPick, t }) {
  const style = useProjectStyle(hall ? null : board.slug)
  if (hall) {
    return (
      <div className="oc-zone" data-zone data-hall data-dim={dim ? '' : undefined} style={style}>
        <b>{t('hall')}</b>
        <span className="oc-mono">{count}</span>
      </div>
    )
  }
  const blocked = board.blocked.length
  const progress = `${board.done}/${board.total}`
  return (
    <button
      type="button"
      className="oc-zone oc-isl"
      data-zone
      data-board={board.slug}
      data-dim={dim ? '' : undefined}
      aria-pressed={active}
      aria-label={`${t('ux.dock.chip', board.slug, progress)}${blocked ? `, ${t('blockedCards', blocked)}` : ''}`}
      title={t('ux.isl.filter', board.slug)}
      style={style}
      onClick={() => onPick?.(active ? null : board.slug)}
    >
      <span className="oc-pdot" aria-hidden="true" />
      <b>{board.slug}</b>
      <Ring done={board.done} total={board.total} r={5} box={14} stroke={2.4} className="ux-ring oc-ring" />
    </button>
  )
}

const say = (t, parts) => (parts ? t(...parts) : '')

/** The project's colour square before a group of the list (the same square as the island, the dock and the cards). */
function ListDot({ slug }) {
  return <span className="oc-pdot" aria-hidden="true" style={useProjectStyle(slug)} />
}

/**
 * The isometric office: pixel-art canvas from src/scene/ + an HTML HUD over it (agent labels, island labels,
 * focusable zones with sourced tooltips, model badges). Below LIST_BELOW the same facts come as a list.
 * Props: { office, profiles, nowMs, night, selected, onSelect, onOpen,
 *          badges (core/panel badgesOf), motion ('auto'|'reduced'), readMs (when /live was read) }.
 */
export function OfficeScene({ office, profiles, nowMs, night, selected, onSelect, onOpen, badges = [], motion = 'auto', readMs = null, decor = null, grades = null, exportRef = null, seating = null, thoughts = null, project: filter = null, onProject = null, onFit = null, listNote = null }) {
  const t = useT()
  const thoughtId = useId()   // the hidden text of an agent's thought, reached by aria-describedby
  const boxRef = useRef(null)
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const hudRef = useRef(null)
  const accentRef = useRef(null)
  const baseRef = useRef({ key: '', base: null })
  const frameRef = useRef(0)
  const paintedRef = useRef(0)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1))
  const visible = usePageVisible()
  const reduced = motionReduced(motion, useMedia('(prefers-reduced-motion: reduce)'))
  const animatedRef = useRef(0)
  const [tip, setTip] = useState(null)   // { id, x, top, bottom } in stage pixels: the tooltip being shown (hover or focus)

  // the box this component may fill, measured (content box: padding already removed)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect
      if (!r) return
      const next = { w: Math.floor(r.width), h: Math.floor(r.height) }
      setSize(prev => (prev.w === next.w && prev.h === next.h ? prev : next))
      setDpr(window.devicePixelRatio || 1)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // the window dragged to a screen of another density changes the ratio without resizing the box: the store must follow
  useEffect(() => watchDpr(window, setDpr), [])
  useEffect(() => forgetAccent, [])   // the ref is already detached when this runs: forget whatever element was kept

  // decor: what the game layer unlocked (src/core/game.js decorOf); null or sober -> the plain office, no game object
  const fresh = useMemo(() => toSceneModel(office, { nowMs, night, profiles, decor: decor || undefined, seating }), [office, profiles, nowMs, night, decor, seating])
  // m2: every /live read builds a new office object, even when nothing displayed changed. The scene model is kept while the facts
  // it draws are identical (fingerprint), so an idle office neither rebuilds its layout nor repaints on each poll.
  const factsKey = useMemo(() => sceneFacts(fresh), [fresh])
  const kept = useRef({ key: null, model: null })
  if (kept.current.key !== factsKey) kept.current = { key: factsKey, model: fresh }
  const model = kept.current.model
  const layout = useMemo(() => layoutScene(model), [model])
  const people = countPeople(layout)
  const view = chooseView({ availW: size.w, availH: size.h, W: layout.W, H: layout.H, dpr, people })
  const asScene = view.mode === 'scene'
  const S = view.scale
  const byName = useMemo(() => new Map(office.agents.map(a => [a.name, a])), [office])
  const faceBy = useMemo(() => new Map(model.agents.map(a => [a.name, a])), [model])   // the scene's agents carry the outfit

  // latest values for the frame painter (it runs from a timer, outside React's render)
  const live = useRef(null)
  const dim = useMemo(() => dimOf(filter, layout), [filter, layout])   // what the project filter washes in the scene (null = nothing)
  live.current = { layout, model, selected, asScene, dim }
  // what the page needs to know to give the scene room (src/core/page.js foldStep): the art, the free height, the mode really shown
  useEffect(() => {
    if (onFit && size.h > 0) onFit({ W: layout.W, H: layout.H, availW: size.w, availH: size.h, dpr, people, mode: view.mode })   // with the width it was read at
  }, [onFit, layout.W, layout.H, size.w, size.h, dpr, people, view.mode])

  // the ground around the room, under the room canvas, reaching the edges of the frame. A separate layer: drawScene (the room, the
  // postcard) does not know it. Built after the room is painted, once per structure / light / size step (a resize is debounced).
  // the building, not the canvas, is centred in the frame (the canvas keeps its headroom above the walls): the room is lifted by that much
  const lift = asScene ? liftOf(layout, S) : 0
  const bleed = useMemo(() => (asScene ? bleedOf({ availW: size.w, availH: size.h, W: layout.W, H: layout.H, S, shift: lift }) : null), [asScene, size.w, size.h, layout.W, layout.H, S, lift])
  const groundKey = bleed ? JSON.stringify([layout.X, layout.Y, layout.lounge.x0, layout.W, layout.H, layout.origin, !!model.night, bleed]) : ''
  const groundRef = useRef(null)
  const groundBuf = useRef(null)
  const artStore = useRef(null)      // JIT: the frame scaled to the canvas store, reused frame after frame (blit)
  const groundStore = useRef(null)
  const [ground, setGround] = useState(null)   // { key, w, h, bleed }: what the ground canvas is currently sized for
  // JIT: the pixel store of each canvas = whole device pixels (src/scene/fit.js backingOf), the browser never resamples the art
  const back = useMemo(() => backingOf({ W: layout.W, H: layout.H, S, dpr }), [layout.W, layout.H, S, dpr])
  const gback = useMemo(() => (ground ? backingOf({ W: ground.w, H: ground.h, S, dpr }) : null), [ground, S, dpr])
  useEffect(() => {
    if (!bleed || groundBuf.current?.key === groundKey) return undefined
    const id = setTimeout(() => {
      const cur = live.current
      const b = buildBackdrop(cur.layout, { night: !!cur.model.night, bleed })
      groundBuf.current = { key: groundKey, d: b.d }
      setGround({ key: groundKey, w: b.w, h: b.h, bleed })
    }, groundBuf.current ? 120 : 0)
    return () => clearTimeout(id)
  }, [groundKey])   // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const cv = groundRef.current
    const buf = groundBuf.current
    if (!cv || !ground || !buf || buf.key !== ground.key) return
    blit(cv, buf.d, ground.w, ground.h, groundStore)
  }, [ground, asScene, gback?.w, gback?.h])
  // the postcard: the drawing alone, rebuilt from drawScene (src/ui/postcard.js), never read back from this canvas or the HUD
  useEffect(() => {
    if (!exportRef) return undefined
    exportRef.current = () => postcardBuffer(live.current.layout, live.current.model)
    return () => { exportRef.current = null }
  }, [exportRef])
  const paint = useCallback((frame, animated = false) => {
    const cur = live.current
    const cv = canvasRef.current
    if (!cur?.asScene || !cv || document.hidden) return   // a hidden page paints nothing; becoming visible repaints (effect below)
    const key = baseKey(cur.layout, cur.model)
    if (baseRef.current.key !== key) baseRef.current = { key, base: buildBase(cur.layout, cur.model) }
    const accent = (accentRef.current && readAccent(accentRef.current)) || undefined
    const px = drawScene(cur.layout, baseRef.current.base, { ...cur.model, markers: false, selected: cur.selected, accent: accent || cur.model.accent, dim: cur.dim }, frame, { reuse: true })   // blit copies it before the next frame
    blit(cv, px.d, cur.layout.W, cur.layout.H, artStore)
    paintedRef.current += 1
    cv.dataset.frames = String(paintedRef.current)
    // frames drawn by the ticker only (still repaints on new facts are not animation): stays 0 under reduced motion
    if (animated) animatedRef.current += 1
    cv.dataset.animFrames = String(animatedRef.current)
  }, [])

  // still frame whenever the facts, the selection, the light or the size change
  useLayoutEffect(() => {
    if (asScene) paint(frameRef.current)
  }, [asScene, paint, layout, model, selected, S, visible, dim, back.w, back.h])

  // motion only when a fact needs it (never hidden, never reduced motion); one local timer, cleared on every exit
  const animate = shouldAnimate({ needs: needsAnimation(model), visible, reducedMotion: reduced }) && asScene
  useEffect(() => {
    if (!animate) return undefined
    const ticker = createTicker({
      paint: f => { frameRef.current = f; paint(f, true) },
      hidden: () => document.hidden,
      startFrame: frameRef.current
    })
    ticker.start()
    return () => ticker.stop()
  }, [animate, paint])

  // every label is PLACED (src/scene/labels.js, pure, tested): the page only measures the labels (the font and the language
  // decide their width), gives the sprites and the decor map of the scene, and applies the answer. Never on a character, a « ! » bubble or
  // another label; as little decor as possible; a leader line when moved; no free spot -> the label folds into its dot (the selected one never).
  const geomRef = useRef({ key: '', sprites: null, frac: null })
  const leadsRef = useRef(null)
  useLayoutEffect(() => {
    const hud = hudRef.current
    const stage = stageRef.current
    if (!asScene || !hud || !stage) return
    const gkey = `${baseKey(layout, model)}|${baseRef.current.base ? 1 : 0}`
    if (geomRef.current.key !== gkey) geomRef.current = { key: gkey, sprites: spriteBoxes(layout, HUD_SPRITES), frac: decorMap(layout, baseRef.current.base?.d || null) }
    const { sprites, frac } = geomRef.current
    const stations = [...hud.querySelectorAll('[data-agent]')]
    const zones = [...hud.querySelectorAll('[data-zone]')]
    const chipOf = s => s.querySelector('[data-chip]')
    // start again from the natural place of every label, at its natural size, then measure
    for (const s of stations) {
      s.removeAttribute('data-fold')
      const c = chipOf(s)
      if (c) { c.style.left = ''; c.style.top = ''; c.style.bottom = ''; c.removeAttribute('data-placed') }
    }
    const agents = stations.map(s => {
      const c = chipOf(s)
      return c ? { name: s.dataset.agent, w: c.offsetWidth, h: c.offsetHeight, state: s.dataset.state, selected: s.getAttribute('aria-pressed') === 'true', dot: c.offsetWidth <= 20 } : null
    }).filter(Boolean)
    const modes = z => (z.hasAttribute('data-hall') ? ['full', 'dot'] : ['full', 'short', 'dot'])
    const bas = new Map(boardAnchors(layout).map(b => [b.slug, b]))
    const [hx0, hy0] = project(layout, layout.lounge.x0 + 2, 5.2, 0)
    const islands = zones.map(z => {
      const hall = z.hasAttribute('data-hall')
      const b = hall ? null : bas.get(z.dataset.board)
      const pod = hall ? null : layout.pods.find(p => p.b.slug === z.dataset.board)
      const sizes = modes(z).map(mode => { z.dataset.isl = mode; return { w: z.offsetWidth, h: z.offsetHeight, mode } })
      return { key: hall ? 'hall' : z.dataset.board, sizes, a: hall ? [hx0, hy0] : [b?.sx ?? 0, b?.sy ?? 0], span: (hall ? 1.6 : (pod?.w ?? 2) / 2) * TW2 }
    })
    const res = placeLabels({ agents, islands, sprites, frac, S, size: { w: layout.W * S, h: layout.H * S } })
    // apply: islands, then agent labels (a label is positioned from its station's own corner)
    zones.forEach(z => {
      const key = z.hasAttribute('data-hall') ? 'hall' : z.dataset.board
      const r = res.islands.get(key)
      if (!r) return
      z.dataset.isl = r.mode
      z.style.left = `${Math.round(r.rect.x0)}px`
      z.style.top = `${Math.round(r.rect.y0)}px`
      z.style.setProperty('--stem', `${Math.max(7, Math.round(r.rect.y0 - r.edge.y))}px`)
    })
    const leads = []
    for (const s of stations) {
      const c = chipOf(s)
      const r = res.agents.get(s.dataset.agent)
      const sp = sprites.find(b => b.name === s.dataset.agent)
      if (sp) s.dataset.sprite = [sp.x0 * S, sp.y0 * S, sp.x1 * S, sp.y1 * S].map(Math.round).join(',')
      if (!c || !r) continue
      if (r.folded) s.setAttribute('data-fold', '')
      c.dataset.placed = r.folded ? 'dot' : 'full'
      c.style.left = `${Math.round(r.rect.x0 - s.offsetLeft)}px`
      c.style.top = `${Math.round(r.rect.y0 - s.offsetTop)}px`
      c.style.bottom = 'auto'
      if (r.lead) leads.push({ ...r.lead, state: s.dataset.state })
    }
    if (leadsRef.current) {
      // the leader lines, built with DOM calls (numbers and a state name, no markup from outside)
      const svg = leadsRef.current
      svg.replaceChildren(...leads.map(l => {
        const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        for (const [k, v] of [['x1', l.x1], ['y1', l.y1], ['x2', l.x2], ['y2', l.y2]]) ln.setAttribute(k, v.toFixed(1))
        ln.setAttribute('class', `s-${String(l.state).replace(/[^a-z-]/g, '')}`)
        return ln
      }))
    }
    // thought bubbles: a bubble never covers a label or another bubble. It sits right above its agent's label; when that spot is
    // taken it is lifted (the stem keeps it tied to its agent) or slid sideways (the tail keeps pointing at the agent), the nearest free spot
    // first; with no free spot it is not drawn (its text stays in the agent's accessible description). Same order every time: by name.
    const rect = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width } }
    const hits = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
    const sb = stage.getBoundingClientRect()
    const bubbles = [...hud.querySelectorAll('[data-thought]')].sort((a, b) => (a.dataset.thought < b.dataset.thought ? -1 : 1))
    bubbles.forEach(b => { b.removeAttribute('data-hide'); b.style.removeProperty('--dx'); b.style.removeProperty('--lift') })
    const placed = [...stations.map(chipOf).filter(Boolean).map(rect), ...zones.map(rect)].filter(r => r.width)
    const inside = r => r.left >= sb.left && r.right <= sb.right && r.top >= sb.top
    for (const b of bubbles) {
      const r = rect(b)
      if (!r.width) continue
      let spot = null
      for (const lift of [0, 14, 28, 42, 56, 70, 84]) {
        for (const dx of [0, -30, 30, -60, 60, -90, 90, -120, 120, -150, 150]) {
          const m = { ...r, left: r.left + dx, right: r.right + dx, top: r.top - lift, bottom: r.bottom - lift }
          if (inside(m) && !placed.some(f => hits(f, m))) { spot = { dx, lift, m }; break }
        }
        if (spot) break
      }
      if (!spot) { b.setAttribute('data-hide', ''); continue }
      if (spot.dx) b.style.setProperty('--dx', `${spot.dx}px`)
      if (spot.lift) b.style.setProperty('--lift', `${spot.lift}px`)
      placed.push(spot.m)
    }
  }, [asScene, layout, S, view.dense, view.compact, office, nowMs, t, selected, grades, thoughts, filter])

  const fire = (fn, name) => () => { if (typeof fn === 'function') fn(name) }

  // sourced tooltips: the zones of the scene (src/scene hotspots) and the model badge on an agent label
  const badgeBy = useMemo(() => new Map(badges.map(b => [b.name, b])), [badges])
  // an agent dressed by the model says so (and where that comes from); a hand-picked role or the rules say nothing new
  const sceneBy = useMemo(() => new Map(model.agents.map(a => [a.name, a])), [model])
  const outfitTip = name => {
    const sa = sceneBy.get(name)
    const src = sa ? outfitSource(roleOf(sa).why) : null
    return src?.kind === 'model' ? `${t('llm.outfits.tip')}. ${t('llm.outfits.source', src.at ? t.ago(src.at) : '')}` : undefined
  }
  const spots = useMemo(() => hotspots(layout, model), [layout, model])
  const tipCtx = { readMs: readMs ?? nowMs, lang: t.lang }
  // a poster's tooltip says the milestone and its date (the data: the model drew only the picture); the other zones cite their source
  const tipFor = sp => {
    if (sp.kind !== 'poster') return spotTip(sp, office, tipCtx)
    const p = sp.poster
    return posterTip(p, { achName: t(`game.ach.${p.kind}.name`), date: dateText(p.ms, t.lang), tierName: p.tier ? t(`game.tier.${p.tier}`) : '', readClock: clockText(tipCtx.readMs, t.lang) })
  }
  // the tooltip can be reached with the pointer (it stays while the pointer is on it) and Escape closes it wherever the focus is
  const leaving = useRef(0)
  const keepTip = () => { clearTimeout(leaving.current); leaving.current = 0 }
  useEffect(() => keepTip, [])
  useEffect(() => {
    if (!tip) return undefined
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTip(null) } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [tip])
  const show = (id, el) => {
    const stage = stageRef.current
    if (!stage || !el) return
    keepTip()
    const sr = stage.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    setTip({ id, x: r.left + r.width / 2 - sr.left, top: r.top - sr.top, bottom: r.bottom - sr.top })
  }
  const hide = id => { keepTip(); leaving.current = setTimeout(() => setTip(cur => (cur && cur.id === id ? null : cur)), TIP_LEAVE_MS) }
  const badgeText = b => {
    const bt = badgeTip(b)
    return [say(t, bt.fact), say(t, bt.extra), say(t, bt.source)].filter(Boolean).join(' — ')
  }
  const tipContent = () => {
    if (!tip) return null
    if (tip.id.startsWith('badge:')) {
      const b = badgeBy.get(tip.id.slice(6))
      return b ? badgeTip(b) : null
    }
    const sp = spots.find(s => s.id === tip.id)
    return sp ? tipFor(sp) : null
  }

  let body = null
  if (asScene) {
    const at = (x, y) => [x * S, y * S]
    const stations = anchors(layout).map((a, i) => {
      const agent = byName.get(a.name)
      if (!agent) return null
      const badge = badgeBy.get(a.name) || null
      const f = agentFacts(agent, t, nowMs, badge)
      const thought = thoughts?.[a.name] ?? null   // only an agent at work has one (src/core/thoughts.js thoughtsShown)
      const [x, y] = at(a.sx, a.sy)
      const below = a.below
      const bar = cardProgress(agent, nowMs)
      return (
        <button
          key={a.name}
          type="button"
          className={`oc-station oc-s-${agent.state}${below ? ' oc-below' : ''}`}
          data-agent={a.name}
          data-state={agent.state}
          data-model-badge={badge ? '' : undefined}
          data-outfit={outfitTip(a.name) ? 'model' : undefined}
          data-dim={filter && agent.home !== filter && selected !== a.name ? '' : undefined}
          title={[[f.tip, grades?.[a.name] ? t('game.gradeTip', t(`game.grade.${grades[a.name].id}`)) : ''].filter(Boolean).join(' · '), outfitTip(a.name)].filter(Boolean).join(' — ')}
          aria-pressed={selected === a.name}
          aria-label={f.label}
          aria-describedby={thought ? `${thoughtId}-${i}` : undefined}
          data-thinking={thought ? '' : undefined}
          onClick={fire(onSelect, a.name)}
          onDoubleClick={fire(onOpen, a.name)}
          onFocus={badge ? e => { if (e.currentTarget.matches(':focus-visible')) show(`badge:${a.name}`, e.currentTarget.querySelector('[data-pin]')) } : undefined}
          onBlur={badge ? () => hide(`badge:${a.name}`) : undefined}
          style={hitBox({ left: x - 11 * S, top: y - (below ? 30 : 47) * S, width: 22 * S, height: (below ? 32 : 49) * S })}
        >
          <span className="oc-chip" data-chip>
            <span className="oc-dot" aria-hidden="true"><StateIcon state={agent.state} /></span>
            {faceBy.get(a.name) ? <Face agent={faceBy.get(a.name)} /> : null}
            <span className="oc-nm">{agent.label || agent.name}</span>
            {badge ? (
              <span className="oc-pinwrap" data-pin={a.name} onMouseEnter={e => show(`badge:${a.name}`, e.currentTarget)} onMouseLeave={() => hide(`badge:${a.name}`)}>
                <PixelBadge />
              </span>
            ) : null}
            {f.code ? <span className="oc-task">{f.code}</span> : null}
            {f.quiet ? <span className="oc-quiet" data-quiet aria-hidden="true"><StateIcon state="stale" /></span> : null}
            {f.wait ? <span className="oc-wait" data-wait aria-hidden="true"><StateIcon state="waiting" /></span> : null}
            {bar ? <span className="oc-bar" data-late={bar.late ? '' : undefined} aria-hidden="true"><i style={{ width: `${Math.round(bar.f * 100)}%` }} /></span> : null}
          </span>
          {thought ? <span className="oc-thought" data-thought={a.name} aria-hidden="true"><i>{t('llm.thoughts.badge')}</i>{thought}</span> : null}
          {thought ? <span className="ux-vh" id={`${thoughtId}-${i}`} data-thought-text>{t('llm.thoughts.say', thought)}</span> : null}
        </button>
      )
    })
    // the islands' labels: where they sit is src/scene/labels.js' answer (applied in the layout effect), on the front edge of their rug
    const islands = layout.pods.map(p => (
      <Island key={`b:${p.b.slug}`} board={p.b} dim={Boolean(filter) && filter !== p.b.slug} active={filter === p.b.slug} onPick={onProject} t={t} />
    ))
    const shown = tipContent()
    body = (
      <div
        ref={stageRef}
        className="oc-stage"
        role="group"
        aria-label={t('sceneLabel')}
        data-store={`${back.w}x${back.h}`}
        data-lift={lift}
        style={{ width: back.cssW, height: back.cssH, top: -lift }}
      >
        {ground ? (
          <canvas
            ref={groundRef}
            className="oc-ground"
            aria-hidden="true"
            width={gback.w}
            height={gback.h}
            style={{
              left: gback.direct ? -ground.bleed.l * S : -Math.round(ground.bleed.l * gback.k) / dpr,   // whole device pixels, like the store
              top: gback.direct ? -ground.bleed.t * S : -Math.round(ground.bleed.t * gback.k) / dpr,
              width: gback.cssW,
              height: gback.cssH
            }}
          />
        ) : null}
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          width={back.w}
          height={back.h}
          style={{ width: back.cssW, height: back.cssH }}
        />
        <div ref={hudRef} className="oc-hud">
          <svg ref={leadsRef} className="oc-leads" width={layout.W * S} height={layout.H * S} aria-hidden="true" focusable="false" />
          {stations}
          {islands}
          <Island hall count={layout.lounge.seats.length} dim={Boolean(filter)} t={t} />
          {spots.map(sp => {
            const label = say(t, tipFor(sp).name)
            const box = hitBox({ left: sp.rect.x * S, top: sp.rect.y * S, width: sp.rect.w * S, height: sp.rect.h * S })   // never under 24 CSS px
            return (
              <button
                key={sp.id}
                type="button"
                className="oc-spot"
                data-spot={sp.id}
                data-kind={sp.kind}
                aria-label={label}
                aria-describedby={tip?.id === sp.id ? 'oc-tip' : undefined}
                style={box}
                onMouseEnter={e => show(sp.id, e.currentTarget)}
                onMouseLeave={() => hide(sp.id)}
                onFocus={e => show(sp.id, e.currentTarget)}
                onBlur={() => hide(sp.id)}
                onClick={e => show(sp.id, e.currentTarget)}
              />
            )
          })}
          {shown ? (
            <div
              id="oc-tip"
              role="tooltip"
              className="oc-tip"
              data-tip={tip.id}
              onMouseEnter={keepTip}
              onMouseLeave={() => hide(tip.id)}
              style={{
                left: Math.min(Math.max(tip.x, Math.min(130, layout.W * S / 2)), layout.W * S - Math.min(130, layout.W * S / 2)),
                top: tip.top > 80 ? tip.top - 6 : tip.bottom + 6,
                transform: tip.top > 80 ? 'translate(-50%, -100%)' : 'translate(-50%, 0)'
              }}
            >
              <b>{say(t, shown.name)}</b>
              {say(t, shown.fact)}
              {shown.extra ? <small>{say(t, shown.extra)}</small> : null}
              <small>{say(t, shown.source)}</small>
            </div>
          ) : null}
        </div>
      </div>
    )
  } else if (view.mode === 'list') {
    body = (
      <div className="oc-list" data-view="list">
        {listNote ? (
          <p className="oc-note" role="status" data-list-beside>
            {t('ux.stage.listBeside')}{' '}
            <button type="button" className="oc-notebtn" data-list-beside-close onClick={listNote.onClose}>{t('ux.stage.showDrawing')}</button>
          </p>
        ) : <p>{t('narrowNote')}</p>}
        {listZones(layout).map(z => (
          <section key={z.key} className="oc-lzone" data-dim={filter && (z.board ? z.board.slug !== filter : true) ? '' : undefined} aria-label={z.board ? z.board.slug : t('hall')}>
            <h2>
              {z.board ? <ListDot slug={z.board.slug} /> : null}
              {z.board ? z.board.slug : t('hall')}
              {z.board ? <span className="oc-mono">{t('boardCards', z.board.done, z.board.total)}</span> : null}
              {z.board?.blocked.length ? <span className="oc-warn">{t('blockedCards', z.board.blocked.length)}</span> : null}
            </h2>
            {z.agents.map(a => {
              const agent = byName.get(a.name)
              if (!agent) return null
              const badge = badgeBy.get(a.name) || null
              const f = agentFacts(agent, t, nowMs, badge)
              return (
                <button
                  key={a.name}
                  type="button"
                  className={`oc-lrow oc-s-${agent.state}`}
                  data-agent={a.name}
                  data-state={agent.state}
                  data-model-badge={badge ? '' : undefined}
                  aria-pressed={selected === a.name}
                  aria-label={f.label}
                  title={[f.tag, grades?.[a.name] ? t('game.gradeTip', t(`game.grade.${grades[a.name].id}`)) : '', badge ? badgeText(badge) : '', f.cardsText, f.quietText].filter(Boolean).join(' — ') || undefined}
                  data-dim={filter && agent.home !== filter && selected !== a.name ? '' : undefined}
                  onClick={fire(onSelect, a.name)}
                  onDoubleClick={fire(onOpen, a.name)}
                >
                  <span className="oc-chip">
                    <span className="oc-dot" aria-hidden="true"><StateIcon state={agent.state} /></span>
                    {faceBy.get(a.name) ? <Face agent={faceBy.get(a.name)} /> : null}
                    <span className="oc-nm">{agent.label || agent.name}</span>
                    {badge ? <span className="oc-pinwrap" data-pin={a.name}><PixelBadge /></span> : null}
                    {f.state ? <span className="oc-sl">{f.state}</span> : null}
                    {f.code ? <span className="oc-task">{f.code}</span> : null}
                    {f.quiet ? <span className="oc-quiet" data-quiet aria-hidden="true"><StateIcon state="stale" /></span> : null}
                    {f.wait ? <span className="oc-wait" data-wait aria-hidden="true"><StateIcon state="waiting" /></span> : null}
                  </span>
                  {thoughts?.[a.name] ? <span className="oc-lthought" data-thought={a.name}><i>{t('llm.thoughts.badge')}</i>{thoughts[a.name]}</span> : null}
                </button>
              )
            })}
          </section>
        ))}
      </div>
    )
  }

  return (
    <div
      ref={boxRef}
      className={`oc-box${view.mode === 'list' ? ' oc-listing' : ''}${asScene && view.dense ? ' oc-dense' : ''}${asScene && view.compact ? ' oc-compact' : ''}`}
      data-view={view.mode}
      data-scale={S}
    >
      <style>{SCENE_CSS}</style>
      <span ref={accentRef} style={{ display: 'none', color: 'var(--ui-accent)' }} aria-hidden="true" />
      {body}
    </div>
  )
}
