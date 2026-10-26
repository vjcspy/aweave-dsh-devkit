/**
 * Pure front-matter block handling for the markdown Properties panel: where the
 * leading `---` block sits in a document, which layouts the `orientation`
 * checkbox may edit, and the single-line text edit that toggles it.
 *
 * No dependencies: this module neither parses YAML (see `frontmatter-yaml.ts`)
 * nor touches the network. Every function is a pure transformation of the exact
 * source text the viewer loaded, so a toggle changes the `orientation` line and
 * nothing else.
 *
 * The block rule is a verbatim port of `markdownPreviewSource` in
 * `dsh-better-sidebar` (`lib/client-editor.js`): the first line (after an
 * optional BOM) must be exactly `---`, and the block ends at the next line that
 * is exactly `---`. A trailing `\r` is ignored on both delimiters. An unclosed
 * block is no block. The panel therefore covers exactly what the wrapped
 * preview hides.
 * @module
 */

/** A closed leading front-matter block located inside a source text. */
export interface FrontMatterBlock {
  /** Whether the source starts with a U+FEFF byte-order mark. */
  readonly bom: boolean
  /** The block's line ending: `\r\n` when the opening delimiter ends with it. */
  readonly eol: '\n' | '\r\n'
  /** The lines between the delimiters, terminators stripped. */
  readonly blockLines: readonly string[]
  /** Offset of the first character after the opening delimiter's line. */
  readonly openEnd: number
  /** Offset where the closing delimiter's line starts. */
  readonly closeStart: number
  /** Offset after the closing delimiter's line terminator (or the source end). */
  readonly closeEnd: number
}

/** Why the orientation checkbox cannot edit a document. */
export type OrientationBlockReason = 'noBlock' | 'mixedEol' | 'unsupportedLayout' | 'duplicateOrientation'

/** One `orientation` entry, as inclusive line indexes into `blockLines`. */
export interface OrientationEntry {
  readonly start: number
  readonly end: number
}

/** Whether the orientation checkbox may edit the document, and the entry it found. */
export type OrientationEditability =
  | { readonly editable: true; readonly entry?: OrientationEntry }
  | { readonly editable: false; readonly reason: OrientationBlockReason }

/** A column-0 key the line editor understands: plain, unquoted, followed by a space or the line end. */
const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*[ \t]*:(?=[ \t]|$)/
/** The `orientation` key at column 0. */
const ORIENTATION_KEY = /^orientation[ \t]*:(?=[ \t]|$)/
const BOM = 0xfeff

/**
 * Locate the closed leading front-matter block of a document.
 * @param source - the document text.
 * @returns the block, or `null` when the document has no closed leading block.
 */
export function splitFrontMatter(source: string): FrontMatterBlock | null {
  const firstLineEnd = source.indexOf('\n')
  if (firstLineEnd === -1) return null
  const bom = source.charCodeAt(0) === BOM
  const firstLineStart = bom ? 1 : 0
  if (source.slice(firstLineStart, firstLineEnd).replace(/\r$/u, '') !== '---') return null
  const eol = source.charAt(firstLineEnd - 1) === '\r' ? '\r\n' : '\n'
  const openEnd = firstLineEnd + 1
  let lineStart = openEnd
  while (lineStart <= source.length) {
    const newline = source.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? source.length : newline
    if (source.slice(lineStart, lineEnd).replace(/\r$/u, '') === '---') {
      const text = source.slice(openEnd, lineStart)
      const blockLines = text === '' ? [] : text.split('\n').slice(0, -1).map(line => line.replace(/\r$/u, ''))
      return { bom, eol, blockLines, openEnd, closeStart: lineStart, closeEnd: newline === -1 ? source.length : newline + 1 }
    }
    if (newline === -1) return null
    lineStart = newline + 1
  }
  return null
}

/**
 * The raw text between the delimiters of a located block.
 * @param source - the document text the block was located in.
 * @param block - the located block.
 * @returns the YAML text the preview hides.
 */
export function blockText(source: string, block: FrontMatterBlock): string {
  return source.slice(block.openEnd, block.closeStart)
}

/** Whether a block line is blank. */
function isBlank(line: string): boolean {
  return line.trim() === ''
}

/** Whether a block line is indented (belongs to the entry above it). */
function isIndented(line: string): boolean {
  return line.startsWith(' ') || line.startsWith('\t')
}

/**
 * Decide whether the `orientation` checkbox may edit a document: the supported
 * layout subset, failing closed.
 *
 * Unsupported: no closed block; a source mixing CRLF with a bare LF (the write
 * route rewrites the whole file to the majority line ending, so unrelated lines
 * would change); a column-0 line that is neither blank, a `#` comment, nor a
 * plain key (this rejects root flow mappings, quoted or explicit keys,
 * sequences, anchors, tags and directives); more than one `orientation` entry.
 * @param source - the document text.
 * @returns the verdict, with the `orientation` entry when one exists.
 */
export function orientationEditability(source: string): OrientationEditability {
  const block = splitFrontMatter(source)
  if (block === null) return { editable: false, reason: 'noBlock' }
  if (/\r\n/u.test(source) && /(?<!\r)\n/u.test(source)) return { editable: false, reason: 'mixedEol' }
  const lines = block.blockLines
  const starts: number[] = []
  for (const [index, line] of lines.entries()) {
    if (isBlank(line) || isIndented(line) || line.startsWith('#')) continue
    if (!PLAIN_KEY.test(line)) return { editable: false, reason: 'unsupportedLayout' }
    if (ORIENTATION_KEY.test(line)) starts.push(index)
  }
  if (starts.length > 1) return { editable: false, reason: 'duplicateOrientation' }
  const start = starts[0]
  if (start === undefined) return { editable: true }
  let end = start
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!
    if (isBlank(line)) continue
    if (!isIndented(line)) break
    end = index
  }
  return { editable: true, entry: { start, end } }
}

/**
 * Toggle the `orientation` pin with a single-entry text edit.
 *
 * Ticking replaces an existing entry in place, or inserts `orientation: true`
 * as the last line before the closing delimiter. Unticking removes the entry
 * (never writing `false`) and, when no non-blank line is left, removes the whole
 * block. Every byte outside the edited lines is preserved.
 * @param source - the exact document text the viewer loaded.
 * @param checked - the desired state.
 * @returns the candidate text, or `null` when the layout is not editable.
 */
export function toggleOrientation(source: string, checked: boolean): string | null {
  const verdict = orientationEditability(source)
  if (!verdict.editable) return null
  const block = splitFrontMatter(source)
  if (block === null) return null
  const raw = blockText(source, block).match(/[^\n]*\n/gu) ?? []
  const entry = verdict.entry
  const head = source.slice(0, block.openEnd)
  const tail = source.slice(block.closeStart)
  if (checked) {
    const line = `orientation: true${block.eol}`
    if (entry === undefined) return `${head}${raw.join('')}${line}${tail}`
    return `${head}${[...raw.slice(0, entry.start), line, ...raw.slice(entry.end + 1)].join('')}${tail}`
  }
  if (entry === undefined) return source
  const left = [...raw.slice(0, entry.start), ...raw.slice(entry.end + 1)]
  if (left.every(line => isBlank(line))) return `${source.slice(0, block.bom ? 1 : 0)}${source.slice(block.closeEnd)}`
  return `${head}${left.join('')}${tail}`
}
