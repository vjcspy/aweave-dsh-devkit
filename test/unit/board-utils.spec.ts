/**
 * Board maths: rank computation, the drop gate, and the in-column grouping
 * transform.
 *
 * The `evaluateDropRank` cases are the point of this file. Two of them are
 * regression cases for the defect the port FIXES: the extension gated a write on
 * `newRank !== dragged.rank`, which is the dragged task's OWN rank, so a midpoint
 * that rounds onto it produced a silent "no change" AFTER the optimistic reorder
 * had already been painted — a move on screen that never reached disk. Each
 * regression case therefore asserts BOTH halves: what the ported candidate rank is
 * (so the old gate's verdict is provable from the same inputs) and what the new
 * gate decides.
 */
import { describe, expect, it } from 'vitest'

import {
  buildColumns,
  collectTags,
  compareGroupKeys,
  computeDropRank,
  computeGroupedDropRank,
  dropNeighbours,
  emptySelection,
  assembleScope,
  evaluateDropRank,
  evaluateGroupedDropRank,
  flattenScopes,
  groupColumn,
  groupKeyOf,
  isCrossGroupSameColumnDrop,
  isExhaustedGap,
  sortByRank,
  splitScope,
  toggleFacet,
} from '../../src/client/lib/board-utils.ts'
import {
  NO_GROUP_KEY,
  NO_STATUS_ID,
  type ScopeNode,
  type Task,
  type TaskStatus,
} from '../../src/client/lib/types.ts'

/**
 * Build a task with only the fields a case cares about.
 * @param id - task id (also its file path).
 * @param rank - fractional ordering key.
 * @param extra - fields to override.
 * @returns the task.
 */
function task(id: string, rank: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    name: id,
    description: '',
    status: 'todo',
    tags: [],
    rank,
    created: '2026-01-01',
    scope: 'devtools/common',
    filePath: id,
    ...extra,
  }
}

const STATUSES: readonly TaskStatus[] = [
  { id: 'todo', label: 'Todo', color: '#111' },
  { id: 'in-progress', label: 'In progress', color: '#222' },
  { id: 'done', label: 'Done', color: '#333' },
]

describe('scope strings', () => {
  it('assembles a full scope path', () => {
    expect(assembleScope({ workspace: 'devtools', domain: 'common', repo: 'server' })).toBe('devtools/common/server')
  })

  it('assembles a partial scope path by dropping missing levels', () => {
    expect(assembleScope({ workspace: 'devtools', domain: '', repo: '' })).toBe('devtools')
    expect(assembleScope({ workspace: 'devtools', domain: 'common', repo: '' })).toBe('devtools/common')
    expect(assembleScope(emptySelection())).toBe('')
  })

  it('splits a scope path back into its levels, filling absent ones', () => {
    expect(splitScope('devtools/common/server')).toEqual({ workspace: 'devtools', domain: 'common', repo: 'server' })
    expect(splitScope('devtools')).toEqual({ workspace: 'devtools', domain: '', repo: '' })
    expect(splitScope('')).toEqual({ workspace: '', domain: '', repo: '' })
  })

  it('flattens a scope tree depth-first, parents before children', () => {
    const tree: ScopeNode[] = [
      {
        name: 'devtools', scope: 'devtools', level: 1, mirrored: true,
        children: [{
          name: 'common', scope: 'devtools/common', level: 2, mirrored: true,
          children: [{ name: 'server', scope: 'devtools/common/server', level: 3, mirrored: false, children: [] }],
        }],
      },
      { name: 'whill', scope: 'whill', level: 1, mirrored: false, children: [] },
    ]
    expect(flattenScopes(tree).map(node => node.scope)).toEqual([
      'devtools', 'devtools/common', 'devtools/common/server', 'whill',
    ])
  })
})

