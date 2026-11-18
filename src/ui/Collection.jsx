import { useMemo, useRef, useState } from 'react'

import { ratio, vitrineView } from '../core/vitrine.js'
import { dateText, trophyTip } from '../core/game.js'
import { Dlg } from './DialogKit.jsx'
import { escapeCloses } from './dialogKeys.js'
import { GameBar } from './GameBar.jsx'
import { familyColor } from '../scene/index.js'
import { PixelIcon, PixelMedal } from './PixelIcon.jsx'
import { CARD, EDGE, RING_FOCUS, SUNKEN } from './tokens.js'

/** Unit written after a number: the only percentage among the achievements is `thrifty`'s. */
const unitOf = a => (a.id === 'thrifty' ? '%' : '')
const secretOf = a => Boolean(a.hidden && !a.unlocked)
const medalProps = a => ({ id: a.id, family: a.family, tier: a.tier ?? null, unlocked: a.unlocked, hidden: a.hidden })
const pctOf = a => Math.round(ratio(a) * 100)

/** What a screen reader says about one achievement: name, status, progress in words, tier. */
export function sentence(a, t, lang) {
  if (secretOf(a)) return `${t('game.hidden.name')}. ${t('game.hidden.when')}`
  const unit = unitOf(a)
  const parts = [t(`game.ach.${a.id}.name`)]
  if (a.unavailable) parts.push(t('game.unavailable'))
  else if (a.unlocked) parts.push(a.recheck ? t('game.tip.recheck') : a.dated ? t('game.tip.unlockedOn', dateText(a.unlockedMs, lang)) : t('game.tip.undated'))
  else parts.push(t('game.collection.statusOff'), t('game.collection.progress', a.progress[0], a.progress[1], unit))
  if (a.tiered) parts.push(a.tier ? t('game.collection.tierReached', t(`game.tier.${a.tier}`)) : t('game.collection.noTierYet'))
  return parts.join('. ')
}

/** One medal on a shelf: the pixel medal over its name; `aria-pressed` = the one the detail shows. A new one (unlocked in the last 2 days) shines twice. */
function Medal({ a, t, lang, selected, fresh, tab, onPick, onFocus, refCb }) {
  const secret = secretOf(a)
  return (
    <button
      type="button"
      ref={refCb}
      className={`oc-md${a.unlocked ? ' on' : ''}${fresh ? ' new' : ''}`}
      tabIndex={tab ? 0 : -1}
      aria-pressed={selected}
      aria-label={`${sentence(a, t, lang)}${fresh ? `. ${t('vit.new')}` : ''}`}
      data-ach={a.id}
      data-family={a.family}
      data-unlocked={a.unlocked ? '' : undefined}
      data-hidden={a.hidden ? '' : undefined}
      data-tier={a.tier ?? undefined}
      data-new={fresh ? '' : undefined}
      onClick={onPick}
      onFocus={onFocus}
    >
      <PixelMedal {...medalProps(a)} size={48} />
      <span className="oc-md-n" aria-hidden="true">{secret ? '???' : t(`game.ach.${a.id}.name`)}</span>
      {fresh ? <i className="oc-md-new" aria-hidden="true" /> : null}
    </button>
  )
}

/** « Almost there »: a locked achievement close to its goal — the medal, the name, the numbers on a bar. Selects it in the detail. */
function Almost({ a, t, onPick }) {
  const unit = unitOf(a)
  return (
    <button type="button" className="oc-alm" data-almost={a.id} onClick={onPick} aria-label={`${t(`game.ach.${a.id}.name`)}. ${t('game.collection.progress', a.progress[0], a.progress[1], unit)}`}>
      <PixelMedal {...medalProps(a)} size={36} />
      <span className="oc-alm-t" aria-hidden="true">
        <b>{t(`game.ach.${a.id}.name`)}</b>
        <small className="oc-mono">{a.progress[0]}{unit ? ` ${unit}` : ''}/{a.progress[1]}{unit ? ` ${unit}` : ''}</small>
        <span className="oc-pb"><i style={{ width: `${pctOf(a)}%` }} /></span>
      </span>
    </button>
  )
}

