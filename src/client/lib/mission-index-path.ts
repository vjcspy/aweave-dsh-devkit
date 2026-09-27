/**
 * Exact validator for a mission `INDEX.md` path: `onOpenIndex`'s payload
 * contract (`@hod/aweave-mission-web`'s embed contract) hands the Host an
 * Aweave-root-relative path, and this module is the pre-filter that decides
 * whether it is even SHAPED like a mission `INDEX.md` before it is joined
 * onto `aweaveRoot` and opened.
 *
 * Ported (pure logic only, no fs) from `mission-core`'s
 * `parseMissionDirPrefix`/`parseIndexPath`
 * (`workspaces/devtools/common/mission-core/src/layout.ts:41-78`) — this repo
 * cannot import that package (a separate git repo with no dependency on the
 * Aweave devtools workspace), so the shape is re-derived here from the same
 * contract: `resources/workspaces/<1-3 segments>/_missions/__<YYMMDD-kebab>/INDEX.md`.
 *
 * This is a PRE-FILTER, not the security boundary: the Host still resolves
 * the joined absolute path through `open-task.ts`'s `planOpenTask`, which
 * refuses to open anything outside the Session's own workspace root. The
 * mission backend itself (`@hod/aweave-mission-server`) is the ultimate
 * authority on what is a real mission path; this validator only rejects an
 * `onOpenIndex` payload that could not possibly be one before any file-system
 * work happens.
 * @module
 */

/** The slug part after `__`: `YYMMDD-kebab[-kebab...]`, mirroring `mission-core`'s `SLUG_RE`. */
const SLUG_RE = /^\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Test whether a project-root-relative path is exactly a mission's
 * `INDEX.md`: `resources/workspaces/<1-3 segments>/_missions/__<slug>/INDEX.md`.
 * @param relPath - candidate path, as `onOpenIndex` received it.
 * @returns whether the path has that exact shape.
 */
export function isMissionIndexPath(relPath: string): boolean {
  const parts = relPath.split('/').filter(part => part.length > 0)
  if (parts.length < 5) return false
  if (parts[0] !== 'resources' || parts[1] !== 'workspaces') return false

  const missionsIdx = parts.indexOf('_missions')
  if (missionsIdx === -1) return false

  const scopeSegments = parts.slice(2, missionsIdx)
  if (scopeSegments.length < 1 || scopeSegments.length > 3) return false
  if (scopeSegments.some(segment => segment.length === 0 || segment.startsWith('.'))) return false

  const missionDirName = parts[missionsIdx + 1]
  if (missionDirName === undefined || !missionDirName.startsWith('__')) return false
  const slug = missionDirName.slice(2)
  if (!SLUG_RE.test(slug)) return false

  const rest = parts.slice(missionsIdx + 2)
  return rest.length === 1 && rest[0] === 'INDEX.md'
}
