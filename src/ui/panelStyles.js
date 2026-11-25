/**
 * Stylesheet of the side panel (inspector, decisions waiting, chains, journal) and of the page frame around it.
 * Theme variables only: no literal colour (those live in src/scene/). Shaped for a pane that may be 380 px wide.
 */
import { BTN_RADIUS, CARD, EDGE, FIELD_EDGE, FIELD_RADIUS, RING_FOCUS } from './tokens.js'

// same secondary text as the scene HUD (holds 4.5:1 on the card background, both themes)
const SOFT = 'color-mix(in oklab, var(--ui-text-secondary) 60%, var(--ui-text-tertiary))'
const ink = hue => `color-mix(in oklab, ${hue} 50%, var(--foreground))`
const ORANGE = 'var(--ui-orange, var(--ui-accent))'
const GREEN = 'var(--ui-green, var(--ui-accent))'
const RED = 'var(--ui-red, var(--destructive, var(--ui-orange)))'

export const PANEL_CSS = `
.oc-panel{flex:0 0 340px;width:340px;min-width:0;min-height:0;display:flex;flex-direction:column;box-sizing:border-box;border:1px solid ${EDGE};border-radius:12px;background:${CARD};color:var(--foreground);overflow:hidden}
.oc-panel.oc-drawer{position:absolute;top:0;right:0;bottom:0;z-index:40;width:min(360px,100%);flex:none;box-shadow:0 8px 28px color-mix(in oklab, var(--foreground) 28%, transparent);animation:oc-slide .16s ease-out}
@keyframes oc-slide{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion: reduce){.oc-panel.oc-drawer{animation:none}}
.oc-phead{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px 8px 14px;border-bottom:1px solid ${EDGE}}
.oc-phead h2{margin:0;font-size:13px;font-weight:600;outline:none}
.oc-x{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid ${EDGE};border-radius:${BTN_RADIUS};background:transparent;color:var(--foreground);cursor:pointer}
.oc-x:hover{border-color:var(--ui-accent)}
.oc-pbody:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
/* the focus ring of Hermes' buttons (border in the ring colour + 3 px halo), radius 4 px, weight 500 */
.oc-x:focus-visible,.oc-btn:focus-visible,.oc-toggle:focus-visible,.oc-gear:focus-visible,.oc-legend-btn:focus-visible,.oc-btn-open:focus-visible,.oc-gbtn:focus-visible{${RING_FOCUS}}
.oc-btn-open{font-weight:500}
/* skip link, first stop of the page; invisible until the keyboard reaches it, then over the header */
.oc-skip:not(:focus){position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.oc-skip:focus{position:absolute;z-index:60;top:8px;left:50%;transform:translateX(-50%);padding:6px 14px;font-size:12px;font-weight:500;text-decoration:none;color:var(--foreground);background:${CARD};border:1px solid var(--ui-accent);border-radius:4px;box-shadow:0 4px 14px color-mix(in oklab, var(--foreground) 24%, transparent);outline:2px solid var(--ui-accent);outline-offset:2px}
.oc-pbody{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:12px 14px 16px;display:flex;flex-direction:column;gap:16px;overscroll-behavior:contain}
.oc-pbody > *{flex:0 0 auto}
.oc-psec h3{display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:${SOFT}}
.oc-count{display:inline-flex;min-width:16px;justify-content:center;padding:0 5px;border-radius:999px;background:color-mix(in oklab, ${ORANGE} 20%, transparent);color:${ink(ORANGE)};font-size:11px;letter-spacing:0}
.oc-hint{margin:0;font-size:12px;color:${SOFT}}
.oc-dashed{padding:8px 10px;border:1px dashed ${EDGE};border-radius:8px}
.oc-faint{font-size:11px;color:${SOFT}}
.oc-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
/* five tiles on a 6-column grid, 3 then 2 (no empty cell; the wider second row holds « Cartes ouvertes » / « Tarjetas abiertas ») */
.oc-stat{grid-column:span 2;display:flex;flex-direction:column;gap:1px;padding:6px 8px;border:1px solid ${EDGE};border-radius:8px;min-width:0}
.oc-stat:nth-child(n+4){grid-column:span 3}
.oc-stat b{font-size:1.05rem;font-variant-numeric:tabular-nums}
.oc-stat b small{font-size:.7em;font-weight:400;opacity:.8}
.oc-stat span{font-size:11px;color:${SOFT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oc-stat.hot{border-color:color-mix(in oklab, var(--ui-accent) 60%, ${EDGE})}
.oc-stat.warn{border-color:${ORANGE}}
.oc-stat.warn b{color:${ink(ORANGE)}}
.oc-portrait{flex:0 0 auto;width:56px;height:60px;image-rendering:pixelated;image-rendering:crisp-edges;border-radius:8px;border:1px solid ${EDGE};background:color-mix(in oklab, var(--ui-accent) 8%, transparent)}
.oc-tag{display:inline-block;padding:0 7px;border:1px solid ${EDGE};border-radius:999px;font-size:11px;font-weight:600;color:var(--foreground)}
.oc-t-working{border-color:var(--ui-accent);color:${ink('var(--ui-accent)')}}
.oc-t-waiting,.oc-warnt{border-color:${ORANGE};color:${ink(ORANGE)}}
.oc-t-active{border-color:color-mix(in oklab, ${GREEN} 60%, ${EDGE})}
.oc-t-stale{border-style:dashed;color:${SOFT}}
.oc-pin{display:inline-block;flex:0 0 auto;color:${ink('var(--ui-accent)')};vertical-align:-1px}
.oc-btn{display:inline-block;padding:5px 12px;font:inherit;font-size:12px;font-weight:500;color:var(--foreground);background:${CARD};border:1px solid var(--ui-accent);border-radius:${BTN_RADIUS};cursor:pointer}
.oc-btn[aria-disabled="true"]{opacity:.5;cursor:default}
.oc-psec p.oc-faint{margin:6px 0 0}
/* 6.75rem holds « il y a 26 minutes » / « hace 26 minutos » (5.5rem would clip them) */
.oc-gear{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;color:var(--foreground);background:${CARD};border:1px solid ${EDGE};border-radius:${BTN_RADIUS};cursor:pointer}
.oc-gear:hover,.oc-gear[aria-expanded="true"]{border-color:var(--ui-accent)}
/* legend of the halos, a named button at the end of the dock, its card opening upwards over the scene edge */
.oc-legend{position:relative;flex:0 0 auto;margin-left:auto}
.oc-legend-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 8px;font:inherit;font-size:12px;font-weight:500;line-height:1;white-space:nowrap;color:var(--foreground);background:${CARD};border:1px solid ${EDGE};border-radius:${BTN_RADIUS};cursor:pointer}
.oc-legend-btn:hover,.oc-legend-btn[aria-expanded="true"]{border-color:var(--ui-accent)}
.oc-legend-pop{position:absolute;right:0;bottom:calc(100% + 8px);z-index:40;box-sizing:border-box;width:max-content;max-width:min(340px,calc(100vw - 24px));padding:8px 10px;border-radius:10px;background:${CARD};border:1px solid var(--ui-accent);box-shadow:0 2px 8px color-mix(in oklab, var(--foreground) 22%, transparent);font-size:11.5px;line-height:1.35;color:var(--foreground)}
.oc-legend-pop b{display:block;margin-bottom:5px;font-size:11px;font-weight:600;color:${SOFT}}
.oc-legend-pop ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.oc-legend-pop li{display:grid;grid-template-columns:12px 9px max-content 1fr;align-items:baseline;column-gap:7px}
.oc-lg-sti{align-self:center;display:flex;color:var(--foreground)}
.oc-sw{align-self:center;width:10px;height:10px;display:block;box-sizing:border-box}
.oc-sw-none{border:1.5px solid var(--ui-text-tertiary);border-radius:50%}
.oc-lg-sti.oc-lg-wait{color:${ink(ORANGE)}}
.oc-lg-name{font-weight:600}
.oc-lg-hint{color:${SOFT}}
.oc-icon{flex:0 0 auto;image-rendering:pixelated;image-rendering:crisp-edges}
.oc-announce{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* the decision box. Risk = text + colour (theme variables); the bar of the order in flight floats over the bottom of the page */
.oc-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.oc-ord{padding:3px 8px;font-size:11.5px;line-height:1.5}
.oc-ord[aria-disabled="true"],.oc-btn[aria-disabled="true"]{opacity:.55}
.oc-btn.oc-primary{background:color-mix(in oklab, var(--ui-accent) 14%, ${CARD})}
/* 11 px like every other text; the class also reads without colour: a shape before the word (hollow circle = safe,
   half circle = reversible, solid triangle = final) and a final tag is filled, a safe one is not */
/* the card (or approval) an order counts down / travels for keeps a mark while the bar names it */
/* approvals in the decision box (an approval row = who + session, Hermes' one-line summary, age, the allowed answers with their risk) */
.oc-ordnote{margin:0;font-size:11px;color:${ink(RED)}}
/* under the floating bar the refusal (« another order is waiting ») has its own background, so it never runs over the page's hint line */
.oc-ordbar .oc-ordnote{padding:5px 12px;border:1px solid ${EDGE};border-radius:8px;background:${CARD}}
/* while the bar floats over the foot of the panel (drawer at 1024 / 380 px), the panel can scroll its last rows above it */
.ux-main:has(.oc-ordbar) .ux-pbody{padding-bottom:140px;scroll-padding-bottom:140px}
.oc-ordbar{position:absolute;left:50%;bottom:12px;z-index:45;transform:translateX(-50%);box-sizing:border-box;width:min(560px,calc(100% - 24px));display:flex;flex-direction:column;gap:4px}
@keyframes oc-drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}
@keyframes oc-turn{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.oc-drain{display:none}.oc-spin{animation:none;border-top-color:var(--ui-accent);border-right-color:var(--ui-accent)}}
/* done / failed / cancelled also differ by shape (tick, solid triangle, hollow circle), not only by the word and the colour */
/* the recruitment window (native <dialog>: focus trap and Escape for free). Theme variables only. */
/* no font-size of our own on fields: the host sizes them (16 px minimum in the browser, inherited in the app). A size of ours would beat
   the host on <input> but not on <textarea>/<select>, and one form would mix two field sizes */
/* a skill's box stays on the line of its name (a long name must not wrap under its own checkbox) */
.oc-hermesmsg{padding:6px 8px;border:1px dashed ${EDGE};border-radius:8px}
@media (pointer:coarse){
  .oc-gear,.oc-x{width:40px;height:40px}
  .oc-legend-btn{position:relative}
  .oc-legend-btn::after{content:"";position:absolute;inset:-9px}
}
`
