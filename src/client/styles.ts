/**
 * The Mission Board tab's scoped stylesheet.
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
  border: 0.5px solid var(--dsw-alias-state-warning-primary);
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

/**
 * Install the tab's stylesheet, owned by one effect.
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
    tag.textContent = STYLESHEET
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, `${PLUGIN_ID}: mission board stylesheet`)
}