describe('sortByRank', () => {
  it('orders by rank, breaking ties by creation date', () => {
    const ordered = sortByRank([
      task('c', 2, { created: '2026-03-01' }),
      task('a', 1, { created: '2026-01-01' }),
      task('b', 1, { created: '2025-01-01' }),
    ])
    expect(ordered.map(entry => entry.id)).toEqual(['b', 'a', 'c'])
  })

  it('does not mutate the input array', () => {
    const input = [task('b', 2), task('a', 1)]
    sortByRank(input)
    expect(input.map(entry => entry.id)).toEqual(['b', 'a'])
  })
})

describe('computeDropRank', () => {
  it('returns 1 for a column that holds nothing else', () => {
    expect(computeDropRank([task('a', 7)], 0, 'a')).toBe(1)
  })

  it('prepends below the first task when dropped at the head', () => {
    expect(computeDropRank([task('a', 5), task('b', 9)], 0, 'z')).toBe(4)
  })

  it('appends above the last task when dropped past the end', () => {
    expect(computeDropRank([task('a', 5), task('b', 9)], 2, 'z')).toBe(10)
  })

  it('takes the midpoint when dropped between two tasks', () => {
    expect(computeDropRank([task('a', 5), task('b', 9)], 1, 'z')).toBe(7)
  })

  it('excludes the dragged task before applying the index', () => {
    // The dragged task is still in the array, and index 1 must resolve against the
    // array WITHOUT it: neighbours are a(1) and c(3), so the candidate is 2.
    expect(computeDropRank([task('a', 1), task('b', 20), task('c', 3)], 1, 'b')).toBe(2)
  })

  it('clamps an out-of-range index to the column bounds', () => {
    expect(computeDropRank([task('a', 5)], -3, 'z')).toBe(4)
    expect(computeDropRank([task('a', 5)], 99, 'z')).toBe(6)
  })
})

describe('dropNeighbours', () => {
  it('reports the pair a drop lands between, with the dragged task removed', () => {
    const { before, after } = dropNeighbours([task('a', 1), task('b', 2), task('c', 3)], 1, 'b')
    expect(before?.id).toBe('a')
    expect(after?.id).toBe('c')
  })

  it('reports one-sided neighbours at the head and the tail', () => {
    const atHead = dropNeighbours([task('a', 1), task('b', 2)], 0, 'b')
    expect(atHead.before).toBeUndefined()
    expect(atHead.after?.id).toBe('a')

    const atTail = dropNeighbours([task('a', 1), task('b', 2)], 1, 'a')
    expect(atTail.before?.id).toBe('b')
    expect(atTail.after).toBeUndefined()
  })
})

describe('isExhaustedGap', () => {
  it('reports a duplicate rank as exhausted, since nothing fits between equal values', () => {
    expect(isExhaustedGap(1, 1)).toBe(true)
  })

  it('reports a one-unit-in-the-last-place gap as exhausted', () => {
    // Measured: the gap between `1` and `1 + Number.EPSILON` is BELOW
    // `Number.EPSILON * max(|a|, |b|)`, so the slot admits no midpoint.
    expect(isExhaustedGap(1, 1 + Number.EPSILON)).toBe(true)
  })

  it('reports a wide gap as usable', () => {
    expect(isExhaustedGap(1, 3)).toBe(false)
    expect(isExhaustedGap(0, 1)).toBe(false)
  })

  it('reports an out-of-order pair as exhausted', () => {
    expect(isExhaustedGap(9, 5)).toBe(true)
  })
})

