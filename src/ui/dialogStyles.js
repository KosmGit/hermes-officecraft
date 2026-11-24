/**
 * The look of the plugin's windows (recruitment, Decorator, Seating, Resources): one frame, the parts they share. Theme variables
 * only; sizes on the 4 px grid (hairlines excepted); the page behind never scrolls, only the body of a window does.
 */
import { BTN_RADIUS, CARD, EDGE, FIELD_EDGE, FIELD_RADIUS, RING_FOCUS } from './tokens.js'

const SOFT = 'color-mix(in oklab, var(--ui-text-secondary) 60%, var(--ui-text-tertiary))'
const ORANGE = 'var(--ui-orange, var(--ui-accent))'
const GREEN = 'var(--ui-green, var(--ui-accent))'
const VIOLET = 'var(--ui-violet, color-mix(in oklab, color-mix(in oklch, var(--ui-purple, var(--ui-accent)), color-mix(in oklch, var(--ui-blue, var(--ui-accent)) 81%, var(--ui-red, var(--ui-accent)))) 88%, var(--foreground)))'
const VIOLET_INK = 'color-mix(in oklab, var(--ui-violet, color-mix(in oklab, color-mix(in oklch, var(--ui-purple, var(--ui-accent)), color-mix(in oklch, var(--ui-blue, var(--ui-accent)) 81%, var(--ui-red, var(--ui-accent)))) 88%, var(--foreground))) 65%, var(--foreground))'   // legible text on the 13 % violet wash, both themes
const RED = 'var(--ui-red, var(--destructive, var(--ui-orange)))'
const ink = hue => `color-mix(in oklab, ${hue} 50%, var(--foreground))`
const RINGED = sel => `${sel}{${RING_FOCUS}}`

/** The « ? » of a line and its note: shared by the windows and by the replay bar. */
export const TIP_CSS = `
/* the « ? » of a line and its note */
.oc-dg-tipw{position:relative;display:inline-flex;vertical-align:middle}
.oc-dg-help{flex:0 0 auto;display:inline-grid;place-items:center;box-sizing:border-box;width:24px;height:24px;padding:0;border:1px solid ${EDGE};border-radius:12px;background:transparent;color:var(--ui-text-secondary);font:inherit;font-size:11px;font-weight:700;cursor:pointer}
.oc-dg-help:hover,.oc-dg-help[aria-expanded="true"]{border-color:var(--ui-accent);color:var(--foreground)}
${RINGED('.oc-dg-help:focus-visible')}
.oc-dg-tip{position:absolute;z-index:6;left:0;top:calc(100% + 4px);box-sizing:border-box;width:max-content;max-width:min(280px,calc(100vw - 48px));padding:12px;border:1px solid ${EDGE};border-radius:8px;background:${CARD};color:var(--ui-text-secondary);font-size:12px;font-weight:400;line-height:1.45;text-align:left;text-transform:none;letter-spacing:0;box-shadow:0 10px 30px color-mix(in oklab, var(--foreground) 18%, transparent)}
.oc-dg-tip.up{top:auto;bottom:calc(100% + 4px)}
`

