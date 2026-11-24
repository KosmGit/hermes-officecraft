import { useEffect, useId, useMemo, useState } from 'react'

import { percentText } from '../core/format.js'
import { clockLabel, DEFAULT_NIGHT } from '../core/replay.js'
import {
  USAGE_METRICS, USAGE_WINDOWS, agentRows, costTotal, daysFor, boardRows, boardsAvailable, dailySeries, exactLabel, modelRows, peakOf, percentLabel, quotaOf, rangeLabel, share, splitShares, tokenLabel, usageWindow, usdLabel
} from '../core/usage.js'
import { useReplay } from '../data/replay.js'
import { useQuota, useQuotaRetry, useUsage, useUsageDays } from '../data/usage.js'
import { Dlg, DlgIcon, DlgTip, Notice, Seg } from './DialogKit.jsx'
import { escapeCloses } from './dialogKeys.js'
import { useT } from './useT.js'

const WIN_KEY = { '24h': '24h', '7d': '7d', '30d': '30d' }

/** A stacked bar: input / output / cache, each a share of the biggest row. A part Hermes did not record is not drawn (and said in the title). */
function Bar({ parts, peak, label }) {
  if (!parts) return <span className="oc-us-bar oc-us-bar-none" aria-hidden="true" />
  const total = parts.total
  const w = share(total, peak) ?? 0
  const seg = (cls, v) => (v ? <i className={cls} style={{ flexGrow: v }} /> : null)
  return (
    <span className="oc-us-bar" aria-hidden="true" title={label}>
      <span className="oc-us-fill" style={{ width: `${w * 100}%` }}>
        {seg('s-in', parts.input)}{seg('s-out', parts.output)}{seg('s-cache', parts.cache)}
      </span>
    </span>
  )
}

/** What a row says about money: an amount only for a priced route (« Hermes' estimate »), « price unknown » otherwise; never a 0 that was not recorded. */
function Cost({ cost, t }) {
  if (cost.kind === 'none') return <span className="oc-faint" data-cost="none">{t('usage.cost.none')}</span>
  if (cost.kind === 'unpriced') return <span className="oc-faint" data-cost="unpriced" title={t('usage.cost.unpricedTip')}>{t('usage.cost.unpriced')}</span>
  if (cost.kind === 'mixed') return <span data-cost="mixed" title={t('usage.cost.mixedTip', cost.unpriced, cost.source || '—')}>{t('usage.cost.mixed', usdLabel(cost.pricedUsd, t.lang))}</span>
  return <span data-cost="priced" data-usd={cost.usd} title={t('usage.cost.estTip', cost.source || '—')}>{t('usage.cost.est', usdLabel(cost.usd, t.lang))}</span>
}

function Tile({ id, icon, value, exact, label, note, t }) {
  return (
    <div className="oc-us-tile" data-usage-tile={id} data-value={exact ?? ''}>
      <span className="oc-us-tico"><DlgIcon id={icon} size={16} /></span>
      <b title={exact ? t('usage.exact', exact) : undefined}>{value ?? t('usage.absent')}</b>
      <span>{label}</span>
      {note ? <small className="oc-faint">{note}</small> : null}
    </div>
  )
}

/** The split of the tokens as a ring (input / output / cache, in that order, colour AND order): a share is only drawn from a count Hermes recorded. */
function Donut({ parts, total, t }) {
  const items = splitShares(parts)
  if (!items.length) return null
  const R = 40
  const C = 2 * Math.PI * R
  let at = 0
  return (
    <div className="oc-us-split" data-usage-split>
      <svg viewBox="0 0 100 100" className="oc-us-donut" aria-hidden="true" focusable="false">
        <circle cx="50" cy="50" r={R} className="p-track" />
        {items.map(({ key, share: part }) => {
          const len = part * C
          const el = <circle key={key} cx="50" cy="50" r={R} className={`p-${key}`} strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-at} transform="rotate(-90 50 50)" />
          at += len
          return el
        })}
        <text x="50" y="55" textAnchor="middle" className="p-total">{total}</text>
      </svg>
      <ul className="oc-us-legend" aria-label={t('usage.split')}>
        {items.map(({ key, pct }) => (
          <li key={key}><i className={`s-${key}`} aria-hidden="true" />{t(`usage.part.${key === 'in' ? 'input' : key === 'out' ? 'output' : 'cache'}`)} <b>{percentText(pct, t.lang)}</b></li>
        ))}
      </ul>
    </div>
  )
}

