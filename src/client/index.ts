/**
 * Browser half: register the Task Board tab kind, its keyed body, and its copy.
 *
 * The type is a PAGE, not a viewer: it claims no resource address, so it declares
 * no `patterns` and is reached through `openTab('aweave-taskboard')` — the guide
 * page's entry box, or the strip's add control. Two registrations share the
 * definition's `id`: the static definition in `ctx.sidebarRightTabs`, and the
 * body in the keyed `sidebar.right.pane.tab` seat.
 *
 * `keepMounted` stays `false`: retention is per tab, so a retained board per
 * visited tab would hold its own request state, and remount is the cheaper trade.
 *
 * This closure is where the body's IMPURE edges are bound: the board itself is a
 * pure props consumer whose live data arrives through framework hooks, so the
 * bound data surface and the published configuration are handed to it through the
 * seat's `inject` face rather than read from `ctx` inside the component.
 *
 * No React is bundled and no `dsh.client.external` entry exists: the bundle asks
 * the shell's module table for React and its JSX runtime, which are baseline rows
 * the shell seeds once. A second React instance would break hooks. The board's own
 * libraries — `@dnd-kit/*` and the browser-safe workspace-path helpers — ARE
 * bundled, because the shell seeds neither.
 *
 * @module aweave-dsh-devkit/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: declares the `locale` member this half reads.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: declares the `slots` member this half registers into.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: declares the `sidebarRightTabs` member and `SidebarRightTabDefinition`.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

import {
  GUIDE_ENTRY_ID,
  GUIDE_ENTRY_ORDER,
  LOCALE_NAMESPACE,
  PLUGIN_ID,
  TAB_KIND,
  readInjectedConfig,
} from '../config.ts'
import { createTaskBoardApi } from './lib/api.ts'
import { en } from './locale.ts'
import { installBoardStyles } from './styles.ts'
import { TaskBoardBody, type TaskBoardInjected } from './TaskBoardBody.tsx'

export type { TaskBoardInjected, TaskBoardBodyProps } from './TaskBoardBody.tsx'
export type { TaskBoardApi, ApiFailureKind } from './lib/api.ts'

/**
 * Services this half reads; all three are shell-provided.
 *
 * The body's `useTabInfo` seat is NOT declared here: it is the slot's own
 * declared inject, supplied by `sidebar.right.pane.tab`'s owner.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * Register the tab kind, its dictionaries, its stylesheet, and its body.
 * @param ctx - browser-side plugin context owning the registry and the seats.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, 'en', en), 'aweave-dsh-devkit: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PLUGIN_ID,
    kind: TAB_KIND,
    keepMounted: false,
    title: () => t('tab.title'),
    guide: [{
      id: GUIDE_ENTRY_ID,
      order: GUIDE_ENTRY_ORDER,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }), 'aweave-dsh-devkit: tab kind')
  installBoardStyles(ctx)

  // Read once per activation: the global is a boot seed, and nothing in this
  // plugin changes it afterwards.
  const config = readInjectedConfig()
  const face: TaskBoardInjected = {
    config,
    // The transport resolves `fetch` at call time rather than capturing it here, so
    // a page-level interception installed after boot is still honoured.
    api: config === undefined
      ? undefined
      : createTaskBoardApi(config, (...args: Parameters<typeof fetch>) => globalThis.fetch(...args)),
  }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PLUGIN_ID,
    locale: LOCALE_NAMESPACE,
    // A function of the declaration's positional params; this seat's face needs no
    // per-occurrence value, so it ignores the ones the framework passes.
    inject: (): TaskBoardInjected => face,
  }, TaskBoardBody)), 'aweave-dsh-devkit: tab body')
}
