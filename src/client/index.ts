/**
 * Browser half: register the Mission Board tab kind, its keyed body, and its copy,
 * plus the Missions page in the main column with its row in the left sidebar.
 *
 * The page is a keyed `main` entry with no Session binding; its row sits at
 * `sidebar.panellist` order 0.75, under the Git row (0.5). `layout` is read
 * through a scoped `ctx.inject`, so its absence only disables the tidy-up on
 * teardown instead of unloading the whole plugin.
 *
 * The type is a PAGE, not a viewer: it claims no resource address, so it declares
 * no `patterns` and is reached through `openTab('aweave-mission-board')` — the guide
 * page's entry box, or the strip's add control. Two registrations share the
 * definition's `id`: the static definition in `ctx.sidebarRightTabs`, and the
 * body in the keyed `sidebar.right.pane.tab` seat.
 *
 * `keepMounted` stays `false`: retention is per tab, so a retained board per
 * visited tab would hold its own `embed.js` mount (its own React 19 root inside
 * a Shadow DOM), and remount is the cheaper trade.
 *
 * This closure is where the body's IMPURE edges are bound: `MissionBoardBody`
 * itself is a pure props consumer whose live data arrives through framework
 * hooks, so the bound data surface and the published configuration are handed
 * to it through the seat's `inject` face rather than read from `ctx` inside
 * the component.
 *
 * No React is bundled and no `dsh.client.external` entry exists for it: the
 * bundle asks the shell's module table for React and its JSX runtime, which
 * are baseline rows the shell seeds once. A second React instance would break
 * hooks. This plugin no longer bundles a board implementation of its own —
 * `embed.js` (`@hod/aweave-mission-web`'s self-contained bundle, carrying its
 * OWN React 19 inside a Shadow DOM) is loaded at runtime from the fenced
 * script route instead, so `@dnd-kit/*` is no longer a dependency here.
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
// Type-only: declares the `useSessions` global seat and the `sessionId` session seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the root `main` keyed slot and its panel id brand, and the
// `sidebar.panellist` list the row registers into.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

import {
  GUIDE_ENTRY_ID,
  GUIDE_ENTRY_ORDER,
  LOCALE_NAMESPACE,
  PAGE_ID,
  PAGE_ROW_ORDER,
  PLUGIN_ID,
  TAB_KIND,
  readInjectedConfig,
} from '../config.ts'
import { en } from './locale.ts'
import { MissionBoardBody, type MissionBoardInjected } from './MissionBoardBody.tsx'
import { MissionsPage, type MissionsPageInjected } from './MissionsPage.tsx'
import { createMarkdownPropertiesViewer } from './MarkdownPropertiesViewer.tsx'
import { NavIcon } from './NavIcon.tsx'
import type { BetterSidebarLike } from './lib/better-sidebar.ts'
import { createPageMemory } from './page-memory.ts'
import { installBoardStyles } from './styles.ts'

export type { MissionBoardInjected, MissionBoardBodyProps } from './MissionBoardBody.tsx'
export type { MissionsPageInjected, MissionsPageProps } from './MissionsPage.tsx'
export type { MissionApiError, MissionApiFailureKind } from './lib/mission-transport.ts'

/**
 * Services this half reads; all three are shell-provided.
 *
 * The body's `useTabInfo`/`useSessions`/`sessionId` seats are NOT declared
 * here: they are the slot's own declared injects, supplied by
 * `sidebar.right.pane.tab`'s owner and the Session framework.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/** Descriptor id of the markdown viewer registered with `dsh-better-sidebar`. */
const MARKDOWN_VIEWER_ID = 'aweave-dsh-devkit:markdown-properties'

/** The slice of the layout service this half calls. */
interface LayoutLike {
  selectPanel(panelId: MainPanelId | null): void
  panelInfo: { getSnapshot(): { activePanelId?: string | null } }
}

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
  const face: MissionBoardInjected = { config }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PLUGIN_ID,
    locale: LOCALE_NAMESPACE,
    // A function of the declaration's positional params; this seat's face needs no
    // per-occurrence value, so it ignores the ones the framework passes.
    inject: (): MissionBoardInjected => face,
  }, MissionBoardBody)), 'aweave-dsh-devkit: tab body')

  // The reading position outlives the page's mount: the page unmounts whenever
  // the Human returns to the Conversation.
  const memory = createPageMemory()
  const pageFace: MissionsPageInjected = { config, memory }

  let layout: LayoutLike | undefined
  const bind = ctx as unknown as { inject: (names: string[], callback: (inner: unknown) => void) => unknown }
  bind.inject(['layout'], (inner) => {
    const scoped = inner as ClientContext & { layout: LayoutLike }
    layout = scoped.layout
    scoped.effect(() => () => { layout = undefined }, 'aweave-dsh-devkit: layout service')
  })

  // The markdown file viewer: registered only when `dsh-better-sidebar` publishes its
  // service, so its absence (or a build without `registerFileViewer`) leaves the rest
  // of the plugin untouched. A scoped inject, like the layout service above.
  bind.inject(['betterSidebar'], (inner) => {
    const scoped = inner as ClientContext & { betterSidebar?: BetterSidebarLike }
    const service = scoped.betterSidebar
    if (service === undefined || typeof service.registerFileViewer !== 'function') return
    const component = createMarkdownPropertiesViewer(service, t)
    scoped.effect(() => service.registerFileViewer({
      id: MARKDOWN_VIEWER_ID,
      title: () => t('properties.viewerTitle'),
      exts: ['md', 'markdown'],
      priority: 10,
      fetchStrategy: 'fsRead',
      component,
    }), 'aweave-dsh-devkit: markdown properties viewer')
  })

  const panelId = PAGE_ID as MainPanelId

  ctx.effect(() => ctx.slots.inject('main', () => {
    const dispose = ctx.slots.register({
      name: 'main',
      key: panelId,
      locale: LOCALE_NAMESPACE,
      inject: (): MissionsPageInjected => pageFace,
    }, MissionsPage)
    return () => {
      // Leave the page before its panel goes: a selection pointing at a key that
      // no longer exists would strand the main column on nothing.
      if (layout?.panelInfo.getSnapshot().activePanelId === PAGE_ID) layout.selectPanel(null)
      dispose()
    }
  }), 'aweave-dsh-devkit: missions page')

  // `order: 0.75` is directly under the Git row (0.5) and above the market row (1).
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: panelId,
    order: PAGE_ROW_ORDER,
    label: () => t('nav.label'),
    locale: LOCALE_NAMESPACE,
  }, NavIcon)), 'aweave-dsh-devkit: missions sidebar row')
}