/** The detail of the selected medal: the big medal, name, family and tier, the date or the progress, the condition, the fact, the tiers, the source. */
function Detail({ a, t, lang, readMs, boards, refEl }) {
  const secret = secretOf(a)
  const tip = trophyTip(a, { lang, readMs, boards })
  const unit = unitOf(a)
  const line = parts => (parts ? t(...parts) : '')
  const condText = secret ? t('game.hidden.cond') : t(`game.ach.${a.id}.cond`)
  const showBar = !secret && !a.unavailable && (!a.unlocked || (a.tiered && a.nextTier))
  return (
    <aside ref={refEl} className={`oc-det${a.unlocked ? ' on' : ''}`} data-detail={a.id} data-tier={a.tier ?? undefined} aria-label={t('vit.detail')} aria-live="polite">
      <PixelMedal {...medalProps(a)} size={96} className="oc-medal oc-det-medal" />
      <h4>{secret ? t('game.hidden.name') : t(`game.ach.${a.id}.name`)}</h4>
      <div className="oc-det-chips">
        <span className="oc-fchip" data-family={a.family} style={{ '--fc': familyColor(a.family) }}><i aria-hidden="true" />{t(`game.family.${a.family}`)}</span>
        {a.tier ? <span className="oc-fchip" data-tier={a.tier}><span className="oc-stars" aria-hidden="true">{Array.from({ length: { bronze: 1, silver: 2, gold: 3 }[a.tier] }, (_, i) => <PixelIcon key={i} id={`star_${a.tier}`} size={12} />)}</span>{t(`game.tier.${a.tier}`)}</span> : null}
      </div>
      <p className={`oc-det-when${a.unlocked ? ' ok' : ''}`}>{line(tip.when)}</p>
      {showBar ? (
        <span className="oc-pb oc-pb-l" role="progressbar" aria-label={t(`game.ach.${a.id}.name`)} aria-valuemin={0} aria-valuemax={a.progress[1]} aria-valuenow={a.progress[0]} aria-valuetext={t('game.collection.progress', a.progress[0], a.progress[1], unit)}>
          <i style={{ width: `${pctOf(a)}%` }} />
        </span>
      ) : null}
      <p className="oc-det-cond">{condText}</p>
      {a.unlocked && !a.unavailable && line(a.fact) !== condText ? <p className="oc-det-fact">{line(a.fact)}</p> : null}
      {a.tiered ? (
        <ul className="oc-tiers" aria-label={t('vit.tiers')}>
          {a.tiers.map(x => (
            <li key={x.tier} className={x.unlocked ? 'on' : ''} data-tier={x.tier}>
              <PixelIcon id={`star_${x.tier}`} size={14} />
              <span>{t(`game.tier.${x.tier}`)}</span>
              <small>{x.unlocked ? (x.ms != null ? dateText(x.ms, lang) : t('vit.wholeHistory')) : t('vit.tierAt', x.at, unit)}</small>
            </li>
          ))}
        </ul>
      ) : null}
      {tip.where && !secret ? <p className="oc-det-src">{t('game.tip.where', line(tip.where))}</p> : null}
      {tip.source ? <p className="oc-det-src">{line(tip.source)}</p> : null}
    </aside>
  )
}

/**
 * The showcase: a window of its own, opened by the header's badge (the strip under the header and the Journal's
 * collection are gone). From top to bottom: the game bar (level, numbers, grades, cat, season, postcard), « Almost there » (the 3 locked
 * achievements closest to their goal), one shelf per family with its medals (metal = tier, ribbon = family, 1 / 2 / 3 pips = tier), and the
 * detail of the selected medal beside (condition, date, fact, the tiers, the data source). A hidden locked achievement is a « ? » and gives
 * nothing away. The medals are ONE tab stop (arrows, Home, End move); Enter or Space selects. Escape closes. Never rendered in sober mode.
 */
