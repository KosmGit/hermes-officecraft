/**
 * Escape for the plugin's native modal windows. The browser turns Escape into the dialog's `cancel` event only when nobody
 * called preventDefault() on the keydown; under 900 px the host's webapp does (a bare <dialog> there cannot be closed by Escape
 * either), so each window reads the key itself and closes through its own path. Escape that ends an input-method composition or
 * comes with a modifier is not a close.
 */
export const escapeCloses = e => Boolean(e) && e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing
