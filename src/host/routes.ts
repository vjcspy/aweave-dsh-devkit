/**
 * Registration of the fenced routes on the shared `/api` channel.
 *
 * The channel — not this plugin — owns admission: `connection.admit` runs in the
 * `/api` prefix handler before any route lookup, so a foreign `Host` is refused
 * with `403` and a request without the browser cookie with `401`, whether or not
 * the fenced path exists. Registering through
 * `ctx.connection.fetch.register` is therefore what fences the write surface; a
 * raw `ctx.webServer.register` route would receive no admission at all and would
 * publish that surface through the deployment's tunnel.
 *
 * Each registration is an effect of this context, so plugin teardown removes the
 * routes even on a hot unload.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'

import { CHANNEL_METHODS, FENCED_PATHS } from '../config.ts'
import { forwardToBackend, planForward, refusalResponse, type UpstreamFetch } from './forward.ts'

/** Host-configurable facts one registration needs. */
export interface ForwardRouteOptions {
  /** Backend origin every fenced path forwards to. */
  readonly baseUrl: string
  /** Upstream deadline per forwarded request, in milliseconds. */
  readonly timeoutMs: number
}

/** Upstream transport: the host's global `fetch`, with the Node `Response` it returns. */
const upstreamFetch: UpstreamFetch = async (url, call) => {
  const init: RequestInit = { method: call.method, headers: { ...call.headers }, signal: call.signal }
  if (call.body !== undefined) init.body = call.body
  return await fetch(url, init)
}

/**
 * Register one exact Fetch route per fenced path, owned by this context.
 * @param ctx - Host context owning the `connection` service.
 * @param options - the backend origin and the upstream deadline.
 */
export function registerForwardRoutes(ctx: Context, options: ForwardRouteOptions): void {
  for (const entry of FENCED_PATHS) {
    const route: ConnectionFetchRoute = {
      path: entry.path,
      methods: CHANNEL_METHODS,
      requestBody: 'buffered',
      fetch: async (request) => {
        const bodyless = request.method === 'GET' || request.method === 'HEAD'
        const rawBody = bodyless ? undefined : await request.text()
        const decision = planForward({
          method: request.method,
          url: request.url,
          contentType: request.headers.get('content-type') ?? undefined,
        }, rawBody, options.baseUrl)
        if (!decision.ok) return refusalResponse(decision.refusal)
        return await forwardToBackend(decision.plan, { timeoutMs: options.timeoutMs, fetch: upstreamFetch })
      },
    }
    ctx.effect(() => {
      // `register` already owns the route on this context's fiber; the extra
      // effect states that ownership where the channel's own teardown runs, so a
      // plugin unload cannot leave a route behind.
      const dispose = ctx.connection.fetch.register(route)
      return () => { void dispose() }
    }, `aweave-dsh-devkit: ${entry.path}`)
  }
}
