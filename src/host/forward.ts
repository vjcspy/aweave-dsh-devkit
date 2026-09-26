/**
 * The fenced route's policy: path allowlist, upstream URL and method mapping,
 * the upstream call, and the status mapping a caller sees.
 *
 * Everything here is pure, or takes the upstream call as a parameter, so the
 * whole policy is testable without a network: {@link planForward} decides from
 * request facts alone, and {@link forwardToBackend} uses the `fetch` it is given.
 *
 * Three mappings are explicit rather than inherited from the channel:
 * - an unreachable backend is `502` with a machine-readable body, never a `200`
 *   carrying nothing, because a Human reading an empty board would take it for
 *   "no tasks";
 * - a method the fenced path does not implement is `405` with `Allow`, not the
 *   channel's `404`, because the path exists and only the verb is wrong;
 * - every upstream status and body is passed through verbatim, so the backend's
 *   own error codes (`INVALID_INPUT`, `FORBIDDEN`, `NOT_FOUND`,
 *   `ACTION_NOT_ALLOWED`) reach the caller unaltered.
 */
import {
  FENCED_PATHS,
  LOOPBACK_HOST,
  type FencedOperation,
  type FencedPath,
  type UpstreamMethod,
} from '../config.ts'

/** Upstream path of the task collection, whose `:id` segment is appended per request. */
const TASKS_PATH = '/taskboard/tasks'

/** The request facts this policy reads. */
export interface ForwardRequest {
  /** Request method, as the channel dispatched it. */
  readonly method: string
  /** Full request URL; its query string is forwarded verbatim. */
  readonly url: string
  /** Media type the caller sent, or `undefined` when it sent none. */
  readonly contentType: string | undefined
}

/** One operation resolved from a request, ready to forward. */
export interface ForwardPlan {
  /** Fenced path that owns the request. */
  readonly path: FencedPath
  /** Operation the request's method selects. */
  readonly operation: FencedOperation
  /** Absolute upstream URL, query string included. */
  readonly upstreamUrl: string
  /** Method forwarded upstream. */
  readonly upstreamMethod: UpstreamMethod
  /** Body forwarded upstream; `undefined` for a bodyless method. */
  readonly body: string | undefined
  /** Content type forwarded upstream. */
  readonly contentType: string | undefined
}

/** Machine-readable refusal body, shaped like the backend's own error envelope. */
export interface RefusalPayload {
  readonly success: false
  readonly error: { readonly code: string; readonly message: string }
}

/** A request refused before any upstream call. */
export interface ForwardRefusal {
  /** HTTP status to answer with. */
  readonly status: number
  /** `Allow` header value; present only on a `405`. */
  readonly allow?: string
  readonly payload: RefusalPayload
}

/** What a request resolves to: an upstream call, or a refusal. */
export type ForwardDecision =
  | { readonly ok: true; readonly plan: ForwardPlan }
  | { readonly ok: false; readonly refusal: ForwardRefusal }

/** One upstream call, as the policy issues it. */
export interface UpstreamCall {
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  /** Body text; `undefined` for a bodyless method. */
  readonly body: string | undefined
  readonly signal: AbortSignal
}

/** Upstream transport; a parameter so the mapping is testable without a network. */
export type UpstreamFetch = (url: string, call: UpstreamCall) => Promise<Response>

/** Facts one forward needs beyond the plan. */
export interface ForwardOptions {
  /** Upstream deadline, in milliseconds. */
  readonly timeoutMs: number
  /** Upstream transport. */
  readonly fetch: UpstreamFetch
}

/** The upstream request one fenced request becomes. */
interface UpstreamRequest {
  /** Upstream pathname, already carrying any derived id. */
  readonly path: string
  /** Body to send; `undefined` when the method carries none. */
  readonly body: string | undefined
  /** Media type to send. */
  readonly contentType: string | undefined
}

/**
 * Resolve the fenced path that owns a pathname.
 * @param pathname - request pathname.
 * @returns the fenced path, or `undefined` when nothing at this plugin's prefix owns it.
 */
export function findFencedPath(pathname: string): FencedPath | undefined {
  return FENCED_PATHS.find(entry => entry.path === pathname)
}

/**
 * The `Allow` header value for a fenced path.
 * @param entry - fenced path.
 * @returns the methods its operations implement, in table order.
 */
export function allowHeader(entry: FencedPath): string {
  return entry.operations.map(operation => operation.method).join(', ')
}

/**
 * Strip the trailing slashes from a configured backend origin.
 * @param baseUrl - configured origin.
 * @returns the origin without a trailing slash, so a derived path is appended once.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * Report whether the bind-host check is satisfied.
 *
 * The check is defence in depth and is deliberately not a refusal. The fence
 * that actually gates a fenced path is the shared `/api` channel's admission,
 * which runs before any route lookup and never reads the bind host; refusing to
 * register on a non-loopback bind would remove remote reachability — the reason
 * this proxy exists — without adding any protection the channel does not already
 * provide. The returned text states both facts so the log cannot be misread as
 * "this route is fenced by its bind address".
 * @param host - resolved `webServer` bind host.
 * @returns the warning to log, or `undefined` when the bind host is loopback.
 */
export function loopbackDefenceWarning(host: string): string | undefined {
  if (host === LOOPBACK_HOST) return undefined
  return `aweave-dsh-devkit: webServer is bound to "${host}", not "${LOOPBACK_HOST}". `
    + 'The fenced routes stay registered: admission on the shared /api channel (403 for a foreign Host, 401 without the '
    + 'browser cookie) is the fence, and it is independent of the bind host. The bind-host check is defence in depth only '
    + 'and cannot substitute for admission.'
}

