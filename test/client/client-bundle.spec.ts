/**
 * Built-artifact contract for the browser half.
 *
 * `lib/client.js` must exist, hand its factory to the shell's module loader with
 * the package id, export only what cordis loading needs, request nothing outside
 * the shell's baseline module table, and — when that `apply` runs — register the
 * Task Board tab kind and a body whose injected face carries the Host-published
 * configuration and a data surface bound to it.
 *
 * Two of the assertions below exist because of how the board's own libraries are
 * shipped. `@dnd-kit/*` and the browser-safe workspace-path helpers are
 * `devDependencies` that must be INLINED: the shell seeds neither into its module
 * table, so a `require` for either would fail at page load. The spec therefore
 * checks the requested specifiers AND the bundle source, because a bundle that
 * merely happens not to be exercised would pass a call-site-only check.
 *
 * The spec reads the BUILT bundle, so `build:client` must have run first; the
 * package's `test` script builds it before invoking vitest.
 */
import type { Context } from '@deepseek-ai/cordis'

import { existsSync, readFileSync, statSync } from 'node:fs'

import * as React from 'react'
import * as JsxRuntime from 'react/jsx-runtime'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  CONFIG_GLOBAL,
  FENCED_OPERATIONS,
  GUIDE_ENTRY_ID,
  LOCALE_NAMESPACE,
  PLUGIN_ID,
  TAB_KIND,
  type InjectedConfig,
} from '../../src/config.ts'
import type { TaskBoardInjected } from '../../src/client/TaskBoardBody.tsx'

const BUNDLE_PATH = 'lib/client.js'
const HOST_ENTRY_PATH = 'lib/index.js'

/**
 * The client baseline: specifiers the shell seeds once and answers from its
 * module table. `PLATFORM_MODULES` in `packages/client/web/src/platform.ts` is
 * the authority; these are the rows this plugin can reach.
 */
const BASELINE_SPECIFIERS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/**
 * Specifiers that must be INLINED rather than requested.
 *
 * The shell seeds none of them, so a module-table request for one would be a
 * load-time failure rather than a degraded board.
 */
const MUST_BE_INLINED = [
  '@dnd-kit/core',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',
  '@deepseek-ai/dsh-util-workspace-path',
]

/** One tab type as the registry receives it. */
interface RegisteredTabKind {
  id: string
  kind: string
  keepMounted?: boolean
  title: (address: string) => string
  guide?: readonly { id: string; order: number; title: () => string; description?: () => string }[]
}

/** One slot entry as the seat receives it. */
interface RegisteredEntry {
  options: { name: string; key?: string; locale?: string; inject?: () => TaskBoardInjected }
  component: unknown
}

