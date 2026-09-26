/**
 * The Task Board body: the Kanban board, its data flow, and its failure surfaces.
 *
 * This replaces the placeholder that only proved the fenced-route integration. It
 * is the composition root: it owns the request state, the optimistic drag
 * mutations and the view state, and every child below it is a pure props consumer.
 *
 * Four rules shape this module.
 *
 * 1. **Only the newest response commits.** The extension wrote
 *    `updateTask(...).then(loadTasks)` with no ordering guard, so a slow earlier
 *    response could land after a newer one and resurrect a task the Human had
 *    already moved. Every column-committing load here takes a ticket from
 *    `loadSeq` and refuses to commit unless it still holds the newest.
 * 2. **A failed first load is a blocking state, never an empty board.** Columns
 *    are seeded only from a response that arrived; until one does, the body shows
 *    why it has nothing rather than five empty columns a Human would read as "no
 *    tasks".
 * 3. **Grouping is a pure view transform.** Changing it, or collapsing a group,
 *    re-renders and re-persists but never refetches — only the filter facets are
 *    server-side.
 * 4. **Every string is copy.** Notices are held as dictionary KEYS plus at most a
 *    raw detail (backend text, a path), so no English lives in this module.
 * @module
 */

import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: declares the `useSessions` global seat and the `sessionId` session seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import type { InjectedConfig } from '../config.ts'
import { Card } from './components/Card.tsx'
import { Column } from './components/Column.tsx'
import { FilterBar } from './components/FilterBar.tsx'
import { TaskBoardApiError, type TaskBoardApi } from './lib/api.ts'
import {
  buildColumns,
  collectTags,
  evaluateDropRank,
  evaluateGroupedDropRank,
  groupColumn,
  groupKeyOf,
  isCrossGroupSameColumnDrop,
  splitScope,
} from './lib/board-utils.ts'
import {
  collapsedId,
  GROUP_BY_KEYS,
  NO_STATUS_ID,
  type BoardFilters,
  type BoardViewState,
  type GroupByKey,
  type ScopeNode,
  type Task,
  type TaskGroup,
  type TaskStatus,
} from './lib/types.ts'
import type { AweaveTaskboardKey } from './locale.ts'
import type {} from './locale.ts'
import { planOpenTask } from './open-task.ts'
import { readBoardViewState, writeBoardViewState } from './store.ts'

/** What the apply closure offers this body. */
export interface TaskBoardInjected {
  /** Configuration the Host published at index render, or `undefined` when the global was absent or malformed. */
  readonly config: InjectedConfig | undefined
  /** The bound data surface, absent exactly when `config` is. */
  readonly api: TaskBoardApi | undefined
}

/** The body's composed props: the tab it draws, its injected face, the session seats, and its copy. */
export type TaskBoardBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & TaskBoardInjected
  & PropsLocale<'aweaveTaskboard'>

/** Columns keyed by status id; each value is rank-ordered. */
type Columns = Record<string, Task[]>

/** Where the board is in its load lifecycle. */
type BoardPhase = 'loading' | 'ready' | 'failed'

/**
 * A message the body shows the Human.
 *
 * Held as a dictionary key plus at most a raw detail, so rendering stays in the
 * locale while a backend message or a path can still be shown verbatim.
 */
interface Notice {
  readonly key: AweaveTaskboardKey
  readonly params?: Record<string, string> | undefined
  readonly detail?: string | undefined
}

/**
 * Colour of the non-creatable "No Status" column's dot.
 *
 * A theme token, not a literal: the column is the platform's caption-level
 * surface, so it reads as subordinate in both themes. Configured columns use the
 * colour the backend supplies, which is data rather than styling.
 */
const NO_STATUS_COLOR = 'var(--dsw-alias-label-caption)'

/** Group-by options: the key a control reports, and the dictionary key naming it. */
const GROUP_BY_OPTIONS: readonly { readonly key: GroupByKey; readonly labelKey: AweaveTaskboardKey }[] = [
  { key: 'workspace', labelKey: 'group.workspace' },
  { key: 'domain', labelKey: 'group.domain' },
  { key: 'repository', labelKey: 'group.repository' },
  { key: 'scope', labelKey: 'group.scope' },
  { key: 'none', labelKey: 'group.none' },
]

/** The drag overlay's copy is inert; this is its open handler. */
const ignore = (): void => {}

