/**
 * The plugin's scoped stylesheets: the Mission Board tab and the Missions page.
 *
 * Follows the scaffold's owned-stylesheet pattern
 * (`workspaces/k/dsh/dsh-chat-wide/src/client/styles.ts`): one `<style>` element
 * is created inside a `ctx.effect()`, marked with `data-plugin` and
 * `data-plugin-css`, and removed by that same effect's disposer, so HMR
 * re-activation can never accumulate nodes.
 *
 * Every rule is scoped to `[data-aweave-devkit='mission-board']`, the marker
 * `MissionBoardBody` puts on its root, so nothing here can reach the rest of
 * the page. Colour comes from the platform's `--dsw-alias-*` theme aliases
 * only, so the states this plugin itself renders (loading / unconfigured /
 * failed / the open-INDEX notice) follow light and dark themes without a
 * second definition.
 *
 * Far smaller than the deleted Task Board stylesheet: this plugin no longer
 * renders a board, columns, or cards — `embed.js` (`@hod/aweave-mission-web`'s
 * bundle) owns all of that inside its own Shadow DOM, injecting its own CSS
 * there rather than into this page's `document.head`. This stylesheet covers
 * only the shell this plugin itself draws around the embed container.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'

import { PLUGIN_ID } from '../config.ts'

/** Stylesheet identity reported through the owned style element's `data-plugin-css`. */
const STYLE_ID = `${PLUGIN_ID}/mission-board`

/** The shell's rules, scoped to the body's own root marker. */
const STYLESHEET = `
[data-aweave-devkit='mission-board'] {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
[data-aweave-devkit='mission-board'] *,
[data-aweave-devkit='mission-board'] *::before,
[data-aweave-devkit='mission-board'] *::after { box-sizing: border-box; }

/* ── Board-level states ───────────────────────────────────────────────────── */
[data-aweave-devkit='mission-board'] .awe-mb-state {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  padding: 16px;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
}
[data-aweave-devkit='mission-board'] .awe-mb-state--error {
  margin: 12px;
  border: 0.5px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-label-primary);
}
[data-aweave-devkit='mission-board'] .awe-mb-state-title { margin: 0; font-size: 13px; font-weight: 600; }
[data-aweave-devkit='mission-board'] .awe-mb-state-detail {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

/* ── Notice banner ────────────────────────────────────────────────────────── */
[data-aweave-devkit='mission-board'] .awe-mb-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 12px 8px;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-state-warn-primary);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
}
[data-aweave-devkit='mission-board'] .awe-mb-notice-text {
  flex: 1;
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
[data-aweave-devkit='mission-board'] .awe-mb-notice-dismiss {
  flex: none;
  padding: 0 4px;
  border: none;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  cursor: pointer;
}
[data-aweave-devkit='mission-board'] .awe-mb-notice-dismiss:hover { color: var(--dsw-alias-label-primary); }

/* ── Embed container ──────────────────────────────────────────────────────── */
[data-aweave-devkit='mission-board'] .awe-mb-embed-container {
  flex: 1;
  min-height: 0;
}
`

