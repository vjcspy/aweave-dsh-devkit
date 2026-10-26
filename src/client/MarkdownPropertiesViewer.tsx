/**
 * The `md` / `markdown` file viewer this plugin registers with `dsh-better-sidebar`.
 *
 * It wraps the built-in `markdown` viewer component: a collapsed-by-default,
 * read-only Properties panel sits above it, and the built-in editor (preview /
 * edit toggle, save, conflict banner) is rendered unchanged underneath. The only
 * write is the `orientation` checkbox, which posts a single-line text edit of the
 * exact source the viewer loaded to better-sidebar's own mtime-gated
 * `sidebar/write` route.
 *
 * Couplings to better-sidebar internals, each degrading gracefully (see the
 * README): the built-in descriptor id `markdown`, the editor's
 * `viewerId === "markdown"` switch (the child receives the BUILT-IN id, not this
 * viewer's own), the viewer props `onToolbarState` / `onReload`, and the write
 * route. A reload remounts this viewer with fresh `content` / `mtimeMs` props
 * (`refreshFile` bumps a sequence that flips the host back to `loading`), which
 * is why the expanded state is kept per path in module memory.
 * @module
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

import { PropertiesPanel, type PanelNotice } from './PropertiesPanel.tsx'
import {
  writeViaSidebar,
  type BetterSidebarLike,
  type EditorToolbarState,
  type FileViewerProps,
} from './lib/better-sidebar.ts'
import {
  blockText,
  orientationEditability,
  splitFrontMatter,
  toggleOrientation,
} from './lib/frontmatter-block.ts'
import { parseBlock, verifyCandidate } from './lib/frontmatter-yaml.ts'
import type { MissionBoardTranslate } from './locale.ts'

/** The built-in viewer's descriptor id (`dsh-better-sidebar`), whose component this viewer wraps. */
const BUILTIN_ID = 'markdown'
/** How long to wait for a requested re-read before adopting the written text locally. */
const RELOAD_WAIT_MS = 3000

/** Expanded state per `sessionId + path`, kept for the page lifetime (a reload remounts the viewer). */
const expandedMemory = new Map<string, boolean>()

/** The write baseline: the text and mtime the checkbox may write against. */
interface Baseline {
  /** The props this baseline was derived from; a change of either resets it. */
  readonly c: string | undefined
  readonly m: number | undefined
  readonly source: string | undefined
  readonly mtime: number | undefined
  /** A re-read was requested and fresh props have not arrived. */
  readonly pending: boolean
  /** The baseline served one write and may not serve another. */
  readonly consumed: boolean
  readonly notice?: PanelNotice | undefined
}

function freshBaseline(c: string | undefined, m: number | undefined): Baseline {
  return { c, m, source: c, mtime: m, pending: false, consumed: false }
}

interface ViewerBodyProps extends FileViewerProps {
  service: BetterSidebarLike
  t: MissionBoardTranslate
}

/** The toolbar facts the wrapper tracks. */
interface ToolbarFacts { mode: 'preview' | 'edit'; dirty: boolean; saveState: EditorToolbarState['saveState'] }

