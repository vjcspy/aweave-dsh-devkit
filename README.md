# aweave-dsh-devkit

External [Cordis](https://deepseek-harness.github.io/deepseek-harness/) plugin for **DSH Web** that puts the
**Aweave Task Board** in the right sidebar and reaches the Aweave taskboard backend from the page.

The backend is **not** ported and **not** duplicated: `@hod/aweave-taskboard-server` stays the single owner of
scope discovery, task parsing, front-matter patching and the guarded write path. This package is transport and
presentation only.

```text
Task Board tab (right sidebar)  --fetch, same origin, cookie-->  /api/aweave-dsh-devkit/*
   src/client/                                                     admission: Host fence (403), browser cookie (401)
                                                                        | HTTP, AbortSignal.timeout
                                                                        v
                                                        @hod/aweave-taskboard-server on 127.0.0.1:3456
```

## What this package currently is

| Half | State |
| --- | --- |
| **Host** | Complete: the fenced route table, the upstream forwarding policy with its error mapping, and the Aweave-root resolution. |
| **Browser** | Complete: the right-sidebar page type, its guide entry, its dictionary and stylesheet, and the **Kanban board** — columns from the backend's status list plus a non-creatable `No Status` column, drag-and-drop writing `{ status, rank }`, scope/tag/status/text filters, in-column group-by, per-column quick-create, click-to-open, and `localStorage` view-state persistence. |

The board's two inherited client-side defects are fixed rather than ported: only the newest task response may
commit (a monotonic request counter), and a computed rank is accepted only when it lies strictly between its
destination neighbours — with an exhausted fractional gap reported as its own distinct condition.

The board never renders empty columns in place of a failure. A first load that fails — the backend unreachable,
or an answer that is not a `{ success, data }` envelope — is a blocking state naming the cause and offering
`Retry`, because an empty board would read as "no tasks".

## The fenced route table

Every route is registered through `ctx.connection.fetch.register` inside `ctx.effect()`. The channel takes
**exact paths**, and only the `/api` channel runs `connection.admit`, so an unauthenticated request to any
`/api` path is answered `401` (no browser cookie) or `403` (foreign `Host`) **before** any route lookup — that
is the fence, and it does not depend on whether a route exists.

| Fenced path | Method | Forwards to |
| --- | --- | --- |
| `/api/aweave-dsh-devkit/scopes` | `GET` | `GET /taskboard/scopes` |
| `/api/aweave-dsh-devkit/config` | `GET` | `GET /taskboard/config` |
| `/api/aweave-dsh-devkit/tasks` | `GET` | `GET /taskboard/tasks` (query string forwarded verbatim: `scopes`, `tags`, `status`, `text`) |
| `/api/aweave-dsh-devkit/tasks` | `POST` | `POST /taskboard/tasks` |
| `/api/aweave-dsh-devkit/tasks/update` | `POST` | `PATCH /taskboard/tasks/<id>` |

Three shapes need stating, because each is forced by a constraint rather than chosen:

* **The task update is its own path with the id in the body.** A task `id` is an Aweave-root-relative markdown
  path (`resources/workspaces/<scope>/_tasks/<file>.md`), so it contains `/` and cannot be an exact-route
  segment. The fenced route is a `POST` because the channel supports `GET`, `HEAD` and `POST` only; upstream it
  becomes the backend's `PATCH`.
* **`id` is stripped before the body is forwarded.** The backend validates `PATCH taskboard/tasks/:id` with
  `whitelist: true` **and** `forbidNonWhitelisted: true`, and `UpdateTaskBodyDto` has no `id` field — measured
  against the live backend, `{"id":"x.md","status":"done"}` is answered `400`. The fenced route therefore uses
  `id` to build the upstream path and forwards only the remaining payload.
* **Every fenced path registers both channel verbs.** The channel matches a pathname and then a method, so the
  handler sees the request and answers the verb it does not implement with `405` plus `Allow` — instead of the
  channel's blanket `404`, which would claim the path does not exist.

### Error mapping

| Condition | Answer |
| --- | --- |
| Backend reachable | Its status and body, passed through verbatim, including its own error envelope |
| Backend unreachable, or the deadline elapsed | `502` with `{ success: false, error: { code: 'UPSTREAM_UNREACHABLE', message } }`, naming the upstream call that failed |
| Method the fenced path does not implement | `405` with `Allow`, body `{ success: false, error: { code: 'METHOD_NOT_ALLOWED' } }` |
| Update body names no task | `400` with `{ success: false, error: { code: 'INVALID_INPUT' } }` |

An unreachable backend is deliberately **not** an empty `200`: a Human reading an empty board would take it for
"no tasks".

## Configuration

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `baseUrl` | string (http/https) | `http://127.0.0.1:3456` | Aweave taskboard backend origin |
| `requestTimeoutMs` | integer, `100`–`600000` | `8000` | Upstream deadline per forwarded request |
| `aweaveRoot` | absolute path, or `""` | `""` (derive) | Aweave platform root |

`aweaveRoot` is the root task ids are relative to. It has two sources, in order: the configured value, then a
walk up from the Host's working directory for the platform marker
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
once; a second inlined copy of React would break hooks. `tsdown.config.ts` states the baseline list explicitly,
because it is hand-rolled and cannot import `PLATFORM_MODULES`. **No `dsh.client.external` entry is added** — this
plugin requests nothing the shell has not already seeded.

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
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3180/api/aweave-dsh-devkit/tasks
# => 401 (no browser cookie) or 403 (foreign Host)

# Presence needs an AUTHENTICATED request from the :3180 page (the cookie is HttpOnly):
#   POST /api/aweave-dsh-devkit/tasks     -> the backend's 400 envelope   (route mounted)
#   POST /api/aweave-dsh-devkit/__absent  -> 404 'not found'              (control path)
#   both 404                              -> the plugin never activated (the swallowed-inject failure mode)
```

The tab itself is proof that the browser half activated: it appears in the right sidebar's guide page as
*Aweave Task Board*, and opening it renders the board.

Measured against the live backend, a validation failure answers `400` with `error.code` `HTTP_ERROR` (not
`INVALID_INPUT` — that code is raised by the service for semantic errors, while a DTO rejection surfaces as a
plain Bad Request). Assert the **status**, not the code, for the presence proof.

## Layout

```text
src/
  index.ts            Host half: inject, Aweave-root resolution, index-inject row, route registration
  config.ts           Dependency-free shared constants and the fenced route table
  schema.ts           Host-only schemastery schema (kept out of the browser graph)
  host/
    forward.ts        Allowlist, upstream mapping, upstream call, error mapping (no ctx, no React)
    routes.ts         One exact route per fenced path, registered inside ctx.effect()
    aweave-root.ts    Config.aweaveRoot, or the marker walk
  client/
    index.ts          Browser half: page type + guide entry + body + dictionaries + stylesheet
    locale.ts         English dictionary and the namespace's key set
    styles.ts         The board's owned, scoped <style> element (data-plugin / data-plugin-css)
    TaskBoardBody.tsx Composition root: request state, drag mutations, view state, failure surfaces
    store.ts          localStorage view state: one versioned key, guarded, self-healing
    open-task.ts      Absolute-path resolution and the open/degrade decision (pure)
    components/       FilterBar, ScopeCascade, Column, Card, GroupHeader, QuickAdd (props only)
    lib/
      api.ts          The fenced routes over plain fetch; envelope unwrapping and the failure split
      board-utils.ts  Rank maths, the drop gate, and the in-column grouping transform (pure)
      types.ts        Backend payload shapes and the view-state vocabulary
test/
  unit/board-utils.spec.ts  Rank maths, grouping, the drop gate and the collision regression
  unit/open-task.spec.ts    Absolute-path resolution and the non-root-cwd degradation
  unit/forward.spec.ts      Allowlist, method rejection, upstream mapping, 502, deadline
  unit/aweave-root.spec.ts  Explicit value, derivation walk, real-filesystem marker
  client/store.spec.ts      Persistence round trip and malformed-payload self-heal
  client/client-bundle.spec.ts Bundle identity, baseline-only requests, inlined libraries, tab-kind registration
```

## Known limitations

* **Opening a task needs the Aweave root.** `aweaveRoot` is derived by walking up from the **Host process's working
  directory** (`src/host/aweave-root.ts`), so a Host launched from outside the platform tree resolves nothing and the
  board refuses to open any task — for every Session, including one correctly rooted at the platform. A Session rooted
  outside the platform is the second refusal case, and it applies even when the root resolved. The board names which
  condition applies rather than opening a wrong file; set `aweaveRoot` in a profile patch layer when the Host is
  launched from elsewhere.
* **Rank gaps are not rebalanced.** The rank scheme is a fractional key with no server-side renumbering. After
  enough insertions between the same two neighbours the gap collapses, and the board then reports the exhausted
  slot as its own condition instead of writing a rank that collides. A sparse renumber of the destination column
  is the remedy and is not implemented.
* **A cross-column drop with an exhausted destination slot does not write the status either.** The refusal is
  per-drop, not per-field, so the move is left to the Human to retry after the column is rebalanced.
* **The backend must be running.** Every board operation depends on `@hod/aweave-taskboard-server`; when it is
  not reachable the routes answer `502` with a readable message instead of an empty board.
