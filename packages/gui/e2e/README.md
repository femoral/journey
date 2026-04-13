# GUI end-to-end tests

Run with:

```
# Keep the API + dev server running; Playwright launches its own browser.
pnpm --filter @journey/gui test:e2e
```

Requires Chromium system libraries (`libglib-2.0`, `libnss3`, `libatk-1.0`, etc.). On NixOS, enter a shell with the Playwright driver deps, e.g.:

```
nix-shell -p playwright-driver.browsers glib nss nspr atk cups dbus libdrm mesa libxkbcommon pango cairo alsa-lib
```

Or use `nix develop` with a flake exposing `playwright`. The test spawns `node packages/cli/dist/index.js serve` + a Vite dev server, so build the CLI first with `pnpm --filter @journey/cli build`.
