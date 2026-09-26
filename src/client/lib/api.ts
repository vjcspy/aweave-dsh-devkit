/**
 * The browser half's transport: the fenced routes, reached with plain `fetch`.
 *
 * This replaces the VS Code extension's `lib/messaging.ts` +
 * `src/main/task-board-panel.ts` pair. The page talks to the same-origin fenced
 * path directly, the Host half forwards to the Aweave backend, and the
 * `{ success, data }` envelope arrives unaltered — so unwrapping is all this
 * module does with a body.
 *
 * Two rules the port keeps deliberately:
 *
 * - **The route table is read, never restated.** Paths and methods come from the
 *   configuration the Host published at index render, which is generated from the
 *   Host's own fenced-route table. A second copy here could drift from the fence.
 * - **No error code is ever branched on.** A backend failure carries a `code` and
 *   a `message`; both are surfaced verbatim and neither is compared. Failure
 *   SHAPE is what decides behaviour, because the backend's code vocabulary is the
 *   backend's to change.
 *
 * Failure shape is a three-way split, because the board must never render an
 * empty column set as if there were no tasks:
 *
 * - `unreachable` — the hop itself failed: the request threw, or the Host answered
 *   `502`/`503`/`504` because it could not complete the upstream call.
 * - `backend` — the backend answered a well-formed refusal envelope.
 * - `malformed` — something answered that was neither, so no answer can be trusted.
 * @module
 */

import type { InjectedConfig, InjectedOperation } from '../../config.ts'
import type { BoardFilters, ScopeNode, Task, TaskStatus } from './types.ts'

/** How a call failed, as the surface that reads it needs to distinguish. */
export type ApiFailureKind = 'unreachable' | 'backend' | 'malformed'

/** Statuses that mean the Host could not complete the upstream hop. */
const UNREACHABLE_STATUSES: readonly number[] = [502, 503, 504]

/**
 * A failed board call.
 *
 * Declared with explicit fields rather than constructor parameter properties:
 * the compiler face runs `erasableSyntaxOnly`, so parameter properties are not
 * available.
 */
export class TaskBoardApiError extends Error {
  /** How the call failed. */
  readonly kind: ApiFailureKind
  /** Machine-readable code the backend reported, when it reported one. */
  readonly code: string | undefined
  /** HTTP status the fenced route answered with, when a response arrived at all. */
  readonly status: number | undefined

  /**
   * @param kind - how the call failed.
   * @param message - human-readable detail, already carrying the backend's own text when there was one.
   * @param options - code and status, when they exist.
   */
  constructor(
    kind: ApiFailureKind,
    message: string,
    options: { readonly code?: string | undefined; readonly status?: number | undefined } = {},
  ) {
    super(message)
    this.name = 'TaskBoardApiError'
    this.kind = kind
    this.code = options.code
    this.status = options.status
  }
}

/** The board's data surface, as the body consumes it. */
export interface TaskBoardApi {
  /** `GET …/config`: the configured columns. */
  readonly loadStatuses: () => Promise<TaskStatus[]>
  /** `GET …/scopes`: the scope tree the cascade is built from. */
  readonly loadScopes: () => Promise<ScopeNode[]>
  /**
   * `GET …/tasks`: tasks matching the filters, filtered server-side.
   * @param filters - active filter facets.
   */
  readonly listTasks: (filters: BoardFilters) => Promise<Task[]>
  /**
   * `POST …/tasks`: create a task in a scope.
   * @param body - scope and name are required; status comes from the column.
   */
  readonly createTask: (body: {
    readonly scope: string
    readonly name: string
    readonly status?: string | undefined
    readonly description?: string | undefined
    readonly tags?: readonly string[] | undefined
  }) => Promise<Task>
  /**
   * `POST …/tasks/update`: patch a task. The Host strips `id` and builds the
   * upstream path from it, because the backend's update DTO whitelists its fields.
   * @param body - the task id plus the fields to change.
   */
  readonly updateTask: (body: {
    readonly id: string
    readonly status?: string | undefined
    readonly rank?: number | undefined
    readonly name?: string | undefined
    readonly description?: string | undefined
    readonly tags?: readonly string[] | undefined
  }) => Promise<Task>
}

/** Operation keys the Host's route table publishes; the browser half addresses them by key. */
const OPERATION = {
  scopes: 'scopes',
  config: 'config',
  listTasks: 'list-tasks',
  createTask: 'create-task',
  updateTask: 'update-task',
} as const

/** The `{ success, data }` / `{ success, error }` envelope both ends speak. */
interface Envelope {
  readonly success?: unknown
  readonly data?: unknown
  readonly error?: { readonly code?: unknown; readonly message?: unknown } | undefined
}

