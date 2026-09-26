/**
 * Resolution of the Aweave platform root.
 *
 * The root has one consumer: the browser half must build an ABSOLUTE path before
 * it can open a task, because a task's `id` is Aweave-root-relative and the
 * address grammar does not resolve a relative path against the Session `cwd`.
 *
 * Two sources, in this order: an explicit `Config.aweaveRoot`, then a walk up
 * from the Host's working directory for the platform marker. The marker is the
 * same one the VS Code extension uses to detect Aweave mode, so two clients on
 * one machine cannot disagree about where the platform root is.
 *
 * The marker decides DERIVATION only. An explicit value is authoritative as
 * given, because a deployment may root its Aweave checkout somewhere this walk
 * cannot reach and it is that deployment, not this plugin, that knows where.
 */
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { AWEAWE_ROOT_MARKER } from '../config.ts'

/** Facts the resolution reads from the host. */
export interface AweaveRootProbe {
  /** Directory the walk starts from. */
  readonly cwd: string
  /**
   * Test one candidate marker path.
   *
   * A parameter rather than a direct `existsSync` call so the walk is testable
   * without a filesystem; {@link defaultProbe} wires the real one.
   */
  readonly markerExists: (markerPath: string) => boolean
}

/** Where the Aweave root came from, or why none resolved. */
export type AweaveRootResolution =
  | { readonly source: 'config'; readonly root: string }
  | { readonly source: 'derived'; readonly root: string }
  | { readonly source: 'unresolved'; readonly reason: string }

/** The probe a Host boot uses: the process working directory and the real filesystem. */
export const defaultProbe: AweaveRootProbe = { cwd: process.cwd(), markerExists: existsSync }

/**
 * Resolve the Aweave platform root.
 * @param configured - `Config.aweaveRoot`; the empty string means "derive it".
 * @param probe - the directory to start from and the marker test.
 * @returns the resolved root and its source, or the reason none resolved.
 */
export function resolveAweaveRoot(
  configured: string | undefined,
  probe: AweaveRootProbe = defaultProbe,
): AweaveRootResolution {
  const explicit = configured?.trim() ?? ''
  if (explicit !== '') {
    if (!isAbsolute(explicit)) {
      return { source: 'unresolved', reason: `Config.aweaveRoot is not an absolute path: ${explicit}` }
    }
    return { source: 'config', root: resolve(explicit) }
  }
  for (const candidate of ancestorsOf(probe.cwd)) {
    if (probe.markerExists(join(candidate, AWEAWE_ROOT_MARKER))) return { source: 'derived', root: candidate }
  }
  return {
    source: 'unresolved',
    reason: `no ancestor of ${probe.cwd} contains ${AWEAWE_ROOT_MARKER}`,
  }
}

/**
 * One directory and every ancestor above it, nearest first.
 * @param from - the directory to start from.
 * @returns absolute directories, ending at the filesystem root.
 */
export function ancestorsOf(from: string): readonly string[] {
  const chain: string[] = []
  let current = resolve(from)
  for (;;) {
    chain.push(current)
    const parent = dirname(current)
    if (parent === current) return chain
    current = parent
  }
}
