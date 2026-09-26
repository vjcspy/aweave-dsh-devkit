/**
 * Board maths: scope-string parsing, rank computation, the drop gate, and the
 * in-column grouping transform.
 *
 * Ported from `workspaces/devtools/vscode-ext/aweave-devkit/src/board/lib/board-utils.ts`
 * and `…/lib/scope.ts`, with THREE deliberate divergences:
 *
 * 1. **The drop gate compares the destination neighbours, not the dragged task's
 *    own rank.** The extension gates a write on `newRank !== dragged.rank`, so a
 *    midpoint that happens to equal it leaves a move on screen that never reached
 *    disk. {@link evaluateDropRank} and {@link evaluateGroupedDropRank} accept a
 *    rank only when it lies strictly between the neighbours it will sit between,
 *    and report an exhausted gap as its own distinct outcome.
 * 2. **The scope helpers live here, not in a `lib/scope.ts`.** `groupKeyOf` needs
 *    `splitScope`, so a separate module would exist only to be imported by this
 *    one; the components read the same helpers from this module.
 * 3. **No group carries a display label.** The extension baked `'(none)'` into
 *    `groupLabelOf`; here a group is identified by its raw key and the rendering
 *    layer resolves the sentinel through the locale dictionary, so no
 *    product-visible copy lives in a pure module.
 *
 * Everything here is pure and free of React and of `ctx`, so the whole file is
 * directly unit-testable.
 * @module
 */

import {
  NO_GROUP_KEY,
  NO_STATUS_ID,
  type GroupByKey,
  type ScopeNode,
  type Task,
  type TaskGroup,
  type TaskStatus,
} from './types.ts'

// ── Scope strings ─────────────────────────────────────────────────────────────

/** The three cascade levels of one scope selection; a missing level is `''`. */
export interface ScopeSelection {
  readonly workspace: string
  readonly domain: string
  readonly repo: string
}

/**
 * A cascade selection with nothing chosen.
 * @returns three empty levels.
 */
export function emptySelection(): ScopeSelection {
  return { workspace: '', domain: '', repo: '' }
}

/**
 * Assemble the three levels into an Aweave scope string.
 * @param selection - cascade levels.
 * @returns `<workspace>[/<domain>[/<repo>]]`, with missing levels dropped.
 */
export function assembleScope(selection: ScopeSelection): string {
  return [selection.workspace, selection.domain, selection.repo].filter(Boolean).join('/')
}

/**
 * Split an Aweave scope string back into its cascade levels.
 * @param scope - scope string, possibly partial.
 * @returns the three levels, with absent ones as `''`.
 */
export function splitScope(scope: string): ScopeSelection {
  const [workspace = '', domain = '', repo = ''] = (scope ?? '').split('/')
  return { workspace, domain, repo }
}

/**
 * Flatten a scope tree depth-first.
 * @param nodes - scope tree roots.
 * @returns every node, parents before their children.
 */
export function flattenScopes(nodes: readonly ScopeNode[]): ScopeNode[] {
  const out: ScopeNode[] = []
  const walk = (list: readonly ScopeNode[]): void => {
    for (const node of list) {
      out.push(node)
      if (node.children.length > 0) walk(node.children)
    }
  }
  walk(nodes)
  return out
}

// ── Columns and tags ──────────────────────────────────────────────────────────

/**
 * Bucket tasks into columns: one per configured status, plus the trailing
 * non-creatable {@link NO_STATUS_ID} column for a missing or unknown status.
 *
 * Every column is seeded empty, so each configured status renders even with no
 * tasks, and every column is rank-sorted so a caller may index into it directly.
 * @param tasks - every fetched task.
 * @param statuses - configured statuses, in the order the columns are rendered.
 * @returns columns keyed by status id, each rank-sorted.
 */
