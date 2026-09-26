/**
 * The board's scoped stylesheet.
 *
 * Follows the scaffold's owned-stylesheet pattern
 * (`workspaces/k/dsh/dsh-chat-wide/src/client/styles.ts`): one `<style>` element
 * is created inside a `ctx.effect()`, marked with `data-plugin` and
 * `data-plugin-css`, and removed by that same effect's disposer, so HMR
 * re-activation can never accumulate nodes.
 *
 * Every rule is scoped to `[data-aweave-devkit='taskboard']`, the marker the body
 * puts on its root, so nothing here can reach the rest of the page. Colour comes
 * from the platform's `--dsw-alias-*` theme aliases only: there is no literal
 * colour, so the board follows light and dark themes without a second definition.
 * The one colour that is not a token is a column's status dot, which is the value
 * the backend configured — data, not styling.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'

import { PLUGIN_ID } from '../config.ts'

/** Stylesheet identity reported through the owned style element's `data-plugin-css`. */
const STYLE_ID = `${PLUGIN_ID}/taskboard`

/** The board's rules, scoped to the body's own root marker. */
const STYLESHEET = `
[data-aweave-devkit='taskboard'] {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
[data-aweave-devkit='taskboard'] *,
[data-aweave-devkit='taskboard'] *::before,
[data-aweave-devkit='taskboard'] *::after { box-sizing: border-box; }

/* ── Board-level states ───────────────────────────────────────────────────── */
[data-aweave-devkit='taskboard'] .awe-tb-state {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  padding: 16px;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
}
[data-aweave-devkit='taskboard'] .awe-tb-state--error {
  margin: 12px;
  border: 0.5px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-label-primary);
}
[data-aweave-devkit='taskboard'] .awe-tb-state-title { margin: 0; font-size: 13px; font-weight: 600; }
[data-aweave-devkit='taskboard'] .awe-tb-state-detail {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

/* ── Notice banner ────────────────────────────────────────────────────────── */
[data-aweave-devkit='taskboard'] .awe-tb-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 12px 8px;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-state-warning-primary);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
}
[data-aweave-devkit='taskboard'] .awe-tb-notice-text {
  flex: 1;
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
[data-aweave-devkit='taskboard'] .awe-tb-notice-dismiss {
  flex: none;
  padding: 0 4px;
  border: none;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  cursor: pointer;
}
[data-aweave-devkit='taskboard'] .awe-tb-notice-dismiss:hover { color: var(--dsw-alias-label-primary); }

/* ── Filter bar ───────────────────────────────────────────────────────────── */
[data-aweave-devkit='taskboard'] .awe-tb-filterbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
[data-aweave-devkit='taskboard'] .awe-tb-input,
[data-aweave-devkit='taskboard'] .awe-tb-select {
  padding: 3px 6px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  outline: none;
}
[data-aweave-devkit='taskboard'] .awe-tb-input:focus-visible,
[data-aweave-devkit='taskboard'] .awe-tb-select:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
[data-aweave-devkit='taskboard'] .awe-tb-select:disabled { opacity: 0.5; }
[data-aweave-devkit='taskboard'] .awe-tb-search { flex: 1 1 160px; min-width: 120px; }
[data-aweave-devkit='taskboard'] .awe-tb-cascade { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
[data-aweave-devkit='taskboard'] .awe-tb-chips { display: flex; flex-wrap: wrap; gap: 4px; }
[data-aweave-devkit='taskboard'] .awe-tb-chip {
  padding: 2px 6px;
  border: none;
  border-radius: 10px;
  background: var(--dsw-alias-markdown-tag);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
[data-aweave-devkit='taskboard'] .awe-tb-chip:hover { color: var(--dsw-alias-label-primary); }

/* ── Buttons ──────────────────────────────────────────────────────────────── */
[data-aweave-devkit='taskboard'] .awe-tb-btn {
  padding: 3px 10px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
[data-aweave-devkit='taskboard'] .awe-tb-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
[data-aweave-devkit='taskboard'] .awe-tb-btn:disabled { opacity: 0.5; cursor: default; }
[data-aweave-devkit='taskboard'] .awe-tb-btn--primary {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  border-color: transparent;
}

/* ── Board and columns ────────────────────────────────────────────────────── */
[data-aweave-devkit='taskboard'] .awe-tb-board {
  display: flex;
  flex: 1;
  gap: 10px;
  align-items: flex-start;
  min-height: 0;
  padding: 12px;
  overflow-x: auto;
}
[data-aweave-devkit='taskboard'] .awe-tb-column {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  min-width: 220px;
  max-width: 300px;
  max-height: 100%;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
}
[data-aweave-devkit='taskboard'] .awe-tb-column-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  font-weight: 600;
}
[data-aweave-devkit='taskboard'] .awe-tb-column-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; }
[data-aweave-devkit='taskboard'] .awe-tb-column-label { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
[data-aweave-devkit='taskboard'] .awe-tb-column-count {
  padding: 0 7px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-multi-select);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 500;
}
[data-aweave-devkit='taskboard'] .awe-tb-column-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-height: 40px;
  padding: 8px;
  overflow-y: auto;
}
[data-aweave-devkit='taskboard'] .awe-tb-column-body--over { background: var(--dsw-alias-interactive-bg-hover-accent); }
[data-aweave-devkit='taskboard'] .awe-tb-column-empty {
  padding: 12px 0;
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  text-align: center;
}

/* ── In-column group headers ──────────────────────────────────────────────── */
[data-aweave-devkit='taskboard'] .awe-tb-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin-top: 2px;
  padding: 3px 4px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: none;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
}
[data-aweave-devkit='taskboard'] .awe-tb-group-header:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
[data-aweave-devkit='taskboard'] .awe-tb-group-chevron { flex: none; font-size: 10px; line-height: 1; transition: transform 0.12s ease; }
[data-aweave-devkit='taskboard'] .awe-tb-group-chevron--collapsed { transform: rotate(-90deg); }
[data-aweave-devkit='taskboard'] .awe-tb-group-label {
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 600;
}
[data-aweave-devkit='taskboard'] .awe-tb-group-count {
  flex: none;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-multi-select);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0;
}
@media (prefers-reduced-motion: reduce) {
  [data-aweave-devkit='taskboard'] .awe-tb-group-chevron { transition: none; }
}

/* ── Cards ────────────────────────────────────────────────────────────────── */
[data-aweave-devkit='taskboard'] .awe-tb-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-base);
  cursor: grab;
  touch-action: none;
}
[data-aweave-devkit='taskboard'] .awe-tb-card:hover { border-color: var(--dsw-alias-state-business-primary); }
[data-aweave-devkit='taskboard'] .awe-tb-card:active { cursor: grabbing; }
[data-aweave-devkit='taskboard'] .awe-tb-card:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
[data-aweave-devkit='taskboard'] .awe-tb-card--overlay { cursor: grabbing; }
[data-aweave-devkit='taskboard'] .awe-tb-card-title { font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
[data-aweave-devkit='taskboard'] .awe-tb-card-scope { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
[data-aweave-devkit='taskboard'] .awe-tb-card-tags { display: flex; flex-wrap: wrap; gap: 4px; }
[data-aweave-devkit='taskboard'] .awe-tb-tag {
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--dsw-alias-markdown-tag);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
}

/* ── Quick create ─────────────────────────────────────────────────────────── */
[data-aweave-devkit='taskboard'] .awe-tb-quickadd-toggle {
  margin: 8px;
  padding: 6px;
  border: 1px dashed var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-sm);
  background: none;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
[data-aweave-devkit='taskboard'] .awe-tb-quickadd-toggle:hover {
  border-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary);
}
[data-aweave-devkit='taskboard'] .awe-tb-quickadd,
[data-aweave-devkit='taskboard'] .awe-tb-quickadd-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
}
[data-aweave-devkit='taskboard'] .awe-tb-quickadd-actions { flex-direction: row; padding: 0; }
[data-aweave-devkit='taskboard'] .awe-tb-quickadd .awe-tb-cascade { flex-direction: column; align-items: stretch; }
[data-aweave-devkit='taskboard'] .awe-tb-quickadd .awe-tb-select { width: 100%; }
[data-aweave-devkit='taskboard'] .awe-tb-hint {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}
`

/**
 * Install the board's stylesheet, owned by one effect.
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
  }, `${PLUGIN_ID}: task board stylesheet`)
}
