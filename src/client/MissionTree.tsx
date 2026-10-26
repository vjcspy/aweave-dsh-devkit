/**
 * The mission file tree: three groups over one list of rows.
 *
 * 1. The mission folder, from `missions/tree`: `INDEX.md` pinned first, `_goals`
 *    ascending, `_progress` newest first.
 * 2. Linked plans, from the mission's detail, grouped by goal.
 * 3. References: files opened from the viewer that sit in neither group, most
 *    recent first.
 *
 * Folders and group headers are the platform's `DisclosureRow`; files are
 * buttons with a `FileTypeIcon`. The open file is highlighted and scrolled into
 * view, arrow keys move focus between rows, and Enter or a click opens one.
 * @module
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { DisclosureRow, FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'

import { isResourcesMarkdownPath } from '../mission-path.ts'
import type { MissionOverview, MissionTreeDto, TreeNodeDto } from './lib/mission-files.ts'
import type { MissionBoardTranslate } from './locale.ts'

/** Pinned and ordered folder names inside a mission folder. */
const GOALS_DIR = '_goals'
const PROGRESS_DIR = '_progress'
const INDEX_FILE = 'INDEX.md'

/**
 * Last segment of a path.
 * @param path - a `/`-separated path.
 * @returns the segment after the last `/`.
 */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * Order one folder level for display.
 * @param parentName - name of the folder holding these nodes, or `''` for the mission root.
 * @param nodes - the nodes, sorted by name ascending as the Host sends them.
 * @returns the display order: root `INDEX.md`, `_goals`, `_progress`, then the rest; `_progress` newest first.
 */
function orderLevel(parentName: string, nodes: readonly TreeNodeDto[]): TreeNodeDto[] {
  const rank = (node: TreeNodeDto): number => {
    if (parentName !== '') return 0
    if (node.name === INDEX_FILE) return 0
    if (node.name === GOALS_DIR) return 1
    if (node.name === PROGRESS_DIR) return 2
    return 3
  }
  const direction = parentName === PROGRESS_DIR ? -1 : 1
  return [...nodes].sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    return a.name < b.name ? -direction : a.name > b.name ? direction : 0
  })
}

/**
 * Every file path a mission's tree and Linked plans name.
 * @param tree - the folder tree, when loaded.
 * @param overview - the mission overview, when loaded.
 * @returns the paths.
 */
export function knownMissionPaths(tree: MissionTreeDto | null, overview: MissionOverview | null): Set<string> {
  const known = new Set<string>()
  const visit = (nodes: readonly TreeNodeDto[]): void => {
    for (const node of nodes) {
      if (node.kind === 'file') known.add(node.path)
      else visit(node.children ?? [])
    }
  }
  if (tree !== null) visit(tree.entries)
  for (const group of overview?.plans ?? []) {
    for (const plan of group.plans) known.add(plan.path)
  }
  return known
}

/** Props of {@link MissionTree}. */
export interface MissionTreeProps {
  readonly t: MissionBoardTranslate
  readonly tree: MissionTreeDto | null
  readonly overview: MissionOverview | null
  /** Files opened from the viewer, most recent first. */
  readonly references: readonly string[]
  /** Open file's project-root-relative path. */
  readonly activePath: string
  /** Why the tree could not load, as a sentence; `null` when it loaded or is loading. */
  readonly treeError: string | null
  readonly loading: boolean
  readonly onOpen: (path: string) => void
}

/**
 * Render the tree.
 * @param props - see {@link MissionTreeProps}.
 * @returns the tree.
 */
export function MissionTree(props: MissionTreeProps): ReactNode {
  const { t, tree, overview, references, activePath, treeError, loading, onOpen } = props
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const rootRef = useRef<HTMLDivElement | null>(null)

  const known = useMemo(() => knownMissionPaths(tree, overview), [tree, overview])
  const extraReferences = useMemo(() => references.filter(path => !known.has(path)), [references, known])

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const rows = root.querySelectorAll<HTMLElement>('[data-tree-row]')
    for (const row of rows) {
      if (row.dataset.path === activePath) {
        row.scrollIntoView({ block: 'nearest' })
        return
      }
    }
  }, [activePath, tree, overview, collapsed])

  const toggle = (key: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-tree-row]') ?? [])]
    if (rows.length === 0) return
    event.preventDefault()
    const at = rows.findIndex(row => row === document.activeElement)
    const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at <= 0 ? 0 : at - 1)
    rows[next]?.focus()
  }

  const fileRow = (path: string, label: string, size?: number): ReactNode => (
    <button
      key={path}
      type="button"
      className="awe-mp-row"
      role="treeitem"
      data-tree-row
      data-path={path}
      data-active={path === activePath || undefined}
      aria-selected={path === activePath}
      title={path}
      onClick={() => { onOpen(path) }}
    >
      <FileTypeIcon path={path} size={14} />
      <span className="awe-mp-rowLabel">{label}</span>
      {size === undefined ? null : <span className="awe-mp-rowMeta">{formatSize(size)}</span>}
    </button>
  )

  const folder = (key: string, title: string, children: ReactNode): ReactNode => (
    <DisclosureRow
      key={key}
      icon={<FileTypeIcon kind="folder" size={14} />}
      title={title}
      open={!collapsed.has(key)}
      expandable
      expandOnRowClick
      previewChevron={false}
      onToggle={() => { toggle(key) }}
    >
      <div className="awe-mp-nest">{children}</div>
    </DisclosureRow>
  )

  const renderNodes = (nodes: readonly TreeNodeDto[], parentName: string): ReactNode[] =>
    orderLevel(parentName, nodes).map(node => (node.kind === 'dir'
      ? folder(node.path, node.name, renderNodes(node.children ?? [], node.name))
      : fileRow(node.path, node.name, node.size)))

  const planGroups = (overview?.plans ?? []).map(group => folder(
    `plans:${group.goal}`,
    group.goal,
    group.plans.filter(plan => isResourcesMarkdownPath(plan.path)).map(plan => fileRow(plan.path, baseName(plan.path))),
  ))

  return (
    <div
      className="awe-mp-tree"
      ref={rootRef}
      role="tree"
      aria-label={t('tree.label')}
      aria-busy={loading}
      onKeyDown={onKeyDown}
    >
      {folder('group:mission', t('tree.mission'), (
        <>
          {tree === null && treeError === null ? <p className="awe-mp-dim awe-mp-treeNote">{t('tree.loading')}</p> : null}
          {treeError === null ? null : <p className="awe-mp-warn awe-mp-treeNote" role="alert">{treeError}</p>}
          {tree !== null && tree.entries.length === 0 ? <p className="awe-mp-dim awe-mp-treeNote">{t('tree.empty')}</p> : null}
          {tree === null ? null : renderNodes(tree.entries, '')}
          {tree?.truncated === true ? <p className="awe-mp-dim awe-mp-treeNote">{t('tree.truncated')}</p> : null}
        </>
      ))}
      {planGroups.length === 0 ? null : folder('group:plans', t('tree.plans'), planGroups)}
      {extraReferences.length === 0 ? null : folder(
        'group:references',
        t('tree.references'),
        extraReferences.map(path => fileRow(path, baseName(path))),
      )}
    </div>
  )
}

/**
 * Format a byte count for a row.
 * @param bytes - size in bytes.
 * @returns a short label such as `850 B` or `12.4 KiB`.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`
}