/** The period's cost as a tile: an amount only from priced routes, said partial when some are not; no price at all is « price unknown », never 0. */
function CostTile({ cost, t }) {
  const note = cost.kind === 'none' ? null : [cost.routes ? t('usage.tile.costRoutes', cost.routes) : null, cost.noDetail ? t('usage.tile.costNoDetail', cost.noDetail) : null].filter(Boolean).join(' · ') || null
  const value = cost.kind === 'priced' || cost.kind === 'mixed' ? t('usage.tile.costValue', usdLabel(cost.kind === 'priced' ? cost.usd : cost.pricedUsd, t.lang)) : null
  return (
    <div className="oc-us-tile cost" data-usage-tile="cost" data-cost-kind={cost.kind} data-partial={cost.partial ? '' : undefined} data-value={value ?? ''}>
      <span className="oc-us-tico"><DlgIcon id="coin" size={16} /></span>
      <b title={t('usage.cost.estTip', cost.source || '—')}>{value ?? t(cost.kind === 'none' ? 'usage.absent' : 'usage.cost.unpriced')}</b>
      <span>{t('usage.tile.cost')}</span>
      {note ? <small className="oc-faint" data-cost-note>{note}</small> : null}
    </div>
  )
}

/** The skeleton of the sections while nothing is read: the headings are the real ones, in their final order; the blocks say nothing. */
function Skeleton({ id, t }) {
  return (
    <>
      <div className="oc-us-top" data-usage-skeleton aria-hidden="true"><div className="oc-us-tiles">{[0, 1, 2, 3].map(k => <div key={k} className="oc-us-tile sk" />)}</div></div>
      <section className="oc-us-sec" aria-labelledby={`${id}-d`} data-usage-section="days"><h3 id={`${id}-d`}>{t('usage.days.title')}</h3><div className="oc-us-sk chart" aria-hidden="true" /></section>
      <section className="oc-us-sec" aria-labelledby={`${id}-a`} data-usage-section="agents"><h3 id={`${id}-a`}>{t('usage.agents.title')}</h3><div className="oc-us-sk rows" aria-hidden="true"><i /><i /><i /></div></section>
      <section className="oc-us-sec" aria-labelledby={`${id}-m`} data-usage-section="models"><h3 id={`${id}-m`}>{t('usage.models.title')}</h3><div className="oc-us-sk rows" aria-hidden="true"><i /><i /></div></section>
    </>
  )
}

