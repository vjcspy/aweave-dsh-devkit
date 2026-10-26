/**
 * The Missions page's read-only filesystem surface: confinement, the mission
 * folder walk, and the markdown file read.
 *
 * This is the plugin's only code that reads the Host's disk, so confinement is a
 * security property: the repository is public and the deployment is reachable
 * through a tunnel. The order is fixed. A strict SHAPE check (`mission-path.ts`)
 * rejects `..`, absolute paths, backslashes and NULs before the disk is touched;
 * then BOTH the root's `resources/` directory and the candidate are resolved
 * with `realpath`, and the candidate is accepted only when it equals the base or
 * sits below it by a separator-aware prefix comparison, so a symlink that points
 * out of `resources/` is caught after resolution.
 *
 * Everything is pure over {@link FsFacade}, a narrow slice of `node:fs/promises`,
 * so the logic does not depend on filesystem wiring. Messages echo only
 * project-root-relative paths, never an absolute Host path.
 * @module
 */
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'

import { MAX_FILE_BYTES, MAX_TREE_DEPTH, MAX_TREE_ENTRIES } from '../config.ts'
import { isMissionDir, isResourcesMarkdownPath } from '../mission-path.ts'

/** Error codes the two routes answer with. */
export type MissionFileErrorCode =
  | 'INVALID_MISSION_ID'
  | 'INVALID_PATH'
  | 'PATH_OUTSIDE_RESOURCES'
  | 'NOT_A_MARKDOWN_FILE'
  | 'NOT_FOUND'
  | 'FILE_TOO_LARGE'
  | 'AWEAVE_ROOT_UNRESOLVED'
  | 'AWEAVE_RESOURCES_UNAVAILABLE'
  | 'READ_FAILED'

/** HTTP status each error code answers with. */
export const MISSION_FILE_STATUS: Readonly<Record<MissionFileErrorCode, number>> = {
  INVALID_MISSION_ID: 400,
  INVALID_PATH: 400,
  PATH_OUTSIDE_RESOURCES: 400,
  NOT_A_MARKDOWN_FILE: 400,
  NOT_FOUND: 404,
  FILE_TOO_LARGE: 413,
  AWEAVE_ROOT_UNRESOLVED: 409,
  AWEAVE_RESOURCES_UNAVAILABLE: 409,
  READ_FAILED: 500,
}

/** The fix every `409` names. */
const ROOT_FIX = 'set the aweaveRoot plugin setting of aweave-dsh-devkit to the Aweave platform root'

/** A refused or failed mission file operation. */
export class MissionFileError extends Error {
  readonly code: MissionFileErrorCode
  /** Size in bytes of an oversized file; present on `FILE_TOO_LARGE` only. */
  readonly size: number | undefined

  constructor(code: MissionFileErrorCode, message: string, size?: number) {
    super(message)
    this.name = 'MissionFileError'
    this.code = code
    this.size = size
  }
}

/** The `Stats` facts the module reads. */
export interface StatsLike {
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
  readonly size: number
  readonly mtimeMs: number
}

/** One directory entry as `opendir` yields it. */
export interface DirEntryLike {
  readonly name: string
}

/** An open directory handle. */
export interface DirLike extends AsyncIterable<DirEntryLike> {
  close(): Promise<void>
}

/** An open file handle. */
export interface FileHandleLike {
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ readonly bytesRead: number }>
  close(): Promise<void>
}

/** The slice of `node:fs/promises` this module uses. */
export interface FsFacade {
  realpath(path: string): Promise<string>
  lstat(path: string): Promise<StatsLike>
  stat(path: string): Promise<StatsLike>
  opendir(path: string): Promise<DirLike>
  open(path: string): Promise<FileHandleLike>
}

/** The real filesystem. */
export const nodeFs: FsFacade = {
  realpath: async path => await realpath(path),
  lstat: async path => await lstat(path),
  stat: async path => await stat(path),
  opendir: async path => await opendir(path),
  open: async path => await open(path, 'r'),
}

/** One node of a mission folder tree. */
export interface TreeNode {
  /** Project-root-relative path. */
  readonly path: string
  readonly name: string
  readonly kind: 'dir' | 'file'
  readonly size?: number
  readonly mtimeMs?: number
  readonly children?: readonly TreeNode[]
}

