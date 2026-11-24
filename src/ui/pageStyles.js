/**
 * The page's frame: header, alert rail, stage + dock of
 * projects, details panel with four tabs, decision cards and their orders, popovers, bottom tab bar of a narrow pane.
 * Theme variables only (the only colours outside src/scene/ are the host's). A project's colour arrives as `--pc` on the element
 * (src/ui/ProjectChip.jsx). 4 px grid: margins, gaps, paddings and control heights are multiples of 4 (traits of 1-2 px apart).
 * Container queries follow the PANE the plugin gets (not the window): the same widths as src/core/tabs.js (700), then 980 and 1320.
 */
import { CARD, EDGE, ON_ACCENT, RING_FOCUS, SUNKEN, VIOLET } from './tokens.js'

const T2 = 'var(--ui-text-secondary)'
const T3 = 'color-mix(in oklab, var(--ui-text-secondary) 55%, var(--ui-text-tertiary))'   // holds 4.5:1 on the card, both themes
const ORANGE = 'var(--ui-orange, var(--ui-accent))'
const GREEN = 'var(--ui-green, var(--ui-accent))'
const RED = 'var(--ui-red, var(--destructive, var(--ui-orange)))'
const ink = hue => `color-mix(in oklab, ${hue} 55%, var(--foreground))`

