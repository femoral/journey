# GUI end-to-end tests

On NixOS, the repo ships a `shell.nix` that pins `nodejs`, `pnpm`, `k6`, and
`playwright-driver.browsers` so the Playwright version and its Chromium bundle
line up (nixpkgs' `playwright-driver` is 1.52.0 → Chromium 1169; the
`@playwright/test` dep is pinned to match).

```bash
cd <repo root>
nix-shell
pnpm --filter @usejourney/cli build
pnpm --filter @usejourney/gui test:e2e
```

The test spawns `node packages/cli/dist/index.js serve` on a random free port
and `vite dev` on another random free port, then drives the SPA with
Playwright's Chromium.

If you're not on Nix, make sure the system libs Chromium needs are installed
(Debian/Ubuntu: `sudo pnpm --filter @usejourney/gui exec playwright install-deps chromium`).
