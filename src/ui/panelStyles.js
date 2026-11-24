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
.oc-age{display:block}
.oc-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.oc-clip{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc-clip2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;font-size:12px;font-weight:600}
/* five tiles on a 6-column grid, 3 then 2 (no empty cell; the wider second row holds « Cartes ouvertes » / « Tarjetas abiertas ») */
.oc-stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}
.oc-stat{grid-column:span 2;display:flex;flex-direction:column;gap:1px;padding:6px 8px;border:1px solid ${EDGE};border-radius:8px;min-width:0}
.oc-stat:nth-child(n+4){grid-column:span 3}
.oc-stat b{font-size:1.05rem;font-variant-numeric:tabular-nums}
.oc-stat b small{font-size:.7em;font-weight:400;opacity:.8}
.oc-stat span{font-size:11px;color:${SOFT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oc-stat.hot{border-color:color-mix(in oklab, var(--ui-accent) 60%, ${EDGE})}
.oc-stat.warn{border-color:${ORANGE}}
.oc-stat.warn b{color:${ink(ORANGE)}}
.oc-ihead{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.oc-portrait{flex:0 0 auto;width:56px;height:60px;image-rendering:pixelated;image-rendering:crisp-edges;border-radius:8px;border:1px solid ${EDGE};background:color-mix(in oklab, var(--ui-accent) 8%, transparent)}
.oc-iname{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:0}
.oc-iname b{font-size:14px;overflow-wrap:anywhere}
.oc-tag{display:inline-block;padding:0 7px;border:1px solid ${EDGE};border-radius:999px;font-size:11px;font-weight:600;color:var(--foreground)}
.oc-t-working{border-color:var(--ui-accent);color:${ink('var(--ui-accent)')}}
.oc-t-waiting,.oc-warnt{border-color:${ORANGE};color:${ink(ORANGE)}}
.oc-t-active{border-color:color-mix(in oklab, ${GREEN} 60%, ${EDGE})}
.oc-t-stale{border-style:dashed;color:${SOFT}}
.oc-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 10px;margin:0 0 10px;font-size:12px}
.oc-kv dt{color:${SOFT};white-space:nowrap}
.oc-kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
.oc-chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.oc-skill{padding:0 7px;border:1px solid ${EDGE};border-radius:999px;font-size:11px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc-skill small{color:${SOFT};font-size:11px}
.oc-modelline{color:${ink('var(--ui-accent)')}}
.oc-pin{display:inline-block;flex:0 0 auto;color:${ink('var(--ui-accent)')};vertical-align:-1px}
.oc-pinline{display:inline-flex;align-items:center;gap:4px;margin-top:3px;font-size:11px;color:${ink('var(--ui-accent)')};max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc-btn{display:inline-block;padding:5px 12px;font:inherit;font-size:12px;font-weight:500;color:var(--foreground);background:${CARD};border:1px solid var(--ui-accent);border-radius:${BTN_RADIUS};cursor:pointer}
.oc-btn[aria-disabled="true"]{opacity:.5;cursor:default}
.oc-cards{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.oc-cards li{display:flex;flex-direction:column;gap:4px;padding:7px 9px;border:1px solid ${EDGE};border-radius:8px;min-width:0}
.oc-meta{display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center;font-size:11px;color:${SOFT}}
.oc-meta .oc-tag{font-size:11px}
.oc-psec p.oc-faint{margin:6px 0 0}
.oc-chain{display:flex;flex-direction:column;gap:5px;padding:7px 0;border-top:1px solid ${EDGE}}
.oc-chain:first-of-type{border-top:0;padding-top:0}
.oc-top2{display:flex;justify-content:space-between;gap:8px;align-items:baseline;font-size:12px}
.oc-top2 b{text-transform:capitalize;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc-queue{display:flex;flex-wrap:wrap;gap:3px}
.oc-pill{position:relative;display:block;width:12px;height:12px;border-radius:3px;box-sizing:border-box;background:var(--ui-text-quaternary);border:1px solid transparent}
.oc-p-done{background:${GREEN}}
.oc-p-running{background:var(--ui-accent);box-shadow:0 0 0 1px color-mix(in oklab, var(--ui-accent) 40%, transparent)}
.oc-p-review{background:color-mix(in oklab, var(--ui-accent) 45%, transparent);border-color:var(--ui-accent)}
.oc-p-blocked{background:${ORANGE}}
.oc-p-ready,.oc-p-scheduled{background:var(--ui-text-tertiary)}
.oc-p-todo,.oc-p-triage{background:transparent;border-color:var(--ui-text-tertiary)}
.oc-pill[data-pin]::after{content:"";position:absolute;right:-3px;top:-3px;width:5px;height:5px;background:var(--foreground);border:1px solid ${CARD}}
.oc-pinrow{display:flex;gap:8px;align-items:baseline;font-size:11px;min-width:0}
.oc-pinref{flex:0 1 6.5rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc-events{display:flex;flex-direction:column;gap:5px;margin:0;padding:0;list-style:none;font-size:12px}
/* 6.75rem holds « il y a 26 minutes » / « hace 26 minutos » (5.5rem would clip them) */
.oc-events li{display:grid;grid-template-columns:6.75rem minmax(0,1fr);gap:8px;align-items:baseline}
.oc-events time{font-size:11px;color:${SOFT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oc-events li > span{min-width:0;overflow-wrap:anywhere}
.oc-main{position:relative;display:flex;flex:1 1 auto;min-width:0;min-height:0;gap:12px}
.oc-col{display:flex;flex-direction:column;gap:16px;flex:1 1 auto;min-width:0;min-height:0}
.oc-hright{margin-left:auto;display:inline-flex;align-items:center;gap:8px;align-self:center}
.oc-gear{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;color:var(--foreground);background:${CARD};border:1px solid ${EDGE};border-radius:${BTN_RADIUS};cursor:pointer}
.oc-gear:hover,.oc-gear[aria-expanded="true"]{border-color:var(--ui-accent)}
.oc-set-link:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.oc-set-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:50;box-sizing:border-box;width:min(360px,calc(100vw - 24px));max-height:min(calc(100vh - 150px),640px);display:flex;flex-direction:column;overflow:hidden;padding:12px 14px;border-radius:12px;background:${CARD};border:1px solid var(--ui-accent);box-shadow:0 8px 28px color-mix(in oklab, var(--foreground) 28%, transparent);color:var(--foreground)}
.oc-set-body{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}
.oc-set-pop.oc-sheet{top:auto;right:0;left:0;bottom:0;width:auto;max-height:80%;border-radius:12px 12px 0 0}
.oc-set-link{flex:0 0 auto;display:block;box-sizing:border-box;width:100%;margin-top:10px;padding:10px 0 4px;min-height:28px;font:inherit;font-size:12px;color:var(--ui-accent);background:none;border:0;border-top:1px solid ${EDGE};cursor:pointer;text-decoration:underline;text-align:left}
.oc-toggle{margin-left:auto;min-height:24px;padding:3px 10px;font:inherit;font-size:12px;font-weight:500;color:var(--foreground);background:${CARD};border:1px solid ${EDGE};border-radius:${BTN_RADIUS};cursor:pointer}
.oc-toggle[aria-expanded="true"]{border-color:var(--ui-accent)}
/* legend of the halos, a « ? » at the end of the selection bar, its card opening upwards over the scene edge */
.oc-legend{position:relative;flex:0 0 auto;margin-left:auto}
.oc-legend-btn{width:24px;height:24px;padding:0;font:inherit;font-size:12px;font-weight:600;line-height:1;color:var(--foreground);background:${CARD};border:1px solid ${EDGE};border-radius:${BTN_RADIUS};cursor:pointer}
.oc-legend-btn:hover,.oc-legend-btn[aria-expanded="true"]{border-color:var(--ui-accent)}
.oc-legend-pop{position:absolute;right:0;bottom:calc(100% + 8px);z-index:40;box-sizing:border-box;width:max-content;max-width:min(340px,calc(100vw - 24px));padding:8px 10px;border-radius:10px;background:${CARD};border:1px solid var(--ui-accent);box-shadow:0 2px 8px color-mix(in oklab, var(--foreground) 22%, transparent);font-size:11.5px;line-height:1.35;color:var(--foreground)}
.oc-legend-pop b{display:block;margin-bottom:5px;font-size:11px;font-weight:600;color:${SOFT}}
.oc-legend-pop ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.oc-legend-pop li{display:grid;grid-template-columns:12px 9px max-content 1fr;align-items:baseline;column-gap:7px}
.oc-lg-sti{align-self:center;display:flex;color:var(--foreground)}
.oc-sw{align-self:center;width:10px;height:10px;display:block;box-sizing:border-box}
.oc-sw-none{border:1.5px solid var(--ui-text-tertiary);border-radius:50%}
.oc-lg-name{font-weight:600}
.oc-lg-hint{color:${SOFT}}
.oc-icon{flex:0 0 auto;image-rendering:pixelated;image-rendering:crisp-edges}
.oc-announce{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* the decision box. Risk = text + colour (theme variables); the bar of the order in flight floats over the bottom of the page */
.oc-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.oc-orders{display:flex;flex-direction:column;gap:6px;margin-top:2px}
.oc-ord{padding:3px 8px;font-size:11.5px;line-height:1.5}
.oc-ord[aria-disabled="true"],.oc-btn[aria-disabled="true"]{opacity:.55}
.oc-btn.oc-primary{background:color-mix(in oklab, var(--ui-accent) 14%, ${CARD})}
.oc-ordbox .oc-text:focus-visible{${RING_FOCUS}}
/* 11 px like every other text; the class also reads without colour: a shape before the word (hollow circle = safe,
   half circle = reversible, solid triangle = final) and a final tag is filled, a safe one is not */
.oc-risk{display:inline-flex;align-items:center;gap:4px;margin-left:2px;padding:0 5px;border:1px solid currentColor;border-radius:5px;font-size:11px;font-weight:700;letter-spacing:.03em;line-height:1.45;text-transform:uppercase;vertical-align:1px;white-space:nowrap}
.oc-risk::before{content:"";flex:0 0 auto;box-sizing:border-box;width:7px;height:7px;border:1.5px solid currentColor;border-radius:50%}
.oc-r-safe{color:${ink(GREEN)}}
.oc-r-rev{color:${ink('var(--ui-accent)')}}
.oc-r-rev::before{background:linear-gradient(90deg, currentColor 50%, transparent 50%)}
.oc-r-final{color:${ink(RED)};background:color-mix(in oklab, ${RED} 12%, ${CARD})}
.oc-r-final::before{width:8px;height:7px;border:0;border-radius:0;background:currentColor;clip-path:polygon(50% 0, 100% 100%, 0 100%)}
.oc-undo .oc-risk{flex:0 0 auto;margin-left:0}
/* the card (or approval) an order counts down / travels for keeps a mark while the bar names it */
.oc-cards li.oc-target{border-color:var(--ui-accent);box-shadow:0 0 0 1px var(--ui-accent)}
.oc-ordbox{display:flex;flex-direction:column;gap:6px;padding:8px 9px;border:1px solid ${EDGE};border-left:3px solid ${RED};border-radius:8px;background:color-mix(in oklab, ${RED} 5%, transparent)}
.oc-ordbox p{margin:0;font-size:12px;overflow-wrap:anywhere}
.oc-ordbox .oc-ctitle{font-size:12.5px}
.oc-ordbox .oc-text{display:block;box-sizing:border-box;width:100%;min-height:72px;max-height:220px;padding:6px 8px;font-family:inherit;color:var(--foreground);background:${CARD};border:1px solid ${FIELD_EDGE};border-radius:${FIELD_RADIUS};resize:vertical}
/* approvals in the decision box (an approval row = who + session, Hermes' one-line summary, age, the allowed answers with their risk) */
.oc-cards li.oc-appr{border-left:3px solid ${ORANGE}}
.oc-apprhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;min-width:0}
.oc-apprwho{font-size:12.5px}
.oc-apprwhat{margin:0;font-size:12px;overflow-wrap:anywhere}
.oc-cards .oc-choices{display:flex;flex-direction:column;gap:5px;margin:2px 0 0;padding:0;list-style:none}
.oc-cards .oc-choices li{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:0;border:0;border-radius:0}
.oc-chexp{font-size:11px;overflow-wrap:anywhere}
.oc-textmeta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline;font-size:11px}
.oc-counter{white-space:nowrap;color:${SOFT}}
.oc-counter.oc-near{color:${ink(ORANGE)};font-weight:600}
.oc-ordnote{margin:0;font-size:11px;color:${ink(RED)}}
/* under the floating bar the refusal (« another order is waiting ») has its own background, so it never runs over the page's hint line */
.oc-ordbar .oc-ordnote{padding:5px 12px;border:1px solid ${EDGE};border-radius:8px;background:${CARD}}
/* while the bar floats over the foot of the panel (drawer at 1024 / 380 px), the panel can scroll its last rows above it */
.oc-main:has(.oc-ordbar) .oc-pbody{padding-bottom:140px;scroll-padding-bottom:140px}
.oc-ordbar{position:absolute;left:50%;bottom:12px;z-index:45;transform:translateX(-50%);box-sizing:border-box;width:min(560px,calc(100% - 24px));display:flex;flex-direction:column;gap:4px}
.oc-undo{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;box-sizing:border-box;padding:9px 12px 12px 14px;border:1px solid var(--ui-accent);border-radius:12px;background:${CARD};color:var(--foreground);font-size:12.5px;box-shadow:0 8px 28px color-mix(in oklab, var(--foreground) 28%, transparent);overflow:hidden}
.oc-undotx,.oc-outtx{flex:1 1 12rem;min-width:0;overflow-wrap:anywhere}
.oc-drain{position:absolute;left:0;right:0;bottom:0;height:3px;background:color-mix(in oklab, var(--ui-accent) 18%, transparent)}
.oc-drain i{display:block;height:100%;background:var(--ui-accent);transform-origin:left center;animation:oc-drain linear forwards}
@keyframes oc-drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.oc-spin{flex:0 0 auto;width:10px;height:10px;box-sizing:border-box;border:2px solid ${EDGE};border-top-color:var(--ui-accent);border-radius:50%;animation:oc-turn .8s linear infinite}
@keyframes oc-turn{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.oc-drain{display:none}.oc-spin{animation:none;border-top-color:var(--ui-accent);border-right-color:var(--ui-accent)}}
.oc-out-ok{border-color:${GREEN}}
.oc-out-ko{border-color:${RED}}
.oc-out-cancel{border-color:${EDGE}}
.oc-outtag{flex:0 0 auto;padding:0 6px;border:1px solid currentColor;border-radius:5px;font-size:11px;letter-spacing:.03em;text-transform:uppercase}
/* done / failed / cancelled also differ by shape (tick, solid triangle, hollow circle), not only by the word and the colour */
.oc-outtag{display:inline-flex;align-items:center;gap:5px}
.oc-outtag::before{content:"";flex:0 0 auto;box-sizing:border-box;width:7px;height:7px;border:1.5px solid currentColor;border-radius:50%}
.oc-out-ok .oc-outtag::before{width:4px;height:8px;margin:0 1px 2px;border-width:0 2px 2px 0;border-radius:0;transform:rotate(45deg)}
.oc-out-ko .oc-outtag::before{width:8px;height:7px;border:0;border-radius:0;background:currentColor;clip-path:polygon(50% 0, 100% 100%, 0 100%)}
.oc-out-ok .oc-outtag{color:${ink(GREEN)}}
.oc-out-ko .oc-outtag{color:${ink(RED)}}
.oc-out-cancel .oc-outtag{color:${SOFT}}
.oc-res-done{border-color:color-mix(in oklab, ${GREEN} 60%, ${EDGE});color:${ink(GREEN)}}
.oc-res-failed,.oc-res-refused{border-color:color-mix(in oklab, ${RED} 60%, ${EDGE});color:${ink(RED)}}
.oc-ojournal li > span .oc-tag{padding:0 5px;font-size:11px}
/* the recruitment window (native <dialog>: focus trap and Escape for free). Theme variables only. */
.oc-recruit{margin-left:0}
.oc-dlg{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(720px,calc(100vw - 24px));max-height:calc(100vh - 24px);padding:0;border:1px solid ${EDGE};border-radius:12px;background:${CARD};color:var(--foreground);overflow:hidden}
.oc-dlg[open]{display:flex;flex-direction:column}
.oc-dlg::backdrop{background:color-mix(in oklab, var(--foreground) 38%, transparent)}
.oc-hire{display:flex;flex-direction:column;min-height:0;max-height:calc(100vh - 26px);padding:14px 16px;gap:10px;font-size:12.5px;overflow-y:auto;overscroll-behavior:contain}
.oc-hhead{display:flex;align-items:center;gap:8px}
.oc-hhead h2{margin:0;font-size:15px;font-weight:600}
.oc-hbody{display:grid;grid-template-columns:150px minmax(0,1fr);gap:14px;min-width:0}
.oc-hprev{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;padding:10px 8px;border:1px solid ${EDGE};border-radius:10px;background:color-mix(in oklab, var(--ui-accent) 6%, transparent);align-self:start}
.oc-hprev .oc-portrait{width:84px;height:90px;image-rendering:pixelated}
.oc-hprevname{font-size:13px;overflow-wrap:anywhere}
.oc-hprev .oc-faint{font-size:11px;overflow-wrap:anywhere}
.oc-hfields{display:flex;flex-direction:column;gap:9px;min-width:0}
.oc-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.oc-field > span{font-size:11.5px;font-weight:600}
/* no font-size of our own on fields: the host sizes them (16 px minimum in the browser, inherited in the app). A size of ours would beat
   the host on <input> but not on <textarea>/<select>, and one form would mix two field sizes */
.oc-hire input[type=text],.oc-hire input:not([type]),.oc-hire textarea,.oc-hire select{box-sizing:border-box;width:100%;max-width:100%;padding:5px 8px;font-family:inherit;color:var(--foreground);background:${CARD};border:1px solid ${FIELD_EDGE};border-radius:${FIELD_RADIUS}}
.oc-hire textarea{resize:vertical;min-height:48px}
.oc-hire input:not([type=radio]):not([type=checkbox]):focus-visible,.oc-hire textarea:focus-visible,.oc-hire select:focus-visible{${RING_FOCUS}}
.oc-hire summary:focus-visible,.oc-hire input[type=radio]:focus-visible,.oc-hire input[type=checkbox]:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.oc-hire input[aria-invalid=true]{border-color:${RED}}
.oc-hire small{font-size:11px;color:${SOFT};overflow-wrap:anywhere}
.oc-fs{margin:0;padding:6px 9px 8px;border:1px solid ${EDGE};border-radius:8px;min-width:0;display:flex;flex-direction:column;gap:5px}
.oc-fs legend{padding:0 4px;font-size:11.5px;font-weight:600}
.oc-radio{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.oc-radio select{width:auto;flex:1 1 8rem;min-width:0}
.oc-hskills .oc-radio span{min-width:0;overflow-wrap:anywhere}
/* a skill's box stays on the line of its name (a long name must not wrap under its own checkbox) */
.oc-hskills .oc-radio{flex-wrap:nowrap;align-items:flex-start}
.oc-hskills .oc-radio input{flex:0 0 auto;margin-top:2px}
.oc-hskills{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 10px;max-height:120px;overflow-y:auto}
.oc-hmodel summary,.oc-hreq summary{cursor:pointer;font-size:12px;font-weight:600}
.oc-hrow2{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:6px 0}
.oc-herr{display:flex;flex-direction:column;gap:2px}
.oc-herr p{margin:0;font-size:11.5px;color:${ink(RED)}}
.oc-hreq pre{margin:6px 0 0;padding:8px;max-height:150px;overflow:auto;font-size:11px;line-height:1.4;border:1px solid ${EDGE};border-radius:8px;background:color-mix(in oklab, var(--foreground) 5%, transparent);white-space:pre-wrap;overflow-wrap:anywhere}
.oc-hfoot{position:sticky;bottom:-14px;z-index:1;padding:8px 0 2px;background:${CARD};display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.oc-hrisk{flex:1 1 14rem;min-width:0;font-size:11.5px}
.oc-hermesmsg{padding:6px 8px;border:1px dashed ${EDGE};border-radius:8px}
/* the decorator's window: ideas to start from, the fiche as labelled swatches */
.oc-decor{width:min(560px,calc(100vw - 24px))}
.oc-decor-ex{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.oc-chipbtn{max-width:100%;padding:3px 9px;font:inherit;font-size:11.5px;text-align:left;color:var(--foreground);background:${CARD};border:1px solid ${EDGE};border-radius:999px;cursor:pointer;overflow-wrap:anywhere}
.oc-chipbtn:hover:not(:disabled){border-color:var(--ui-accent)}
.oc-chipbtn:focus-visible{${RING_FOCUS}}
.oc-chipbtn:disabled{opacity:.5;cursor:default}
.oc-decor-out{min-height:0}
.oc-decor-out p{margin:0 0 2px;font-size:12px}
.oc-decor-h{margin:0 0 6px;font-size:12px;font-weight:600;overflow-wrap:anywhere}
.oc-fiche{display:flex;flex-direction:column;gap:6px}
.oc-fsw{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px 10px;margin:0;padding:0;list-style:none}
.oc-fsw li{display:flex;align-items:center;gap:6px;min-width:0;font-size:11.5px}
.oc-fsw i{flex:0 0 auto;width:22px;height:16px;border-radius:3px;border:1px solid ${FIELD_EDGE}}
.oc-fiche p{margin:0;font-size:11.5px}
@media (max-width:560px){.oc-hbody{grid-template-columns:minmax(0,1fr)}.oc-hprev{flex-direction:row;flex-wrap:wrap;justify-content:flex-start;text-align:left}.oc-hire{padding:12px}}
`