export function buildColumns(tasks: readonly Task[], statuses: readonly TaskStatus[]): Record<string, Task[]> {
  const columns: Record<string, Task[]> = {}
  for (const status of statuses) columns[status.id] = []
  columns[NO_STATUS_ID] = []
  const known = new Set(statuses.map(status => status.id))
  for (const task of tasks) {
    const key = known.has(task.status) ? task.status : NO_STATUS_ID
    columns[key]!.push(task)
  }
  for (const key of Object.keys(columns)) columns[key] = sortByRank(columns[key]!)
  return columns
}

/**
 * The distinct tag vocabulary across the loaded tasks.
 * @param tasks - every loaded task.
 * @returns tags in locale order.
 */
export function collectTags(tasks: readonly Task[]): string[] {
  const set = new Set<string>()
  for (const task of tasks) for (const tag of task.tags) set.add(tag)
  return [...set].sort((left, right) => left.localeCompare(right))
}

/**
 * Order tasks by rank, then by creation date.
 * @param tasks - tasks to order.
 * @returns a new array; the input is not mutated.
 */
export function sortByRank(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((left, right) => left.rank - right.rank || left.created.localeCompare(right.created))
}

// ── Rank computation ──────────────────────────────────────────────────────────

/** The destination neighbours a drop position falls between, after the dragged task is removed. */
export interface DropNeighbours {
  /** Task that will sit immediately before the drop, absent at the head. */
  readonly before: Task | undefined
  /** Task that will sit immediately after the drop, absent at the tail. */
  readonly after: Task | undefined
}

/**
 * Resolve the neighbours a drop at `index` lands between.
 *
 * The dragged task is filtered out FIRST, so `index` is its own post-move
 * position in the array it will occupy, never the hovered card's index.
 * @param column - destination column, sorted by rank ascending.
 * @param index - the dragged task's post-move index.
 * @param draggedId - id of the task being moved.
 * @returns the neighbour pair; both absent when the column holds only the dragged task.
 */
export function dropNeighbours(column: readonly Task[], index: number, draggedId: string): DropNeighbours {
  const ordered = column.filter(task => task.id !== draggedId)
  const clamped = Math.max(0, Math.min(index, ordered.length))
  return {
    before: clamped > 0 ? ordered[clamped - 1] : undefined,
    after: clamped < ordered.length ? ordered[clamped] : undefined,
  }
}

/**
 * Compute a fractional rank for dropping into `column` at `index`, excluding the
 * dragged task itself.
 *
 * Append (index at or after the end) yields `maxRank + 1`; head yields
 * `firstRank - 1`; between yields the midpoint of the two neighbours. The value
 * is a CANDIDATE only — {@link evaluateDropRank} decides whether it is usable.
 * @param column - destination column, sorted by rank ascending.
 * @param index - the dragged task's post-move index.
 * @param draggedId - id of the task being moved.
 * @returns the candidate rank.
 */
export function computeDropRank(column: readonly Task[], index: number, draggedId: string): number {
  const { before, after } = dropNeighbours(column, index, draggedId)
  if (before === undefined) return after === undefined ? 1 : after.rank - 1
  if (after === undefined) return before.rank + 1
  return (before.rank + after.rank) / 2
}

/**
 * Whether the fractional gap between two neighbouring ranks can no longer be split.
 *
 * Two double-precision values closer than one unit in the last place admit no
 * value strictly between them, so no midpoint drop into that slot can ever
 * persist. A zero gap (a duplicate rank, which the backend accepts) and a
 * negative gap (an out-of-order pair) are collapsed by the same test.
 * @param before - rank of the neighbour above.
 * @param after - rank of the neighbour below.
 * @returns whether the slot is exhausted.
 */
export function isExhaustedGap(before: number, after: number): boolean {
  return after - before < Number.EPSILON * Math.max(Math.abs(before), Math.abs(after))
}

/** What the drop gate decided about a candidate rank. */
export type RankAcceptance =
  | { readonly kind: 'accepted'; readonly rank: number }
  /** The destination slot admits no value strictly between its neighbours. */
  | { readonly kind: 'exhausted-gap' }
  /** A rank was computable but does not fall strictly between the neighbours. */
  | { readonly kind: 'not-between-neighbours' }

