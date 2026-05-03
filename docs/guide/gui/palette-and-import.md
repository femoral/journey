---
title: Command palette and cURL import
description: ⌘K search and the paste-a-cURL dialog.
sources:
  - packages/gui/src/shell/CommandPalette.tsx
  - packages/gui/src/shell/ImportDialog.tsx
  - packages/gui/src/pages/importCurl.ts
---

# Command palette and cURL import

## Command palette — ⌘K

Open with ⌘K (Ctrl+K on Windows/Linux), or the search icon in the top bar. A keyboard-driven launcher that searches across:

- **Routes** — any page in the app (Overview, Endpoints, Journeys, Editor, Files, Environments, Spec diff, Run history).
- **Endpoints** — every operation in the spec, searchable by method and path.
- **Journeys** — every `.journey.ts` file, searchable by name.
- **Commands** — currently: **Import from cURL**.

Navigation is keyboard-first:

| Key         | Action |
|-------------|--------|
| Type        | Filter |
| ↑ / ↓       | Move selection |
| `Enter`     | Open |
| `Esc`       | Close |

Selected result jumps to the corresponding page. For endpoints and journeys, the palette routes into the page that makes sense — an endpoint opens the Endpoints page with that operation selected; a journey opens the Journeys page with it highlighted.

## Import from cURL

Launched from the command palette (**Import from cURL…**) or the top-bar menu.

Paste a `curl` command — multi-line is fine — and the dialog parses:

- **Method** — from `-X`, `--request`, `-G` (implies GET), `-I` (HEAD), `-L` (follow, method inferred).
- **URL** — positional argument or `--url`.
- **Headers** — `-H`, `--header`.
- **Body** — `-d`, `--data`, `--data-raw`, `--data-binary`.
- **Basic auth** — `-u`, `--user`.

Parsed values surface in the preview below the input. Warnings appear for ignored flags.

### What happens next

**Open in Endpoints** carries the parsed request over to the Endpoints page as URL params, pre-populating method, URL, headers, body, and auth. From there you can tweak the request, send it, or save it as a step into an existing journey.

### Other import sources

The dialog has stub tabs for **OpenAPI** and **Postman** imports — those are not wired up yet. cURL is the only shipping import path.
