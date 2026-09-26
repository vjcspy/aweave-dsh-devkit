/**
 * Copy dictionary for the Task Board tab.
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
 * `TranslateNS<'aweaveTaskboard'>` or `PropsLocale<'aweaveTaskboard'>` needs only
 * this file, whichever entry a program loads first.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Task Board tab title, guide entry, filters, columns, cards and errors. */
    aweaveTaskboard: AweaveTaskboardKey
  }
}

/** English dictionary, and the namespace's key-set source of truth. */
export const en = {
  'tab.title': 'Task Board',
  'guide.title': 'Aweave Task Board',
  'guide.description': 'Browse, filter, group and reorganize the Aweave _tasks backlog',

  'state.loading': 'Loading the task board…',
  'state.unconfigured.title': 'The board is not configured',
  'state.unconfigured.detail':
    'The Host published no board configuration, so no task can be read. Reload the page; if this persists, the plugin did not activate.',
  'state.unreachable.title': 'The Aweave taskboard backend is unreachable',
  'state.unreachable.detail':
    'The Host could not complete the request to the backend, so the board holds no task data. Start the Aweave taskboard backend, then retry.',
  'state.failed.title': 'The board could not be loaded',
  'state.failed.detail': 'The board holds no task data, because the first request failed.',
  'action.retry': 'Retry',
  'action.dismiss': 'Dismiss this message',

  'filter.search': 'Search name or description…',
  'filter.tag': '+ Tag filter…',
  'filter.statusAll': 'All statuses',
  'filter.groupedBy': 'Group by',
  'filter.chipRemove': 'Remove the {tag} tag filter',

  'group.workspace': 'Workspace',
  'group.domain': 'Domain',
  'group.repository': 'Repository',
  'group.scope': 'Full scope',
  'group.none': 'No grouping',
  'group.ungrouped': '(no scope)',

  'cascade.workspace': 'Workspace',
  'cascade.domain': 'Domain',
  'cascade.repository': 'Repository',
  'cascade.any': 'Any',

  'column.noStatus': 'No Status',
  'column.empty': 'No tasks',

  'card.open': 'Open {name}',

  'quickAdd.toggle': '+ Add task',
  'quickAdd.name': 'Task name…',
  'quickAdd.submit': 'Add',
  'quickAdd.cancel': 'Cancel',
  'quickAdd.scopeRequired': 'Workspace is required',
  'quickAdd.ariaLabel': 'Add a task to {column}',

  'error.unreachable': 'The Aweave taskboard backend is unreachable.',
  'error.failed': 'The board could not complete the request.',
  'error.backend': 'The backend refused the request.',
  'error.malformed': 'The board received an answer it cannot read.',
  'error.rankExhausted':
    'No rank fits between the neighbouring tasks of that slot — the gap is exhausted. The board was re-read and nothing was written.',
  'error.rankCollision':
    'The computed rank does not fall between the neighbouring tasks. The board was re-read and nothing was written.',
  'error.noStatusColumn': 'A task cannot be moved into "{column}".',
  'error.scopeRequired': 'Select a scope to create the task in.',
  'error.open.noRoot':
    'The Aweave platform root is unknown, so this task cannot be opened. Set Config.aweaveRoot, or root the Session inside the platform.',
  'error.open.noSessionRoot':
    'This Session reports no workspace root, so {path} cannot be opened. Root the Session inside the Aweave platform.',
  'error.open.outsideSessionRoot':
    '{path} lies outside this Session\'s workspace ({cwd}), so it cannot be opened. Root the Session inside the Aweave platform.',
} satisfies Record<string, string>

/** Every key the Task Board dictionary defines. */
export type AweaveTaskboardKey = keyof typeof en

/** The namespace-bound translate seat a Task Board component receives. */
export type TaskBoardTranslate = PropsLocale<'aweaveTaskboard'>['t']