/**
 * Read the task id an update request names.
 *
 * The id is an Aweave-root-relative markdown path, so it arrives in the body: the
 * channel takes exact paths and cannot carry a value containing `/` as a segment.
 * @param rawBody - request body text.
 * @returns the id, or `undefined` when the body is not a JSON object with a non-empty string `id`.
 */
export function taskIdFromBody(rawBody: string | undefined): string | undefined {
  const parsed = parseJsonObject(rawBody)
  if (parsed === undefined) return undefined
  const id = parsed.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * Parse a request body into a JSON object.
 * @param rawBody - request body text.
 * @returns the parsed object, or `undefined` when the text is absent, unparseable, or not an object.
 */
function parseJsonObject(rawBody: string | undefined): Record<string, unknown> | undefined {
  if (rawBody === undefined || rawBody === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    // Swallows the parse error: a non-JSON body is exactly the undefined case.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}

/**
 * Build the upstream request for one operation.
 *
 * The update route is the one operation whose forwarded body differs from the
 * received one. `id` selects the upstream path and is not part of the backend's
 * update payload: that route's validation pipe runs `whitelist: true` with
 * `forbidNonWhitelisted: true`, so forwarding `id` upstream would make every
 * update fail with `INVALID_INPUT`. Every other operation forwards its body
 * byte-for-byte.
 * @param operation - operation being forwarded.
 * @param rawBody - request body text.
 * @param contentType - media type the caller sent.
 * @returns the upstream request, or `undefined` when the route needs an id the body does not carry.
 */
function upstreamRequestFor(
  operation: FencedOperation,
  rawBody: string | undefined,
  contentType: string | undefined,
): UpstreamRequest | undefined {
  if (operation.upstreamPath !== undefined) {
    return { path: operation.upstreamPath, body: rawBody, contentType }
  }
  const id = taskIdFromBody(rawBody)
  const parsed = parseJsonObject(rawBody)
  if (id === undefined || parsed === undefined) return undefined
  const payload: Record<string, unknown> = { ...parsed }
  delete payload.id
  return {
    path: `${TASKS_PATH}/${encodeURIComponent(id)}`,
    body: JSON.stringify(payload),
    contentType: 'application/json; charset=utf-8',
  }
}

/**
 * Decide what one request does: which backend operation it reaches, or why it is refused.
 * @param request - the request facts the policy reads.
 * @param rawBody - request body text, or `undefined` when the carrier supplied none.
 * @param baseUrl - configured backend origin.
 * @returns the forward plan, or the refusal to answer with.
 */
export function planForward(
  request: ForwardRequest,
  rawBody: string | undefined,
  baseUrl: string,
): ForwardDecision {
  const url = new URL(request.url)
  const entry = findFencedPath(url.pathname)
  if (entry === undefined) {
    return {
      ok: false,
      refusal: {
        status: 404,
        payload: { success: false, error: { code: 'NOT_FOUND', message: `no fenced route for ${url.pathname}` } },
      },
    }
  }
  const operation = entry.operations.find(candidate => candidate.method === request.method)
  if (operation === undefined) {
    return {
      ok: false,
      refusal: {
        status: 405,
        allow: allowHeader(entry),
        payload: {
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: `${request.method} is not implemented on ${entry.path}` },
        },
      },
    }
  }
  const upstream = upstreamRequestFor(operation, rawBody, request.contentType)
  if (upstream === undefined) {
    return {
      ok: false,
      refusal: {
        status: 400,
        payload: {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: `${entry.path} needs a JSON body with a non-empty string "id" naming the task`,
          },
        },
      },
    }
  }
  const bodyless = request.method === 'GET' || request.method === 'HEAD'
  return {
    ok: true,
    plan: {
      path: entry,
      operation,
      upstreamUrl: `${normalizeBaseUrl(baseUrl)}${upstream.path}${url.search}`,
      upstreamMethod: operation.upstreamMethod,
      body: bodyless ? undefined : upstream.body,
      contentType: upstream.contentType,
    },
  }
}

/**
 * Answer a refusal.
 * @param refusal - the refusal {@link planForward} resolved.
 * @returns the response to write, with `Allow` present exactly on a `405`.
 */
export function refusalResponse(refusal: ForwardRefusal): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }
  if (refusal.allow !== undefined) headers.allow = refusal.allow
  return new Response(JSON.stringify(refusal.payload), { status: refusal.status, headers })
}

/**
 * Call the backend and map the outcome onto a response.
 * @param plan - the forward plan.
 * @param options - upstream deadline and transport.
 * @returns the upstream status and body passed through, or a `502` naming the failure.
 */
export async function forwardToBackend(plan: ForwardPlan, options: ForwardOptions): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (plan.contentType !== undefined) headers['content-type'] = plan.contentType
  else if (plan.body !== undefined) headers['content-type'] = 'application/json'
  try {
    const upstream = await options.fetch(plan.upstreamUrl, {
      method: plan.upstreamMethod,
      headers,
      body: plan.body,
      signal: AbortSignal.timeout(options.timeoutMs),
    })
    const text = await upstream.text()
    return new Response(text, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch (error: unknown) {
    return jsonResponse(502, {
      success: false,
      error: {
        code: 'UPSTREAM_UNREACHABLE',
        message: `the Aweave taskboard backend did not answer ${plan.upstreamMethod} ${plan.upstreamUrl}: ${describe(error)}`,
      },
    })
  }
}

/**
 * Describe a thrown value without assuming it is an `Error`.
 * @param error - the caught value.
 * @returns the value's name and message, or its string form.
 */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/**
 * Build a JSON response.
 * @param status - HTTP status.
 * @param payload - value to serialize.
 * @returns the response to write.
 */
function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
