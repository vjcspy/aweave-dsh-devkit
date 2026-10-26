/**
 * The Mission Board right-sidebar tab body: mounts `@hod/aweave-mission-web`'s
 * `embed.js` (loaded by the shared `useEmbedBoard` hook), handing it a
 * transport built over the fenced JSON routes.
 *
 * This plugin does not OWN a board implementation — `embed.js` is
 * `mission-web`'s self-contained bundle (its own React 19 root inside a Shadow
 * DOM), loaded at runtime exactly as the VS Code devkit and the standalone SPA
 * do, so the shells can never drift from each other's board logic. The
 * Missions page (`MissionsPage.tsx`) mounts the same board through the same
 * hook; this body keeps the one thing only a Session-bound tab can do:
 * translate `onOpenIndex`'s payload into an `openResource` call, the same
 * two-step `open-task.ts` used for a task: validate the path is SHAPED like a
 * mission `INDEX.md` (`lib/mission-index-path.ts`), then resolve it against the
 * Session's own workspace root (`planOpenTask`), which is the actual security
 * boundary — a shape check alone never authorizes a file open.
 * @module
 */

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: declares the `useSessions` global seat and the `sessionId` session seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import type { InjectedConfig } from '../config.ts'
import { isMissionIndexPath } from './lib/mission-index-path.ts'
import type { AweaveMissionBoardKey } from './locale.ts'
import type {} from './locale.ts'
import { planOpenTask } from './open-task.ts'
import { useEmbedBoard } from './useEmbedBoard.ts'

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

/**
 * Render the Mission Board.
 * @param props - the composed slot props: the tab, the injected face, the session seats and the copy seat.
 * @returns the board's container, or the state explaining why it has none.
 */
export function MissionBoardBody({ config, useTabInfo, sessionId, useSessions, t }: MissionBoardBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  // `cwd`/`sessionId`/`tab` are read at call time through the hook's options ref,
  // so they are deliberately not remount triggers: embed.js's own `mount()` is
  // expensive (its own React root + Shadow DOM), and a Session's `cwd` does not
  // change while its tab stays open.
  const { phase } = useEmbedBoard(containerRef, config, {
    onOpenIndex: (indexPath) => {
      if (!isMissionIndexPath(indexPath)) {
        setNotice(t('error.open.invalidPath', { path: indexPath }))
        return
      }
      const plan = planOpenTask({
        aweaveRoot: config?.aweaveRoot ?? undefined,
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

/** Re-exported so `client/index.ts` and the client-bundle spec can name the dictionary key type without a second import path. */
export type { AweaveMissionBoardKey }
