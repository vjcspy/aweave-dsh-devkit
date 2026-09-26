/**
 * One in-column group header: a collapse chevron, the group label and its count.
 *
 * Rendered as an interleaved sibling of the cards but deliberately kept OUT of
 * the column's `SortableContext items` — dnd-kit matches items by id, so a
 * non-item header is inert and cannot be dropped onto.
 *
 * The label arrives already resolved: the sentinel group key's name is copy, so
 * `Column` resolves it through the `t` seat and this component stays a pure
 * renderer.
 * @module
 */

import type { ReactNode } from 'react'

/** One group header's props. */
export interface GroupHeaderProps {
  /** Display label for the group. */
  readonly label: string
  /** Number of tasks in the group, collapsed or not. */
  readonly count: number
  /** Whether the group's cards are currently hidden. */
  readonly collapsed: boolean
  /** Applied when the header is activated. */
  readonly onToggle: () => void
}

/**
 * Render one group header.
 * @param props - label, count, collapse state and toggle handler.
 * @returns the header button.
 */
export function GroupHeader({ label, count, collapsed, onToggle }: GroupHeaderProps): ReactNode {
  return (
    <button
      type='button'
      className='awe-tb-group-header'
      data-aweave-devkit='group-header'
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <span className={`awe-tb-group-chevron${collapsed ? ' awe-tb-group-chevron--collapsed' : ''}`} aria-hidden='true'>
        ▾
      </span>
      <span className='awe-tb-group-label'>{label}</span>
      <span className='awe-tb-group-count'>{count}</span>
    </button>
  )
}
