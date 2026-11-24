/**
 * Stylesheet of the Resources window: the day chart, the stacked bars, the quota gauges. Theme variables only, so both
 * themes work; the three parts of a bar are told apart by colour AND by order (input, output, cache), and every figure is also text.
 * The page behind never scrolls; the body of the window scrolls inside it (it is a dialog) and wraps in a 380 px pane.
 */
import { CARD, EDGE } from './tokens.js'

const SOFT = 'color-mix(in oklab, var(--ui-text-secondary) 60%, var(--ui-text-tertiary))'
const ORANGE = 'var(--ui-orange, var(--ui-accent))'
const GREEN = 'var(--ui-green, var(--ui-accent))'
const RED = 'var(--ui-red, var(--destructive, var(--ui-orange)))'
const TRACK = 'color-mix(in oklab, var(--foreground) 9%, transparent)'
const LINE = 'color-mix(in oklab, var(--foreground) 18%, transparent)'

export const USAGE_CSS = `
/* the window is the shared frame (DialogKit, dialogStyles.js); only what is specific to Resources is here */
[data-usage-quota]{display:flex;flex-direction:column;gap:12px}
.oc-us-controls{position:sticky;top:-16px;z-index:2;display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 12px;margin:-16px -16px 0;padding:12px 16px;background:${CARD};border-bottom:1px solid ${EDGE}}
.oc-us-cl{display:flex;flex-direction:column;gap:4px;min-width:0}
.oc-us-ct{font-size:11px;font-weight:600;line-height:16px;color:${SOFT}}
/* what the three colours of the bars are, under the controls */
.oc-us-key{flex:1 1 100%;display:flex;flex-wrap:wrap;gap:4px 16px;margin:0;padding:0;list-style:none;font-size:11px;line-height:16px;color:${SOFT}}
.oc-us-key li{display:inline-flex;align-items:center;gap:4px}
.oc-us-key i{display:inline-block;width:10px;height:10px;border-radius:2px}
.oc-us-range{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-variant-numeric:tabular-nums;color:${SOFT}}
.oc-us-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:stretch}
.oc-us-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.oc-us-tile{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"i v" "l l" "n n";gap:4px 8px;align-items:center;align-content:start;min-width:0;box-sizing:border-box;padding:12px;border:1px solid ${EDGE};border-radius:8px;background:color-mix(in oklab, var(--ui-accent) 7%, ${CARD})}
.oc-us-tico{grid-area:i;display:inline-grid;place-items:center;width:24px;height:24px;border-radius:6px;color:var(--ui-accent);background:color-mix(in oklab, var(--ui-accent) 14%, transparent)}
.oc-us-tile b{grid-area:v;font-size:24px;line-height:1.1;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.oc-us-tile > span:not(.oc-us-tico){grid-area:l;font-size:12px;color:${SOFT}}
.oc-us-tile small{grid-area:n;font-size:11px}
.oc-us-tile.cost{border-color:color-mix(in oklab, var(--ui-accent) 40%, ${EDGE});background:color-mix(in oklab, var(--ui-accent) 12%, ${CARD})}
/* the skeleton: the final order of the sections, blocks that say nothing */
.oc-us-tile.sk{min-height:72px;border-color:transparent;background:${TRACK}}
.oc-us-sk.chart{height:112px;border-radius:6px;background:${TRACK}}
.oc-us-sk.rows{display:flex;flex-direction:column;gap:12px}
.oc-us-sk.rows i{display:block;height:12px;border-radius:3px;background:${TRACK}}
/* the split of the tokens: a ring and its three shares */
.oc-us-split{display:flex;align-items:center;gap:12px;box-sizing:border-box;padding:8px 16px 8px 8px;border:1px solid ${EDGE};border-radius:8px}
.oc-us-donut{flex:0 0 auto;width:88px;height:88px}
.oc-us-donut circle{fill:none;stroke-width:14}
.oc-us-donut .p-track{stroke:${TRACK}}
.oc-us-donut .p-in{stroke:var(--ui-accent)}
.oc-us-donut .p-out{stroke:${GREEN}}
.oc-us-donut .p-cache{stroke:color-mix(in oklab, var(--foreground) 30%, transparent)}
.oc-us-donut .p-total{font-size:15px;font-weight:700;fill:var(--foreground);font-variant-numeric:tabular-nums}
.oc-us-legend{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;font-size:12px}
.oc-us-legend li{display:flex;align-items:center;gap:8px;white-space:nowrap}
.oc-us-legend b{font-variant-numeric:tabular-nums;font-weight:600}
.oc-us-legend i{display:inline-block;width:10px;height:10px;border-radius:2px}
.s-in{background:var(--ui-accent)}
.s-out{background:${GREEN}}
.s-cache{background:color-mix(in oklab, var(--foreground) 30%, transparent)}
.oc-us-sec{display:flex;flex-direction:column;gap:8px;min-width:0}
.oc-us-sec h3{margin:0;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px}
.oc-us-sec + .oc-us-sec{padding-top:12px;border-top:1px solid ${EDGE}}
.oc-us-sec p{margin:0;font-size:12px}
.oc-us-read{display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
.oc-us-src summary{cursor:pointer;font-size:12px;color:var(--ui-accent);text-decoration:underline;text-underline-offset:2px}
.oc-us-src ul{margin:8px 0 0;padding-left:16px;display:flex;flex-direction:column;gap:4px}
.oc-us-colfill i,.oc-us-fill i{display:block}
/* the days: one button per day, a column whose height is the day's total */
.oc-us-days{display:grid;grid-template-columns:repeat(var(--n,7),minmax(0,1fr));gap:6px;align-items:end;max-width:calc(var(--n,7) * 92px)}
/* 30 days: a day never gets under 24 px (the size of a target); when the window is too narrow for 30 of them the row scrolls on its own (the page and the window do not) */
.oc-us-days[data-n="30"],.oc-us-days[data-n="31"]{grid-template-columns:repeat(var(--n),minmax(24px,1fr));gap:2px;max-width:none;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;padding:2px 2px 8px;margin:-2px;scrollbar-width:thin}
.oc-us-days[data-n="30"] .oc-us-day{padding:4px 0}
.oc-us-days[data-n="30"] .oc-us-val{display:none}
.oc-us-day{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;padding:4px 2px;font:inherit;font-size:11px;color:var(--foreground);background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer}
.oc-us-day:hover{background:color-mix(in oklab, var(--ui-accent) 8%, transparent);border-color:${EDGE}}
.oc-us-day[aria-pressed="true"]{border-color:var(--ui-accent);background:color-mix(in oklab, var(--ui-accent) 12%, transparent)}
.oc-us-day:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
/* the chart: a column of values on the left, a grid on two lines (the highest day, its half) that the figures name */
.oc-us-chart{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:8px;align-items:start}
.oc-us-yaxis{position:relative;box-sizing:border-box;height:112px;margin-top:5px;min-width:32px;font-size:11px;line-height:16px;color:${SOFT};font-variant-numeric:tabular-nums;text-align:right}
.oc-us-yaxis span{position:absolute;right:0;transform:translateY(-50%);white-space:nowrap}
.oc-us-yaxis .top{top:0}
.oc-us-yaxis .mid{top:50%}
.oc-us-col{display:flex;align-items:flex-end;width:100%;height:112px;border-radius:6px;background:linear-gradient(to bottom, ${LINE} 0 1px, transparent 1px calc(50% - 1px), ${LINE} calc(50% - 1px) 50%, transparent 50%), ${TRACK};overflow:hidden}
.oc-us-colfill{display:flex;flex-direction:column;width:100%;border-radius:3px 3px 0 0;overflow:hidden}
.oc-us-colfill i{min-height:1px}
.oc-us-gap{display:block;width:100%;height:0;border-bottom:2px dotted ${SOFT}}
.oc-us-gap.fail{border-bottom-color:${ORANGE}}
.oc-us-val{font-variant-numeric:tabular-nums;font-weight:600;min-height:14px}
.oc-us-lab{color:${SOFT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.oc-us-daynote{min-height:16px}
/* rows: name, bar, number, then the detail line */
.oc-us-rows{display:flex;flex-direction:column;gap:7px;margin:0;padding:0;list-style:none}
.oc-us-rows li{display:grid;grid-template-columns:minmax(0,15em) minmax(0,1fr) auto;grid-template-areas:"n b v" "s s s";gap:4px 12px;align-items:center;min-width:0}
.oc-us-name{grid-area:n;font-size:12px;min-width:0;overflow-wrap:anywhere}
.oc-us-rows .oc-us-bar{grid-area:b}
.oc-us-num{grid-area:v;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.oc-us-sub{grid-area:s;font-size:11px;overflow-wrap:anywhere}
.oc-us-bar{grid-area:b}
.oc-us-num{grid-area:v;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.oc-us-sub{grid-area:s;font-size:11px;overflow-wrap:anywhere}
.oc-us-bar{display:block;height:12px;border-radius:3px;background:${TRACK};overflow:hidden}
.oc-us-bar-none{background:repeating-linear-gradient(135deg, ${TRACK} 0 4px, transparent 4px 8px)}
.oc-us-fill{display:flex;height:100%;border-radius:3px;overflow:hidden;min-width:2px}
.oc-us-fill i{min-width:1px}
/* quota gauges */
.oc-us-quota{display:flex;flex-direction:column;gap:8px}
.oc-us-qhead{font-size:12px}
.oc-us-quota{flex-direction:row;flex-wrap:wrap;gap:12px}
.oc-us-qhead{flex:1 1 100%}
.oc-us-gauge{display:grid;grid-template-columns:56px minmax(0,1fr);grid-template-areas:"g l" "g r";column-gap:12px;row-gap:2px;align-items:center;align-content:center;flex:1 1 220px;min-width:0;box-sizing:border-box;padding:12px;border:1px solid ${EDGE};border-radius:8px;font-size:12px}
.oc-us-ring{grid-area:g;width:56px;height:56px}
.oc-us-ring circle{fill:none;stroke-width:5}
.oc-us-ring .r-track{stroke:${TRACK}}
.oc-us-ring .r-fill{stroke:var(--ui-accent)}
.oc-us-ring[data-level="mid"] .r-fill{stroke:${ORANGE}}
.oc-us-ring[data-level="high"] .r-fill{stroke:${RED}}
.oc-us-ring .r-pct{font-size:12px;font-weight:700;fill:var(--foreground);font-variant-numeric:tabular-nums}
.oc-us-gl{grid-area:l;min-width:0;font-weight:600;overflow-wrap:anywhere}
.oc-us-reset{grid-area:r;font-size:11px;min-width:0}
.oc-us-bgauge{display:grid;grid-template-columns:minmax(0,9.5em) minmax(0,1fr);grid-template-areas:"l t" "r r";gap:2px 12px;align-items:center;font-size:12px}
.oc-us-track{grid-area:t;display:block;height:12px;border-radius:3px;background:${TRACK};overflow:hidden}
.oc-us-track i{display:block;height:100%;min-width:2px;background:var(--ui-accent)}
.oc-us-balance{display:flex;flex-direction:column;gap:4px;padding-top:6px}
@media (max-width:640px){
  .oc-us-top{grid-template-columns:minmax(0,1fr)}
  .oc-us-split{justify-self:start}
}
@media (max-width:520px){
  .oc-us-rows li{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"n v" "b b" "s s";align-items:baseline}
  .oc-us-controls{top:-12px;margin:-12px -12px 0;padding:8px 12px}
  .oc-us-tiles{gap:4px;grid-template-columns:repeat(2,minmax(0,1fr))}
  .oc-us-tile{padding:8px;grid-template-columns:minmax(0,1fr);grid-template-areas:"v" "l" "n"}
  .oc-us-tico{display:none}
  .oc-us-tile b{font-size:20px}
  .oc-us-col{height:80px}
  .oc-us-days{gap:4px;align-items:start}
  .oc-us-days[data-n="30"],.oc-us-days[data-n="31"]{gap:2px}   /* columns aligned on their top: a label on two lines must not lift its column */
  .oc-us-lab{white-space:normal;text-align:center;line-height:1.2;overflow-wrap:anywhere}   /* at 380 px the day wraps under its number instead of being cut (« 9 M… ») */
}
`