describe('evaluateDropRank', () => {
  it('accepts the head, tail and midpoint candidates of a healthy column', () => {
    const column = [task('a', 1), task('b', 2), task('c', 3)]
    expect(evaluateDropRank(column, 0, 'z')).toEqual({ kind: 'accepted', rank: 0 })
    expect(evaluateDropRank(column, 3, 'z')).toEqual({ kind: 'accepted', rank: 4 })
    expect(evaluateDropRank([task('a', 1), task('c', 3)], 1, 'z')).toEqual({ kind: 'accepted', rank: 2 })
  })

  it('accepts rank 1 when the column holds nothing else', () => {
    expect(evaluateDropRank([task('a', 7)], 0, 'a')).toEqual({ kind: 'accepted', rank: 1 })
  })

  it('accepts a candidate that is strictly between its destination neighbours', () => {
    // The dragged task's own rank (50) is irrelevant; the neighbours are 1 and 3.
    const destination = [task('a', 1), task('drag', 50), task('c', 3)]
    expect(evaluateDropRank(destination, 1, 'drag')).toEqual({ kind: 'accepted', rank: 2 })
  })

  it('reports an exhausted gap for its own distinct condition, never a generic failure', () => {
    // Two tasks share rank 1 — the backend accepts duplicate ranks — so the slot
    // between them admits nothing.
    const destination = [task('a', 1), task('drag', 1), task('c', 1)]
    expect(evaluateDropRank(destination, 1, 'drag')).toEqual({ kind: 'exhausted-gap' })
  })

  it('REGRESSION — a duplicate-rank collision the extension left on screen unwritten', () => {
    // The reorder the extension painted optimistically: `drag` now sits between two
    // tasks whose rank equals its own.
    const destination = [task('a', 1), task('drag', 1), task('c', 1)]

    // Half one, provable from the same inputs: the ported candidate rank EQUALS the
    // dragged task's own rank, so the extension's gate (`newRank !== dragged.rank`)
    // was false and it returned early — after `setColumns` had already painted the
    // move. Nothing was written, and the board showed a position that never reached
    // disk.
    const candidate = computeDropRank(destination, 1, 'drag')
    expect(candidate).toBe(1)
    expect(candidate).toBe(destination[1]!.rank)

    // Half two: the new gate refuses it, and names the condition it is refusing for.
    expect(evaluateDropRank(destination, 1, 'drag')).toEqual({ kind: 'exhausted-gap' })
  })

  it('reports a candidate that is not strictly between its neighbours', () => {
    // `Number.MAX_VALUE + 1` is `Number.MAX_VALUE`, so an append after the largest
    // representable rank cannot be expressed: the candidate collides with the
    // neighbour it was meant to follow.
    const tail = [task('a', Number.MAX_VALUE)]
    expect(computeDropRank(tail, 1, 'z')).toBe(Number.MAX_VALUE)
    expect(evaluateDropRank(tail, 1, 'z')).toEqual({ kind: 'not-between-neighbours' })

    // The mirror case at the head: `-Number.MAX_VALUE - 1` is `-Number.MAX_VALUE`.
    const head = [task('a', -Number.MAX_VALUE)]
    expect(computeDropRank(head, 0, 'z')).toBe(-Number.MAX_VALUE)
    expect(evaluateDropRank(head, 0, 'z')).toEqual({ kind: 'not-between-neighbours' })
  })
})

describe('groupKeyOf', () => {
  const scoped = task('a', 1, { scope: 'devtools/common/server' })

  it('returns a single fixed key when grouping is off', () => {
    expect(groupKeyOf(scoped, 'none')).toBe('__all__')
    expect(groupKeyOf(task('b', 1, { scope: '' }), 'none')).toBe('__all__')
  })

  it('returns the whole scope for the full-scope grouping', () => {
    expect(groupKeyOf(scoped, 'scope')).toBe('devtools/common/server')
  })

  it('returns the matching segment for the three level groupings', () => {
    expect(groupKeyOf(scoped, 'workspace')).toBe('devtools')
    expect(groupKeyOf(scoped, 'domain')).toBe('common')
    expect(groupKeyOf(scoped, 'repository')).toBe('server')
  })

  it('returns the sentinel key for an empty scope', () => {
    expect(groupKeyOf(task('a', 1, { scope: '' }), 'workspace')).toBe(NO_GROUP_KEY)
    expect(groupKeyOf(task('a', 1, { scope: '' }), 'scope')).toBe(NO_GROUP_KEY)
  })

  it('returns the sentinel key when the scope is shallower than the level needs', () => {
    const shallow = task('a', 1, { scope: 'devtools' })
    expect(groupKeyOf(shallow, 'workspace')).toBe('devtools')
    expect(groupKeyOf(shallow, 'domain')).toBe(NO_GROUP_KEY)
    expect(groupKeyOf(shallow, 'repository')).toBe(NO_GROUP_KEY)
  })
})

