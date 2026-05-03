---
description: Start the journey dev stack (mock + cli serve + gui)
argument-hint: "[web|tauri]"
---

Start the local dev stack for `journey`. The user passed: `$ARGUMENTS` (default: `web`).

## What to run

- **`web`** (default): `pnpm dev:web` — boots the petstore mock on `:5180`, `journey serve` on `:5181`, and the Vite GUI on `:5173`.
- **`tauri`**: `pnpm dev:tauri` — same three plus `cargo tauri dev`. Requires a working WSLg / X11 / Wayland display. If on WSLg with HiDPI issues, suggest `GDK_SCALE=2 pnpm dev:tauri`.

## How to run it

1. Start the chosen command in the **background** (`run_in_background: true`) so the user keeps control of the terminal.
2. Use the `Monitor` tool to watch stdout for readiness lines:
   - `mock` is up when you see the petstore listening on `:5180`
   - `api` is up when `journey serve` logs the listening port
   - `vite`/`tauri` is up when Vite reports `Local:   http://localhost:5173/`
3. Once all three (or four, for tauri) are ready, summarise the running endpoints to the user as a short list. Do **not** stream the full log.
4. If a port is already taken or a child crashes, surface the failing line and stop — don't loop on retries.

## After it's running

Tell the user:

- The URLs they care about (mock, API, GUI).
- That the process is in the background; they can stop it with the standard interrupt.
- A nudge that `pnpm --filter @journey/gui test:e2e` can be pointed at this stack.

Don't run typecheck/test/build here — that's `/verify`.
