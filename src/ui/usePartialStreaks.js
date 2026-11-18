import { useRef } from 'react'

import { toPartial } from '../core/history.js'
import { nextStreaks } from '../core/page.js'

/**
 * For each source named in `partial`, in how many reads IN A ROW of this route it was named (src/core/page.js nextStreaks).
 * `data` / `dataUpdatedAt` come from the route's query: the count moves once per answer, not once per render.
 */
export function usePartialStreaks(data, dataUpdatedAt) {
  const ref = useRef({ at: 0, streaks: new Map() })
  if (data && dataUpdatedAt && dataUpdatedAt !== ref.current.at) ref.current = { at: dataUpdatedAt, streaks: nextStreaks(ref.current.streaks, toPartial(data.partial) ?? []) }
  return ref.current.streaks
}