interface Registration {
  id: string
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

/** Registrations captured from `window.__ModuleLoader__.load`. */
const registrations: Registration[] = []

/** Bare specifiers the bundle asked the shell's module table for. */
const requestedSpecifiers: string[] = []

/**
 * Answer one module request from a stand-in module table.
 * @param specifier - the bare specifier the bundle asked for.
 * @returns the module the table would hand back.
 */
function resolveModule(specifier: string): unknown {
  requestedSpecifiers.push(specifier)
  if (specifier === 'react') return React
  if (specifier === 'react/jsx-runtime' || specifier === 'react/jsx-dev-runtime') return JsxRuntime
  if (specifier === 'react-dom') return {}
  throw new Error(`unexpected require(${specifier}) — not a client baseline module`)
}

/**
 * Evaluate the built bundle once, capturing its loader registration.
 * @returns The captured registration for the plugin bundle.
 */
function captureRegistration(): Registration {
  const source = readFileSync(BUNDLE_PATH, 'utf8')
  const loader = { load: (registration: Registration) => { registrations.push(registration) } }
  ;(globalThis as Record<string, unknown>).window = globalThis
  ;(globalThis as Record<string, unknown>).__ModuleLoader__ = loader
  try {
    // `process` is shadowed with `undefined` so the factory runs under browser
    // semantics. Evaluating this source in plain Node is not a browser test:
    // Node has a global `process`, so an inlined dependency reading
    // `process.env.NODE_ENV` resolves here and the factory never throws — while
    // in a real page it throws `ReferenceError: process is not defined`, fails
    // the whole client half, and takes the page down with "Failed to load
    // plugins". Shadowing it makes that failure reproduce in this spec.
    new Function('process', source)(undefined)
  } finally {
    delete (globalThis as Record<string, unknown>).window
    delete (globalThis as Record<string, unknown>).__ModuleLoader__
  }
  const registration = registrations.at(-1)
  if (registration === undefined) throw new Error(`${BUNDLE_PATH} did not call window.__ModuleLoader__.load`)
  return registration
}

let registration: Registration
let pluginExports: Record<string, unknown>

beforeAll(() => {
  registration = captureRegistration()
  pluginExports = registration.factory(resolveModule)
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[CONFIG_GLOBAL]
})

/** The stub context the built `apply` runs against. */
interface ApplyHarness {
  ctx: Context
  /** Tab types the bundle registered. */
  tabs: RegisteredTabKind[]
  /** Every locale registration the bundle made. */
  dictionaries: { ns: string; locale: string; dict: Readonly<Record<string, string>> }[]
  /** Slot entries the bundle registered once their slot declaration arrived. */
  entries: RegisteredEntry[]
  /** Run every registered effect body and collect its disposer. */
  run: () => Array<() => void>
}

/**
 * Minimal client context carrying the three services the bundle injects.
 * @returns the context plus the captured registrations.
 */
function createContext(): ApplyHarness {
  const bodies: Array<() => (() => void) | void> = []
  const harness: ApplyHarness = {
    tabs: [],
    dictionaries: [],
    entries: [],
    run: () => bodies.map(body => body() ?? (() => {})),
    ctx: undefined as unknown as Context,
  }
  const words: Record<string, string> = { 'tab.title': 'Task Board' }
  harness.ctx = {
    effect: (body: () => (() => void) | void) => {
      bodies.push(body)
      return () => {}
    },
    locale: {
      bind: () => (key: string) => words[key] ?? key,
      register: (ns: string, locale: string, dict: Readonly<Record<string, string>>) => {
        harness.dictionaries.push({ ns, locale, dict })
        return () => {}
      },
    },
    sidebarRightTabs: {
      register: (definition: RegisteredTabKind) => {
        harness.tabs.push(definition)
        return () => {}
      },
    },
    slots: {
      inject: (_name: string, install: () => void) => {
        install()
        return () => {}
      },
      register: (options: RegisteredEntry['options'], component: unknown) => {
        harness.entries.push({ options, component })
        return () => {}
      },
    },
  } as unknown as Context
  return harness
}

/**
 * Activate the built bundle against a stub context.
 * @param config - value to publish under the injected global before activation.
 * @returns the harness holding everything the bundle registered.
 */
function activate(config?: InjectedConfig): ApplyHarness {
  if (config !== undefined) (globalThis as Record<string, unknown>)[CONFIG_GLOBAL] = config
  const harness = createContext()
  ;(pluginExports.apply as (ctx: Context) => void)(harness.ctx)
  harness.run()
  return harness
}

/** A configuration carrying every fenced operation, as the Host would publish it. */
function injectedConfig(): InjectedConfig {
  return {
    baseUrl: 'http://127.0.0.1:3456',
    requestTimeoutMs: 8000,
    aweaveRoot: '/platform',
    operations: FENCED_OPERATIONS,
  }
}

/**
 * The injected face of the single registered body.
 * @param harness - activated harness.
 * @returns the face.
 */
function faceOf(harness: ApplyHarness): TaskBoardInjected {
  const inject = harness.entries[0]!.options.inject
  if (inject === undefined) throw new Error('the body was registered without an inject face')
  return inject()
}

/** Transport facts captured from the stubbed `fetch`. */
interface SeenRequest {
  url: string
  method: string | undefined
  body: string | undefined
}

/**
 * Run one call against a stubbed transport that records the request.
 * @param harness - activated harness.
 * @param respond - response to answer with, or an error to throw.
 * @param invoke - the api call to make.
 * @returns the recorded requests and what the call resolved to.
 */
async function capturing(
  harness: ApplyHarness,
  respond: () => Response,
  invoke: (face: TaskBoardInjected) => Promise<unknown>,
): Promise<{ seen: SeenRequest[]; value: unknown }> {
  const seen: SeenRequest[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    return respond()
  }) as typeof fetch
  try {
    return { seen, value: await invoke(faceOf(harness)) }
  } finally {
    globalThis.fetch = original
  }
}