/**
 * Decide whether a drop's candidate rank may be written.
 *
 * This is the fix for the extension's gate: the candidate is compared against the
 * rank's DESTINATION NEIGHBOURS rather than against the dragged task's own rank,
 * so a candidate that merely differs from where the task started can no longer
 * pass while being unusable where it is going.
 * @param column - destination column, sorted by rank ascending.
 * @param index - the dragged task's post-move index.
 * @param draggedId - id of the task being moved.
 * @returns the acceptance, naming the failure when the candidate is refused.
 */
export function evaluateDropRank(column: readonly Task[], index: number, draggedId: string): RankAcceptance {
  const { before, after } = dropNeighbours(column, index, draggedId)
  // The column holds nothing else: `1` is the only candidate and no neighbour can
  // contradict it.
  if (before === undefined && after === undefined) return { kind: 'accepted', rank: 1 }
  if (before !== undefined && after !== undefined && isExhaustedGap(before.rank, after.rank)) {
    return { kind: 'exhausted-gap' }
  }
  const rank = computeDropRank(column, index, draggedId)
  if (before !== undefined && rank <= before.rank) return { kind: 'not-between-neighbours' }
  if (after !== undefined && rank >= after.rank) return { kind: 'not-between-neighbours' }
  return { kind: 'accepted', rank }
}

// ── In-column grouping ────────────────────────────────────────────────────────

/** Fixed single-group key used when grouping is disabled, so grouping has one code path. */
const NONE_GROUP_KEY = '__all__'

/**
 * The group a task belongs to under `groupBy`.
 *
 * `none` yields a single fixed key; `scope` yields the whole `Task.scope`;
 * `workspace`/`domain`/`repository` yield the matching segment. An empty or
 * missing segment yields {@link NO_GROUP_KEY}.
 * @param task - task to place.
 * @param groupBy - grouping key in force.
 * @returns the group key.
 */
export function groupKeyOf(task: Task, groupBy: GroupByKey): string {
  if (groupBy === 'none') return NONE_GROUP_KEY
  if (groupBy === 'scope') return task.scope === '' ? NO_GROUP_KEY : task.scope
  const selection = splitScope(task.scope)
  const segment = groupBy === 'workspace'
    ? selection.workspace
    : groupBy === 'domain'
      ? selection.domain
      : selection.repo
  return segment === '' ? NO_GROUP_KEY : segment
}

/**
 * Order group keys: alphabetical, with {@link NO_GROUP_KEY} always last.
 * @param left - first key.
 * @param right - second key.
 * @returns the sort comparator result.
 */
export function compareGroupKeys(left: string, right: string): number {
  if (left === right) return 0
  if (left === NO_GROUP_KEY) return 1
  if (right === NO_GROUP_KEY) return -1
  return left.localeCompare(right)
}

/**
 * Partition one column's tasks into groups under `groupBy`.
 *
 * A stable partition: the incoming array order is preserved inside each group,
 * because re-sorting here would fight the optimistic drag order. Groups are
 * ordered by {@link compareGroupKeys}, and empty groups are impossible by
 * construction. When grouping is off this yields one group, so the rendering
 * path is the same either way.
 * @param tasks - one column's tasks.
 * @param groupBy - grouping key in force.
 * @returns the groups, in display order; `label` is the raw key.
 */
export function groupColumn(tasks: readonly Task[], groupBy: GroupByKey): TaskGroup[] {
  const buckets = new Map<string, Task[]>()
  for (const task of tasks) {
    const key = groupKeyOf(task, groupBy)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [task])
    else bucket.push(task)
  }
  return [...buckets.keys()]
    .sort(compareGroupKeys)
    .map(key => ({ key, label: key, tasks: buckets.get(key)! }))
}

