/**
 * The look of the campaign editor (the window, the graph preview, the review and the « created » step).
 * Theme variables only: the only colours are the host's, and each BOT's hue arrives as `--bc`
 * on its element (src/scene/projects.js `botColors`). Sizes on the 4 px grid (hairlines excepted). The page behind never scrolls; the body of
 * the window does. Container queries follow the WINDOW's width, not the screen's (the window is a sheet under 560 px).
 */
import { CARD, EDGE, FIELD_EDGE, RING_FOCUS, SUNKEN } from './tokens.js'

const T2 = 'var(--ui-text-secondary)'
const T3 = 'color-mix(in oklab, var(--ui-text-secondary) 55%, var(--ui-text-tertiary))'
const ORANGE = 'var(--ui-orange, var(--ui-accent))'
const GREEN = 'var(--ui-green, var(--ui-accent))'
const RED = 'var(--ui-red, var(--destructive, var(--ui-orange)))'
const ink = hue => `color-mix(in oklab, ${hue} 55%, var(--foreground))`
const VIOLET = 'var(--ui-violet, color-mix(in oklab, color-mix(in oklch, var(--ui-purple, var(--ui-accent)), color-mix(in oklch, var(--ui-blue, var(--ui-accent)) 81%, var(--ui-red, var(--ui-accent)))) 88%, var(--foreground)))'
const VIOLET_INK = 'color-mix(in oklab, var(--ui-violet, color-mix(in oklab, color-mix(in oklch, var(--ui-purple, var(--ui-accent)), color-mix(in oklch, var(--ui-blue, var(--ui-accent)) 81%, var(--ui-red, var(--ui-accent)))) 88%, var(--foreground))) 65%, var(--foreground))'