export function Vitrine({ open, onClose, game, office, readMs, nowMs, onPostcard, t }) {
  const lang = t.lang
  const view = useMemo(() => vitrineView(game, nowMs), [game, nowMs])
  const [picked, setPicked] = useState(null)
  const [rov, setRov] = useState(0)
  const refs = useRef([])
  const detailRef = useRef(null)
  const byId = useMemo(() => new Map(view.shelves.flatMap(f => f.items).map(a => [a.id, a])), [view])
  const selId = picked && byId.has(picked) ? picked : view.first
  const sel = byId.get(selId) ?? null
  const pick = id => {
    setPicked(id)
    const at = view.order.indexOf(id)
    if (at >= 0) setRov(at)
    // narrow window: the detail sits above the shelves, bring it into view; wide: it is sticky beside them and already seen
    setTimeout(() => detailRef.current?.scrollIntoView?.({ block: 'nearest' }), 0)
  }
  const onKey = e => {
    const n = view.order.length
    if (!n) return
    let i = rov
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = (rov + 1) % n
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = (rov - 1 + n) % n
    else if (e.key === 'Home') i = 0
    else if (e.key === 'End') i = n - 1
    else return
    e.preventDefault()
    setRov(i)
    refs.current[i]?.focus()
  }
  return (
    <Dlg open={open} onClose={onClose} title={t('game.title')} icon="trophy" size="l" className="oc-vt" backdrop focus="[data-vitrine-close]" closeProps={{ 'data-vitrine-close': '' }} data-vitrine-dialog
      onKeyDown={e => { if (escapeCloses(e)) { e.preventDefault(); e.stopPropagation(); onClose() } }}>
      <style>{VITRINE_CSS}</style>
      <div data-game data-vitrine data-unlocked={view.got} data-total={view.total} data-hidden-count={view.hidden}>
        <GameBar game={game} view={view} t={t} onPostcard={onPostcard} />
        <div className="oc-vt-grid">
          <div className="oc-vt-shelves" onKeyDown={onKey}>
            {view.almost.length ? (
              <section className="oc-vt-almost" aria-label={t('vit.almost')}>
                <h4>{t('vit.almost')}</h4>
                <div className="oc-alm-row">{view.almost.map(a => <Almost key={a.id} a={a} t={t} onPick={() => pick(a.id)} />)}</div>
              </section>
            ) : null}
            {view.shelves.map(f => (
              <section key={f.family} className="oc-fam" data-family={f.family} style={{ '--fc': familyColor(f.family) }} aria-label={t('game.collection.familyHead', t(`game.family.${f.family}`), t('game.collection.summary', f.unlocked, f.items.length))}>
                <h4><i aria-hidden="true" />{t(`game.family.${f.family}`)}<span className="oc-mono">{f.unlocked}/{f.items.length}</span></h4>
                <div className="oc-shelf" role="group">
                  {f.items.map(a => {
                    const i = view.order.indexOf(a.id)
                    return <Medal key={a.id} a={a} t={t} lang={lang} selected={a.id === selId} fresh={view.recent.has(a.id)} tab={i === rov} refCb={el => { refs.current[i] = el }} onPick={() => pick(a.id)} onFocus={() => setRov(i)} />
                  })}
                </div>
              </section>
            ))}
          </div>
          {sel ? <Detail a={sel} t={t} lang={lang} readMs={readMs} boards={office.boards.length} refEl={detailRef} /> : null}
        </div>
      </div>
    </Dlg>
  )
}

const ORANGE = 'var(--ui-orange, var(--ui-accent))'
const GREEN = 'var(--ui-green, var(--ui-accent))'
const RED = 'var(--ui-red, var(--destructive, var(--ui-orange)))'
const T3 = 'color-mix(in oklab, var(--ui-text-secondary) 60%, var(--ui-text-tertiary))'   // 3.54:1 -> >= 4.5:1 (light theme)
const WOOD = `color-mix(in oklab, ${ORANGE} 72%, var(--background, ${CARD}))`
const WOOD_D = `color-mix(in oklab, ${ORANGE} 100%, var(--background, ${CARD}))`

