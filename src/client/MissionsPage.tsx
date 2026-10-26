/**
 * The Missions main-area page: a header with live counts and backend health,
 * the embedded board, and an in-page mission detail (file tree + viewer) that
 * opens when a card is selected.
 *
 * A `main` page has no Session binding, so this module never reads a Session
 * seat and never touches `ctx.sidebarRight`: a card selection opens the page's
 * own detail instead of a Session file tab. The header statistics ride on the
 * board's own 5 s polling (`tapTransport`), so they add no request.
 *
 * Mounting the page mounts its own `embed.js` board, and the page unmounts when
 * the Human returns to the Conversation; the reading position survives through
 * the apply-level `PageMemory`.
 * @module
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Button, StateDot, Tag, Tooltip, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

import type { InjectedConfig } from '../config.ts'
import { isMissionIndexPath } from './lib/mission-index-path.ts'
import { createMissionTransport, MissionApiError, tapTransport } from './lib/mission-transport.ts'
import { readPref, writePref } from './layout-prefs.ts'
import { MissionDetail } from './MissionDetail.tsx'
import { NavIcon } from './NavIcon.tsx'
import type { PageMemory } from './page-memory.ts'
import { ProcessingBar } from './ProcessingBar.tsx'
import { Splitter } from './Splitter.tsx'
import { useEmbedBoard } from './useEmbedBoard.ts'

/** What the `main` entry's inject face supplies. */
export interface MissionsPageInjected {
  /** Configuration the Host published, or `undefined` when the global was absent or malformed. */
  readonly config: InjectedConfig | undefined
  /** The apply-level reading position. */
  readonly memory: PageMemory
}

/** Props the renderer hands the page. */
export type MissionsPageProps = PropsLocale<'aweaveMissionBoard'> & MissionsPageInjected

const DEFAULT_DETAIL_PX = 560
const MIN_DETAIL_PX = 360
const MIN_BOARD_PX = 320

/** One status the board knows, as `getConfig` reports it. */
interface StatusInfo {
  readonly id: string
  readonly label: string
  readonly color: string
}

/** What the header shows about the backend. */
type Health =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok' }
  | { readonly kind: 'unreachable' | 'backend' | 'malformed'; readonly message: string }

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
 * A `HH:mm:ss` clock label.
 * @param at - epoch milliseconds.
 * @returns the formatted time.
 */
