/**
 * `isMissionIndexPath`: the pre-filter shape check for an `onOpenIndex`
 * payload, ported from `mission-core`'s `parseMissionDirPrefix`/`parseIndexPath`.
 *
 * Every accepted case is exactly `resources/workspaces/<1-3 segments>/_missions/__<YYMMDD-kebab>/INDEX.md`;
 * every rejected case names one dimension the real payload could get wrong
 * (wrong root, wrong scope depth, malformed slug, wrong leaf file, or a
 * sibling file inside the mission's own directory).
 */
import { describe, expect, it } from 'vitest'

import { isMissionIndexPath } from '../../src/client/lib/mission-index-path.ts'

describe('isMissionIndexPath — accepted shapes', () => {
  it('accepts a one-segment scope', () => {
    expect(isMissionIndexPath('resources/workspaces/k/_missions/__260926-probe/INDEX.md')).toBe(true)
  })

  it('accepts a two-segment scope', () => {
    expect(isMissionIndexPath('resources/workspaces/k/dsh/_missions/__260926-probe/INDEX.md')).toBe(true)
  })

  it('accepts a three-segment scope', () => {
    expect(isMissionIndexPath('resources/workspaces/devtools/common/server/_missions/__260926-probe/INDEX.md')).toBe(true)
  })

  it('accepts a multi-word kebab slug', () => {
    expect(isMissionIndexPath('resources/workspaces/k/dsh/_missions/__260926-mission-orchestrator-and-board/INDEX.md')).toBe(true)
  })
})

describe('isMissionIndexPath — rejected shapes', () => {
  it('rejects a path with no _missions segment at all', () => {
    expect(isMissionIndexPath('resources/workspaces/k/dsh/_tasks/260926-probe.md')).toBe(false)
  })

  it('rejects a path rooted anywhere but resources/workspaces', () => {
    expect(isMissionIndexPath('workspaces/k/dsh/_missions/__260926-probe/INDEX.md')).toBe(false)
    expect(isMissionIndexPath('resources/k/dsh/_missions/__260926-probe/INDEX.md')).toBe(false)
  })

  it('rejects a scope with no segments or more than three', () => {
    expect(isMissionIndexPath('resources/workspaces/_missions/__260926-probe/INDEX.md')).toBe(false)
    expect(isMissionIndexPath('resources/workspaces/a/b/c/d/_missions/__260926-probe/INDEX.md')).toBe(false)
  })

  it('rejects a mission directory name missing the __ prefix', () => {
    expect(isMissionIndexPath('resources/workspaces/k/dsh/_missions/260926-probe/INDEX.md')).toBe(false)
  })

  it('rejects a malformed slug (no date prefix, or not kebab-case)', () => {
    expect(isMissionIndexPath('resources/workspaces/k/dsh/_missions/__probe/INDEX.md')).toBe(false)
    expect(isMissionIndexPath('resources/workspaces/k/dsh/_missions/__260926_probe/INDEX.md')).toBe(false)
    expect(isMissionIndexPath('resources/workspaces/k/dsh/_missions/__26092-probe/INDEX.md')).toBe(false)
  })

  it('rejects a leaf file other than INDEX.md, even a sibling inside the same mission directory', () => {
    expect(isMissionIndexPath('resources/workspaces/k/dsh/_missions/__260926-probe/_progress/01-plan.md')).toBe(false)
    expect(isMissionIndexPath('resources/workspaces/k/dsh/_missions/__260926-probe/_goals/01-goal.md')).toBe(false)
    expect(isMissionIndexPath('resources/workspaces/k/dsh/_missions/__260926-probe/index.md')).toBe(false)
  })

  it('rejects the mission directory itself, with no leaf file named', () => {
    expect(isMissionIndexPath('resources/workspaces/k/dsh/_missions/__260926-probe')).toBe(false)
  })

  it('rejects an empty or root-only path', () => {
    expect(isMissionIndexPath('')).toBe(false)
    expect(isMissionIndexPath('/')).toBe(false)
  })
})
