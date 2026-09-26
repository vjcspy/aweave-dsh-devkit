/**
 * Opening a task's markdown: absolute-path resolution and the degradation
 * decision, as a pure function.
 *
 * A task id is an AWEAVE-ROOT-RELATIVE path, and `fileAddressFor` passes a
 * relative path through unresolved rather than joining it onto the Session root
 * (`workspaces/k/dsh/deepseek-harness/packages/util/workspace-path/src/index.ts:92-98`).
 * Opening a relative address would therefore name the wrong file — or nothing —
 * so this module builds an ABSOLUTE path first, and refuses to open at all when
 * the Session cannot resolve it.
 *
 * The degradation is deliberately loud and specific: a Session rooted outside the
 * Aweave platform cannot reach those files, and the message names the root that
 * would work instead of silently doing nothing.
 * @module
 */

import { fileAddressFor, isAbsoluteWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'

/** What one open attempt resolved to. */
export type OpenTaskPlan =
  /** The address to hand to `openResource`. */
  | { readonly kind: 'open'; readonly address: string; readonly path: string }
  /** No Aweave root is known, so no absolute path can be built. */
  | { readonly kind: 'no-aweave-root' }
  /** The Session reports no workspace root, so the absolute path cannot be authorized. */
  | { readonly kind: 'no-session-root'; readonly path: string }
  /** An absolute path was built, but it lies outside the Session's workspace. */
  | { readonly kind: 'outside-session-root'; readonly path: string; readonly cwd: string }

/** The facts one open attempt reads. */
export interface OpenTaskInput {
  /** Absolute Aweave platform root the Host published, or absent when it resolved none. */
  readonly aweaveRoot: string | null | undefined
  /** Session the tab belongs to. */
  readonly sessionId: string
  /** The Session's workspace root, when the Session reports one. */
  readonly cwd: string | undefined
  /** The task's Aweave-root-relative markdown path. */
  readonly filePath: string
}

/**
 * Join an absolute root with a relative path, in POSIX spelling.
 *
 * `node:path` is not used because this module is bundled into the page, where a
 * Node builtin is unavailable; the two operations needed here — trim separators
 * and join — are all a path join is doing for these inputs, and the root is
 * already absolute.
 * @param root - absolute root, in either separator spelling.
 * @param relative - path relative to that root.
 * @returns the joined absolute path.
 */
export function joinAbsolutePath(root: string, relative: string): string {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const tail = relative.replace(/\\/g, '/').replace(/^\/+/, '')
  return tail === '' ? base : `${base}/${tail}`
}

/**
 * Decide what opening one task does.
 *
 * A refusal is returned instead of an address whenever the address would name a
 * file the Session cannot authorize, so the caller never opens the wrong
 * document.
 * @param input - the facts one open attempt reads.
 * @returns the plan, naming the condition when nothing may be opened.
 */
export function planOpenTask(input: OpenTaskInput): OpenTaskPlan {
  const root = input.aweaveRoot ?? undefined
  // A non-absolute root cannot yield an absolute path, which is the one thing
  // `fileAddressFor` needs, so it is the same condition as no root at all.
  if (root === undefined || root === '' || !isAbsoluteWorkspacePath(root.replace(/\\/g, '/'))) {
    return { kind: 'no-aweave-root' }
  }

  const path = joinAbsolutePath(root, input.filePath)

  const cwd = input.cwd
  if (cwd === undefined || cwd === '') return { kind: 'no-session-root', path }

  const sessionRoot = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (path !== sessionRoot && !path.startsWith(`${sessionRoot}/`)) {
    return { kind: 'outside-session-root', path, cwd }
  }

  return { kind: 'open', address: fileAddressFor(input.sessionId, cwd, path), path }
}
