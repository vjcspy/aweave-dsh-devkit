/**
 * The `window.AweaveMissionBoard` contract this plugin loads at runtime from
 * `@hod/aweave-mission-web`'s `embed.js` — a plain `<script src>` load, not a
 * module import, so this repo (a separate git checkout with no dependency on
 * the Aweave devtools workspace) cannot import `@hod/aweave-mission-web`'s
 * own TypeScript types. This module re-declares the SAME shape
 * (`workspaces/devtools/common/mission-web/src/embed.tsx`'s
 * `MissionBoardEmbedOptions`/`MissionBoardHandle`/`AweaveMissionBoardGlobal`
 * and `lib/transport.ts`'s `MissionTransport`) so this plugin's own code is
 * type-checked against it; nothing here is imported or re-exported by
 * `embed.js` itself, it is purely this plugin's ambient contract.
 * @module
 */

/** Payload one `updateMission` call carries; mirrors `mission-web`'s `UpdateMissionInput`. */
export interface UpdateMissionInput {
  readonly id: string
  readonly status?: string
  readonly rank?: number
  readonly expectedMtimeMs?: number
}

/**
 * The board's data-access boundary, exactly as `mission-web`'s `lib/transport.ts` declares it.
 *
 * `subscribeEvents` is intentionally OMITTED by this plugin's own
 * implementation (`mission-transport.ts`): the fenced JSON forwarder buffers
 * every upstream body (`host/forward.ts`), so an endless SSE response would
 * end as a `502`. Declaring it optional here matches the B0 embed contract
 * change (`mission-web`'s `Board` polls `listMissions` every 5s plus a
 * refresh on window focus/visibilitychange when a transport omits it).
 */
export interface MissionTransport {
  getConfig(): Promise<unknown>
  listMissions(): Promise<unknown[]>
  getMissionDetail(id: string, progress?: number): Promise<unknown>
  updateMission(input: UpdateMissionInput): Promise<unknown>
  subscribeEvents?(onChanged: (ids: string[]) => void): () => void
}

/** `mount(el, options)`'s options, mirroring `mission-web`'s `MissionBoardEmbedOptions`. */
export interface MissionBoardEmbedOptions {
  /** Base URL for the mission API; ignored when `transport` is provided. */
  readonly baseUrl?: string
  /** A host-provided transport, overriding the default `fetch`/`EventSource` one. */
  readonly transport?: MissionTransport
  /** Called instead of the built-in detail panel when a card is selected. */
  readonly onOpenIndex?: (indexPath: string) => void
  /** CSS custom properties (`--mb-*`) applied on the shadow container element. */
  readonly theme?: Readonly<Record<string, string>>
}

/** The handle `mount()` returns. */
export interface MissionBoardHandle {
  update(options: MissionBoardEmbedOptions): void
  unmount(): void
}

/** The global `embed.js` publishes. */
export interface AweaveMissionBoardGlobal {
  readonly version: string
  mount(el: HTMLElement, options?: MissionBoardEmbedOptions): MissionBoardHandle
}

/**
 * Read `window.AweaveMissionBoard`, or `undefined` before `embed.js` has
 * finished loading and run its top-level assignment.
 * @returns the global, or `undefined`.
 */
export function readEmbedGlobal(): AweaveMissionBoardGlobal | undefined {
  const value = (globalThis as Record<string, unknown>).AweaveMissionBoard
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<AweaveMissionBoardGlobal>
  return typeof candidate.mount === 'function' ? (candidate as AweaveMissionBoardGlobal) : undefined
}
