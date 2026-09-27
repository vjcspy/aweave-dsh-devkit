/**
 * The `embed.js` script route: a Fetch route the browser half loads with a
 * plain `<script src="...">` tag, forwarded to the Aweave backend's static
 * `GET /mission-board/embed.js`.
 *
 * Deliberately NOT routed through `host/forward.ts`'s `planForward`/
 * `forwardToBackend` pair: those exist to carry the JSON `{ success, data |
 * error }` envelope, but a `<script>` tag sends no `accept:
 * application/json` header and cannot parse a JSON body as a refusal — it
 * either executes the response as JavaScript or fails silently. This route
 * therefore:
 * - answers `content-type: application/javascript; charset=utf-8` on success,
 *   passing the upstream body through verbatim;
 * - answers a PLAIN-TEXT `502` (not a JSON envelope) when the upstream call
 *   fails, so at least a Human inspecting the network tab can read why;
 * - is registered for `GET` only; a `POST` on this path answers `405` with
 *   `Allow: GET`, mirroring the JSON routes' own unimplemented-verb mapping
 *   (`README.md`'s "declares every verb, 405s the rest" convention) rather
 *   than the channel's blanket `404`.
 * - answers `cache-control: no-store`, matching every other fenced response —
 *   `embed.js` is served fresh on every load so the board's own code always
 *   matches its API, never a browser-cached mismatch.
 *
 * The body is still fully BUFFERED (`upstream.text()`), same as the JSON
 * routes: the channel's forwarder gives no streaming primitive, so this is a
 * complete-response proxy, not a passthrough stream. `embed.js` is small
 * enough (~400 kB) that this is a non-issue for a script load, unlike the SSE
 * stream this plugin deliberately does not proxy (`README.md`'s "no live
 * push in v1" note).
 */
import { normalizeBaseUrl, describe, type UpstreamFetch } from './forward.ts'

/** Facts one `embed.js` forward needs. */
export interface EmbedForwardOptions {
  /** Configured backend origin. */
  readonly baseUrl: string
  /** Upstream deadline, in milliseconds. */
  readonly timeoutMs: number
  /** Upstream transport. */
  readonly fetch: UpstreamFetch
}

/**
 * Forward one `GET embed.js` request to the backend.
 * @param upstreamPath - upstream pathname (`config.ts`'s `EMBED_SCRIPT_UPSTREAM_PATH`).
 * @param options - backend origin, deadline and transport.
 * @returns the upstream script verbatim, or a plain-text `502`.
 */
export async function forwardEmbedScript(upstreamPath: string, options: EmbedForwardOptions): Promise<Response> {
  const upstreamUrl = `${normalizeBaseUrl(options.baseUrl)}${upstreamPath}`
  try {
    const upstream = await options.fetch(upstreamUrl, {
      method: 'GET',
      headers: {},
      body: undefined,
      signal: AbortSignal.timeout(options.timeoutMs),
    })
    const text = await upstream.text()
    return new Response(text, {
      status: upstream.status,
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch (error: unknown) {
    return new Response(
      `aweave-dsh-devkit: the Aweave mission-board embed script was unreachable at ${upstreamUrl}: ${describe(error)}`,
      { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } },
    )
  }
}

/**
 * Answer a `405` for a method this route does not implement.
 * @returns the plain-text refusal.
 */
export function embedMethodNotAllowed(): Response {
  return new Response('aweave-dsh-devkit: only GET is implemented on the mission-board embed script route', {
    status: 405,
    headers: { allow: 'GET', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}
