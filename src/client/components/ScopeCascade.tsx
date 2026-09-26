/**
 * The workspace → domain → repository cascade, shared by the filter bar and
 * quick-create.
 *
 * Three native selects derived from `GET /taskboard/scopes`. Native selects
 * rather than the extension's custom combobox: the cascade is a three-level
 * choice over a small, already-fetched tree, and the platform's own select
 * control gives keyboard and screen-reader behaviour for free. Choosing or
 * clearing a higher level resets the lower ones, and a lower level stays disabled
 * until its parent is chosen, so an impossible combination cannot be assembled.
 *
 * Pure props consumer: the tree, the selection and the change handler all arrive
 * from the caller.
 * @module
 */

import type { ReactNode } from 'react'

import {
  type ScopeSelection,
} from '../lib/board-utils.ts'
import type { ScopeNode } from '../lib/types.ts'
import type { TaskBoardTranslate } from '../locale.ts'

/** One cascade's props. */
export interface ScopeCascadeProps {
  /** Scope tree the levels are derived from. */
  readonly tree: readonly ScopeNode[]
  /** Current selection; a missing level is `''`. */
  readonly value: ScopeSelection
  /**
   * Applied when any level changes, already carrying the reset lower levels.
   * @param next - the new selection.
   */
  readonly onChange: (next: ScopeSelection) => void
  /** Copy seat. */
  readonly t: TaskBoardTranslate
}

/**
 * Render the three cascading selects.
 * @param props - tree, selection, change handler and copy seat.
 * @returns the cascade.
 */
export function ScopeCascade({ tree, value, onChange, t }: ScopeCascadeProps): ReactNode {
  const workspaceNode = tree.find(node => node.name === value.workspace)
  const domainNode = workspaceNode?.children.find(node => node.name === value.domain)
  const domains = workspaceNode?.children ?? []
  const repos = domainNode?.children ?? []

  return (
    <div className='awe-tb-cascade' data-aweave-devkit='cascade'>
      <select
        className='awe-tb-select'
        aria-label={t('cascade.workspace')}
        value={value.workspace}
        onChange={(event) => { onChange({ workspace: event.target.value, domain: '', repo: '' }) }}
      >
        <option value=''>{t('cascade.any')}</option>
        {tree.map(node => <option key={node.name} value={node.name}>{node.name}</option>)}
      </select>

      <select
        className='awe-tb-select'
        aria-label={t('cascade.domain')}
        value={value.domain}
        disabled={value.workspace === ''}
        onChange={(event) => { onChange({ ...value, domain: event.target.value, repo: '' }) }}
      >
        <option value=''>{t('cascade.any')}</option>
        {domains.map(node => <option key={node.name} value={node.name}>{node.name}</option>)}
      </select>

      <select
        className='awe-tb-select'
        aria-label={t('cascade.repository')}
        value={value.repo}
        disabled={value.domain === ''}
        onChange={(event) => { onChange({ ...value, repo: event.target.value }) }}
      >
        <option value=''>{t('cascade.any')}</option>
        {repos.map(node => <option key={node.name} value={node.name}>{node.name}</option>)}
      </select>
    </div>
  )
}