/** The Missions page's rules, scoped to the page root's own marker. */
const PAGE_STYLESHEET = `
[data-aweave-devkit='missions-page'] {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  container-type: inline-size;
  container-name: awe-mp-page;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  font-size: 13px;
}
[data-aweave-devkit='missions-page'] *,
[data-aweave-devkit='missions-page'] *::before,
[data-aweave-devkit='missions-page'] *::after { box-sizing: border-box; }
[data-aweave-devkit='missions-page'] .awe-mp-dim { color: var(--dsw-alias-label-secondary); }
[data-aweave-devkit='missions-page'] .awe-mp-warn { color: var(--dsw-alias-state-warn-primary); }
[data-aweave-devkit='missions-page'] .awe-mp-mono { font-family: var(--ds-font-family-code); font-size: 12px; }
[data-aweave-devkit='missions-page'] .awe-mp-grow { flex: 1; }

/* Header */
[data-aweave-devkit='missions-page'] .awe-mp-head {
  position: relative;
  flex: none;
  background: var(--dsw-alias-bg-layer-1);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
[data-aweave-devkit='missions-page'] .awe-mp-headMain {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 28px;
  padding: 8px 12px 10px;
  padding-top: max(8px, var(--dsh-frame-top-clearance, 0px));
  padding-left: max(12px, var(--dsh-frame-leading-clearance, 0px));
}
[data-aweave-devkit='missions-page'] .awe-mp-titleIcon { display: inline-flex; color: var(--dsw-alias-label-secondary); }
[data-aweave-devkit='missions-page'] .awe-mp-title { margin: 0; font-size: 14px; font-weight: 600; }
[data-aweave-devkit='missions-page'] .awe-mp-stats { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; }
[data-aweave-devkit='missions-page'] .awe-mp-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 50%;
}
[data-aweave-devkit='missions-page'] .awe-mp-health { display: inline-flex; align-items: center; outline: none; }
[data-aweave-devkit='missions-page'] .awe-mp-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  overflow: hidden;
  opacity: 0;
  transition: opacity 120ms ease;
}
[data-aweave-devkit='missions-page'] .awe-mp-bar[data-active='true'] { opacity: 1; }
[data-aweave-devkit='missions-page'] .awe-mp-barFill {
  display: block;
  height: 100%;
  width: 35%;
  background: var(--dsw-alias-brand-primary);
  animation: awe-mp-sweep 1.2s ease-in-out infinite;
}
@keyframes awe-mp-sweep { from { transform: translateX(-100%); } to { transform: translateX(300%); } }

/* Notice and states */
[data-aweave-devkit='missions-page'] .awe-mp-notice {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 12px 0;
  padding: 6px 10px;
  border: 0.5px solid var(--dsw-alias-state-warn-primary);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
}
[data-aweave-devkit='missions-page'] .awe-mp-noticeText { flex: 1; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
[data-aweave-devkit='missions-page'] .awe-mp-noticeClose {
  flex: none;
  padding: 0 4px;
  border: none;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  cursor: pointer;
}
[data-aweave-devkit='missions-page'] .awe-mp-noticeClose:hover { color: var(--dsw-alias-label-primary); }
[data-aweave-devkit='missions-page'] .awe-mp-state {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  margin: 0;
  padding: 16px;
  color: var(--dsw-alias-label-secondary);
}
[data-aweave-devkit='missions-page'] .awe-mp-state--error {
  margin: 12px;
  border: 0.5px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-label-primary);
}
[data-aweave-devkit='missions-page'] .awe-mp-stateTitle { margin: 0; font-size: 13px; font-weight: 600; }
[data-aweave-devkit='missions-page'] .awe-mp-stateDetail { margin: 0; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }

/* Body: board | splitter | detail */
[data-aweave-devkit='missions-page'] .awe-mp-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
[data-aweave-devkit='missions-page'][data-detail-open] .awe-mp-body {
  grid-template-columns: minmax(0, 1fr) 6px var(--awe-detail, 560px);
}
[data-aweave-devkit='missions-page'] .awe-mp-board { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
[data-aweave-devkit='missions-page'] .awe-mp-embed { flex: 1; min-height: 0; }
[data-aweave-devkit='missions-page'] .awe-mp-detail {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
}
[data-aweave-devkit='missions-page'] .awe-mp-backBar { display: none; flex: none; padding: 6px 8px 0; }

/* Splitters */
[data-aweave-devkit='missions-page'] .awe-mp-splitter { position: relative; flex: none; background: transparent; outline: none; touch-action: none; }
[data-aweave-devkit='missions-page'] .awe-mp-splitter::after {
  content: '';
  position: absolute;
  background: var(--dsw-alias-border-l1);
  transition: background 120ms ease;
}
[data-aweave-devkit='missions-page'] .awe-mp-splitter[data-orientation='vertical'] { width: 6px; cursor: col-resize; }
[data-aweave-devkit='missions-page'] .awe-mp-splitter[data-orientation='vertical']::after { left: 2px; top: 0; bottom: 0; width: 1px; }
[data-aweave-devkit='missions-page'] .awe-mp-splitter:hover::after,
[data-aweave-devkit='missions-page'] .awe-mp-splitter:focus-visible::after { background: var(--dsw-alias-brand-primary); }
[data-aweave-devkit='missions-page'] .awe-mp-splitter[data-orientation='vertical']:hover::after,
[data-aweave-devkit='missions-page'] .awe-mp-splitter[data-orientation='vertical']:focus-visible::after { width: 2px; }

/* Detail */
[data-aweave-devkit='missions-page'] .awe-mp-detailRoot { flex: 1; min-height: 0; display: flex; flex-direction: column; }
[data-aweave-devkit='missions-page'] .awe-mp-detailHead {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
[data-aweave-devkit='missions-page'] .awe-mp-detailTitle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
[data-aweave-devkit='missions-page'] .awe-mp-detailName { min-width: 0; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-aweave-devkit='missions-page'] .awe-mp-detailPath { flex-basis: 100%; min-width: 0; color: var(--dsw-alias-label-tertiary); }
[data-aweave-devkit='missions-page'] .awe-mp-detailBody {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: var(--awe-tree, 240px) 6px minmax(0, 1fr);
}
[data-aweave-devkit='missions-page'] .awe-mp-treeCol,
[data-aweave-devkit='missions-page'] .awe-mp-viewerCol { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
[data-aweave-devkit='missions-page'] .awe-mp-treeCol { overflow-y: auto; background: var(--dsw-alias-bg-layer-1); }

/* Tree */
[data-aweave-devkit='missions-page'] .awe-mp-tree { padding: 6px 4px; }
[data-aweave-devkit='missions-page'] .awe-mp-nest { padding-left: 12px; }
[data-aweave-devkit='missions-page'] .awe-mp-treeNote { margin: 4px 8px; font-size: 12px; line-height: 18px; }
[data-aweave-devkit='missions-page'] .awe-mp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 24px;
  padding: 2px 8px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: none;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}
[data-aweave-devkit='missions-page'] .awe-mp-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
[data-aweave-devkit='missions-page'] .awe-mp-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
[data-aweave-devkit='missions-page'] .awe-mp-row[data-active] { background: var(--dsw-alias-interactive-bg-hover); font-weight: 600; }
[data-aweave-devkit='missions-page'] .awe-mp-rowLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-aweave-devkit='missions-page'] .awe-mp-rowMeta { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; }

/* Viewer */
[data-aweave-devkit='missions-page'] .awe-mp-viewer { flex: 1; min-height: 0; display: flex; flex-direction: column; }
[data-aweave-devkit='missions-page'] .awe-mp-viewerBar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
[data-aweave-devkit='missions-page'] .awe-mp-viewerPath { flex: 1; min-width: 0; }
[data-aweave-devkit='missions-page'] .awe-mp-viewerScroll { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; }
[data-aweave-devkit='missions-page'] .awe-mp-inlineNotice {
  margin: 0 0 8px;
  padding: 6px 10px;
  border: 0.5px solid var(--dsw-alias-state-warn-primary);
  border-radius: var(--dsw-radius-md);
  font-size: 12px;
}
[data-aweave-devkit='missions-page'] .awe-mp-skel {
  height: 96px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  animation: awe-mp-pulse 1.4s ease-in-out infinite;
}
@keyframes awe-mp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

/* Front matter */
[data-aweave-devkit='missions-page'] .awe-mp-meta {
  margin: 0 0 12px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
[data-aweave-devkit='missions-page'] .awe-mp-metaName { margin: 0 0 6px; font-weight: 600; }
[data-aweave-devkit='missions-page'] .awe-mp-metaRow { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
[data-aweave-devkit='missions-page'] .awe-mp-metaMore { margin: 8px 0 0; display: grid; gap: 4px; }
[data-aweave-devkit='missions-page'] .awe-mp-metaItem { display: flex; gap: 8px; font-size: 12px; overflow-wrap: anywhere; }

/* Narrow page: the detail replaces the board */
@container awe-mp-page (max-width: 900px) {
  [data-aweave-devkit='missions-page'][data-detail-open] .awe-mp-body { grid-template-columns: minmax(0, 1fr); }
  [data-aweave-devkit='missions-page'][data-detail-open] .awe-mp-board,
  [data-aweave-devkit='missions-page'][data-detail-open] .awe-mp-splitDetail { display: none; }
  [data-aweave-devkit='missions-page'] .awe-mp-backBar { display: flex; }
}

@media (prefers-reduced-motion: reduce) {
  [data-aweave-devkit='missions-page'] .awe-mp-barFill { animation: none; width: 40%; }
  [data-aweave-devkit='missions-page'] .awe-mp-skel { animation: none; }
  [data-aweave-devkit='missions-page'] .awe-mp-bar,
  [data-aweave-devkit='missions-page'] .awe-mp-row,
  [data-aweave-devkit='missions-page'] .awe-mp-splitter::after { transition: none; }
}
`

/**
 * Install the tab's and the page's stylesheet, owned by one effect.
 *
 * One effect owns the element, so the plugin can never hold two stylesheets: the
 * disposer removes that exact node.
 * @param ctx - browser-side plugin context owning the effect.
 */
export function installBoardStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = STYLE_ID
    tag.textContent = `${STYLESHEET}\n${PAGE_STYLESHEET}`
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, `${PLUGIN_ID}: stylesheets`)
}