function clockOf(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Read the statuses out of a `getConfig` result.
 * @param config - untrusted `getConfig` data.
 * @returns the well-formed status rows.
 */
function statusesOf(config: unknown): StatusInfo[] {
  const rows = (config as { statuses?: unknown } | null)?.statuses
  if (!Array.isArray(rows)) return []
  const statuses: StatusInfo[] = []
  for (const row of rows as unknown[]) {
    const status = row as { id?: unknown; label?: unknown; color?: unknown } | null
    if (typeof status?.id !== 'string') continue
    statuses.push({
      id: status.id,
      label: typeof status.label === 'string' ? status.label : status.id,
      color: typeof status.color === 'string' ? status.color : '',
    })
  }
  return statuses
}

/**
 * Describe a transport failure for the health indicator.
 * @param failure - the thrown value.
 * @returns the health state to show.
 */
function healthOf(failure: unknown): Health {
  if (failure instanceof MissionApiError) return { kind: failure.kind, message: failure.message }
  return { kind: 'unreachable', message: failure instanceof Error ? failure.message : String(failure) }
}

/**
 * The page.
 * @param props - the locale seat, the Host configuration and the reading memory.
 * @returns the page.
 */
export function MissionsPage(props: MissionsPageProps): ReactNode {
  const { config, memory, t } = props
  const containerRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [openMissionId, setOpenMissionId] = useState<string | null>(memory.missionId)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [statuses, setStatuses] = useState<readonly StatusInfo[]>([])
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({})
  const [total, setTotal] = useState(0)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [health, setHealth] = useState<Health>({ kind: 'loading' })
  const [firstLoaded, setFirstLoaded] = useState(false)
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailPx, setDetailPx] = useState<number>(() => readPref<number>('detailPx', DEFAULT_DETAIL_PX, value => typeof value === 'number' && value >= MIN_DETAIL_PX))

  // Memoized on `config` so a header update never changes the transport the
  // board mounted with; the observer only calls stable state setters.
  const transport = useMemo(() => {
    if (config === undefined) return undefined
    return tapTransport(createMissionTransport(config), {
      onConfig: (data) => { setStatuses(statusesOf(data)) },
      onList: (missions) => {
        const next: Record<string, number> = {}
        for (const mission of missions) {
          const status = (mission as { status?: unknown } | null)?.status
          if (typeof status === 'string') next[status] = (next[status] ?? 0) + 1
        }
        setCounts(next)
        setTotal(missions.length)
        setUpdatedAt(Date.now())
        setHealth({ kind: 'ok' })
        setFirstLoaded(true)
      },
      onError: (failure) => {
        setHealth(healthOf(failure))
        setFirstLoaded(true)
      },
    })
  }, [config])

  const openMission = (id: string): void => {
    if (memory.missionId !== id) {
      memory.missionId = id
      memory.filePath = null
      memory.history = []
    }
    setOpenMissionId(id)
  }

  const { phase, retry } = useEmbedBoard(containerRef, config, {
    transport,
    onOpenIndex: (indexPath) => {
      if (!isMissionIndexPath(indexPath)) {
        setNotice(t('error.open.invalidPath', { path: indexPath }))
        return
      }
      setNotice(undefined)
      openMission(indexPath.slice(0, -'/INDEX.md'.length))
    },
  })

  const closeDetail = useCallback((): void => {
    memory.missionId = null
    memory.filePath = null
    memory.history = []
    setOpenMissionId(null)
  }, [memory])

  const onDetailDelta = (px: number): void => {
    const width = bodyRef.current?.clientWidth ?? 0
    setDetailPx(current => clamp(current - px, MIN_DETAIL_PX, width - MIN_BOARD_PX))
  }
  const persistDetail = (): void => { writePref('detailPx', detailPx) }

  const loading = config !== undefined && (!firstLoaded || detailBusy)
  const shownStatuses: readonly StatusInfo[] = statuses.length > 0
    ? statuses
    : Object.keys(counts).map(id => ({ id, label: id, color: '' }))
  const healthState: StateDotState = health.kind === 'loading' ? 'ongoing' : health.kind === 'ok' ? 'done' : 'error'
  const healthText = health.kind === 'loading'
    ? t('page.health.loading')
    : health.kind === 'ok'
      ? t('page.health.ok')
      : t(`page.health.${health.kind}`, { message: health.message })

  return (
    <div
      className="awe-mp-root"
      data-aweave-devkit="missions-page"
      data-detail-open={openMissionId !== null || undefined}
    >
      <header className="awe-mp-head">
        <div className="awe-mp-headMain" data-window-drag>
          <span className="awe-mp-titleIcon"><NavIcon size={16} /></span>
          <h1 className="awe-mp-title">{t('page.title')}</h1>
          <span className="awe-mp-stats" role="group" aria-label={t('page.statuses')}>
            {shownStatuses.map(status => (
              <Tag key={status.id} tone="neutral">
                {status.color === '' ? null : <span className="awe-mp-dot" style={{ background: status.color }} />}
                {`${status.label} ${counts[status.id] ?? 0}`}
              </Tag>
            ))}
            {firstLoaded ? <Tag tone="quiet">{t('page.total', { count: total })}</Tag> : null}
          </span>
          <span className="awe-mp-grow" />
          {updatedAt === null ? null : (
            <span className="awe-mp-dim awe-mp-mono">{t('page.updated', { time: clockOf(updatedAt) })}</span>
          )}
          <Tooltip label={healthText} delayMs={300} portal side="bottom" align="end">
            <span className="awe-mp-health" role="img" aria-label={healthText} tabIndex={0}>
              <StateDot state={healthState} />
            </span>
          </Tooltip>
        </div>
        <ProcessingBar active={loading} t={t} />
      </header>

      {notice === undefined ? null : (
        <div className="awe-mp-notice" role="alert">
          <span className="awe-mp-noticeText">{notice}</span>
          <button type="button" className="awe-mp-noticeClose" aria-label={t('action.dismiss')} onClick={() => { setNotice(undefined) }}>
            ×
          </button>
        </div>
      )}

      <div
        className="awe-mp-body"
        ref={bodyRef}
        style={{ '--awe-detail': `${detailPx}px` } as CSSProperties}
      >
        <section className="awe-mp-board">
          {config === undefined ? (
            <div className="awe-mp-state awe-mp-state--error" data-aweave-devkit="state:unconfigured" role="alert">
              <h3 className="awe-mp-stateTitle">{t('state.unconfigured.title')}</h3>
              <p className="awe-mp-stateDetail">{t('state.unconfigured.detail')}</p>
            </div>
          ) : null}
          {phase === 'loading' && config !== undefined ? (
            <p className="awe-mp-state" data-aweave-devkit="state:loading">{t('state.loading')}</p>
          ) : null}
          {phase === 'failed' ? (
            <div className="awe-mp-state awe-mp-state--error" data-aweave-devkit="state:failed" role="alert">
              <h3 className="awe-mp-stateTitle">{t('state.failed.title')}</h3>
              <p className="awe-mp-stateDetail">{t('state.failed.detail')}</p>
              <Button variant="outline" size="sm" onClick={retry}>{t('page.retry')}</Button>
            </div>
          ) : null}
          {/* Always rendered so the ref is stable across the async mount. */}
          <div className="awe-mp-embed" ref={containerRef} data-aweave-devkit="embed-container" />
        </section>
        {config !== undefined && openMissionId !== null ? (
          <>
            <Splitter
              className="awe-mp-splitDetail"
              orientation="vertical"
              value={detailPx}
              min={MIN_DETAIL_PX}
              max={Math.max(MIN_DETAIL_PX, (bodyRef.current?.clientWidth ?? 0) - MIN_BOARD_PX)}
              label={t('page.splitter')}
              onDelta={onDetailDelta}
              onEnd={persistDetail}
            />
            <aside className="awe-mp-detail">
              <div className="awe-mp-backBar">
                <Button variant="ghost" size="sm" onClick={closeDetail}>{t('page.back')}</Button>
              </div>
              <MissionDetail
                key={openMissionId}
                config={config}
                t={t}
                missionId={openMissionId}
                memory={memory}
                onClose={closeDetail}
                onBusy={setDetailBusy}
              />
            </aside>
          </>
        ) : null}
      </div>
    </div>
  )
}
