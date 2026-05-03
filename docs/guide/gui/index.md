---
title: GUI
description: The Journey desktop GUI — shell overview, navigation, and launch commands.
sources:
  - packages/gui/src/App.tsx
  - packages/gui/src/shell/Sidebar.tsx
  - packages/gui/src/shell/TopBar.tsx
  - packages/gui/src/shell/ProjectSwitcher.tsx
---

# GUI

The Journey GUI is a Solid.js + Tauri app that reads and writes the same project files the CLI uses — no proprietary state, no separate database. It runs against a `journey serve` backend (started automatically in the desktop build).

This guide is **orientation**, not a component reference. For the exact options that drive each feature, read the underlying page's source (linked in each subpage's frontmatter).

## Subpages

- [Pages](./pages) — per-route overview (Overview, Endpoints, Journeys, Editor, Files, Environments, Spec diff, Run history).
- [Console dock](./console-dock) — Network and Logs tabs.
- [Command palette and cURL import](./palette-and-import) — ⌘K and the cURL-paste dialog.

## Shell layout

**Top bar.** Project switcher (recent projects, open folder, init new), environment indicator (active env name + base URL), command-palette button, console toggle.

**Sidebar.** Two sections: **Project** (day-to-day screens) and **Tools** (analysis / meta-views). Each item can show a count badge — endpoints, journeys, environments, drift count.

**Console dock.** Bottom panel toggled with ⌘\`. Resizable; height persists across sessions.

**Router.** URL-driven. Deep links to any page work, and pages like Endpoints accept query params so pasting a URL pre-populates the request form.

## Navigation map

| Section | Route          | What it is |
|---------|----------------|------------|
| Project | `/`            | Overview dashboard — config, counts, recent runs, spec-drift card. |
| Project | `/endpoints`   | Single-request view over each endpoint in the spec. Postman-style. |
| Project | `/journeys`    | Run journeys; live step timeline. |
| Project | `/editor`      | Edit `.journey.ts` files — visual step list + source view. |
| Project | `/files`       | Read-only file tree for the project. |
| Project | `/environments`| Manage per-environment JSON files. |
| Tools   | `/diff`        | Spec drift: added/removed endpoints. |
| Tools   | `/history`     | Run records; compare two runs side-by-side. |

## Shared principles

- **Filesystem is the source of truth.** Everything you do in the GUI writes to the same `journey.config.json`, `journeys/*.journey.ts`, `environments/*.json`, and `.journey/cache/runs/` files the CLI uses. No hidden database.
- **No session persistence for transient state.** Auth presets, scratch request bodies, and pre/post scripts in the Endpoints page are not saved between sessions — **Save as step** is the commit path.
- **The spec drives autocomplete and hints.** Endpoint lists, parameter types, and body schemas all come from the OpenAPI spec referenced in `journey.config.json`.

## Running the GUI locally

In the monorepo:

```sh
# web dev mode — mock server + CLI serve + GUI dev server
pnpm dev:web

# desktop dev mode — same + Tauri shell
pnpm dev:tauri
```

Both commands assume the petstore example project; swap the `--project` flag in `package.json` to point at your own. For a standalone install, run `journey serve` in your project directory and open the GUI bundle against it.
