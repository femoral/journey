---
title: GUI pages
description: Per-route overview of every GUI screen — what it's for, what you can do, and what file backs it.
sources:
  - packages/gui/src/pages/ProjectPage.tsx
  - packages/gui/src/pages/EndpointsPage.tsx
  - packages/gui/src/pages/JourneysPage.tsx
  - packages/gui/src/pages/JourneyEditorPage.tsx
  - packages/gui/src/pages/AddStepDialog.tsx
  - packages/gui/src/pages/SaveAsStepDialog.tsx
  - packages/gui/src/pages/EnvironmentsPage.tsx
  - packages/gui/src/pages/HistoryPage.tsx
  - packages/gui/src/pages/DiffPage.tsx
  - packages/gui/src/pages/FilesPage.tsx
  - packages/gui/src/pages/auth.ts
  - packages/gui/src/pages/scripts.ts
  - packages/gui/src/components/JsonDiff.tsx
---

# GUI pages

## Overview — `/`

Project dashboard. Shows `journey.config.json` summary (name, path, spec file, base URL), counts (endpoints, journeys, environments, recent runs), six most recent runs, and four quick actions: run journeys, send a request, regenerate from OpenAPI, new journey from skeleton. A spec-drift card surfaces the first few endpoints that differ between the spec and the generated code.

## Endpoints — `/endpoints`

Postman-style one-off request view. Pick an endpoint from the list; the detail panel has tabs for:

- **Params** — path + query parameters as a key/value table with per-row enable toggles, type hints pulled from the spec.
- **Headers** — headers with the same enable toggles; secret-looking values are masked until revealed.
- **Auth** — preset picker: none, Basic, Bearer, API key (header or query), OAuth2 client-credentials (with automatic token caching).
- **Body** — content-type-aware editor: JSON, form-data, `x-www-form-urlencoded`, raw/binary.
- **Pre / Post scripts** — JS editors. Pre runs before send and can mutate the request; post runs on the response and can assert or extract to env.
- **Docs** — the OpenAPI schema the spec declares for this endpoint.

**Send** hits the proxy backend; the response area shows status, headers, formatted body, and timing. **Save as step** appends this request into an existing journey as a new step.

## Journeys — `/journeys`

Pick a journey from the list, click **Run** (or **Run up to step N**) to execute it against the proxy. The live timeline shows each step's name, method+path, status, and duration as it happens. Failed steps expand automatically. Per-step actions:

- **Copy as cURL** — puts the exact outgoing request on the clipboard.
- **Send via Endpoints** — carries the resolved request over to the Endpoints page.

Console output from `console.log` inside hooks appears inline beneath the step.

## Editor — `/editor`

Two-pane journey editor with **Visual** and **Source** tabs.

The visual tab is a step list — drag to reorder, add via the endpoint picker, rename or delete inline. The source tab is a TypeScript editor on the raw `.journey.ts` file. Changes in either view write straight back to disk; there is no intermediate state.

**Add step** opens a dialog with a searchable endpoint picker; pick one and the new step is appended.

## Files — `/files`

Read-only file tree over the project directory. Select a file to see its contents, syntax-highlighted. Useful for eyeballing `generated/` files or flipping between journeys without switching IDE.

## Environments — `/environments`

Pick an env from the list, edit as a table or as raw JSON.

- **Table view** — key/value rows.
- **JSON view** — raw editor for the whole file.

Save writes back to `environments/<name>.json`. Create new envs from a prompt.

## Spec diff — `/diff`

Shows which endpoints exist in the OpenAPI spec but not in the generated code (**Added**), and which exist in the generated code but have been removed from the spec (**Removed**). Click **Run journey generate** to regenerate.

Drift also surfaces as a badge on the sidebar item and in the Overview spec-drift card.

## Run history — `/history`

Lists historical runs (from `.journey/cache/runs/`) — filter by journey name, see pass/fail stats. Select a run to view its step-level results.

**Compare** picks a second run and shows a side-by-side diff of request/response bodies, headers, and status codes. JSON bodies get a structural diff viewer that highlights added/removed/changed fields.

**Close diff** returns to the single-run view.
