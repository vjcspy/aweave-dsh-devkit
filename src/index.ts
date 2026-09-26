/**
 * Host half: reach the Aweave taskboard backend through the admission-fenced
 * `/api` channel, and publish the resolved configuration to the served page.
 *
 * Two jobs, one lifecycle. The routes are registered on `ctx.connection.fetch`,
 * so the channel's admission — `403` for a foreign `Host`, `401` without the
 * browser cookie — runs before any route lookup. That is the fence; the
 * bind-host check is defence in depth only, and the configuration global is what
 * lets the browser half build an ABSOLUTE task path from an Aweave-root-relative
 * id.
 *
 * The backend is not ported and not duplicated: this half is transport, and the
 * Aweave NestJS backend stays the single owner of scope discovery, task parsing,
 * and the front-matter write path.
 */
import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: declares the `connection` member this module reads. The package
// ships the Host HTTP bridge; nothing of it is imported at run time.
import type {} from '@deepseek-ai/dsh-client-connection'
// Type-only: declares the `webServer` member this module reads.
import type {} from '@deepseek-ai/dsh-host-webserver'

import { CONFIG_GLOBAL, FENCED_OPERATIONS, type InjectedConfig } from './config.ts'
import { resolveAweaveRoot } from './host/aweave-root.ts'
import { loopbackDefenceWarning, normalizeBaseUrl } from './host/forward.ts'
import { registerForwardRoutes } from './host/routes.ts'
import type { Config } from './schema.ts'

export { Config } from './schema.ts'

/** Cordis function-plugin name. */
export const name = 'aweave-dsh-devkit'

/**
 * Services this plugin reads, and nothing else.
 *
 * Both must be declared: a service named here that never resolves leaves the
 * plugin silently PENDING with no log line, and a service read without being
 * declared is refused by the context proxy. `connection` is the fence and the
 * route carrier; `webServer` is read for its resolved bind host, which the
 * defence-in-depth check reports on.
 */
export const inject = ['connection', 'webServer']

/**
 * Register the fenced routes and publish the resolved configuration.
 * @param ctx - Host context owning the `connection` and `webServer` services.
 * @param config - validated live configuration resolved by the Loader.
 */
export function apply(ctx: Context, config: Config): void {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const root = resolveAweaveRoot(config.aweaveRoot, { cwd: process.cwd(), markerExists: existsSync })
  if (root.source === 'unresolved') {
    // Warning, not a refusal: every board operation still works, and only
    // opening a task needs the root. The browser half degrades readably instead
    // of opening the wrong file.
    ctx.logger.warn(
      `aweave-dsh-devkit: no Aweave platform root — ${root.reason}. `
      + 'Task ids are Aweave-root-relative, so opening a task needs the root; set Config.aweaveRoot to the platform root '
      + 'in the profile patch, or root the Session inside the platform.',
    )
  }
  const defence = loopbackDefenceWarning(ctx.webServer.host)
  if (defence !== undefined) ctx.logger.warn(defence)

  const injected: InjectedConfig = {
    baseUrl,
    requestTimeoutMs: config.requestTimeoutMs,
    aweaveRoot: root.source === 'unresolved' ? null : root.root,
    operations: FENCED_OPERATIONS,
  }
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: CONFIG_GLOBAL, value: injected })
  })

  registerForwardRoutes(ctx, { baseUrl, timeoutMs: config.requestTimeoutMs })
}
