/**
 * Built-artifact contract for the browser half.
 *
 * `lib/client.js` must exist, hand its factory to the shell's module loader with
 * the package id, export only what cordis loading needs, request nothing outside
 * the shell's baseline module table, and — when that `apply` runs — register the
 * Mission Board tab kind and a body whose injected face carries only the
 * Host-published configuration.
 *
 * This plugin no longer bundles a board implementation, its request/response
 * logic, or a drag-and-drop library: `embed.js` (`@hod/aweave-mission-web`'s
 * self-contained bundle) is loaded at RUNTIME from the fenced script route, not
 * bundled here. The one dependency that must still be INLINED (the shell seeds
 * neither) is the browser-safe workspace-path helper `open-task.ts` uses; the
 * request/response envelope rules that used to live in the deleted `lib/api.ts`
 * now live in `src/client/lib/mission-transport.ts` and have their OWN,
 * bundle-independent coverage (`test/unit/mission-transport.spec.ts`) — this
 * spec therefore checks bundle identity and registration wiring only, not
 * per-call network behaviour.
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
import type { MissionBoardInjected } from '../../src/client/MissionBoardBody.tsx'

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
 * load-time failure rather than a degraded board. `@dnd-kit/*` is gone with
 * the deleted Task Board — the board itself is `embed.js`'s own Shadow DOM
 * bundle now, loaded at runtime, not built into this bundle at all.
 */
const MUST_BE_INLINED = [
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
  options: { name: string; key?: string; locale?: string; inject?: () => MissionBoardInjected }
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
  const words: Record<string, string> = { 'tab.title': 'Mission Board' }
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
    embedScriptPath: '/api/aweave-dsh-devkit/mission-board/embed.js',
  }
}

/**
 * The injected face of the single registered body.
 * @param harness - activated harness.
 * @returns the face.
 */
function faceOf(harness: ApplyHarness): MissionBoardInjected {
  const inject = harness.entries[0]!.options.inject
  if (inject === undefined) throw new Error('the body was registered without an inject face')
  return inject()
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
    // And it really is inlined, so the assertion above cannot pass on a bundle
    // that simply dropped `open-task.ts`: the address scheme the open path
    // builds is present in the emitted source.
    expect(source).toContain('dsh-resource://file/')
  })

  it('never bundles @dnd-kit — the board itself moved to the runtime-loaded embed.js', () => {
    const source = readFileSync(BUNDLE_PATH, 'utf8')
    expect(source).not.toContain('@dnd-kit/core')
    expect(source).not.toContain('@dnd-kit/sortable')
    expect(source).not.toContain('@dnd-kit/utilities')
    expect(source).not.toContain('aria-roledescription')
  })

  it('carries no Node global that a browser page does not define', () => {
    // Regression gate for a measured outage: inlining a dependency reading
    // `process.env.NODE_ENV` made the emitted factory throw
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
  it('registers the Mission Board tab kind with its guide entry', () => {
    const harness = activate(injectedConfig())
    expect(harness.tabs).toHaveLength(1)
    const definition = harness.tabs[0]!
    expect(definition.id).toBe(PLUGIN_ID)
    expect(definition.kind).toBe(TAB_KIND)
    expect(definition.kind).toBe('aweave-mission-board')
    expect(definition.keepMounted).toBe(false)
    expect(definition.title('sidebar://aweave-mission-board')).toBe('Mission Board')
    expect(definition.guide).toHaveLength(1)
    expect(definition.guide![0]!.id).toBe(GUIDE_ENTRY_ID)
    expect(definition.guide![0]!.order).toBeGreaterThan(0)
  })

  it('registers its dictionary under the namespace its body declares', () => {
    const harness = activate(injectedConfig())
    expect(harness.dictionaries).toHaveLength(1)
    expect(harness.dictionaries[0]!.ns).toBe(LOCALE_NAMESPACE)
    expect(harness.dictionaries[0]!.ns).toBe('aweaveMissionBoard')
    expect(harness.dictionaries[0]!.locale).toBe('en')
    expect(harness.dictionaries[0]!.dict['tab.title']).toBe('Mission Board')
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
  })

  it('hands the body no configuration when the global is absent or malformed', () => {
    expect(faceOf(activate()).config).toBeUndefined()
    ;(globalThis as Record<string, unknown>)[CONFIG_GLOBAL] = { baseUrl: 7 }
    const harness = createContext()
    ;(pluginExports.apply as (ctx: Context) => void)(harness.ctx)
    harness.run()
    expect(faceOf(harness).config).toBeUndefined()
  })
})
