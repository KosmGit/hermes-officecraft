import { clockLabel, cronsTile } from '../core/replay.js'

const TILES = [
  ['runs', 'start', ''],
  ['done', 'done', 'done'],
  ['blocked', 'block', 'block'],
  ['unblocked', 'unblock', ''],
  ['failures', 'fail', 'fail'],
  ['silences', 'silence', '']
]

/** Facts per hour: completed, blocked, failures stacked. Bars only where something happened; the numbers are in the tiles. */
function Chart({ buckets, label }) {
  const top = Math.max(1, ...buckets.map(b => b.done + b.blocked + b.failures))
  const n = buckets.length
  return (
    <svg className="oc-nt-chart" viewBox={`0 0 ${n} 20`} preserveAspectRatio="none" role="img" aria-label={label}>
      {buckets.map((b, i) => {
        const sum = b.done + b.blocked + b.failures
        if (!sum) return null
        const h = Math.max(2, (sum / top) * 18)
        let y = 20
        const seg = (cls, v) => {
          if (!v) return null
          const hh = (v / sum) * h
          y -= hh
          return <rect key={cls} className={cls} x={i + 0.08} y={y} width={0.84} height={hh} />
        }
        return <g key={i}>{seg('d-done', b.done)}{seg('d-block', b.blocked)}{seg('d-fail', b.failures)}</g>
      })}
    </svg>
  )
}

/**
 * « What happened this night »: the counted summary of a window (src/core/replay.js nightSummary). Counts of recorded facts, each
 * one a button that opens the facts behind it. A datum Hermes did not record (usage of a run) is said absent, never counted as 0.
 * `onShow(group)` shows the facts of that group (and enters the replay when the page is live); `onReplay` replays the whole window.
 */
export function NightCard({ summary, kind = 'night', t, onShow = null, onReplay = null, headingId = 'oc-h-night' }) {
  const nf = new Intl.NumberFormat(t.lang)
  const compact = new Intl.NumberFormat(t.lang, { notation: 'compact', maximumFractionDigits: 1 })
  const day = summary.to - summary.from > 20 * 3_600_000
  const label = ms => clockLabel(ms, t.lang, { day })
  const o = summary.orders
  const cron = cronsTile(summary.crons)
  const tiles = [
    ...TILES.map(([key, group, tone]) => [key, group, tone, summary[key], t(`replay.night.${key}`)]),
    ['orders', 'order', '', o.total, t('replay.night.orders'), o.total ? t('replay.night.ordersDetail', o.done, o.refused, o.failed) : ''],
    ['crons', 'cron', cron.tone, cron.n, t(cron.label), cron.total ? t('replay.night.cronsOf', cron.total) : '']
  ]
  const peak = Math.max(1, ...summary.byProfile.map(p => p.runs))
  const u = summary.usage
  return (
    <section className="oc-psec oc-nt" aria-labelledby={headingId} data-night data-empty={summary.empty ? '' : undefined}>
      <h3 id={headingId}>{t(kind === 'night' ? 'replay.night.title' : `replay.windowKind.${kind}`)}</h3>
      <div className="oc-nt-head">
        <span className="oc-faint" data-night-range>{t('replay.night.range', label(summary.from), label(summary.to))}</span>
        {summary.ongoing ? <span className="oc-tag" data-night-ongoing>{t('replay.night.ongoing')}</span> : null}
      </div>
      {summary.empty ? <p className="oc-hint oc-dashed" data-night-none>{t('replay.night.none')}</p> : (
        <>
          <div className="oc-nt-grid" role="group" aria-label={t('replay.night.title')}>
            {tiles.map(([key, group, tone, n, text, detail]) => {
              const can = onShow && n > 0
              return (
                <button
                  key={key}
                  type="button"
                  className="oc-nt-tile"
                  data-night-count={key}
                  data-tone={tone || undefined}
                  disabled={!can}
                  title={can ? t('replay.night.show') : undefined}
                  onClick={can ? () => onShow(group) : undefined}
                >
                  <b>{nf.format(n)}</b>
                  <span>{text}{detail ? ` · ${detail}` : ''}</span>
                </button>
              )
            })}
          </div>
          {summary.buckets.some(b => b.done || b.blocked || b.failures) ? (
            <>
              <Chart buckets={summary.buckets} label={t('replay.night.chart')} />
              <div className="oc-nt-ends" aria-hidden="true"><span>{label(summary.from)}</span><span>{label(summary.to)}</span></div>
            </>
          ) : null}
          {summary.byProfile.length ? (
            <div data-night-agents>
              <h4 className="oc-faint" style={{ margin: '4px 0' }}>{t('replay.night.byAgent')}</h4>
              <ul className="oc-nt-agents">
                {summary.byProfile.slice(0, 8).map(p => (
                  <li key={p.profile ?? '—'} data-profile={p.profile ?? ''}>
                    <b title={p.profile ?? undefined}>{p.profile ?? '—'}</b>
                    <span className="oc-nt-bar" data-runs={p.runs} style={{ width: `${Math.max(4, (p.runs / peak) * 100)}%` }} aria-hidden="true" />
                    <span className="oc-faint">{t('replay.night.agentRuns', p.runs, p.calls == null ? null : nf.format(p.calls))}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {summary.runs ? (
            <div data-night-usage>
              <h4 className="oc-faint" style={{ margin: '4px 0' }}>{t('replay.night.usage')}</h4>
              <p className="oc-hint">{u.runsWith ? t('replay.night.usageLine', nf.format(u.calls), compact.format(u.input), compact.format(u.output)) : t('replay.night.usageNone')}</p>
              {u.runsWith && u.runsWithout ? <p className="oc-faint">{t('replay.night.usageMissing', u.runsWithout)}</p> : null}
              <p className="oc-faint">{t('replay.night.usageNote')}</p>
            </div>
          ) : null}
        </>
      )}
      {summary.since.map(s => <p key={s.slug} className="oc-faint" data-night-since={s.slug}>{t('replay.night.since', s.slug, label(s.sinceMs))}</p>)}
      {summary.truncatedAt ? <p className="oc-faint" data-night-truncated>{t('replay.night.truncated', label(summary.truncatedAt))}</p> : null}
      {onReplay ? <button type="button" className="oc-btn oc-nt-go" data-night-replay onClick={onReplay}>{t('replay.night.replay')}</button> : null}
      <p className="oc-faint">{t('replay.night.refresh')}</p>
    </section>
  )
}
