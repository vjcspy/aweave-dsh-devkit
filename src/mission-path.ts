/**
 * Exact shape validators for mission paths, shared by both halves.
 *
 * The browser half pre-filters an `onOpenIndex` payload and a viewer link with
 * these checks, and the Host half gates every `missions/tree` and
 * `missions/file` request with the SAME functions, so the two can never
 * disagree about what a mission path looks like.
 *
 * This module is deliberately dependency-free (no `node:` import, no DOM): the
 * browser bundle compiles it through `tsconfig.client.json`, and the Host
 * compile (`rootDir: src`, `src/client` excluded) emits it per file.
 *
 * Ported (pure logic only, no fs) from `mission-core`'s
 * `parseMissionDirPrefix`/`parseIndexPath`
 * (`workspaces/devtools/common/mission-core/src/layout.ts:41-78`) — this repo
 * cannot import that package (a separate git repo with no dependency on the
 * Aweave devtools workspace), so the shape is re-derived here from the same
 * contract: `resources/workspaces/<1-3 segments>/_missions/__<YYMMDD-kebab>/INDEX.md`.
 *
 * These are PRE-FILTERS, not the security boundary: the Host still confines
 * every resolved path by realpath (`host/mission-files.ts`), and the Session
 * open path still resolves through `planOpenTask`.
 * @module
 */

/** The slug part after `__`: `YYMMDD-kebab[-kebab...]`, mirroring `mission-core`'s `SLUG_RE`. */
const SLUG_RE = /^\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Longest accepted project-root-relative path, in characters. */
export const MAX_PATH_LENGTH = 1024

/**
 * Find where a mission folder ends inside a path's segments.
 * @param parts - non-empty path segments.
 * @returns the index of the first segment after the mission folder, or `-1` when the segments do not start with one.
 */
function missionDirEnd(parts: readonly string[]): number {
  if (parts.length < 5) return -1
  if (parts[0] !== 'resources' || parts[1] !== 'workspaces') return -1

  const missionsIdx = parts.indexOf('_missions')
  if (missionsIdx === -1) return -1

  const scopeSegments = parts.slice(2, missionsIdx)
  if (scopeSegments.length < 1 || scopeSegments.length > 3) return -1
  if (scopeSegments.some(segment => segment.length === 0 || segment.startsWith('.'))) return -1

  const missionDirName = parts[missionsIdx + 1]
  if (missionDirName === undefined || !missionDirName.startsWith('__')) return -1
  if (!SLUG_RE.test(missionDirName.slice(2))) return -1
  return missionsIdx + 2
}

/**
 * Test whether a project-root-relative path is exactly a mission's
 * `INDEX.md`: `resources/workspaces/<1-3 segments>/_missions/__<slug>/INDEX.md`.
 * @param relPath - candidate path, as `onOpenIndex` received it.
 * @returns whether the path has that exact shape.
 */
export function isMissionIndexPath(relPath: string): boolean {
  const parts = relPath.split('/').filter(part => part.length > 0)
  const end = missionDirEnd(parts)
  if (end === -1) return false
  const rest = parts.slice(end)
  return rest.length === 1 && rest[0] === 'INDEX.md'
}

/**
 * Test whether a string is a clean project-root-relative path: bounded length,
 * no NUL, no backslash, no leading `/`, and every `/`-segment non-empty and not
 * `.` or `..`.
 * @param value - candidate path.
 * @returns whether the path is clean.
 */
function isCleanRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_PATH_LENGTH) return false
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/')) return false
  return value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * Test whether a value is exactly a mission folder id:
 * `resources/workspaces/<1-3 segments>/_missions/__<slug>`, with no trailing segment.
 * @param id - candidate id, as `MissionDetailDto.id` carries it.
 * @returns whether the id has that exact shape.
 */
export function isMissionDir(id: unknown): id is string {
  if (!isCleanRelativePath(id)) return false
  const parts = id.split('/')
  return missionDirEnd(parts) === parts.length
}

/**
 * Test whether a value is a clean `resources/**` markdown path.
 * @param path - candidate project-root-relative path.
 * @returns whether the path is clean, starts with `resources/` and ends with `.md`.
 */
export function isResourcesMarkdownPath(path: unknown): path is string {
  if (!isCleanRelativePath(path)) return false
  const parts = path.split('/')
  return parts.length >= 2 && parts[0] === 'resources' && path.endsWith('.md')
}
