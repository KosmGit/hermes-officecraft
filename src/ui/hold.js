/**
 * One way to hold a control while a save or a call is out. `disabled` takes the focus away (a disabled control cannot keep it: the
 * keyboard lands on <body> and a screen reader says nothing); the control stays where it is, says `aria-disabled`, and its handler does
 * nothing until the answer is back (so nothing can be sent twice). A text field is `readOnly` too: it keeps the caret and refuses typing.
 *   <button {...held(busy)} onClick={hold(busy, run)}>   <select {...held(busy)} onChange={hold(busy, pick)}>   <textarea {...held(busy, { text: true })} />
 */

/** The handler, or a handler that ignores the gesture while `on`. */
export const hold = (on, fn) => (...args) => (on ? undefined : fn?.(...args))

/** The attributes of a held control (none when it is free, so the markup of a free control does not change). */
export const held = (on, { text = false } = {}) => (on ? { 'aria-disabled': true, ...(text ? { readOnly: true } : {}) } : {})