function Days({ series, metric, t, selected, onSelect }) {
  const totals = series.map(d => d.parts?.total ?? null)
  const peak = peakOf(totals)
  const plotted = series.some(d => d.state === 'ok')
  const label = ms => new Date(ms).toLocaleDateString(t.lang, { weekday: 'short', day: 'numeric' })
  const sel = selected != null ? series[selected] : null
  return (
    <div data-usage-days>
      <div className="oc-us-chart">
      {/* the grid sits on two values, the highest day and its half, and says them: a line with no figure measures nothing */}
      {plotted ? <div className="oc-us-yaxis" aria-hidden="true" data-usage-axis><span className="top" data-usage-max>{tokenLabel(peak, t.lang)}</span><span className="mid">{tokenLabel(peak / 2, t.lang)}</span></div> : <span />}
      <div className="oc-us-days" role="group" aria-label={t('usage.days.title')} data-n={series.length} style={{ "--n": series.length }}>
        {series.map((d, i) => {
          const sparse = series.length > 10   // 30 days: the bars carry their value in the label of the button, the axis names every 5th day
          const axis = !sparse || (series.length - 1 - i) % 5 === 0
          const h = share(d.parts?.total ?? null, peak)
          const text = d.state === 'ok'
            ? `${t('usage.days.bar', label(d.fromMs), exactLabel(d.parts.total, t.lang))} (${t(`usage.metric.${metric}`)})`
            : d.state === 'none' ? t('usage.days.none', label(d.fromMs)) : t('usage.days.failed', label(d.fromMs))
          return (
            <button key={d.fromMs} type="button" className="oc-us-day" data-day-state={d.state} data-day-total={d.parts?.total ?? ''} aria-label={text} aria-pressed={selected === i} onClick={() => onSelect(selected === i ? null : i)}>
              <span className="oc-us-col" aria-hidden="true">
                {d.state === 'ok' ? (
                  <span className="oc-us-colfill" style={{ height: `${h * 100}%` }}>
                    {d.parts.cache ? <i className="s-cache" style={{ flexGrow: d.parts.cache }} /> : null}
                    {d.parts.output ? <i className="s-out" style={{ flexGrow: d.parts.output }} /> : null}
                    {d.parts.input ? <i className="s-in" style={{ flexGrow: d.parts.input }} /> : null}
                  </span>
                ) : <span className={`oc-us-gap${d.state === 'failed' ? ' fail' : ''}`} />}
              </span>
              <span className="oc-us-val" aria-hidden="true">{sparse ? null : d.state === 'ok' ? tokenLabel(d.parts.total, t.lang) : d.state === 'none' ? '·' : '?'}</span>
              <span className="oc-us-lab" aria-hidden="true">{axis ? (sparse ? new Date(d.fromMs).getDate() : label(d.fromMs)) : "\u00a0"}</span>
            </button>
          )
        })}
      </div>
      </div>
      <p className="oc-faint oc-us-daynote" role="status" data-usage-day-note>
        {sel
          ? (sel.state === 'ok'
            ? `${t('usage.days.detail', label(sel.fromMs), exactLabel(sel.parts.total, t.lang))} · ${t('usage.agents.calls', exactLabel(sel.calls, t.lang), exactLabel(sel.sessions, t.lang))}`
            : sel.state === 'none' ? t('usage.days.none', label(sel.fromMs)) : t('usage.days.failed', label(sel.fromMs)))
          : ''}
      </p>
    </div>
  )
}

