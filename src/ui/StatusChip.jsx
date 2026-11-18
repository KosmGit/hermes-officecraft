import { host, Tip } from '@hermes/plugin-sdk'

import { ROUTE } from '../constants.js'
import { summarize } from '../core/roster.js'
import { CHIP_POLL_MS, useRoster } from '../data/queries.js'
import { useT } from './useT.js'

export function StatusChip() {
  const t = useT()
  const roster = useRoster(CHIP_POLL_MS)
  const desks = roster.data?.desks ?? []
  if (!roster.data?.ok || desks.length === 0) return null
  const counts = summarize(desks)

  const button = (
    <button
      type="button"
      onClick={() => host.navigate(ROUTE)}
      aria-label={t('chipTip')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: '100%',
        padding: '0 6px',
        font: 'inherit',
        fontSize: '0.6875rem',
        color: counts.working > 0 ? 'var(--ui-accent)' : 'var(--ui-text-tertiary)',
        background: 'transparent',
        border: 0,
        cursor: 'pointer'
      }}
    >
      {t('chip', counts.working, counts.total)}
    </button>
  )

  return typeof Tip === 'function' ? <Tip label={t('chipTip')}>{button}</Tip> : button
}
