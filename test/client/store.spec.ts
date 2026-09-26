/**
 * Board view-state persistence: round trip, validation, and self-heal.
 *
 * The store is exercised against a stand-in `Storage` installed on the global, so
 * the environment's own storage is never touched and the failure branches
 * (throwing `getItem`/`setItem`/`removeItem`, absent storage) are reachable. The
 * self-heal cases assert the REMOVAL, not only the returned default: a payload
 * that is rejected on read but left in place would be re-rejected on every mount.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BOARD_STATE_KEY,
  clearBoardViewState,
  parseBoardViewState,
  readBoardViewState,
  writeBoardViewState,
} from '../../src/client/store.ts'
import { defaultViewState } from '../../src/client/lib/types.ts'

/** A `Storage` stand-in with a settable failure mode per operation. */
interface StubStorage extends Storage {
  /** Throwing behaviour to apply, or `null` for a healthy store. */
  failure: 'getItem' | 'setItem' | 'removeItem' | null
  /** Whether operations are recorded at all. */
  readonly calls: string[]
}

/**
 * Build the stand-in storage.
 * @returns a `Storage`-shaped object backed by a `Map`.
 */
function stubStorage(): StubStorage {
  const entries = new Map<string, string>()
  const calls: string[] = []
  const storage: StubStorage = {
    failure: null,
    calls,
    get length() { return entries.size },
    clear: () => { entries.clear() },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => {
      calls.push(`getItem:${key}`)
      if (storage.failure === 'getItem') throw new Error('storage refused the read')
      return entries.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      calls.push(`setItem:${key}`)
      if (storage.failure === 'setItem') throw new Error('quota exceeded')
      entries.set(key, value)
    },
    removeItem: (key: string) => {
      calls.push(`removeItem:${key}`)
      if (storage.failure === 'removeItem') throw new Error('storage refused the removal')
      entries.delete(key)
    },
  }
  return storage
}

/** The storage installed for the current case. */
let store: StubStorage

/**
 * Install a stand-in storage on the global, replacing whatever the environment has.
 * @returns the installed stub.
 */
function installStorage(): StubStorage {
  store = stubStorage()
  ;(globalThis as Record<string, unknown>).localStorage = store
  return store
}

/**
 * Remove the global storage entirely, modelling an environment without one.
 */
function uninstallStorage(): void {
  delete (globalThis as Record<string, unknown>).localStorage
}

/**
 * Write a raw payload under the board key, bypassing the store's own writer.
 * @param raw - the raw string to store.
 */
function seedRaw(raw: string): void {
  store.setItem(BOARD_STATE_KEY, raw)
}

/** The shared view state used by the round-trip cases. */
const VIEW = {
  groupBy: 'repository' as const,
  collapsedGroups: ['repository:devtools', 'repository:whill'],
  filters: { scopes: ['devtools/common'], tags: ['dsh', 'plugin'], status: 'in-progress', text: 'kanban' },
}

beforeEach(() => { installStorage() })
afterEach(() => { uninstallStorage() })

describe('the storage key', () => {
  it('is versioned, so a future incompatible shape lands under a new key', () => {
    expect(BOARD_STATE_KEY).toBe('aweave-dsh-devkit.taskboard.v1')
  })
})

describe('round trip', () => {
  it('reads back exactly what was written', () => {
    writeBoardViewState(VIEW)
    expect(readBoardViewState()).toEqual(VIEW)
  })

  it('reads back the default state when nothing was ever written', () => {
    expect(readBoardViewState()).toEqual(defaultViewState())
    expect(readBoardViewState()).toEqual({
      groupBy: 'workspace',
      collapsedGroups: [],
      filters: { scopes: [], tags: [], status: '', text: '' },
    })
  })

  it('writes under the single versioned key and nowhere else', () => {
    writeBoardViewState(VIEW)
    expect(store.calls.filter(call => call.startsWith('setItem'))).toEqual([`setItem:${BOARD_STATE_KEY}`])
  })

  it('clears the key', () => {
    writeBoardViewState(VIEW)
    clearBoardViewState()
    expect(readBoardViewState()).toEqual(defaultViewState())
  })

  it('copies the arrays it writes, so a later mutation of the source cannot change storage', () => {
    const collapsed = ['workspace:devtools']
    const scopes = ['devtools']
    writeBoardViewState({
      groupBy: 'workspace',
      collapsedGroups: collapsed,
      filters: { scopes, tags: [], status: '', text: '' },
    })
    collapsed.push('workspace:whill')
    scopes.push('whill')
    expect(readBoardViewState().collapsedGroups).toEqual(['workspace:devtools'])
    expect(readBoardViewState().filters.scopes).toEqual(['devtools'])
  })
})

