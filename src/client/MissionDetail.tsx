/**
 * The in-page mission detail: a header, the mission file tree and the viewer.
 *
 * It owns what the Human is reading (the open file, the Back history, the
 * References group) and mirrors it into the apply-level `PageMemory`, so
 * leaving the page for the Conversation and coming back restores the position.
 * It reads no Session: file data comes from the two read-only fenced routes and
 * the mission's Linked plans from the board's own `getMissionDetail`.
 * @module
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Button,
  IconCloseOutlineRegular,
  IconRefreshOutlineRegular,
  PathLabel,
  Tag,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'

import type { InjectedConfig } from '../config.ts'
import { fetchMissionOverview, fetchMissionTree, type MissionOverview, type MissionTreeDto } from './lib/mission-files.ts'
import { createMissionTransport, MissionApiError } from './lib/mission-transport.ts'
import { readPref, writePref } from './layout-prefs.ts'
import type { MissionBoardTranslate } from './locale.ts'
import { knownMissionPaths, MissionTree } from './MissionTree.tsx'
import { MarkdownViewer } from './MarkdownViewer.tsx'
import type { PageMemory } from './page-memory.ts'
import { Splitter } from './Splitter.tsx'

const DEFAULT_TREE_PX = 240
const MIN_TREE_PX = 160
const MIN_VIEWER_PX = 220

/**
 * Clamp a number into a range.
 * @param value - the number.
 * @param min - lower bound.
 * @param max - upper bound.
 * @returns the clamped number.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Describe a thrown value for a sentence.
 * @param error - the caught value.
 * @returns its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Props of {@link MissionDetail}. */
export interface MissionDetailProps {
  readonly config: InjectedConfig
  readonly t: MissionBoardTranslate
  /** Mission folder id. */
  readonly missionId: string
  readonly memory: PageMemory
  /** Close the detail; must be referentially stable. */
  readonly onClose: () => void
  /** Report whether a detail load is running; must be referentially stable. */
  readonly onBusy: (busy: boolean) => void
}

/**
 * Render the detail for one mission. The caller keys it by `missionId`, so a
 * different mission starts with fresh state.
 * @param props - see {@link MissionDetailProps}.
 * @returns the detail.
 */
