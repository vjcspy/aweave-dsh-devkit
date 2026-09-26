/**
 * Board view-state persistence: one versioned `localStorage` key, guarded and
 * self-healing.
 *
 * Follows the stock right sidebar's precedent
 * (`workspaces/k/dsh/deepseek-harness/packages/client/ui-sidebar-right/src/client/persistence.ts:63-101`)
 * on every point that matters: a `typeof localStorage` guard, `try/catch` on every
 * read, write and removal, a versioned JSON envelope validated on read, and
 * `removeItem` self-heal so a malformed payload is discarded once rather than
 * re-parsed on every mount.
 *
 * Only VIEW state is persisted — grouping, collapsed groups and filters. Nothing
 * derived from the backend lives here: tasks, statuses and scopes are always
 * re-read, so a stale store can never present stale data as current.
 * @module
 */

import {
  defaultViewState,
  isGroupByKey,
  type BoardFilters,
  type BoardViewState,
} from './lib/types.ts'

/**
 * The single key every board view-state write targets.
 *
 * Versioned in the key rather than in a field alone, so a future incompatible
 * shape lands under a new key and cannot be read as this one.
 */
export const BOARD_STATE_KEY = 'aweave-dsh-devkit.taskboard.v1'

/** Envelope version this module writes and accepts. */
const BOARD_STATE_VERSION = 1

/**
 * The page's storage, or `undefined` when the environment has none.
 *
 * Read through a function, not captured at module load, so a test can install a
 * stand-in and the browser's own `localStorage` is resolved at call time.
 * @returns the storage, or `undefined`.
 */
function storage(): Storage | undefined {
  if (typeof localStorage === 'undefined') return undefined
  return localStorage
}

/**
 * Test whether an untrusted value is a string array.
 * @param value - candidate.
 * @returns whether the value is an array of strings.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

/**
 * Validate one untrusted filter set.
 * @param value - candidate read from storage.
 * @returns the filters, or `undefined` when the shape is wrong.
 */
function parseFilters(value: unknown): BoardFilters | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (!isStringArray(candidate.scopes)) return undefined
  if (!isStringArray(candidate.tags)) return undefined
  if (typeof candidate.status !== 'string') return undefined
  if (typeof candidate.text !== 'string') return undefined
  return { scopes: candidate.scopes, tags: candidate.tags, status: candidate.status, text: candidate.text }
}

/**
 * Validate one untrusted view-state payload.
 *
 * Every field is required: a payload that lost a field is treated as unusable
 * rather than merged with defaults, so a partially-written value cannot silently
 * pin the board to a half-remembered view.
 * @param value - candidate read from storage.
 * @returns the view state, or `undefined` when the shape is wrong.
 */
export function parseBoardViewState(value: unknown): BoardViewState | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (!isGroupByKey(candidate.groupBy)) return undefined
  if (!isStringArray(candidate.collapsedGroups)) return undefined
  const filters = parseFilters(candidate.filters)
  if (filters === undefined) return undefined
  return { groupBy: candidate.groupBy, collapsedGroups: candidate.collapsedGroups, filters }
}

/**
 * Read the persisted view state.
 *
 * A malformed or foreign payload is removed and replaced by the default state, so
 * the store self-heals on first read instead of failing on every mount.
 * @returns the persisted view state, or the default when none is usable.
 */
export function readBoardViewState(): BoardViewState {
  const defaults = defaultViewState()
  const store = storage()
  if (store === undefined) return defaults

  let raw: string | null
  try {
    raw = store.getItem(BOARD_STATE_KEY)
  } catch (_storageUnavailable) {
    return defaults
  }
  if (raw === null) return defaults

  try {
    const envelope = JSON.parse(raw) as { version?: unknown; state?: unknown } | null
    if (envelope === null || typeof envelope !== 'object' || envelope.version !== BOARD_STATE_VERSION) {
      throw new Error('unsupported board view-state envelope')
    }
    const state = parseBoardViewState(envelope.state)
    if (state === undefined) throw new Error('malformed board view state')
    return state
  } catch (_invalidPayload) {
    clearBoardViewState()
    return defaults
  }
}

/**
 * Persist the view state.
 * @param state - the view state to store.
 */
export function writeBoardViewState(state: BoardViewState): void {
  const store = storage()
  if (store === undefined) return
  const envelope = JSON.stringify({
    version: BOARD_STATE_VERSION,
    state: {
      groupBy: state.groupBy,
      collapsedGroups: [...state.collapsedGroups],
      filters: {
        scopes: [...state.filters.scopes],
        tags: [...state.filters.tags],
        status: state.filters.status,
        text: state.filters.text,
      },
    },
  })
  try {
    store.setItem(BOARD_STATE_KEY, envelope)
  } catch (error: unknown) {
    // Quota exhaustion and a disabled store both land here, and neither is worth
    // failing a render over: the board works, it just will not remember.
    console.error('aweave-dsh-devkit: board view-state persistence failed:', error)
  }
}

/**
 * Discard the persisted view state.
 *
 * Also the self-heal path, so a malformed payload is removed rather than left for
 * the next mount to re-reject.
 */
export function clearBoardViewState(): void {
  const store = storage()
  if (store === undefined) return
  try {
    store.removeItem(BOARD_STATE_KEY)
  } catch (_storageUnavailable) {
    // The payload is still excluded from this window; there is nothing else to do.
  }
}
