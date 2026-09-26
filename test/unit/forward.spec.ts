/**
 * Forward policy: the fenced allowlist, method rejection, the upstream mapping,
 * the upstream status mapping, and the unreachable-backend answer.
 *
 * The policy is exercised through its own interface — request facts in, a plan or
 * a `Response` out — so no network and no Host boot are involved.
 */
import { describe, expect, it } from 'vitest'

import { CHANNEL_METHODS, FENCED_PATHS, FENCED_PREFIX } from '../../src/config.ts'
import {
  allowHeader,
  findFencedPath,
  forwardToBackend,
  loopbackDefenceWarning,
  normalizeBaseUrl,
  planForward,
  refusalResponse,
  taskIdFromBody,
  type ForwardPlan,
  type UpstreamCall,
  type UpstreamFetch,
} from '../../src/host/forward.ts'

/** The origin the browser half would call from; only the pathname matters to the policy. */
const ORIGIN = 'http://127.0.0.1:3080'

/** Configured backend origin, without a trailing slash. */
const BASE = 'http://127.0.0.1:3456'

/** The update operation's fenced path. */
const UPDATE_PATH = `${FENCED_PREFIX}/tasks/update`

/**
 * Plan one request, failing the test when the policy refuses it.
 * @param path - fenced pathname.
 * @param method - request method.
 * @param body - request body text.
 * @param contentType - media type the caller sent.
 * @returns the resolved plan.
 */
function planFor(path: string, method: string, body?: string, contentType?: string): ForwardPlan {
  const decision = planForward(
    { method, url: `${ORIGIN}${path}`, contentType },
    body,
    BASE,
  )
  if (!decision.ok) throw new Error(`expected a plan, refused with ${decision.refusal.status}`)
  return decision.plan
}

/**
 * Resolve a refusal, failing the test when the policy planned the request.
 * @param path - fenced pathname.
 * @param method - request method.
 * @param body - request body text.
 * @returns the refusal.
 */
function refusalFor(path: string, method: string, body?: string): { status: number; allow?: string; code: string } {
  const decision = planForward({ method, url: `${ORIGIN}${path}`, contentType: undefined }, body, BASE)
  if (decision.ok) throw new Error(`expected a refusal, planned ${decision.plan.upstreamUrl}`)
  return {
    status: decision.refusal.status,
    ...(decision.refusal.allow === undefined ? {} : { allow: decision.refusal.allow }),
    code: decision.refusal.payload.error.code,
  }
}

describe('fenced allowlist', () => {
  it('answers exactly the registered paths and nothing else', () => {
    for (const entry of FENCED_PATHS) expect(findFencedPath(entry.path)).toBe(entry)
    expect(findFencedPath(`${FENCED_PREFIX}/__absent`)).toBeUndefined()
    expect(findFencedPath('/api/other-plugin/tasks')).toBeUndefined()
    expect(findFencedPath('/dsh-debate/models')).toBeUndefined()
  })

  it('declares paths the shared /api channel can mount', () => {
    // The channel resolves an exact route with `endpointFromPath('/api', path)`,
    // which rejects an empty, dot, or non-segment-safe segment; a path that fails
    // it throws at registration, so it is asserted here rather than at boot.
    const segment = /^[A-Za-z0-9_$.-]+$/
    const paths = new Set<string>()
    for (const entry of FENCED_PATHS) {
      expect(entry.path.startsWith('/api/')).toBe(true)
      const segments = entry.path.slice('/api/'.length).split('/')
      expect(segments.every(part => part !== '' && part !== '.' && part !== '..' && segment.test(part))).toBe(true)
      expect(paths.has(entry.path)).toBe(false)
      paths.add(entry.path)
      expect(entry.operations.length).toBeGreaterThan(0)
      for (const operation of entry.operations) expect(CHANNEL_METHODS).toContain(operation.method)
    }
    expect(CHANNEL_METHODS.length).toBeGreaterThan(0)
    expect(new Set(CHANNEL_METHODS).size).toBe(CHANNEL_METHODS.length)
  })

  it('maps every backend operation exactly once', () => {
    const operations = FENCED_PATHS.flatMap(entry => entry.operations.map(operation => ({
      key: operation.key,
      method: operation.method,
      upstreamMethod: operation.upstreamMethod,
      upstreamPath: operation.upstreamPath,
    })))
    expect(operations).toEqual([
      { key: 'scopes', method: 'GET', upstreamMethod: 'GET', upstreamPath: '/taskboard/scopes' },
      { key: 'config', method: 'GET', upstreamMethod: 'GET', upstreamPath: '/taskboard/config' },
      { key: 'list-tasks', method: 'GET', upstreamMethod: 'GET', upstreamPath: '/taskboard/tasks' },
      { key: 'create-task', method: 'POST', upstreamMethod: 'POST', upstreamPath: '/taskboard/tasks' },
      // The id rides in the body: an Aweave-root-relative task path contains `/`
      // and cannot be an exact-route segment.
      { key: 'update-task', method: 'POST', upstreamMethod: 'PATCH', upstreamPath: undefined },
    ])
  })
})

