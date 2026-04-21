# Journey design system

Single source of truth for tokens, typography, and visual language. The tokens
themselves live in `packages/gui/src/styles/tokens.css` as CSS custom
properties; this document explains them. The reference implementation is the
prototype at `design/iterations/01-prototype/`.

Edit tokens in `tokens.css`; treat that file as authoritative. This doc tracks
*meaning* — what each scale is for and when to use which step.

## Surface scale — `--bg-0` through `--bg-4`

Dark-only for now. Each step is one elevation higher than the last.

| Token    | Hex       | Use                                               |
| -------- | --------- | ------------------------------------------------- |
| `--bg-0` | `#0a0c0f` | App background (root, topbar, sidebar)            |
| `--bg-1` | `#0f1216` | Panels, cards, dropdowns                          |
| `--bg-2` | `#141820` | Elevated panel, row hover                         |
| `--bg-3` | `#1a1f28` | Input, active nav item, selected row              |
| `--bg-4` | `#222832` | Strongly selected (rare; avoid unless contrast needs it) |

## Border scale — `--bd-1` through `--bd-3`

| Token    | Hex       | Use                                                    |
| -------- | --------- | ------------------------------------------------------ |
| `--bd-1` | `#1c2128` | Subtle dividers (section separators, row hairlines)    |
| `--bd-2` | `#272e38` | Standard control borders (buttons, inputs, cards)      |
| `--bd-3` | `#343c48` | Strong / emphasized borders (active input, hover lift) |

## Foreground scale — `--fg-0` through `--fg-4`

| Token    | Hex       | Use                                     |
| -------- | --------- | --------------------------------------- |
| `--fg-0` | `#f2f4f7` | Primary body text, headings             |
| `--fg-1` | `#c8cdd5` | Secondary text (labels, nav items)      |
| `--fg-2` | `#8892a0` | Tertiary / meta (path hints, timestamps) |
| `--fg-3` | `#5a6372` | Quaternary / placeholder, disabled-like |
| `--fg-4` | `#3b424d` | Truly disabled                          |

## Accent

OKLCH-based so the chroma and lightness stay consistent when swapping hues.

Four presets (used by the dev-only tweaker):

| Preset  | `--ac`                    |
| ------- | ------------------------- |
| amber   | `oklch(0.78 0.16 75)`     |
| lime    | `oklch(0.82 0.17 130)`    |
| cyan    | `oklch(0.78 0.12 200)`    |
| violet  | `oklch(0.72 0.18 300)`    |

Each preset exposes four variables: `--ac` (solid), `--ac-dim` (secondary
accent), `--ac-bg` (12% alpha fill for hover/active), `--ac-bd` (35% alpha
border). Swap by overwriting these four properties on `:root`.

## Semantic colors

Status meaning is fixed regardless of accent.

| Token    | Meaning                         | Reference hue   |
| -------- | ------------------------------- | --------------- |
| `--ok`   | 2xx, passing, healthy           | green `oklch(.74 .15 155)` |
| `--warn` | 3xx–4xx, caution                | amber `oklch(.78 .15 75)`  |
| `--err`  | 5xx, failed, destructive        | red `oklch(.68 .2 25)`     |
| `--info` | informational                   | blue `oklch(.72 .13 230)`  |

Each has a `-bg` companion (12% alpha fill) for pills and subtle backgrounds.

## HTTP method colors

Applied to `MethodBadge`. Distinct hue per method; intentionally overlaps with
semantic colors where it reads naturally (GET = green like "ok", DELETE = red
like "err").

| Token       | Method  |
| ----------- | ------- |
| `--m-get`   | GET     |
| `--m-post`  | POST    |
| `--m-put`   | PUT     |
| `--m-patch` | PATCH   |
| `--m-del`   | DELETE  |

## Typography

Two families, local-first (loaded via `@fontsource` — no CDN).

- **Sans** — Geist, 300 / 400 / 500 / 600 / 700. Default body.
- **Mono** — JetBrains Mono, 400 / 500 / 600. Code, paths, HTTP values. Enable
  with `.mono` utility (also applies `zero` + `ss02` OpenType features).

### Size scale

Six discrete sizes. Resist introducing in-between values.

| px  | Use                                                  |
| --- | ---------------------------------------------------- |
| 10  | Uppercase section labels, badges, kbd                |
| 11  | Meta (timestamps, paths), small table values         |
| 12  | Body small, control text (buttons, inputs, nav hints)|
| 13  | Default body, sidebar nav, standard buttons          |
| 16  | Section headings within a page                       |
| 22  | Page titles (Overview, Project home)                 |

### Weights

- `500` — default body
- `600` — headings, emphasized labels, method badges, status pills

### Letter-spacing

- `0.04em` — method badges (tight, uppercase)
- `0.06em` — small labels
- `0.08em` — uppercase section headers (`UPPERCASE LABEL`)

## Radius scale — `--r-1` through `--r-4`

| Token   | Use                                                        |
| ------- | ---------------------------------------------------------- |
| `--r-1` | `3px` — inline chips, status pills, small inline controls  |
| `--r-2` | `5px` — buttons, inputs, default controls                  |
| `--r-3` | `8px` — cards, popovers, panels                            |
| `--r-4` | `12px` — modals, large surfaces (rare)                     |

## Row heights

Three density presets for tabular data.

| Token           | Height |
| --------------- | ------ |
| `--row-dense`   | 28px   |
| `--row-mid`     | 32px   |
| `--row-comfy`   | 40px   |

User-selectable density via the tweaker; default is `mid`.

## Shell sizes

- `--topbar-h` — 46px (app top bar)
- `--sidebar-w` — 232px (left nav when labeled; ~48px when icon-only)

## Focus

`*:focus-visible { outline: 1px solid var(--ac); outline-offset: 1px; }`

Single global rule — components don't need their own focus ring.

## Animations

Two utility keyframes are pre-declared in `styles.css`:

- `jrn-pulse` — 1s infinite opacity 1 ↔ 0.3 (running indicators)
- `jrn-fade-in` — 0.2s ease-out, slight Y-translate (route transitions)

Both are exposed as Tailwind animations: `animate-jrn-pulse`, `animate-jrn-fade-in`.

## Tailwind mapping

`tailwind.config.cjs` maps every token to a Tailwind color / spacing key so
component code uses utilities rather than raw `var(--…)` strings:

- `bg-bg-1`, `bg-bg-2`, … for surfaces
- `border-bd-1`, `border-bd-2`, `border-bd-3`
- `text-fg-0` … `text-fg-4`
- `text-ac`, `bg-ac-bg`, `border-ac-bd` for accent
- `text-ok`, `bg-ok-bg` / `text-err`, `bg-err-bg` / etc. for semantic
- `text-method-get` / `text-method-post` / … for HTTP methods
- `rounded-1`, `rounded-2`, `rounded-3`, `rounded-4` for radius
- `h-topbar-h`, `w-sidebar-w`, `h-row-dense`, … for shell dimensions
- `animate-jrn-pulse`, `animate-jrn-fade-in`

Raw `var(--…)` is acceptable where a utility would be awkward (e.g., dynamic
inline styles, box-shadow composition).

## Non-goals (for now)

- **Light mode** — planned but not in scope for the first redesign pass.
  Every token above is dark-value; when light mode lands, each will need a
  paired light value under a `[data-theme='light']` selector.
- **Elevation / shadow tokens** — shadows are ad-hoc today (one shadow used in
  modals). Formalize when we have a second use.
- **Motion tokens** — only two durations in use. Formalize when there are more.
