/**
 * The filter bar: text search, the scope cascade, a tag picker with chips, a
 * status picker, and the group-by control.
 *
 * Every facet here is SERVER-SIDE: changing one refetches the task list, because
 * the backend owns the filter semantics (scope prefix matching in particular).
 * Group-by is the exception — it is a pure view transform over already-fetched
 * tasks and never refetches.
 *
 * Pure props consumer: filters, the option lists and the two change handlers
 * arrive from the body.
 * @module
 */

import type { ReactNode } from 'react'

import { assembleScope, splitScope, toggleFacet } from '../lib/board-utils.ts'
import type { BoardFilters, GroupByKey, ScopeNode, TaskStatus } from '../lib/types.ts'
import type { TaskBoardTranslate } from '../locale.ts'
import { ScopeCascade } from './ScopeCascade.tsx'

/** The filter bar's props. */
export interface FilterBarProps {
  /** Scope tree for the cascade. */
  readonly scopeTree: readonly ScopeNode[]
  /** Tag vocabulary across the loaded tasks. */
  readonly tags: readonly string[]
  /** Configured statuses, for the status picker. */
  readonly statuses: readonly TaskStatus[]
  /** Active filters. */
  readonly filters: BoardFilters
  /** Active grouping. */
  readonly groupBy: GroupByKey
  /** Group-by options and their dictionary keys, in display order. */
  readonly groupByOptions: readonly { readonly key: GroupByKey; readonly label: string }[]
  /**
   * Applied when a filter facet changes.
   * @param next - the new filter set.
   */
  readonly onChange: (next: BoardFilters) => void
  /**
   * Applied when grouping changes.
   * @param key - the new grouping.
   */
  readonly onGroupByChange: (key: GroupByKey) => void
  /** Copy seat. */
  readonly t: TaskBoardTranslate
}

/**
 * Render the filter bar.
 * @param props - option lists, active state, handlers and copy seat.
 * @returns the bar.
 */
export function FilterBar({
  scopeTree, tags, statuses, filters, groupBy, groupByOptions, onChange, onGroupByChange, t,
}: FilterBarProps): ReactNode {
  // The filter holds at most one scope constraint. The backend prefix-matches, so
  // a workspace-only selection spans that workspace's whole subtree.
  const selection = splitScope(filters.scopes[0] ?? '')

  return (
    <div className='awe-tb-filterbar' data-aweave-devkit='filter-bar'>
      <input
        className='awe-tb-input awe-tb-search'
        type='search'
        placeholder={t('filter.search')}
        aria-label={t('filter.search')}
        value={filters.text}
        onChange={(event) => { onChange({ ...filters, text: event.target.value }) }}
      />

      <ScopeCascade
        tree={scopeTree}
        value={selection}
        t={t}
        onChange={(next) => {
          const scope = assembleScope(next)
          onChange({ ...filters, scopes: scope === '' ? [] : [scope] })
        }}
      />

      <select
        className='awe-tb-select'
        aria-label={t('filter.tag')}
        value=''
        onChange={(event) => {
          if (event.target.value === '') return
          onChange({ ...filters, tags: toggleFacet(filters.tags, event.target.value) })
        }}
      >
        <option value=''>{t('filter.tag')}</option>
        {tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
      </select>

      <select
        className='awe-tb-select'
        aria-label={t('filter.statusAll')}
        value={filters.status}
        onChange={(event) => { onChange({ ...filters, status: event.target.value }) }}
      >
        <option value=''>{t('filter.statusAll')}</option>
        {statuses.map(status => <option key={status.id} value={status.id}>{status.label}</option>)}
      </select>

      <select
        className='awe-tb-select'
        aria-label={t('filter.groupedBy')}
        value={groupBy}
        onChange={(event) => { onGroupByChange(event.target.value as GroupByKey) }}
      >
        {groupByOptions.map(option => (
          <option key={option.key} value={option.key}>{`${t('filter.groupedBy')}: ${option.label}`}</option>
        ))}
      </select>

      {filters.tags.length > 0 && (
        <div className='awe-tb-chips' data-aweave-devkit='tag-chips'>
          {filters.tags.map(tag => (
            <button
              key={tag}
              type='button'
              className='awe-tb-chip'
              aria-label={t('filter.chipRemove', { tag })}
              onClick={() => { onChange({ ...filters, tags: toggleFacet(filters.tags, tag) }) }}
            >
              {`#${tag} ×`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
