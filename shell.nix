{
  pkgs ? import <nixpkgs> { },
}:

let
  # Tauri 2 needs webkit2gtk 4.1 + its runtime deps
  tauriDeps = with pkgs; [
    # Build tools
    pkg-config
    gcc
    gnumake
    openssl

    # Rust
    rustc
    cargo
    cargo-tauri
    clippy
    rustfmt

    # Tauri system libraries (Linux/WSL)
    webkitgtk_4_1
    gtk3
    glib
    glib-networking # TLS for libsoup (WebKit's HTTP stack)
    libsoup_3
    cairo
    pango
    gdk-pixbuf
    atk
    harfbuzz
    librsvg

    # Wayland + X11 (WSLg provides both)
    wayland
    libxkbcommon
    xorg.libX11
    xorg.libXrandr
    xorg.libXcursor
    xorg.libXi
  ];

  # Libraries that need to be on LD_LIBRARY_PATH for Tauri's WebKit at runtime
  runtimeLibs = with pkgs; [
    webkitgtk_4_1
    gtk3
    glib
    glib-networking
    libsoup_3
    cairo
    pango
    gdk-pixbuf
    atk
    harfbuzz
    librsvg
    openssl
    wayland
    libxkbcommon
    mesa
    xorg.libX11
    xorg.libXrandr
    xorg.libXcursor
    xorg.libXi
  ];
in
pkgs.mkShell {
  name = "journey-dev";

  packages =
    with pkgs;
    [
      # Node / JS
      nodejs_22
      pnpm

      # Testing
      playwright-driver.browsers
      k6
    ]
    ++ tauriDeps;

  # Playwright (pinned to nixpkgs' browser bundle)
  PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";

  # pkg-config needs to find .pc files for WebKit, GTK, etc.
  PKG_CONFIG_PATH = pkgs.lib.makeSearchPathOutput "dev" "lib/pkgconfig" tauriDeps;

  # Runtime library path so Tauri's WebView can dlopen system libs
  LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath runtimeLibs;

  # GIO needs this to find the TLS module (otherwise HTTPS in WebView fails)
  GIO_MODULE_DIR = "${pkgs.glib-networking}/lib/gio/modules";

  GDK_BACKEND = "x11";

  # Nixpkgs ships each pkg's GSettings schemas under
  # `<out>/share/gsettings-schemas/<pname-version>/glib-2.0/schemas/`. GLib
  # scans `<XDG_DATA_DIR>/glib-2.0/schemas/`, so each provider's subdir has
  # to be on XDG_DATA_DIRS individually — pointing at `<out>/share` finds
  # nothing. Without this, GTK aborts on first widget that reads desktop
  # settings (e.g. the native file chooser from tauri-plugin-dialog) with
  # "No GSettings schemas are installed on the system".
  XDG_DATA_DIRS =
    let
      schemaProviders = with pkgs; [
        gsettings-desktop-schemas
        gtk3
        webkitgtk_4_1
        glib-networking
      ];
      schemaDirs = pkgs.lib.concatStringsSep ":" (
        map (p: "${p}/share/gsettings-schemas/${p.name}") schemaProviders
      );
    in
    schemaDirs;

  shellHook = ''
    echo "journey-dev shell"
    echo "  node   $(node --version)"
    echo "  pnpm   $(pnpm --version)"
    echo "  rustc  $(rustc --version)"
    echo "  cargo  $(cargo --version)"
    echo "  k6     $(k6 version | head -1)"
    echo ""
    echo "Commands:"
    echo "  pnpm dev:web       — mock + API + GUI (web only)"
    echo "  pnpm dev:tauri     — mock + API + Tauri app (once #25 lands)"
    echo "  pnpm test:e2e      — Playwright headless e2e"
    echo ""

    # Quick WSLg check
    if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
      echo "WSLg detected (DISPLAY=$DISPLAY, WAYLAND=$WAYLAND_DISPLAY)"
    else
      echo "⚠  No display server found — GUI apps won't open."
      echo "   Make sure you're on Windows 11 with WSLg enabled."
    fi
  '';
}
