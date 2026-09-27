/**
 * Constants and the fenced route table shared by the Host half and the browser half.
 *
 * This module is deliberately dependency-free: the browser bundle imports it, so
 * anything added here ships to the page. The Host-only schema that validates
 * operator configuration lives in `./schema.ts` and builds on these bounds.
 *
 * The route table has ONE home, here, because both halves read it: the Host
 * registers a route per fenced path and forwards it to the backend, and the
 * browser half ADDRESSES each operation by its `key` from the table the Host
 * published at index render. Two tables would drift.
 *
 * This plugin now fronts the Aweave `@hod/aweave-mission-server` backend
 * instead of the deleted taskboard one (`_tasks/` → `_missions/`); the four
 * JSON operations below mirror `@hod/aweave-mission-web`'s
 * `MissionTransport` one-for-one, and a fifth, non-JSON route serves the
 * mission board's `embed.js` script — see `EMBED_SCRIPT_PATH`.
 */

/** Package id: the loader registration id, the tab kind's implementation id, and the body's slot key. */
export const PLUGIN_ID = 'aweave-dsh-devkit'

/** Right-sidebar tab kind this plugin owns. */
export const TAB_KIND = 'aweave-mission-board'

/** Guide-page entry identity contributed by the tab kind; unique within this provider. */
export const GUIDE_ENTRY_ID = 'aweave-mission-board'

/** Ascending position of the guide entry among every registered type's entries. */
export const GUIDE_ENTRY_ORDER = 40

/** Locale namespace owning every product-visible string this plugin renders. */
export const LOCALE_NAMESPACE = 'aweaveMissionBoard'

/** Browser global carrying the resolved Host configuration, injected through `webserver/index-inject`. */
export const CONFIG_GLOBAL = '__AWEAWE_DSH_DEVKIT_CONFIG__'

/** Route prefix below `/api`; every path this plugin registers sits under it. */
export const FENCED_PREFIX = '/api/aweave-dsh-devkit'

/**
 * The only bind host on which the bind-host check counts as satisfied.
 *
 * The check is defence in depth: the fence that actually gates every fenced path
 * is the shared `/api` channel's admission (`403` foreign `Host`, `401` without
 * the browser cookie), which runs before any route lookup and is independent of
 * the bind host.
 */
export const LOOPBACK_HOST = '127.0.0.1'

/** Aweave platform root marker, relative to the platform root. */
export const AWEAWE_ROOT_MARKER = 'workspaces/devtools/common/server/package.json'

/** Aweave mission backend origin applied when configuration names none. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:3456'

/** Upstream deadline applied when configuration names none, in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 8000

/** Shortest accepted upstream deadline, in milliseconds. */
export const REQUEST_TIMEOUT_MS_MIN = 100

/** Longest accepted upstream deadline, in milliseconds. */
export const REQUEST_TIMEOUT_MS_MAX = 600_000

/** HTTP methods the shared `/api` channel can dispatch to an exact Fetch route. */
export type FencedMethod = 'GET' | 'HEAD' | 'POST'

/**
 * Methods registered on every fenced path.
 *
 * The channel matches a pathname first and a method second, so both channel
 * verbs are declared on each path: the handler then answers the verb it does not
 * implement with `405` plus `Allow`, instead of the channel's blanket `404`,
 * which would claim the path does not exist.
 */
export const CHANNEL_METHODS: readonly FencedMethod[] = ['GET', 'POST']

/** HTTP method one operation forwards with upstream. */
export type UpstreamMethod = 'GET' | 'POST'

/**
 * One backend operation reachable through the fence.
 *
 * Every mission operation forwards to a FIXED upstream path (unlike the
 * deleted taskboard update route, whose id rode in a `PATCH .../tasks/:id`
 * URL segment): `POST /missions/update`'s DTO takes `id` as a body field, so
 * the body is forwarded byte-for-byte and no path derivation is needed.
 */
export interface FencedOperation {
  /** Stable identity, used by the browser half to address this operation. */
  readonly key: string
  /** Method the browser uses on the fenced path to reach this operation. */
  readonly method: FencedMethod
  /** Method forwarded upstream. */
  readonly upstreamMethod: UpstreamMethod
  /** Upstream pathname; the caller's query string (GET) or body (POST) rides through unchanged. */
  readonly upstreamPath: string
}

/** One exact fenced path and the operations registered on it. */
export interface FencedPath {
  /** Exact pathname; the channel matches a request's pathname against it verbatim. */
  readonly path: string
  /** Operations this path owns, in the order the browser half lists them. */
  readonly operations: readonly FencedOperation[]
}

/**
 * Every fenced JSON path this plugin publishes, and the backend operation each maps onto.
 *
 * Mirrors `@hod/aweave-mission-web`'s `MissionTransport` one-for-one:
 * `getConfig`/`listMissions`/`getMissionDetail`/`updateMission`. There is
 * deliberately no `subscribeEvents` route — see `EMBED_SCRIPT_PATH`'s module
 * comment and `README.md`'s "no live push" note; the mission board's `Board`
 * component polls `listMissions` every 5s when a transport omits it.
 */
