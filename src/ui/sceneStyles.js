/**
 * Stylesheet of the scene HUD (labels over the canvas, list view). Pseudo-classes and media queries cannot be
 * inline, so this is injected once as a <style>. Theme variables only: no literal colour (those live in src/scene/).
 */
import { CARD as SURFACE, EDGE } from './tokens.js'

// 94 %: at night a more transparent label lets the darkened room show through and pulls its text under 4.5:1
const CARD = `color-mix(in oklab, ${SURFACE} 94%, transparent)`
const SHADOW = '0 1px 3px color-mix(in oklab, var(--foreground) 22%, transparent)'
// secondary text. --ui-text-tertiary alone measured 3.4:1 on the label background (light theme); this mix >= 4.5:1, both themes, day and night.
const SOFT = 'color-mix(in oklab, var(--ui-text-secondary) 60%, var(--ui-text-tertiary))'
// coloured text (elapsed tag, "blocked") pulled half-way to the text colour: pure orange on its tint measured 2.1:1
// (light), pure accent 3.2:1 (dark). Dots, borders and bars keep the pure hue.
const ink = hue => `color-mix(in oklab, ${hue} 50%, var(--foreground))`
const ORANGE = 'var(--ui-orange, var(--ui-accent))'

export const SCENE_CSS = `
.oc-box{position:relative;flex:1 1 auto;min-width:0;min-height:0;box-sizing:border-box;padding:8px 8px 4px;border:1px solid ${EDGE};border-radius:12px;background:${SURFACE};overflow:hidden}
.oc-box.oc-listing{overflow-x:hidden;overflow-y:auto}
.oc-box[data-view="scene"]{display:flex;flex-direction:column;justify-content:safe center}
.oc-stage{position:relative;margin:0 auto;flex:0 0 auto;isolation:isolate}
/* the ground around the room (src/scene/backdrop.js), under the room canvas, reaching the edges of the frame (the frame clips it) */
.oc-ground{position:absolute;z-index:-1;display:block;pointer-events:none;image-rendering:pixelated;image-rendering:crisp-edges}
.oc-stage canvas{display:block;image-rendering:pixelated;image-rendering:crisp-edges}
.oc-hud{position:absolute;inset:0;pointer-events:none}
.oc-station{position:absolute;pointer-events:auto;border:0;background:transparent;padding:0;cursor:pointer;border-radius:10px;font:inherit;color:var(--foreground)}
.oc-station:focus-visible,.oc-lrow:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.oc-chip{position:absolute;left:50%;bottom:calc(100% + 2px);transform:translateX(-50%);display:inline-flex;align-items:center;gap:5px;padding:1px 7px 1px 5px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;
  background:${CARD};border:1px solid ${EDGE};color:var(--foreground);box-shadow:${SHADOW};backdrop-filter:blur(3px);transition:transform .15s ease;z-index:1}
.oc-below .oc-chip{bottom:auto;top:calc(100% + 2px)}
/* a placed label sits where src/scene/labels.js put it (left / top set by OfficeScene), not centred on its station */
.oc-chip[data-placed]{transform:none!important;transition:none}
/* the state is a 9 px pixel sign in the state's hue (src/scene/stateicons.js), not a round dot: it reads by its shape */
.oc-dot{display:inline-flex;align-items:center;justify-content:center;width:11px;height:11px;flex:0 0 auto;color:var(--ui-text-tertiary)}
.oc-sti{display:block;width:9px;height:9px}
/* the agent's head, cut from its sprite */
.oc-station .oc-chip .oc-nm{min-width:0;max-width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc-face{display:block;flex:0 0 auto;width:14px;height:14px;margin:0 -1px 0 -2px;border-radius:4px;image-rendering:pixelated;image-rendering:crisp-edges;background:color-mix(in oklab, var(--foreground) 24%, transparent)}
/* time on the running card, a 2 px line at the foot of the label (full after 30 min, then orange: it drags) */
.oc-bar{position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:1px;overflow:hidden;background:color-mix(in oklab, var(--ui-accent) 22%, transparent)}
.oc-bar i{display:block;height:100%;background:var(--ui-accent);transition:width .6s ease}
.oc-bar[data-late]{background:color-mix(in oklab, ${ORANGE} 25%, transparent)}
.oc-bar[data-late] i{background:${ORANGE}}
.oc-lrow .oc-bar{display:none}
/* same grammar as the legend of the halos: resting (no halo) = empty ring, silent = filled grey disc */
.oc-s-idle .oc-dot,.oc-s-new .oc-dot,.oc-s-unknown .oc-dot{opacity:.8}
.oc-sl{display:none;color:${SOFT};font-weight:500}
.oc-task{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:600;padding:0 5px;border-radius:5px;color:${ink('var(--ui-accent)')};background:color-mix(in oklab, var(--ui-accent) 16%, transparent)}
.oc-s-waiting .oc-task{color:${ink(ORANGE)};background:color-mix(in oklab, ${ORANGE} 18%, transparent)}
.oc-s-stale .oc-task{color:${SOFT};background:color-mix(in oklab, var(--ui-text-tertiary) 14%, transparent)}
.oc-s-working .oc-chip{border-color:color-mix(in oklab, var(--ui-accent) 70%, ${EDGE})}
.oc-s-active .oc-chip{border-color:color-mix(in oklab, var(--ui-green, var(--ui-accent)) 60%, ${EDGE})}
.oc-s-working .oc-dot{color:var(--ui-accent)}
.oc-s-active .oc-dot{color:var(--ui-green, var(--ui-accent))}
.oc-s-waiting .oc-chip{border-color:var(--ui-orange, var(--ui-accent))}
.oc-s-waiting .oc-dot{color:color-mix(in oklab, ${ORANGE} 75%, var(--foreground))}
.oc-s-stale .oc-chip{border-style:dashed}
.oc-s-new .oc-chip,.oc-s-unknown .oc-chip{opacity:.75}
.oc-station:hover,.oc-station[aria-pressed="true"],.oc-station:focus-visible{z-index:2}
.oc-station:hover .oc-chip,.oc-station[aria-pressed="true"] .oc-chip,.oc-station:focus-visible .oc-chip{transform:translateX(-50%) translateY(-2px)}
.oc-station:hover .oc-sl,.oc-station[aria-pressed="true"] .oc-sl,.oc-station:focus-visible .oc-sl,.oc-s-waiting .oc-sl{display:inline}
/* the selection takes the agent's state hue (same as its floor halo and its selection square in src/scene/draw.js); resting / new: a neutral */
.oc-station,.oc-lrow{--sel:color-mix(in oklab, var(--foreground) 45%, transparent)}
.oc-s-working{--sel:var(--ui-accent)}
.oc-s-waiting{--sel:${ORANGE}}
.oc-s-active{--sel:var(--ui-green, var(--ui-accent))}
.oc-s-stale{--sel:var(--ui-text-tertiary)}
.oc-station[aria-pressed="true"] .oc-chip{border-color:var(--sel)}
.oc-station[aria-pressed="true"]{box-shadow:0 0 0 2px var(--sel);background:color-mix(in oklab, var(--sel) 12%, transparent)}
.oc-zone{position:absolute;left:0;top:0;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;border-radius:8px;font:inherit;font-size:11px;line-height:1;white-space:nowrap;
  background:${CARD};border:1px solid ${EDGE};color:var(--foreground);box-shadow:${SHADOW};pointer-events:auto}
.oc-zone b{font-weight:600;text-transform:capitalize}
.oc-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.oc-warn{color:${ink(ORANGE)};font-weight:600}
/* an island's label: on the front edge of its rug, in the project's colour, a short stem to the edge, a button that filters on the project */
.oc-isl{cursor:pointer;border-color:color-mix(in oklab, var(--pc) 45%, ${EDGE});box-shadow:inset 3px 0 0 var(--pc), ${SHADOW};padding-left:10px}
.oc-isl:hover{background:color-mix(in oklab, var(--pc) 10%, ${SURFACE})}
.oc-isl:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.oc-isl[aria-pressed="true"]{background:color-mix(in oklab, var(--pc) 16%, ${SURFACE});border-color:var(--pc)}
.oc-isl::before{content:"";position:absolute;left:50%;bottom:100%;width:2px;height:calc(var(--stem, 7px) - 1px);margin-left:-1px;background:var(--pc);opacity:.7}
.oc-pdot{width:8px;height:8px;flex:0 0 auto;border-radius:2px;background:var(--pc)}
.oc-isl .oc-ring{flex:0 0 auto;width:14px;height:14px}
.oc-isl .oc-wb{display:inline-flex;align-items:center;gap:2px}
.oc-isl[data-isl="short"] .oc-ring,.oc-isl[data-isl="short"] .oc-wb{display:none}
.oc-isl[data-isl="dot"]{gap:0;padding:0;width:20px;justify-content:center;height:20px;border-radius:6px}
.oc-isl[data-isl="dot"] > :not(.oc-pdot){display:none}
.oc-isl[data-isl="dot"] .oc-pdot{width:10px;height:10px}
[data-hall][data-isl="dot"]{width:20px;height:20px;padding:0;justify-content:center;gap:0;overflow:hidden}
[data-hall][data-isl="dot"] > *{display:none}
[data-hall]::before{content:"";position:absolute;left:50%;bottom:100%;width:2px;height:calc(var(--stem, 7px) - 1px);margin-left:-1px;background:var(--ui-stroke-secondary)}
.oc-compact .oc-chip{padding:0 5px 0 4px;gap:3px}
.oc-compact .oc-zone{gap:4px;padding:0 6px}
.oc-compact .oc-isl{padding-left:8px}
/* the leader lines of the labels that had to move away from their character */
.oc-leads{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.oc-leads line{stroke:var(--ui-text-tertiary);stroke-width:1.25;stroke-linecap:round;opacity:.85}
.oc-leads line.s-working{stroke:var(--ui-accent)}
.oc-leads line.s-waiting{stroke:${ORANGE}}
.oc-leads line.s-active{stroke:var(--ui-green, var(--ui-accent))}
/* the project filter dims the scene: the canvas is washed by the engine (src/scene/draw.js); what is written on it keeps its colour
   (an opacity of .45 / .5 / .62 measured 3.1 / 2.9 / 3.9:1 on the light theme) and recedes by its edge (dashed), its weight and its face;
   a label wakes up on hover, on focus and when selected */
.oc-station[data-dim]:not(:hover):not(:focus-visible):not([aria-pressed="true"]) .oc-chip{border-style:dashed;border-color:${EDGE};box-shadow:none}
.oc-station[data-dim]:not(:hover):not(:focus-visible):not([aria-pressed="true"]) .oc-nm{font-weight:500}
.oc-station[data-dim]:not(:hover):not(:focus-visible):not([aria-pressed="true"]) .oc-face{filter:grayscale(1);opacity:.7}
.oc-zone[data-dim]:not(:hover):not(:focus-visible){border-style:dashed;border-color:${EDGE};box-shadow:none}
.oc-zone[data-dim]:not(:hover):not(:focus-visible) b{font-weight:500}
.oc-lzone[data-dim] > h2,.oc-lzone[data-dim] > h2 .oc-warn{font-weight:500}
.oc-lrow[data-dim]:not([aria-pressed="true"]) .oc-chip{border-style:dashed}
.oc-lrow[data-dim]:not([aria-pressed="true"]) .oc-nm{font-weight:500}
.oc-lrow[data-dim]:not([aria-pressed="true"]) .oc-face{filter:grayscale(1);opacity:.7}
.oc-note{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}
.oc-notebtn{display:inline-flex;align-items:center;height:24px;padding:0 8px;border:1px solid var(--ui-stroke-secondary);border-radius:6px;background:${SURFACE};color:var(--foreground);font:inherit;font-size:11px;font-weight:600;cursor:pointer}
.oc-notebtn:hover{border-color:var(--ui-accent)}
.oc-notebtn:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.oc-dense .oc-station:not(.oc-s-working):not(.oc-s-waiting):not(.oc-s-stale):not([aria-pressed="true"]) .oc-chip{padding:1px;gap:0}
.oc-dense .oc-station:not(.oc-s-working):not(.oc-s-waiting):not(.oc-s-stale):not([aria-pressed="true"]) .oc-chip > :not(.oc-dot){display:none}
.oc-dense .oc-station:hover .oc-chip > *,.oc-dense .oc-station:focus-visible .oc-chip > *{display:inline-flex!important}
.oc-dense .oc-station:hover,.oc-dense .oc-station:focus-visible{z-index:8}
.oc-dense .oc-station:not([aria-pressed="true"]):not(:hover) .oc-chip .oc-task{display:none}
/* a full label that would cover a more important one folds into its dot (data-fold, set by OfficeScene from src/core/hud.js foldOverlaps);
   hover, keyboard focus and selection open it again, in front. The dot keeps its state colour; the aria-label never changes. */
.oc-station[data-fold]:not(:hover):not(:focus-visible):not([aria-pressed="true"]) .oc-chip{padding:1px;gap:0}
.oc-station[data-fold]:not(:hover):not(:focus-visible):not([aria-pressed="true"]) .oc-chip > :not(.oc-dot){display:none!important}
.oc-station[data-fold]:hover,.oc-station[data-fold]:focus-visible{z-index:8}
/* the sign of a silent card (the « silent » hourglass of src/scene/stateicons.js, same size as the state sign) sits after the code.
   When the label is folded into its dot it stays, as a small pip on the dot's corner (out of the flow: the dot keeps its size): a silent card is never invisible. */
.oc-quiet{display:inline-flex;align-items:center;justify-content:center;width:11px;height:11px;flex:0 0 auto;color:${ink(ORANGE)}}
.oc-dense .oc-station:not(.oc-s-working):not(.oc-s-waiting):not(.oc-s-stale):not([aria-pressed="true"]):not(:hover):not(:focus-visible) .oc-chip > .oc-quiet,
.oc-station[data-fold]:not(:hover):not(:focus-visible):not([aria-pressed="true"]) .oc-chip > .oc-quiet{display:inline-flex!important;position:absolute;top:-7px;right:-7px;border-radius:50%;background:${CARD};box-shadow:0 0 0 1px ${EDGE}}
/* the sign « a decision waits for you » on a bot whose state is another one (it works): the waiting state's « ! », in the family of the code pill
   (a tinted rounded square), after the code. Folded, it is a pip on the corner of the dot like the silent sign (the second pip when both are there). */
.oc-wait{display:inline-flex;align-items:center;justify-content:center;width:15px;height:14px;flex:0 0 auto;border-radius:5px;color:${ink(ORANGE)};background:color-mix(in oklab, ${ORANGE} 18%, transparent)}
.oc-station[data-fold]:not(:hover):not(:focus-visible):not([aria-pressed="true"]) .oc-chip > .oc-wait{display:inline-flex!important;position:absolute;top:-7px;right:-7px;width:14px;border-radius:50%;background:${CARD};box-shadow:0 0 0 1px ${EDGE}}
.oc-station[data-fold]:not(:hover):not(:focus-visible):not([aria-pressed="true"]) .oc-chip > .oc-quiet ~ .oc-wait{right:8px}
.oc-list{display:flex;flex-direction:column;gap:10px;padding:4px 2px;width:100%;box-sizing:border-box;min-width:0}
.oc-list p{margin:0;font-size:11px;color:${SOFT}}
.oc-lzone{min-width:0}
.oc-lzone h2{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:0 0 4px;font-size:12px;font-weight:600;color:var(--foreground)}
.oc-lzone h2 span{font-weight:400;color:${SOFT}}
.oc-lzone h2 .oc-warn{font-weight:600;color:${ink(ORANGE)}}
.oc-lrow{display:block;width:100%;text-align:left;background:none;border:0;padding:0;margin:0 0 3px;font:inherit;color:inherit;cursor:pointer;border-radius:6px}
.oc-lrow .oc-chip{position:static;transform:none;display:flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid ${EDGE};border-radius:6px;background:${SURFACE};font-size:12px;min-width:0;box-shadow:none;backdrop-filter:none}
.oc-lrow .oc-nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:8ch}
.oc-lrow .oc-sl{display:inline;white-space:nowrap}
.oc-lrow .oc-task{margin-left:auto;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.oc-lrow[aria-pressed="true"] .oc-chip{border-color:var(--sel)}
/* a row with a thought bubble keeps the bubble inside its frame (the border moves from the chip to the whole row) */
.oc-lrow:has(.oc-lthought){border:1px solid ${EDGE};border-radius:6px;background:${SURFACE}}
.oc-lrow:has(.oc-lthought) .oc-chip{border-color:transparent;background:none}
.oc-lrow[aria-pressed="true"]:has(.oc-lthought){border-color:var(--sel)}
.oc-lrow[aria-pressed="true"]:has(.oc-lthought) .oc-chip{border-color:transparent}
.oc-station,.oc-zone{z-index:1}
.oc-station[data-model-badge]{z-index:2}
.oc-spot{position:absolute;z-index:0;pointer-events:auto;display:block;margin:0;padding:0;border:0;border-radius:6px;background:transparent;font:inherit;cursor:help}
.oc-spot:hover{box-shadow:0 0 0 1px color-mix(in oklab, var(--ui-accent) 70%, transparent);background:color-mix(in oklab, var(--ui-accent) 10%, transparent)}
.oc-spot:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px;background:color-mix(in oklab, var(--ui-accent) 14%, transparent)}
.oc-tip{position:absolute;z-index:30;pointer-events:auto;width:max-content;max-width:min(260px,92%);padding:6px 9px;border-radius:8px;font-size:11.5px;line-height:1.35;color:var(--foreground);background:${SURFACE};border:1px solid var(--ui-accent);box-shadow:${SHADOW}}
.oc-tip b{display:block;font-weight:600;font-size:11px;margin-bottom:2px;color:${SOFT}}
.oc-tip small{display:block;margin-top:3px;font-size:11px;color:${SOFT}}
/* 11 px like every other label text */
.oc-pinwrap{display:inline-flex;align-items:center;flex:0 0 auto;cursor:help}
.oc-dense .oc-station .oc-chip > .oc-pinwrap{display:inline-flex!important;margin-left:2px}
.oc-chip .oc-pin{width:11px;height:11px;margin-left:-1px}
.oc-lrow .oc-chip .oc-pin{width:12px;height:12px}
/* thought bubbles: above the label of an agent at work, labelled AI, never over another label (OfficeScene hides the one that would) */
.oc-thought{--dx:0px;--lift:0px;position:absolute;left:50%;bottom:calc(100% + 24px);transform:translate(calc(-50% + var(--dx)), calc(-1 * var(--lift)));width:max-content;max-width:156px;padding:2px 7px 3px;border-radius:9px;font-size:11px;font-weight:500;line-height:1.2;text-align:center;overflow-wrap:anywhere;pointer-events:none;color:var(--foreground);background:${CARD};border:1px solid ${EDGE};box-shadow:${SHADOW}}
.oc-thought::before{content:'';position:absolute;left:calc(50% - var(--dx));top:100%;width:1px;height:var(--lift);margin-left:-.5px;background:${EDGE}}
.oc-thought::after{content:'';position:absolute;left:calc(50% - var(--dx));top:100%;width:6px;height:6px;margin:-4px 0 0 -3px;transform:rotate(45deg);background:${CARD};border:solid ${EDGE};border-width:0 1px 1px 0}
.oc-below .oc-thought{bottom:calc(100% + 4px)}
.oc-thought[data-hide]{visibility:hidden}
.oc-thought i,.oc-lthought i{font-style:normal;font-size:11px;font-weight:600;letter-spacing:.02em;line-height:1.1;margin-right:5px;padding:0 3px;border-radius:4px;border:1px solid ${EDGE};color:${SOFT}}
.oc-lthought{display:block;margin:0 8px;padding:0 0 5px;font-size:11.5px;line-height:1.3;color:var(--foreground);overflow-wrap:anywhere}
@media (prefers-reduced-motion: reduce){.oc-chip{transition:none}}
`
