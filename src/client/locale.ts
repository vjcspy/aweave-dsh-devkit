/**
 * Copy dictionary for the Mission Board tab.
 *
 * Every product-visible string this plugin renders lives here and reaches a
 * component through the `t` seat; no component carries literal copy. Placeholders
 * use the locale service's `{name}` interpolation form.
 *
 * Only English ships. The locale service's lookup chain ends at `en` for every
 * active locale (the built-in `zh` definition declares `en` as its fallback), so
 * a composition running in another language still resolves every key here rather
 * than showing the key itself.
 *
 * The namespace merge lives with its key set, so a module naming
 * `TranslateNS<'aweaveMissionBoard'>` or `PropsLocale<'aweaveMissionBoard'>` needs only
 * this file, whichever entry a program loads first.
 *
 * Far smaller than the deleted `aweaveTaskboard` dictionary: `embed.js` owns
 * almost every user-facing string of the board itself (filters, columns,
 * cards, drag/drop notices) — this plugin's own copy covers only what it
 * still renders directly: the tab shell, the unconfigured/loading/failed
 * states around the embed container, and the open-INDEX degradation notices.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Mission Board tab title, guide entry, and the states around the embedded board. */
    aweaveMissionBoard: AweaveMissionBoardKey
  }
}

/** English dictionary, and the namespace's key-set source of truth. */
export const en = {
  'tab.title': 'Mission Board',
  'guide.title': 'Aweave Mission Board',
  'guide.description': 'Browse and reorder the Aweave mission backlog',

  'state.loading': 'Loading the mission board…',
  'state.unconfigured.title': 'The board is not configured',
  'state.unconfigured.detail':
    'The Host published no board configuration, so no mission can be read. Reload the page; if this persists, the plugin did not activate.',
  'state.failed.title': 'The mission board could not be loaded',
  'state.failed.detail':
    'The embed script failed to load. Confirm the Aweave server is running and reachable, then reload the tab.',

  'action.dismiss': 'Dismiss this message',

  'error.open.invalidPath':
    'The board asked to open "{path}", which is not a mission INDEX.md path, so nothing was opened.',
  'error.open.noRoot':
    'The Aweave platform root is unknown, so this mission cannot be opened. Set Config.aweaveRoot, or root the Session inside the platform.',
  'error.open.noSessionRoot':
    'This Session reports no workspace root, so {path} cannot be opened. Root the Session inside the Aweave platform.',
  'error.open.outsideSessionRoot':
    '{path} lies outside this Session\'s workspace ({cwd}), so it cannot be opened. Root the Session inside the Aweave platform.',
} satisfies Record<string, string>

/** Every key the Mission Board dictionary defines. */
export type AweaveMissionBoardKey = keyof typeof en

/** The namespace-bound translate seat a Mission Board component receives. */
export type MissionBoardTranslate = PropsLocale<'aweaveMissionBoard'>['t']
