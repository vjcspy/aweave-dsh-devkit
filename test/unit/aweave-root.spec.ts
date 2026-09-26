/**
 * Aweave-root resolution: an explicit configured value, and the derivation walk
 * that finds the platform marker above the Host's working directory.
 *
 * The walk is driven through the injected probe so its ordering is asserted
 * without a filesystem, and one case runs the real probe over a temporary
 * platform root so the `existsSync` wiring is covered too.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { AWEAWE_ROOT_MARKER } from '../../src/config.ts'
import { ancestorsOf, defaultProbe, resolveAweaveRoot, type AweaveRootProbe } from '../../src/host/aweave-root.ts'

/** Temporary platform roots this spec created, removed after each case. */
const created: string[] = []

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** A probe that never finds the marker. */
const noMarker: AweaveRootProbe = { cwd: '/somewhere/else', markerExists: () => false }

/**
 * A probe that answers "marker present" for one directory only.
 * @param root - the directory that carries the marker.
 * @param cwd - the directory the walk starts from.
 * @returns the probe.
 */
function markerAt(root: string, cwd: string): AweaveRootProbe {
  return { cwd, markerExists: markerPath => markerPath === join(root, AWEAWE_ROOT_MARKER) }
}

describe('explicit Config.aweaveRoot', () => {
  it('is authoritative as given', () => {
    expect(resolveAweaveRoot('/opt/aweave', noMarker)).toEqual({ source: 'config', root: '/opt/aweave' })
  })

  it('normalizes a trailing separator', () => {
    expect(resolveAweaveRoot('/opt/aweave/', noMarker)).toEqual({ source: 'config', root: '/opt/aweave' })
  })

  it('ignores surrounding whitespace, and an empty value falls through to derivation', () => {
    const probe = markerAt('/platform', '/platform/workspaces/k/dsh')
    expect(resolveAweaveRoot('  ', probe)).toEqual({ source: 'derived', root: '/platform' })
    expect(resolveAweaveRoot('   /opt/aweave  ', probe)).toEqual({ source: 'config', root: '/opt/aweave' })
  })

  it('is unresolved when it is not an absolute path', () => {
    const resolution = resolveAweaveRoot('opt/aweave', noMarker)
    expect(resolution.source).toBe('unresolved')
    expect(resolution.source === 'unresolved' && resolution.reason).toContain('not an absolute path')
  })
})

describe('derived Aweave root', () => {
  it('finds the marker above the working directory', () => {
    const probe = markerAt('/platform', '/platform/workspaces/k/dsh/aweave-dsh-devkit')
    expect(resolveAweaveRoot('', probe)).toEqual({ source: 'derived', root: '/platform' })
    expect(resolveAweaveRoot(undefined, probe)).toEqual({ source: 'derived', root: '/platform' })
  })

  it('takes the nearest ancestor when more than one could carry the marker', () => {
    const probe: AweaveRootProbe = {
      cwd: '/platform/workspaces/k/dsh',
      markerExists: markerPath => markerPath === join('/platform', AWEAWE_ROOT_MARKER)
        || markerPath === join('/platform/workspaces/k/dsh', AWEAWE_ROOT_MARKER),
    }
    expect(resolveAweaveRoot('', probe)).toEqual({ source: 'derived', root: '/platform/workspaces/k/dsh' })
  })

  it('is unresolved, naming the marker, when nothing above carries it', () => {
    const probe: AweaveRootProbe = { cwd: '/tmp/not-a-platform/nested', markerExists: () => false }
    const resolution = resolveAweaveRoot('', probe)
    expect(resolution.source).toBe('unresolved')
    expect(resolution.source === 'unresolved' && resolution.reason).toContain(AWEAWE_ROOT_MARKER)
    expect(resolution.source === 'unresolved' && resolution.reason).toContain('/tmp/not-a-platform/nested')
  })

  it('walks one directory and every ancestor above it, nearest first', () => {
    const chain = ancestorsOf('/a/b/c')
    expect(chain.slice(0, 3)).toEqual(['/a/b/c', '/a/b', '/a'])
    expect(chain.at(-1)).toBe('/')
    expect(new Set(chain).size).toBe(chain.length)
  })

  it('derives the root from the real filesystem through the default probe', () => {
    const root = mkdtempSync(join(tmpdir(), 'aweave-root-'))
    created.push(root)
    const nested = join(root, 'workspaces', 'k', 'dsh', 'aweave-dsh-devkit')
    const marker = join(root, AWEAWE_ROOT_MARKER)
    mkdirSync(nested, { recursive: true })
    mkdirSync(dirname(marker), { recursive: true })
    writeFileSync(marker, '{}\n')
    // `defaultProbe` is the production probe: the case proves the real
    // `existsSync` wiring finds the marker, not just an injected stand-in.
    expect(resolveAweaveRoot('', { ...defaultProbe, cwd: nested })).toEqual({
      source: 'derived',
      root: resolve(root),
    })
  })

  it('is unresolved for a real directory with no marker above it', () => {
    const root = mkdtempSync(join(tmpdir(), 'aweave-nomarker-'))
    created.push(root)
    expect(resolveAweaveRoot('', { ...defaultProbe, cwd: root }).source).toBe('unresolved')
  })
})