export const PAGE_CSS = `
.ux{container-type:inline-size;container-name:ux}
.ux *{box-sizing:border-box}
.ux-i{flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ux-vh{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ux-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
/* ---------- buttons: one family (32 / 28 px, radius 6, weight 500) ---------- */
.ux-b{display:inline-flex;align-items:center;justify-content:center;gap:8px;flex:0 0 auto;height:32px;padding:0 12px;border-radius:6px;border:1px solid var(--ui-stroke-secondary);background:${CARD};color:var(--foreground);font:inherit;font-size:12.5px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .12s,border-color .12s,transform .12s}
.ux-b:hover{border-color:var(--ui-accent);background:color-mix(in oklab, var(--ui-accent) 7%, ${CARD})}
.ux-b:active{transform:translateY(1px)}
.ux-b:focus-visible,.ux-tab:focus-visible,.ux-pj:focus-visible,.ux-al:focus-visible,.ux-lvp:focus-visible,.ux-game:focus-visible,.ux-help:focus-visible,.ux-seg button:focus-visible,.ux-bar button:focus-visible,.ux-rosterb:focus-visible,.ux-lnk:focus-visible{${RING_FOCUS}}
.ux-b.pri{background:var(--ui-accent);border-color:var(--ui-accent);color:${ON_ACCENT}}
.ux-b.pri:hover{background:color-mix(in oklab, var(--ui-accent) 86%, var(--foreground))}
.ux-b.ghost{border-color:transparent;background:transparent}
.ux-b.ghost:hover{background:${CARD};border-color:var(--ui-stroke-secondary)}
.ux-b.sm{height:28px;padding:0 12px;font-size:12px}
.ux-b.ico{width:32px;padding:0}
.ux-b.sm.ico{width:28px}
.ux-b[aria-pressed="true"],.ux-b[aria-expanded="true"]{background:color-mix(in oklab, var(--ui-accent) 12%, ${CARD});border-color:color-mix(in oklab, var(--ui-accent) 55%, var(--ui-stroke-secondary))}
.ux-b[aria-disabled="true"]{opacity:.5;cursor:default}
.ux-b[aria-disabled="true"]:hover{border-color:var(--ui-stroke-secondary);background:${CARD}}
.ux-b.pri[aria-disabled="true"]:hover{background:var(--ui-accent);border-color:var(--ui-accent)}
/* « ? »: 24 px target (WCAG 2.5.8), 20 px drawn */
.ux-helpwrap{display:inline-flex;flex:0 0 auto}
.ux-help{display:inline-grid;place-items:center;flex:0 0 auto;width:24px;height:24px;padding:0;margin:0;border:0;border-radius:50%;background:transparent;color:${T3};font:inherit;font-size:11px;font-weight:700;cursor:pointer;position:relative}
.ux-help::before{content:"";position:absolute;inset:2px;border-radius:50%;border:1px solid var(--ui-stroke-secondary)}
.ux-help:hover,.ux-help[aria-expanded="true"]{color:var(--ui-accent)}
.ux-help:hover::before,.ux-help[aria-expanded="true"]::before{border-color:var(--ui-accent)}
/* ---------- risk class of an order: a neutral pip in the colour of the button's text. Filled = final, hollow = no risk, half = reversible.
   Never a triangle (reads « danger ») nor a tick (reads « validate », wrong on « Refuse »). The word is for the screen reader. ---------- */
.ux-rk{position:relative;display:inline-block;flex:0 0 auto;width:8px;height:8px;border-radius:50%;opacity:.8}
.ux-rk-final{background:currentColor}
.ux-rk-safe{box-shadow:inset 0 0 0 1.5px currentColor}
.ux-rk-rev{box-shadow:inset 0 0 0 1.5px currentColor;background:linear-gradient(90deg, currentColor 50%, transparent 50%)}
.ux-riskchip{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap}
.ux-riskchip.final{color:${ink(RED)};background:color-mix(in oklab, ${RED} 11%, transparent)}
.ux-riskchip.safe{color:${ink(GREEN)};background:color-mix(in oklab, ${GREEN} 11%, transparent)}
.ux-riskchip.rev{color:${ink('var(--ui-accent)')};background:color-mix(in oklab, var(--ui-accent) 11%, transparent)}
/* ---------- project chip: the island's colour + the name, always written ---------- */
.ux-prj{display:inline-flex;align-items:center;gap:4px;flex:0 1 auto;height:20px;max-width:140px;padding:0 8px;border-radius:10px;font-size:11px;font-weight:600;color:var(--foreground);background:color-mix(in oklab, var(--pc) 16%, ${CARD});border:1px solid color-mix(in oklab, var(--pc) 45%, ${EDGE})}
.ux-prj i{width:8px;height:8px;flex:0 0 auto;border-radius:2px;background:var(--pc)}
.ux-prj > span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ux-prjx{height:28px;padding:0 8px 0 12px;border-radius:14px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;max-width:200px}
.ux-prjx .ux-i{color:${T3}}
.ux-prjx:hover .ux-i{color:var(--foreground)}
.ux-sdot{display:inline-block;width:8px;height:8px;flex:0 0 auto;border-radius:50%;background:currentColor}
.ux-st{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;white-space:nowrap}
.ux-st-working{color:${ink('var(--ui-accent)')}}.ux-st-waiting{color:${ink(ORANGE)}}.ux-st-active{color:${ink(GREEN)}}.ux-st-idle,.ux-st-new,.ux-st-unknown,.ux-st-stale{color:${T3}}
/* same grammar as the legend of the halos: resting (no halo) = empty ring, silent = filled grey disc */
.ux-st-idle .ux-sdot,.ux-st-new .ux-sdot,.ux-st-unknown .ux-sdot{background:transparent;box-shadow:inset 0 0 0 1.5px currentColor}
.ux-st-working .ux-sdot{background:var(--ui-accent)}.ux-st-waiting .ux-sdot{background:${ORANGE}}.ux-st-active .ux-sdot{background:${GREEN}}
/* ---------- header: one row ---------- */
.ux-top{display:flex;align-items:center;gap:16px;min-height:44px;flex:0 0 auto;min-width:0}
.ux-brand{display:flex;align-items:center;gap:12px;flex:0 1 auto;min-width:32px}
.ux-brand .mk{display:grid;place-items:center;flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:var(--ui-accent);color:${ON_ACCENT}}
.ux-brand h1{margin:0;min-width:0;font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--foreground)}
.ux-live{display:flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0}   /* the header yields by folding words (container queries below); if a row is still too long the title, then the word of the decisions pill, are cut: never the actions nor the gear */
.ux-lvp.dec{min-width:0}
.ux-lvp.dec .w{min-width:0;overflow:hidden;text-overflow:ellipsis}
.ux-lvp{display:inline-flex;align-items:center;gap:8px;height:28px;padding:0 12px;border-radius:14px;border:1px solid ${EDGE};background:${CARD};color:var(--foreground);font:inherit;font-size:12.5px;line-height:1;white-space:nowrap;cursor:pointer}
.ux-lvp b{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
.ux-lvp:hover{border-color:var(--ui-accent)}
.ux-lvp.working b{color:${ink('var(--ui-accent)')}}
.ux-lvp.warn{border-color:color-mix(in oklab, ${ORANGE} 60%, ${EDGE});background:color-mix(in oklab, ${ORANGE} 9%, ${CARD})}
.ux-lvp.warn b{color:${ink(ORANGE)}}
.ux-pulse{width:8px;height:8px;flex:0 0 auto;border-radius:50%;background:var(--ui-accent);animation:ux-pulse 2s ease-out infinite}
.ux-pulse.off{animation:none;background:${T3}}
@keyframes ux-pulse{0%{box-shadow:0 0 0 0 color-mix(in oklab, var(--ui-accent) 55%, transparent)}70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
.ux-sp{flex:1 1 auto;min-width:0}
/* the game badge: three segments of the same structure (icon + value over its caption), centred on one axis, 40 px */
.ux-game{display:inline-flex;align-items:stretch;flex:0 0 auto;box-sizing:border-box;height:32px;padding:0;border:1px solid color-mix(in oklab, ${ORANGE} 35%, ${EDGE});border-radius:12px;overflow:hidden;background:linear-gradient(180deg, color-mix(in oklab, ${ORANGE} 9%, ${CARD}), ${CARD});color:var(--foreground);font:inherit;cursor:pointer;text-align:left}
.ux-game:hover{border-color:${ORANGE}}
.ux-gs{display:inline-flex;align-items:center;gap:8px;padding:0 12px;white-space:nowrap;min-height:0}
.ux-gs + .ux-gs{border-left:1px solid color-mix(in oklab, ${ORANGE} 22%, ${EDGE})}
.ux-g2{display:flex;flex-direction:column;justify-content:center;gap:1px}
.ux-g2 b{font-size:12.5px;line-height:14px;font-weight:700}
.ux-g2 b .of{font-weight:500;color:${T3}}
.ux-g2 small{font-size:11px;line-height:12px;color:${T3}}
.ux-g2b{display:flex;align-items:center;gap:8px;line-height:12px}
.ux-mbar{display:block;flex:0 0 auto;width:56px;height:4px;border-radius:2px;background:${SUNKEN};overflow:hidden}
.ux-mbar i{display:block;height:100%;background:linear-gradient(90deg, ${ORANGE}, color-mix(in oklab, ${ORANGE} 60%, ${RED}))}
.ux-acts{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.ux-acts .sep{width:1px;height:24px;background:${EDGE};margin:0 4px}
.ux-acts .only-n{display:none}
.ux-acts .ux-b .lb{display:none}
.ux-acts .ux-b:not(.ico){width:32px;padding:0}
.ux-menu{position:relative}
/* ---------- the rail of alerts: one line of chips, the detail on demand ---------- */
.ux-alerts{display:flex;align-items:center;gap:8px;align-self:stretch;flex:0 0 auto;min-width:0}   /* not clipped (the focus ring of a chip shows): what does not fit folds into « +N » */
.ux-alerts:empty{display:none}
.ux-alw{display:inline-flex;flex:0 0 auto;min-width:0;max-width:100%}
.ux-al{display:inline-flex;align-items:center;gap:8px;min-width:0;height:28px;padding:0 8px 0 12px;border-radius:14px;border:1px solid ${EDGE};background:${CARD};color:var(--foreground);font:inherit;font-size:12.5px;line-height:1;white-space:nowrap;cursor:pointer}
.ux-al > span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.ux-al.crit{border-color:color-mix(in oklab, ${RED} 55%, ${EDGE});background:color-mix(in oklab, ${RED} 8%, ${CARD})}
.ux-al.crit .ux-i:first-child{color:${RED}}
.ux-al.warn{border-color:color-mix(in oklab, ${ORANGE} 55%, ${EDGE})}
.ux-al.warn .ux-i:first-child{color:${ORANGE}}
.ux-al.info{border-style:dashed;color:${T2}}
.ux-al .chev{color:${T3}}
/* ---------- main: the stage (scene + dock) and the panel ---------- */
.ux-main{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:12px;flex:1 1 auto;min-width:0;min-height:0}
.ux-main.nopanel{grid-template-columns:minmax(0,1fr)}
.ux-stage{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid ${EDGE};border-radius:12px;overflow:hidden;background:${CARD}}
.ux-stage .oc-box{flex:1 1 auto;border:0;border-radius:0;padding:8px 0 4px}
.ux-stage .oc-box.oc-listing{padding:8px 12px}
.ux-stage .oc-rp-tag{z-index:3}
.ux-dock{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:0 0 auto;min-width:0;padding:8px 12px;border-top:1px solid ${EDGE};background:color-mix(in oklab, var(--foreground) 3%, ${CARD})}
/* a small basis, so the selected-agent bar wraps under the chips of a 390 px stage instead of squeezing their names to 0 px */
.ux-dk-l{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:1 1 240px;min-width:0}
.ux-pj{display:inline-flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0;height:32px;padding:0 12px 0 8px;border-radius:8px;border:1px solid ${EDGE};background:${CARD};color:var(--foreground);font:inherit;font-size:12.5px;line-height:1;white-space:nowrap;cursor:pointer;transition:border-color .12s,background-color .12s,box-shadow .12s}
.ux-pj b{min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.ux-pj:hover{border-color:var(--pc)}
.ux-pj[aria-pressed="true"]{border-color:var(--pc);background:color-mix(in oklab, var(--pc) 14%, ${CARD});box-shadow:inset 3px 0 0 var(--pc)}
.ux-pj .ux-ring{flex:0 0 auto;width:20px;height:20px}
.ux-ring-bg{stroke:${SUNKEN}}
.ux-ring-fg{stroke:var(--pc)}
.ux-pj .n{color:${T3}}
.ux-pj .wb{display:inline-flex;align-items:center;gap:4px;color:${ink(ORANGE)};font-weight:700;font-size:12px}
.ux-pj.all{--pc:var(--ui-accent)}
.ux-pj.all .ux-i{color:${T2}}
.ux-sel{display:flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0;padding-left:8px;border-left:1px solid ${EDGE}}
.ux-sel>b{font-size:12.5px;max-width:14ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ux-sel .hint{font-size:12px;color:${T3};white-space:nowrap}
.ux-sel .oc-portrait{width:24px;height:24px;border-radius:6px;border:0}
/* ---------- the panel: four tabs (WAI-ARIA tab list), one scrolling body ---------- */
.ux-panel{display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid ${EDGE};border-radius:12px;background:${CARD};color:var(--foreground);overflow:hidden}
.ux-tabs{display:flex;gap:4px;flex:0 0 auto;padding:4px 12px 0;border-bottom:1px solid ${EDGE}}
.ux-tab{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:1 1 auto;min-width:0;height:36px;padding:0 8px;border:0;border-radius:6px 6px 0 0;background:transparent;color:${T3};font:inherit;font-size:12.5px;font-weight:600;white-space:nowrap;cursor:pointer}
.ux-tab:hover{color:var(--foreground);background:color-mix(in oklab, var(--foreground) 5%, transparent)}
.ux-tab[aria-selected="true"]{color:var(--foreground)}
.ux-tab[aria-selected="true"]::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;background:var(--ui-accent)}
.ux-n{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 4px;border-radius:10px;background:${SUNKEN};color:${T2};font-size:11px;font-weight:600}
.ux-n.warn{background:${ink(ORANGE)};color:${CARD}}
.ux-pbody{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable;scrollbar-color:var(--ui-stroke-secondary) transparent;padding:12px 4px 12px 12px}
.ux-pbody:focus-visible{outline:2px solid var(--ui-accent);outline-offset:-2px}
.ux-pbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px}
.ux-pbar .lbl{font-size:12px;color:${T3}}
.ux-pbar .grow{margin-left:auto}
/* under a project filter the chip and the single « ? » stay on the sort line (the word « Sort » is kept for the screen reader only): the chip gives way, not the line */
.ux-pbar.flt{flex-wrap:nowrap}
.ux-pbar.flt .ux-prjx{flex:0 1 auto;min-width:0;max-width:none}
.ux-pbar.flt .ux-seg{flex:0 0 auto}
.ux-seg{display:inline-flex;padding:4px;border:0;border-radius:8px;background:color-mix(in oklab, var(--foreground) 4%, ${CARD});box-shadow:inset 0 0 0 1px ${EDGE}}
.ux-seg button{height:24px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:${T2};font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.ux-seg button[aria-pressed="true"]{background:${CARD};color:var(--foreground);font-weight:600;box-shadow:0 1px 2px color-mix(in oklab, var(--foreground) 14%, transparent)}
.ux-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:28px 12px;text-align:center;color:${T3};font-size:12.5px}
.ux-empty .ux-i{color:${T3}}
/* the page with no agent — a card centred in the stage, the three things that make the office live, the button that starts it */
.ux-void{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:12px;width:min(480px,100%);margin:auto;padding:32px 24px;text-align:center;border:1px dashed ${EDGE};border-radius:16px;background:color-mix(in oklab, var(--foreground) 3%, ${CARD})}
.ux-void-art{display:grid;place-items:center;width:96px;height:96px;border-radius:20px;background:color-mix(in oklab, var(--ui-accent) 10%, ${CARD});border:1px solid ${EDGE}}
.ux-void h2{margin:0;font-size:18px;line-height:24px;font-weight:700}
.ux-void .lead{margin:0;color:${T2};font-size:13px;line-height:20px}
.ux-void-steps{display:flex;flex-direction:column;gap:8px;margin:4px 0;padding:0;list-style:none;text-align:left;width:100%}
.ux-void-steps li{display:flex;align-items:center;gap:12px;padding:8px 12px;border:1px solid ${EDGE};border-radius:8px;background:${CARD};font-size:12.5px;line-height:16px}
.ux-void-steps .n{flex:0 0 auto;display:grid;place-items:center;width:24px;height:24px;border-radius:12px;font-weight:700;font-size:12px;background:var(--ui-accent);color:${ON_ACCENT}}
.ux-void .hint{margin:0;color:${T3};font-size:12px}
.ux-void .hint{font-family:var(--font-mono, ui-monospace, monospace)}
.ux-more{margin:8px 0 0;font-size:12px;color:${T3}}
/* group header of a project */
.ux-grp{display:flex;align-items:center;gap:8px;margin:16px 0 8px;font-size:12px;font-weight:700;line-height:16px}
.ux-grp:first-of-type{margin-top:4px}
.ux-grp .sq{width:12px;height:12px;flex:0 0 auto;border-radius:3px;background:var(--pc)}
.ux-grp .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ux-grp .n{flex:0 0 auto;color:${T3};font-weight:500}
.ux-grp .ln{flex:1 1 auto;min-width:8px;height:1px;background:linear-gradient(90deg, color-mix(in oklab, var(--pc) 50%, ${EDGE}), transparent)}
/* decision card: project stripe, code + age, title, who, orders */
.ux-dcl{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.ux-dc{position:relative;display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px 12px 12px 16px;border:1px solid ${EDGE};border-radius:10px;background:${CARD};animation:ux-in .16s ease both}
.ux-dc::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:10px 0 0 10px;background:var(--pc)}
.ux-dc:hover{border-color:color-mix(in oklab, var(--pc) 50%, ${EDGE})}
.ux-dc.target{box-shadow:0 0 0 2px color-mix(in oklab, var(--ui-accent) 55%, transparent)}
.ux-dc[data-unverified]{border-style:dashed}
@keyframes ux-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.ux-dc-top{display:flex;align-items:center;gap:8px;min-width:0;min-height:20px}
.ux-dc-top .code{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:${T2}}
.ux-kind{flex:0 0 auto;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${ink(VIOLET)}}
.ux-age{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;margin-left:auto;font-size:11.5px;color:${T3};white-space:nowrap}
.ux-age.old{color:${ink(ORANGE)};font-weight:600}
/* the title and the « open » icons at its right (the first line, when there is one, only holds the project and the code) */
.ux-dc-th{display:flex;align-items:flex-start;gap:8px;min-width:0}
.ux-dc-tt{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:8px}
.ux-dc-th .ux-b.op{margin:-4px -4px -4px 0;color:${T3}}
.ux-dc-th .ux-b.op:hover{color:var(--foreground)}
.ux-dc-t{margin:0;font-size:13.5px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.ux-dc-t.whole{display:block;-webkit-line-clamp:unset;overflow:visible}
.ux-dc-more{align-self:flex-start;font-size:12px}
/* the reason the bot gave when it blocked the card: two lines, in the secondary text colour, set off by a thin rule; plain text, never a link */
.ux-dc-r{margin:0;padding:0 0 0 8px;border-left:2px solid color-mix(in oklab, var(--pc) 55%, ${EDGE});font-size:12px;line-height:1.4;color:${T2};display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.ux-dc-r.whole{display:block;-webkit-line-clamp:unset;overflow:visible}
.ux-dc-s{margin:0;font-size:12px;line-height:1.4;color:${T2};display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.ux-dc-c{margin:0;min-width:0;font-size:11.5px;line-height:1.4;color:${T2};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:ltr}
.ux-dc-who{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;color:${T2}}
.ux-dc-who .oc-portrait{width:20px;height:20px;border-radius:5px;border:0}
.ux-dc-who .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ux-dc-who .role{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${T3}}
.ux-dc-pin{display:inline-flex;align-items:center;gap:4px;min-width:0;font-size:11px;color:${ink('var(--ui-accent)')}}
.ux-dc-pin > span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ux-dc-o{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:4px}
.ux-dc-o .ux-b{flex:0 0 auto}
.ux-dc-o .more{margin-left:auto}
/* « Cancel the campaign »: the secondary, discreet button, pushed to the right of « Launch »; « Cancel » alone when the card is narrow (the full words stay its name) */
.ux-dc-o .ux-b.cx{margin-left:auto;color:${T2}}
.ux-dc-o .ux-b.cx .short{display:none}
.ux-dc-o .ux-b.sm:not(.ico){padding:0 8px}
.ux-ch-extra{display:flex;flex-wrap:wrap;gap:8px}
.ux-slot:empty{display:none}
.ux-slot{display:block}
/* the confirmation, the draft and the 6 s window live IN the card */
.ux-cf{display:flex;flex-direction:column;gap:8px;padding:8px 12px;border-radius:8px;background:color-mix(in oklab, var(--foreground) 4%, ${CARD});border:1px solid ${EDGE};animation:ux-in .14s ease both}
.ux-cf p{margin:0;font-size:12.5px;overflow-wrap:anywhere}
.ux-cf .ctitle{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ux-cmd{display:flex;flex-direction:column;gap:4px;min-width:0}
.ux-cmd .lbl{font-size:11.5px;font-weight:600;color:${T2}}
.ux-cmd-x{box-sizing:border-box;max-width:100%;max-height:min(168px,30vh);margin:0;padding:8px;overflow-x:hidden;overflow-y:auto;font-size:12px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;direction:ltr;tab-size:4;color:var(--foreground);background:${CARD};border:1px solid ${EDGE};border-radius:6px}
.ux-cmd-x:focus-visible{${RING_FOCUS}}
.ux-cf .fine{font-size:12px;color:${T3}}
.ux-cf .row{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
.ux-cf textarea{display:block;width:100%;min-height:72px;max-height:220px;padding:8px;font:inherit;color:var(--foreground);background:${CARD};border:1px solid var(--ui-stroke-secondary);border-radius:6px;resize:vertical}
.ux-cf textarea:focus-visible{${RING_FOCUS}}
.ux-cf .meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:11.5px;color:${T3}}
.ux-cf .meta .near{color:${ink(ORANGE)};font-weight:600}
.ux-cf .note{color:${ink(RED)};font-size:12px}
.ux-cd{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:8px 8px 12px 12px;border-radius:8px;overflow:hidden;background:color-mix(in oklab, var(--ui-accent) 9%, ${CARD});border:1px solid color-mix(in oklab, var(--ui-accent) 40%, ${EDGE});font-size:12.5px}
.ux-cd .tx{flex:1 1 8rem;min-width:0;display:flex;align-items:center;gap:8px;overflow-wrap:anywhere}
.ux-cd .tx .ux-i{color:${ink('var(--ui-accent)')}}
.ux-cd .bar{position:absolute;left:0;bottom:0;height:4px;width:100%;background:var(--ui-accent);transform-origin:left center;animation:ux-drain linear forwards}
@keyframes ux-drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.ux-cd.ok{border-color:color-mix(in oklab, ${GREEN} 50%, ${EDGE});background:color-mix(in oklab, ${GREEN} 9%, ${CARD})}
.ux-cd.ko{border-color:color-mix(in oklab, ${RED} 50%, ${EDGE});background:color-mix(in oklab, ${RED} 8%, ${CARD})}
.ux-cd.cancel{border-color:${EDGE};background:color-mix(in oklab, var(--foreground) 4%, ${CARD})}
.ux-cd .tag{flex:0 0 auto;font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase}
.ux-cd.ok .tag{color:${ink(GREEN)}}.ux-cd.ko .tag{color:${ink(RED)}}.ux-cd.cancel .tag{color:${T3}}
.ux-cd .ux-spin{width:12px;height:12px;flex:0 0 auto;border:2px solid ${EDGE};border-top-color:var(--ui-accent);border-radius:50%;animation:oc-turn .8s linear infinite}
/* the floating bar stays for an order that has no card on screen (panel folded, recruitment, card filtered out) */
/* agent tab */
.ux-ag-h{display:flex;align-items:center;gap:12px;margin:0 0 12px}
.ux-ag-h .oc-portrait{width:64px;height:68px;border-radius:12px}
.ux-ag-h .tt{min-width:0;flex:1 1 auto}
.ux-ag-h h3{margin:0 0 4px;font-size:16px;overflow-wrap:anywhere}
.ux-ag-h small{color:${T3};font-size:12px}
.ux-kv{display:grid;grid-template-columns:88px minmax(0,1fr);gap:8px 12px;margin:0 0 12px;font-size:12.5px;align-items:start}
.ux-kv dt{color:${T3}}
.ux-kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
.ux-kv .one{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ux-kv small{display:block;color:${T3};font-size:11.5px}
.ux-chips{display:flex;flex-wrap:wrap;gap:4px}
.ux-chip2{display:inline-flex;align-items:center;height:24px;padding:0 8px;border-radius:12px;background:color-mix(in oklab, var(--foreground) 4%, ${CARD});border:1px solid ${EDGE};font-size:11.5px;max-width:100%}
.ux-chip2 > span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ux-ag-act{display:flex;flex-wrap:wrap;gap:8px}
.ux-ag-nos{flex:1 0 100%;color:${T3};font-size:12px}
/* what waits for the user, first under the header: the card's title on one line (the id is its tooltip) and the filled « Decide » */
.ux-ag-wait{margin:0 0 12px;padding:8px 12px;border:1px solid color-mix(in oklab, ${ORANGE} 45%, ${EDGE});border-radius:8px;background:color-mix(in oklab, ${ORANGE} 8%, transparent)}
.ux-ag-wait h4{margin:0 0 4px;font-size:12px;font-weight:600;color:${ink(ORANGE)}}
.ux-ag-wait small{display:block;color:${T3};font-size:11.5px}
.ux-ag-wr{display:flex;align-items:center;gap:8px;padding:4px 0}
.ux-ag-wr .tx{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.ux-ag-wr .hd{display:flex;align-items:center;gap:8px;min-width:0}
.ux-ag-wr .hd b{font-size:12px}
.ux-ag-wt{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600}
.ux-lnk{display:inline-flex;align-items:center;gap:4px;min-height:24px;padding:0;border:0;background:none;color:var(--ui-accent);font:inherit;font-size:12.5px;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.ux-roster{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}
.ux-rosterb{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:40px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--foreground);font:inherit;text-align:left;cursor:pointer}
.ux-rosterb:hover{background:color-mix(in oklab, var(--foreground) 5%, transparent)}
.ux-rosterb[aria-current="true"]{background:color-mix(in oklab, var(--ui-accent) 10%, transparent)}
.ux-rosterb .oc-portrait{width:24px;height:24px;border-radius:6px;border:0}
/* a long name is cut with an ellipsis (the whole name is the button's name): the project chip gives way first, then the name; the state word is kept whole */
.ux-rosterb .nm{flex:0 1 auto;min-width:8ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:12.5px}
.ux-rosterb .ux-prj{flex:0 100 auto;min-width:28px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ux-rosterb .ux-st{flex:0 0 auto;white-space:nowrap}
.ux-rosterb .ux-st{margin-left:auto;font-size:11.5px}
/* the « a decision waits for you » sign beside the state of a bot at work: same tinted square as the scene's label */
.ux-wait{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:20px;height:20px;border-radius:5px;color:${ink(ORANGE)};background:color-mix(in oklab, ${ORANGE} 18%, transparent)}
/* projects tab */
.ux-pjc{position:relative;display:grid;grid-template-columns:52px minmax(0,1fr);gap:4px 12px;margin:0 0 12px;padding:16px 12px 12px;border:1px solid ${EDGE};border-radius:10px;overflow:hidden}
.ux-pjc::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:var(--pc)}
/* a project the filter leaves out: its text keeps its contrast (opacity .6 measured 3.7:1 on the light theme), the card recedes by its dashed edge, its pale ring and stripe */
.ux-pjc.dim{border-style:dashed}
.ux-pjc.dim::before{opacity:.4}
.ux-pjc.dim .big svg{opacity:.5}
.ux-pjc.dim .ux-pips{opacity:.6}
.ux-pjc .big{grid-row:1/3;position:relative;width:52px;height:52px}
.ux-pjc .big .ux-ring{width:52px;height:52px}
.ux-pjc .big .pc{position:absolute;inset:0;display:grid;place-items:center;font:700 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ux-pjc h4{display:flex;align-items:center;gap:8px;margin:0;min-width:0;font-size:14px}
.ux-pjc h4 .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ux-pjc h4 .sq{width:12px;height:12px;flex:0 0 auto;border-radius:3px;background:var(--pc)}
.ux-pjc h4 .n{flex:0 0 auto;font-size:12px;font-weight:500;color:${T3}}
.ux-pjc .cn{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:${T2}}
.ux-pjc .cn b{color:var(--foreground)}
.ux-pjc .cn .w b{color:${ink(ORANGE)}}
.ux-pips{grid-column:1/-1;display:flex;gap:4px;margin-top:8px}
.ux-pips i{flex:1 1 0;min-width:4px;height:8px;border-radius:2px;background:${SUNKEN}}
.ux-pips i.done{background:color-mix(in oklab, var(--pc) 75%, ${CARD})}
.ux-pips i.blocked{background:${ORANGE}}
.ux-pips i.running,.ux-pips i.review{background:var(--ui-accent)}
.ux-pips i.todo,.ux-pips i.ready,.ux-pips i.triage,.ux-pips i.scheduled{background:transparent;box-shadow:inset 0 0 0 1.5px var(--ui-stroke-secondary)}
/* the status is also a shape: filled = done, arrow tip = running, hatched = blocked, hollow = to do */
.ux-pips i.running,.ux-pips i.review,.ux-pq .ux-pip.running,.ux-pq .ux-pip.review{clip-path:polygon(0 0,calc(100% - 4px) 0,100% 50%,calc(100% - 4px) 100%,0 100%);border-radius:2px 0 0 2px}
.ux-pips i.blocked,.ux-pq .ux-pip.blocked{background:repeating-linear-gradient(135deg, ${ORANGE} 0 3px, color-mix(in oklab, ${ORANGE} 35%, ${CARD}) 3px 6px)}
.ux-pips i[data-pin]{box-shadow:inset 0 -3px 0 var(--foreground)}
.ux-pq-toggle{grid-column:1/-1;justify-self:start;margin-top:4px;font-size:12px}
.ux-pq{grid-column:1/-1;display:flex;flex-direction:column;gap:8px;margin:4px 0 0;padding:0;list-style:none}
.ux-pq li{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;min-width:0;font-size:12px}
.ux-pq .ux-pip{flex:0 0 16px;height:8px;border-radius:2px;background:${SUNKEN}}
.ux-pq .ux-pip.done{background:color-mix(in oklab, var(--pc) 75%, ${CARD})}
.ux-pq .ux-pip.running,.ux-pq .ux-pip.review{background:var(--ui-accent)}
.ux-pq .ux-pip.todo,.ux-pq .ux-pip.ready,.ux-pq .ux-pip.triage,.ux-pq .ux-pip.scheduled{background:transparent;box-shadow:inset 0 0 0 1.5px var(--ui-stroke-secondary)}
.ux-pq .code{color:${T2}}
.ux-pq .st{color:${T2};font-weight:600}
.ux-pq .tt{flex:1 1 100%;min-width:0;padding-left:24px;overflow-wrap:anywhere;color:var(--foreground)}
.ux-why{display:block;flex:1 1 100%;margin:4px 0 0;font-size:11.5px;line-height:1.35;color:${T2}}
.ux-pjc .pin{grid-column:1/-1;display:flex;gap:8px;align-items:baseline;min-width:0;font-size:11px}
.ux-pjc .pin small{font-size:11px;color:${T3}}
.ux-pjc .ac{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
/* journal tab */
.ux-nightc{margin:0 0 12px}
.ux-jl{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.ux-jl li{display:grid;grid-template-columns:52px 20px minmax(0,112px) minmax(0,1fr);gap:8px;align-items:center;min-height:36px;padding:4px 0;border-bottom:1px solid color-mix(in oklab, ${EDGE} 70%, transparent);font-size:12.5px}
.ux-jl time{font-size:11.5px;color:${T3};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ux-jl .ic{display:inline-flex;color:${T3}}
.ux-jl .ic.ok{color:${ink(GREEN)}}.ux-jl .ic.w{color:${ink(ORANGE)}}.ux-jl .ic.ko{color:${ink(RED)}}
/* fixed columns (age, icon, project, text): the text is one line cut with an ellipsis (its whole is the tooltip), so a long project name never pushes it down */
.ux-jl .pj{display:flex;min-width:0}
.ux-jl .tx{display:flex;align-items:center;gap:8px;min-width:0}
.ux-jl .tx .t{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ux-jl .tx .res{flex:0 0 auto;white-space:nowrap}
.ux-jl .ux-prj{max-width:100%} /* the chip has its own line in a journal row, so a long name (« customer-support… ») is not cut at 140 px beside free space */
.ux-jl .res{font-size:11px;font-weight:600}
/* popover (the « ? » texts, alert details) */
.ux-pop{position:fixed;z-index:70;box-sizing:border-box;width:max-content;max-width:min(300px,calc(100vw - 16px));padding:12px;border:1px solid ${EDGE};border-radius:10px;background:${CARD};color:var(--foreground);font-size:12.5px;line-height:1.45;max-height:calc(100vh - 16px);overflow-y:auto;overscroll-behavior:contain;box-shadow:0 10px 30px color-mix(in oklab, var(--foreground) 18%, transparent);animation:ux-in .14s ease both}
.ux-pop:focus-visible{${RING_FOCUS}}
.ux-pop h5{margin:0 0 4px;font-size:12.5px;font-weight:700}
.ux-pop p{margin:0 0 8px;color:${T2}}
.ux-pop p:last-child{margin:0}
.ux-pop .src{font-size:11.5px;color:${T3}}
.ux-pop .rowk{display:flex;align-items:baseline;gap:8px}
.ux-pop .rowk .ux-rk{flex:0 0 auto;transform:translateY(0)}
.ux-pop.menu{display:flex;flex-direction:column;gap:4px;padding:4px;min-width:200px}
.ux-pop.menu button{display:flex;align-items:center;gap:8px;width:100%;height:36px;padding:0 12px;border:0;border-radius:6px;background:transparent;color:var(--foreground);font:inherit;text-align:left;cursor:pointer}
.ux-pop.menu button .why{display:block;margin-left:8px;font-size:11px;color:${T3};white-space:normal}
.ux-pop.menu button:hover{background:color-mix(in oklab, var(--foreground) 6%, transparent)}
/* ---------- bottom tab bar of a narrow pane ---------- */
.ux-bar{display:none}
.ux-bar button{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:56px;padding:0 4px;border:0;background:transparent;color:${T3};font:inherit;font-size:11px;font-weight:600;cursor:pointer}
.ux-bar button[aria-selected="true"]{color:var(--ui-accent)}
.ux-bar button[aria-selected="true"]::before{content:"";position:absolute;top:0;left:25%;right:25%;height:2px;border-radius:2px;background:var(--ui-accent)}
.ux-bar .ux-n{position:absolute;top:4px;left:calc(50% + 4px);min-width:16px;height:16px;border-radius:8px;font-size:11px;background:${ink(ORANGE)};color:${CARD}}
/* a very wide pane (1920 px window: 1250 px stage). The panel is a little wider and ends with its content instead of a card with a void; the project chips share the dock */
@container ux (min-width: 1500px){
  .ux-main{grid-template-columns:minmax(0,1fr) 400px}
  .ux-panel{align-self:start;max-height:100%;min-height:min(100%,320px)}
  .ux-dk-l .ux-pj:not(.all){flex:1 1 auto;max-width:260px}   /* from their content width (a 0 basis would squeeze 8 projects to a ring and a cut count) */
  .ux-dk-l .ux-pj .n{margin-left:auto}
  .ux-acts .ux-b .lb{display:inline}
  .ux-acts .ux-b:not(.ico){width:auto;padding:0 12px}
}
/* ---------- a medium pane (up to 1320 px) ---------- */
@container ux (max-width: 1320px){
  .ux-main{grid-template-columns:minmax(0,1fr) 328px}
  .ux-lvp.agents{display:none}
  .ux-tab svg{display:none}
  .ux-tab{padding:0 4px}
  .ux-top{gap:12px}
  .ux-gs{padding:0 8px}
  .ux-kpis-wide{display:none}
}
@container ux (max-width: 1180px){ .ux-sel .hint{display:none} .ux-pj.all b{display:none} }
/* with the host sidebar open (1024 / 1280 px windows) the header has no room for everything: the streak leaves it first, so the actions
   and the gear stay whole (it stays in the badge's name and in the trophies window) */
@container ux (max-width: 1100px){ .ux-game .ux-gs[data-streak]{display:none} }
@container ux (max-width: 980px){ .ux-gs.lvl .ux-g2{display:none} .ux-lvp.working .w{display:none} .ux-lvp.working{padding:0 8px;gap:4px} .ux-top{gap:8px} .ux-acts{gap:4px} .ux-acts .sep{margin:0} }
/* ---------- a narrow pane (<= 700 px): one view at a time, the bar at the bottom ---------- */
@container ux (max-width: 700px){
  .ux-dc-o .ux-b.cx .full{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap} .ux-dc-o .ux-b.cx .short{display:inline}
  .ux-top{gap:8px;min-height:40px}
  .ux-brand h1{font-size:15px}
  .ux-brand .mk{width:28px;height:28px}
  .ux-brand .mk .ux-i{width:16px;height:16px}
  .ux-live .ux-lvp:not(.dec){display:none}
  .ux-game{height:32px}
  .ux-game .ux-gs:not(:first-child){display:none}
  .ux-game .ux-g2{display:none}
  .ux-acts .ux-b:not(.keep){display:none}
  .ux-acts .sep{display:none}
  .ux-acts .only-n{display:inline-flex}
  .ux-main{grid-template-columns:minmax(0,1fr)}
  .ux-stage .oc-box{padding:0}
  .ux-dock{flex-wrap:wrap;padding:8px}
  /* in the replay of a 380 px pane the list of desks keeps its height: only what the past needs stays above it (no note, banner sentence, window ends nor empty selection bar) */
  .ux-stage[data-replaying] .oc-list>p{display:none}
  .ux-stage[data-replaying] .ux-sel:has(.hint){display:none}
  .ux-stage[data-replaying] .oc-rp-ends{display:none}
  .oc-rp-banner .oc-rp-note{display:none}
  /* the projects are ONE scrollable row, so the list of desks keeps its height (4 wrapped rows would leave it 25 px); a fade says it goes on */
  .ux-dk-l{flex:1 1 100%;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;padding:2px;scrollbar-width:none;overscroll-behavior-x:contain;-webkit-mask-image:linear-gradient(90deg,var(--foreground) calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,var(--foreground) calc(100% - 24px),transparent)}
  .ux-dk-l::-webkit-scrollbar{display:none}
  .ux-dk-l .ux-pj{flex:0 0 auto}
  .ux-pj{height:28px;font-size:12px}
  .ux-pj.all b{display:none}
  .ux-sel{flex:1 1 100%;flex-wrap:wrap;min-width:0;padding:0;border-left:0}
  .ux-sel .hint{display:inline}
  .ux-tabs{display:none}
  .ux-bar{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));flex:0 0 auto;margin:0 -16px -12px;border-top:1px solid ${EDGE};background:${CARD}}
  .ux-panel{border-radius:12px}
}
@container ux (max-width: 420px){ .ux-brand h1{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)} }
@media (prefers-reduced-motion: reduce){
  .ux *,.ux *::before,.ux *::after{animation:none!important;transition:none!important}
  .ux-cd .bar{transform:scaleX(.5)}
}
/* the plugin's own Motion setting « Reduced » does what the OS preference does (the scene and the dialogs already followed it) */
.ux[data-motion="reduced"] *,.ux[data-motion="reduced"] *::before,.ux[data-motion="reduced"] *::after{animation:none!important;transition:none!important}
.ux[data-motion="reduced"] .ux-cd .bar{transform:scaleX(.5)}
`
