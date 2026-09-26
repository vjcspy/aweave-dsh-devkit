/**
 * One Kanban column: its header, its grouped cards, and its quick-create form.
 *
 * The column is a droppable target and holds the `SortableContext` for its cards.
 * Its `items` list must match the ids of the rendered sortable children in render
 * order, so a collapsed group contributes neither ids nor cards — a stale id would
 * let dnd-kit resolve a drop onto a card that is not on screen.
 *
 * The "No Status" column is rendered like any other but is never creatable: it is
 * the destination for a missing or unknown status, not a value to choose.
 * @module
 */

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Fragment } from 'react'
import type { ReactNode } from 'react'

import type { ScopeSelection } from '../lib/board-utils.ts'
import {
  collapsedId,
  NO_GROUP_KEY,
  NO_STATUS_ID,
  type GroupByKey,
  type ScopeNode,
  type Task,
  type TaskGroup,
  type TaskStatus,
} from '../lib/types.ts'
import type { TaskBoardTranslate } from '../locale.ts'
import { Card } from './Card.tsx'
import { GroupHeader } from './GroupHeader.tsx'
import { QuickAdd } from './QuickAdd.tsx'

/** One column's props. */
export interface ColumnProps {
  /** The column's status; its `id` is the drop target's id. */
  readonly status: TaskStatus
  /** The column's tasks, already partitioned for the active grouping. */
  readonly groups: readonly TaskGroup[]
  /** Active grouping. */
  readonly groupBy: GroupByKey
  /** Collapse-state identities of every collapsed group. */
  readonly collapsedGroups: readonly string[]
  /**
   * Applied when a group header is activated.
   * @param key - the raw group key.
   */
  readonly onToggleGroup: (key: string) => void
  /** Scope tree, for the quick-create cascade. */
  readonly scopeTree: readonly ScopeNode[]
  /** Cascade selection quick-create opens with. */
  readonly defaultSelection: ScopeSelection
  /**
   * Applied when a card is activated.
   * @param task - the activated task.
   */
  readonly onOpen: (task: Task) => void
  /**
   * Applied when quick-create submits; see `QuickAddProps.onCreate`.
   * @param statusId - the column's status.
   * @param name - the trimmed task name.
   * @param scope - the assembled scope path.
   */
  readonly onCreate: (statusId: string, name: string, scope: string) => void
  /** Copy seat. */
  readonly t: TaskBoardTranslate
}

/**
 * Render one column.
 * @param props - the column's status, groups, view state, handlers and copy seat.
 * @returns the column.
 */
export function Column({
  status, groups, groupBy, collapsedGroups, onToggleGroup, scopeTree, defaultSelection, onOpen, onCreate, t,
}: ColumnProps): ReactNode {
  const { setNodeRef, isOver } = useDroppable({ id: status.id })
  const creatable = status.id !== NO_STATUS_ID
  // Headers exist only under real grouping; with grouping off there is one group
  // and no header to show.
  const showHeaders = groupBy !== 'none'
  const totalCount = groups.reduce((sum, group) => sum + group.tasks.length, 0)

  const isCollapsed = (key: string): boolean =>
    showHeaders && collapsedGroups.includes(collapsedId(groupBy, key))

  const visibleIds: string[] = []
  for (const group of groups) {
    if (isCollapsed(group.key)) continue
    for (const task of group.tasks) visibleIds.push(task.id)
  }

  return (
    <div className='awe-tb-column' data-aweave-devkit={`column:${status.id}`}>
      <div className='awe-tb-column-header'>
        <span className='awe-tb-column-dot' style={{ background: status.color }} aria-hidden='true' />
        <span className='awe-tb-column-label'>{status.label}</span>
        <span className='awe-tb-column-count'>{totalCount}</span>
      </div>

      <div
        ref={setNodeRef}
        className={`awe-tb-column-body${isOver ? ' awe-tb-column-body--over' : ''}`}
        data-aweave-devkit='column-body'
      >
        <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
          {groups.map((group) => {
            const collapsed = isCollapsed(group.key)
            return (
              <Fragment key={group.key}>
                {showHeaders && (
                  <GroupHeader
                    label={group.key === NO_GROUP_KEY ? t('group.ungrouped') : group.label}
                    count={group.tasks.length}
                    collapsed={collapsed}
                    onToggle={() => { onToggleGroup(group.key) }}
                  />
                )}
                {!collapsed && group.tasks.map(task => (
                  <Card key={task.id} task={task} onOpen={onOpen} t={t} />
                ))}
              </Fragment>
            )
          })}
        </SortableContext>
        {totalCount === 0 && <p className='awe-tb-column-empty'>{t('column.empty')}</p>}
      </div>

      {creatable && (
        <QuickAdd
          statusId={status.id}
          columnLabel={status.label}
          scopeTree={scopeTree}
          defaultSelection={defaultSelection}
          onCreate={onCreate}
          t={t}
        />
      )}
    </div>
  )
}
