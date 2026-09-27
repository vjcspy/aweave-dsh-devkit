/**
 * Forward policy: the fenced allowlist, method rejection, the upstream mapping,
 * the upstream status mapping, and the unreachable-backend answer — plus the
 * `embed.js` script route's own, deliberately different, forwarding policy.
 *
 * The policy is exercised through its own interface — request facts in, a plan or
 * a `Response` out — so no network and no Host boot are involved.
 */
import { describe, expect, it } from 'vitest'

import { CHANNEL_METHODS, EMBED_SCRIPT_UPSTREAM_PATH, FENCED_PATHS, FENCED_PREFIX } from '../../src/config.ts'
import { embedMethodNotAllowed, forwardEmbedScript } from '../../src/host/embed-route.ts'
import {
  allowHeader,
  findFencedPath,
  forwardToBackend,
  loopbackDefenceWarning,
  normalizeBaseUrl,
  planForward,
  refusalResponse,
  type ForwardPlan,
  type UpstreamCall,
  type UpstreamFetch,
} from '../../src/host/forward.ts'

/** The origin the browser half would call from; only the pathname matters to the policy. */
const ORIGIN = 'http://127.0.0.1:3080'

/** Configured backend origin, without a trailing slash. */
const BASE = 'http://127.0.0.1:3456'

/** The mission-update operation's fenced path. */
const UPDATE_PATH = `${FENCED_PREFIX}/missions/update`

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
    expect(findFencedPath('/api/other-plugin/missions')).toBeUndefined()
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

  it('maps every backend operation exactly once, each to a FIXED upstream path', () => {
    const operations = FENCED_PATHS.flatMap(entry => entry.operations.map(operation => ({
      key: operation.key,
      method: operation.method,
      upstreamMethod: operation.upstreamMethod,
      upstreamPath: operation.upstreamPath,
    })))
    expect(operations).toEqual([
      { key: 'mission-config', method: 'GET', upstreamMethod: 'GET', upstreamPath: '/missions/config' },
      { key: 'mission-list', method: 'GET', upstreamMethod: 'GET', upstreamPath: '/missions' },
      { key: 'mission-detail', method: 'GET', upstreamMethod: 'GET', upstreamPath: '/missions/detail' },
      // Unlike the deleted taskboard update route, the id rides in the BODY
      // (`POST /missions/update`'s DTO), never in the URL, so this row needs
      // no per-request path derivation.
      { key: 'mission-update', method: 'POST', upstreamMethod: 'POST', upstreamPath: '/missions/update' },
    ])
  })
})

describe('method rejection', () => {
  it('answers 405 with Allow for a path that exists but not for that verb', () => {
    expect(refusalFor(`${FENCED_PREFIX}/missions/config`, 'POST')).toEqual({
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
    const list = findFencedPath(`${FENCED_PREFIX}/missions/list`)!
    expect(allowHeader(list)).toBe('GET')
    expect(allowHeader(findFencedPath(UPDATE_PATH)!)).toBe('POST')
  })

  it('writes the 405 response with the Allow header and a JSON body', async () => {
    const decision = planForward(
      { method: 'POST', url: `${ORIGIN}${FENCED_PREFIX}/missions/config`, contentType: undefined },
      undefined,
      BASE,
    )
    if (decision.ok) throw new Error('expected a refusal')
    const response = refusalResponse(decision.refusal)
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: `POST is not implemented on ${FENCED_PREFIX}/missions/config` },
    })
  })
})

