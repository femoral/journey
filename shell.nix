{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  name = "journey-dev";

  packages = with pkgs; [
    nodejs_22
    pnpm
    playwright-driver.browsers
    k6
  ];

  # Point Playwright at the nixpkgs-patched browser bundle so its binaries
  # resolve their dynamic libs correctly on NixOS, and skip the default
  # download into ~/.cache/ms-playwright.
  PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";

  shellHook = ''
    echo "journey-dev shell — node $(node --version), pnpm $(pnpm --version), k6 $(k6 version | head -1)"
    echo "Playwright browsers: $PLAYWRIGHT_BROWSERS_PATH"
    echo
    echo "Run the GUI e2e tests:"
    echo "  pnpm --filter @journey/cli build && pnpm --filter @journey/gui test:e2e"
  '';
}
