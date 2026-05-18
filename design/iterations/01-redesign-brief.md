# Journey — UX redesign brief

A brief for Claude Design (or any visual designer) covering what
**Journey** is today, where it's headed, and the UX problems we want
the redesign to solve.

---

## What is Journey?

**Journey** is a local-first, offline, open-source tool for scaffolding,
organizing, and running API tests and multi-step API journey flows. It
replaces the usual triplication of Postman collections, acceptance
suites, and k6 load scripts with a single source of truth: a structured
project directory generated from an OpenAPI spec and version-controlled
alongside the API's code.

**Stance:**

- No cloud. No login. No subscriptions.
- Projects live on disk and in your VCS.
- Plain TypeScript, plain JSON, no proprietary format.

**Audience:** API authors, QA engineers, and platform teams who today
rebuild the same flows in three different tools and watch them drift
out of sync.

---

## How it's organized

A **Journey project** on disk:

```
my-api/
├── journey.config.json        # name, baseUrl, defaultEnv, paths
├── openapi.yaml               # source spec
├── generated/
│   ├── endpoints.ts           # typed endpoint refs (autogen)
│   └── models.ts              # typed schemas (autogen)
├── journeys/
│   └── *.journey.ts           # multi-step flows (TypeScript)
├── environments/
│   └── *.json                 # per-env variables
└── .journey/cache/            # local run history (gitignored)
```

Surfaces:

- **CLI** — `journey init | generate | run | export k6 | env list | serve`
- **Web GUI** (Solid + Vite + Tailwind + Kobalte)
- **Desktop app** (Tauri 2 wrap of the same SPA)
- **k6 adapter** — exports a `.journey.ts` to a runnable k6 load test
- **Mock server** lives next to the example project for offline dev

A single runtime core (`@journey/core`) drives all surfaces — the CLI,
the GUI's "Run" button, and exported k6 scripts share one execution
path. No logic forks.

---

## Current GUI shape

The web/desktop app is a SPA with a left sidebar and one main content
area per route:

| Route           | Purpose                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| `/` Overview    | Project name, base URL, counts (endpoints, journeys, environments)                   |
| `/files`        | Tree of `journeys/`, `environments/`, `generated/`                                   |
| `/endpoints`    | List of generated endpoints; pick one and send a one-off request                     |
| `/journeys`     | List `.journey.ts` files, run one, see step-by-step results, diff against prior runs |
| `/environments` | CRUD on environment JSON files (key/value pairs, secret masking)                     |
| `/editor`       | Source-edit a journey file; drag-drop step ordering; new from skeleton               |

Backend is `journey serve`, a Node HTTP server exposing `/api/*`.
The frontend hits it via a Vite proxy in dev and same-origin in
production.

Visual language today: minimal, dark slate background, indigo accent,
monospace for code/data, very utilitarian. **The redesign is a chance
to add identity, hierarchy, and observability.**

---

## What works well

- The "everything is a file" model — power users can edit by hand.
- Closure-variable state-passing in journeys (no templating language).
- Tight loop: GUI's Run button uses the same runtime as the CLI, so
  what you see in the browser matches what CI runs.
- One configuration source (`journey.config.json`) drives everything.

## What's painful today

1. **No quick project switch.** The desktop app shows one project at
   a time (whatever `journey serve` was pointed at). Switching means
   killing the backend and starting over.
2. **Response inspection is shallow.** The Endpoints page shows
   `status` + JSON body in a `<pre>`. No header/timing inspector,
   no formatting toggles, no syntax highlighting, no copy-curl.
3. **Auth UX is DIY.** Users hand-write `Authorization: Bearer …` in
   a JSON headers textarea. No auth presets (Basic, Bearer, API key
   in header/query, OAuth2).
4. **Query/header editing is a JSON blob.** Should be key/value rows
   with type hints from the spec.
