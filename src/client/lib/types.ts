/**
 * Task Board data shapes and view-state vocabulary.
 *
 * The four payload interfaces mirror the Aweave backend's own types verbatim
 * (`workspaces/devtools/common/taskboard-server/src/types.ts`), because the Host
 * forwards the backend envelope through unaltered: nothing renames a field, so
 * the browser half reads exactly what the backend wrote. `mirrored` (not
 * `mirror`) is the scope-scanner's field name.
 *
 * The view-state vocabulary — grouping key, collapsed-group identity, filters —
 * is the ported behaviour of the VS Code board's `lib/types.ts`, and it is the
 * shape both the `localStorage` snapshot and the pure grouping transform read.
 * @module
 */

/** One configured Kanban column, from `GET /taskboard/config`. */
export interface TaskStatus {
  readonly id: string
  readonly label: string
  readonly color: string
}

/** One discovered scope, from `GET /taskboard/scopes`. */
export interface ScopeNode {
  /** Leaf segment name, e.g. `common`. */
  readonly name: string
  /** Full Aweave scope path, e.g. `devtools/common`. */
  readonly scope: string
  /** Nesting level: `1` workspace, `2` domain, `3` repository. */
  readonly level: number
  /** Whether a `resources/workspaces/<scope>/` mirror directory exists. */
  readonly mirrored: boolean
  readonly children: readonly ScopeNode[]
}

/** One task card, hydrated from a `_tasks/*.md` file's front-matter. */
export interface Task {
  /** Aweave-root-relative markdown path; also the drag identity and the `filePath` value. */
  readonly id: string
  readonly name: string
  readonly description: string
  readonly status: string
  readonly tags: readonly string[]
  /** Fractional ordering key within a column. */
  readonly rank: number
  /** `YYYY-MM-DD` creation date; the ordering tiebreaker. */
  readonly created: string
  /** Owning scope path, e.g. `devtools/common`. */
  readonly scope: string
  /** Aweave-root-relative markdown path; identical to `id`. */
  readonly filePath: string
}

/** The server-side filter facets one tasks request carries. */
export interface BoardFilters {
  /** At most one scope constraint; the backend prefix-matches, so `devtools` spans its subtree. */
  readonly scopes: readonly string[]
  readonly tags: readonly string[]
  /** A status id, or `''` for every status. */
  readonly status: string
  /** Free text matched against name and description. */
  readonly text: string
}

/** Filter state with nothing constrained. */
export function emptyFilters(): BoardFilters {
  return { scopes: [], tags: [], status: '', text: '' }
}

/**
 * Column id for tasks whose `status` is missing or names no configured status.
 *
 * The column is always rendered and is never creatable: a task's status comes
 * from its own front-matter, so "no status" is not a value a Human can create
 * into.
 */
export const NO_STATUS_ID = '__no_status__'

// ── In-column grouping ────────────────────────────────────────────────────────

/**
 * Key cards are grouped by inside every status column.
 *
 * Every value except `none` is a prefix or the whole of `Task.scope`, so grouping
 * is derived entirely client-side from data the board already holds.
 */
export type GroupByKey = 'workspace' | 'domain' | 'repository' | 'scope' | 'none'

/** Every accepted {@link GroupByKey}, in the order the filter bar offers them. */
export const GROUP_BY_KEYS: readonly GroupByKey[] = [
  'workspace', 'domain', 'repository', 'scope', 'none',
]

/** Grouping applied when nothing is persisted. */
export const DEFAULT_GROUP_BY: GroupByKey = 'workspace'

/** A partition of one column's tasks. */
export interface TaskGroup {
  /** Raw group key, or {@link NO_GROUP_KEY}. */
  readonly key: string
  /** Display label for the key. */
  readonly label: string
  /** The group's tasks, in the order the incoming column held them. */
  readonly tasks: readonly Task[]
}

/** Synthetic key for tasks whose scope is empty or shallower than the grouping key needs. */
export const NO_GROUP_KEY = '__no_group__'

/** The persisted board view state: grouping, collapsed groups, and filters. */
export interface BoardViewState {
  readonly groupBy: GroupByKey
  readonly collapsedGroups: readonly string[]
  readonly filters: BoardFilters
}

/** View state applied when nothing is persisted, or when a payload is rejected. */
export function defaultViewState(): BoardViewState {
  return { groupBy: DEFAULT_GROUP_BY, collapsedGroups: [], filters: emptyFilters() }
}

/**
 * Namespace a group key with its `groupBy` for collapse identity.
 *
 * A bare key would collide across scope levels: a domain and a repository may
 * share a name, and collapsing one must not collapse the other.
 * @param groupBy - grouping key in force.
 * @param key - raw group key.
 * @returns the collapse-state identity of that group.
 */
export function collapsedId(groupBy: GroupByKey, key: string): string {
  return `${groupBy}:${key}`
}

/**
 * Test whether an untrusted value is an accepted grouping key.
 * @param value - candidate read from a persisted payload or a control.
 * @returns whether the value is one of {@link GROUP_BY_KEYS}.
 */
export function isGroupByKey(value: unknown): value is GroupByKey {
  return typeof value === 'string' && (GROUP_BY_KEYS as readonly string[]).includes(value)
}
