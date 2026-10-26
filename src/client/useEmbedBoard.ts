/**
 * The shared mount hook for `@hod/aweave-mission-web`'s `embed.js`, used by the
 * right-sidebar tab (`MissionBoardBody`) and the Missions page.
 *
 * `embed.js`'s `mount()` is an imperative API, so the lifecycle lives in one
 * place:
 * 1. Load the script once per page (a module-level singleton promise), since a
 *    second `<script>` tag re-executing `embed.js` would reassign
 *    `window.AweaveMissionBoard`. A FAILED load clears the singleton, so
 *    {@link EmbedBoard.retry} and any later mount load again instead of failing
 *    until a page reload.
 * 2. Mount into a container `div` the caller renders and never otherwise touches.
 * 3. Unmount on cleanup.
 *
 * The mount lifetime is keyed on `config` (and the retry counter) only. The
 * transport and `onOpenIndex` are read through a ref at call time, so a caller
 * passing a new options object on every render never remounts the embed, which
 * is expensive (its own React root and Shadow DOM).
 * @module
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { InjectedConfig } from '../config.ts'
import {
  readEmbedGlobal,
  type AweaveMissionBoardGlobal,
  type MissionBoardHandle,
  type MissionTransport,
} from './lib/embed-global.ts'
import { createMissionTransport } from './lib/mission-transport.ts'

/** Where the embed script is in its load lifecycle. */
export type EmbedPhase = 'loading' | 'ready' | 'failed'

/**
 * Module-level singleton: `embed.js` is loaded once per page, no matter how
 * many surfaces mount a board. Cleared when a load fails.
 */
let scriptLoad: Promise<AweaveMissionBoardGlobal> | undefined

/**
 * Load `embed.js` from the fenced script route exactly once, until a load fails.
 * @param path - fenced pathname (`InjectedConfig.embedScriptPath`).
 * @returns the resolved embed global.
 */
function loadEmbedScript(path: string): Promise<AweaveMissionBoardGlobal> {
  if (scriptLoad !== undefined) return scriptLoad
  const load = new Promise<AweaveMissionBoardGlobal>((resolvePromise, rejectPromise) => {
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
        tag.remove()
        rejectPromise(new Error(`${path} loaded but did not publish window.AweaveMissionBoard`))
        return
      }
      resolvePromise(global)
    })
    tag.addEventListener('error', () => {
      // A failed tag must not pile up: the retry appends a fresh one.
      tag.remove()
      rejectPromise(new Error(`failed to load ${path}`))
    })
    document.head.appendChild(tag)
  })
  scriptLoad = load
  load.catch(() => {
    if (scriptLoad === load) scriptLoad = undefined
  })
  return load
}

/** `--mb-*` ← `--dsw-alias-*`: the mission board's theme mapped onto the DSH platform's own tokens. */
export const MISSION_THEME_MAP: Record<string, string> = {
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

/** What a surface hands the hook, read at call time. */
export interface EmbedBoardOptions {
  /** Transport the board reads through; omit to build the plain one over the fenced routes. */
  readonly transport?: MissionTransport | undefined
  /** Called with `<mission folder>/INDEX.md` when a card is selected. */
  readonly onOpenIndex: (indexPath: string) => void
}

/** What the hook returns. */
export interface EmbedBoard {
  readonly phase: EmbedPhase
  /** Load again after a failed load. */
  readonly retry: () => void
}

/**
 * Load `embed.js` and mount the board into a container.
 * @param containerRef - the container `div` the caller renders.
 * @param config - configuration the Host published, or `undefined` when none arrived (nothing mounts).
 * @param options - the transport and the card-selection callback, read at call time.
 * @returns the load phase and a retry control.
 */
export function useEmbedBoard(
  containerRef: RefObject<HTMLDivElement | null>,
  config: InjectedConfig | undefined,
  options: EmbedBoardOptions,
): EmbedBoard {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const handleRef = useRef<MissionBoardHandle | undefined>(undefined)
  const [phase, setPhase] = useState<EmbedPhase>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (config === undefined) return
    const container = containerRef.current
    if (container === null) return
    let cancelled = false

    loadEmbedScript(config.embedScriptPath).then((global) => {
      if (cancelled) return
      handleRef.current = global.mount(container, {
        transport: optionsRef.current.transport ?? createMissionTransport(config),
        theme: MISSION_THEME_MAP,
        onOpenIndex: (indexPath) => { optionsRef.current.onOpenIndex(indexPath) },
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
    // The transport and `onOpenIndex` are read through `optionsRef`, so they are
    // deliberately not remount triggers. This repo has no ESLint (`check` is
    // `tsc --noEmit` only), so no `react-hooks/exhaustive-deps` directive is needed.
  }, [config, containerRef, attempt])

  const retry = useCallback(() => {
    setPhase('loading')
    setAttempt(value => value + 1)
  }, [])

  return { phase, retry }
}