describe('compareGroupKeys', () => {
  it('orders alphabetically', () => {
    expect(compareGroupKeys('alpha', 'beta')).toBeLessThan(0)
    expect(compareGroupKeys('beta', 'alpha')).toBeGreaterThan(0)
    expect(compareGroupKeys('same', 'same')).toBe(0)
  })

  it('always orders the sentinel key last', () => {
    expect(compareGroupKeys(NO_GROUP_KEY, 'zzz')).toBe(1)
    expect(compareGroupKeys('zzz', NO_GROUP_KEY)).toBe(-1)
    expect(compareGroupKeys(NO_GROUP_KEY, NO_GROUP_KEY)).toBe(0)
  })
})

describe('groupColumn', () => {
  it('partitions stably, preserving the incoming order inside each group', () => {
    const groups = groupColumn([
      task('a', 1, { scope: 'whill/x' }),
      task('b', 2, { scope: 'devtools/y' }),
      task('c', 3, { scope: 'whill/z' }),
    ], 'workspace')
    expect(groups.map(group => group.key)).toEqual(['devtools', 'whill'])
    expect(groups[1]!.tasks.map(entry => entry.id)).toEqual(['a', 'c'])
  })

  it('orders groups alphabetically with the sentinel group last', () => {
    const groups = groupColumn([
      task('a', 1, { scope: '' }),
      task('b', 2, { scope: 'zeta' }),
      task('c', 3, { scope: 'alpha' }),
    ], 'workspace')
    expect(groups.map(group => group.key)).toEqual(['alpha', 'zeta', NO_GROUP_KEY])
  })

  it('yields exactly one group when grouping is off, so rendering has one code path', () => {
    const groups = groupColumn([task('a', 1, { scope: 'x/y' }), task('b', 2, { scope: '' })], 'none')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.tasks).toHaveLength(2)
  })

  it('carries no display copy: a label is its own raw key', () => {
    const groups = groupColumn([task('a', 1, { scope: '' })], 'workspace')
    expect(groups[0]!.label).toBe(NO_GROUP_KEY)
  })

  it('returns no groups for an empty column', () => {
    expect(groupColumn([], 'workspace')).toEqual([])
  })
})

describe('isCrossGroupSameColumnDrop', () => {
  const dragged = task('a', 1, { scope: 'devtools/common' })
  const otherGroup = task('b', 2, { scope: 'whill/mkt' })
  const sameGroup = task('c', 3, { scope: 'devtools/other' })

  it('is true for an in-column drop onto a different group', () => {
    expect(isCrossGroupSameColumnDrop('todo', 'todo', dragged, otherGroup, 'workspace')).toBe(true)
  })

  it('is false for a drop onto the same group', () => {
    expect(isCrossGroupSameColumnDrop('todo', 'todo', dragged, sameGroup, 'workspace')).toBe(false)
  })

  it('is false across columns, which is a real status move', () => {
    expect(isCrossGroupSameColumnDrop('todo', 'done', dragged, otherGroup, 'workspace')).toBe(false)
  })

  it('is false when grouping is off', () => {
    expect(isCrossGroupSameColumnDrop('todo', 'todo', dragged, otherGroup, 'none')).toBe(false)
  })

  it('is false when the pointer is over no card', () => {
    expect(isCrossGroupSameColumnDrop('todo', 'todo', dragged, undefined, 'workspace')).toBe(false)
  })
})