export const CAMPAIGN_CSS = `
.oc-dg.oc-cg-dlg{width:min(1200px,calc(100vw - 32px));max-height:min(880px,calc(100dvh - 32px))}
.oc-cg{container-type:inline-size;container-name:cg;display:flex;flex-direction:column;gap:12px;min-width:0}
.oc-cg *{box-sizing:border-box}
.oc-cg .oc-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.oc-cg .faint{color:${T3}}
.oc-cgnote{font-size:12px;line-height:1.4;color:${T3}}   /* the foot's note of the review, never under 12 px */
.oc-cg .oc-portrait{width:24px;height:26px;border:0;border-radius:6px;image-rendering:pixelated}
.oc-cgrow .pt,.oc-cgg-node .pt{width:24px}
/* steps */
.oc-cgsteps{display:flex;flex-wrap:wrap;gap:8px 16px;margin:0;padding:0;list-style:none;font-size:12px;color:${T3}}
.oc-cgsteps li{display:inline-flex;align-items:center;gap:8px;min-height:24px}
.oc-cgsteps .n{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:10px;border:1px solid ${EDGE};font-size:11px;font-weight:600}
.oc-cgsteps .now{color:var(--foreground);font-weight:600}
.oc-cgsteps .now .n{background:var(--ui-accent);border-color:var(--ui-accent);color:var(--ui-accent-fg, var(--background))}
.oc-cgsteps .past .n{background:color-mix(in oklab, ${GREEN} 18%, ${CARD});border-color:color-mix(in oklab, ${GREEN} 60%, transparent);color:${ink(GREEN)}}
.oc-cgsteps .tl{border-radius:4px}
.oc-cgsteps .tl:focus-visible{${RING_FOCUS}}
/* head: goal, project, templates, new project */
.oc-cghead{display:grid;grid-template-columns:minmax(0,1fr) minmax(160px,240px) auto;gap:12px;align-items:end}
.oc-cghead .oc-dg-fl{min-width:0}
.oc-cghead .oc-dg select{width:100%}
.oc-cghead .nb{grid-column:1 / -1;display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,1fr);gap:4px 12px;align-items:end;padding:12px;border:1px dashed color-mix(in oklab, var(--pc) 60%, ${EDGE});border-radius:8px;background:color-mix(in oklab, var(--pc) 7%, ${CARD})}
.oc-cghead .nbi{display:inline-grid;place-items:center;width:28px;height:32px}
.oc-cghead .nbi i{width:16px;height:16px;border-radius:4px;background:var(--pc)}
.oc-cghead .nbh{grid-column:2 / -1;display:flex;align-items:flex-start;gap:8px;margin:0;font-size:12px;line-height:1.4}
.oc-cghead .nbh.ok{color:${ink(GREEN)}}
.oc-cghead .nbh.ko{color:${ink(RED)}}
.oc-cghead .nbh svg{flex:0 0 auto;margin-top:1px}
.oc-cg .oc-dg-lab small{margin-left:auto;font-weight:400}
.oc-cg .oc-dg-lab small.near{color:${ink(ORANGE)};font-weight:600}
@container cg (max-width:620px){
  .oc-cghead{grid-template-columns:minmax(0,1fr)}
  .oc-cghead .nb{grid-template-columns:minmax(0,1fr)}
  .oc-cghead .nbi{display:none}
  .oc-cghead .nbh{grid-column:1}
}
/* number fields of the templates (the window's rule styles text fields only) */
.oc-cg input[type=number]{box-sizing:border-box;width:100%;max-width:120px;min-height:32px;padding:4px 8px;font-family:inherit;font-size:12.5px;color:var(--foreground);background:${CARD};border:1px solid ${FIELD_EDGE};border-radius:2.5px}
.oc-cg input[type=number]:focus-visible{${RING_FOCUS}}
/* templates */
.oc-cgtpl{display:flex;flex-direction:column;gap:12px;padding:12px;border:1px solid ${EDGE};border-radius:8px;background:color-mix(in oklab, var(--foreground) 3%, ${CARD})}
.oc-cgtpl .hd{display:flex;align-items:center;gap:8px}
.oc-cgtpl .hd small{color:${T3};font-size:12px;flex:1 1 auto;min-width:0}
.oc-cgtpl .hd .ux-b{margin-left:auto}
.oc-cgtpl .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:8px}
.oc-cgtpl .tc{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0;padding:8px 12px 12px;border:1px solid ${EDGE};border-radius:8px;background:${CARD};color:var(--foreground);font:inherit;text-align:left;cursor:pointer}
.oc-cgtpl .tc b{font-size:12.5px;font-weight:600}
.oc-cgtpl .tc small{font-size:11.5px;color:${T3};line-height:1.35}
.oc-cgtpl .tc:hover{border-color:var(--ui-accent)}
.oc-cgtpl .tc[aria-pressed=true]{border-color:var(--ui-accent);box-shadow:0 0 0 1px var(--ui-accent) inset;background:color-mix(in oklab, var(--ui-accent) 6%, ${CARD})}
.oc-cgtpl .tc:focus-visible{${RING_FOCUS}}
.oc-cgmini{display:block;max-width:100%;height:auto;align-self:center}
.oc-cgmini .ml{stroke:${T3};stroke-width:1.2}
.oc-cgmini .mg{stroke:${ORANGE};stroke-width:2;stroke-dasharray:4 3}
.oc-cgtpl .knobs{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
.oc-cgtpl .knobs .oc-dg-fl{min-width:120px}
.oc-cgtpl .ft{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.oc-cgtpl .ft small{flex:1 1 200px;min-width:0;font-size:12px}
/* view switch (narrow window) */
.oc-cgseg{display:none}
/* body: the cards beside the preview */
.oc-cgbody{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:16px;align-items:start}
.oc-cglist{display:flex;flex-direction:column;gap:12px;min-width:0}
.oc-cgph{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
.oc-cgph .ph{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid ${EDGE};border-radius:8px;background:${CARD}}
.oc-cgph .phh{display:flex;align-items:center;gap:8px}
.oc-cgph .pl{flex:0 0 auto;display:inline-grid;place-items:center;width:24px;height:24px;border-radius:12px;font-size:12px;font-weight:700;color:${ink('var(--ui-accent)')};background:color-mix(in oklab, var(--ui-accent) 14%, ${CARD})}
.oc-cgph .phn{flex:1 1 auto;min-width:0;width:auto!important;font-weight:600!important}
.oc-cgph .phh .n{flex:0 0 auto;font-size:12px;color:${T3}}
.oc-cgph > .ph > .ux-b{align-self:flex-start}
.oc-cgguard{display:flex;align-items:center;gap:8px;min-height:36px;padding:4px 8px 4px 12px;border:1px dashed color-mix(in oklab, ${ORANGE} 70%, transparent);border-radius:8px;background:color-mix(in oklab, ${ORANGE} 8%, ${CARD});color:${ink(ORANGE)}}
.oc-cgguard svg{flex:0 0 auto}
.oc-cgguard .tt{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}
.oc-cgguard .tt b{font-size:12.5px;color:var(--foreground)}
.oc-cgguard .tt small{font-size:11.5px;color:${T3};line-height:1.3}
.oc-cgguard .lockd{flex:0 0 auto;font-size:11px;color:${T3}}
.oc-cgguard.off{border-style:dotted;background:transparent;color:${T3}}
.oc-cgrows{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.oc-cgrow{display:flex;flex-direction:column;border:1px solid ${EDGE};border-radius:8px;background:${CARD};overflow:hidden}
.oc-cgrow.on{border-color:var(--ui-accent);box-shadow:0 0 0 1px var(--ui-accent) inset}
.oc-cgrow .hd{display:flex;align-items:center;gap:4px;padding-right:8px;min-width:0}
.oc-cgrow .sel{position:relative;flex:1 1 auto;display:flex;align-items:center;gap:8px;min-width:0;min-height:52px;padding:8px 8px 8px 16px;border:0;background:none;color:var(--foreground);font:inherit;text-align:left;cursor:pointer}
.oc-cgrow .sel:focus-visible{${RING_FOCUS};border-radius:8px}
.oc-cgrow .stripe{position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--bc, var(--ui-text-tertiary))}
.oc-cgrow .pt{flex:0 0 auto;display:inline-grid;place-items:center;width:28px;height:32px}
.oc-cgrow .cd{flex:0 0 auto;font-size:11px;color:${T3}}
.oc-cgrow .tt{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}
.oc-cgrow .tt b{font-size:12.5px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.oc-cgrow.on .tt b{display:block;-webkit-line-clamp:unset}   /* two lines in the list, the whole title once the card is open; the full title is also the tooltip */
.oc-cgrow .tt b em,.oc-cgg-node .tt em{font-weight:400;font-style:italic;color:${T3}}
.oc-cgrow .tt small{font-size:11.5px;color:${T3};overflow:hidden;text-overflow:ellipsis;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3}   /* wraps instead of being cut: « backend · after 16 cards » at 380 px takes 3 lines in Spanish */
.oc-cgrow .pin,.oc-cgg-node .pin{flex:0 0 auto;display:inline-grid;place-items:center;width:16px;height:16px;border-radius:4px;background:var(--ui-accent);color:var(--ui-accent-fg, var(--background));font-size:10px;font-weight:700}
.oc-cgrow .nob{flex:0 0 auto;display:inline-grid;place-items:center;color:${ink(ORANGE)}}
.oc-cgrow .ed{display:flex;flex-direction:column;gap:12px;padding:12px 16px 16px;border-top:1px solid ${EDGE};background:color-mix(in oklab, var(--foreground) 2.5%, ${CARD})}
.oc-cgrow .two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.oc-cgrow .two select{width:100%}
.oc-cgrow .botsel{display:flex;align-items:center;gap:8px}
.oc-cgrow .botsel canvas{flex:0 0 auto}
.oc-cgrow fieldset{margin:0;padding:0;border:0;min-width:0}
.oc-cgrow legend{padding:0;display:flex;align-items:center;gap:8px}
.oc-cgrow .dep{display:inline-flex;align-items:center;gap:4px;max-width:100%;height:28px;padding:0 8px;border:1px solid ${EDGE};border-radius:14px;background:${CARD};color:var(--foreground);font:inherit;font-size:12px;cursor:pointer}
.oc-cgrow .dep i{width:8px;height:8px;border-radius:2px;background:var(--bc);flex:0 0 auto}
.oc-cgrow .dep span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc-cgrow .dep[aria-pressed=true]{border-color:var(--ui-accent);background:color-mix(in oklab, var(--ui-accent) 12%, ${CARD});font-weight:600}
.oc-cgrow .dep:focus-visible{${RING_FOCUS}}
.oc-cgrow details summary,.oc-cgmodel summary{display:flex;align-items:center;gap:8px;min-height:28px;cursor:pointer;font-size:12px;font-weight:600;list-style:none}
.oc-cgrow details summary::-webkit-details-marker{display:none}
.oc-cgrow details summary svg{transition:transform .12s}
.oc-cgrow details[open] > summary svg{transform:rotate(90deg)}
.oc-cgrow details .sum{margin-left:auto;font-weight:400;font-size:11.5px;color:${T3};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.oc-cgrow details > :not(summary){margin-top:8px}
.oc-cgaddph{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
/* the graph pane */
.oc-cgp{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px;border:1px solid ${EDGE};border-radius:8px;background:${CARD}}
.oc-cgbody .oc-cgp{position:sticky;top:0}
.oc-cgp .gbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.oc-cgp .gbar .sm{font-size:12px;color:${T3}}
.oc-cgg{position:relative;width:100%;min-width:0;border-radius:8px;background:${SUNKEN}}
.oc-cgg-in{position:relative}
.oc-cgg-folds{display:flex;flex-wrap:wrap;gap:4px 8px;padding:8px 8px 0}
.oc-cgg-band{position:absolute;left:8px;right:8px;border-radius:10px;background:color-mix(in oklab, var(--foreground) 3%, transparent)}
.oc-cgg-band.alt{background:color-mix(in oklab, var(--foreground) 6%, transparent)}
.oc-cgg-band .lb{position:absolute;left:4px;top:8px;display:grid;place-items:center;width:20px;height:20px;border-radius:10px;font-size:11px;font-weight:700;color:${T2};background:color-mix(in oklab, var(--foreground) 8%, transparent);cursor:default}
.oc-cgg-edges{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
.oc-cgg-edges .ge{fill:none;stroke:${T3};stroke-width:1.4}
.oc-cgg-edges .ge.g{stroke:${ORANGE};stroke-dasharray:4 3}
.oc-cgg-edges .ge.on{stroke:var(--ui-accent);stroke-width:2;stroke-dasharray:none}
.oc-cgg-edges .am{fill:${T3}}
.oc-cgg-edges .am.on{fill:var(--ui-accent)}
.oc-cgg-node{position:absolute;display:flex;align-items:center;gap:8px;min-width:0;padding:0 8px 0 12px;border:1px solid ${EDGE};border-radius:8px;background:${CARD};color:var(--foreground);font:inherit;text-align:left;overflow:hidden}
button.oc-cgg-node{cursor:pointer}
button.oc-cgg-node:hover{border-color:var(--ui-accent)}
button.oc-cgg-node:focus-visible{${RING_FOCUS}}
.oc-cgg-node.on{border-color:var(--ui-accent);box-shadow:0 0 0 1px var(--ui-accent) inset}
.oc-cgg-node .stripe{position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--bc, var(--ui-text-tertiary))}
.oc-cgg-node .pt{flex:0 0 auto;display:inline-grid;place-items:center;width:28px;height:32px}
.oc-cgg-in.cmp .oc-cgg-node .pt{display:none}
.oc-cgg-node .tx{display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0;flex:1 1 auto}
.oc-cgg-node .l1{display:flex;align-items:baseline;gap:8px;min-width:0}
.oc-cgg-node .cd{flex:0 0 auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:${T3}}
.oc-cgg-node .tt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600}
.oc-cgg-in:not(.cmp) .oc-cgg-node .tt{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-height:1.35;overflow-wrap:anywhere} /* a node of a full-size preview gives its title two lines (« Phase A, car… » at 1440 px); a tighter line-height lets the clamp cut the accent of « É » and show the accents of the hidden 3rd line */
.oc-cgg-node .l2{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.25;color:${T3}}   /* 2 title lines + this one fit in the 52 px node */
.oc-cgg-node.s-archived{opacity:.55}
.oc-cgg-node.grp{overflow:visible;flex-direction:column;align-items:stretch;justify-content:center;gap:4px;padding:4px 12px}
.oc-cgg-node.grp .st{position:absolute;left:0;top:0;right:0;bottom:0;border:1px solid ${EDGE};border-radius:8px;background:${CARD};z-index:-1}
.oc-cgg-node.grp .st1{transform:translate(3px,3px)}
.oc-cgg-node.grp .st2{transform:translate(6px,6px)}
.oc-cgg-node.grp{background:${CARD}}
.oc-cgg-node.grp .top{display:flex;align-items:baseline;gap:8px;min-width:0}
.oc-cgg-node.grp .top .cd{flex:0 0 auto}
.oc-cgg-node.grp .top .tt{flex:1 1 auto}
.oc-cgg-node.grp .n{flex:0 0 auto;font-style:normal;font-size:11px;font-weight:700;color:${T3}}
.oc-cgg-node.grp .seg{display:flex;gap:1px;height:6px;width:min(96px,40%);min-width:0}
.oc-cgg-node.grp .seg i{display:block;min-width:2px;border-radius:2px;background:var(--bc)}
.oc-cgg-node.grp .ws{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:${T3}}
.oc-cgg-in.cmp .oc-cgg-node.grp{padding:2px 12px}
.oc-cgg-in.cmp .oc-cgg-node.grp .ws{display:none}
.oc-cgg-guard{position:absolute;display:flex;align-items:center;justify-content:center}
.oc-cgg-guard .bar{position:absolute;left:0;right:0;top:50%;border-top:2px dashed color-mix(in oklab, ${ORANGE} 75%, transparent)}
.oc-cgg-guard .pill{position:relative;display:inline-flex;align-items:center;gap:8px;max-width:calc(100% - 8px);height:28px;padding:0 12px;border:1px solid ${ORANGE};border-radius:14px;background:color-mix(in oklab, ${ORANGE} 14%, ${CARD});color:${ink(ORANGE)};font-size:12px}
.oc-cgg-guard .pill svg{flex:0 0 auto}
.oc-cgg-guard .pill b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.oc-cgg-guard .pill em{flex:0 0 auto;font-style:normal;font-size:11px;color:${T3}}
/* the bots of the graph */
.oc-cgl{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.oc-cgl li{display:inline-flex;align-items:center;gap:8px;min-height:28px;padding:0 8px 0 4px;border:1px solid ${EDGE};border-radius:14px;font-size:12px}
.oc-cgl li i{width:4px;height:16px;border-radius:2px;background:var(--bc)}
.oc-cgl li canvas{flex:0 0 auto}
.oc-cgl li span{font-size:11px;color:${T3}}
/* review */
.oc-cgrev{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,300px);gap:16px;align-items:start}
.oc-cgsum{display:flex;flex-direction:column;gap:12px;min-width:0;padding:12px;border:1px solid ${EDGE};border-radius:8px;background:${CARD}}
.oc-cgsum h4{margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${T3}}
.oc-cgsum p{margin:0;font-size:12.5px;line-height:1.4;overflow-wrap:anywhere}
.oc-cgsum .mut{color:${T3}}
.oc-cgsum .small{font-size:12px}
.oc-cgsum .big{display:flex;align-items:baseline;gap:8px}
.oc-cgsum .big b{font-size:22px;line-height:1}
.oc-cgsum .bl{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}
.oc-cgsum .bl li{display:flex;align-items:center;gap:8px;font-size:12.5px}
.oc-cgsum .bl li i{width:4px;height:16px;border-radius:2px;background:var(--bc)}
.oc-cgsum .bl li span{margin-left:auto;color:${T3}}
.oc-cgsum .gd,.oc-cgsum .after p{display:flex;align-items:flex-start;gap:8px}
.oc-cgsum .gd svg,.oc-cgsum .after svg{flex:0 0 auto;margin-top:2px;color:${ink(ORANGE)}}
.oc-cgsum .ux-prj.nw{border-style:dashed}
.oc-cgsum .ux-prj{max-width:100%} /* the project the review names is never cut at the 140 px of the page's chips */
.oc-cgsum .after{padding-top:12px;border-top:1px solid ${EDGE}}
/* created */
.oc-cgcre{display:flex;flex-direction:column;gap:12px}
.oc-cgban{display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border:1px solid ${EDGE};border-radius:8px}
.oc-cgban > svg{flex:0 0 auto;margin-top:2px}
.oc-cgban div{display:flex;flex-direction:column;gap:4px;min-width:0}
.oc-cgban b{font-size:13px}
.oc-cgban span{font-size:12.5px;line-height:1.4;overflow-wrap:anywhere}
.oc-cgban.ok{border-color:color-mix(in oklab, ${GREEN} 60%, transparent);background:color-mix(in oklab, ${GREEN} 9%, ${CARD})}
.oc-cgban.ok > svg{color:${ink(GREEN)}}
.oc-cgban.nt{background:color-mix(in oklab, var(--foreground) 4%, ${CARD})}
.oc-cgkp{display:flex;flex-wrap:wrap;gap:8px}
.oc-cgkp .k{display:flex;flex-direction:column;gap:2px;min-width:96px;padding:8px 16px;border:1px solid ${EDGE};border-radius:8px;background:${CARD}}
.oc-cgkp .k b{font-size:20px;line-height:1.1}
.oc-cgkp .k small{font-size:11.5px;color:${T3}}
.oc-cgkp .k.ready b{color:${ink(GREEN)}}
.oc-cgkp .k.guard b{color:${ink(ORANGE)}}
.oc-cggo{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.oc-cggo .go{flex:1 1 320px;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 16px;border:1px solid ${EDGE};border-radius:8px;background:${CARD}}
.oc-cggo .go > div{flex:1 1 200px;display:flex;flex-direction:column;gap:2px;min-width:0}
.oc-cggo .go small{font-size:12px;color:${T3};line-height:1.4;overflow-wrap:anywhere}
.oc-cgwhere{display:flex;align-items:flex-start;gap:8px;margin:0;font-size:12px;color:${T3};line-height:1.4}
.oc-cgwhere svg{flex:0 0 auto;margin-top:1px}
.oc-cg .ux-b.danger{color:${ink(RED)};border-color:color-mix(in oklab, ${RED} 55%, ${EDGE})}
.oc-cg .ux-b.danger:hover{background:color-mix(in oklab, ${RED} 8%, ${CARD});border-color:${RED}}
.oc-cg .ux-b[aria-disabled=true]{opacity:.5;cursor:default}
.oc-cg .ux-b.ico{width:32px;padding:0}
.oc-cg .ux-b.ghost{background:transparent}
/* foot: the checks and the draft's reset */
.oc-cgchk{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 12px;font-size:12px}
.oc-cgchk .ck{display:inline-flex;align-items:center;gap:4px}
.oc-cgchk .ck.ok{color:${ink(GREEN)}}
.oc-cgchk .ck.ko{color:${ink(RED)}}
.oc-cgchk .miss{color:var(--ui-text-secondary)}
/* the first, empty phase: where to start */
.oc-cgstart{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px dashed ${EDGE};border-radius:8px}
.oc-cgstart p{margin:0;font-size:12.5px;line-height:1.4}
.oc-cgstart .acts{display:flex;flex-wrap:wrap;gap:8px}
.oc-tpl-result{font-weight:600;color:var(--foreground)}
/* the composing step keeps one height whatever is open (the templates panel used to move the whole window) */
.oc-dg.oc-cg-dlg[data-step="compose"]{height:min(760px,calc(100dvh - 32px))}
.oc-cgclr{display:inline-flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px}
.oc-cg-dlg .oc-dg-fa .oc-btn[aria-disabled=true]{opacity:.5;cursor:default}
/* narrow window: one view at a time, the review's summary under the graph */
@container cg (max-width:760px){
  .oc-cgseg{display:block}
  .oc-cgbody{grid-template-columns:minmax(0,1fr)}
  .oc-cgbody.m-list .oc-cgp,.oc-cgbody.m-graph .oc-cglist{display:none}
  .oc-cgbody .oc-cgp{position:static}
  .oc-cgrev{grid-template-columns:minmax(0,1fr)}
  .oc-cgrow .two{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:560px){
  .oc-cgph .ph{padding:8px}
  .oc-cgrow .ed{padding:12px}
  .oc-cgp{padding:8px}
}
@media (prefers-reduced-motion:reduce){.oc-cgrow details summary svg{transition:none}}
/* violet = written by a model; the panel, the marks, the rewritten instructions, the review. Only drawn when a function is on. */
.oc-cghead .tplb .oc-lm-tb{display:flex;gap:8px;flex-wrap:wrap}
.oc-cg .ux-b.oc-lm-b{border-color:color-mix(in oklab, ${VIOLET} 55%, ${EDGE});color:${VIOLET_INK};background:color-mix(in oklab, ${VIOLET} 6%, ${CARD})}
.oc-cg .ux-b.oc-lm-b:hover{background:color-mix(in oklab, ${VIOLET} 13%, ${CARD})}
.oc-lm-cg{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;border:1px solid color-mix(in oklab, ${VIOLET} 40%, ${EDGE});background:linear-gradient(135deg, color-mix(in oklab, ${VIOLET} 8%, ${CARD}), ${CARD} 70%);min-width:0}
.oc-lm-cg>small,.oc-lm-cg .oc-lm-foot small{color:${T3};font-size:12px}
.oc-lm-cg textarea{resize:vertical}
.oc-lm-ic{width:32px;height:32px;border-radius:8px;display:inline-grid;place-items:center;flex:0 0 auto;color:${VIOLET_INK};background:color-mix(in oklab, ${VIOLET} 13%, ${CARD});border:1px solid color-mix(in oklab, ${VIOLET} 30%, ${EDGE})}
.oc-lm-meta{margin-left:auto;font-size:11.5px;color:${T3};overflow-wrap:anywhere;text-align:right;text-wrap:balance}
.oc-lm-t{font-size:12px;color:${T3}}
.oc-lm-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.oc-lm-foot .grow,.oc-lm-ah .grow{flex:1 1 auto}
.oc-lm-warn{color:${ink(ORANGE)}!important}
.oc-lm-sum{display:flex;gap:12px;align-items:center;min-width:0}
.oc-lm-sum .mini{flex:0 0 auto;border-radius:8px;background:${SUNKEN};display:inline-flex;padding:4px}
.oc-lm-sum p{margin:0;display:flex;flex-direction:column;gap:4px;font-size:12.5px;min-width:0}
.oc-lm-sum small{color:${T3};font-size:12px}
.oc-lm-mini .mg{stroke:${ORANGE};stroke-width:2;stroke-dasharray:4 3}
.oc-lm-cg .oc-dg-seg{align-self:flex-start;max-width:100%;flex-wrap:wrap}
.oc-lm-confirm{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;border:1px solid color-mix(in oklab, ${ORANGE} 45%, ${EDGE});background:color-mix(in oklab, ${ORANGE} 7%, ${CARD});font-size:12.5px}
.oc-lm-confirm span{flex:1 1 200px;min-width:0}
.oc-lm-cg .oc-lm-ref{margin:0}
.oc-lm-cg em{color:${T3}}
/* the mark of a card in the list, in the graph, in the legend */
.oc-lm-dot{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:10px;flex:0 0 auto;color:${VIOLET_INK};background:color-mix(in oklab, ${VIOLET} 13%, transparent)}
.oc-cgg-node.lm{border-style:dashed;border-color:color-mix(in oklab, ${VIOLET} 70%, ${EDGE})}
.oc-cgg-node.lm.on{border-style:solid;border-color:var(--ui-accent)}
.oc-cgl li.oc-cglm{color:${VIOLET_INK};font-weight:600}
.oc-cgl li.oc-cglm i{width:16px;height:10px;border-radius:3px;border:1.5px dashed ${VIOLET};background:transparent}
.oc-cgrow .oc-dg-lab .oc-lm-mk,.oc-cgrow legend .oc-lm-mk{margin-left:8px}
.oc-cgrow .oc-dg-lab small+.oc-lm-mk{margin-left:8px}
/* « Rewrite the instructions » */
.oc-lm-erow{display:flex;flex-direction:column;align-items:flex-end;gap:8px;margin-top:-4px}
.oc-lm-erow .oc-lm-ref{align-self:stretch}
.oc-lm-wait{display:flex;flex-wrap:wrap;align-items:center;gap:8px;align-self:stretch}
.oc-lm-wait .oc-lm-prog{flex:1 0 100%}
.oc-lm-wait small{flex:1 1 auto;color:${T3};font-size:12px}
.oc-lm-bd{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:10px;border:1px solid color-mix(in oklab, ${VIOLET} 40%, ${EDGE});background:color-mix(in oklab, ${VIOLET} 5%, ${CARD});min-width:0}
.oc-lm-bd textarea{box-sizing:border-box;width:100%;font-size:12.5px;line-height:1.5;resize:vertical;field-sizing:content;min-height:6lh;max-height:22lh}   /* criteria and proof are the last lines: shown, not under the fold */
.oc-lm-old summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:${T3};min-height:24px}
.oc-lm-old summary::-webkit-details-marker{display:none}
.oc-lm-old summary svg{transition:transform .12s}
.oc-lm-old[open] summary svg{transform:rotate(90deg)}
.oc-lm-old p{margin:4px 0 0;font-size:12px;color:${T3};line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto}
.oc-lm-bd .oc-lm-act{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.oc-lm-bd .oc-lm-act small{flex:1 1 100%;min-width:0;color:${T3};font-size:12px}
.oc-lm-bd .oc-lm-act .oc-lm-meta{margin:0;flex:1 1 auto;min-width:0;text-align:left}
.oc-lm-bd .oc-lm-btns{display:flex;gap:8px;margin-left:auto}
.oc-lm-mk-static{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;margin-left:8px;border-radius:10px;font:600 11px/1 inherit;color:${VIOLET_INK};background:color-mix(in oklab, ${VIOLET} 13%, transparent)}
@media (prefers-reduced-motion:reduce){.oc-lm-old summary svg{transition:none}}
/* the review before launch, at the top of the summary */
.oc-lm-lint{display:flex;flex-direction:column;gap:8px;padding-bottom:12px;border-bottom:1px solid ${EDGE}}
.oc-lm-lint h4{display:flex;align-items:center;gap:8px}
.oc-lm-lint h4>svg{color:${VIOLET_INK}}
.oc-lm-lint h4 .grow{flex:1 1 auto}
.oc-cgsum .oc-lm-lsub{color:${T3};font-size:12px}
.oc-lm-lint .oc-lm-note{color:${T3};font-size:12px}
.oc-lm-lint .oc-lm-lmeta{color:${T3};font-size:11px;overflow-wrap:anywhere}
.oc-lm-lint .oc-lm-mini2{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.oc-lm-lint .oc-lm-mini2 .oc-lm-prog{flex:1 0 100%}
.oc-lm-lint .oc-lm-mini2 small{flex:1 1 auto;color:${T3};font-size:12px}
.oc-lm-lint .ux-b{align-self:flex-start}
.oc-lm-fl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.oc-lm-lf{width:100%;display:flex;flex-direction:column;align-items:stretch;gap:4px;padding:8px 8px 8px 12px;border-radius:8px;border:0;background:${CARD};cursor:pointer;text-align:left;font:inherit;color:inherit;box-shadow:inset 3px 0 0 var(--sv, ${T3}), inset 0 0 0 1px ${EDGE}}
.oc-lm-lf:hover{background:color-mix(in oklab, var(--foreground) 4%, ${CARD})}
.oc-lm-lf[aria-pressed=true]{box-shadow:inset 3px 0 0 var(--sv), inset 0 0 0 2px var(--ui-accent);background:color-mix(in oklab, var(--ui-accent) 7%, ${CARD})}
.oc-lm-lf:focus-visible{${RING_FOCUS}}
.oc-lm-lf.high{--sv:${RED}}.oc-lm-lf.medium{--sv:${ORANGE}}.oc-lm-lf.low{--sv:${T3}}
.oc-lm-lf .lft{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;font-size:11.5px;line-height:16px;min-width:0}
.oc-lm-lf .sev{display:inline-flex;align-items:center;gap:4px;font-weight:700;color:${ink('var(--sv)')}}
.oc-lm-lf .code{font-weight:700;color:var(--ui-text-secondary)}
.oc-lm-lf .kd{color:${T3};font-weight:600}
.oc-lm-lf .tx{font-size:12px;line-height:16px;color:var(--ui-text-secondary);overflow-wrap:anywhere}
`