/**
 * Run one call against a stubbed transport and capture the failure it threw.
 * @param harness - activated harness.
 * @param respond - response to answer with.
 * @param invoke - the api call to make.
 * @returns the thrown value.
 */
async function captureFailure(
  harness: ApplyHarness,
  respond: () => Response,
  invoke: (face: TaskBoardInjected) => Promise<unknown>,
): Promise<unknown> {
  const original = globalThis.fetch
  globalThis.fetch = (async () => respond()) as typeof fetch
  try {
    await invoke(faceOf(harness))
    return undefined
  } catch (error: unknown) {
    return error
  } finally {
    globalThis.fetch = original
  }
}

/**
 * Assert a captured throw is a board API failure and read its fields.
 *
 * The shape is asserted rather than `instanceof TaskBoardApiError`: the bundle is
 * evaluated through `new Function`, so it carries its OWN copy of the class and an
 * `instanceof` against the spec's source import would be false even though the
 * error is exactly the right one. The class NAME plus every field is asserted
 * instead, which is strictly more specific than an identity check.
 * @param thrown - the captured throw.
 * @returns the failure's fields.
 */
function failureOf(thrown: unknown): {
  name: unknown
  kind: unknown
  code: unknown
  message: unknown
  status: unknown
} {
  expect(thrown).toBeInstanceOf(Error)
  const error = thrown as Error & { kind?: unknown; code?: unknown; status?: unknown }
  expect(error.name).toBe('TaskBoardApiError')
  return { name: error.name, kind: error.kind, code: error.code, message: error.message, status: error.status }
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

describe('built Client bundle', () => {
  it('exists and is non-empty', () => {
    expect(existsSync(BUNDLE_PATH)).toBe(true)
    expect(statSync(BUNDLE_PATH).size).toBeGreaterThan(0)
  })

  it('registers under the package id the loader expects', () => {
    expect(registration.id).toBe('aweave-dsh-devkit')
    expect(registration.id).toBe(PLUGIN_ID)
  })

  it('exports only what cordis loading needs', () => {
    expect(Object.keys(pluginExports).sort()).toEqual(['apply', 'inject'])
    expect(typeof pluginExports.apply).toBe('function')
    expect(pluginExports.inject).toEqual(['slots', 'locale', 'sidebarRightTabs'])
  })

  it('exposes the Host apply entry as a separate artifact', () => {
    expect(existsSync(HOST_ENTRY_PATH)).toBe(true)
    expect(statSync(HOST_ENTRY_PATH).size).toBeGreaterThan(0)
  })

  it('requests only client baseline modules, never a Host-only library', () => {
    // `schemastery` is a Host dependency; reaching it from the page would fail at
    // load. Every request the bundle makes must be a row the shell has seeded.
    expect(requestedSpecifiers).not.toContain('@deepseek-ai/schemastery')
    expect(requestedSpecifiers.filter(specifier => !BASELINE_SPECIFIERS.has(specifier))).toEqual([])
    // The rows this plugin actually uses, so the assertion above cannot pass
    // vacuously: one React instance is the shell's, not a second copy.
    expect(requestedSpecifiers).toContain('react')
    expect(requestedSpecifiers).toContain('react/jsx-runtime')
  })

  it('inlines the libraries the shell does not seed instead of requesting them', () => {
    const source = readFileSync(BUNDLE_PATH, 'utf8')
    for (const specifier of MUST_BE_INLINED) {
      expect(requestedSpecifiers).not.toContain(specifier)
      expect(source).not.toContain(`require("${specifier}")`)
      expect(source).not.toContain(`require('${specifier}')`)
    }
    // And they really are inlined, so the assertions above cannot pass on a bundle
    // that simply dropped the board: dnd-kit's own attribute and the address scheme
    // the open path builds are both present in the emitted source.
    expect(source).toContain('aria-roledescription')
    expect(source).toContain('dsh-resource://file/')
  })

  it('carries no Node global that a browser page does not define', () => {
    // Regression gate for a measured outage: inlining `@dnd-kit/*` pulled in a
    // dependency reading `process.env.NODE_ENV`, the emitted factory threw
    // `ReferenceError: process is not defined` at boot, and the ENTIRE Web UI
    // showed "Failed to load plugins". The build bakes the substitution
    // (`define` in tsdown.config.ts), so the emitted source must not mention
    // `process` at all — an assertion on the artifact catches this for every
    // inlined dependency, not just the one that broke.
    const source = readFileSync(BUNDLE_PATH, 'utf8')
    expect(source).not.toMatch(/\bprocess\s*\./)
    expect(source).not.toMatch(/\brequire\s*\(\s*["']node:/)
  })
})

describe('built Client apply', () => {
  it('registers the Task Board tab kind with its guide entry', () => {
    const harness = activate(injectedConfig())
    expect(harness.tabs).toHaveLength(1)
    const definition = harness.tabs[0]!
    expect(definition.id).toBe(PLUGIN_ID)
    expect(definition.kind).toBe(TAB_KIND)
    expect(definition.keepMounted).toBe(false)
    expect(definition.title('sidebar://aweave-taskboard')).toBe('Task Board')
    expect(definition.guide).toHaveLength(1)
    expect(definition.guide![0]!.id).toBe(GUIDE_ENTRY_ID)
    expect(definition.guide![0]!.order).toBeGreaterThan(0)
  })

  it('registers its dictionary under the namespace its body declares', () => {
    const harness = activate(injectedConfig())
    expect(harness.dictionaries).toHaveLength(1)
    expect(harness.dictionaries[0]!.ns).toBe(LOCALE_NAMESPACE)
    expect(harness.dictionaries[0]!.locale).toBe('en')
    expect(harness.dictionaries[0]!.dict['tab.title']).toBe('Task Board')
  })

  it('registers one keyed body on the tab-body seat', () => {
    const harness = activate(injectedConfig())
    expect(harness.entries).toHaveLength(1)
    expect(harness.entries[0]!.options.name).toBe('sidebar.right.pane.tab')
    expect(harness.entries[0]!.options.key).toBe(PLUGIN_ID)
    expect(harness.entries[0]!.options.locale).toBe(LOCALE_NAMESPACE)
    expect(typeof harness.entries[0]!.component).toBe('function')
  })

  it('hands the body the configuration the Host published', () => {
    const config = injectedConfig()
    const harness = activate(config)
    expect(faceOf(harness).config).toEqual(config)
    expect(faceOf(harness).api).toBeDefined()
  })

  it('hands the body no configuration, and no data surface, when the global is absent or malformed', () => {
    expect(faceOf(activate()).config).toBeUndefined()
    expect(faceOf(activate()).api).toBeUndefined()
    ;(globalThis as Record<string, unknown>)[CONFIG_GLOBAL] = { baseUrl: 7 }
    const harness = createContext()
    ;(pluginExports.apply as (ctx: Context) => void)(harness.ctx)
    harness.run()
    expect(faceOf(harness).config).toBeUndefined()
    expect(faceOf(harness).api).toBeUndefined()
  })

  it('binds the data surface to the paths and methods the Host published', async () => {
    const harness = activate(injectedConfig())
    const { seen, value } = await capturing(
      harness,
      () => ok({ statuses: [{ id: 'todo', label: 'Todo', color: '#111' }] }),
      async face => await face.api!.loadStatuses(),
    )
    expect(seen).toEqual([{ url: '/api/aweave-dsh-devkit/config', method: 'GET', body: undefined }])
    expect(value).toEqual([{ id: 'todo', label: 'Todo', color: '#111' }])
  })

  it('joins the filter facets into the comma-separated query the backend declares', async () => {
    const harness = activate(injectedConfig())
    const { seen } = await capturing(harness, () => ok({ tasks: [] }), async face => await face.api!.listTasks({
      scopes: ['devtools/common'],
      tags: ['dsh', 'plugin'],
      status: 'in-progress',
      text: 'kanban board',
    }))
    const url = new URL(seen[0]!.url, 'http://page.invalid')
    expect(url.pathname).toBe('/api/aweave-dsh-devkit/tasks')
    expect(url.searchParams.get('scopes')).toBe('devtools/common')
    expect(url.searchParams.get('tags')).toBe('dsh,plugin')
    expect(url.searchParams.get('status')).toBe('in-progress')
    expect(url.searchParams.get('text')).toBe('kanban board')
  })

  it('omits an unconstrained facet rather than sending it blank', async () => {
    const harness = activate(injectedConfig())
    const { seen } = await capturing(harness, () => ok({ tasks: [] }), async face => await face.api!.listTasks({
      scopes: [], tags: [], status: '', text: '',
    }))
    expect(seen[0]!.url).toBe('/api/aweave-dsh-devkit/tasks')
  })

  it('sends the update as a POST body the Host can derive the task id from', async () => {
    const harness = activate(injectedConfig())
    const { seen } = await capturing(
      harness,
      () => ok({ id: 'x.md' }),
      async face => await face.api!.updateTask({
        id: 'resources/workspaces/k/dsh/_tasks/x.md',
        status: 'done',
        rank: 2.5,
      }),
    )
    expect(seen[0]!.url).toBe('/api/aweave-dsh-devkit/tasks/update')
    expect(seen[0]!.method).toBe('POST')
    expect(JSON.parse(seen[0]!.body!)).toEqual({
      id: 'resources/workspaces/k/dsh/_tasks/x.md',
      status: 'done',
      rank: 2.5,
    })
  })

  it('surfaces a backend refusal as a backend failure carrying its code and message', async () => {
    const harness = activate(injectedConfig())
    const thrown = await captureFailure(
      harness,
      () => failure(400, 'HTTP_ERROR', 'Bad Request Exception'),
      async face => await face.api!.createTask({ scope: 'devtools', name: 'x' }),
    )
    expect(failureOf(thrown)).toEqual({
      name: 'TaskBoardApiError',
      kind: 'backend',
      code: 'HTTP_ERROR',
      message: 'Bad Request Exception',
      status: 400,
    })
  })

  it('surfaces the Host\u2019s upstream-unreachable answer as unreachable, not as an empty board', async () => {
    const harness = activate(injectedConfig())
    const thrown = await captureFailure(
      harness,
      () => failure(502, 'UPSTREAM_UNREACHABLE', 'the backend did not answer'),
      async face => await face.api!.loadStatuses(),
    )
    expect(failureOf(thrown).kind).toBe('unreachable')
  })

  it('treats a thrown transport as unreachable', async () => {
    const harness = activate(injectedConfig())
    const original = globalThis.fetch
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    const thrown = await faceOf(harness).api!.loadScopes().then(() => undefined, (error: unknown) => error)
    globalThis.fetch = original
    expect(failureOf(thrown).kind).toBe('unreachable')
    expect(failureOf(thrown).message).toBe('Failed to fetch')
  })

  it('treats a non-JSON answer as unreadable rather than trusting it', async () => {
    const harness = activate(injectedConfig())
    const thrown = await captureFailure(
      harness,
      () => new Response('<html>proxy</html>', { status: 200 }),
      async face => await face.api!.loadStatuses(),
    )
    expect(failureOf(thrown).kind).toBe('malformed')
  })
})
