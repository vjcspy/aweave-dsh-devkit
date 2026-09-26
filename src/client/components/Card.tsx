/**
 * One task card.
 *
 * Mounted inside a column's `SortableContext`, so it is both a drag source and a
 * sortable item. Activation is deliberately split: the extension opened on
 * `Enter` only, while the platform's button convention is `Enter` and `Space`, so
 * both are handled here.
 *
 * `overlay` renders the card as the drag overlay's copy: that copy is painted by
 * `DragOverlay` outside the sortable tree, so registering a second sortable item
 * for the same id there would be a duplicate registration rather than a preview.
 * @module
 */

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'

import type { Task } from '../lib/types.ts'
import type { TaskBoardTranslate } from '../locale.ts'

/** One card's props. */
export interface CardProps {
  /** The task to render. */
  readonly task: Task
  /**
   * Applied when the card is clicked or activated from the keyboard.
   * @param task - the task that was activated.
   */
  readonly onOpen: (task: Task) => void
  /** Copy seat. */
  readonly t: TaskBoardTranslate
  /** Render as the drag overlay's copy, outside the sortable tree. */
  readonly overlay?: boolean
}

/**
 * Render one card.
 * @param props - the task, the open handler and the copy seat.
 * @returns the card body, wrapped as a sortable item unless `overlay`.
 */
export function Card({ task, onOpen, t, overlay = false }: CardProps): ReactNode {
  const body = (
    <>
      <span className='awe-tb-card-title'>{task.name}</span>
      {task.scope !== '' && <span className='awe-tb-card-scope'>{task.scope}</span>}
      {task.tags.length > 0 && (
        <span className='awe-tb-card-tags'>
          {task.tags.map(tag => <span key={tag} className='awe-tb-tag'>{tag}</span>)}
        </span>
      )}
    </>
  )

  if (overlay) {
    return <div className='awe-tb-card awe-tb-card--overlay' data-aweave-devkit='card-overlay'>{body}</div>
  }

  return <SortableCard task={task} onOpen={onOpen} t={t}>{body}</SortableCard>
}

/** Internal sortable wrapper, so an overlay copy never registers a sortable item. */
interface SortableCardProps {
  readonly task: Task
  readonly onOpen: (task: Task) => void
  readonly t: TaskBoardTranslate
  readonly children: ReactNode
}

/**
 * Register one sortable item and render it as an activatable card.
 * @param props - the task, the open handler, the copy seat and the card body.
 * @returns the sortable card.
 */
function SortableCard({ task, onOpen, t, children }: SortableCardProps): ReactNode {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const activate = (): void => { onOpen(task) }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className='awe-tb-card'
      data-aweave-devkit='card'
      {...attributes}
      {...listeners}
      role='button'
      tabIndex={0}
      aria-label={t('card.open', { name: task.name })}
      onClick={activate}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        // Space would otherwise scroll the board; Enter needs no suppression.
        if (event.key === ' ') event.preventDefault()
        activate()
      }}
    >
      {children}
    </div>
  )
}