/** A mission folder's markdown tree. */
export interface MissionTree {
  /** The mission folder id the tree was read for. */
  readonly id: string
  /** `true` when the entry budget or the depth limit stopped the walk early. */
  readonly truncated: boolean
  readonly entries: readonly TreeNode[]
}

/** One markdown file's content. */
export interface MissionFile {
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
  readonly content: string
}

/**
 * Read a Node error's `code` without assuming the thrown value is an `Error`.
 * @param error - the caught value.
 * @returns the `code` string, or `undefined`.
 */
function errnoOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/**
 * Map a failed filesystem call on the REQUESTED candidate onto a mission error.
 * @param error - the caught value.
 * @param relPath - the project-root-relative path the request named.
 * @returns the error to throw.
 */
function candidateFailure(error: unknown, relPath: string): MissionFileError {
  const code = errnoOf(error)
  if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') {
    return new MissionFileError('NOT_FOUND', `${relPath} does not exist`)
  }
  return new MissionFileError('READ_FAILED', `${relPath} could not be read${code === undefined ? '' : ` (${code})`}`)
}

/** A path resolved inside the confinement root. */
export interface Confined {
  /** Real path of `<root>/resources`. */
  readonly base: string
  /** Real path of the candidate. */
  readonly target: string
}

/**
 * Resolve a candidate and prove it sits inside `<root>/resources`.
 * @param fs - filesystem facade.
 * @param rootDir - the Aweave platform root.
 * @param relPath - shape-checked project-root-relative candidate.
 * @returns the real base and the real target.
 * @throws MissionFileError `AWEAVE_RESOURCES_UNAVAILABLE` when the root has no readable `resources/`,
 * `NOT_FOUND` when the candidate does not exist, `PATH_OUTSIDE_RESOURCES` when it resolves elsewhere.
 */
export async function confine(fs: FsFacade, rootDir: string, relPath: string): Promise<Confined> {
  let base: string
  try {
    base = await fs.realpath(join(rootDir, 'resources'))
  } catch {
    // `resolveAweaveRoot` never checks that the root exists, so a wrong root
    // surfaces here and must not read as a missing FILE.
    throw new MissionFileError(
      'AWEAVE_RESOURCES_UNAVAILABLE',
      `the configured Aweave root has no readable resources/ directory; ${ROOT_FIX}`,
    )
  }
  let target: string
  try {
    target = await fs.realpath(join(rootDir, relPath))
  } catch (error: unknown) {
    throw candidateFailure(error, relPath)
  }
  if (target !== base && !target.startsWith(base + sep)) {
    throw new MissionFileError('PATH_OUTSIDE_RESOURCES', `${relPath} resolves outside resources/`)
  }
  return { base, target }
}

/** Mutable state one walk shares across its recursion. */
interface WalkState {
  budget: number
  truncated: boolean
}

/**
 * List one directory level and recurse into its subdirectories.
 * @param fs - filesystem facade.
 * @param realDir - real path of the directory to list.
 * @param relDir - its project-root-relative path.
 * @param depth - this level's depth; the mission folder's own entries are level 1.
 * @param state - shared entry budget and truncation flag.
 * @returns the level's nodes, sorted by name.
 */
