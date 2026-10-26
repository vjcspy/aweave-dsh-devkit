/**
 * `toggleOrientation` — the single-line edit the Properties panel's `orientation`
 * checkbox writes. Each case pins one behaviour the platform contract depends on
 * (`orientation: true` pins, the line is removed rather than set to `false`) and
 * that a regression would corrupt a user's document silently.
 */
import { describe, expect, it } from 'vitest'

import { toggleOrientation } from '../../src/client/lib/frontmatter-block.ts'

describe('toggleOrientation', () => {
  it('ticks by inserting `orientation: true` last in the block and leaves every other line byte-identical', () => {
    const source = '---\nname: X\ntags: [a, b]\ncreated: 2026-08-27\n---\n# Body\n'
    expect(toggleOrientation(source, true)).toBe('---\nname: X\ntags: [a, b]\ncreated: 2026-08-27\norientation: true\n---\n# Body\n')
  })

  it('ticks by replacing an existing `orientation: false` line in place', () => {
    const source = '---\nname: X\norientation: false\ntags: [a]\n---\nBody\n'
    expect(toggleOrientation(source, true)).toBe('---\nname: X\norientation: true\ntags: [a]\n---\nBody\n')
  })

  it('unticks by removing the line, never writing `false`', () => {
    const source = '---\nname: X\norientation: true\ntags: [a]\n---\nBody\n'
    const result = toggleOrientation(source, false)
    expect(result).toBe('---\nname: X\ntags: [a]\n---\nBody\n')
    expect(result).not.toContain('false')
  })

  it('unticks the only key by removing the whole block', () => {
    expect(toggleOrientation('---\norientation: true\n---\n# Body\n', false)).toBe('# Body\n')
  })

  it('returns null for a source with no closed leading block', () => {
    expect(toggleOrientation('# Body\n\nno front-matter\n', true)).toBeNull()
    expect(toggleOrientation('---\nname: X\n# never closed\n', true)).toBeNull()
  })
})