function Quota({ quota, query, t, usage }) {
  const nowMs = Date.now()
  if (query.isError && !query.data) return <p className="oc-hint oc-dashed" data-usage-quota="error">{t('usage.quota.error')}</p>
  // the quota is asked of the providers the usage went through: until the usage is read there is no conclusion to draw (not even « none »)
  if (usage === 'error') return <p className="oc-hint oc-dashed" data-usage-quota="waiting">{t('usage.quota.needsUsage')}</p>
  if (!query.data || usage !== 'ok') return <p className="oc-hint" data-usage-quota="loading">{t('usage.loading')}</p>
  if (!query.data.options) return <p className="oc-hint oc-dashed" data-usage-quota="error">{t('usage.quota.error')}</p>
  const read = clockLabel(query.data.atMs, t.lang, { day: false })
  return (
    <div data-usage-quota={quota.groups.length ? 'ok' : 'absent'}>
      {quota.groups.map(g => (
        <div key={`${g.providers.join(',')}-${g.account ?? ''}`} className="oc-us-quota" data-quota-group={g.providers.join(',')}>
          <p className="oc-us-qhead"><b>{g.account ?? g.providers.join(' · ')}</b>{g.account ? <span className="oc-faint"> {g.providers.join(' · ')}</span> : null}</p>
          {g.windows.map(w => (
            <div key={w.label} className="oc-us-gauge" data-quota-window={w.label} data-percent={w.usedPercent}>
              <svg viewBox="0 0 44 44" className="oc-us-ring" role="img" aria-label={t('usage.quota.gauge', w.label, percentLabel(w.usedPercent))} data-level={w.usedPercent >= 90 ? 'high' : w.usedPercent >= 70 ? 'mid' : 'low'}>
                <circle cx="22" cy="22" r="18" className="r-track" />
                <circle cx="22" cy="22" r="18" className="r-fill" pathLength="100" strokeDasharray={`${Math.max(1, Math.min(100, w.usedPercent))} 100`} transform="rotate(-90 22 22)" />
                <text x="22" y="26" textAnchor="middle" className="r-pct">{percentLabel(w.usedPercent)}</text>
              </svg>
              <span className="oc-us-gl" title={w.label}>{w.label}{w.scope === 'model' ? ` · ${t('usage.quota.perModel')}` : ''}</span>
              <span className="oc-faint oc-us-reset">{w.resetsAtMs ? (w.resetsAtMs > nowMs ? t('usage.quota.resets', clockLabel(w.resetsAtMs, t.lang, { day: w.resetsAtMs - nowMs > 20 * 3_600_000 })) : t('usage.quota.resetPast')) : t('usage.quota.noReset')}</span>
            </div>
          ))}
        </div>
      ))}
      {!quota.groups.length ? <p className="oc-hint oc-dashed" data-usage-quota-none>{quota.missing.length ? t('usage.quota.none', quota.missing.join(', ')) : t('usage.quota.noRoute')}</p> : null}
      {quota.groups.length && quota.missing.length ? <p className="oc-faint">{t('usage.quota.some', quota.missing.join(', '))}</p> : null}
      <p className="oc-faint oc-us-read" data-usage-read>{t('usage.quota.readAt', read)}<DlgTip name={t('usage.quota.title')}>{t('usage.quota.note', read)}</DlgTip></p>
    </div>
  )
}

/**
 * « Resources »: what Hermes recorded about its use, as charts you can read (the days, the agents, the models, the boards, the
 * account's quota). Read-only: no order, no model call. Every figure names its source in the footer; one that Hermes did not record is
 * said absent, never 0 (src/core/usage.js). Shared frame (DialogKit): focus trap and Escape (dialogKeys), the page behind never scrolls.
 */
