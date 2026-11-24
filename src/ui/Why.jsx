import { useEffect, useId, useState } from 'react'

/**
 * The reason a button cannot be used right now (it stays focusable and says `aria-disabled`). The reason is read with the button
 * (aria-describedby on a hidden sentence), and a click, a tap or Enter on it shows the same sentence in a status line instead of doing
 * nothing; a `title` alone reaches neither the keyboard nor a finger.
 */
export function useWhy(reason) {
  const id = useId()
  const [said, setSaid] = useState(false)
  useEffect(() => { if (!reason) setSaid(false) }, [reason])
  useEffect(() => {
    if (!said) return undefined
    const timer = setTimeout(() => setSaid(false), 8000)
    return () => clearTimeout(timer)
  }, [said])
  return {
    describedBy: reason ? id : undefined,
    say: () => setSaid(true),
    note: reason ? (
      <>
        <span id={id} className="ux-vh">{reason}</span>
        {said ? <small className="ux-why" role="status" data-why>{reason}</small> : null}
      </>
    ) : null
  }
}

/**
 * A button that may be unavailable. `reason` is '' / null when it works (then `onGo` runs); otherwise the button is aria-disabled and
 * a click says the reason. The status line follows the button (put the button where a sibling may sit beside it).
 */
export function WhyButton({ reason, onGo, buttonRef, children, ...rest }) {
  const why = useWhy(reason)
  return (
    <>
      <button ref={buttonRef} type="button" {...rest} aria-disabled={reason ? true : undefined} aria-describedby={why.describedBy} onClick={() => (reason ? why.say() : onGo())}>{children}</button>
      {why.note}
    </>
  )
}
