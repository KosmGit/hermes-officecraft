/**
 * Shared look of the page's controls. Theme variables only: no literal colour.
 * Reference: Hermes' own `Button` and form controls (apps/desktop/src/components/ui/button.tsx, control.ts):
 * 12 px / weight 500 text, ring = border in the ring colour + a 3 px halo at 50 %.
 */

/** The elevated surface of the theme. `--card` does not exist in the webapp (it resolved to nothing: transparent), so the
 *  last fallback is an explicit system surface, never « no background ». */
export const CARD = 'var(--ui-bg-elevated, var(--card, Canvas))'
export const EDGE = 'var(--ui-stroke-secondary)'

/** The border of a FIELD (select, text, text area): it is the only thing that tells where the field ends, so it is darker
 *  than the hairline of the rest of the page (WCAG 1.4.11, 3:1 against the surface; the hairline measured 1.46:1). */
export const FIELD_EDGE = 'color-mix(in oklab, var(--foreground) 48%, var(--ui-bg-elevated, Canvas))'

/** The radius of Hermes' form controls (control.ts: rounded-[2.5px]). */
export const FIELD_RADIUS = '2.5px'

/** The focus ring of Hermes' controls (`focus-visible:border-ring ring-[3px] ring-ring/50`). The transparent outline is invisible on
 *  its own and is what remains in forced-colors mode, which drops box-shadow and border colours (`outline:none` left no ring at all). */
export const RING = 'var(--dt-ring, var(--ring, var(--ui-accent)))'
export const RING_FOCUS = `outline:2px solid transparent;border-color:${RING};box-shadow:0 0 0 3px color-mix(in oklab, ${RING} 50%, transparent)`

/** Radius and weight of Hermes' buttons (icon buttons: 4 px radius; text: 500). */
export const BTN_RADIUS = '4px'
export const BTN_WEIGHT = 500

/** The focus ring of a field that only has an inline style (the settings selects): injected once by SettingsForm, on the page and on Hermes' settings page. */
export const FIELD_CSS = `.oc-fc:focus-visible{outline:2px solid transparent;border-color:${RING} !important;box-shadow:0 0 0 3px color-mix(in oklab, ${RING} 50%, transparent)}`   // !important: the select's border is an inline style

/** A sunken well and the text colour over a plain accent fill. The host has no `--ui-bg-sunken` / `--ui-accent-fg` everywhere: both fall back on the text colour mixed in, never on a literal colour. */
export const SUNKEN = 'var(--ui-bg-sunken, color-mix(in oklab, var(--foreground) 7%, transparent))'
export const ON_ACCENT = 'var(--ui-accent-fg, var(--background, Canvas))'
/** The hue of what a model wrote. The host has no `--ui-violet` but has `--ui-purple`, a pastel (2.7:1 on white, grey once darkened): mixed in oklch with the host's blue turned 19 % toward its red (same hue, the chroma the pastel lacks), then 12 % toward the text colour; theme variables only. Without it everything a model wrote took the accent, which already says focus, selection and the main button. */
export const VIOLET = 'var(--ui-violet, color-mix(in oklab, color-mix(in oklch, var(--ui-purple, var(--ui-accent)), color-mix(in oklch, var(--ui-blue, var(--ui-accent)) 81%, var(--ui-red, var(--ui-accent)))) 88%, var(--foreground)))'

/** The hue of a bot that waits for a colleague (state « queued »): calm and cool, neither the orange of what waits for the user nor the blue of the work (the accent) nor the green of a session. A teal between the host's green and its accent; theme variables only (without `--ui-green` it falls back on the accent: the sign and the word still tell the state). */
export const COOL = 'color-mix(in oklch, var(--ui-green, var(--ui-accent)) 50%, var(--ui-accent))'