/**
 * Compose the query string for a tasks request.
 *
 * The backend's query DTO declares `scopes` and `tags` as COMMA-SEPARATED strings
 * (`GetTasksQueryDto`), not repeated parameters, so each facet is joined into one
 * value and an empty facet is omitted entirely rather than sent blank.
 * @param filters - active filter facets.
 * @returns the query string, leading `?` included, or `''` when nothing is constrained.
 */
export function tasksQuery(filters: BoardFilters): string {
  const params = new URLSearchParams()
  if (filters.scopes.length > 0) params.set('scopes', filters.scopes.join(','))
  if (filters.tags.length > 0) params.set('tags', filters.tags.join(','))
  if (filters.status !== '') params.set('status', filters.status)
  if (filters.text !== '') params.set('text', filters.text)
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

/**
 * Describe a thrown value without assuming it is an `Error`.
 * @param error - the caught value.
 * @returns the value's message, or its string form.
 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message === '' ? error.name : error.message
  return String(error)
}

/**
 * Find the fenced operation a call addresses.
 * @param config - configuration the Host published.
 * @param key - operation key from {@link OPERATION}.
 * @returns the operation, or `undefined` when the Host did not publish it.
 */
function operationOf(config: InjectedConfig, key: string): InjectedOperation | undefined {
  return config.operations.find(operation => operation.key === key)
}

/**
 * Build a board API bound to the published configuration.
 *
 * Every call goes through one `call`, so the envelope rules, the failure split,
 * and the route lookup exist once.
 * @param config - configuration the Host published at index render.
 * @param fetchImpl - transport; defaults to the page's `fetch`, injectable so the transport rules are testable.
 * @returns the bound data surface.
 */
export function createTaskBoardApi(
  config: InjectedConfig,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): TaskBoardApi {
  /**
   * Call one fenced operation and unwrap the backend envelope.
   * @param key - operation key.
   * @param init - request facts: query suffix, method, and body.
   * @returns the envelope's `data`.
   */
  async function call(key: string, init: { query?: string; body?: unknown }): Promise<unknown> {
    const operation = operationOf(config, key)
    if (operation === undefined) {
      // A Host that published no such route cannot be reached at all; naming the
      // key is what makes the configuration the diagnosable cause.
      throw new TaskBoardApiError('malformed', `the Host published no "${key}" route for this plugin`)
    }
    const request: RequestInit = { method: operation.method }
    if (init.body !== undefined) {
      request.headers = { 'content-type': 'application/json' }
      request.body = JSON.stringify(init.body)
    }
    let response: Response
    try {
      response = await fetchImpl(`${operation.path}${init.query ?? ''}`, request)
    } catch (error: unknown) {
      throw new TaskBoardApiError('unreachable', describe(error))
    }

    let text: string
    try {
      text = await response.text()
    } catch (error: unknown) {
      throw new TaskBoardApiError('malformed', describe(error), { status: response.status })
    }

    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      // A body that is not JSON means the answer did not come from the backend,
      // so no part of it may be trusted.
      throw new TaskBoardApiError(
        UNREACHABLE_STATUSES.includes(response.status) ? 'unreachable' : 'malformed',
        text === '' ? `HTTP ${response.status}` : text,
        { status: response.status },
      )
    }

    const envelope = payload as Envelope | null
    const code = typeof envelope?.error?.code === 'string' ? envelope.error.code : undefined
    const message = typeof envelope?.error?.message === 'string' ? envelope.error.message : undefined

    if (envelope !== null && typeof envelope === 'object' && envelope.success === true) {
      return envelope.data
    }
    if (envelope !== null && typeof envelope === 'object' && envelope.success === false) {
      throw new TaskBoardApiError(
        UNREACHABLE_STATUSES.includes(response.status) ? 'unreachable' : 'backend',
        message ?? `HTTP ${response.status}`,
        { code, status: response.status },
      )
    }
    throw new TaskBoardApiError(
      UNREACHABLE_STATUSES.includes(response.status) ? 'unreachable' : 'malformed',
      message ?? `HTTP ${response.status}`,
      { code, status: response.status },
    )
  }

  /**
   * Read one array field out of an envelope's `data`.
   * @param data - the unwrapped payload.
   * @param field - field naming the array.
   * @returns the array, or an empty one when the field is absent or not an array.
   */
  function arrayField<T>(data: unknown, field: string): T[] {
    if (typeof data !== 'object' || data === null) return []
    const value = (data as Record<string, unknown>)[field]
    return Array.isArray(value) ? (value as T[]) : []
  }

  return {
    loadStatuses: async () => arrayField<TaskStatus>(await call(OPERATION.config, {}), 'statuses'),
    loadScopes: async () => arrayField<ScopeNode>(await call(OPERATION.scopes, {}), 'scopes'),
    listTasks: async (filters) => arrayField<Task>(await call(OPERATION.listTasks, { query: tasksQuery(filters) }), 'tasks'),
    createTask: async (body) => await call(OPERATION.createTask, { body }) as Task,
    updateTask: async (body) => await call(OPERATION.updateTask, { body }) as Task,
  }
}
