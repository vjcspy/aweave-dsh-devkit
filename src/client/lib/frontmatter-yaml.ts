/**
 * YAML half of the markdown Properties panel: the parse of a front-matter block,
 * the re-parse that gates every orientation write, and a bounded value formatter.
 *
 * The ONLY importer of `js-yaml`, which is bundled into `lib/client.js` (the
 * host's shared module table carries no YAML parser). `CORE_SCHEMA` only: the
 * default schema turns timestamps into `Date`, and a schema allowing custom tags
 * is never acceptable for a document the viewer did not author.
 * @module
 */
import { CORE_SCHEMA, load } from 'js-yaml'

import { blockText, orientationEditability, splitFrontMatter } from './frontmatter-block.ts'

/** The result of parsing one front-matter block. */
export type ParsedBlock =
  | { readonly kind: 'mapping'; readonly data: Record<string, unknown> }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'non-mapping' }

/** Nesting depth beyond which structural comparison gives up and refuses. */
const MAX_COMPARE_DEPTH = 32
const MAX_FORMAT_DEPTH = 4
const MAX_FORMAT_ITEMS = 50
const MAX_FORMAT_CHARS = 2000
const MAX_FORMAT_NODES = 500

/** Whether a value is a plain (non-array) object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse the text between a block's delimiters.
 * @param text - the YAML text.
 * @returns a mapping (an empty block is an empty mapping), a parse error (a
 * duplicated key throws), or a non-mapping root.
 */
export function parseBlock(text: string): ParsedBlock {
  try {
    const value = load(text, { schema: CORE_SCHEMA })
    if (value === undefined) return { kind: 'mapping', data: {} }
    return isRecord(value) ? { kind: 'mapping', data: value } : { kind: 'non-mapping' }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Structural equality that terminates on aliases and cycles.
 * @param a - left value.
 * @param b - right value.
 * @param depth - current nesting depth.
 * @param visited - the pairs already under comparison.
 * @returns `false` past the depth bound.
 */
function equalValues(a: unknown, b: unknown, depth: number, visited: Map<object, Set<object>>): boolean {
  if (depth > MAX_COMPARE_DEPTH) return false
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return Object.is(a, b)
  const seen = visited.get(a)
  if (seen?.has(b) === true) return true
  if (seen === undefined) visited.set(a, new Set([b]))
  else seen.add(b)
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => equalValues(item, b[index], depth + 1, visited))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  const other = Object.keys(right)
  if (keys.length !== other.length) return false
  return keys.every((key, index) => key === other[index] && equalValues(left[key], right[key], depth + 1, visited))
}

/** Parse the mapping a document's leading block holds; no block is an empty mapping. */
function mappingOf(source: string): Record<string, unknown> | null {
  const block = splitFrontMatter(source)
  if (block === null) return {}
  const parsed = parseBlock(blockText(source, block))
  return parsed.kind === 'mapping' ? parsed.data : null
}

/**
 * Re-parse a toggle candidate and decide whether it may be written.
 *
 * `true` only when the source parses to a mapping whose own-key `orientation`
 * presence matches what the line scan found, the candidate parses to a mapping
 * carrying the intended `orientation` state, and every other key is structurally
 * equal (same order, same values).
 * @param source - the document the viewer loaded.
 * @param candidate - the toggled text.
 * @param checked - the state the toggle intended.
 * @returns whether the candidate is safe to post.
 */
export function verifyCandidate(source: string, candidate: string, checked: boolean): boolean {
  const verdict = orientationEditability(source)
  if (!verdict.editable) return false
  const before = mappingOf(source)
  const after = mappingOf(candidate)
  if (before === null || after === null) return false
  if (Object.hasOwn(before, 'orientation') !== (verdict.entry !== undefined)) return false
  if (checked ? after.orientation !== true : Object.hasOwn(after, 'orientation')) return false
  const rest = (data: Record<string, unknown>): Record<string, unknown> => {
    const copy: Record<string, unknown> = {}
    for (const key of Object.keys(data)) if (key !== 'orientation') copy[key] = data[key]
    return copy
  }
  return equalValues(rest(before), rest(after), 0, new Map())
}

/** Mutable budget shared by one formatting pass. */
interface FormatState {
  nodes: number
  readonly path: WeakSet<object>
}

function formatInner(value: unknown, depth: number, state: FormatState): string {
  if (value === null) return 'null'
  if (value === undefined) return ''
  if (typeof value === 'string') return value.length > MAX_FORMAT_CHARS ? `${value.slice(0, MAX_FORMAT_CHARS)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (typeof value !== 'object') return String(value)
  if (state.path.has(value)) return '[circular]'
  if (depth >= MAX_FORMAT_DEPTH || state.nodes >= MAX_FORMAT_NODES) return '…'
  state.nodes += 1
  state.path.add(value)
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_FORMAT_ITEMS).map(item => formatInner(item, depth + 1, state))
      if (value.length > MAX_FORMAT_ITEMS) items.push('…')
      return `[${items.join(', ')}]`
    }
    const keys = Object.keys(value)
    const entries = keys.slice(0, MAX_FORMAT_ITEMS).map(key => `${key}: ${formatInner((value as Record<string, unknown>)[key], depth + 1, state)}`)
    if (keys.length > MAX_FORMAT_ITEMS) entries.push('…')
    return `{${entries.join(', ')}}`
  } finally {
    state.path.delete(value)
  }
}

/**
 * Render any parsed value as bounded text: cycle-safe (`[circular]`), at most 4
 * levels deep, 50 items per array or map, 2,000 characters in all. Never
 * `JSON.stringify`, which throws on the recursive aliases `CORE_SCHEMA` accepts.
 * @param value - a parsed YAML value.
 * @returns text that fits a table cell.
 */
export function formatValue(value: unknown): string {
  const text = formatInner(value, 0, { nodes: 0, path: new WeakSet() })
  return text.length > MAX_FORMAT_CHARS ? `${text.slice(0, MAX_FORMAT_CHARS)}…` : text
}
