# aweave-dsh-devkit

External [Cordis](https://deepseek-harness.github.io/deepseek-harness/) plugin for **DSH Web** that puts the
**Aweave Mission Board** in the right sidebar and reaches the Aweave mission backend from the page.

The backend is **not** ported and **not** duplicated: `@hod/aweave-mission-server` stays the single owner of
mission discovery, markdown parsing, and the guarded write path. The board's UI is **not** ported either — it is
`@hod/aweave-mission-web`'s self-contained `embed.js` bundle (its own React 19 root inside a Shadow DOM), loaded at
RUNTIME from the fenced script route below, exactly as the VS Code devkit and the standalone SPA load it. This
package is transport and a thin composition shell only.

```text
Mission Board tab (right sidebar)  --fetch, same origin, cookie-->  /api/aweave-dsh-devkit/*
   src/client/                                                        admission: Host fence (403), browser cookie (401)
        |                                                                   | HTTP, AbortSignal.timeout
        | <script src>, same origin, cookie                                v
        v                                                     @hod/aweave-mission-server on 127.0.0.1:3456
/api/aweave-dsh-devkit/mission-board/embed.js  (embed.js proxy, its own policy)
```

## What this package currently is

| Half | State |
| --- | --- |
| **Host** | Complete: the fenced JSON route table (four mission operations), the `embed.js` script-route proxy with its own error mapping, the upstream forwarding policy, and the Aweave-root resolution. |
| **Browser** | Complete: the right-sidebar page type, its guide entry, its dictionary and shell stylesheet, and `MissionBoardBody` — the composition root that loads `embed.js` once per page and mounts it into a plain container, handing it a transport built over the fenced JSON routes and a theme mapped onto this platform's `--dsw-alias-*` tokens. |

There is **no live push (SSE) in this integration**: the shared `/api` channel's forwarder buffers every upstream
response body (`ConnectionFetchRoute.requestBody: 'buffered'`), so an endless `EventSource` stream would end as a
`502` almost immediately. The transport this plugin builds (`src/client/lib/mission-transport.ts`) therefore
implements every `MissionTransport` method EXCEPT `subscribeEvents`; `embed.js`'s own `Board` component falls back
to polling `listMissions` every 5s, plus an immediate refresh on window focus or the tab becoming visible again,
whenever a transport omits it (the same degradation the B0 embed contract change added for exactly this case).

The board never renders empty in place of a failure. A first load that fails — `embed.js` itself failing to
load, or the Host publishing no configuration at all — is a blocking state naming the cause; `embed.js`'s own
internal load failures (an unreachable backend, a malformed answer) are handled inside `embed.js` itself, since
this plugin has no visibility into the mounted bundle's internal request state.

## The fenced route table

Every route is registered through `ctx.connection.fetch.register` inside `ctx.effect()`. The channel takes
**exact paths**, and only the `/api` channel runs `connection.admit`, so an unauthenticated request to any
`/api` path is answered `401` (no browser cookie) or `403` (foreign `Host`) **before** any route lookup — that
is the fence, and it does not depend on whether a route exists.

| Fenced path | Method | Forwards to |
| --- | --- | --- |
| `/api/aweave-dsh-devkit/missions/config` | `GET` | `GET /missions/config` |
| `/api/aweave-dsh-devkit/missions/list` | `GET` | `GET /missions` |
| `/api/aweave-dsh-devkit/missions/detail` | `GET` | `GET /missions/detail` (query string forwarded verbatim: `id`, `progress`) |
| `/api/aweave-dsh-devkit/missions/update` | `POST` | `POST /missions/update` |
| `/api/aweave-dsh-devkit/mission-board/embed.js` | `GET` | `GET /mission-board/embed.js` — a SEPARATE, non-JSON policy (see below) |

Two shapes need stating, because each is forced by a constraint rather than chosen:

* **Every mission operation forwards to a FIXED upstream path.** Unlike the deleted taskboard's update route
  (whose task id had to be parsed out of the body to build a `PATCH .../tasks/:id` URL), `POST /missions/update`'s
  DTO takes `id` as a body field, so the body is forwarded byte-for-byte with no per-request path derivation, and
  this policy never rejects a well-formed request with `400`.
* **`embed.js` is a script route, not a JSON one.** A `<script src>` load sends no `accept: application/json`
  header and cannot read a JSON refusal envelope — it either executes the response as JavaScript or fails
  silently. `host/embed-route.ts` therefore answers `content-type: application/javascript` on success and a
  PLAIN-TEXT `502` (never a JSON envelope) on an unreachable backend, still buffering the full body
  (`upstream.text()`) like every other fenced route — the channel gives no streaming primitive, and `embed.js` is
  small enough (~400 kB) that this is a non-issue for a script load.
* **Every fenced path registers both channel verbs.** The channel matches a pathname and then a method, so the
  handler sees the request and answers the verb it does not implement with `405` plus `Allow` — instead of the
  channel's blanket `404`, which would claim the path does not exist.

### Error mapping

| Condition | Answer |
| --- | --- |
| Backend reachable (JSON routes) | Its status and body, passed through verbatim, including its own error envelope |
| Backend reachable (`embed.js` route) | Its status and body, passed through verbatim, as `application/javascript` |
| Backend unreachable, or the deadline elapsed (JSON routes) | `502` with `{ success: false, error: { code: 'UPSTREAM_UNREACHABLE', message } }`, naming the upstream call that failed |
| Backend unreachable, or the deadline elapsed (`embed.js` route) | PLAIN-TEXT `502` naming the upstream call that failed — a `<script>` tag cannot parse a JSON body |
| Method the fenced path does not implement | `405` with `Allow` — a JSON envelope on the mission routes, plain text on the `embed.js` route |

An unreachable backend is deliberately **not** an empty `200`: a Human reading an empty board would take it for
"no missions".

## Configuration

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `baseUrl` | string (http/https) | `http://127.0.0.1:3456` | Aweave mission backend origin |
| `requestTimeoutMs` | integer, `100`–`600000` | `8000` | Upstream deadline per forwarded request |
| `aweaveRoot` | absolute path, or `""` | `""` (derive) | Aweave platform root |

`aweaveRoot` is the root a mission's `INDEX.md` path is relative to. It has two sources, in order: the configured
value, then a walk up from the Host's working directory for the platform marker
`workspaces/devtools/common/server/package.json` — the same marker the VS Code extension uses to detect Aweave
mode, so two clients on one machine cannot disagree about where the root is. The resolved value is published to
the browser half through the `webserver/index-inject` global, validated on both ends; when nothing resolves, the
global carries `null`, the Host logs a warning, and the browser half degrades readably instead of opening a
wrong file.

The bundle patch ships **no absolute path**, because every tracked file must stay machine-independent. A
deployment whose Session is not rooted inside the platform sets it in its own profile patch:

```yaml
- insert:
    - id: aweave-dsh-devkit
      name: 'aweave-dsh-devkit'
      config:
        baseUrl: 'http://127.0.0.1:3456'
        requestTimeoutMs: 8000
        aweaveRoot: /absolute/path/to/the/aweave/platform
```

The bind-host check (`webServer.host === '127.0.0.1'`) is retained as **defence in depth only**, and it warns
rather than refuses. The fence is admission on the shared `/api` channel; it never reads the bind host, and
refusing to register on a non-loopback bind would remove remote reachability — the reason this proxy exists —
without adding any protection the channel does not already give.

## Local build

```bash
pnpm install
pnpm run check     # tsc --noEmit across the host, client, and test faces
pnpm test          # builds both halves, then vitest
pnpm run build     # tsc (host) + tsc declarations + tsdown (dynamic client bundle)
```

`pnpm test` builds before it runs, because `test/client/client-bundle.spec.ts` reads the **built**
`lib/client.js` and `lib/index.js` and asserts the artifact contract. Running the plan's four commands in the
order `install → check → test → build` is therefore self-sufficient.

Artifacts: `lib/index.js` (Host half, ESM, built by `tsc`) and `lib/client.js` (dynamic browser bundle, built by
`tsdown`). The client bundle hands its factory to the shell's module loader —
`window.__ModuleLoader__.load({ id: 'aweave-dsh-devkit', factory: (require) => { … } })` — and keeps React and its
JSX runtimes external. Those are `PLATFORM_MODULES` rows (`packages/client/web/src/platform.ts`) the shell seeds
once; a second inlined copy of React would break hooks — and would in any case be a THIRD copy, since `embed.js`
carries its own React 19 instance inside its Shadow DOM, isolated from both. `tsdown.config.ts` states the
baseline list explicitly, because it is hand-rolled and cannot import `PLATFORM_MODULES`. **No
`dsh.client.external` entry is added** — this plugin requests nothing the shell has not already seeded.

## Install into a DSH profile

```bash
# from the DSH checkout, with the target profile's process stopped
pnpm dsh plugin --profile web add file:../aweave-dsh-devkit
```

The package declares `dsh.bundle.patch` → `cordis.patch.yml`, and that patch's single `insert` row registers the
plugin. A `file:` install may materialize as a **hardlink tree**: after a rebuild that replaces files, compare
inodes between this source tree and the installed copy, and refresh with `plugin remove` then `plugin add` when
the links are stale. Back up the profile's `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` first.

Verify on a **fresh** process — an already-running host cannot compose a newly installed bundle:

```bash
pnpm dsh web --port 3180 --no-open
```

## Verification

```bash
# Admission only. Passes for ANY /api path, mounted or not — it never proves presence.
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3180/api/aweave-dsh-devkit/missions/update
# => 401 (no browser cookie) or 403 (foreign Host)

# Presence needs an AUTHENTICATED request from the :3180 page (the cookie is HttpOnly):
#   GET /api/aweave-dsh-devkit/missions/config      -> the backend's config envelope   (route mounted)
#   GET /api/aweave-dsh-devkit/__absent              -> 404 'not found'                  (control path)
#   both 404                                         -> the plugin never activated (the swallowed-inject failure mode)
```

The tab itself is proof that the browser half activated: it appears in the right sidebar's guide page as
*Aweave Mission Board*, and opening it loads `embed.js` and renders the board.

## Layout

```text
src/
  index.ts            Host half: inject, Aweave-root resolution, index-inject row, route registration
  config.ts            Dependency-free shared constants and the fenced route table (JSON + embed.js)
  schema.ts             Host-only schemastery schema (kept out of the browser graph)
  host/
    forward.ts          Allowlist, upstream mapping, upstream call, error mapping for the JSON routes (no ctx, no React)
    embed-route.ts       The embed.js script route's own, non-JSON, forwarding policy
    routes.ts            One exact route per fenced path (JSON + embed.js), registered inside ctx.effect()
    aweave-root.ts        Config.aweaveRoot, or the marker walk
  client/
    index.ts             Browser half: page type + guide entry + body + dictionaries + stylesheet
    locale.ts             English dictionary and the namespace's key set
    styles.ts              The tab shell's owned, scoped <style> element (data-plugin / data-plugin-css)
    MissionBoardBody.tsx   Composition root: loads embed.js once, mounts it, translates onOpenIndex
    open-task.ts            Absolute-path resolution and the open/degrade decision (pure, generic — not mission-specific)
    lib/
      embed-global.ts        The window.AweaveMissionBoard ambient contract this plugin loads at runtime
      mission-index-path.ts   Exact shape check for a mission INDEX.md path (ported from mission-core, pure)
      mission-transport.ts    The fenced routes over plain fetch; envelope unwrapping and the failure split
test/
  unit/mission-index-path.spec.ts   Every accepted/rejected INDEX.md path shape
  unit/mission-transport.spec.ts    Request shapes and the three-way failure split, no DOM
  unit/open-task.spec.ts            Absolute-path resolution and the non-root-cwd degradation
  unit/forward.spec.ts              Allowlist, method rejection, upstream mapping, 502, deadline, the embed.js route's own policy
  unit/aweave-root.spec.ts          Explicit value, derivation walk, real-filesystem marker
  client/client-bundle.spec.ts      Bundle identity, baseline-only requests, inlined libraries, tab-kind registration
```

## Known limitations

* **No live push.** `subscribeEvents` is not implemented (see "What this package currently is" above); the board
  polls every 5s plus a refresh on focus/visibility instead of updating the instant another client writes.
* **Opening a mission needs the Aweave root.** `aweaveRoot` is derived by walking up from the **Host process's
  working directory** (`src/host/aweave-root.ts`), so a Host launched from outside the platform tree resolves
  nothing and the board refuses to open any mission — for every Session, including one correctly rooted at the
  platform. A Session rooted outside the platform is the second refusal case, and it applies even when the root
  resolved. The board names which condition applies rather than opening a wrong file; set `aweaveRoot` in a
  profile patch layer when the Host is launched from elsewhere.
* **The backend must be running.** Every board operation depends on `@hod/aweave-mission-server`; when it is not
  reachable the JSON routes answer `502` with a readable message, and the `embed.js` route answers a plain-text
  `502`, instead of an empty board.
