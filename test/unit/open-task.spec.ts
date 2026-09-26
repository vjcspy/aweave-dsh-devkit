/**
 * Opening a task's markdown: absolute-path resolution and the degradation
 * decision.
 *
 * The contract under test is the one that makes the open correct at all. A task id
 * is Aweave-root-relative and `fileAddressFor` passes a relative path through
 * WITHOUT resolving it against the Session root, so a caller that skipped the join
 * would name the wrong file. Every case here therefore asserts one of exactly two
 * things: an address that is provably Session-relative and provably the task's
 * real path, or a refusal that names the root the Session would need.
 */
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { describe, expect, it } from 'vitest'

import { joinAbsolutePath, planOpenTask } from '../../src/client/open-task.ts'

/** The platform root used by the happy-path cases. */
const ROOT = '/Users/p/aweave'

/** A task path as the backend reports it: relative to the Aweave root. */
const TASK_PATH = 'workspaces/devtools/common/tasklist/x.md'

/** The Session id every case opens under. */
const SESSION = 'session-1'

describe('joinAbsolutePath', () => {
  it('joins a POSIX root and a relative path', () => {
    expect(joinAbsolutePath('/a/b', 'c/d.md')).toBe('/a/b/c/d.md')
  })

  it('trims trailing separators from the root and leading ones from the path', () => {
    expect(joinAbsolutePath('/a/b/', '/c.md')).toBe('/a/b/c.md')
    expect(joinAbsolutePath('/a/b///', '///c.md')).toBe('/a/b/c.md')
  })

  it('normalizes Windows separators, since a Session root may be spelled either way', () => {
    expect(joinAbsolutePath('C:\\a\\b', 'c\\d.md')).toBe('C:/a/b/c/d.md')
  })

  it('returns the root for an empty relative path', () => {
    expect(joinAbsolutePath('/a/b/', '')).toBe('/a/b')
    expect(joinAbsolutePath('/', 'x.md')).toBe('/x.md')
  })
})

describe('planOpenTask — the openable cases', () => {
  it('opens when the Session is rooted at the Aweave root', () => {
    const plan = planOpenTask({ aweaveRoot: ROOT, sessionId: SESSION, cwd: ROOT, filePath: TASK_PATH })
    expect(plan.kind).toBe('open')
    if (plan.kind !== 'open') return
    expect(plan.path).toBe(`${ROOT}/${TASK_PATH}`)
    // The address must be Session-relative: that is the proof the join happened,
    // because a relative path handed to `fileAddressFor` passes through unresolved.
    expect(parseFileAddress(plan.address)).toEqual({ scope: 'session', sessionId: SESSION, path: TASK_PATH })
  })

  it('opens when the Session is rooted at an ancestor of the Aweave root, relative to that root', () => {
    const cwd = '/Users/p'
    const plan = planOpenTask({ aweaveRoot: ROOT, sessionId: SESSION, cwd, filePath: TASK_PATH })
    expect(plan.kind).toBe('open')
    if (plan.kind !== 'open') return
    expect(parseFileAddress(plan.address)).toEqual({
      scope: 'session',
      sessionId: SESSION,
      path: 'aweave/workspaces/devtools/common/tasklist/x.md',
    })
  })

  it('opens when the Session is rooted BELOW the Aweave root, relative to that deeper root', () => {
    const cwd = `${ROOT}/workspaces`
    const plan = planOpenTask({ aweaveRoot: ROOT, sessionId: SESSION, cwd, filePath: TASK_PATH })
    expect(plan.kind).toBe('open')
    if (plan.kind !== 'open') return
    expect(parseFileAddress(plan.address)).toEqual({
      scope: 'session',
      sessionId: SESSION,
      path: 'devtools/common/tasklist/x.md',
    })
  })

  it('tolerates a trailing separator on either the root or the Session workspace', () => {
    const plan = planOpenTask({ aweaveRoot: `${ROOT}/`, sessionId: SESSION, cwd: `${ROOT}/`, filePath: TASK_PATH })
    expect(plan.kind).toBe('open')
    if (plan.kind !== 'open') return
    expect(parseFileAddress(plan.address)).toEqual({ scope: 'session', sessionId: SESSION, path: TASK_PATH })
  })

  it('encodes a path segment so a space or a hash survives the round trip', () => {
    const filePath = 'resources/workspaces/k/dsh/_plans/260926-a #1.md'
    const plan = planOpenTask({ aweaveRoot: ROOT, sessionId: SESSION, cwd: ROOT, filePath })
    expect(plan.kind).toBe('open')
    if (plan.kind !== 'open') return
    expect(parseFileAddress(plan.address)).toEqual({ scope: 'session', sessionId: SESSION, path: filePath })
  })
})

describe('planOpenTask — no Aweave root', () => {
  it('refuses when the Host published no root', () => {
    expect(planOpenTask({ aweaveRoot: null, sessionId: SESSION, cwd: ROOT, filePath: TASK_PATH }))
      .toEqual({ kind: 'no-aweave-root' })
    expect(planOpenTask({ aweaveRoot: undefined, sessionId: SESSION, cwd: ROOT, filePath: TASK_PATH }))
      .toEqual({ kind: 'no-aweave-root' })
    expect(planOpenTask({ aweaveRoot: '', sessionId: SESSION, cwd: ROOT, filePath: TASK_PATH }))
      .toEqual({ kind: 'no-aweave-root' })
  })

  it('refuses a relative root, which cannot yield the absolute path an address needs', () => {
    expect(planOpenTask({ aweaveRoot: 'aweave', sessionId: SESSION, cwd: ROOT, filePath: TASK_PATH }))
      .toEqual({ kind: 'no-aweave-root' })
  })
})

describe('planOpenTask — degradation on a non-root Session workspace', () => {
  it('refuses when the Session reports no workspace root, naming the path it would have opened', () => {
    const plan = planOpenTask({ aweaveRoot: ROOT, sessionId: SESSION, cwd: undefined, filePath: TASK_PATH })
    expect(plan).toEqual({ kind: 'no-session-root', path: `${ROOT}/${TASK_PATH}` })
  })

  it('treats an empty Session root as no root at all', () => {
    expect(planOpenTask({ aweaveRoot: ROOT, sessionId: SESSION, cwd: '', filePath: TASK_PATH }))
      .toEqual({ kind: 'no-session-root', path: `${ROOT}/${TASK_PATH}` })
  })

  it('refuses when the Session workspace does not contain the task, naming both paths', () => {
    const plan = planOpenTask({ aweaveRoot: ROOT, sessionId: SESSION, cwd: '/tmp/elsewhere', filePath: TASK_PATH })
    expect(plan).toEqual({
      kind: 'outside-session-root',
      path: `${ROOT}/${TASK_PATH}`,
      cwd: '/tmp/elsewhere',
    })
  })

  it('does not mistake a sibling directory that merely shares a prefix for containment', () => {
    // `/Users/p/aweave-other` starts with `/Users/p/aweave`, so a naive
    // `startsWith(root)` would wrongly authorize the open.
    const plan = planOpenTask({ aweaveRoot: ROOT, sessionId: SESSION, cwd: '/Users/p/aweave-other', filePath: TASK_PATH })
    expect(plan.kind).toBe('outside-session-root')
  })

  it('never produces an `absolute`-scope address, which would need no authorizing Session', () => {
    const refused = planOpenTask({ aweaveRoot: ROOT, sessionId: SESSION, cwd: '/tmp/x', filePath: TASK_PATH })
    expect(refused).not.toHaveProperty('address')
  })
})