describe('method rejection', () => {
  it('answers 405 with Allow for a path that exists but not for that verb', () => {
    expect(refusalFor(`${FENCED_PREFIX}/scopes`, 'POST')).toEqual({
      status: 405,
      allow: 'GET',
      code: 'METHOD_NOT_ALLOWED',
    })
    expect(refusalFor(UPDATE_PATH, 'GET')).toEqual({
      status: 405,
      allow: 'POST',
      code: 'METHOD_NOT_ALLOWED',
    })
  })

  it('answers 404 for a path nothing registered', () => {
    expect(refusalFor(`${FENCED_PREFIX}/__absent`, 'GET')).toEqual({
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('lists every method a fenced path implements', () => {
    const tasks = findFencedPath(`${FENCED_PREFIX}/tasks`)!
    expect(allowHeader(tasks)).toBe('GET, POST')
    expect(allowHeader(findFencedPath(`${FENCED_PREFIX}/config`)!)).toBe('GET')
  })

  it('writes the 405 response with the Allow header and a JSON body', async () => {
    const decision = planForward(
      { method: 'POST', url: `${ORIGIN}${FENCED_PREFIX}/scopes`, contentType: undefined },
      undefined,
      BASE,
    )
    if (decision.ok) throw new Error('expected a refusal')
    const response = refusalResponse(decision.refusal)
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: `POST is not implemented on ${FENCED_PREFIX}/scopes` },
    })
  })
})

describe('upstream mapping', () => {
  it('forwards a read verb with its query string and no body', () => {
    const plan = planFor(`${FENCED_PREFIX}/tasks?scopes=devtools/common&status=todo`, 'GET')
    expect(plan.upstreamMethod).toBe('GET')
    expect(plan.upstreamUrl).toBe(`${BASE}/taskboard/tasks?scopes=devtools/common&status=todo`)
    expect(plan.body).toBeUndefined()
  })

  it('normalizes a configured origin that carries trailing slashes', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:3456///')).toBe('http://127.0.0.1:3456')
    expect(normalizeBaseUrl('  http://127.0.0.1:3456  ')).toBe('http://127.0.0.1:3456')
    const plan = planForward(
      { method: 'GET', url: `${ORIGIN}${FENCED_PREFIX}/config`, contentType: undefined },
      undefined,
      'http://127.0.0.1:3456/',
    )
    if (!plan.ok) throw new Error('expected a plan')
    expect(plan.plan.upstreamUrl).toBe(`${BASE}/taskboard/config`)
  })

  it('forwards a create body byte-for-byte', () => {
    const body = JSON.stringify({ scope: 'devtools/common', name: 'Probe' })
    const plan = planFor(`${FENCED_PREFIX}/tasks`, 'POST', body, 'application/json')
    expect(plan.upstreamMethod).toBe('POST')
    expect(plan.upstreamUrl).toBe(`${BASE}/taskboard/tasks`)
    expect(plan.body).toBe(body)
    expect(plan.contentType).toBe('application/json')
  })

  it('turns an update request into PATCH .../tasks/<encoded id> and strips the id', () => {
    const id = 'resources/workspaces/k/dsh/_tasks/260926-probe.md'
    const plan = planFor(
      UPDATE_PATH,
      'POST',
      JSON.stringify({ id, status: 'done', rank: 1.5 }),
      'application/json',
    )
    expect(plan.upstreamMethod).toBe('PATCH')
    expect(plan.upstreamUrl).toBe(`${BASE}/taskboard/tasks/${encodeURIComponent(id)}`)
    // `forbidNonWhitelisted` on that route makes an extra `id` a 400, so the
    // forwarded payload must not carry it.
    expect(JSON.parse(plan.body!)).toEqual({ status: 'done', rank: 1.5 })
  })

  it('refuses an update whose body names no task', () => {
    expect(refusalFor(UPDATE_PATH, 'POST', undefined)).toEqual({ status: 400, code: 'INVALID_INPUT' })
    expect(refusalFor(UPDATE_PATH, 'POST', '{}')).toEqual({ status: 400, code: 'INVALID_INPUT' })
    expect(refusalFor(UPDATE_PATH, 'POST', 'not json')).toEqual({ status: 400, code: 'INVALID_INPUT' })
    expect(refusalFor(UPDATE_PATH, 'POST', JSON.stringify({ id: '', status: 'done' }))).toEqual({
      status: 400,
      code: 'INVALID_INPUT',
    })
    expect(refusalFor(UPDATE_PATH, 'POST', JSON.stringify({ id: 7 }))).toEqual({
      status: 400,
      code: 'INVALID_INPUT',
    })
  })

  it('reads a task id only from a JSON object with a non-empty string id', () => {
    expect(taskIdFromBody(JSON.stringify({ id: 'a/b.md' }))).toBe('a/b.md')
    expect(taskIdFromBody(undefined)).toBeUndefined()
    expect(taskIdFromBody('')).toBeUndefined()
    expect(taskIdFromBody('[]')).toBeUndefined()
    expect(taskIdFromBody(JSON.stringify({ id: null }))).toBeUndefined()
  })
})