export function UsageDialog({ open, onClose, ctx, usageServed, replayServed }) {
  const t = useT()
  const id = useId()
  const [kind, setKind] = useState('24h')
  const [metric, setMetric] = useState('fresh')
  const [day, setDay] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => { if (open) setNowMs(Date.now()) }, [open])
  const on = Boolean(open && usageServed)
  const usage = useUsage(ctx, { enabled: on, kind })
  const days = useUsageDays(ctx, { enabled: on, kind })
  const boards = useReplay(ctx, { enabled: on && replayServed && boardsAvailable(kind), kind, night: DEFAULT_NIGHT, anchor: 0, poll: on })
  const quotaQ = useQuota({ enabled: on })
  const data = usage.data ?? null
  const agents = useMemo(() => (data ? agentRows(data, metric) : null), [data, metric])
  const models = useMemo(() => (data ? modelRows(data, metric) : null), [data, metric])
  const byBoard = useMemo(() => (boards.data ? boardRows(boards.data, metric) : null), [boards.data, metric])
  const series = useMemo(() => (days.data ? dailySeries(days.data, metric) : null), [days.data, metric])
  const quota = useMemo(() => (quotaQ.data?.options && data ? quotaOf(quotaQ.data.options, data.routes) : { groups: [], missing: [] }), [quotaQ.data, data])
  useQuotaRetry(quotaQ, quota.groups.length > 0)

  const win = usageWindow(kind, nowMs)
  const range = data ? rangeLabel(data.fromMs, data.toMs, t.lang) : ''
  const nf = n => exactLabel(n, t.lang)
  const tot = agents?.totals ?? null
  const agentPeak = agents ? peakOf(agents.rows.map(r => r.parts?.total ?? null)) : 1
  const modelPeak = models ? peakOf(models.rows.map(r => r.parts?.total ?? null)) : 1
  const boardPeak = byBoard ? peakOf(byBoard.rows.map(r => r.parts?.total ?? null)) : 1
  const balance = quotaQ.data?.balance ?? null
  const partial = data?.partial ?? []

  const windows = USAGE_WINDOWS.map(k => [k, t(`usage.win.${WIN_KEY[k]}`)])
  const metrics = USAGE_METRICS.map(m => [m, t(`usage.metric.${m}`), false, t(`usage.metricTip.${m}`)])
  const hasSplit = tot?.parts && (tot.parts.input || tot.parts.output || tot.parts.cache)
  const cost = useMemo(() => (data ? costTotal(data) : null), [data])

  return (
    <Dlg open={open} onClose={onClose} title={t('usage.title')} icon="usage" size="l" still backdrop focus="[data-usage-close]" closeProps={{ 'data-usage-close': '' }} data-usage-dialog
      onKeyDown={e => { if (escapeCloses(e)) { e.preventDefault(); e.stopPropagation(); onClose() } }}
      start={data ? <span className="oc-us-range"><span data-usage-range>{range}</span><DlgTip name={t('usage.window')}>{t('usage.range', range)}</DlgTip></span> : null}
      >
      <div className="oc-us-controls">
        <div className="oc-us-cl"><span className="oc-us-ct" data-usage-label="window">{t('usage.window')}</span><Seg label={t('usage.window')} items={windows} value={kind} attr="data-usage-window" onPick={k => { setKind(k); setDay(null) }} /></div>
        <div className="oc-us-cl"><span className="oc-us-ct" data-usage-label="metric">{t('usage.metricLabel')}</span><Seg label={t('usage.metricLabel')} items={metrics} value={metric} attr="data-usage-metric" onPick={setMetric} /></div>
        <ul className="oc-us-key" aria-label={t('usage.split')} data-usage-key>
          {['in', 'out', ...(metric === 'all' ? ['cache'] : [])].map(k => <li key={k}><i className={`s-${k}`} aria-hidden="true" />{t(`usage.part.${k === 'in' ? 'input' : k === 'out' ? 'output' : 'cache'}`)}</li>)}
        </ul>
      </div>
      {!usageServed ? <Notice tone="neutral" icon="info" data-usage-state="unserved">{t('usage.unserved')}</Notice> : null}
      {usageServed && !data && usage.isError ? <Notice tone="bad" icon="alert" data-usage-state="error">{t('usage.error')}</Notice> : null}
      {usageServed && !data && !usage.isError ? <p className="oc-dg-busy" role="status" data-usage-state="loading"><span className="oc-dg-spin" aria-hidden="true" />{t('usage.loading')}</p> : null}
      {usageServed && !data && !usage.isError ? <Skeleton id={id} t={t} /> : null}
      {data ? (
        <>
          {partial.length ? <Notice tone="warn" icon="alert" role="status" data-usage-partial>{t('usage.partial', partial.map(p => p.source).join(', '))}</Notice> : null}
          {!tot ? <Notice tone="neutral" icon="info" data-usage-none>{agents.absent ? t('usage.noneAbsent', agents.absent) : t('usage.none')}</Notice> : (
            <div className="oc-us-top">
              <div className="oc-us-tiles" role="group" aria-label={t('usage.title')}>
                {cost ? <CostTile cost={cost} t={t} /> : null}
                <Tile id="tokens" icon="tokens" value={tokenLabel(tot.parts?.total ?? null, t.lang)} exact={nf(tot.parts?.total ?? null)} label={t(`usage.tile.tokens.${metric}`)} note={tot.incomplete ? t('usage.incomplete') : null} t={t} />
                <Tile id="calls" icon="calls" value={nf(tot.calls)} exact={tot.calls != null ? String(tot.calls) : null} label={t('usage.tile.calls')} t={t} />
                <Tile id="sessions" icon="sessions" value={nf(tot.sessions)} exact={tot.sessions != null ? String(tot.sessions) : null} label={t('usage.tile.sessions')} t={t} />
              </div>
              {hasSplit ? <Donut parts={tot.parts} total={tokenLabel(tot.parts.total, t.lang)} t={t} /> : null}
            </div>
          )}

          <section className="oc-us-sec" aria-labelledby={`${id}-d`} data-usage-section="days">
            <h3 id={`${id}-d`}>{t('usage.days.title')} <small className="oc-faint" data-usage-days-span>· {t('usage.days.span', daysFor(kind))}</small><DlgTip name={t('usage.days.title')}>{t('usage.days.note')} {t('usage.days.hint')}</DlgTip></h3>
            {series ? <Days series={series} metric={metric} t={t} selected={day} onSelect={setDay} /> : <p className="oc-hint" data-usage-days-state={days.isError ? 'error' : 'loading'}>{days.isError ? t('usage.days.error') : t('usage.loading')}</p>}
          </section>

          <section className="oc-us-sec" aria-labelledby={`${id}-a`} data-usage-section="agents">
            <h3 id={`${id}-a`}>{t('usage.agents.title')}</h3>
            {agents.rows.length ? (
              <ul className="oc-us-rows">
                {agents.rows.map(r => (
                  <li key={r.profile} data-usage-agent={r.profile} data-agent-state={r.state}>
                    <b className="oc-us-name" title={r.profile}>{r.profile}</b>
                    <Bar parts={r.parts} peak={agentPeak} label={r.parts ? t('usage.exact', nf(r.parts.total)) : undefined} />
                    <span className="oc-us-num" title={r.parts ? t('usage.exact', nf(r.parts.total)) : undefined}>
                      {r.state === 'ok' ? (tokenLabel(r.parts?.total ?? null, t.lang) ?? t('usage.absent')) : r.state === 'none' ? t('usage.noSession') : t(`usage.reason.${r.reason ?? 'missing'}`)}
                    </span>
                    <span className="oc-faint oc-us-sub">
                      {r.state === 'ok' ? <>{t('usage.agents.calls', nf(r.calls), nf(r.sessions))} · <Cost cost={r.cost} t={t} /></> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Notice tone="neutral">{t('usage.agents.none')}</Notice>}
          </section>

          <section className="oc-us-sec" aria-labelledby={`${id}-m`} data-usage-section="models">
            <h3 id={`${id}-m`}>{t('usage.models.title')}<DlgTip name={t('usage.models.title')}>{t('usage.models.note')}</DlgTip></h3>
            {models.rows.length ? (
              <ul className="oc-us-rows">
                {models.rows.map(r => (
                  <li key={`${r.provider}|${r.model}`} data-usage-model={r.model}>
                    <b className="oc-us-name" title={`${r.model} · ${r.provider}`}>{r.model}</b>
                    <Bar parts={r.parts} peak={modelPeak} label={r.parts ? t('usage.exact', nf(r.parts.total)) : undefined} />
                    <span className="oc-us-num" title={r.parts ? t('usage.exact', nf(r.parts.total)) : undefined}>{tokenLabel(r.parts?.total ?? null, t.lang) ?? t('usage.absent')}</span>
                    <span className="oc-faint oc-us-sub">
                      {r.provider} · {t('usage.models.calls', nf(r.calls) ?? t('usage.absent'))}{r.auxCalls ? ` (${t('usage.models.aux', nf(r.auxCalls))})` : ''} · <Cost cost={r.cost} t={t} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Notice tone="neutral" data-usage-models-none>{models.withoutBreakdown ? t('usage.models.absent') : t('usage.models.none')}</Notice>}
          </section>
        </>
      ) : null}

      {usageServed ? (
        <section className="oc-us-sec" aria-labelledby={`${id}-b`} data-usage-section="boards">
          <h3 id={`${id}-b`}>{t('usage.boards.title')}<DlgTip name={t('usage.boards.title')}>{t('usage.boards.note')}</DlgTip></h3>
          {!boardsAvailable(kind) ? <Notice tone="neutral" data-usage-boards="range">{t('usage.boards.range')}</Notice>
            : !replayServed ? <Notice tone="neutral" data-usage-boards="unserved">{t('usage.boards.unserved')}</Notice>
            : !byBoard ? <p className="oc-hint" data-usage-boards="loading">{boards.isError ? t('usage.boards.error') : t('usage.loading')}</p>
            : byBoard.rows.length ? (
              <ul className="oc-us-rows" data-usage-boards="ok">
                {byBoard.rows.map(r => (
                  <li key={r.slug} data-usage-board={r.slug}>
                    <b className="oc-us-name" title={r.slug}>{r.slug}</b>
                    <Bar parts={r.parts} peak={boardPeak} label={r.parts ? t('usage.exact', nf(r.parts.total)) : undefined} />
                    <span className="oc-us-num" title={r.parts ? t('usage.exact', nf(r.parts.total)) : undefined}>{tokenLabel(r.parts?.total ?? null, t.lang) ?? (r.runs ? t('usage.absent') : t('usage.noRun'))}</span>
                    <span className="oc-faint oc-us-sub">
                      {t('usage.boards.runs', r.runs, r.with)}{r.without ? ` · ${t('usage.boards.without', r.without)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Notice tone="neutral" data-usage-boards="empty">{t('usage.boards.none')}</Notice>}
        </section>
      ) : null}

      {usageServed ? (
        <section className="oc-us-sec" aria-labelledby={`${id}-q`} data-usage-section="quota">
          <h3 id={`${id}-q`}>{t('usage.quota.title')}</h3>
          <Quota quota={quota} query={quotaQ} t={t} usage={data ? 'ok' : usage.isError ? 'error' : 'loading'} />
          {balance ? (
            <div className="oc-us-balance" data-usage-balance>
              <p><b>{t('usage.balance.title')}</b>{balance.plan ? ` · ${balance.plan}` : ''}<DlgTip name={t('usage.balance.title')}>{t('usage.balance.note')}</DlgTip></p>
              {balance.spendable ? <p>{t('usage.balance.spendable', balance.spendable)}</p> : null}
              {[['plan', balance.planBar], ['topup', balance.topupBar]].map(([k, b]) => (b ? (
                <div key={k} className="oc-us-bgauge" data-balance-bar={k}>
                  <span className="oc-us-gl">{t(`usage.balance.${k}`)}</span>
                  <span className="oc-us-track" role="img" aria-label={t(`usage.balance.${k}`)}><i style={{ width: `${b.fill * 100}%` }} data-level="low" /></span>
                  <span className="oc-faint oc-us-reset">{b.remaining ?? ''}{b.total ? ` / ${b.total}` : ''}</span>
                </div>
              ) : null))}
              {balance.renews ? <p className="oc-faint">{balance.renews}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <details className="oc-us-src" data-usage-section="sources">
        <summary>{t('usage.sources.title')}</summary>
        <ul className="oc-faint">
          <li>{t('usage.sources.recorded')}</li>
          <li>{t('usage.sources.window', win.kind ? t(`usage.win.${win.kind}`) : '')}</li>
          <li>{t('usage.sources.cost')}</li>
          <li>{t('usage.sources.refresh')}</li>
        </ul>
      </details>
    </Dlg>
  )
}