/** Look of the showcase: theme variables only, sizes on the 4 px grid, medals are canvases (the art palette lives in src/scene/medalart.js). */
export const VITRINE_CSS = `
.oc-dg.oc-vt{width:min(960px,calc(100vw - 32px))}
.oc-vt .oc-dg-b{padding:16px}
.oc-vt [data-vitrine]{display:flex;flex-direction:column;gap:16px;min-width:0}
.oc-medal,.oc-icon{flex:0 0 auto;image-rendering:pixelated;image-rendering:crisp-edges}
/* the game bar: level on a bar, the numbers, the grades, the cat, the season, the postcard */
.oc-vh{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:16px;align-items:center;box-sizing:border-box;padding:16px;border-radius:12px;border:1px solid color-mix(in oklab, ${ORANGE} 30%, ${EDGE});background:radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, ${ORANGE} 20%, ${CARD}) 0%, ${CARD} 62%)}
.oc-vh-lvl{display:grid;place-items:center;width:64px;height:64px;border-radius:12px;background:color-mix(in oklab, ${ORANGE} 18%, ${CARD});border:1px solid color-mix(in oklab, ${ORANGE} 40%, ${EDGE})}
.oc-vh-main{min-width:0;display:flex;flex-direction:column;gap:8px}
.oc-vh h3{margin:0;font-size:20px;line-height:24px;font-weight:700}
.oc-vh h3 small{margin-left:8px;font-size:13px;font-weight:500;color:${T3}}
.oc-xp{height:8px;max-width:420px;border-radius:4px;overflow:hidden;background:${SUNKEN}}
.oc-xp i{display:block;height:100%;transform-origin:left;background:linear-gradient(90deg, ${ORANGE}, color-mix(in oklab, ${ORANGE} 50%, ${RED}));animation:oc-xp-in .7s cubic-bezier(.2,.8,.2,1) both}
@keyframes oc-xp-in{from{transform:scaleX(0)}to{transform:none}}
.oc-vh-stats,.oc-vh-chips{display:flex;flex-wrap:wrap;gap:4px 16px;margin:0;padding:0;list-style:none;font-size:12px;color:var(--ui-text-secondary)}
.oc-vh-stats li{display:inline-flex;align-items:center;gap:4px;min-height:20px}
.oc-vh-stats b{font-family:var(--oc-mono, ui-monospace, monospace);color:var(--foreground)}
.oc-vh-stats b .oc-faint{font-weight:400}
.oc-vh-chips{gap:8px}
.oc-vh-chip{display:inline-flex;align-items:center;gap:6px;min-height:24px;box-sizing:border-box;padding:0 8px;border:1px solid ${EDGE};border-radius:12px;background:${CARD};font-size:11px}
.oc-vh-chip b{font-family:var(--oc-mono, ui-monospace, monospace);color:var(--foreground)}
.oc-cat{flex:0 0 auto;color:color-mix(in oklab, var(--ui-accent) 50%, var(--foreground))}
.oc-cat-alert{color:color-mix(in oklab, ${ORANGE} 50%, var(--foreground))}
.oc-cat-sleep,.oc-cat-hide{color:${T3}}
.oc-vh-card{display:inline-flex;align-items:center;gap:8px;height:32px;box-sizing:border-box;padding:0 12px;border:1px solid ${EDGE};border-radius:4px;background:${CARD};color:var(--foreground);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.oc-vh-card:hover{border-color:var(--ui-accent)}
.oc-vh-card:focus-visible,.oc-md:focus-visible,.oc-alm:focus-visible{${RING_FOCUS}}
/* the grid: shelves, the detail beside */
.oc-vt-grid{display:grid;grid-template-columns:minmax(0,1fr) 264px;gap:16px;align-items:start;min-width:0}
.oc-vt-shelves{display:flex;flex-direction:column;gap:16px;min-width:0}
.oc-vt-almost h4,.oc-fam h4{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:12px;line-height:16px;font-weight:600}
.oc-fam h4 i{flex:0 0 auto;width:12px;height:12px;border-radius:3px;background:var(--fc, var(--ui-accent))}
.oc-fam h4 .oc-mono{margin-left:4px;font-weight:600;color:${T3}}
.oc-alm-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.oc-alm{height:100%;display:flex;align-items:center;gap:12px;min-width:0;box-sizing:border-box;padding:8px 12px;border:1px dashed var(--ui-stroke-secondary);border-radius:12px;background:transparent;color:var(--foreground);font:inherit;text-align:left;cursor:pointer}
.oc-alm:hover{border-color:var(--ui-accent)}
.oc-alm-t{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.oc-alm-t b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;line-height:16px;overflow-wrap:anywhere}
.oc-alm-t small{font-size:11px;color:${T3}}
.oc-pb{display:block;height:4px;border-radius:2px;overflow:hidden;background:${SUNKEN}}
.oc-pb i{display:block;height:100%;background:var(--ui-accent)}
.oc-pb-l{height:8px;border-radius:4px}
/* a shelf: wooden board under the medals, lit from the front */
.oc-shelf{display:flex;flex-wrap:wrap;gap:4px 8px;padding:8px 8px 4px;border-radius:12px 12px 4px 4px;background:linear-gradient(180deg, color-mix(in oklab, ${SUNKEN} 70%, ${CARD}), color-mix(in oklab, var(--ui-bg-elevated, ${CARD}) 80%, ${CARD}));box-shadow:inset 0 -8px 0 ${WOOD}, inset 0 -12px 0 ${WOOD_D}}
.oc-md{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;width:80px;box-sizing:border-box;padding:8px 2px 16px;border:0;border-radius:8px;background:transparent;color:var(--foreground);font:inherit;cursor:pointer;transition:transform .12s ease,background-color .12s ease}
.oc-md:hover{transform:translateY(-2px)}
.oc-md[aria-pressed="true"]{background:color-mix(in oklab, var(--ui-accent) 12%, transparent);box-shadow:inset 0 0 0 1.5px color-mix(in oklab, var(--ui-accent) 60%, transparent)}
.oc-md-n{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;max-width:76px;min-height:36px;font-size:11px;line-height:12px;text-align:center;overflow-wrap:anywhere}
.oc-md:not(.on) .oc-md-n{color:${T3}}
.oc-md-new{position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:50%;background:${ORANGE};box-shadow:0 0 0 2px ${CARD}}
.oc-md.new .oc-medal{animation:oc-shine 1.2s ease 2}
@keyframes oc-shine{0%,100%{filter:none}50%{filter:brightness(1.35) drop-shadow(0 0 6px color-mix(in oklab, ${ORANGE} 70%, transparent))}}
/* the detail */
.oc-det{position:sticky;top:0;display:flex;flex-direction:column;align-items:center;gap:8px;box-sizing:border-box;padding:16px;border:1px solid ${EDGE};border-radius:12px;background:${CARD};text-align:center;overflow-wrap:anywhere}
.oc-det.on{border-color:color-mix(in oklab, ${GREEN} 40%, ${EDGE})}
.oc-det h4{margin:0;font-size:16px;line-height:20px}
.oc-det p{margin:0;font-size:12px;line-height:16px}
.oc-det-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.oc-fchip{display:inline-flex;align-items:center;gap:6px;min-height:20px;box-sizing:border-box;padding:0 8px;border:1px solid ${EDGE};border-radius:10px;font-size:11px}
.oc-fchip[data-family]{border-color:var(--fc, ${EDGE})}
.oc-fchip i{width:8px;height:8px;border-radius:2px;background:var(--fc, var(--ui-accent))}
.oc-stars{display:inline-flex;align-items:center;gap:1px}
.oc-det-when{font-weight:600;color:${T3}}
.oc-det-when.ok{color:color-mix(in oklab, ${GREEN} 60%, var(--foreground))}
.oc-det .oc-pb-l{align-self:stretch}
.oc-det-cond{color:var(--foreground)}
.oc-det-fact{color:var(--ui-text-secondary)}
.oc-det-src{font-size:11px !important;color:${T3}}
.oc-tiers{align-self:stretch;display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;text-align:left}
.oc-tiers li{display:flex;align-items:center;gap:8px;font-size:12px;color:${T3}}
.oc-tiers li.on{color:var(--foreground)}
.oc-tiers li:not(.on) .oc-icon{filter:grayscale(1);opacity:.45}
.oc-tiers small{margin-left:auto;font-size:11px;color:${T3}}
@media (max-width:760px){
  .oc-vt-grid{grid-template-columns:minmax(0,1fr)}
  .oc-det{position:static;order:-1;display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:16px;row-gap:8px;align-items:start;text-align:left;padding:12px}
  .oc-det > .oc-det-medal{grid-column:1;grid-row:1 / span 6;width:64px !important;height:64px !important}
  .oc-det > :not(.oc-det-medal){grid-column:2;min-width:0}
  .oc-det-chips{justify-content:flex-start}
  .oc-alm-row{grid-template-columns:minmax(0,1fr)}
  .oc-vh{grid-template-columns:auto minmax(0,1fr)}
  .oc-vh-card{grid-column:1 / -1;justify-content:center}
}
@media (max-width:560px){
  .oc-dg.oc-vt{width:100vw;max-width:100vw}
  .oc-vt .oc-dg-b{padding:12px}
  .oc-vh{padding:12px;gap:12px}
  .oc-vh-lvl{width:48px;height:48px}
  .oc-shelf{gap:4px}
}
@media (prefers-reduced-motion:reduce){.oc-md{transition:none}.oc-md:hover{transform:none}.oc-md.new .oc-medal,.oc-xp i{animation:none}}
.oc-dg[data-motion="reduced"] .oc-md.new .oc-medal,.oc-dg[data-motion="reduced"] .oc-xp i{animation:none}
`
