/**
 * The postcard: the drawing of the office alone, as a PNG. No HUD, no name, no card title, no text.
 * The pixels come from `drawScene` itself (never from the page's canvas or DOM), so what the HUD overlays can never leak in:
 * labels, tooltips and the selection ring are HTML or model state, and the model is drawn here with no selection.
 *   postcardBuffer(layout, model, frame?)  pure, runs under node: { W, H, d } RGBA, exactly the canvas size
 *   savePostcard(buffer, name)             browser only: PNG -> download link
 */
import { buildBase, drawScene } from '../scene/index.js'

export function postcardBuffer(layout, model, frame = 0) {
  const base = buildBase(layout, model)
  const px = drawScene(layout, base, { ...model, selected: null }, frame)
  return { W: px.W, H: px.H, d: px.d }
}

/** `officecraft-2026-11-09.png`: the date is in the file name only, never in the picture. It is the user's calendar day, not the UTC one. */
export const postcardName = nowMs => {
  const d = new Date(nowMs)
  const two = n => String(n).padStart(2, '0')
  return `officecraft-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.png`
}

/** Encode the buffer as a PNG and hand it to the user through a download link. Resolves the link's file name, or null. */
export function savePostcard(buffer, name) {
  return new Promise(resolve => {
    try {
      const cv = document.createElement('canvas')
      cv.width = buffer.W
      cv.height = buffer.H
      cv.getContext('2d').putImageData(new ImageData(buffer.d, buffer.W, buffer.H), 0, 0)
      cv.toBlob(blob => {
        if (!blob) { resolve(null); return }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.rel = 'noopener'
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        resolve(name)
      }, 'image/png')
    } catch {
      resolve(null)
    }
  })
}
