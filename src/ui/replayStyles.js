/**
 * Stylesheet of the replay: the banner, the time bar, the facts journal and the night's summary card. Theme variables only.
 * The page never scrolls: the journal scrolls inside the side panel; the bar wraps in a 380 px pane.
 */
import { BTN_RADIUS, CARD, EDGE, FIELD_EDGE, FIELD_RADIUS, RING, RING_FOCUS } from './tokens.js'

const SOFT = 'color-mix(in oklab, var(--ui-text-secondary) 60%, var(--ui-text-tertiary))'
const ORANGE = 'var(--ui-orange, var(--ui-accent))'
const GREEN = 'var(--ui-green, var(--ui-accent))'
const RED = 'var(--ui-red, var(--destructive, var(--ui-orange)))'
const ink = hue => `color-mix(in oklab, ${hue} 50%, var(--foreground))`

export const REPLAY_CSS = `
/* banner: the replay is signalled where the eye is, in the accent colour, with the way out one click away */
.oc-rp-banner{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:7px 12px;border:1px solid var(--ui-accent);border-radius:8px;background:color-mix(in oklab, var(--ui-accent) 12%, ${CARD});color:var(--foreground);font-size:12px}
.oc-rp-banner b{font-size:13px;font-variant-numeric:tabular-nums;letter-spacing:.01em}
.oc-rp-banner .oc-rp-note{flex:1 1 160px;min-width:0;color:${SOFT}}
.oc-rp-dot{width:8px;height:8px;border-radius:999px;background:var(--ui-accent);flex:0 0 auto}
.oc-rp-exit{margin-left:auto;padding:4px 12px;font:inherit;font-size:12px;font-weight:500;color:var(--foreground);background:${CARD};border:1px solid var(--ui-accent);border-radius:${BTN_RADIUS};cursor:pointer}
.oc-rp-exit:hover{background:color-mix(in oklab, var(--ui-accent) 14%, ${CARD})}
.oc-rp-exit:focus-visible,.oc-rp-win button:focus-visible,.oc-rp-step:focus-visible,.oc-fact:focus-visible,.oc-nt-tile:focus-visible,.oc-rp-sel:focus-visible{${RING_FOCUS}}
/* the scene of a replay wears the replay's colour on its own frame, with the moment in its corner: a past office cannot be
   taken for the present even when the banner is out of sight (the eye is on the scene) */
.oc-col[data-replaying]{position:relative}
.oc-col[data-replaying] .oc-box{border:2px solid var(--ui-accent);box-shadow:inset 0 0 0 3px color-mix(in oklab, var(--ui-accent) 22%, transparent)}
/* the list view (narrow pane) sits right under the banner: its frame is enough, the moment is not said twice in a short column */
.oc-rp-tag:has(+ .oc-box.oc-listing){display:none}
.oc-rp-tag{position:absolute;top:8px;left:8px;z-index:4;display:inline-flex;align-items:center;gap:6px;max-width:calc(100% - 16px);box-sizing:border-box;padding:3px 9px;border:1px solid var(--ui-accent);border-radius:999px;background:${CARD};color:var(--foreground);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;box-shadow:0 1px 3px color-mix(in oklab, var(--foreground) 18%, transparent)}
/* the time bar under the scene */
.oc-rp{flex:0 0 auto;display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:1px solid ${EDGE};border-radius:10px;background:${CARD};min-width:0}
.oc-rp-top{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;min-width:0}
.oc-rp-win{display:inline-flex;max-width:100%;box-sizing:border-box;gap:2px;padding:4px;border:0;box-shadow:inset 0 0 0 1px ${EDGE};border-radius:8px;background:color-mix(in oklab, var(--foreground) 5%, transparent)}
.oc-rp-win button{box-sizing:border-box;flex:1 1 auto;min-width:0;min-height:28px;padding:0 12px;line-height:1.2;font:inherit;font-size:12px;font-weight:500;color:var(--ui-text-secondary);background:transparent;border:0;border-radius:6px;cursor:pointer}
.oc-rp-win button[aria-pressed="true"]{background:${CARD};color:var(--foreground);font-weight:600;box-shadow:0 0 0 1px var(--ui-accent)}
.oc-rp-range{font-size:12px;color:${SOFT};font-variant-numeric:tabular-nums}
.oc-rp-state{margin-left:auto;font-size:12px;color:var(--foreground);min-width:0}
.oc-rp-track{position:relative;height:34px}
.oc-rp-dens{position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:4px;background:color-mix(in oklab, var(--foreground) 4%, transparent)}
.oc-rp-dens .d-other{fill:color-mix(in oklab, var(--foreground) 32%, transparent)}
.oc-rp-dens .d-done{fill:${GREEN}}
.oc-rp-dens .d-block{fill:${ORANGE}}
.oc-rp-dens .d-fail{fill:${RED}}
.oc-rp-range-input{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;background:transparent;-webkit-appearance:none;appearance:none;cursor:ew-resize}
.oc-rp-range-input::-webkit-slider-runnable-track{height:100%;background:transparent}
.oc-rp-range-input::-moz-range-track{height:100%;background:transparent}
.oc-rp-range-input::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:6px;height:34px;border-radius:2px;background:var(--ui-accent);border:2px solid ${CARD};box-sizing:border-box;box-shadow:0 0 0 1px var(--ui-accent)}
.oc-rp-range-input::-moz-range-thumb{width:6px;height:34px;border-radius:2px;background:var(--ui-accent);border:2px solid ${CARD};box-sizing:border-box}
.oc-rp-range-input:focus-visible{outline:2px solid ${RING};outline-offset:2px;border-radius:4px}
.oc-rp-ends{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:${SOFT};font-variant-numeric:tabular-nums}
.oc-rp-steps{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}
.oc-rp-step{display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;height:28px;padding:0 12px;font:inherit;font-size:12px;font-weight:500;color:var(--foreground);background:${CARD};border:1px solid ${EDGE};border-radius:${BTN_RADIUS};cursor:pointer}
.oc-rp-step:hover{border-color:var(--ui-accent)}
.oc-rp-step[aria-disabled="true"]{opacity:.5;cursor:default}
.oc-rp-help{margin-left:auto;display:inline-flex;align-items:center}
.oc-rp-msg{margin:0;font-size:12px;color:${SOFT}}
.oc-rp-warn{margin:0;font-size:11px;color:${ink(ORANGE)}}
/* facts journal */
.oc-rp-filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;align-items:end;font-size:12px}
.oc-rp-f{display:flex;flex-direction:column;gap:4px;min-width:0}
.oc-rp-f label{color:${SOFT};font-size:11px}
.oc-rp-note{display:flex;justify-content:flex-end}
.oc-rp-sel{font:inherit;font-size:12px;min-width:0;max-width:100%;padding:3px 6px;border-radius:${FIELD_RADIUS};color:var(--foreground);background:${CARD};border:1px solid ${FIELD_EDGE}}
.oc-rp-filters .oc-rp-all{grid-column:1 / -1;display:flex;align-items:center;gap:6px;color:var(--foreground);cursor:pointer;white-space:normal}   /* this label wraps: the labels' nowrap would cut it (« …commen ») */
.oc-facts{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.oc-facts li{min-width:0}
.oc-fact{display:grid;grid-template-columns:auto minmax(0,1fr);gap:1px 8px;width:100%;padding:4px 6px;font:inherit;font-size:12px;text-align:left;color:var(--foreground);background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer}
.oc-fact:hover{background:color-mix(in oklab, var(--ui-accent) 8%, transparent);border-color:${EDGE}}
.oc-fact time{grid-row:1;font-variant-numeric:tabular-nums;color:${SOFT};white-space:nowrap}
.oc-fact .oc-fact-main{grid-column:2;min-width:0;overflow-wrap:anywhere}
.oc-fact .oc-fact-src{grid-column:2;font-size:11px;color:${SOFT};min-width:0;overflow-wrap:anywhere}
.oc-fact-static{display:grid;grid-template-columns:auto minmax(0,1fr);gap:1px 8px;align-items:baseline;padding:3px 6px;font-size:12px;color:var(--foreground)}
.oc-fact-static .oc-fact-main{min-width:0;overflow-wrap:anywhere}
/* a fact after the cursor is said by a dashed rule and a lighter weight, not by opacity (.55 puts time and source at 3.0:1 dark,
   2.2:1 light): every text keeps its own contrast */
.oc-facts li[data-future] .oc-fact{border-left:2px dashed ${EDGE};border-radius:0 6px 6px 0}
.oc-facts li[data-future] .oc-fact .oc-fk{font-weight:400;color:${SOFT}}
.oc-facts li[data-now] .oc-fact{border-color:var(--ui-accent);background:color-mix(in oklab, var(--ui-accent) 10%, transparent)}
.oc-fact .oc-fk{font-weight:600}
.oc-fact[data-group="done"] .oc-fk{color:${ink(GREEN)}}
.oc-fact[data-group="block"] .oc-fk{color:${ink(ORANGE)}}
.oc-fact[data-group="fail"] .oc-fk{color:${ink(RED)}}
/* the night's summary card */
.oc-nt{display:flex;flex-direction:column;gap:8px}
.oc-nt-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px}
.oc-nt-head .oc-faint{font-variant-numeric:tabular-nums}
.oc-nt-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.oc-nt-tile{display:flex;flex-direction:column;gap:1px;padding:6px 8px;font:inherit;text-align:left;color:var(--foreground);background:transparent;border:1px solid ${EDGE};border-radius:8px;min-width:0;cursor:pointer}
.oc-nt-grid .oc-nt-tile:nth-child(8):last-child{grid-column:span 2}
.oc-nt-tile:hover{border-color:var(--ui-accent)}
/* a tile with nothing to show (0) says so by its dashed edge and a neutral number (a red « 0 failures » reads as an alarm), not by
   opacity (.7 puts the label at 2.8:1 on the light theme) */
.oc-nt-tile[aria-disabled="true"],.oc-nt-tile:disabled{cursor:default;border-style:dashed}
.oc-nt-grid .oc-nt-tile:disabled:hover{border-color:${EDGE}}
.oc-nt-grid .oc-nt-tile:disabled b{color:${SOFT}}
.oc-nt-tile b{font-size:1.05rem;font-variant-numeric:tabular-nums}
.oc-nt-tile span{font-size:11px;color:${SOFT};overflow-wrap:anywhere}
.oc-nt-tile[data-tone="done"] b{color:${ink(GREEN)}}
.oc-nt-tile[data-tone="block"] b{color:${ink(ORANGE)}}
.oc-nt-tile[data-tone="fail"] b{color:${ink(RED)}}
.oc-nt-chart{display:block;width:100%;height:44px;border-radius:4px;background:color-mix(in oklab, var(--foreground) 4%, transparent)}
.oc-nt-chart .d-done{fill:${GREEN}}
.oc-nt-chart .d-block{fill:${ORANGE}}
.oc-nt-chart .d-fail{fill:${RED}}
.oc-nt-ends{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:${SOFT};font-variant-numeric:tabular-nums}
.oc-nt-agents{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;font-size:12px}
.oc-nt-agents li{display:grid;grid-template-columns:minmax(0,7em) minmax(0,1fr);gap:2px 8px;align-items:center}
.oc-nt-agents .oc-nt-bar{height:6px;border-radius:3px;background:var(--ui-accent);min-width:2px}
.oc-nt-agents .oc-faint{grid-column:2}
.oc-nt-agents b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.oc-nt-go{align-self:flex-start}
@media (max-width:520px){.oc-nt-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.oc-rp-state{margin-left:0;flex:1 1 100%}.oc-rp-exit{margin-left:0}}
`
