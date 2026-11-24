import { useMemo } from 'react'

import { WINDOWS, axisTicks, clockLabel, cursorKey, density, stepFact } from '../core/replay.js'
import { DlgIcon, DlgTip } from './DialogKit.jsx'
import { TIP_CSS } from './dialogStyles.js'

const BINS = 96

/** The strip of facts under the cursor: how many fall in each slice of the window (completed, blocked, failures apart). Decoration for the eye; the numbers are in the journal. */
function Density({ entries, fromMs, toMs }) {
  const bins = useMemo(() => density(entries, fromMs, toMs, BINS), [entries, fromMs, toMs])
  const top = Math.max(1, ...bins.map(b => b.all))
  return (
    <svg className="oc-rp-dens" viewBox={`0 0 ${BINS} 20`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {bins.map((b, i) => {
        if (!b.all) return null
        const h = Math.max(2, (b.all / top) * 18)
        const hOf = n => (n / b.all) * h
        let y = 20
        const seg = (cls, n) => {
          if (!n) return null
          const hh = hOf(n)
          y -= hh
          return <rect key={cls} className={cls} x={i + 0.1} y={y} width={0.8} height={hh} />
        }
        return <g key={i}>{seg('d-done', b.done)}{seg('d-block', b.block)}{seg('d-fail', b.fail)}{seg('d-other', b.all - b.done - b.block - b.fail)}</g>
      })}
    </svg>
  )
}

/**
 * The time bar under the scene. A range input (arrows, Shift, Page up/down, Home/End, all by keyboard), a window choice (this night,
 * 24 h, 7 days), previous / next fact, and the state at the cursor in words. It works on the answer already in memory: moving the cursor
 * asks nothing from the server.
 */
export function ReplayBar({ replay, status, kind, onKind, atMs, onAt, entries, counts, t, children }) {
  const day = replay ? replay.toMs - replay.fromMs > 20 * 3_600_000 : false
  const label = ms => clockLabel(ms, t.lang, { day })
  const ticks = useMemo(() => (replay ? axisTicks(replay.fromMs, replay.toMs, t.lang) : []), [replay, t.lang])
  const prev = replay ? stepFact(entries, atMs, -1) : null
  const next = replay ? stepFact(entries, atMs, 1) : null
  const key = e => {
    if (!replay) return
    const to = cursorKey(e.key, e.shiftKey, atMs, replay)
    if (to != null) { e.preventDefault(); onAt(to) }
  }
  return (
    <section className="oc-rp" role="region" aria-label={t('replay.region')} data-replay-bar>
      <style>{TIP_CSS}</style>
      <div className="oc-rp-top">
        <span className="oc-rp-win" role="group" aria-label={t('replay.window')}>
          {WINDOWS.map(w => (
            <button key={w} type="button" aria-pressed={kind === w} data-replay-window={w} title={t(`replay.windowKind.${w}`)} onClick={() => onKind(w)}>{t(`replay.windowShort.${w}`)}</button>
          ))}
        </span>
        {replay ? <span className="oc-rp-range" data-replay-range>{t('replay.range', label(replay.fromMs), label(replay.toMs))}</span> : null}
        {replay && counts ? (
          <span className="oc-rp-state" aria-live="polite" data-replay-state>
            {counts.working + counts.waiting + counts.silent ? t('replay.state', counts.working, counts.waiting, counts.silent) : t('replay.stateNone')}
          </span>
        ) : null}
      </div>
      {replay ? (
        <>
          <div className="oc-rp-track">
            <Density entries={entries} fromMs={replay.fromMs} toMs={replay.toMs} />
            <input
              type="range"
              className="oc-rp-range-input"
              data-replay-cursor
              min={replay.fromMs}
              max={replay.toMs}
              step={60_000}
              value={atMs}
              aria-label={t('replay.cursor')}
              aria-valuetext={label(atMs)}
              onChange={e => onAt(Number(e.target.value))}
              onKeyDown={key}
            />
          </div>
          <div className="oc-rp-ticks" aria-hidden="true" data-replay-ticks>
            {ticks.map(k => <span key={k.ms} style={{ left: `${k.at * 100}%` }} data-edge={k.edge || undefined}>{k.label}</span>)}
          </div>
          <div className="oc-rp-steps">
            <button type="button" className="oc-rp-step" data-replay-prev aria-disabled={prev == null} title={prev == null ? t('replay.atEdge') : undefined} onClick={() => { if (prev != null) onAt(prev) }}><DlgIcon id="prev" size={14} />{t('replay.prev')}</button>
            <button type="button" className="oc-rp-step" data-replay-next aria-disabled={next == null} title={next == null ? t('replay.atEdge') : undefined} onClick={() => { if (next != null) onAt(next) }}>{t('replay.next')}<DlgIcon id="next" size={14} /></button>
            <ul className="oc-rp-key" aria-label={t('replay.keyLabel')} data-replay-key>
              <li><i className="d-done" aria-hidden="true" />{t('replay.key.done')}</li>
              <li><i className="d-block" aria-hidden="true" />{t('replay.key.block')}</li>
              <li><i className="d-fail" aria-hidden="true" />{t('replay.key.fail')}</li>
            </ul>
            <span className="oc-rp-help"><DlgTip name={t('replay.cursor')}>{t('replay.cursorHelp')}</DlgTip></span>
          </div>
          {children}
        </>
      ) : null /* the banner above says it (loading or failed): said once, not twice 60 px apart */}
    </section>
  )
}
