/**
 * The browser half's mission transport: the fenced JSON routes, reached with
 * plain `fetch`, adapted to `embed-global.ts`'s `MissionTransport` shape so
 * it can be handed straight to `embed.js`'s `mount(el, { transport })`.
 *
 * Ports `lib/api.ts`'s (deleted) envelope-unwrapping rules verbatim — same
 * `{ success, data | error }` envelope, same three-way failure split
 * (`unreachable` / `backend` / `malformed`), same "the route table is read,
 * never restated" rule (`config.ts`'s `FENCED_OPERATIONS`) — over the four
 * mission operations instead of the deleted task ones. `subscribeEvents` is
 * NOT implemented: see `embed-global.ts`'s module comment.
 * @module
 */

import type { InjectedConfig, InjectedOperation } from '../../config.ts'
import type { MissionTransport, UpdateMissionInput } from './embed-global.ts'

/** How a call failed, as the caller needs to distinguish. */
export type MissionApiFailureKind = 'unreachable' | 'backend' | 'malformed'

/** Statuses that mean the Host could not complete the upstream hop. */
const UNREACHABLE_STATUSES: readonly number[] = [502, 503, 504]

/** A failed mission transport call. */
export class MissionApiError extends Error {
  readonly kind: MissionApiFailureKind
  readonly code: string | undefined
  readonly status: number | undefined

  constructor(
    kind: MissionApiFailureKind,
    message: string,
    options: { readonly code?: string | undefined; readonly status?: number | undefined } = {},
  ) {
    super(message)
    this.name = 'MissionApiError'
    this.kind = kind
    this.code = options.code
    this.status = options.status
  }
}

/** Operation keys `config.ts`'s `FENCED_PATHS` publishes; addressed by key, never by a restated path. */
const OPERATION = {
  config: 'mission-config',
  list: 'mission-list',
  detail: 'mission-detail',
  update: 'mission-update',
} as const

/** The `{ success, data }` / `{ success, error }` envelope both ends speak. */
interface Envelope {
  readonly success?: unknown
  readonly data?: unknown
  readonly error?: { readonly code?: unknown; readonly message?: unknown } | undefined
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
 * Build a mission transport bound to the published configuration.
 * @param config - configuration the Host published at index render.
 * @param fetchImpl - transport; defaults to the page's `fetch`, injectable so the transport rules are testable.
 * @returns the transport, ready to hand to `embed.js`'s `mount(el, { transport })`.
 */
export function createMissionTransport(
  config: InjectedConfig,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): MissionTransport {
  /**
   * Call one fenced operation and unwrap the backend envelope.
   * @param key - operation key.
   * @param init - request facts: query suffix, method, and body.
   * @returns the envelope's `data`.
   */
  async function call(key: string, init: { query?: string; body?: unknown }): Promise<unknown> {
    const operation = operationOf(config, key)
    if (operation === undefined) {
      throw new MissionApiError('malformed', `the Host published no "${key}" route for this plugin`)
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
      throw new MissionApiError('unreachable', describe(error))
    }

    let text: string
    try {
      text = await response.text()
    } catch (error: unknown) {
      throw new MissionApiError('malformed', describe(error), { status: response.status })
    }

    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      throw new MissionApiError(
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
      throw new MissionApiError(
        UNREACHABLE_STATUSES.includes(response.status) ? 'unreachable' : 'backend',
        message ?? `HTTP ${response.status}`,
        { code, status: response.status },
      )
    }
    throw new MissionApiError(
      UNREACHABLE_STATUSES.includes(response.status) ? 'unreachable' : 'malformed',
      message ?? `HTTP ${response.status}`,
      { code, status: response.status },
    )
  }

  return {
    getConfig: async () => await call(OPERATION.config, {}),
    listMissions: async () => {
      const data = await call(OPERATION.list, {})
      const missions = (data as { missions?: unknown } | null)?.missions
      return Array.isArray(missions) ? missions : []
    },
    getMissionDetail: async (id, progress) => {
      const params = new URLSearchParams({ id })
      if (progress !== undefined) params.set('progress', String(progress))
      return await call(OPERATION.detail, { query: `?${params.toString()}` })
    },
    updateMission: async (input: UpdateMissionInput) => await call(OPERATION.update, { body: input }),
    // No `subscribeEvents`: see `embed-global.ts`'s module comment. `mission-web`'s
    // `Board` falls back to polling `listMissions` when a transport omits it.
  }
}
