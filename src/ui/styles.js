/**
 * Theme-driven styles only: every color is a CSS variable from the app theme.
 * `npm --prefix dev run check` fails the build on any literal color in the bundle.
 * The header, the alert rail, the stage, the dock and the cards have their own stylesheet (pageStyles.js); what stays here is
 * the page frame and the few inline styles the other windows still use.
 */

export const page = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  height: '100%',
  boxSizing: 'border-box', // padding inside the 100%: no phantom scrollbar
  minHeight: 0,
  overflow: 'hidden',
  position: 'relative', // anchors the settings sheet of a narrow pane
  padding: '12px 16px'
}

// tertiary measured 3.6:1 and quaternary 2.2:1 on the light page (the selection hint was the faintest text
// on screen); both now pass 4.5:1 in light and dark, and stay one step apart.
export const muted = { fontSize: '0.8rem', color: 'var(--ui-text-secondary)' }