describe('upstream mapping', () => {
  it('forwards a read verb with its query string and no body', () => {
    const plan = planFor(`${FENCED_PREFIX}/missions/detail?id=resources%2Fworkspaces%2Fk%2Fdsh%2F_missions%2F__260926-probe%2FINDEX.md`, 'GET')
    expect(plan.upstreamMethod).toBe('GET')
    expect(plan.upstreamUrl).toBe(
      `${BASE}/missions/detail?id=resources%2Fworkspaces%2Fk%2Fdsh%2F_missions%2F__260926-probe%2FINDEX.md`,
    )
    expect(plan.body).toBeUndefined()
  })

  it('normalizes a configured origin that carries trailing slashes', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:3456///')).toBe('http://127.0.0.1:3456')
    expect(normalizeBaseUrl('  http://127.0.0.1:3456  ')).toBe('http://127.0.0.1:3456')
    const plan = planForward(
      { method: 'GET', url: `${ORIGIN}${FENCED_PREFIX}/missions/config`, contentType: undefined },
      undefined,
      'http://127.0.0.1:3456/',
    )
    if (!plan.ok) throw new Error('expected a plan')
    expect(plan.plan.upstreamUrl).toBe(`${BASE}/missions/config`)
  })

  it('forwards an update body byte-for-byte, id included, to the fixed upstream path', () => {
    const id = 'resources/workspaces/k/dsh/_missions/__260926-probe/INDEX.md'
    const body = JSON.stringify({ id, status: 'done', rank: 1.5 })
    const plan = planFor(UPDATE_PATH, 'POST', body, 'application/json')
    expect(plan.upstreamMethod).toBe('POST')
    expect(plan.upstreamUrl).toBe(`${BASE}/missions/update`)
    expect(plan.body).toBe(body)
    expect(plan.contentType).toBe('application/json')
  })

  it('never refuses a well-formed request with 400 — the backend, not this policy, validates the body', () => {
    // Unlike the deleted taskboard route (whose id had to be parsed out of the
    // body to build a PATCH URL), every mission operation forwards a fixed
    // path: there is nothing here for this policy to reject on shape.
    expect(planFor(UPDATE_PATH, 'POST', undefined, undefined).body).toBeUndefined()
    expect(planFor(UPDATE_PATH, 'POST', '{}', 'application/json').body).toBe('{}')
    expect(planFor(UPDATE_PATH, 'POST', 'not json', 'application/json').body).toBe('not json')
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
    const response = await forwardToBackend(planFor(`${FENCED_PREFIX}/missions/config`, 'GET'), {
      timeoutMs: 1000,
      fetch: stub.fetch,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(envelope)
    expect(stub.calls[0]!.method).toBe('GET')
    expect(stub.calls[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  it('passes an upstream error envelope and status through verbatim', async () => {
    const envelope = { success: false, error: { code: 'INVALID_INPUT', message: 'status must be one of mission.statuses' } }
    const stub = capture(new Response(JSON.stringify(envelope), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }))
    const response = await forwardToBackend(planFor(UPDATE_PATH, 'POST', '{}', 'application/json'), {
      timeoutMs: 1000,
      fetch: stub.fetch,
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(envelope)
  })

  it('answers 502 with a readable body when the backend is unreachable', async () => {
    const stub = capture(() => Promise.reject(new TypeError('fetch failed')))
    const response = await forwardToBackend(planFor(`${FENCED_PREFIX}/missions/list`, 'GET'), {
      timeoutMs: 1000,
      fetch: stub.fetch,
    })
    expect(response.status).toBe(502)
    const payload = await response.json() as { error: { code: string; message: string } }
    expect(payload.error.code).toBe('UPSTREAM_UNREACHABLE')
    // The message must name the call that failed: a Human reads it as the board's
    // "the backend is down" line, not as an empty mission list.
    expect(payload.error.message).toContain(`${BASE}/missions`)
    expect(payload.error.message).toContain('TypeError: fetch failed')
  })

  it('aborts an upstream call at the configured deadline', async () => {
    const signals: AbortSignal[] = []
    const stalling: UpstreamFetch = (_url, call) => new Promise((_resolve, reject) => {
      signals.push(call.signal)
      call.signal.addEventListener('abort', () => { reject(call.signal.reason) })
    })
    const response = await forwardToBackend(planFor(`${FENCED_PREFIX}/missions/list`, 'GET'), {
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

describe('the embed.js script route — a DIFFERENT policy from the JSON one', () => {
  it('answers 405 with Allow for a POST, plain text rather than a JSON envelope', () => {
    const response = embedMethodNotAllowed()
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(response.headers.get('content-type')).toContain('text/plain')
  })

  it('forwards the upstream script verbatim as application/javascript', async () => {
    const script = 'window.AweaveMissionBoard = { version: "0.1.0", mount() {} }'
    const response = await forwardEmbedScript(EMBED_SCRIPT_UPSTREAM_PATH, {
      baseUrl: BASE,
      timeoutMs: 1000,
      fetch: async (url) => {
        expect(url).toBe(`${BASE}${EMBED_SCRIPT_UPSTREAM_PATH}`)
        return new Response(script, { status: 200 })
      },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/javascript')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe(script)
  })

  it('answers a PLAIN-TEXT 502 when the backend is unreachable — a <script src> cannot read a JSON refusal', async () => {
    const response = await forwardEmbedScript(EMBED_SCRIPT_UPSTREAM_PATH, {
      baseUrl: BASE,
      timeoutMs: 1000,
      fetch: async () => { throw new TypeError('fetch failed') },
    })
    expect(response.status).toBe(502)
    expect(response.headers.get('content-type')).toContain('text/plain')
    const text = await response.text()
    expect(text).toContain(`${BASE}${EMBED_SCRIPT_UPSTREAM_PATH}`)
    expect(text).toContain('TypeError: fetch failed')
  })
})
