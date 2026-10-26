/**
 * The browser half's client for the two read-only mission file routes
 * (`missions/tree`, `missions/file`) and the Linked-plans slice of a mission's
 * detail.
 *
 * Every call reads its response through `mission-transport.ts`'s
 * `readEnvelope`, so a file route fails with the same three kinds
 * (`unreachable` / `backend` / `malformed`) as every other fenced JSON route.
 * The route paths are the fixed protocol constants in `src/config.ts`.
 * @module
 */

import { MISSION_FILE_ROUTES, type InjectedConfig } from '../../config.ts'
import type { MissionTransport } from './embed-global.ts'
import { MissionApiError, readEnvelope } from './mission-transport.ts'

/** One node of a mission folder tree, as `missions/tree` answers it. */
export interface TreeNodeDto {
  /** Project-root-relative path. */
  readonly path: string
  readonly name: string
  readonly kind: 'dir' | 'file'
  readonly size?: number
  readonly mtimeMs?: number
  readonly children?: readonly TreeNodeDto[]
}

/** A mission folder's tree. */
export interface MissionTreeDto {
  readonly id: string
  readonly truncated: boolean
  readonly entries: readonly TreeNodeDto[]
}

/** One markdown file's content. */
export interface MissionFileDto {
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
  readonly content: string
}

/** One linked plan of a mission, as the page needs it. */
export interface LinkedPlan {
  readonly path: string
  readonly name: string
}

/** The slice of a mission's detail the page reads. */
export interface MissionOverview {
  readonly name: string
  readonly status: string
  /** Linked plans grouped by goal, goal order as the backend returned it. */
  readonly plans: ReadonlyArray<{ readonly goal: string; readonly plans: readonly LinkedPlan[] }>
}

/**
 * Build a malformed-response error.
 * @param what - what was malformed.
 * @returns the error to throw.
 */
function malformed(what: string): MissionApiError {
  return new MissionApiError('malformed', `the Host answered a malformed ${what}`)
}

/**
 * Validate one tree node.
 * @param value - untrusted value.
 * @returns the node.
 * @throws MissionApiError `malformed` when the shape is wrong.
 */
function parseNode(value: unknown): TreeNodeDto {
  const row = value as Record<string, unknown> | null
  if (typeof row !== 'object' || row === null) throw malformed('tree node')
  if (typeof row.path !== 'string' || typeof row.name !== 'string') throw malformed('tree node')
  if (row.kind !== 'dir' && row.kind !== 'file') throw malformed('tree node')
  const node: { -readonly [K in keyof TreeNodeDto]: TreeNodeDto[K] } = { path: row.path, name: row.name, kind: row.kind }
  if (typeof row.size === 'number') node.size = row.size
  if (typeof row.mtimeMs === 'number') node.mtimeMs = row.mtimeMs
  if (Array.isArray(row.children)) node.children = row.children.map(parseNode)
  return node
}

/**
 * Fetch one fenced file route.
 * @param config - configuration the Host published; its deadline bounds the call.
 * @param route - the route's path.
 * @param query - the query to send.
 * @param signal - cancels the call when the caller no longer wants the result.
 * @returns the envelope's `data`.
 */
async function fetchRoute(
  config: InjectedConfig,
  route: string,
  query: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const deadline = AbortSignal.timeout(config.requestTimeoutMs)
  let response: Response
  try {
    response = await fetch(`${route}?${new URLSearchParams(query).toString()}`, {
      method: 'GET',
      credentials: 'same-origin',
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    })
  } catch (error: unknown) {
    if (signal?.aborted === true) throw error
    throw new MissionApiError('unreachable', error instanceof Error ? error.message : String(error))
  }
  return await readEnvelope(response)
}

/**
 * Fetch a mission folder's markdown tree.
 * @param config - configuration the Host published.
 * @param id - mission folder id.
 * @param signal - optional cancellation.
 * @returns the validated tree.
 */
export async function fetchMissionTree(config: InjectedConfig, id: string, signal?: AbortSignal): Promise<MissionTreeDto> {
  const data = await fetchRoute(config, MISSION_FILE_ROUTES.tree, { id }, signal) as Record<string, unknown> | null
  if (typeof data !== 'object' || data === null) throw malformed('tree')
  if (typeof data.id !== 'string' || typeof data.truncated !== 'boolean' || !Array.isArray(data.entries)) {
    throw malformed('tree')
  }
  return { id: data.id, truncated: data.truncated, entries: data.entries.map(parseNode) }
}

/**
 * Fetch one markdown file.
 * @param config - configuration the Host published.
 * @param path - project-root-relative `resources/**.md` path.
 * @param signal - optional cancellation.
 * @returns the validated file.
 */
export async function fetchMissionFile(config: InjectedConfig, path: string, signal?: AbortSignal): Promise<MissionFileDto> {
  const data = await fetchRoute(config, MISSION_FILE_ROUTES.file, { path }, signal) as Record<string, unknown> | null
  if (typeof data !== 'object' || data === null) throw malformed('file')
  if (typeof data.path !== 'string' || typeof data.size !== 'number'
    || typeof data.mtimeMs !== 'number' || typeof data.content !== 'string') {
    throw malformed('file')
  }
  return { path: data.path, size: data.size, mtimeMs: data.mtimeMs, content: data.content }
}

/**
 * Read a mission's name, status and Linked plans through the board's own transport.
 * @param transport - a transport over the fenced JSON routes.
 * @param id - mission folder id.
 * @returns the overview; plan rows whose path is not a string are dropped.
 */
export async function fetchMissionOverview(transport: MissionTransport, id: string): Promise<MissionOverview> {
  const data = await transport.getMissionDetail(id) as Record<string, unknown> | null
  if (typeof data !== 'object' || data === null) throw malformed('mission detail')
  const plans: Array<{ goal: string; plans: LinkedPlan[] }> = []
  const raw = data.plans
  if (typeof raw === 'object' && raw !== null) {
    for (const [goal, rows] of Object.entries(raw)) {
      if (!Array.isArray(rows)) continue
      const linked: LinkedPlan[] = []
      for (const row of rows as unknown[]) {
        const plan = row as { path?: unknown; name?: unknown } | null
        if (typeof plan?.path !== 'string') continue
        linked.push({ path: plan.path, name: typeof plan.name === 'string' && plan.name !== '' ? plan.name : plan.path })
      }
      if (linked.length > 0) plans.push({ goal, plans: linked })
    }
  }
  return {
    name: typeof data.name === 'string' ? data.name : id,
    status: typeof data.status === 'string' ? data.status : '',
    plans,
  }
}
