/**
 * The Mission Board body: loads `@hod/aweave-mission-web`'s `embed.js` from
 * the fenced script route and mounts it, handing it a transport built over
 * the fenced JSON routes.
 *
 * Replaces `TaskBoardBody.tsx` (deleted): this plugin no longer OWNS a board
 * implementation — `embed.js` is `mission-web`'s self-contained bundle (its
 * own React 19 root inside a Shadow DOM), loaded at runtime exactly as the
 * VS Code devkit and the standalone SPA do, so the three shells can never
 * drift from each other's board logic.
 *
 * Three responsibilities live here, all imperative because `embed.js`'s
 * `mount()` is an imperative API, not a React component:
 * 1. Load the script exactly once per page (a module-level singleton
 *    promise), since a second `<script>` tag re-executing `embed.js` would
 *    reassign `window.AweaveMissionBoard` and could double the shadow root
 *    it toggling remount races against React's own commit.
 * 2. Mount into a plain container `div` this component renders and never
 *    otherwise touches — `embed.js` owns everything under it.
 * 3. Translate `onOpenIndex`'s payload into an `openResource` call, the same
 *    two-step `open-task.ts` used for a task: validate the path is SHAPED
 *    like a mission `INDEX.md` (`lib/mission-index-path.ts`), then resolve
 *    it against the Session's own workspace root (`planOpenTask`), which is
 *    the actual security boundary — a shape check alone never authorizes a
 *    file open.
 * @module
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: declares the `useSessions` global seat and the `sessionId` session seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import type { InjectedConfig } from '../config.ts'
import { readEmbedGlobal, type AweaveMissionBoardGlobal, type MissionBoardHandle } from './lib/embed-global.ts'
import { isMissionIndexPath } from './lib/mission-index-path.ts'
import { createMissionTransport } from './lib/mission-transport.ts'
import type { AweaveMissionBoardKey } from './locale.ts'
import type {} from './locale.ts'
import { planOpenTask } from './open-task.ts'

/** What the apply closure offers this body. */
export interface MissionBoardInjected {
  /** Configuration the Host published at index render, or `undefined` when the global was absent or malformed. */
  readonly config: InjectedConfig | undefined
}

/** The body's composed props: the tab it draws, its injected face, the session seats, and its copy. */
export type MissionBoardBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & MissionBoardInjected
  & PropsLocale<'aweaveMissionBoard'>

/** Where the embed script is in its load lifecycle, page-wide. */
type ScriptPhase = 'loading' | 'ready' | 'failed'

/**
 * Module-level singleton: `embed.js` is loaded once per page, no matter how
 * many times a Human opens or closes the Mission Board tab.
 */
let scriptLoad: Promise<AweaveMissionBoardGlobal> | undefined

/**
 * Load `embed.js` from the fenced script route exactly once.
 * @param path - fenced pathname (`InjectedConfig.embedScriptPath`).
 * @returns the resolved embed global.
 */
function loadEmbedScript(path: string): Promise<AweaveMissionBoardGlobal> {
  scriptLoad ??= new Promise<AweaveMissionBoardGlobal>((resolvePromise, rejectPromise) => {
    const existing = readEmbedGlobal()
    if (existing !== undefined) {
      resolvePromise(existing)
      return
    }
    const tag = document.createElement('script')
    tag.src = path
    tag.async = true
    tag.addEventListener('load', () => {
      const global = readEmbedGlobal()
      if (global === undefined) {
        rejectPromise(new Error(`${path} loaded but did not publish window.AweaveMissionBoard`))
        return
      }
      resolvePromise(global)
    })
    tag.addEventListener('error', () => {
      rejectPromise(new Error(`failed to load ${path}`))
    })
    document.head.appendChild(tag)
  })
  return scriptLoad
}

/**
 * Render the Mission Board.
 * @param props - the composed slot props: the tab, the injected face, the session seats and the copy seat.
 * @returns the board's container, or the state explaining why it has none.
 */
