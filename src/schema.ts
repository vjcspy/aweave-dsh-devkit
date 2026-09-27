/**
 * Host-only configuration schema.
 *
 * Kept apart from `./config.ts` so the browser bundle never pulls schemastery — a
 * Host library with no business in the page — through the shared module.
 *
 * The Loader validates the bundle patch's `config` row with this schema before
 * the plugin applies, so an out-of-range or malformed deployment value fails at
 * load instead of degrading a request at run time.
 */
import z from '@deepseek-ai/schemastery'

import {
  DEFAULT_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS_MAX,
  REQUEST_TIMEOUT_MS_MIN,
} from './config.ts'

/** Host configuration for the plugin, as the Loader resolves it. */
export interface Config {
  /** Aweave mission-board backend origin, without a trailing slash. */
  baseUrl: string
  /** Upstream deadline per forwarded request, in milliseconds. */
  requestTimeoutMs: number
  /**
   * Absolute Aweave platform root, or the empty string to derive it.
   *
   * A deployment whose Session is not rooted inside the platform must set this;
   * the bundle patch deliberately ships no absolute path, because the path is a
   * property of one machine and every tracked file must stay machine-independent.
   */
  aweaveRoot: string
}

/**
 * `requestTimeoutMs` schema: a positive whole-millisecond deadline.
 *
 * The step is the finite guard. `min`/`max` compare with `<`/`>`, which both
 * report false for `NaN`, so a bare range check would resolve `NaN` instead of
 * rejecting it.
 */
const timeoutMs = (): z<number> => z
  .number()
  .step(1)
  .min(REQUEST_TIMEOUT_MS_MIN)
  .max(REQUEST_TIMEOUT_MS_MAX)
  .default(DEFAULT_REQUEST_TIMEOUT_MS)

/** Plugin configuration: the backend origin, the upstream deadline, and the Aweave root. */
export const Config: z<Config> = z.object({
  baseUrl: z.string().pattern(/^https?:\/\/\S+$/).default(DEFAULT_BASE_URL),
  requestTimeoutMs: timeoutMs(),
  aweaveRoot: z.string().default(''),
})
