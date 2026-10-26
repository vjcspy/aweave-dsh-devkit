/**
 * Minimal structural view of `dsh-better-sidebar`'s client service, and the one
 * unpublished call this plugin makes into it.
 *
 * The types are local copies of the members used (`lib/types/client/service.d.ts`
 * and `api.d.ts` of `dsh-better-sidebar` 0.28.0): nothing is imported from that
 * package, so no runtime value of it can leak into this bundle.
 *
 * `writeViaSidebar` posts to better-sidebar's own `sidebar/write` route. That
 * route is NOT part of the published service; it is used because it resolves the
 * session cwd and the active worktree exactly as the read that produced the
 * viewer's `content` did, writes atomically, preserves encoding and line endings,
 * and refuses a stale `expectedMtimeMs`. See the plugin README for the coupling
 * list that must be re-checked on every better-sidebar bump.
 * @module
 */
import type { ReactNode } from 'react'

/** One request's session scope (`SessionScope` in better-sidebar's `api.d.ts`). */
export interface SessionScope {
  sessionId: string
  cwd?: string
  repoRoot?: string
}

/** The toolbar state the built-in text editor reports (`EditorToolbarState`). */
export interface EditorToolbarState {
  modes: boolean
  mode: 'preview' | 'edit'
  dirty: boolean
  editable: boolean
  largeFile?: boolean
  saveState: 'idle' | 'saving' | 'saved' | 'failed'
}

/** Props every file viewer component receives (`FileViewerProps`, members this plugin reads or forwards). */
export interface FileViewerProps {
  scope: SessionScope
  path: string
  viewerId: string
  content?: string
  largeFile?: { size: number }
  mtimeMs?: number
  onToolbarState?: (state: EditorToolbarState) => void
  onReload?: () => void
  [other: string]: unknown
}

/** A file viewer registration (`FileViewerDescriptor`, members this plugin sets or reads). */
export interface FileViewerDescriptor {
  id: string
  title?: string | (() => string)
  exts: readonly string[]
  priority?: number
  fetchStrategy: 'none' | 'fsRead' | 'mediaUrl' | 'custom' | 'binary-download'
  component: (props: FileViewerProps) => ReactNode
}

/** The slice of `ctx.betterSidebar` this plugin calls. */
export interface BetterSidebarLike {
  registerFileViewer(descriptor: FileViewerDescriptor): () => void
  getFileViewers(): readonly FileViewerDescriptor[]
  isViewerEnabled(id: string): boolean
}

/** The outcome of one write. */
export type WriteResult =
  | { ok: true; mtimeMs?: number }
  | { ok: false; kind: 'conflict' | 'http'; status: number; code: string; message: string }
  | { ok: false; kind: 'network' | 'malformed'; message: string }

const WRITE_TIMEOUT_MS = 15_000
const PLACEHOLDER_ORIGIN = 'http://dsh.internal/'

/**
 * Resolve the base the write URL hangs off, with better-sidebar's own rule
 * (`hostHttpBase` + `directoryBase`, `lib/client.js`): the page's `baseURI`,
 * its query and hash dropped and a trailing slash forced, so a reverse-proxy
 * directory prefix is preserved.
 * @returns an absolute directory base URL.
 */
function directoryBase(): string {
  const page = typeof document !== 'undefined' && typeof document.baseURI === 'string' ? document.baseURI : ''
  const transport = (globalThis as { __DSH_TRANSPORT__?: { streamBaseUrl?: string } }).__DSH_TRANSPORT__?.streamBaseUrl
  const base = page !== '' ? page : transport ?? ''
  const url = new URL(base === '' ? PLACEHOLDER_ORIGIN : base, PLACEHOLDER_ORIGIN)
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

/** Whether a value is a non-null plain object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Write a whole document through better-sidebar's `sidebar/write` route.
 *
 * `expectedMtimeMs` is REQUIRED and finite: the route treats a missing baseline
 * as "no gate at all", so this function throws before any request without one.
 * A `2xx` body must be `{ ok: true, value: { ok: true, mtimeMs? } }`.
 * @param scope - the session scope the file was read under.
 * @param path - the file path exactly as the viewer received it.
 * @param content - the full document text to write.
 * @param expectedMtimeMs - the baseline mtime of the text `content` was derived from.
 * @param signal - optional caller abort.
 * @returns the normalized outcome; never rejects for a transport or HTTP failure.
 */
export async function writeViaSidebar(
  scope: SessionScope,
  path: string,
  content: string,
  expectedMtimeMs: number,
  signal?: AbortSignal,
): Promise<WriteResult> {
  if (!Number.isFinite(expectedMtimeMs)) throw new Error('writeViaSidebar requires a finite expectedMtimeMs')
  const params = new URLSearchParams({ sessionId: scope.sessionId, path })
  if (scope.cwd !== undefined && scope.cwd !== '') params.set('cwd', scope.cwd)
  params.set('expectedMtimeMs', String(expectedMtimeMs))
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, WRITE_TIMEOUT_MS)
  const onAbort = (): void => { controller.abort() }
  signal?.addEventListener('abort', onAbort)
  let response: Response
  let text: string
  try {
    response = await fetch(new URL(`sidebar/write?${params.toString()}`, directoryBase()).href, {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: content,
      credentials: 'same-origin',
      signal: controller.signal,
    })
    text = await response.text()
  } catch (error) {
    return { ok: false, kind: 'network', message: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
  let body: unknown
  try { body = JSON.parse(text) } catch { body = undefined }
  if (!response.ok || (isObject(body) && body.ok === false)) {
    const error = isObject(body) && isObject(body.error) ? body.error : {}
    const code = typeof error.code === 'string' ? error.code : 'http'
    const message = typeof error.message === 'string' ? error.message : `HTTP ${response.status}`
    return { ok: false, kind: response.status === 409 || code === 'fs-conflict' ? 'conflict' : 'http', status: response.status, code, message }
  }
  if (!isObject(body) || body.ok !== true || !isObject(body.value) || body.value.ok !== true) {
    return { ok: false, kind: 'malformed', message: 'unexpected response from sidebar/write' }
  }
  const mtimeMs = body.value.mtimeMs
  return typeof mtimeMs === 'number' && Number.isFinite(mtimeMs) ? { ok: true, mtimeMs } : { ok: true }
}
