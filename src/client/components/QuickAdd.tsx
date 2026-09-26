/**
 * Per-column quick-create.
 *
 * `scope` and `name` are both required, and the status comes from the column the
 * form was opened in — which is why the "No Status" column renders no form at
 * all: a task's status lives in its own front-matter, so "no status" is not a
 * value a Human can create into.
 *
 * The cascade is pre-filled from the active scope filter so the common case is
 * one keystroke, and it is re-seeded from the CURRENT default every time the form
 * is opened, so a filter change between two creates is picked up.
 * @module
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

import { assembleScope, emptySelection, type ScopeSelection } from '../lib/board-utils.ts'
import type { ScopeNode } from '../lib/types.ts'
import type { TaskBoardTranslate } from '../locale.ts'
import { ScopeCascade } from './ScopeCascade.tsx'

/** One quick-create form's props. */
export interface QuickAddProps {
  /** Status the created task takes; the column's own id. */
  readonly statusId: string
  /** Label of the owning column, for the toggle's accessible name. */
  readonly columnLabel: string
  /** Scope tree for the cascade. */
  readonly scopeTree: readonly ScopeNode[]
  /** Selection the cascade opens with, derived from the active scope filter. */
  readonly defaultSelection: ScopeSelection
  /**
   * Applied when a task is submitted.
   * @param statusId - the column's status.
   * @param name - the trimmed task name.
   * @param scope - the assembled scope path.
   */
  readonly onCreate: (statusId: string, name: string, scope: string) => void
  /** Copy seat. */
  readonly t: TaskBoardTranslate
}

/**
 * Render the quick-create control, collapsed to a button until it is opened.
 * @param props - column identity, scope tree, defaults, submit handler and copy seat.
 * @returns the toggle button, or the open form.
 */
export function QuickAdd({
  statusId, columnLabel, scopeTree, defaultSelection, onCreate, t,
}: QuickAddProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [selection, setSelection] = useState<ScopeSelection>(emptySelection())

  // Workspace is REQUIRED for create; domain and repository are optional.
  const canSubmit = name.trim().length > 0 && selection.workspace !== ''

  const submit = (): void => {
    if (!canSubmit) return
    onCreate(statusId, name.trim(), assembleScope(selection))
    setName('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        type='button'
        className='awe-tb-quickadd-toggle'
        data-aweave-devkit='quick-add-toggle'
        aria-label={t('quickAdd.ariaLabel', { column: columnLabel })}
        onClick={() => {
          setSelection(defaultSelection)
          setOpen(true)
        }}
      >
        {t('quickAdd.toggle')}
      </button>
    )
  }

  return (
    <div className='awe-tb-quickadd' data-aweave-devkit='quick-add'>
      <input
        className='awe-tb-input'
        autoFocus
        type='text'
        placeholder={t('quickAdd.name')}
        aria-label={t('quickAdd.name')}
        value={name}
        onChange={(event) => { setName(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
          if (event.key === 'Escape') setOpen(false)
        }}
      />
      <ScopeCascade tree={scopeTree} value={selection} t={t} onChange={setSelection} />
      {selection.workspace === '' && <p className='awe-tb-hint'>{t('quickAdd.scopeRequired')}</p>}
      <div className='awe-tb-quickadd-actions'>
        <button
          type='button'
          className='awe-tb-btn awe-tb-btn--primary'
          disabled={!canSubmit}
          onClick={submit}
        >
          {t('quickAdd.submit')}
        </button>
        <button type='button' className='awe-tb-btn' onClick={() => { setOpen(false) }}>
          {t('quickAdd.cancel')}
        </button>
      </div>
    </div>
  )
}
