/**
 * Exact validator for a mission `INDEX.md` path.
 *
 * The logic moved to `src/mission-path.ts` so the Host half gates its
 * `missions/tree` and `missions/file` routes with the same shape checks; this
 * module stays as the browser half's import point.
 * @module
 */

export { isMissionIndexPath } from '../../mission-path.ts'
