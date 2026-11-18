/* Project colours: 8 fixed hues, given by the board's CREATION RANK (never by the order the boards are listed in).
   The island's rug in the scene and every project chip of the interface use the same hue; the interface gets it from here as a CSS colour
   (the only place outside the scene art where a colour is written: src/scene/ is the palette). Pure: no DOM, no clock. */
import { hash } from './util.js'

/** Eight hues far enough apart to tell neighbours apart on the rug and as a 8 px dot. Order = creation rank. */
export const PROJECT_HUES = Object.freeze([178, 330, 45, 268, 95, 12, 230, 300])

/** slug -> rank (0 = oldest board). Oldest first by creation time, then by slug: stable between polls whatever order the boards come in. */
export function projectRanks(boards) {
  const list = [...(boards || [])].map(b => ({ slug: b.slug, at: Number(b.createdMs ?? b.createdAt ?? 0) || 0 }))
  list.sort((p, q) => p.at - q.at || String(p.slug).localeCompare(String(q.slug), 'en'))
  return new Map(list.map((b, i) => [b.slug, i]))
}

/** The hue of a board: its rank's fixed hue (the 9th board starts the palette again), or the old hash for a slug that has no rank. */
export const hueOfSlug = (slug, ranks) => (ranks?.has(slug) ? PROJECT_HUES[ranks.get(slug) % PROJECT_HUES.length] : hash(`${slug}@0`) % 360)

/** CSS colour of a hue, for the dots, stripes and rings of the interface. Light enough on the dark theme, dark enough on the light one. */
export const projectColor = hue => `hsl(${hue} 55% 48%)`

/**
 * What the project filter washes in the scene. With a project chosen, every island of another
 * project and the common room (nobody there belongs to the project). No filter, or a project the scene does not know: nothing is washed.
 * -> null | { boards: [slug], hall: true }, in the layout's order.
 */
export function dimOf(project, layout) {
  if (!project || !layout?.pods?.some(p => p.b.slug === project)) return null
  return { boards: layout.pods.map(p => p.b.slug).filter(s => s !== project), hall: true }
}

/** { slug -> CSS colour } for a list of boards. */
export function projectColors(boards) {
  const ranks = projectRanks(boards)
  return new Map([...ranks.keys()].map(slug => [slug, projectColor(hueOfSlug(slug, ranks))]))
}

/* The colour of a BOT in the campaign preview (one hue per bot, by its rank in the roster, so the same bot keeps its colour everywhere in
   the editor). 10 hues, the guards' orange (15-55 degrees) left out; the character's outfit would give 5 bots out of 7 near-black or
   brown, unreadable on a 4 px stripe. A bot beyond the tenth takes the hues again, a name with no rank gets a hash hue. */
export const BOT_HUES = Object.freeze([[212, 70, 52], [145, 55, 42], [275, 55, 58], [355, 70, 55], [185, 70, 40], [75, 60, 40], [305, 60, 48], [230, 35, 40], [165, 45, 30], [0, 0, 50]])

/** name -> CSS colour of that bot, for the names of the roster in the order given (the caller sorts them: the same roster gives the same colours). */
export function botColors(names) {
  const out = new Map()
  ;[...(names || [])].forEach((name, i) => { const [h, s, l] = BOT_HUES[i % BOT_HUES.length]; out.set(name, `hsl(${h} ${s}% ${l}%)`) })
  return out
}

/** The colour of the next project to be created: the hue of the next creation rank, so the new project's chip already wears its island's colour. */
export const nextProjectColor = boards => projectColor(PROJECT_HUES[(boards?.length || 0) % PROJECT_HUES.length])