describe('upstream status mapping', () => {
  /** Capture the calls one forward makes, and answer with a fixed upstream response. */
  function capture(response: Response | (() => Promise<Response>)): { calls: UpstreamCall[]; urls: string[]; fetch: UpstreamFetch } {
    const calls: UpstreamCall[] = []
    const urls: string[] = []
    return {
      calls,
      urls,
      fetch: async (url, call) => {
        urls.push(url)
        calls.push(call)
        return typeof response === 'function' ? await response() : response
      },
    }
  }

  it('passes an upstream success envelope through verbatim', async () => {
    const envelope = { success: true, data: { statuses: [{ id: 'todo', label: 'To Do', color: '#ccc' }] } }
    const upstream = new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
    const stub = capture(upstream)
    const response = await forwardToBackend(planFor(`${FENCED_PREFIX}/config`, 'GET'), {
      timeoutMs: 1000,
      fetch: stub.fetch,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(envelope)
    expect(stub.calls[0]!.method).toBe('GET')
    expect(stub.calls[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  it('passes an upstream error envelope and status through verbatim', async () => {
    const envelope = { success: false, error: { code: 'INVALID_INPUT', message: 'scope must not be empty' } }
    const stub = capture(new Response(JSON.stringify(envelope), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }))
    const response = await forwardToBackend(planFor(`${FENCED_PREFIX}/tasks`, 'POST', '{}', 'application/json'), {
      timeoutMs: 1000,
      fetch: stub.fetch,
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(envelope)
  })

  it('answers 502 with a readable body when the backend is unreachable', async () => {
    const stub = capture(() => Promise.reject(new TypeError('fetch failed')))
    const response = await forwardToBackend(planFor(`${FENCED_PREFIX}/scopes`, 'GET'), {
      timeoutMs: 1000,
      fetch: stub.fetch,
    })
    expect(response.status).toBe(502)
    const payload = await response.json() as { error: { code: string; message: string } }
    expect(payload.error.code).toBe('UPSTREAM_UNREACHABLE')
    // The message must name the call that failed: a Human reads it as the board's
    // "the backend is down" line, not as a task-list result.
    expect(payload.error.message).toContain(`${BASE}/taskboard/scopes`)
    expect(payload.error.message).toContain('TypeError: fetch failed')
  })

  it('aborts an upstream call at the configured deadline', async () => {
    const signals: AbortSignal[] = []
    const stalling: UpstreamFetch = (_url, call) => new Promise((_resolve, reject) => {
      signals.push(call.signal)
      call.signal.addEventListener('abort', () => { reject(call.signal.reason) })
    })
    const response = await forwardToBackend(planFor(`${FENCED_PREFIX}/scopes`, 'GET'), {
      timeoutMs: 20,
      fetch: stalling,
    })
    expect(response.status).toBe(502)
    expect(signals[0]!.aborted).toBe(true)
  })
})

describe('bind-host defence in depth', () => {
  it('reports nothing when the host is loopback', () => {
    expect(loopbackDefenceWarning('127.0.0.1')).toBeUndefined()
  })

  it('names admission as the fence when the host is not loopback', () => {
    const warning = loopbackDefenceWarning('0.0.0.0')!
    expect(warning).toContain('0.0.0.0')
    expect(warning).toContain('/api')
    expect(warning).toContain('defence in depth')
  })
})