5. **No console / log surface.** When a journey fails, you get a
   single red error string. There's no place to see:
   - The full request the runtime sent (URL, headers, body).
   - The full response (status, headers, body, timing).
   - `console.log` calls from inside `assert`/`after` hooks.
   - The structured logger output (we already have `--debug` for the
     CLI; the GUI doesn't surface it).
6. **Step results visualisation is dense.** Long flows scroll forever
   with no way to focus on one step.
7. **No request building from journeys.** Endpoints page and
   Journeys page are siloed — you can't send an ad-hoc request based
   on a step you saw fail.

---

## Redesign goals

In priority order:

### 1. A first-class request console (observability)

A dock-able panel — collapsible, resizable — that streams everything
the runtime is doing in real time. Inspired by browser devtools.

Required content:

- **Request:** method, URL, query string broken out, headers (with
  secrets redacted by default but reveal-on-click), body (formatted
  JSON / raw / hex).
- **Response:** status with colour, latency, size, headers, body (with
  the same formatting toggles), preview tabs (Pretty / Raw / Headers).
- **Timing breakdown** if we can get it from `fetch` (DNS, connect,
  TLS, TTFB, transfer).
- **Script logs:** `console.log` calls inside `after`/`assert` hooks
  appear inline, attributed to the step that emitted them.
- **Filter chips:** by step, by HTTP method, by status class (2xx /
  4xx / 5xx), by free text.
- **Copy as curl** on each request.

The console exists across pages — running a journey or sending a one-off
request both feed it.

### 2. Project switcher

A persistent control in the top bar (or sidebar header). Click → list
of recently opened projects + "Open folder…" + "Init new project".
Switching projects updates the rest of the app live without restarting
the backend. Multiple projects can be pinned.

### 3. Endpoint testing UX overhaul (Bruno-inspired)

The Endpoints page should feel like Bruno or Postman. For a selected
endpoint, the detail panel has tabs:

- **Params** — table of path/query params, populated from the spec,
  each row: name, value, description, "required" badge, type hint.
  Toggle a row off to omit it.
- **Headers** — table of header rows. Spec-declared headers prepopulated
  and disable-able. Add/remove freely. Inline secret masking.
- **Auth** — preset picker:
  - None
  - Basic (user/password)
  - Bearer token (paste or `{{env.TOKEN}}`)
  - API key (header or query, name/value)
  - OAuth2 client-credentials (issue + cache token, show expiry)
- **Body** — content-type aware editor:
  - JSON: schema-aware autocomplete, format/minify, validate against
    spec request schema.
  - Form-data, x-www-form-urlencoded, raw, binary.
- **Pre/Post scripts** — small JS editors for setup (e.g. compute
  signature) and teardown (e.g. extract value into env).

Save the populated request as a step into a chosen journey with one
click. This is the bridge between the Endpoints page and the Editor.

### 4. Step-result UX

Per-step cards collapse to a one-line summary by default; expand to
show request/response detail inline. Failed steps auto-expand. Each
card has a "Run only this step" affordance and a "Send via Endpoints"
button that copies the resolved request into the Endpoints page for
fiddling.

### 5. Visual identity

Minimal isn't enough — the app needs:

- A logo / wordmark.
- A primary brand colour with a dark-mode palette and a light-mode
  palette (currently dark-only).
- Typography hierarchy: today every heading is the same Tailwind
  default. Distinct sizes for page title / section / row.
- Iconography: a small custom set for routes, methods, statuses,
  and run outcomes (currently emoji ✓/✗).
- Empty states with illustrations and clear CTAs ("No environments
  yet. Create one to start parameterising your journeys.").

---

## Future features worth designing for

These aren't built yet but should be considered when laying out the
nav and shells.

- **Diff against the spec** — when the OpenAPI spec changes, show what
  endpoints/schemas drifted from the last `generate`.
- **Import from cURL / OpenAPI / Postman** — paste or drop a file.
- **Mock server inside the GUI** — "stub out this endpoint for runs"
  similar to MSW, so journeys can run without the real backend.
- **Snapshots** — pin a response body as a baseline; future runs
  surface drift (this is what #21 diffing started).
- **Scheduled runs** — local cron-style trigger that runs a journey
  every N minutes and writes to the run history.
- **Charts on run history** — pass/fail trend, p95 latency per step,
  failure heatmap by endpoint.
- **Team sharing via VCS** — onboarding a teammate is currently
  `git clone && pnpm install && pnpm dev:web`. Make that pitch
  visible: a "share this project" panel showing the git remote, the
  one-line bootstrap command, and what teammates need installed.
- **Plugin surface** — third-party renderers for response bodies
  (image, GraphQL, gRPC, server-sent events).
- **CI report mode** — `journey run --reporter junit | sarif | github-actions`
  and matching annotations.
- **k6 dashboard preview** — show the script that _would_ be exported
  next to the journey for one-click sanity check.

---

## Constraints for the designer

- **Local-first** is core. Avoid UI that implies cloud sync, accounts,
  comments, or "share via link". Sharing is git, not URLs.
- **VCS-friendly** files. Anything stored on disk should be diffable
  JSON/YAML/TS — no opaque blobs.
- **Two surfaces, one design.** The same components render in a
  browser tab and a Tauri window. Avoid OS chrome assumptions.
- **Keyboard-first** for the request console (filter, jump-to-step,
  copy-curl). Power users will live in this view.
- **No telemetry** of user behaviour — observability is the user's
  windows into their own runs, not ours into theirs.
- **Generated code is sacred.** UI must never tempt users to edit
  files under `generated/` — those are clobbered by `journey generate`.

---

## Sketch the following screens

Priority targets for the redesign explorations:

1. App shell — sidebar, top bar with project switcher, console dock.
2. Overview / Project home — summary, recent runs, quick actions.
3. Endpoints page — Bruno-inspired detail panel with all tabs.
4. Journey runner — list, current run, step cards, history + diff.
5. Console — request/response detail, script logs, filters.
6. Editor — drag-drop step list, source view, inspector.
7. Environment manager — table layout, secret reveal, JSON toggle.
8. Empty / first-run states.

Light + dark palette. One iconography pass. One typographic scale.