const DIALOG_HEAD = `
.oc-dg{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(640px,calc(100vw - 32px));max-height:min(760px,calc(100dvh - 32px));padding:0;border:1px solid ${EDGE};border-radius:12px;background:${CARD};color:var(--foreground);font-size:12px;box-shadow:0 24px 60px color-mix(in oklab, var(--foreground) 28%, transparent);overflow:hidden}
.oc-dg-s{width:min(480px,calc(100vw - 32px))}
.oc-dg-l{width:min(760px,calc(100vw - 32px))}
.oc-dg[open]{display:flex;flex-direction:column;animation:oc-dg-in .18s ease both}
.oc-dg[data-still][open],.oc-dg[data-motion="reduced"][open]{animation:none}
@keyframes oc-dg-in{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.oc-dg[open]{animation:none}}
.oc-dg::backdrop{background:color-mix(in oklab, var(--foreground) 42%, transparent)}
.oc-dg-frame{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;max-height:inherit}
/* header: icon, title, risk, close */
.oc-dg-h{flex:0 0 auto;display:flex;align-items:center;gap:12px;box-sizing:border-box;min-height:56px;padding:12px 16px;border-bottom:1px solid ${EDGE}}
.oc-dg-ico{flex:0 0 auto;display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;color:var(--ui-accent);background:color-mix(in oklab, var(--ui-accent) 12%, transparent)}
.oc-dg-h h2{margin:0;min-width:0;font-size:16px;font-weight:600;line-height:1.25;overflow-wrap:anywhere}
.oc-dg-x{flex:0 0 auto;margin-left:auto;display:inline-grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:${BTN_RADIUS};background:transparent;color:var(--ui-text-secondary);cursor:pointer}
.oc-dg-x:hover{background:color-mix(in oklab, var(--foreground) 8%, transparent);color:var(--foreground)}
${RINGED('.oc-dg-x:focus-visible')}
/* risk chip: a word and a dot, never the colour alone */
.oc-dg-chip{display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;height:20px;padding:0 8px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap;color:var(--foreground);background:color-mix(in oklab, var(--foreground) 8%, transparent)}
.oc-dg-chip::before{content:"";width:8px;height:8px;border-radius:50%;box-sizing:border-box;background:currentColor}
.oc-dg-final{color:${ink(RED)};background:color-mix(in oklab, ${RED} 12%, ${CARD})}
.oc-dg-rev{color:${ink('var(--ui-accent)')};background:color-mix(in oklab, var(--ui-accent) 12%, ${CARD})}
.oc-dg-rev::before{background:linear-gradient(90deg, currentColor 50%, transparent 50%);border:1.5px solid currentColor}
.oc-dg-safe{color:${ink(GREEN)};background:color-mix(in oklab, ${GREEN} 12%, ${CARD})}
.oc-dg-safe::before{background:transparent;border:1.5px solid currentColor}
/* body: the only part that scrolls */
.oc-dg-b{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;box-sizing:border-box;padding:16px;display:flex;flex-direction:column;gap:12px;scrollbar-gutter:stable;background:linear-gradient(${CARD} 30%, transparent) top / 100% 16px no-repeat local, linear-gradient(transparent, ${CARD} 70%) bottom / 100% 16px no-repeat local, linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 14%, transparent), transparent) top / 100% 6px no-repeat scroll, linear-gradient(to top, color-mix(in oklab, var(--foreground) 14%, transparent), transparent) bottom / 100% 6px no-repeat scroll}   /* a shadow on the edge where more is hidden = the scroll hint; none when everything fits */
.oc-dg-b > *{flex:0 0 auto;min-width:0}
.oc-dg-al{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;padding:0 16px}
.oc-dg-al:not(:empty){padding:8px 16px}
@media (max-width:560px){.oc-dg-al{padding-left:12px;padding-right:12px}.oc-dg-al:not(:empty){padding:8px 12px}}
/* foot: help on the left, actions on the right */
.oc-dg-f{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;box-sizing:border-box;padding:12px 16px;border-top:1px solid ${EDGE};background:${CARD}}
.oc-dg-fs,.oc-dg-fa{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.oc-dg-fa{margin-left:auto}
/* a foot with a risk note: the note in clear next to the actions, the discreet diagnostic line under it */
.oc-dg-fs:has(> .oc-dg-fn){flex:1 1 280px;flex-direction:column;flex-wrap:nowrap;align-items:flex-start;gap:4px}
.oc-dg-fn{margin:0;font-size:12px;line-height:1.4;color:var(--ui-text-secondary)}
.oc-dg-fm{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;font-size:11px;color:${SOFT}}
.oc-dg-kept{font-size:11px;color:${SOFT}}
.oc-dg-link.quiet{min-height:20px;font-size:11px;color:${SOFT};text-decoration-style:dotted}
.oc-dg-link.quiet:hover{color:var(--foreground)}
.oc-dg .oc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;min-height:32px;padding:4px 16px;line-height:1.2;text-align:center}   /* a label on two lines (« Crear el proyecto … y 10 tarjetas » at 380 px) keeps 4 px above and below */
/* the accent border belongs to the main action (and to the focus ring): a « Close » beside an inactive main button must not be the louder of the two */
.oc-dg .oc-btn:not(.oc-primary){border-color:${FIELD_EDGE}}
.oc-dg .oc-btn:not(.oc-primary):hover:not([aria-disabled="true"]):not(:disabled){border-color:color-mix(in oklab, var(--foreground) 45%, ${FIELD_EDGE})}
.oc-dg .oc-btn.oc-primary{background:var(--ui-accent);color:var(--ui-accent-fg, var(--background));border-color:var(--ui-accent)}
.oc-dg .oc-btn.oc-primary:hover:not([aria-disabled="true"]):not(:disabled){background:color-mix(in oklab, var(--ui-accent) 88%, var(--foreground))}
.oc-dg .oc-btn.oc-ghost{border-color:${EDGE};color:var(--ui-text-secondary)}
.oc-dg .oc-btn:disabled,.oc-dg .oc-btn[aria-disabled="true"]{opacity:.5;cursor:default}
.oc-dg-link{display:inline-flex;align-items:center;gap:4px;min-height:24px;padding:0;border:0;background:none;font:inherit;font-size:12px;color:var(--ui-accent);cursor:pointer;text-decoration:underline;text-underline-offset:2px}
${RINGED('.oc-dg-link:focus-visible')}
${TIP_CSS}
/* fields */
.oc-dg-fl{display:flex;flex-direction:column;gap:4px;min-width:0}
.oc-dg-fl > .oc-dg-lab{display:flex;align-items:center;gap:8px;min-height:20px;font-size:12px;font-weight:600}
.oc-dg-lab .grow{flex:1 1 auto}
.oc-dg-lab small,.oc-dg-fl small{font-size:11px;font-weight:400;color:${SOFT}}
.oc-dg-fl > small.oc-dg-help-line{font-size:11.5px;line-height:1.4}
.oc-dg-ok{font-size:11px;font-weight:600;color:${ink(GREEN)}}
.oc-dg input[type=text],.oc-dg input[type=search],.oc-dg input:not([type]),.oc-dg textarea,.oc-dg select{box-sizing:border-box;width:100%;max-width:100%;min-height:32px;padding:4px 8px;font-family:inherit;font-size:12.5px;color:var(--foreground);background:${CARD};border:1px solid ${FIELD_EDGE};border-radius:${FIELD_RADIUS}}
.oc-dg textarea{resize:vertical;min-height:64px}
.oc-dg select{width:auto;min-width:0}
/* in a touch browser the host sizes every field at 16 px (no zoom on focus). A 12.5 px of our own would beat it on <input> but not on
   <select>/<textarea>, and one form would mix 12.5 and 16 px fields: there, all follow the host */
@media (hover:none),(pointer:coarse){
  html[data-hermes-desktop-host="browser"] .oc-dg input[type=text],html[data-hermes-desktop-host="browser"] .oc-dg input[type=search],html[data-hermes-desktop-host="browser"] .oc-dg input:not([type]){font-size:max(16px,1em);line-height:22px}   /* 22 + 8 + 2 = the 32 px of the selects beside them */
}
.oc-dg input:not([type=radio]):not([type=checkbox]):focus-visible,.oc-dg textarea:focus-visible,.oc-dg select:focus-visible{${RING_FOCUS}}
.oc-dg input[aria-invalid=true]{border-color:${RED}}
.oc-dg summary:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
/* a message: refusal, failure, state */
.oc-dg-note{display:flex;align-items:flex-start;gap:8px;box-sizing:border-box;margin:0;padding:8px 12px;border:1px solid ${EDGE};border-radius:8px;font-size:12px;line-height:1.4;color:var(--foreground);background:color-mix(in oklab, var(--foreground) 4%, transparent)}
.oc-dg-note svg{flex:0 0 auto;margin-top:1px}
.oc-dg-note > span{min-width:0;overflow-wrap:anywhere}
.oc-dg-note.oc-dg-warn{border-color:color-mix(in oklab, ${ORANGE} 60%, transparent);background:color-mix(in oklab, ${ORANGE} 10%, ${CARD})}
.oc-dg-note.oc-dg-bad{border-color:color-mix(in oklab, ${RED} 60%, transparent);background:color-mix(in oklab, ${RED} 10%, ${CARD});color:${ink(RED)}}
.oc-dg-note.oc-dg-neutral{border-style:dashed}
.oc-dg .oc-dg-faint{margin:0;font-size:11px;color:${SOFT}}
/* segmented choice and chips */
.oc-dg-fl > .oc-dg-seg{align-self:flex-start}
.oc-dg-seg{display:inline-flex;flex-wrap:nowrap;box-sizing:border-box;padding:4px;gap:2px;border:0;box-shadow:inset 0 0 0 1px ${EDGE};border-radius:8px;background:color-mix(in oklab, var(--foreground) 5%, transparent)}
.oc-dg-seg button,.oc-dg-seg label{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:28px;padding:0 12px;border:0;border-radius:6px;background:transparent;font:inherit;font-size:12px;font-weight:500;color:var(--ui-text-secondary);cursor:pointer;white-space:nowrap}
.oc-dg-seg button[aria-pressed="true"],.oc-dg-seg label:has(input:checked){background:${CARD};color:var(--foreground);font-weight:600;box-shadow:0 0 0 1px ${EDGE}}
.oc-dg-seg button:disabled,.oc-dg-seg button[aria-disabled="true"]{opacity:.5;cursor:default}
.oc-dg-seg input{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}
${RINGED('.oc-dg-seg button:focus-visible')}
.oc-dg-seg label:has(input:focus-visible){${RING_FOCUS}}
.oc-dg-chips{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0;padding:0;list-style:none}
.oc-dg-pill{display:inline-flex;align-items:center;gap:8px;box-sizing:border-box;max-width:100%;min-height:28px;padding:0 12px;border:1px solid ${EDGE};border-radius:14px;background:${CARD};font:inherit;font-size:12px;color:var(--foreground);text-align:left;cursor:pointer}
button.oc-dg-pill:hover:not(:disabled):not([aria-disabled="true"]){border-color:var(--ui-accent)}
button.oc-dg-pill:disabled,button.oc-dg-pill[aria-disabled="true"]{opacity:.5;cursor:default}
.oc-dg textarea[aria-disabled="true"]{opacity:.6;cursor:progress}
${RINGED('.oc-dg-pill:focus-visible')}
.oc-dg-pill.on{border-color:var(--ui-accent);background:color-mix(in oklab, var(--ui-accent) 12%, ${CARD})}
.oc-dg-pill.off{color:${SOFT};text-decoration:line-through}
.oc-dg-pill input{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}
/* a hidden radio sits in its own chip: anchored to the <dialog> it overflowed it, and Tab onto it scrolled the whole window */
.oc-dg-pill,.oc-dg-seg label{position:relative}
label.oc-dg-pill:has(input:focus-visible){${RING_FOCUS}}
.oc-dg-pill svg{flex:0 0 auto}
.oc-dg-pill > span{min-width:0;overflow-wrap:anywhere}
/* a card of the body */
.oc-dg-card{display:flex;flex-direction:column;gap:12px;box-sizing:border-box;padding:12px;border:1px solid ${EDGE};border-radius:8px}
.oc-dg-card > h3,.oc-dg-sec > h3{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:600}
.oc-dg-sec{display:flex;flex-direction:column;gap:8px;min-width:0}
/* stepped form (recruitment) */
.oc-dg-rc{display:grid;grid-template-columns:200px minmax(0,1fr);gap:16px;align-items:start}
.oc-dg-prev{position:sticky;top:0;display:flex;flex-direction:column;align-items:center;gap:8px;box-sizing:border-box;padding:12px;border:1px solid ${EDGE};border-radius:12px;text-align:center;background:linear-gradient(180deg,color-mix(in oklab, var(--ui-accent) 10%, ${CARD}),${CARD})}
.oc-dg-prev .oc-portrait{width:112px;height:120px;border-radius:12px;image-rendering:pixelated;background:color-mix(in oklab, var(--foreground) 6%, transparent)}
.oc-dg-prev b{font-size:14px;max-width:100%;overflow-wrap:anywhere}
.oc-dg-prev .oc-faint{max-width:100%;overflow-wrap:anywhere}
.oc-dg-steps{display:flex;flex-direction:column;gap:12px;min-width:0}
.oc-dg-step{box-sizing:border-box;border:1px solid ${EDGE};border-radius:8px;min-width:0}
.oc-dg-sh{display:flex;align-items:center;gap:12px;box-sizing:border-box;min-height:44px;padding:8px 12px;list-style:none}
.oc-dg-sh h3{margin:0;font-size:13px;font-weight:600}
.oc-dg-num{flex:0 0 auto;display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;font-size:12px;font-weight:700;background:var(--ui-accent);color:var(--ui-accent-fg, var(--background))}
details.oc-dg-step > summary .oc-dg-num{background:color-mix(in oklab, var(--foreground) 12%, transparent);color:var(--foreground)}
details.oc-dg-step[open] > summary .oc-dg-num{background:var(--ui-accent);color:var(--ui-accent-fg, var(--background))}
.oc-dg-sum{margin-left:auto;min-width:0;font-size:11.5px;font-weight:400;color:${SOFT};text-align:right;overflow-wrap:anywhere}
.oc-dg-sb{display:flex;flex-direction:column;gap:12px;box-sizing:border-box;padding:0 12px 12px;min-width:0}
details.oc-dg-step > summary{display:flex;align-items:center;gap:12px;box-sizing:border-box;min-height:44px;padding:8px 12px;cursor:pointer;list-style:none;font-weight:600}
details.oc-dg-step > summary::-webkit-details-marker{display:none}
details.oc-dg-step > summary h3{margin:0;font-size:13px}
details.oc-dg-step > summary .chev{flex:0 0 auto;margin-left:8px;color:${SOFT}}
details.oc-dg-step[open] > summary .chev{transform:rotate(180deg)}
.oc-dg-row2{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.oc-dg-start{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.oc-dg-skills{max-height:120px;overflow-y:auto}
.oc-dg-pre{margin:0;padding:8px;max-height:160px;overflow:auto;font-size:11px;line-height:1.4;border:1px solid ${EDGE};border-radius:8px;background:color-mix(in oklab, var(--foreground) 5%, transparent)}
details.oc-dg-req > summary{display:inline-flex;align-items:center;gap:4px;cursor:pointer;list-style:none;color:var(--ui-accent);font-size:12px;text-decoration:underline;text-underline-offset:2px}
details.oc-dg-req > summary::-webkit-details-marker{display:none}
details.oc-dg-req[open] > summary{margin-bottom:8px}
/* swatches of a style (Decorator) and neighbours (Seating) */
.oc-dg-sw{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:12px 8px;margin:0;padding:0;list-style:none}
.oc-dg-sw li{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:11px;color:${SOFT}}
.oc-dg-sw i{display:block;height:28px;border-radius:6px;border:1px solid ${FIELD_EDGE}}
.oc-dg-sw span{overflow-wrap:anywhere}
.oc-dg-pairs{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.oc-dg-pairs li{display:inline-flex;align-items:center;gap:8px;box-sizing:border-box;min-height:28px;padding:0 12px;border:1px solid ${EDGE};border-radius:14px;font-size:12px;min-width:0}
.oc-dg-pairs li b{font-weight:600;overflow-wrap:anywhere}
.oc-dg-pairs li span{color:${SOFT};font-size:11px}
.oc-dg-pairs li em{font-style:normal;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ui-accent)}
.oc-dg-busy{display:flex;align-items:center;gap:8px;margin:0;font-size:12px}
.oc-dg-spin{flex:0 0 auto;width:16px;height:16px;border-radius:50%;border:2px solid color-mix(in oklab, var(--ui-accent) 25%, transparent);border-top-color:var(--ui-accent);animation:oc-dg-spin .8s linear infinite}
@keyframes oc-dg-spin{to{transform:rotate(360deg)}}
.oc-dg[data-motion="reduced"] .oc-dg-spin{animation:none;border-top-color:var(--ui-accent);border-right-color:var(--ui-accent)}
@media (prefers-reduced-motion:reduce){.oc-dg-spin{animation:none;border-right-color:var(--ui-accent)}}
.oc-dg-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;min-height:20px;font-size:11px;color:${SOFT}}
/* type of bot (a radio group of chips with the colour of the outfit) */
.oc-dg .oc-rp,.oc-dg .oc-mp-pvs{display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:flex-start;gap:8px;box-sizing:border-box;margin:0;padding:0;border:0;background:none}
.oc-dg-pill.sel{border-color:var(--ui-accent);background:color-mix(in oklab, var(--ui-accent) 12%, ${CARD});font-weight:600}
.oc-rp-chip{gap:8px;min-height:28px;padding:0 12px 0 8px}
/* the folded line of the type: label, current choice, « Change » */
.oc-rp-line{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px}
.oc-rp-line > .oc-dg-lab{display:flex;align-items:center;gap:8px;min-height:20px;font-size:12px;font-weight:600}
.oc-rp-cur{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:0 8px;min-width:0;flex:1 1 auto;font-size:12.5px}
.oc-rp-cur b{font-weight:600}
.oc-dg-link[aria-expanded="true"] svg{transform:rotate(180deg)}
.oc-rp-sw{flex:0 0 auto;display:inline-block;width:12px;height:12px;border-radius:4px;box-shadow:inset 0 0 0 1px color-mix(in oklab, var(--foreground) 45%, transparent)}
.oc-rp-sw.auto{background:linear-gradient(135deg,var(--ui-accent) 50%,color-mix(in oklab, var(--foreground) 14%, transparent) 50%)}
.oc-rp-sw.none{background:color-mix(in oklab, var(--foreground) 18%, transparent)}
/* model and provider picked from Hermes' list */
.oc-mp{display:flex;flex-direction:column;gap:12px;min-width:0}
.oc-mp-inh{display:flex;align-items:center;gap:12px;box-sizing:border-box;width:100%;min-height:48px;padding:8px 12px;border:1px solid ${EDGE};border-radius:8px;background:${CARD};font:inherit;font-size:12px;color:var(--foreground);text-align:left;cursor:pointer}
.oc-mp-inh:hover{border-color:var(--ui-accent)}
${RINGED('.oc-mp-inh:focus-visible')}
.oc-mp-inh[aria-pressed="true"]{border-color:var(--ui-accent);background:color-mix(in oklab, var(--ui-accent) 12%, ${CARD})}
.oc-mp-radio{flex:0 0 auto;box-sizing:border-box;width:16px;height:16px;border-radius:50%;border:2px solid ${FIELD_EDGE}}
.oc-mp-inh[aria-pressed="true"] .oc-mp-radio{border-color:var(--ui-accent);background:radial-gradient(circle,var(--ui-accent) 0 40%,transparent 44%)}
.oc-mp-inht{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.oc-mp-inht b{font-weight:600}
.oc-mp-inht small{font-size:11px;color:${SOFT};overflow-wrap:anywhere}
.oc-mp-inh em{flex:0 0 auto;font-style:normal;font-size:11px;color:${SOFT}}
.oc-mp-pv{gap:8px}
.oc-mp-ok{display:inline-flex;align-items:center;gap:4px;font-style:normal;font-size:11px;font-weight:600;color:${ink(GREEN)}}
.oc-mp-ok::before{content:"";width:8px;height:8px;border-radius:50%;background:${GREEN}}
.oc-mp-off{box-sizing:border-box;border:1px dashed ${EDGE};border-radius:8px;padding:0 12px}
.oc-mp-off > summary{display:flex;align-items:center;gap:4px;min-height:32px;cursor:pointer;list-style:none;font-size:12px;color:${SOFT}}
.oc-mp-off > summary::-webkit-details-marker{display:none}
.oc-mp-off[open] > summary svg{transform:rotate(180deg)}
.oc-mp-off[open]{padding-bottom:12px}
.oc-mp-offl{display:flex;flex-wrap:wrap;gap:4px 8px;max-height:96px;overflow-y:auto;margin:0 0 8px;padding:0;list-style:none}
/* the 96 px box cuts the 4th row through its text: that row fades out (the list goes on below) instead of reading as broken text */
.oc-mp-offl{-webkit-mask-image:linear-gradient(to bottom,currentColor calc(100% - 20px),transparent);mask-image:linear-gradient(to bottom,currentColor calc(100% - 20px),transparent)}
.oc-mp-offl li{box-sizing:border-box;padding:0 8px;min-height:24px;display:inline-flex;align-items:center;border-radius:12px;font-size:11px;color:${SOFT};background:color-mix(in oklab, var(--foreground) 5%, transparent);opacity:.8}
.oc-mp-off .oc-dg-link{margin-top:4px}
.oc-mp-count{margin-left:8px;font-size:11px;font-weight:400;color:${SOFT}}
.oc-mp-list{display:flex;flex-direction:column;box-sizing:border-box;max-height:208px;overflow-y:auto;margin:0;padding:4px;list-style:none;border:1px solid ${FIELD_EDGE};border-radius:${FIELD_RADIUS};background:${CARD}}
.oc-mp-opt{display:flex;align-items:center;gap:8px;box-sizing:border-box;min-height:32px;padding:4px 8px;border-radius:4px;font-size:12px;cursor:pointer}
.oc-mp-opt:hover,.oc-mp-opt.act{background:color-mix(in oklab, var(--ui-accent) 12%, transparent)}
.oc-mp-opt.on{background:color-mix(in oklab, var(--ui-accent) 20%, transparent)}
.oc-mp-opt svg{flex:0 0 auto;color:var(--ui-accent)}
.oc-mp-name{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}
.oc-mp-name b{font-weight:500;overflow-wrap:anywhere}
.oc-mp-name small{font-size:11px;color:${SOFT};overflow-wrap:anywhere}
.oc-mp-price{flex:0 0 auto;font-size:11px;font-variant-numeric:tabular-nums;color:${SOFT};text-align:right}
.oc-mp-none{padding:8px;font-size:12px;color:${SOFT}}
/* under 560 px: a full sheet, the recruitment's preview folds above its form */
`

