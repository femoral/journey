/** @type {import('tailwindcss').Config} */

/*
 * Journey Tailwind config. Colors map to CSS custom properties declared in
 * src/styles/tokens.css so the active palette can be swapped at runtime (e.g.
 * accent change) without a rebuild.
 *
 * Legacy `brand.*` (indigo) is retained until the page-by-page revamp (M3)
 * finishes replacing every brand-* class reference.
 */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          0: "var(--bg-0)",
          1: "var(--bg-1)",
          2: "var(--bg-2)",
          3: "var(--bg-3)",
          4: "var(--bg-4)",
        },
        bd: {
          1: "var(--bd-1)",
          2: "var(--bd-2)",
          3: "var(--bd-3)",
        },
        fg: {
          0: "var(--fg-0)",
          1: "var(--fg-1)",
          2: "var(--fg-2)",
          3: "var(--fg-3)",
          4: "var(--fg-4)",
        },
        ac: {
          DEFAULT: "var(--ac)",
          dim: "var(--ac-dim)",
          bg: "var(--ac-bg)",
          bd: "var(--ac-bd)",
        },
        ok: {
          DEFAULT: "var(--ok)",
          bg: "var(--ok-bg)",
        },
        warn: {
          DEFAULT: "var(--warn)",
          bg: "var(--warn-bg)",
        },
        err: {
          DEFAULT: "var(--err)",
          bg: "var(--err-bg)",
        },
        info: {
          DEFAULT: "var(--info)",
          bg: "var(--info-bg)",
        },
        method: {
          get: "var(--m-get)",
          post: "var(--m-post)",
          put: "var(--m-put)",
          patch: "var(--m-patch)",
          del: "var(--m-del)",
        },
        // Legacy — removed page-by-page during M3.
        brand: {
          50: "#eef2ff",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
        },
      },
      fontFamily: {
        sans: [
          "Geist",
          "SF Pro Text",
          "-apple-system",
          "BlinkMacSystemFont",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "monospace",
        ],
      },
      borderRadius: {
        1: "3px",
        2: "5px",
        3: "8px",
        4: "12px",
      },
      spacing: {
        "sidebar-w": "var(--sidebar-w)",
        "topbar-h": "var(--topbar-h)",
        "row-dense": "var(--row-dense)",
        "row-mid": "var(--row-mid)",
        "row-comfy": "var(--row-comfy)",
      },
      animation: {
        "jrn-pulse": "jrn-pulse 1s ease-in-out infinite",
        "jrn-fade-in": "jrn-fade-in 0.2s ease-out",
      },
    },
  },
  plugins: [],
};