export const FENCED_PATHS: readonly FencedPath[] = [
  {
    path: `${FENCED_PREFIX}/missions/config`,
    operations: [
      { key: 'mission-config', method: 'GET', upstreamMethod: 'GET', upstreamPath: '/missions/config' },
    ],
  },
  {
    path: `${FENCED_PREFIX}/missions/list`,
    operations: [
      { key: 'mission-list', method: 'GET', upstreamMethod: 'GET', upstreamPath: '/missions' },
    ],
  },
  {
    path: `${FENCED_PREFIX}/missions/detail`,
    operations: [
      { key: 'mission-detail', method: 'GET', upstreamMethod: 'GET', upstreamPath: '/missions/detail' },
    ],
  },
  {
    path: `${FENCED_PREFIX}/missions/update`,
    operations: [
      { key: 'mission-update', method: 'POST', upstreamMethod: 'POST', upstreamPath: '/missions/update' },
    ],
  },
]

/**
 * The script route serving the mission board's `embed.js`.
 *
 * A SEPARATE route from {@link FENCED_PATHS}: a `<script src>` load sends no
 * `accept: application/json` header and cannot read a JSON refusal envelope,
 * so this path's handler (`host/embed-route.ts`) answers
 * `content-type: application/javascript`, `cache-control: no-store`, and a
 * PLAIN-TEXT body on upstream failure — never the JSON envelope the routes
 * above use. `GET` only; `POST` answers `405`.
 */
export const EMBED_SCRIPT_PATH = `${FENCED_PREFIX}/mission-board/embed.js`

/** Upstream path `EMBED_SCRIPT_PATH` forwards to. */
export const EMBED_SCRIPT_UPSTREAM_PATH = '/mission-board/embed.js'

/** One operation as the browser half needs it: what to call, and where. */
export interface InjectedOperation {
  readonly key: string
  readonly method: FencedMethod
  /** Fenced pathname, ready to call from the page. */
  readonly path: string
}

/** Resolved Host configuration as the browser half receives it. */
export interface InjectedConfig {
  /** Backend origin the Host forwards to. */
  readonly baseUrl: string
  /** Upstream deadline, in milliseconds. */
  readonly requestTimeoutMs: number
  /** Absolute Aweave platform root, or `null` when neither a configured value nor an ancestor supplied one. */
  readonly aweaveRoot: string | null
  /** Every JSON operation the fence answers, so the browser half can address each one by key. */
  readonly operations: readonly InjectedOperation[]
  /** Fenced pathname the browser half loads `embed.js` from. */
  readonly embedScriptPath: string
}

/** Every operation in {@link FENCED_PATHS}, flattened with the path that owns it. */
export const FENCED_OPERATIONS: readonly InjectedOperation[] = FENCED_PATHS.flatMap(
  entry => entry.operations.map(operation => ({
    key: operation.key,
    method: operation.method,
    path: entry.path,
  })),
)

/**
 * Test whether an untrusted value is a well-formed injected operation row.
 * @param value - candidate read from the injected global.
 * @returns whether the value carries the fields the browser half reads.
 */
export function isValidInjectedOperation(value: unknown): value is InjectedOperation {
  if (typeof value !== 'object' || value === null) return false
  const row = value as { key?: unknown; method?: unknown; path?: unknown }
  return typeof row.key === 'string' && row.key !== ''
    && (row.method === 'GET' || row.method === 'HEAD' || row.method === 'POST')
    && typeof row.path === 'string' && row.path.startsWith('/')
}

/**
 * Test whether an untrusted value is a well-formed injected configuration.
 *
 * The Host validates before publishing and the browser half re-validates what it
 * reads: the global is page input, and a host that never injected the row, or a
 * page cached against an older index, must degrade to "no configuration" rather
 * than hand the body a half-built object.
 * @param value - candidate read from the injected global.
 * @returns whether the value carries the fields both halves rely on.
 */
export function isValidInjectedConfig(value: unknown): value is InjectedConfig {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as {
    baseUrl?: unknown
    requestTimeoutMs?: unknown
    aweaveRoot?: unknown
    operations?: unknown
    embedScriptPath?: unknown
  }
  if (typeof candidate.baseUrl !== 'string' || candidate.baseUrl === '') return false
  if (typeof candidate.requestTimeoutMs !== 'number' || !Number.isFinite(candidate.requestTimeoutMs)) return false
  if (candidate.aweaveRoot !== null && typeof candidate.aweaveRoot !== 'string') return false
  if (typeof candidate.embedScriptPath !== 'string' || !candidate.embedScriptPath.startsWith('/')) return false
  if (!Array.isArray(candidate.operations)) return false
  return candidate.operations.every(isValidInjectedOperation)
}

/**
 * Read the Host-published configuration global.
 *
 * The global is a first-paint seed written into the served HTML as
 * `globalThis[CONFIG_GLOBAL] = …`; it is read once per plugin activation, since
 * nothing in this plugin changes it after boot.
 * @returns the validated configuration, or `undefined` when the global is absent or malformed.
 */
export function readInjectedConfig(): InjectedConfig | undefined {
  const source = (globalThis as Record<string, unknown>)[CONFIG_GLOBAL]
  return isValidInjectedConfig(source) ? source : undefined
}