/**
 * Translate a caught failure into a notice.
 *
 * The failure's SHAPE decides the copy; its `code` is only ever displayed. A
 * backend may rename or add codes at any time, and branching on one would break
 * the board on a change that is not the board's to make.
 * @param error - the caught value.
 * @returns the notice to show.
 */
function noticeOfFailure(error: unknown): Notice {
  if (error instanceof TaskBoardApiError) {
    if (error.kind === 'unreachable') return { key: 'error.unreachable', detail: error.message }
    if (error.kind === 'malformed') return { key: 'error.malformed', detail: error.message }
    const detail = error.code === undefined ? error.message : `${error.code}: ${error.message}`
    return { key: 'error.backend', detail }
  }
  return { key: 'error.failed', detail: error instanceof Error ? error.message : String(error) }
}

/**
 * Render the Task Board.
 * @param props - the composed slot props: the tab, the injected face, the session seats and the copy seat.
 * @returns the board, or the state explaining why it has none.
 */
export function TaskBoardBody({
  config, api, useTabInfo, sessionId, useSessions, t,
}: TaskBoardBodyProps): ReactNode {
  const { tab } = useTabInfo()
  // The Session's workspace root authorizes a file address, so a Session reporting
  // none cannot open an Aweave-root-relative task; `planOpenTask` reports that.
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)

  const [phase, setPhase] = useState<BoardPhase>('loading')
  const [failure, setFailure] = useState<unknown>(undefined)
  const [statuses, setStatuses] = useState<readonly TaskStatus[]>([])
  const [scopeTree, setScopeTree] = useState<readonly ScopeNode[]>([])
  const [columns, setColumns] = useState<Columns>({})
  const [view, setView] = useState<BoardViewState>(() => readBoardViewState())
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  const [activeTask, setActiveTask] = useState<Task | undefined>(undefined)

  /**
   * Ticket dispenser for column-committing loads; see the module comment.
   *
   * A ref rather than state: a ticket is never rendered, and making it state would
   * re-render on every request.
   */
  const loadSeq = useRef(0)
  /** Whether a tasks response has ever committed, which decides whether a failure blocks the board. */
  const loadedOnce = useRef(false)

  // Persist the view state on every change. Grouping and collapse land here too,
  // and none of them touches the server.
  useEffect(() => { writeBoardViewState(view) }, [view])

  const fetchTasks = useCallback(async (
    filters: BoardFilters,
    currentStatuses: readonly TaskStatus[],
  ): Promise<void> => {
    if (api === undefined) return
    const ticket = ++loadSeq.current
    try {
      const tasks = await api.listTasks(filters)
      // Another load started while this one was in flight, so this snapshot is
      // stale and committing it would overwrite newer truth.
      if (ticket !== loadSeq.current) return
      loadedOnce.current = true
      setColumns(buildColumns(tasks, currentStatuses))
    } catch (error: unknown) {
      if (ticket !== loadSeq.current) return
      // Nothing has ever loaded, so there is no board to keep: blocking here is what
      // stops an empty column set from reading as "no tasks".
      if (!loadedOnce.current) {
        setFailure(error)
        setPhase('failed')
        return
      }
      setNotice(noticeOfFailure(error))
    }
  }, [api])

  const loadBoard = useCallback(async (): Promise<void> => {
    if (api === undefined) return
    const ticket = ++loadSeq.current
    setPhase('loading')
    try {
      const [nextStatuses, nextScopes] = await Promise.all([api.loadStatuses(), api.loadScopes()])
      if (ticket !== loadSeq.current) return
      loadedOnce.current = false
      setStatuses(nextStatuses)
      setScopeTree(nextScopes)
      setPhase('ready')
    } catch (error: unknown) {
      if (ticket !== loadSeq.current) return
      loadedOnce.current = false
      setFailure(error)
      setPhase('failed')
    }
  }, [api])

  // One initial load, plus one reload whenever the refresh command or Retry runs.
  useEffect(() => { void loadBoard() }, [loadBoard])

  // Every filter change refetches: the backend owns the filter semantics. Grouping
  // and collapse deliberately do not, because they change no server-side input.
  useEffect(() => {
    if (phase !== 'ready') return
    void fetchTasks(view.filters, statuses)
  }, [phase, statuses, view.filters, fetchTasks])

  // The refresh affordance is the tab's own command seat: the owner renders the
  // control, and this page supplies what refreshing means.
  useEffect(
    () => tab.actions.bindCommands({ refresh: () => { void loadBoard() } }),
    [tab.actions, loadBoard],
  )

  const displayStatuses = useMemo<readonly TaskStatus[]>(
    () => [...statuses, { id: NO_STATUS_ID, label: t('column.noStatus'), color: NO_STATUS_COLOR }],
    [statuses, t],
  )

  // A pure view transform over the fetched columns; never a refetch.
  const groupedColumns = useMemo<Record<string, TaskGroup[]>>(
    () => Object.fromEntries(
      Object.entries(columns).map(([id, list]) => [id, groupColumn(list, view.groupBy)]),
    ),
    [columns, view.groupBy],
  )

  const allTags = useMemo(() => collectTags(Object.values(columns).flat()), [columns])

  // Pre-fill quick-create from the active scope filter, so the common case is one
  // keystroke. A workspace-only selection is a valid create target.
  const defaultSelection = useMemo(() => splitScope(view.filters.scopes[0] ?? ''), [view.filters.scopes])

  const groupByOptions = useMemo(
    () => GROUP_BY_OPTIONS.map(option => ({ key: option.key, label: t(option.labelKey) })),
    [t],
  )

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  /**
   * Toggle one group's collapse state.
   *
   * Namespaced by the grouping, so collapsing `k` under one level cannot collapse
   * a same-named group under another.
   * @param key - the raw group key.
   */
  const toggleGroup = useCallback((key: string): void => {
    setView((current) => {
      const id = collapsedId(current.groupBy, key)
      const collapsedGroups = current.collapsedGroups.includes(id)
        ? current.collapsedGroups.filter(entry => entry !== id)
        : [...current.collapsedGroups, id]
      return { ...current, collapsedGroups }
    })
  }, [])

  /**
   * Expand one group if it is collapsed, and do nothing otherwise.
   *
   * Idempotent by design: the drag-over handler calls this on every pointer move,
   * so a toggle would oscillate the group open and shut. Returning the same state
   * object also lets React skip the re-render.
   * @param key - the raw group key.
   */
  const expandGroup = useCallback((key: string): void => {
    setView((current) => {
      const id = collapsedId(current.groupBy, key)
      if (!current.collapsedGroups.includes(id)) return current
      return { ...current, collapsedGroups: current.collapsedGroups.filter(entry => entry !== id) }
    })
  }, [])

  /**
   * Resolve the column that holds an id, which is either a column or a task.
   * @param id - column id or task id.
   * @returns the owning column id, or `undefined`.
   */
  const findContainer = useCallback((id: string): string | undefined => {
    if (id in columns) return id
    return Object.keys(columns).find(key => (columns[key] ?? []).some(task => task.id === id))
  }, [columns])

  const onDragStart = (event: DragStartEvent): void => {
    const id = String(event.active.id)
    const container = findContainer(id)
    setActiveTask(container === undefined ? undefined : (columns[container] ?? []).find(task => task.id === id))
  }

  const onDragOver = (event: DragOverEvent): void => {
    const activeId = String(event.active.id)
    const overId = event.over === null ? '' : String(event.over.id)
    if (overId === '') return

    const from = findContainer(activeId)
    const to = findContainer(overId)
    if (from === undefined || to === undefined || from === to) return

    const groupBy = view.groupBy

    // Keep the destination group visible if it is collapsed. Done outside the state
    // updater so a side effect never runs inside `setColumns`.
    if (groupBy !== 'none') {
      const moving = (columns[from] ?? []).find(task => task.id === activeId)
      if (moving !== undefined) expandGroup(groupKeyOf(moving, groupBy))
    }

    setColumns((previous) => {
      const fromItems = previous[from] ?? []
      const toItems = previous[to] ?? []
      const moving = fromItems.find(task => task.id === activeId)
      if (moving === undefined) return previous

      let insertAt: number
      if (groupBy === 'none') {
        const overIndex = toItems.findIndex(task => task.id === overId)
        insertAt = overIndex >= 0 ? overIndex : toItems.length
      } else {
        // A stable partition cannot repair an insertion made relative to a foreign
        // group, so compute the SAME target position the drop will persist: hovering
        // a same-group card inserts at its flat index, and anything else (a foreign
        // group, or the column body) inserts at this group's tail.
        const draggedKey = groupKeyOf(moving, groupBy)
        const overTask = toItems.find(task => task.id === overId)
        if (overTask !== undefined && groupKeyOf(overTask, groupBy) === draggedKey) {
          insertAt = toItems.findIndex(task => task.id === overId)
        } else {
          let lastIndexOfGroup = -1
          for (let index = 0; index < toItems.length; index++) {
            if (groupKeyOf(toItems[index]!, groupBy) === draggedKey) lastIndexOfGroup = index
          }
          insertAt = lastIndexOfGroup >= 0 ? lastIndexOfGroup + 1 : toItems.length
        }
      }

      return {
        ...previous,
        [from]: fromItems.filter(task => task.id !== activeId),
        [to]: [...toItems.slice(0, insertAt), moving, ...toItems.slice(insertAt)],
      }
    })
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const activeId = String(event.active.id)
    const overId = event.over === null ? '' : String(event.over.id)
    const dragged = activeTask
    setActiveTask(undefined)
    if (overId === '' || dragged === undefined || api === undefined) return

    const container = findContainer(activeId)
    if (container === undefined) return

    const groupBy = view.groupBy
    const destinationItems = columns[container] ?? []
    let finalColumns = columns

    if (groupBy === 'none') {
      // Flat mode: reorder for a stable final index, exactly as before grouping existed.
      const oldIndex = destinationItems.findIndex(task => task.id === activeId)
      const overIndex = destinationItems.findIndex(task => task.id === overId)
      if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex) {
        finalColumns = { ...columns, [container]: arrayMove(destinationItems, oldIndex, overIndex) }
        setColumns(finalColumns)
      }
    } else {
      const overTask = destinationItems.find(task => task.id === overId)

      // PREFLIGHT, before any state mutation: an in-column cross-group drop would
      // mean moving the file to another workspace, which is unsupported. Returning
      // here — above the reorder — is what keeps the UI from ever showing a move
      // that never reached disk.
      const sourceColumnId = statuses.some(status => status.id === dragged.status) ? dragged.status : NO_STATUS_ID
      if (isCrossGroupSameColumnDrop(sourceColumnId, container, dragged, overTask, groupBy)) return

      // Gate the reorder on a SAME-GROUP hovered card: `onDragOver` already placed
      // the card correctly, and a second `arrayMove` against a foreign-group id would
      // resolve to a flat index that undoes that placement.
      const sameGroupOver = overTask !== undefined && groupKeyOf(overTask, groupBy) === groupKeyOf(dragged, groupBy)
      if (sameGroupOver) {
        const oldIndex = destinationItems.findIndex(task => task.id === activeId)
        const overIndex = destinationItems.findIndex(task => task.id === overId)
        if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex) {
          finalColumns = { ...columns, [container]: arrayMove(destinationItems, oldIndex, overIndex) }
          setColumns(finalColumns)
        }
      }
    }

    const destination = finalColumns[container] ?? []
    const finalIndex = destination.findIndex(task => task.id === activeId)
    if (finalIndex < 0) return

    // Rank is computed within the dragged card's own group, from its own post-move
    // index — never from the hovered id.
    const acceptance = groupBy === 'none'
      ? evaluateDropRank(destination, finalIndex, activeId)
      : evaluateGroupedDropRank(destination, groupBy, activeId)

    const statusChanged = container !== dragged.status

    if (acceptance.kind !== 'accepted') {
      // Two DISTINCT conditions, each with its own message, and both re-read the
      // board so the screen shows server truth rather than the optimistic move.
      setNotice({ key: acceptance.kind === 'exhausted-gap' ? 'error.rankExhausted' : 'error.rankCollision' })
      void fetchTasks(view.filters, statuses)
      return
    }

    // The rank gate REPLACES the extension's `newRank !== dragged.rank` test: a rank
    // equal to where the task already sits is genuinely no change, and every other
    // accepted rank is strictly between its destination neighbours.
    const rankChanged = acceptance.rank !== dragged.rank
    if (!statusChanged && !rankChanged) return

    // The "No Status" column is a destination for an unknown status, never a write
    // target: persisting a move into it would need a status the backend does not define.
    if (container === NO_STATUS_ID) {
      setNotice({ key: 'error.noStatusColumn', params: { column: t('column.noStatus') } })
      void fetchTasks(view.filters, statuses)
      return
    }

    void api.updateTask({
      id: activeId,
      rank: acceptance.rank,
      ...(statusChanged ? { status: container } : {}),
    })
      .then(() => fetchTasks(view.filters, statuses))
      .catch((error: unknown) => {
        setNotice(noticeOfFailure(error))
        // Roll back to server truth: the optimistic position is not what is on disk.
        void fetchTasks(view.filters, statuses)
      })
  }

  /**
   * Create a task in a column.
   * @param statusId - the column's status; never the non-creatable column.
   * @param name - the trimmed task name.
   * @param scope - the assembled scope path.
   */
  const handleCreate = (statusId: string, name: string, scope: string): void => {
    if (api === undefined) return
    if (scope === '') {
      setNotice({ key: 'error.scopeRequired' })
      return
    }
    void api.createTask({ scope, name, status: statusId })
      .then(() => fetchTasks(view.filters, statuses))
      .catch((error: unknown) => { setNotice(noticeOfFailure(error)) })
  }

  /**
   * Open a task's markdown, or explain why it cannot be opened.
   * @param task - the activated task.
   */
  const handleOpen = (task: Task): void => {
    const plan = planOpenTask({
      aweaveRoot: config?.aweaveRoot ?? undefined,
      sessionId,
      cwd,
      filePath: task.filePath,
    })
    if (plan.kind === 'open') {
      tab.actions.openResource(plan.address)
      return
    }
    if (plan.kind === 'no-aweave-root') {
      setNotice({ key: 'error.open.noRoot', detail: task.filePath })
      return
    }
    if (plan.kind === 'no-session-root') {
      setNotice({ key: 'error.open.noSessionRoot', params: { path: plan.path } })
      return
    }
    setNotice({ key: 'error.open.outsideSessionRoot', params: { path: plan.path, cwd: plan.cwd } })
  }

  if (config === undefined || api === undefined) {
    return (
      <div className='awe-tb-root' data-aweave-devkit='taskboard'>
        <section className='awe-tb-state' data-aweave-devkit='state:unconfigured'>
          <h3 className='awe-tb-state-title'>{t('state.unconfigured.title')}</h3>
          <p className='awe-tb-state-detail'>{t('state.unconfigured.detail')}</p>
        </section>
      </div>
    )
  }

  if (phase === 'failed') {
    const unreachable = failure instanceof TaskBoardApiError && failure.kind === 'unreachable'
    return (
      <div className='awe-tb-root' data-aweave-devkit='taskboard'>
        <section
          className='awe-tb-state awe-tb-state--error'
          data-aweave-devkit={unreachable ? 'state:unreachable' : 'state:failed'}
          role='alert'
        >
          <h3 className='awe-tb-state-title'>
            {t(unreachable ? 'state.unreachable.title' : 'state.failed.title')}
          </h3>
          <p className='awe-tb-state-detail'>
            {t(unreachable ? 'state.unreachable.detail' : 'state.failed.detail')}
          </p>
          {failure instanceof Error && <p className='awe-tb-state-detail'>{failure.message}</p>}
          <button type='button' className='awe-tb-btn' onClick={() => { void loadBoard() }}>
            {t('action.retry')}
          </button>
        </section>
      </div>
    )
  }

  if (phase === 'loading') {
    return (
      <div className='awe-tb-root' data-aweave-devkit='taskboard'>
        <p className='awe-tb-state' data-aweave-devkit='state:loading'>{t('state.loading')}</p>
      </div>
    )
  }

  return (
    <div className='awe-tb-root' data-aweave-devkit='taskboard'>
      <FilterBar
        scopeTree={scopeTree}
        tags={allTags}
        statuses={statuses}
        filters={view.filters}
        groupBy={view.groupBy}
        groupByOptions={groupByOptions}
        t={t}
        onChange={(next) => { setView(current => ({ ...current, filters: next })) }}
        onGroupByChange={(key) => {
          if (!GROUP_BY_KEYS.includes(key)) return
          setView(current => ({ ...current, groupBy: key }))
        }}
      />

      {notice !== undefined && (
        <div className='awe-tb-notice' data-aweave-devkit='notice' role='alert'>
          <span className='awe-tb-notice-text'>
            {notice.detail === undefined
              ? t(notice.key, notice.params)
              : `${t(notice.key, notice.params)} ${notice.detail}`}
          </span>
          <button
            type='button'
            className='awe-tb-notice-dismiss'
            aria-label={t('action.dismiss')}
            onClick={() => { setNotice(undefined) }}
          >
            ×
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className='awe-tb-board' data-aweave-devkit='board'>
          {displayStatuses.map(status => (
            <Column
              key={status.id}
              status={status}
              groups={groupedColumns[status.id] ?? []}
              groupBy={view.groupBy}
              collapsedGroups={view.collapsedGroups}
              onToggleGroup={toggleGroup}
              scopeTree={scopeTree}
              defaultSelection={defaultSelection}
              onOpen={handleOpen}
              onCreate={handleCreate}
              t={t}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask === undefined ? null : <Card task={activeTask} onOpen={ignore} t={t} overlay />}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