export function MissionDetail(props: MissionDetailProps): ReactNode {
  const { config, t, missionId, memory, onClose, onBusy } = props
  const indexPath = `${missionId}/INDEX.md`
  const restored = memory.missionId === missionId
  const [filePath, setFilePath] = useState<string>(restored && memory.filePath !== null ? memory.filePath : indexPath)
  const [history, setHistory] = useState<readonly string[]>(restored ? memory.history : [])
  const [references, setReferences] = useState<readonly string[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [tree, setTree] = useState<MissionTreeDto | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [overview, setOverview] = useState<MissionOverview | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [viewerBusy, setViewerBusy] = useState(false)
  const [treePx, setTreePx] = useState<number>(() => readPref<number>('treePx', DEFAULT_TREE_PX, value => typeof value === 'number' && value >= MIN_TREE_PX))
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const plainTransport = useMemo(() => createMissionTransport(config), [config])
  // The copy seat is read at call time so a new `t` identity never refetches.
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    memory.missionId = missionId
    memory.filePath = filePath
    memory.history = [...history]
  }, [memory, missionId, filePath, history])

  useEffect(() => {
    const controller = new AbortController()
    setMetaLoading(true)
    setTreeError(null)
    const treeLoad = fetchMissionTree(config, missionId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setTree(next)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setTree(null)
      setTreeError(tRef.current('tree.error', { message: error instanceof MissionApiError ? error.message : messageOf(error) }))
    })
    // The overview is a convenience (name, status, Linked plans): its failure
    // leaves the tree and the viewer working, so it is swallowed here and the
    // header health already reports a failing backend.
    const overviewLoad = fetchMissionOverview(plainTransport, missionId).then((next) => {
      if (!controller.signal.aborted) setOverview(next)
    }).catch(() => {
      if (!controller.signal.aborted) setOverview(null)
    })
    void Promise.all([treeLoad, overviewLoad]).then(() => {
      if (!controller.signal.aborted) setMetaLoading(false)
    })
    return () => { controller.abort() }
  }, [config, plainTransport, missionId, reloadKey])

  const busy = metaLoading || viewerBusy
  useEffect(() => {
    onBusy(busy)
  }, [busy, onBusy])
  useEffect(() => () => { onBusy(false) }, [onBusy])

  // A ref keeps `navigate` stable while the known set follows the loaded data.
  const knownRef = useRef<Set<string>>(new Set())
  knownRef.current = useMemo(() => knownMissionPaths(tree, overview), [tree, overview])
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath

  const navigate = useCallback((target: string): void => {
    const current = filePathRef.current
    if (target === current) return
    setHistory(previous => [...previous, current])
    setFilePath(target)
    if (!knownRef.current.has(target)) {
      setReferences(previous => [target, ...previous.filter(path => path !== target)])
    }
  }, [])

  const openFromTree = useCallback((target: string): void => { navigate(target) }, [navigate])

  const historyRef = useRef(history)
  historyRef.current = history
  const back = useCallback((): void => {
    const target = historyRef.current.at(-1)
    if (target === undefined) return
    setHistory(previous => previous.slice(0, -1))
    setFilePath(target)
  }, [])

  const refresh = (): void => { setReloadKey(value => value + 1) }

  const onTreeDelta = (px: number): void => {
    const width = bodyRef.current?.clientWidth ?? 0
    setTreePx(current => clamp(current + px, MIN_TREE_PX, width - MIN_VIEWER_PX))
  }
  const persistTree = (): void => { writePref('treePx', treePx) }

  const name = overview?.name ?? baseNameOf(missionId)
  return (
    <div className="awe-mp-detailRoot" data-aweave-devkit="detail">
      <header className="awe-mp-detailHead">
        <div className="awe-mp-detailTitle">
          <span className="awe-mp-detailName" title={name}>{name}</span>
          {overview === null || overview.status === '' ? null : <Tag tone="info">{overview.status}</Tag>}
        </div>
        <Tooltip label={t('detail.refresh.tip')} delayMs={500} portal side="bottom">
          <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular size={14} />} onClick={refresh}>
            {t('detail.refresh')}
          </Button>
        </Tooltip>
        <Tooltip label={t('detail.close.tip')} delayMs={500} portal side="bottom">
          <Button variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={14} />} aria-label={t('detail.close')} onClick={onClose} />
        </Tooltip>
        <PathLabel path={missionId} className="awe-mp-detailPath" />
      </header>
      <div
        className="awe-mp-detailBody"
        ref={bodyRef}
        style={{ '--awe-tree': `${treePx}px` } as CSSProperties}
      >
        <aside className="awe-mp-treeCol">
          <MissionTree
            t={t}
            tree={tree}
            overview={overview}
            references={references}
            activePath={filePath}
            treeError={treeError}
            loading={metaLoading}
            onOpen={openFromTree}
          />
        </aside>
        <Splitter
          className="awe-mp-splitTree"
          orientation="vertical"
          value={treePx}
          min={MIN_TREE_PX}
          max={Math.max(MIN_TREE_PX, (bodyRef.current?.clientWidth ?? 0) - MIN_VIEWER_PX)}
          label={t('detail.splitter')}
          onDelta={onTreeDelta}
          onEnd={persistTree}
        />
        <section className="awe-mp-viewerCol">
          <MarkdownViewer
            config={config}
            t={t}
            path={filePath}
            reloadKey={reloadKey}
            canBack={history.length > 0}
            onNavigate={navigate}
            onBack={back}
            onBusy={setViewerBusy}
          />
        </section>
      </div>
    </div>
  )
}

/**
 * Last segment of a path.
 * @param path - a `/`-separated path.
 * @returns the segment after the last `/`.
 */
function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