function ViewerBody(props: ViewerBodyProps): ReactNode {
  const { service, t, ...forwarded } = props
  const { content, mtimeMs, largeFile, scope, path, onReload } = forwarded
  const memoryKey = `${scope.sessionId}\u0000${path}`
  const [expanded, setExpandedState] = useState(() => expandedMemory.get(memoryKey) ?? false)
  const [stored, setStored] = useState<Baseline>(() => freshBaseline(content, mtimeMs))
  const [busy, setBusy] = useState(false)
  const [toolbar, setToolbar] = useState<ToolbarFacts | null>(null)
  const [stale, setStale] = useState(false)
  const baseline = stored.c === content && stored.m === mtimeMs ? stored : freshBaseline(content, mtimeMs)

  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current !== undefined) clearTimeout(timer.current)
    }
  }, [])

  // The wrapped editor's own toolbar callback, forwarded through a stable function so the
  // built-in editor's effects do not re-run on every render of this wrapper.
  const upstream = useRef(forwarded.onToolbarState)
  upstream.current = forwarded.onToolbarState
  const reload = useRef(onReload)
  reload.current = onReload
  const lastSave = useRef<EditorToolbarState['saveState'] | undefined>(undefined)
  const staleRef = useRef(false)
  const reloadedRef = useRef(false)
  const onToolbarState = useCallback((state: EditorToolbarState): void => {
    upstream.current?.(state)
    setToolbar(previous => (
      previous !== null && previous.mode === state.mode && previous.dirty === state.dirty && previous.saveState === state.saveState
        ? previous
        : { mode: state.mode, dirty: state.dirty, saveState: state.saveState }
    ))
    if (state.saveState === 'saved' && lastSave.current !== 'saved') {
      staleRef.current = true
      setStale(true)
    }
    lastSave.current = state.saveState
    if (staleRef.current && state.mode !== 'edit' && !reloadedRef.current) {
      reloadedRef.current = true
      reload.current?.()
    }
  }, [])

  const source = baseline.source
  const model = useMemo(() => {
    if (typeof source !== 'string' || largeFile !== undefined) return null
    const block = splitFrontMatter(source)
    if (block === null) return null
    const text = blockText(source, block)
    const parsed = parseBlock(text)
    if (parsed.kind === 'mapping' && Object.keys(parsed.data).length === 0) return null
    return { block, text, parsed, editability: orientationEditability(source) }
  }, [source, largeFile])

  const builtin = service.isViewerEnabled(BUILTIN_ID) ? service.getFileViewers().find(viewer => viewer.id === BUILTIN_ID) : undefined
  const child = builtin === undefined ? null : createElement(builtin.component, { ...forwarded, viewerId: BUILTIN_ID, onToolbarState })

  const setExpanded = useCallback((next: boolean): void => {
    expandedMemory.set(memoryKey, next)
    setExpandedState(next)
  }, [memoryKey])

  const patch = (next: Partial<Baseline>): void => {
    if (mounted.current) setStored({ ...baseline, ...next })
  }

  const toggle = async (checked: boolean): Promise<void> => {
    if (model === null || typeof baseline.source !== 'string' || baseline.mtime === undefined || !Number.isFinite(baseline.mtime)) return
    const from = baseline.source
    const candidate = toggleOrientation(from, checked)
    if (candidate === null || !verifyCandidate(from, candidate, checked)) {
      patch({ notice: { text: t('properties.verifyFailed') } })
      return
    }
    setBusy(true)
    let result: Awaited<ReturnType<typeof writeViaSidebar>>
    try {
      result = await writeViaSidebar(scope, path, candidate, baseline.mtime)
    } finally {
      if (mounted.current) setBusy(false)
    }
    if (!mounted.current) return
    if (!result.ok) {
      patch({
        notice: result.kind === 'conflict'
          ? { text: t('properties.conflict'), action: onReload === undefined ? undefined : { label: t('properties.reload'), onClick: onReload } }
          : { text: t('properties.writeFailed', { message: result.message }) },
      })
      return
    }
    const written = result.mtimeMs
    const adopt = (): void => {
      if (!mounted.current) return
      const finite = written !== undefined
      setStored({
        ...baseline,
        source: candidate,
        mtime: written,
        pending: false,
        consumed: !finite,
        notice: finite || onReload === undefined ? undefined : { text: t('properties.reloadPending'), action: { label: t('properties.reload'), onClick: onReload } },
      })
    }
    if (onReload === undefined) {
      adopt()
      return
    }
    patch({ pending: true, consumed: true, notice: undefined })
    onReload()
    timer.current = setTimeout(adopt, RELOAD_WAIT_MS)
  }

  if (model === null) return child ?? (typeof content === 'string' ? fallbackBody(content, t) : null)

  const checked = model.parsed.kind === 'mapping' && model.parsed.data.orientation === true
  const editability = model.editability
  const noBaseline = baseline.mtime === undefined || !Number.isFinite(baseline.mtime)
  const disabled = builtin === undefined
    || model.parsed.kind !== 'mapping'
    || !editability.editable
    || noBaseline
    || baseline.pending || baseline.consumed || stale
    || toolbar?.dirty === true
  let hint: string | undefined
  if (disabled) {
    if (builtin === undefined) hint = t('properties.noBuiltin')
    else if (model.parsed.kind !== 'mapping') hint = undefined
    else if (!editability.editable) hint = t(editability.reason === 'mixedEol' ? 'properties.mixedEol' : 'properties.unsupportedLayout')
    else if (noBaseline) hint = t('properties.noBaseline')
    else if (baseline.pending || baseline.consumed || stale) hint = t('properties.reloadPending')
    else hint = t('properties.dirtyHint')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {toolbar?.mode === 'edit'
        ? null
        : (
            <PropertiesPanel
              t={t}
              parsed={model.parsed}
              raw={model.text}
              expanded={expanded}
              onExpandedChange={setExpanded}
              orientation={{ checked, disabled, hint, busy, onToggle: next => { void toggle(next) } }}
              notice={baseline.notice}
            />
          )}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {child ?? fallbackBody((baseline.source ?? '').slice(model.block.closeEnd), t)}
      </div>
    </div>
  )
}

/**
 * Read-only markdown body used when the built-in `markdown` viewer is unavailable.
 * @param text - the markdown to render.
 * @param t - the translate seat.
 * @returns the rendered body.
 */
function fallbackBody(text: string, t: MissionBoardTranslate): ReactNode {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12 }}>
      <MarkdownText
        text={text}
        variant="body"
        labels={{ code: { copyLabel: t('viewer.code.copy'), copiedLabel: t('viewer.code.copied') }, footnotes: t('viewer.footnotes') }}
      />
    </div>
  )
}

/**
 * Build the viewer component a descriptor registers. Its identity is stable for
 * one registration, so the host never remounts the viewer on re-render.
 * @param service - the `ctx.betterSidebar` slice.
 * @param t - the locale-bound translate seat.
 * @returns the descriptor component.
 */
export function createMarkdownPropertiesViewer(service: BetterSidebarLike, t: MissionBoardTranslate): (props: FileViewerProps) => ReactNode {
  return function MarkdownPropertiesViewer(props: FileViewerProps): ReactNode {
    return createElement(ViewerBody, { ...props, service, t })
  }
}