/**
 * Pre-flight predicate for a drop.
 *
 * True only when grouping is on, the source and destination columns are the same,
 * and the hovered card belongs to a DIFFERENT group than the dragged card — an
 * in-column cross-group drop, which would mean moving the file to another
 * workspace and must be a silent no-op. Evaluated BEFORE any state mutation so no
 * transient movement is ever painted.
 * @param sourceColumnId - column the dragged task is in.
 * @param destinationColumnId - column being hovered.
 * @param dragged - the dragged task.
 * @param overTask - the hovered card, when the pointer is over one.
 * @param groupBy - grouping key in force.
 * @returns whether the drop must be a no-op.
 */
export function isCrossGroupSameColumnDrop(
  sourceColumnId: string,
  destinationColumnId: string,
  dragged: Task,
  overTask: Task | undefined,
  groupBy: GroupByKey,
): boolean {
  if (groupBy === 'none') return false
  if (sourceColumnId !== destinationColumnId) return false
  if (overTask === undefined) return false
  return groupKeyOf(overTask, groupBy) !== groupKeyOf(dragged, groupBy)
}

/** The dragged task's own group within a post-move column, and its index there. */
interface GroupSlice {
  readonly tasks: Task[]
  readonly index: number
}

/**
 * Slice a post-move destination column down to the dragged task's own group.
 * @param destinationTasks - the destination column after the optimistic move.
 * @param groupBy - grouping key in force.
 * @param draggedId - id of the task being moved.
 * @returns the group's tasks with the dragged task's index there, or `undefined` when it is absent.
 */
function groupSliceOf(
  destinationTasks: readonly Task[],
  groupBy: GroupByKey,
  draggedId: string,
): GroupSlice | undefined {
  const dragged = destinationTasks.find(task => task.id === draggedId)
  if (dragged === undefined) return undefined
  const key = groupKeyOf(dragged, groupBy)
  const tasks = destinationTasks.filter(task => groupKeyOf(task, groupBy) === key)
  return { tasks, index: tasks.findIndex(task => task.id === draggedId) }
}

/**
 * Rank for a drop with grouping on.
 *
 * Takes the POST-MOVE destination column array, resolves the dragged card's
 * group, filters to that group with the dragged card included, derives the
 * dragged card's own index within that slice, and delegates to
 * {@link computeDropRank}. The hovered id is deliberately not an input.
 * @param destinationTasks - the destination column after the optimistic move.
 * @param groupBy - grouping key in force.
 * @param draggedId - id of the task being moved.
 * @returns the candidate rank.
 */
export function computeGroupedDropRank(
  destinationTasks: readonly Task[],
  groupBy: GroupByKey,
  draggedId: string,
): number {
  const slice = groupSliceOf(destinationTasks, groupBy, draggedId)
  // Defensive: the dragged card is absent from the array, so append to the column.
  if (slice === undefined) return computeDropRank(destinationTasks, destinationTasks.length, draggedId)
  return computeDropRank(slice.tasks, slice.index, draggedId)
}

/**
 * The drop gate for a grouped drop; see {@link computeGroupedDropRank} for the slice rule.
 * @param destinationTasks - the destination column after the optimistic move.
 * @param groupBy - grouping key in force.
 * @param draggedId - id of the task being moved.
 * @returns the acceptance, naming the failure when the candidate is refused.
 */
export function evaluateGroupedDropRank(
  destinationTasks: readonly Task[],
  groupBy: GroupByKey,
  draggedId: string,
): RankAcceptance {
  const slice = groupSliceOf(destinationTasks, groupBy, draggedId)
  if (slice === undefined) return evaluateDropRank(destinationTasks, destinationTasks.length, draggedId)
  return evaluateDropRank(slice.tasks, slice.index, draggedId)
}

// ── Filter facets ─────────────────────────────────────────────────────────────

/**
 * Toggle a value in or out of a filter facet.
 * @param list - the facet's current values.
 * @param value - value to toggle.
 * @returns a new list with the value added when absent, or removed when present.
 */
export function toggleFacet(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter(entry => entry !== value) : [...list, value]
}