describe('self-heal on a malformed payload', () => {
  it('discards a payload that is not JSON, and removes it', () => {
    seedRaw('{ not json at all')
    expect(readBoardViewState()).toEqual(defaultViewState())
    expect(store.getItem(BOARD_STATE_KEY)).toBeNull()
    expect(store.calls).toContain(`removeItem:${BOARD_STATE_KEY}`)
  })

  it('discards a payload stored as a bare JSON value rather than an envelope', () => {
    seedRaw('"a string"')
    expect(readBoardViewState()).toEqual(defaultViewState())
    expect(store.getItem(BOARD_STATE_KEY)).toBeNull()
  })

  it('discards an envelope carrying an unknown version', () => {
    seedRaw(JSON.stringify({ version: 2, state: VIEW }))
    expect(readBoardViewState()).toEqual(defaultViewState())
    expect(store.getItem(BOARD_STATE_KEY)).toBeNull()
  })

  it('discards an envelope carrying no version', () => {
    seedRaw(JSON.stringify({ state: VIEW }))
    expect(readBoardViewState()).toEqual(defaultViewState())
    expect(store.getItem(BOARD_STATE_KEY)).toBeNull()
  })

  it('discards a state whose grouping key is not accepted', () => {
    seedRaw(JSON.stringify({ version: 1, state: { ...VIEW, groupBy: 'team' } }))
    expect(readBoardViewState()).toEqual(defaultViewState())
    expect(store.getItem(BOARD_STATE_KEY)).toBeNull()
  })

  it('discards a state that lost a field rather than merging it with a default', () => {
    seedRaw(JSON.stringify({ version: 1, state: { groupBy: 'workspace', filters: VIEW.filters } }))
    expect(readBoardViewState()).toEqual(defaultViewState())
    expect(store.getItem(BOARD_STATE_KEY)).toBeNull()
  })

  it('discards a state whose filters are not strings', () => {
    seedRaw(JSON.stringify({
      version: 1,
      state: { groupBy: 'workspace', collapsedGroups: [], filters: { scopes: [1], tags: [], status: '', text: '' } },
    }))
    expect(readBoardViewState()).toEqual(defaultViewState())
    expect(store.getItem(BOARD_STATE_KEY)).toBeNull()
  })

  it('discards a state whose collapsed groups are not an array', () => {
    seedRaw(JSON.stringify({
      version: 1,
      state: { groupBy: 'workspace', collapsedGroups: 'workspace:devtools', filters: VIEW.filters },
    }))
    expect(readBoardViewState()).toEqual(defaultViewState())
    expect(store.getItem(BOARD_STATE_KEY)).toBeNull()
  })

  it('leaves a well-formed payload in place', () => {
    seedRaw(JSON.stringify({ version: 1, state: VIEW }))
    expect(readBoardViewState()).toEqual(VIEW)
    expect(store.getItem(BOARD_STATE_KEY)).not.toBeNull()
  })
})

describe('degradation when storage is unavailable', () => {
  it('returns the default state and does not throw when no storage exists', () => {
    uninstallStorage()
    expect(readBoardViewState()).toEqual(defaultViewState())
    expect(() => { writeBoardViewState(VIEW) }).not.toThrow()
    expect(() => { clearBoardViewState() }).not.toThrow()
  })

  it('returns the default state when the read throws', () => {
    seedRaw(JSON.stringify({ version: 1, state: VIEW }))
    store.failure = 'getItem'
    expect(readBoardViewState()).toEqual(defaultViewState())
  })

  it('does not throw when the write is refused, and reports it instead', () => {
    store.failure = 'setItem'
    const reported: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => { reported.push(args) }
    try {
      expect(() => { writeBoardViewState(VIEW) }).not.toThrow()
    } finally {
      console.error = original
    }
    // A refused write is not silent: a Human debugging a board that forgets its
    // view state needs the reason in the console.
    expect(reported).toHaveLength(1)
    expect(String(reported[0]![0])).toContain('board view-state persistence failed')
  })

  it('does not throw when the removal is refused', () => {
    store.failure = 'removeItem'
    expect(() => { clearBoardViewState() }).not.toThrow()
  })

  it('still returns the default state when the payload is malformed and the removal is refused', () => {
    seedRaw('broken')
    store.failure = 'removeItem'
    expect(readBoardViewState()).toEqual(defaultViewState())
  })
})

describe('parseBoardViewState', () => {
  it('accepts a fully-formed state', () => {
    expect(parseBoardViewState(VIEW)).toEqual(VIEW)
  })

  it('rejects every non-object candidate', () => {
    for (const candidate of [null, undefined, 7, 'state', [], true]) {
      expect(parseBoardViewState(candidate)).toBeUndefined()
    }
  })

  it('accepts an empty filter set, which is a valid state', () => {
    expect(parseBoardViewState({
      groupBy: 'none',
      collapsedGroups: [],
      filters: { scopes: [], tags: [], status: '', text: '' },
    })).toEqual({ groupBy: 'none', collapsedGroups: [], filters: { scopes: [], tags: [], status: '', text: '' } })
  })

  it('accepts every declared grouping key', () => {
    for (const groupBy of ['workspace', 'domain', 'repository', 'scope', 'none']) {
      expect(parseBoardViewState({ ...VIEW, groupBy })).toEqual({ ...VIEW, groupBy })
    }
  })
})