async function walk(
  fs: FsFacade,
  realDir: string,
  relDir: string,
  depth: number,
  state: WalkState,
): Promise<TreeNode[]> {
  const nodes: TreeNode[] = []
  const dir = await fs.opendir(realDir)
  try {
    for await (const entry of dir) {
      if (state.budget <= 0) {
        state.truncated = true
        break
      }
      // Every inspected entry spends budget, skipped ones included, so a folder
      // of dot-files or links cannot defeat the bound.
      state.budget -= 1
      if (entry.name.startsWith('.')) continue
      const realPath = join(realDir, entry.name)
      const info = await fs.lstat(realPath)
      if (info.isSymbolicLink()) continue
      const relPath = `${relDir}/${entry.name}`
      if (info.isDirectory()) {
        if (depth >= MAX_TREE_DEPTH) {
          state.truncated = true
          nodes.push({ path: relPath, name: entry.name, kind: 'dir', children: [] })
          continue
        }
        const children = await walk(fs, realPath, relPath, depth + 1, state)
        nodes.push({ path: relPath, name: entry.name, kind: 'dir', children })
      } else if (info.isFile() && entry.name.endsWith('.md')) {
        nodes.push({ path: relPath, name: entry.name, kind: 'file', size: info.size, mtimeMs: info.mtimeMs })
      }
    }
  } finally {
    await dir.close().catch(() => undefined)
  }
  return nodes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * Read a mission folder's markdown tree.
 * @param fs - filesystem facade.
 * @param rootDir - the Aweave platform root.
 * @param id - candidate mission folder id.
 * @returns the tree.
 * @throws MissionFileError on a bad id, an escaped or missing folder, or an IO failure.
 */
export async function readMissionTree(fs: FsFacade, rootDir: string, id: unknown): Promise<MissionTree> {
  if (!isMissionDir(id)) {
    throw new MissionFileError('INVALID_MISSION_ID', 'id must be a mission folder: resources/workspaces/<scope>/_missions/__<YYMMDD-slug>')
  }
  const { target } = await confine(fs, rootDir, id)
  let info: StatsLike
  try {
    info = await fs.stat(target)
  } catch (error: unknown) {
    throw candidateFailure(error, id)
  }
  if (!info.isDirectory()) throw new MissionFileError('NOT_FOUND', `${id} is not a directory`)
  const state: WalkState = { budget: MAX_TREE_ENTRIES, truncated: false }
  try {
    const entries = await walk(fs, target, id, 1, state)
    return { id, truncated: state.truncated, entries }
  } catch (error: unknown) {
    if (error instanceof MissionFileError) throw error
    throw candidateFailure(error, id)
  }
}

/**
 * Read at most `limit` bytes through a handle, continuing across short reads.
 * @param handle - open file handle.
 * @param limit - the most bytes to read.
 * @returns the bytes read; a length equal to `limit` means the file may hold more.
 */
async function readUpTo(handle: FileHandleLike, limit: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(limit)
  let total = 0
  while (total < limit) {
    const { bytesRead } = await handle.read(buffer, total, limit - total, total)
    if (bytesRead === 0) break
    total += bytesRead
  }
  return buffer.subarray(0, total)
}

/**
 * Read one markdown file under `resources/`.
 * @param fs - filesystem facade.
 * @param rootDir - the Aweave platform root.
 * @param path - candidate project-root-relative path.
 * @returns the file's content and facts.
 * @throws MissionFileError on a bad path, an escape, a non-markdown target, an oversized or missing file, or an IO failure.
 */
export async function readMarkdownFile(fs: FsFacade, rootDir: string, path: unknown): Promise<MissionFile> {
  if (!isResourcesMarkdownPath(path)) {
    throw new MissionFileError('INVALID_PATH', 'path must be a clean resources/**.md path')
  }
  const { target } = await confine(fs, rootDir, path)
  if (!target.endsWith('.md')) {
    throw new MissionFileError('NOT_A_MARKDOWN_FILE', `${path} does not resolve to a markdown file`)
  }
  let info: StatsLike
  try {
    info = await fs.stat(target)
  } catch (error: unknown) {
    throw candidateFailure(error, path)
  }
  if (!info.isFile()) throw new MissionFileError('NOT_A_MARKDOWN_FILE', `${path} is not a regular file`)
  if (info.size > MAX_FILE_BYTES) {
    throw new MissionFileError('FILE_TOO_LARGE', `${path} is ${info.size} bytes; the limit is ${MAX_FILE_BYTES}`, info.size)
  }
  let bytes: Uint8Array
  try {
    const handle = await fs.open(target)
    try {
      bytes = await readUpTo(handle, MAX_FILE_BYTES + 1)
    } finally {
      await handle.close().catch(() => undefined)
    }
  } catch (error: unknown) {
    throw candidateFailure(error, path)
  }
  if (bytes.length > MAX_FILE_BYTES) {
    // The file grew between `stat` and the read.
    throw new MissionFileError('FILE_TOO_LARGE', `${path} is larger than ${MAX_FILE_BYTES} bytes`, bytes.length)
  }
  return { path, size: bytes.length, mtimeMs: info.mtimeMs, content: new TextDecoder('utf-8').decode(bytes) }
}
