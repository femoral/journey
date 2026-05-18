---
title: Console dock
description: Bottom panel with Network and Logs tabs — captures every request and every console.log during a run.
sources:
  - packages/gui/src/shell/ConsoleDock.tsx
  - packages/gui/src/shell/consoleStore.ts
  - packages/gui/src/shell/consoleContext.ts
---

# Console dock

The console dock is the bottom panel in every GUI page. Toggle it with ⌘\` (Ctrl+\` on Windows/Linux). Resizable via the top border; height is persisted across sessions (min 200 px, max 700 px).

## Tabs

### Network

Every HTTP request made during a run. Entries show method, URL, status, response time.

**Filters** (chip row above the list):

- Method (GET / POST / PUT / PATCH / DELETE, or all).
- Status class (2xx / 3xx / 4xx / 5xx, or all).
- Free-text search over URL.

**Keyboard navigation:**

| Key        | Action                    |
| ---------- | ------------------------- |
| `j` / down | Select next entry         |
| `k` / up   | Select previous entry     |
| `Enter`    | Expand / collapse details |
| `c`        | Copy entry as cURL        |

**Per-entry detail** (when expanded):

- Tabs: **Pretty** (formatted JSON), **Raw** (text), **Headers**.
- Secret-looking header values are masked until clicked.
- Copy button for the body.

**Row actions:**

- **Copy as cURL** — equivalent of the `c` shortcut.
- **Send via Endpoints** — jumps to the Endpoints page with this request pre-populated, so you can tweak and resend it.

### Logs

Anything `console.log` / `console.warn` / `console.error` inside a journey hook or a pre/post script shows up here, grouped by step. Each entry shows the log level.

## Clear

The **Clear** button wipes the dock. The counter beside it shows the current entry count.

## Ingestion

Entries arrive over Server-Sent Events from the `journey serve` backend. The dock stays populated across page navigations but is cleared when you switch projects or restart the app.

## When it's populated

- **Journeys page runs** — every step makes one request; each one appears here.
- **Endpoints page sends** — one-off requests also feed the dock.
- **History page runs** — replaying a historical run does not repopulate the dock (you're viewing a past record).
