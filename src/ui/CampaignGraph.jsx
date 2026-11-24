import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { foldCards, graphOf } from '../core/campaignLayout.js'
import { letter } from '../core/campaign.js'
import { Icon } from './icons.jsx'
import { Portrait } from './Portrait.jsx'
import { useT } from './useT.js'

/** Width of an element, measured; 0 until the first measure. A ResizeObserver, disconnected on unmount (no timer). */
function useBox(ref) {
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
 * The preview of the campaign's graph. Rows = the order in which the cards start; a guard is a bar across the width (« nothing starts
 * before Launch »); the colour is the BOT (one hue per bot, by its rank in the roster); past 24 cards the parallel ones fold into a pile that
 * a click unfolds. The geometry is src/core/campaignLayout.js (pure, tested: 0 overlap, no line over a card); this file only draws it:
 * the cards are real elements (buttons when the preview is interactive), the links one SVG underneath.
 *   cards     the graph as `effective(draft)` gives it ([{ id, kind, phase, parents, ...}])
 *   info      Map id -> { code, title, who, pin } of the draft's cards
 *   colors    Map bot -> CSS colour; sceneBy Map bot -> scene agent (the portrait)
 *   phases    [{ name }] (the bands' labels)
 */
export function CampaignGraph({ cards, info, colors, sceneBy, phases, selected = null, onSelect = null, open, onToggle, label, status = null, marked = null }) {
  const t = useT()
  const ref = useRef(null)
  const W = useBox(ref)
  const mid = useId()
  const g = useMemo(() => (W ? graphOf(cards, W, { open, keep: new Set(selected ? [selected] : []) }) : null), [cards, W, open, selected])
  const interactive = typeof onSelect === 'function'
  // the piles the user unfolded: each keeps a button to fold it back (an unfolded pile has no node of its own any more)
  const unfolded = useMemo(() => foldCards(cards, new Set(), new Set(selected ? [selected] : [])).filter(c => c.kind === 'group' && open.has(c.id)), [cards, open, selected])
  // the pile that was pressed is gone from the DOM (replaced by its cards, or by its fold button): the focus goes to the first card it
  // unfolded into, or back to the pile it folded into, once the new graph is drawn
  const focusNext = useRef(null)
  const toggle = (id, to) => { focusNext.current = to; onToggle(id) }
  useLayoutEffect(() => {
    const to = focusNext.current
    if (!to) return
    const el = ref.current?.querySelector(`[data-node="${to.replace(/["\\]/g, '\\$&')}"]`)
    if (el) { focusNext.current = null; el.focus({ preventScroll: false }) }
  }, [g])
  return (
    <div className="oc-cgg" ref={ref} role="group" aria-label={label} data-graph>
      {unfolded.length ? (
        <div className="oc-cgg-folds">
          {unfolded.map(p => {
            const codes = `${info.get(p.members[0].id)?.code}–${info.get(p.members[p.members.length - 1].id)?.code}`
            return (
              <button key={p.id} type="button" className="ux-b sm" data-fold={p.id} aria-expanded="true" onClick={() => toggle(p.id, p.id)}>
                {t('campaign.groupFold', codes, p.members.length)}
              </button>
            )
          })}
        </div>
      ) : null}
      {g ? (
        <div className={`oc-cgg-in${g.compact ? ' cmp' : ''}`} style={{ width: W, height: g.H }}>
          {g.bands.map(b => (
            <div key={b.p} className={`oc-cgg-band${b.p % 2 ? ' alt' : ''}`} style={{ top: b.y0, height: b.y1 - b.y0 }} data-band={b.p}>
              {/* the strip is 24 px wide: the letter alone fits it, the whole name is on hover and for a screen reader */}
              <span className="lb" aria-hidden="true" title={t('campaign.phaseLabel', letter(b.p), phases[b.p]?.name || '')}>{letter(b.p)}</span>
              <span className="ux-vh">{t('campaign.phaseLabel', letter(b.p), phases[b.p]?.name || '')}</span>
            </div>
          ))}
          <svg className="oc-cgg-edges" width={W} height={g.H} viewBox={`0 0 ${W} ${g.H}`} aria-hidden="true" focusable="false">
            <defs>
              <marker id={`${mid}-a`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 8 4 0 8z" className="am" /></marker>
              <marker id={`${mid}-o`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 8 4 0 8z" className="am on" /></marker>
            </defs>
            {g.edges.map(e => {
              const on = selected && (e.from === selected || e.to === selected)
              return <path key={`${e.from}>${e.to}`} className={`ge${e.guard ? ' g' : ''}${on ? ' on' : ''}`} d={e.d} markerEnd={`url(#${mid}-${on ? 'o' : 'a'})`} data-edge={`${e.from}>${e.to}`} />
            })}
          </svg>
          {g.cards.map(c => {
            const p = g.pos.get(c.id)
            if (!p) return null
            const box = { left: p.x, top: p.y, width: p.w, height: p.h }
            if (c.kind === 'guard') {
              const head = c.phase === 0
              const full = head ? t('campaign.guard.headLong') : t('campaign.guard.phaseLong', letter(c.phase), phases[c.phase]?.name || '', letter(c.phase - 1))
              const short = head ? t('campaign.guard.head') : t('campaign.guard.phase', letter(c.phase))
              const state = status?.get(c.id)
              return (
                <div key={c.id} className="oc-cgg-guard" style={{ ...box }} data-node={c.id} data-guard title={full}>
                  <i className="bar" aria-hidden="true" />
                  <span className="pill"><Icon name={state === 'done' ? 'check' : 'lock'} size={14} /><b>{short}</b>{state ? <em>{t(`campaign.state.${state}`)}</em> : null}</span>
                  <span className="ux-vh">{full}</span>
                </div>
              )
            }
            if (c.kind === 'group') {
              const m = c.members
              const bots = Object.create(null)
              for (const x of m) { const w = info.get(x.id)?.who || ''; bots[w] = (bots[w] || 0) + 1 }
              const sorted = Object.entries(bots).sort((a, b) => b[1] - a[1])
              const codes = `${info.get(m[0].id)?.code}–${info.get(m[m.length - 1].id)?.code}`
              const words = m.map(x => String(info.get(x.id)?.title || '').split(' '))
              let pre = 0
              while (words.every(w => w[pre] && w[pre] === words[0][pre])) pre++
              const what = pre ? `${words[0].slice(0, pre).join(' ')} …` : t('campaign.parallel')
              const list = sorted.map(([w, n]) => `${w} ${n}`).join(' · ')
              return (
                <button key={c.id} type="button" className="oc-cgg-node grp" style={{ ...box, '--bc': colors.get(sorted[0]?.[0]) }} data-node={c.id} data-group aria-expanded="false"
                  aria-label={t('campaign.groupAria', codes, m.length, list)} title={t('campaign.groupTip', m.length, codes)} onClick={() => toggle(c.id, m[0].id)}>
                  <i className="st st2" aria-hidden="true" /><i className="st st1" aria-hidden="true" />
                  <span className="top"><b className="cd">{codes}</b><span className="tt">{what}</span><em className="n">×{m.length}</em></span>
                  <span className="seg" aria-hidden="true">{sorted.map(([w, n]) => <i key={w} style={{ flexGrow: n, '--bc': colors.get(w) }} />)}</span>
                  <span className="ws">{list}</span>
                </button>
              )
            }
            const i = info.get(c.id) || {}
            const sel = selected === c.id
            const state = status?.get(c.id)
            const Tag = interactive ? 'button' : 'div'
            return (
              <Tag key={c.id} {...(interactive ? { type: 'button', onClick: () => onSelect(c.id), 'aria-pressed': sel } : { tabIndex: -1 })} className={`oc-cgg-node${sel ? ' on' : ''}${state ? ` s-${state}` : ''}${marked?.has(c.id) ? ' lm' : ''}`}
                style={{ ...box, '--bc': colors.get(i.who) }} data-node={c.id} title={`${i.code} · ${i.title || t('campaign.untitled')} — ${i.who}${i.pin ? ` · ${t('campaign.pinnedModel', i.pin)}` : ''}`}>
                <i className="stripe" aria-hidden="true" />
                {sceneBy?.get(i.who) ? <span className="pt"><Portrait agent={sceneBy.get(i.who)} /></span> : null}
                <span className="tx">
                  <span className="l1"><b className="cd">{i.code}</b><span className="tt">{i.title || <em>{t('campaign.untitled')}</em>}</span></span>
                  {g.compact ? null : <span className="l2">{i.who}{state ? ` · ${t(`campaign.state.${state}`)}` : ''}</span>}
                </span>
                {i.pin ? <span className="pin" aria-hidden="true">M</span> : null}
                {marked?.has(c.id) ? <span className="ux-vh">{t('llm.cgmark.row')}</span> : null}
              </Tag>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** The bots of a campaign: colour, portrait, name, number of cards. */
export function BotLegend({ list, colors, sceneBy, label, marked = 0 }) {
  const t = useT()
  return (
    <ul className="oc-cgl" aria-label={label}>
      {list.map(([name, n]) => (
        <li key={name} style={{ '--bc': colors.get(name) }}>
          <i aria-hidden="true" />
          {sceneBy?.get(name) ? <Portrait agent={sceneBy.get(name)} /> : null}
          <b>{name}</b><span className="oc-mono">{n}</span>
        </li>
      ))}
      {marked ? <li className="oc-cglm" data-lm-legend><i aria-hidden="true" />{t('llm.cgmark.legend')}</li> : null}
    </ul>
  )
}
