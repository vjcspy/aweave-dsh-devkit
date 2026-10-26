/**
 * Collapsible, read-only front-matter panel with the `orientation` checkbox.
 *
 * Presentational: it renders what `MarkdownPropertiesViewer` hands it and
 * reports the expand toggle and the checkbox through callbacks. Every row is
 * built inside its own try/catch, and the whole panel sits in an error boundary
 * whose fallback is a one-line header, so a value the panel cannot show never
 * takes the wrapped editor down (the boundary never wraps the editor itself).
 * @module
 */
import { Component, useState, type ErrorInfo, type ReactNode } from 'react'

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'

import { formatValue, type ParsedBlock } from './lib/frontmatter-yaml.ts'
import type { MissionBoardTranslate } from './locale.ts'

/** Marker the panel's scoped stylesheet keys on. */
export const PANEL_MARKER = 'md-properties'

/** The orientation control's state. */
export interface OrientationControl {
  checked: boolean
  disabled: boolean
  hint?: string | undefined
  busy: boolean
  onToggle(next: boolean): void
}

/** An inline notice with an optional action. */
export interface PanelNotice {
  text: string
  action?: { label: string; onClick(): void } | undefined
}

export interface PropertiesPanelProps {
  t: MissionBoardTranslate
  parsed: ParsedBlock
  /** The raw block text, shown when the block does not parse to a mapping. */
  raw: string
  expanded: boolean
  onExpandedChange(expanded: boolean): void
  orientation: OrientationControl
  notice?: PanelNotice | undefined
}

/** The longest scalar list rendered as chips. */
const MAX_CHIPS = 50

/** Whether a value renders as one text line. */
function isText(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number'
}

/** Clamped text that expands on click, with the full value in its tooltip. */
function TextValue({ text }: { text: string }): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      className="awe-pp-text"
      data-open={open ? 'true' : 'false'}
      title={text}
      onClick={() => { setOpen(value => !value) }}
    >
      {text}
    </button>
  )
}

/**
 * Build one value cell.
 * @param value - the parsed value.
 * @returns the cell content.
 */
function renderValue(value: unknown): ReactNode {
  if (isText(value)) return <TextValue text={String(value)} />
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return <input type="checkbox" checked={value} disabled readOnly />
  if (Array.isArray(value) && value.length <= MAX_CHIPS && value.every(item => isText(item) || typeof item === 'boolean')) {
    return (
      <span className="awe-pp-chips">
        {value.map((item, index) => <Tag key={`${index}:${String(item)}`} tone="outline">{String(item)}</Tag>)}
      </span>
    )
  }
  return <code className="awe-pp-code">{formatValue(value)}</code>
}

/**
 * Build one row; a throw shows a placeholder for that row only.
 * @param key - the front-matter key.
 * @param value - the parsed value.
 * @returns the row.
 */
function renderRow(key: string, value: unknown): ReactNode {
  let cell: ReactNode
  try {
    cell = renderValue(value)
  } catch {
    cell = <span className="awe-pp-placeholder">…</span>
  }
  return (
    <div className="awe-pp-row" key={key}>
      <div className="awe-pp-key" title={key}>{key}</div>
      <div className="awe-pp-value">{cell}</div>
    </div>
  )
}

interface BoundaryProps { fallback: ReactNode; children: ReactNode }
interface BoundaryState { failed: boolean }

/** Contains a render failure of the panel to a one-line fallback. */
class PanelBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('aweave-dsh-devkit: properties panel failed', error, info.componentStack)
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * The Properties panel.
 * @param props - panel state and callbacks.
 * @returns the panel.
 */
export function PropertiesPanel(props: PropertiesPanelProps): ReactNode {
  const { t, parsed, raw, expanded, onExpandedChange, orientation, notice } = props
  const count = parsed.kind === 'mapping' ? Object.keys(parsed.data).length : 0
  return (
    <div className="awe-pp-panel" data-aweave-devkit={PANEL_MARKER}>
      <PanelBoundary fallback={<div className="awe-pp-header awe-pp-header--static">{t('properties.unavailable')}</div>}>
        <button
          type="button"
          className="awe-pp-header"
          aria-expanded={expanded}
          onClick={() => { onExpandedChange(!expanded) }}
        >
          <span className="awe-pp-chevron" data-open={expanded ? 'true' : 'false'} aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M4 2.5 8 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className="awe-pp-title">{t('properties.title')}</span>
          {count > 0 ? <span className="awe-pp-count">{t('properties.keys', { count })}</span> : null}
          {orientation.checked ? <span className="awe-pp-pin">{t('properties.orientation')}</span> : null}
        </button>
        {expanded ? (
          <div className="awe-pp-body">
            {parsed.kind === 'mapping'
              ? (
                  <div className="awe-pp-grid">
                    {Object.entries(parsed.data).filter(([key]) => key !== 'orientation').map(([key, value]) => renderRow(key, value))}
                  </div>
                )
              : (
                  <div>
                    <div className="awe-pp-hint">{t('properties.parseError', { message: parsed.kind === 'error' ? parsed.message : '' })}</div>
                    <pre className="awe-pp-raw">{raw}</pre>
                  </div>
                )}
            <label className="awe-pp-orientation">
              <input
                type="checkbox"
                checked={orientation.checked}
                disabled={orientation.disabled || orientation.busy}
                onChange={event => { orientation.onToggle(event.target.checked) }}
              />
              <span>{t('properties.orientation')}</span>
              {orientation.busy ? <span className="awe-pp-hint">{t('properties.busy')}</span> : null}
              {orientation.hint === undefined ? null : <span className="awe-pp-hint">{orientation.hint}</span>}
            </label>
            {notice === undefined
              ? null
              : (
                  <div className="awe-pp-notice" role="status">
                    <span>{notice.text}</span>
                    {notice.action === undefined ? null : <button type="button" className="awe-pp-link" onClick={notice.action.onClick}>{notice.action.label}</button>}
                  </div>
                )}
          </div>
        ) : null}
      </PanelBoundary>
    </div>
  )
}
