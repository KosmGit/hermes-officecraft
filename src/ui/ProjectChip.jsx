import { createContext, useContext, useMemo } from 'react'

import { projectColors } from '../scene/index.js'

/**
 * The project (board) of a card, a group, an event, an island: a coloured square + its name, everywhere the same.
 * The colour is the island's rug (src/scene/projects.js: 8 fixed hues by creation rank). The page provides the map once; a slug with no
 * board (an agent in the common room) has no colour and no chip. The colour is only ever a hint: the name is always written next to it.
 */
const Colors = createContext(new Map())
export const ProjectColors = Colors.Provider

/** slug -> CSS colour for the boards of the office (memoised on their slugs and creation dates). */
export function useProjectColors(boards) {
  const key = (boards || []).map(b => `${b.slug}@${b.createdMs ?? 0}`).join('|')
  return useMemo(() => projectColors(boards), [key])   // eslint-disable-line react-hooks/exhaustive-deps
}

/** The inline style that carries a project's colour (`--pc`) for the stylesheet; neutral for no project. */
export function useProjectStyle(slug) {
  const colors = useContext(Colors)
  return slug && colors.get(slug) ? { '--pc': colors.get(slug) } : { '--pc': 'var(--ui-text-tertiary)' }
}

/** A project chip: square + name (never the colour alone), ellipsised when long (the whole name is the tooltip). */
export function ProjectChip({ slug, label = '', className = '' }) {
  const style = useProjectStyle(slug)
  if (!slug) return null
  return (
    <span className={`ux-prj${className ? ` ${className}` : ''}`} style={style} title={label ? `${label} ${slug}` : slug} data-project={slug}>
      <i aria-hidden="true" />
      <span>{slug}</span>
    </span>
  )
}