export function MissionBoardBody({ config, useTabInfo, sessionId, useSessions, t }: MissionBoardBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<MissionBoardHandle | undefined>(undefined)
  const [phase, setPhase] = useState<ScriptPhase>('loading')
  const [notice, setNotice] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (config === undefined) return
    const container = containerRef.current
    if (container === null) return
    let cancelled = false

    loadEmbedScript(config.embedScriptPath).then((global) => {
      if (cancelled) return
      const transport = createMissionTransport(config)
      handleRef.current = global.mount(container, {
        transport,
        theme: MISSION_THEME_MAP,
        onOpenIndex: (indexPath) => {
          if (!isMissionIndexPath(indexPath)) {
            setNotice(t('error.open.invalidPath', { path: indexPath }))
            return
          }
          const plan = planOpenTask({
            aweaveRoot: config.aweaveRoot ?? undefined,
            sessionId,
            cwd,
            filePath: indexPath,
          })
          if (plan.kind === 'open') {
            tab.actions.openResource(plan.address)
            return
          }
          if (plan.kind === 'no-aweave-root') {
            setNotice(t('error.open.noRoot'))
            return
          }
          if (plan.kind === 'no-session-root') {
            setNotice(t('error.open.noSessionRoot', { path: plan.path }))
            return
          }
          setNotice(t('error.open.outsideSessionRoot', { path: plan.path, cwd: plan.cwd }))
        },
      })
      setPhase('ready')
    }).catch(() => {
      if (!cancelled) setPhase('failed')
    })

    return () => {
      cancelled = true
      handleRef.current?.unmount()
      handleRef.current = undefined
    }
    // `cwd`/`sessionId`/`tab` are read via closure at call time inside
    // `onOpenIndex`, so they are deliberately not remount triggers: embed.js's
    // own `mount()` is expensive (its own React root + Shadow DOM), and a
    // Session's `cwd` does not change while its tab stays open. This repo has
    // no ESLint (`check` is `tsc --noEmit` only; see package.json), so no
    // `react-hooks/exhaustive-deps` disable directive is needed here.
  }, [config])

  if (config === undefined) {
    return (
      <div className='awe-mb-root' data-aweave-devkit='mission-board'>
        <section className='awe-mb-state' data-aweave-devkit='state:unconfigured'>
          <h3 className='awe-mb-state-title'>{t('state.unconfigured.title')}</h3>
          <p className='awe-mb-state-detail'>{t('state.unconfigured.detail')}</p>
        </section>
      </div>
    )
  }

  return (
    <div className='awe-mb-root' data-aweave-devkit='mission-board'>
      {phase === 'loading' && (
        <p className='awe-mb-state' data-aweave-devkit='state:loading'>{t('state.loading')}</p>
      )}
      {phase === 'failed' && (
        <section className='awe-mb-state awe-mb-state--error' data-aweave-devkit='state:failed' role='alert'>
          <h3 className='awe-mb-state-title'>{t('state.failed.title')}</h3>
          <p className='awe-mb-state-detail'>{t('state.failed.detail')}</p>
        </section>
      )}
      {notice !== undefined && (
        <div className='awe-mb-notice' data-aweave-devkit='notice' role='alert'>
          <span className='awe-mb-notice-text'>{notice}</span>
          <button
            type='button'
            className='awe-mb-notice-dismiss'
            aria-label={t('action.dismiss')}
            onClick={() => { setNotice(undefined) }}
          >
            ×
          </button>
        </div>
      )}
      {/* Always rendered (even during 'loading'/'failed') so the ref is stable
          across the async mount; embed.js paints into it once `mount()` resolves. */}
      <div className='awe-mb-embed-container' ref={containerRef} data-aweave-devkit='embed-container' />
    </div>
  )
}

/** `--mb-*` ← `--dsw-alias-*`: the mission board's theme mapped onto the DSH platform's own tokens. */
const MISSION_THEME_MAP: Record<string, string> = {
  // Same surfaces the retired taskboard used: columns on layer-1, cards on base.
  '--mb-bg': 'var(--dsw-alias-bg-base)',
  '--mb-panel': 'var(--dsw-alias-bg-layer-1)',
  '--mb-card': 'var(--dsw-alias-bg-base)',
  '--mb-border': 'var(--dsw-alias-border-l2)',
  '--mb-text': 'var(--dsw-alias-label-primary)',
  '--mb-muted': 'var(--dsw-alias-label-tertiary)',
  '--mb-accent': 'var(--dsw-alias-state-business-primary)',
  '--mb-danger': 'var(--dsw-alias-state-error-primary)',
}

/** Re-exported so `client/index.ts` and the client-bundle spec can name the dictionary key type without a second import path. */
export type { AweaveMissionBoardKey }
