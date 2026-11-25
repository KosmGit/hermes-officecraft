import { CARD, EDGE, FIELD_EDGE, RING } from './tokens.js'

/**
 * The look of the settings. One stylesheet for the gear's window AND Settings →
 * Plugins → Officecraft: SettingsForm injects it, so the two cannot drift apart. Theme variables only; 4 px grid; no animation
 * that carries information, and none at all under prefers-reduced-motion. The form answers to ITS OWN width (container query), not to
 * the window's: side tabs when there is room, a row of tabs on top when there is not (a 380 px pane, a narrow host page).
 */
const HAIR = 'color-mix(in oklab, var(--ui-stroke-secondary) 75%, transparent)'
const VIOLET = 'var(--ui-violet, color-mix(in oklab, color-mix(in oklch, var(--ui-purple, var(--ui-accent)), color-mix(in oklch, var(--ui-blue, var(--ui-accent)) 81%, var(--ui-red, var(--ui-accent)))) 88%, var(--foreground)))'
const GREEN = 'var(--ui-green, var(--ui-accent))'
const ORANGE = 'var(--ui-orange, var(--ui-accent))'
const TEXT3 = 'color-mix(in oklab, var(--ui-text-secondary) 60%, var(--ui-text-tertiary))'   // the tertiary alone measured 3.54:1 on the dialog (light theme); same mix as the other sheets
const ringed = sel => `${sel}{outline:2px solid transparent;border-color:${RING};box-shadow:0 0 0 3px color-mix(in oklab, ${RING} 50%, transparent)}`

