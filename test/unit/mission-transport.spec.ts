/**
 * `createMissionTransport`: the envelope-unwrapping rules and the three-way
 * failure split (`unreachable` / `backend` / `malformed`), exercised through
 * an injected `fetch` stub — no DOM, no built bundle, no network.
 *
 * Ports `lib/api.ts`'s (deleted) test coverage verbatim onto the four mission
 * operations; the request/response shapes differ (mission ids, not task ids),
 * the rules over them do not.
 */
import { describe, expect, it } from 'vitest'

import { FENCED_OPERATIONS, type InjectedConfig } from '../../src/config.ts'
import { createMissionTransport, MissionApiError } from '../../src/client/lib/mission-transport.ts'

/** A configuration carrying every fenced operation, as the Host would publish it. */
function injectedConfig(): InjectedConfig {
  return {
    baseUrl: 'http://127.0.0.1:3456',
    requestTimeoutMs: 8000,
    aweaveRoot: '/platform',
    operations: FENCED_OPERATIONS,
    embedScriptPath: '/api/aweave-dsh-devkit/mission-board/embed.js',
  }
}

/** Request facts captured from the stubbed `fetch`. */
interface SeenRequest {
  url: string
  method: string | undefined
  body: string | undefined
}

/**
 * Build a transport over a stub `fetch` that records every call and answers with a fixed response.
 * @param respond - response to answer with, or a function producing one (or throwing).
 * @returns the transport and the calls it made.
 */
function transportWith(respond: () => Response | Promise<Response>): { seen: SeenRequest[]; transport: ReturnType<typeof createMissionTransport> } {
  const seen: SeenRequest[] = []
  const fetchImpl: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    return await respond()
  }) as typeof fetch
  return { seen, transport: createMissionTransport(injectedConfig(), fetchImpl) }
}

/**
 * A fenced-route answer carrying a success envelope.
 * @param data - payload to place in `data`.
 * @returns the response.
 */
function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * A fenced-route answer carrying a failure envelope.
 * @param status - HTTP status.
 * @param code - the backend's error code.
 * @param message - the backend's message.
 * @returns the response.
 */
function failure(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Assert a captured throw is a `MissionApiError` and read its fields.
 * @param thrown - the captured throw.
 * @returns the failure's fields.
 */
function failureOf(thrown: unknown): { kind: unknown; code: unknown; message: unknown; status: unknown } {
  expect(thrown).toBeInstanceOf(MissionApiError)
  const error = thrown as MissionApiError
  return { kind: error.kind, code: error.code, message: error.message, status: error.status }
}

describe('createMissionTransport — request shapes', () => {
  it('calls getConfig against the mission-config operation with GET and no body', async () => {
    const { seen, transport } = transportWith(() => ok({ statuses: [{ id: 'todo', label: 'To Do' }] }))
    const value = await transport.getConfig()
    expect(seen).toEqual([{ url: '/api/aweave-dsh-devkit/missions/config', method: 'GET', body: undefined }])
    expect(value).toEqual({ statuses: [{ id: 'todo', label: 'To Do' }] })
  })

  it('unwraps listMissions’ missions array, and falls back to empty rather than throwing on a missing one', async () => {
    const withMissions = transportWith(() => ok({ missions: [{ id: 'a' }, { id: 'b' }] }))
    expect(await withMissions.transport.listMissions()).toEqual([{ id: 'a' }, { id: 'b' }])

    const withoutMissions = transportWith(() => ok({}))
    expect(await withoutMissions.transport.listMissions()).toEqual([])
  })

  it('builds the detail query from id and an optional progress flag', async () => {
    const { seen, transport } = transportWith(() => ok({ id: 'x' }))
    await transport.getMissionDetail('resources/workspaces/k/dsh/_missions/__260926-probe/INDEX.md')
    const url = new URL(seen[0]!.url, 'http://page.invalid')
    expect(url.pathname).toBe('/api/aweave-dsh-devkit/missions/detail')
    expect(url.searchParams.get('id')).toBe('resources/workspaces/k/dsh/_missions/__260926-probe/INDEX.md')
    expect(url.searchParams.has('progress')).toBe(false)

    seen.length = 0
    await transport.getMissionDetail('id', 3)
    const urlWithProgress = new URL(seen[0]!.url, 'http://page.invalid')
    expect(urlWithProgress.searchParams.get('progress')).toBe('3')
  })

  it('sends updateMission as a POST body to the fixed mission-update route', async () => {
    const { seen, transport } = transportWith(() => ok({ id: 'x', status: 'done' }))
    await transport.updateMission({ id: 'resources/workspaces/k/dsh/_missions/__260926-probe/INDEX.md', status: 'done', rank: 2.5 })
    expect(seen[0]!.url).toBe('/api/aweave-dsh-devkit/missions/update')
    expect(seen[0]!.method).toBe('POST')
    expect(JSON.parse(seen[0]!.body!)).toEqual({
      id: 'resources/workspaces/k/dsh/_missions/__260926-probe/INDEX.md',
      status: 'done',
      rank: 2.5,
    })
  })

  it('does not implement subscribeEvents — the fenced forwarder buffers bodies, so SSE cannot be proxied', () => {
    const { transport } = transportWith(() => ok({}))
    expect(transport.subscribeEvents).toBeUndefined()
  })
})

describe('createMissionTransport — the three-way failure split', () => {
  it('surfaces a backend refusal as "backend", carrying its code, message and status', async () => {
    const { transport } = transportWith(() => failure(400, 'INVALID_INPUT', 'status must be one of mission.statuses'))
    const thrown = await transport.getConfig().then(() => undefined, (error: unknown) => error)
    expect(failureOf(thrown)).toEqual({
      kind: 'backend',
      code: 'INVALID_INPUT',
      message: 'status must be one of mission.statuses',
      status: 400,
    })
  })

  it('surfaces the Host’s upstream-unreachable envelope as "unreachable", not an empty board', async () => {
    const { transport } = transportWith(() => failure(502, 'UPSTREAM_UNREACHABLE', 'the backend did not answer'))
    const thrown = await transport.listMissions().then(() => undefined, (error: unknown) => error)
    expect(failureOf(thrown).kind).toBe('unreachable')
  })

  it('treats a thrown transport (network failure) as "unreachable"', async () => {
    const { transport } = transportWith(() => { throw new TypeError('Failed to fetch') })
    const thrown = await transport.getConfig().then(() => undefined, (error: unknown) => error)
    expect(failureOf(thrown)).toEqual({ kind: 'unreachable', code: undefined, message: 'Failed to fetch', status: undefined })
  })

  it('treats a non-JSON 200 answer as "malformed" rather than trusting it', async () => {
    const { transport } = transportWith(() => new Response('<html>proxy</html>', { status: 200 }))
    const thrown = await transport.getConfig().then(() => undefined, (error: unknown) => error)
    expect(failureOf(thrown).kind).toBe('malformed')
  })

  it('treats a non-JSON 502/503/504 as "unreachable" even without the JSON envelope', async () => {
    const { transport } = transportWith(() => new Response('<html>gateway timeout</html>', { status: 504 }))
    const thrown = await transport.getConfig().then(() => undefined, (error: unknown) => error)
    expect(failureOf(thrown).kind).toBe('unreachable')
  })

  it('throws "malformed" when the Host published no route for an operation key', async () => {
    const transport = createMissionTransport({ ...injectedConfig(), operations: [] }, async () => ok({}) as Response)
    const thrown = await transport.getConfig().then(() => undefined, (error: unknown) => error)
    expect(failureOf(thrown).kind).toBe('malformed')
  })
})
