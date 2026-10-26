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
 * states around the embed container, the open-INDEX degradation notices, and
 * the Missions page (its row, header, mission file tree and viewer).
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Mission Board tab title, guide entry, the Missions page, and the states around the embedded board. */
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

  'nav.label': 'Missions',
  'page.title': 'Missions',
  'page.total': '{count} total',
  'page.updated': 'Updated {time}',
  'page.health.ok': 'The Aweave mission backend is reachable',
  'page.health.loading': 'Contacting the Aweave mission backend…',
  'page.health.unreachable': 'The Aweave mission backend is unreachable: {message}',
  'page.health.backend': 'The Aweave mission backend refused a request: {message}',
  'page.health.malformed': 'The Aweave mission backend answered something unreadable: {message}',
  'page.retry': 'Retry',
  'page.back': 'Back to the board',
  'page.statuses': 'Missions per status',
  'page.splitter': 'Resize the mission detail',

  'detail.refresh': 'Refresh',
  'detail.refresh.tip': 'Reload the mission tree and the open file',
  'detail.close': 'Close',
  'detail.close.tip': 'Close the mission detail',
  'detail.splitter': 'Resize the file tree',

  'tree.label': 'Mission files',
  'tree.mission': 'Mission folder',
  'tree.plans': 'Linked plans',
  'tree.references': 'References',
  'tree.empty': 'This mission folder holds no markdown files.',
  'tree.truncated': 'The folder is large: the tree shows only the first entries.',
  'tree.loading': 'Reading the mission folder…',
  'tree.error': 'The mission folder could not be read: {message}',

  'viewer.loading': 'Loading the file…',
  'viewer.back': 'Back',
  'viewer.back.tip': 'Return to the previous file',
  'viewer.empty': 'This file is empty.',
  'viewer.frontMatter.more': 'More fields',
  'viewer.frontMatter.less': 'Fewer fields',
  'viewer.code.copy': 'Copy',
  'viewer.code.copied': 'Copied',
  'viewer.footnotes': 'Footnotes',
  'viewer.badLink': '"{dest}" is not a markdown file under resources/, so nothing was opened.',
  'viewer.errors.notFound': 'This file does not exist (any more).',
  'viewer.errors.tooLarge': 'This file is {size} KiB, over the {limit} KiB viewer limit.',
  'viewer.errors.root':
    'The Aweave platform root is not usable, so no file can be read. Set the aweaveRoot setting of aweave-dsh-devkit to the platform root.',
  'viewer.errors.unreachable': 'The Host could not be reached: {message}',
  'viewer.errors.generic': 'The file could not be read: {message}',
} satisfies Record<string, string>

/** Every key the Mission Board dictionary defines. */
export type AweaveMissionBoardKey = keyof typeof en

/** The namespace-bound translate seat a Mission Board component receives. */
export type MissionBoardTranslate = PropsLocale<'aweaveMissionBoard'>['t']