/** The marks, the boxes of the assisted functions: also injected by the Agent tab (the revision), which is not inside a window. */
export const LM_CSS = `
/* violet = written by a model; the mark is a quiet button, the field wears a dashed violet edge until it is read */
.oc-lm-mk{display:inline-flex;align-items:center;gap:4px;min-height:24px;min-width:24px;box-sizing:border-box;padding:0 8px;border-radius:12px;border:0;cursor:pointer;flex:0 0 auto;font:600 11px/1 inherit;color:${VIOLET_INK};background:color-mix(in oklab, ${VIOLET} 13%, transparent)}
.oc-lm-mk:hover{background:color-mix(in oklab, ${VIOLET} 22%, transparent)}
${RINGED('.oc-lm-mk:focus-visible')}
.oc-lm-f{border-color:color-mix(in oklab, ${VIOLET} 60%, ${EDGE})!important;border-style:dashed!important;background:color-mix(in oklab, ${VIOLET} 4%, ${CARD})}
.oc-lm-box{display:flex;flex-direction:column;gap:8px;padding:12px;margin-bottom:16px;border-radius:12px;border:1px solid color-mix(in oklab, ${VIOLET} 35%, ${EDGE});background:linear-gradient(135deg, color-mix(in oklab, ${VIOLET} 8%, ${CARD}), ${CARD} 70%)}
.oc-lm-ah{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.oc-lm-ah b{font-size:13px}
.oc-lm-ah small,.oc-lm-note{color:${SOFT};font-size:12px}
.oc-lm-ah .grow{flex:1 1 auto}
.oc-lm-ar{display:flex;gap:8px;align-items:flex-start}
.oc-lm-ar textarea{flex:1 1 auto;min-width:0;resize:vertical}
.oc-lm-ar .oc-btn{height:40px}
.oc-lm-mis{margin:0;display:flex;align-items:baseline;gap:8px;font-size:12.5px;min-width:0;flex-wrap:wrap}
.oc-lm-mis>span{font-size:11.5px;font-weight:600;color:${SOFT}}
.oc-lm-mis q{quotes:"« " " »";color:var(--ui-text-secondary);min-width:0;flex:1 1 200px}
.oc-lm-prog{display:block;height:4px;border-radius:2px;background:color-mix(in oklab, ${VIOLET} 15%, color-mix(in oklab, var(--foreground) 6%, ${CARD}));overflow:hidden;position:relative}
.oc-lm-prog i{position:absolute;top:0;bottom:0;left:0;width:40%;border-radius:2px;background:${VIOLET};transform:translateX(-100%);animation:oclmprog 1.6s ease-in-out infinite}
@keyframes oclmprog{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
/* the seconds that tick are the proof of life: bold, in the violet of the model's marks, not a grey aside */
.oc-lm-el{font-weight:700;color:${VIOLET_INK};font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){.oc-lm-prog i{animation:none;transform:none;width:100%;opacity:.45}}   /* a still bar must not read as « 40 % done » */
.oc-lm-ref,.oc-lm-dup{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;border:1px solid color-mix(in oklab, ${RED} 40%, ${EDGE});background:color-mix(in oklab, ${RED} 6%, ${CARD})}
.oc-lm-dup{border-color:color-mix(in oklab, ${ORANGE} 45%, ${EDGE});background:color-mix(in oklab, ${ORANGE} 7%, ${CARD})}
.oc-lm-ref>svg{color:${RED};flex:0 0 auto;align-self:flex-start;margin-top:2px}
.oc-lm-dup>svg{color:${ORANGE};flex:0 0 auto;align-self:flex-start;margin-top:2px}
.oc-lm-dup{flex-wrap:wrap}
div.oc-lm-dup p{flex:1 1 160px}
.oc-lm-dup .oc-btn{flex:0 0 auto;white-space:nowrap;margin-left:auto}   /* 380 px: the button goes under the sentence, whole, instead of breaking in two lines beside it */
.oc-lm-ref p,.oc-lm-dup p{margin:0;flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;font-size:12.5px}
.oc-lm-ref small,.oc-lm-dup small{color:var(--ui-text-secondary);font-size:12px}
.oc-lm-soul textarea{font-size:12px;line-height:1.5;resize:vertical}
.oc-lm-left{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:12px;font-size:12px;font-weight:600;color:${VIOLET_INK};background:color-mix(in oklab, ${VIOLET} 11%, transparent);white-space:nowrap}
.oc-lm-rv{display:flex;flex-direction:column;gap:8px;margin:0 0 12px;padding:12px;border-radius:12px;border:1px solid color-mix(in oklab, ${VIOLET} 35%, ${EDGE});background:linear-gradient(160deg, color-mix(in oklab, ${VIOLET} 7%, ${CARD}), ${CARD} 70%);font-size:12.5px}
.oc-lm-ba{display:flex;flex-direction:column;gap:4px}
.oc-lm-ba .k{font-size:11.5px;font-weight:600;color:${SOFT}}
.oc-lm-before{margin:0;color:${SOFT};text-decoration:line-through;text-decoration-color:color-mix(in oklab, ${SOFT} 60%, transparent)}
.oc-lm-rv .oc-lm-ba textarea{box-sizing:border-box;width:100%;font-size:12.5px;line-height:1.5;resize:vertical;field-sizing:content;min-height:4lh;max-height:16lh}   /* the whole proposal is read before « Appliquer »: no inner scroll for 280 characters */
.oc-lm-why{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px;color:var(--ui-text-secondary)}
.oc-lm-act{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.oc-lm-act .grow{flex:1 1 auto}
.oc-lm-act small{color:${SOFT};font-size:12px;flex:1 0 100%}
.oc-lm-count{font-size:11.5px;color:${SOFT}}
.oc-lm-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:700px){.oc-lm-ar{flex-direction:column;align-items:stretch}.oc-lm-ar .oc-btn{height:36px}.oc-lm-box{margin-bottom:12px}}
`

const DIALOG_TAIL = `
@media (max-width:560px){
  .oc-dg,.oc-dg-s,.oc-dg-l{width:100vw;max-width:100vw;max-height:100dvh;height:100dvh;border-radius:0;border-width:0}
  .oc-dg-h,.oc-dg-f{padding-left:12px;padding-right:12px}
  .oc-dg-b{padding:12px}
  .oc-dg-rc{grid-template-columns:minmax(0,1fr)}
  .oc-dg-prev{position:static;flex-direction:row;flex-wrap:wrap;justify-content:flex-start;text-align:left}
  .oc-dg-prev .oc-portrait{width:56px;height:60px}
  .oc-dg-fa{margin-left:0;width:100%;justify-content:flex-end}
  .oc-dg-f{align-items:stretch}
  .oc-dg-sum{display:none}
}
`

export const DIALOG_CSS = DIALOG_HEAD + LM_CSS + DIALOG_TAIL