describe('grouped drop rank', () => {
  it('lands at the tail of the dragged card\u2019s own group', () => {
    // Post-move destination: the dragged card sits last inside `devtools`, with a
    // `whill` card after it that must not act as its neighbour.
    const destination = [
      task('a', 1, { scope: 'devtools/common' }),
      task('drag', 2, { scope: 'devtools/common' }),
      task('w', 3, { scope: 'whill/mkt' }),
    ]
    expect(computeGroupedDropRank(destination, 'workspace', 'drag')).toBe(2)
    expect(evaluateGroupedDropRank(destination, 'workspace', 'drag')).toEqual({ kind: 'accepted', rank: 2 })
  })

  it('takes a midpoint within the dragged card\u2019s own group only', () => {
    const destination = [
      task('a', 1, { scope: 'devtools/common' }),
      task('drag', 4, { scope: 'devtools/common' }),
      task('c', 3, { scope: 'devtools/common' }),
      task('w', 9, { scope: 'whill/mkt' }),
    ]
    // The group slice is a(1), drag(4), c(3) — already in the post-move order — and
    // the dragged card's own index there is 1, between 1 and 3.
    expect(computeGroupedDropRank(destination, 'workspace', 'drag')).toBe(2)
    expect(evaluateGroupedDropRank(destination, 'workspace', 'drag')).toEqual({ kind: 'accepted', rank: 2 })
  })

  it('reports a collapsed slot inside the group as an exhausted gap', () => {
    const destination = [
      task('a', 1, { scope: 'devtools/common' }),
      task('drag', 1, { scope: 'devtools/common' }),
      task('c', 1, { scope: 'devtools/common' }),
    ]
    expect(evaluateGroupedDropRank(destination, 'workspace', 'drag')).toEqual({ kind: 'exhausted-gap' })
  })

  it('falls back to the whole column when the dragged card is absent', () => {
    const destination = [task('a', 1, { scope: 'devtools/common' })]
    expect(computeGroupedDropRank(destination, 'workspace', 'missing')).toBe(2)
    expect(evaluateGroupedDropRank(destination, 'workspace', 'missing')).toEqual({ kind: 'accepted', rank: 2 })
  })
})

describe('buildColumns', () => {
  it('seeds one empty column per configured status, plus the trailing no-status column', () => {
    const columns = buildColumns([], STATUSES)
    expect(Object.keys(columns)).toEqual(['todo', 'in-progress', 'done', NO_STATUS_ID])
    expect(columns['todo']).toEqual([])
  })

  it('places a missing or unknown status in the no-status column', () => {
    const columns = buildColumns([
      task('known', 1, { status: 'done' }),
      task('unknown', 2, { status: 'archived' }),
      task('missing', 3, { status: '' }),
    ], STATUSES)
    expect(columns['done']!.map(entry => entry.id)).toEqual(['known'])
    expect(columns[NO_STATUS_ID]!.map(entry => entry.id)).toEqual(['unknown', 'missing'])
  })

  it('rank-sorts every column', () => {
    const columns = buildColumns([
      task('late', 9, { status: 'todo' }),
      task('early', 1, { status: 'todo' }),
    ], STATUSES)
    expect(columns['todo']!.map(entry => entry.id)).toEqual(['early', 'late'])
  })

  it('still yields the no-status column when the backend configures no statuses', () => {
    const columns = buildColumns([task('a', 1, { status: 'anything' })], [])
    expect(Object.keys(columns)).toEqual([NO_STATUS_ID])
    expect(columns[NO_STATUS_ID]!.map(entry => entry.id)).toEqual(['a'])
  })
})

describe('collectTags', () => {
  it('returns the distinct vocabulary in locale order', () => {
    expect(collectTags([
      task('a', 1, { tags: ['beta', 'alpha'] }),
      task('b', 2, { tags: ['alpha', 'gamma'] }),
    ])).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('returns nothing for tasks without tags', () => {
    expect(collectTags([task('a', 1)])).toEqual([])
  })
})

describe('toggleFacet', () => {
  it('adds an absent value and removes a present one', () => {
    expect(toggleFacet(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleFacet(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('does not mutate the input list', () => {
    const input = ['a']
    toggleFacet(input, 'b')
    expect(input).toEqual(['a'])
  })
})