export const SETTINGS_CSS = `
.oc-sf{container-type:inline-size;color:var(--foreground);font-size:13px;line-height:1.4}
.oc-sf-in{display:grid;grid-template-columns:216px minmax(0,1fr);min-height:0}
.oc-sf-nav{display:flex;flex-direction:column;gap:4px;padding:12px 8px;border-right:1px solid ${EDGE};background:color-mix(in oklab, var(--foreground) 4%, ${CARD})}
.oc-sf-tab{display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--ui-text-secondary);font:inherit;font-weight:500;text-align:left;white-space:nowrap;cursor:pointer;transition:background-color .12s ease}
.oc-sf-tab:hover{background:color-mix(in oklab, var(--foreground) 7%, transparent)}
.oc-sf-tab[aria-selected="true"]{background:${CARD};color:var(--foreground);font-weight:600;border-color:${EDGE};box-shadow:0 1px 2px color-mix(in oklab, var(--foreground) 12%, transparent)}
${ringed('.oc-sf-tab:focus-visible')}
.oc-sf-tab svg{flex:0 0 auto}
.oc-sf-bd{margin-left:auto;display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;background:color-mix(in oklab, ${VIOLET} 18%, transparent);color:var(--foreground)}
.oc-sf-panel{min-width:0;min-height:0;padding:8px 20px 16px}
.oc-sf-panel:focus-visible{outline:2px solid transparent;box-shadow:inset 0 0 0 2px color-mix(in oklab, ${RING} 60%, transparent)}
.oc-sf-panel h3{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:20px 0 0;font-size:15px;font-weight:600}
.oc-sf-wl{display:flex;align-items:center;gap:8px;margin:12px 0 0}
.oc-sf-wl + h3{margin-top:12px}
.oc-sx-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.oc-sf-where{position:relative;display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;border:1px solid ${EDGE};font-size:11px;font-weight:600;color:var(--ui-text-secondary)}
.oc-sx-row{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:12px 0;border-bottom:1px solid ${HAIR}}
.oc-sx-row:last-child{border-bottom:0}
.oc-sx-lab{flex:1 1 192px;min-width:0}
.oc-sx-name{display:flex;align-items:center;gap:8px;font-weight:600}
.oc-sx-name label{cursor:pointer}
.oc-sx-lab small{display:block;color:${TEXT3};font-size:12px}
.oc-sx-warn{color:var(--foreground);font-size:12px;padding-left:8px;border-left:3px solid ${ORANGE}}
.oc-sx-ctl{flex:0 0 auto;display:flex;align-items:center;gap:8px;max-width:100%}
.oc-sx-arrow{color:${TEXT3}}

.oc-sx-help{flex:0 0 auto;display:inline-grid;place-items:center;width:24px;height:24px;padding:0;border:1px solid ${EDGE};border-radius:12px;background:transparent;color:var(--ui-text-secondary);font:inherit;font-size:12px;font-weight:700;cursor:pointer}
.oc-sx-help:hover,.oc-sx-help[aria-expanded="true"]{border-color:var(--ui-accent);color:var(--foreground)}
${ringed('.oc-sx-help:focus-visible')}
.oc-sx-tip{position:absolute;z-index:6;left:0;top:calc(100% - 4px);box-sizing:border-box;width:max-content;max-width:min(320px,100%);padding:12px;border:1px solid ${EDGE};border-radius:10px;background:${CARD};color:var(--ui-text-secondary);font-size:12.5px;font-weight:400;line-height:1.45;box-shadow:0 10px 30px color-mix(in oklab, var(--foreground) 18%, transparent)}
.oc-sx-tip.oc-sx-tip-up{top:auto;bottom:calc(100% - 4px)}
.oc-sx-tip p{margin:0 0 8px}
.oc-sx-tip p:last-child{margin:0}
.oc-sx-tip b{color:var(--foreground);font-weight:600}

.oc-sx-sw{appearance:none;-webkit-appearance:none;flex:0 0 auto;position:relative;width:40px;height:24px;margin:0;border-radius:12px;border:1px solid ${FIELD_EDGE};background:color-mix(in oklab, var(--foreground) 14%, ${CARD});cursor:pointer;transition:background-color .15s ease}
.oc-sx-sw::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--foreground);transition:transform .15s ease}
.oc-sx-sw:checked{background:var(--ui-accent);border-color:var(--ui-accent)}
.oc-sx-sw:checked::after{transform:translateX(16px);background:${CARD}}
.oc-sx-sw:disabled,.oc-sx-sw[aria-disabled="true"]{cursor:progress;opacity:.6}
.oc-fc[aria-disabled="true"]{cursor:progress;opacity:.6}
${ringed('.oc-sx-sw:focus-visible')}

.oc-sx-seg{display:inline-flex;padding:2px;border:1px solid ${FIELD_EDGE};border-radius:8px;background:${CARD}}
.oc-sx-seg label{position:relative;display:inline-flex}
.oc-sx-seg input{position:absolute;inset:0;margin:0;opacity:0;cursor:pointer}
.oc-sx-seg span{display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:6px;color:var(--ui-text-secondary);font-weight:500;white-space:nowrap}
.oc-sx-seg input:checked+span{background:var(--ui-accent);color:var(--primary-foreground, ${CARD});font-weight:600}
.oc-sx-seg input:focus-visible+span{outline:2px solid transparent;box-shadow:0 0 0 3px color-mix(in oklab, ${RING} 50%, transparent)}

.oc-sx-btn{display:inline-flex;align-items:center;gap:4px;min-height:28px;padding:0 12px;border:1px solid var(--ui-accent);border-radius:4px;background:${CARD};color:var(--foreground);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.oc-sx-btn[aria-disabled="true"]{opacity:.55;cursor:default}
${ringed('.oc-sx-btn:focus-visible')}
.oc-sx-link{display:inline-flex;align-items:center;gap:4px;min-height:32px;padding:4px 0;text-align:left;border:0;background:none;color:var(--ui-accent);font:inherit;font-size:12.5px;line-height:16px;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
${ringed('.oc-sx-link:focus-visible')}

.oc-sx-budget{position:relative;display:grid;grid-template-columns:88px minmax(0,1fr);gap:16px;align-items:center;margin:8px 0;padding:12px;border:1px solid color-mix(in oklab, ${VIOLET} 30%, ${EDGE});border-radius:12px;background:linear-gradient(135deg, color-mix(in oklab, ${VIOLET} 12%, ${CARD}), ${CARD})}
.oc-sx-gauge{display:block;width:88px;height:88px}
.oc-sx-gauge circle{fill:none;stroke-width:9}
.oc-sx-gauge .bg{stroke:color-mix(in oklab, var(--foreground) 14%, ${CARD})}
.oc-sx-gauge .fg{stroke:${VIOLET};stroke-linecap:round;transform:rotate(-90deg);transform-origin:50% 50%;transition:stroke-dashoffset .3s ease}
.oc-sx-gauge[data-hit="true"] .fg{stroke:${ORANGE}}
.oc-sx-gauge text{fill:var(--foreground);font:700 14px ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.oc-sx-gauge .u{fill:${TEXT3};font:500 10px ui-monospace,SFMono-Regular,Menlo,monospace}
.oc-sx-bud{min-width:0}
.oc-sx-bud .oc-sx-name{font-size:14px}
.oc-sx-bud small{display:block;color:${TEXT3};font-size:12px}
.oc-sx-cap{margin-top:8px}
.oc-sx-cap summary{display:inline-flex;align-items:center;gap:4px;min-height:24px;color:var(--ui-accent);font-size:12.5px;cursor:pointer;list-style:none}
.oc-sx-cap summary::-webkit-details-marker{display:none}
.oc-sx-cap summary::before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .12s ease}
.oc-sx-cap[open] summary::before{transform:rotate(45deg)}
${ringed('.oc-sx-cap summary:focus-visible')}
.oc-sx-capg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}
.oc-sx-capg label{display:flex;flex-direction:column;gap:4px;color:${TEXT3};font-size:12px}
.oc-sx-capg input{box-sizing:border-box;width:100%;height:32px;padding:0 8px;border:1px solid ${FIELD_EDGE};border-radius:2.5px;background:${CARD};color:var(--foreground);font:inherit}
.oc-sx-capg small{grid-column:1 / -1;color:${TEXT3};font-size:12px}

.oc-nt-sub{display:flex;align-items:center;gap:8px;margin:20px 0 0;padding-top:12px;border-top:1px solid ${EDGE};font-size:13px;font-weight:600;color:var(--foreground)}
.oc-nt-sub svg{color:var(--ui-accent)}
.oc-nt-chips{flex:1 0 100%;display:flex;flex-wrap:wrap;gap:8px;min-width:0}
.oc-nt-line{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px}
.oc-nt-line small{display:inline}
.oc-nt-line .oc-nt-chips{flex:0 0 auto}
.oc-nt-line .oc-nt-chip span{min-height:24px;padding:0 8px;font-size:11.5px}
.oc-nt-type{padding:8px 0}
.oc-nt-grp .oc-lm-g{margin-top:12px}
.oc-nt-note{display:flex;flex-wrap:wrap;align-items:center;gap:0 12px;margin:8px 0 0;color:${TEXT3};font-size:12px;line-height:16px}
.oc-nt-note .oc-sx-link{min-height:28px;font-size:12px}
.oc-nt-chip{position:relative;display:inline-flex;max-width:100%}
.oc-nt-chip input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.oc-nt-chip span{display:inline-flex;align-items:center;gap:8px;box-sizing:border-box;max-width:100%;min-height:28px;padding:0 12px;border:1px solid ${FIELD_EDGE};border-radius:14px;background:${CARD};color:var(--ui-text-secondary);font-size:12px;font-weight:500;line-height:16px;overflow-wrap:anywhere}
.oc-nt-chip span::before{content:"";flex:0 0 auto;width:8px;height:8px;border-radius:50%;border:1.5px solid currentColor}
.oc-nt-chip input:checked+span{border-color:var(--ui-accent);background:color-mix(in oklab, var(--ui-accent) 14%, ${CARD});color:var(--foreground);font-weight:600}
.oc-nt-chip input:checked+span::before{background:var(--ui-accent);border-color:var(--ui-accent)}
.oc-nt-chip input:disabled,.oc-nt-chip input[aria-disabled="true"]{cursor:default}
.oc-nt-chip input:disabled+span,.oc-nt-chip input[aria-disabled="true"]+span{opacity:.55}
.oc-nt-chip input:focus-visible+span{outline:2px solid transparent;box-shadow:0 0 0 3px color-mix(in oklab, ${RING} 50%, transparent)}
.oc-nt-type[data-on="false"] .oc-nt-chips{opacity:.8}
.oc-nt-sum{display:flex;align-items:flex-start;gap:8px;margin:8px 0 0;padding:8px 12px;border:1px solid ${EDGE};border-radius:8px;background:color-mix(in oklab, ${VIOLET} 8%, ${CARD});font-size:12.5px;line-height:16px}
.oc-nt-sum svg{flex:0 0 auto;color:${VIOLET}}
.oc-nt-sum small{display:block;color:${TEXT3};font-size:12px}
.oc-nt-bubble{box-sizing:border-box;margin:8px 0 0;padding:12px;max-width:min(480px,100%);border:1px solid ${EDGE};border-radius:4px 14px 14px 14px;background:color-mix(in oklab, var(--ui-accent) 8%, ${CARD});color:var(--foreground);font:inherit;font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
.oc-nt-bubble b{font-weight:700}
.oc-nt-gl{display:inline-block;width:16px;height:16px;margin-right:4px;vertical-align:-3px;color:${VIOLET}}
.oc-nt-gl svg{display:block}
.oc-sx-row:has(+ .oc-nt-sub){border-bottom:0}
.oc-nt-type .oc-sx-warn{flex:1 0 100%;margin:0}
.oc-nt-cap{margin:12px 0 0;color:${TEXT3};font-size:12px;line-height:16px}
.oc-nt-test{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.oc-sx-feat{position:relative;display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:2px 12px;align-items:center;padding:12px 0;border-bottom:1px solid ${HAIR}}
.oc-sx-fi{grid-row:1 / 3;display:grid;place-items:center;width:36px;height:36px;border-radius:9px;color:${VIOLET};background:color-mix(in oklab, ${VIOLET} 13%, ${CARD});border:1px solid color-mix(in oklab, ${VIOLET} 30%, ${EDGE})}
.oc-sx-feat[data-state="off"] .oc-sx-fi{color:${TEXT3};background:color-mix(in oklab, var(--foreground) 6%, ${CARD});border-color:${EDGE}}
.oc-sx-feat .oc-sx-name{grid-column:2;flex-wrap:wrap}
.oc-sx-feat small{grid-column:2;color:${TEXT3};font-size:12px}
.oc-sx-feat .oc-sx-ctl{grid-row:1 / 3;grid-column:3}
.oc-sx-fx{grid-column:2 / -1;display:flex;flex-direction:column;align-items:flex-start}
.oc-sx-fx>*{margin-top:8px}
.oc-sx-fx>*:empty{margin:0}
/* the gauge and the two models on top, the ten functions in two groups of rows, each row = name + state + « Sends », lane chip, action, « ? » + switch */
/* the window keeps ONE size whichever tab is open (a window that grows when a tab opens moves the tab list from under the pointer): the size of the tallest tab that fits the screen, the rest scrolls inside */
.oc-lm-top{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr) minmax(0,1fr);gap:8px 16px;align-items:start;border:1px solid ${EDGE};border-radius:12px;padding:8px 12px;margin:4px 0 0;background:linear-gradient(135deg, color-mix(in oklab, ${VIOLET} 7%, ${CARD}), ${CARD} 60%)}
.oc-lm-wide{grid-column:1 / -1;margin:0}
.oc-lm-load{color:${TEXT3};font-size:12px}
.oc-lm-bud{display:grid;grid-template-columns:64px minmax(0,1fr);gap:12px;align-items:center}
.oc-lm-bud .oc-sx-gauge{width:64px;height:64px}
.oc-lm-bud .oc-sx-gauge text{font-size:11px}
.oc-lm-bud .oc-sx-gauge .u{font-size:8px}
.oc-lm-budt{position:relative;min-width:0}
.oc-lm-budt .oc-sx-name{font-size:13px}
.oc-lm-budt small{display:block;color:${TEXT3};font-size:12px;line-height:16px;margin-top:4px}
.oc-lm-mod{position:relative;display:flex;flex-direction:column;gap:4px;min-width:0}
.oc-lm-modh{display:flex;align-items:center;gap:8px;height:20px;font-size:12px;font-weight:600}
.oc-lm-sel{width:100%;height:32px;min-width:0;border:1px solid ${FIELD_EDGE};border-radius:4px;background:${CARD};color:var(--foreground);font:inherit;font-size:13px;padding:0 8px}
${ringed('.oc-lm-sel:focus-visible')}
.oc-lm-mod small{font-size:12px;color:${TEXT3}}
.oc-lm-mod.dis .oc-lm-modh,.oc-lm-mod.dis small{color:${TEXT3}}
.oc-lm-mod.dis .oc-lm-sel{opacity:.55;cursor:not-allowed}
.oc-lm-grant{position:relative;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 12px;border-radius:8px;border:1px dashed color-mix(in oklab, ${ORANGE} 55%, ${EDGE});background:color-mix(in oklab, ${ORANGE} 6%, ${CARD});font-size:12.5px;font-weight:600}
.oc-lm-grant>svg{color:${ORANGE};flex:0 0 auto}
.oc-lm-cmd{display:flex;align-items:center;gap:4px;min-width:0}
.oc-lm-cmd code{font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace;padding:4px 8px;border-radius:6px;background:color-mix(in oklab, var(--foreground) 6%, ${CARD});border:1px solid ${EDGE};overflow-wrap:anywhere;min-width:0}
.oc-lm-ib{display:inline-grid;place-items:center;width:28px;height:28px;border:1px solid ${EDGE};border-radius:6px;background:${CARD};color:var(--foreground);cursor:pointer}
${ringed('.oc-lm-ib:focus-visible')}
.oc-lm-copied{flex:1 0 100%;font-size:12px;font-weight:500;color:${TEXT3}}
.oc-lm-copied:empty{display:none}
.oc-lm-list{display:block}
.oc-lm-g{display:flex;align-items:center;gap:8px;margin:12px 0 0;height:20px;font-size:12px;font-weight:700;color:var(--ui-text-secondary)}
.oc-lm-g .n{font-weight:500;color:${TEXT3}}
.oc-lm-g .ln{flex:1 1 auto;height:1px;background:${HAIR}}
.oc-lm-row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) max-content max-content max-content;column-gap:12px;align-items:center;min-height:40px;padding:2px 0;border-bottom:1px solid ${HAIR}}
.oc-lm-mc{grid-column:1;display:flex;flex-direction:column;min-width:0}
.oc-lm-pay{margin:8px 0 0;padding-left:8px;border-left:3px solid ${VIOLET};color:var(--foreground);font-size:12.5px;line-height:16px}
.oc-lm-gn{margin:8px 0 0}
.oc-lm-row[data-quiet="true"]{opacity:.62}
.oc-lm-calls{white-space:nowrap}
/* the « ? » of a feature sits at the right end of its row: its note opens under it, right-aligned */
.oc-lm-row .oc-sx-tip{left:auto;right:0}
.oc-lm-mc .oc-sx-name{flex-wrap:wrap}
.oc-lm-mc small{font-size:12px;line-height:16px;color:${TEXT3}}
.oc-lm-lc,.oc-lm-ac{display:flex;align-items:center}
.oc-lm-lc{grid-column:2}
.oc-lm-ac{grid-column:3}
.oc-lm-ac:empty,.oc-lm-lc:empty{display:none}
.oc-lm-ctl{grid-column:4;display:flex;align-items:center;gap:8px;justify-content:flex-end}
.oc-lm-fx{grid-column:1 / -1;display:flex;flex-direction:column;align-items:flex-start;gap:4px}
.oc-lm-fx:empty,.oc-lm-fx>*:empty{display:none}
.oc-lm-fx:not(:has(*:not(:empty))){display:none}
.oc-lm-row[data-on="false"] .oc-sx-name label,.oc-lm-row[data-on="false"] .oc-lm-lane{color:${TEXT3}}
.oc-lm-lane{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:12px;border:1px solid ${EDGE};background:color-mix(in oklab, var(--foreground) 4%, ${CARD});color:var(--ui-text-secondary);font-size:11.5px;font-weight:600;white-space:nowrap}
.oc-lm-lane i{width:12px;height:8px;flex:0 0 auto;opacity:.85;background:linear-gradient(90deg, ${VIOLET} 0 3px, transparent 3px 4px, ${VIOLET} 4px 7px, transparent 7px 8px, ${VIOLET} 8px 11px, transparent 11px)}
.oc-lm-lane.light i{background:linear-gradient(90deg, ${VIOLET} 0 3px, transparent 3px)}
.oc-lm-lane.host{border-style:dashed}
@container (max-width:640px){
  .oc-lm-top{grid-template-columns:minmax(0,1fr)}
  .oc-lm-row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"mc ctl" "lc ac";gap:0 8px;padding:8px 0}
  .oc-lm-lc,.oc-lm-ac{margin-top:4px}
  .oc-lm-mc{grid-area:mc}.oc-lm-ctl{grid-area:ctl;align-self:start}.oc-lm-lc{grid-area:lc}.oc-lm-ac{grid-area:ac;justify-content:flex-end}
}
.oc-sx-state{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;border:1px solid ${EDGE};font-size:11px;font-weight:600;white-space:nowrap}
.oc-sx-state[data-tone="ok"]{border-color:color-mix(in oklab, ${GREEN} 55%, ${EDGE});background:color-mix(in oklab, ${GREEN} 14%, transparent)}
.oc-sx-state[data-tone="warn"]{border-color:color-mix(in oklab, ${ORANGE} 60%, ${EDGE});background:color-mix(in oklab, ${ORANGE} 14%, transparent)}
.oc-sx-state[data-tone="off"]{color:var(--ui-text-secondary)}

.oc-sd{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(860px,calc(100vw - 16px));max-height:calc(100dvh - 32px);padding:0;border:1px solid ${EDGE};border-radius:14px;background:${CARD};color:var(--foreground);overflow:hidden;box-shadow:0 24px 60px color-mix(in oklab, var(--foreground) 30%, transparent)}
.oc-sd[open]{display:flex;flex-direction:column;animation:oc-sd-in .18s ease both}
.oc-sd::backdrop{background:color-mix(in oklab, var(--foreground) 40%, transparent)}
.oc-sd-h{display:flex;align-items:center;gap:12px;padding:16px;border-bottom:1px solid ${EDGE};flex:0 0 auto}
.oc-sd-h h2{margin:0;font-size:16px;font-weight:600}
.oc-sd-h svg{color:var(--ui-accent)}
.oc-sd-x{margin-left:auto;display:inline-grid;place-items:center;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:4px;background:transparent;color:var(--foreground);cursor:pointer}
.oc-sd-x:hover{background:color-mix(in oklab, var(--foreground) 7%, transparent)}
${ringed('.oc-sd-x:focus-visible')}
.oc-sd-b{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.oc-sd .oc-sf{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.oc-sd .oc-sf-in{flex:1 1 auto;height:min(600px,calc(100dvh - 160px))}
.oc-sd .oc-sf-panel{overflow-y:auto;overscroll-behavior:contain}
.oc-sd-f{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid ${EDGE};flex:0 0 auto}
.oc-sd-f .grow{flex:1 1 auto}
.oc-sd-f .oc-sd-saved{color:${TEXT3};font-size:12px}
.oc-sd-f .oc-sx-btn{min-height:32px}
@keyframes oc-sd-in{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}

.oc-sf-page{box-sizing:border-box;max-width:860px;border:1px solid ${EDGE};border-radius:12px;background:${CARD};overflow:hidden}
.oc-sf-page .oc-sf-in{min-height:360px}

.oc-sd[data-motion="reduced"]{animation:none}
.oc-sd[data-motion="reduced"] *,.oc-sf[data-motion="reduced"] *{transition:none !important}
@container (max-width:560px){
  .oc-sf-in{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
  .oc-sf-nav{flex-direction:row;gap:4px;padding:8px;border-right:0;border-bottom:1px solid ${EDGE};overflow-x:auto;overflow-y:hidden;scrollbar-width:none;overscroll-behavior-x:contain}   /* every tab keeps its label; the strip scrolls (the selected tab is scrolled into view), no label is reduced to an icon */
  .oc-sf-nav::-webkit-scrollbar{display:none}
  .oc-sf-tab{padding:0 8px;flex:0 0 auto}
  .oc-sf-tab[aria-selected="false"] .oc-sf-bd{display:none}
  .oc-sf-panel{padding:8px 12px 16px}
  .oc-sx-capg{grid-template-columns:minmax(0,1fr)}
}
@container (max-width:420px){
  .oc-sf-bd{display:none}
  /* three tabs share the strip: without their icons the three labels fit a 380 px screen, so none is pushed out of it */
  .oc-sf-tab{flex:1 1 auto;justify-content:center}
  .oc-sf-tab svg{display:none}
}
@container (max-width:340px){
  .oc-sf-nav{gap:2px}
  .oc-sf-tab{flex:1 1 0;justify-content:center;padding:0}
  .oc-sf-lb{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
}
@media (max-width:560px){
  .oc-sd-f .oc-sd-saved{display:none}
}
@media (pointer:coarse){
  .oc-sd-x,.oc-lm-ib{width:40px;height:40px}
  .oc-sf-tab{height:40px}
  .oc-sx-help{position:relative}
  .oc-sx-help::after{content:"";position:absolute;inset:-8px}
  .oc-sx-name{gap:16px}
  .oc-sx-ctl,.oc-lm-ctl{gap:16px}
  .oc-sx-sw{width:48px;height:28px;border-radius:14px}
  .oc-sx-sw::before{content:"";position:absolute;left:0;right:0;top:-6px;bottom:-6px}   /* 48 x 28 to the eye, 48 x 40 to the finger */
  .oc-sx-sw::after{top:3px;left:3px;width:20px;height:20px}
  .oc-sx-sw:checked::after{transform:translateX(20px)}
  .oc-sx-seg span{height:40px}
  .oc-sx-btn,.oc-sx-link,.oc-sd-f .oc-sx-btn,.oc-nt-note .oc-sx-link{min-height:40px}
  .oc-lm-ib{flex:0 0 40px}
  .oc-lm-top{row-gap:16px}
  .oc-lm-mod{gap:16px}
  .oc-lm-modh{height:24px}
  .oc-sx-cap{margin-top:16px}
  .oc-sx-cap summary{min-height:40px}
  .oc-fc,.oc-lm-sel,.oc-sx-capg input{height:40px!important}
  .oc-nt-chip span,.oc-nt-line .oc-nt-chip span{min-height:40px}
  .oc-sx-row,.oc-lm-row{row-gap:8px}
}
@media (prefers-reduced-motion:reduce){
  .oc-sd[open]{animation:none}
  .oc-sx-sw,.oc-sx-sw::after,.oc-sx-gauge .fg,.oc-sf-tab,.oc-sx-cap summary::before{transition:none}
}
`
