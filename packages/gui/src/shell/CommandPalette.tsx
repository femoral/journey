import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  IconEditor,
  IconEndpoints,
  IconEnv,
  IconFiles,
  IconHome,
  IconJourneys,
  IconSearch,
  type IconProps,
} from "../ui/icons";
import { api } from "../api/client";
import { experimentalEnabled } from "../experimental";

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  /** Called after a command is selected so the caller can close the palette. */
  onRun?: () => void;
  /** Invoked by the "Import from cURL…" command. */
  onOpenImport?: () => void;
};

type Command = {
  id: string;
  label: string;
  hint: string;
  icon: (p: IconProps) => JSX.Element;
  run: () => void;
};

const ROUTES: Array<Omit<Command, "run"> & { path: string; experimental?: boolean }> = [
  { id: "r:/", path: "/", label: "Overview", hint: "go", icon: IconHome },
  {
    id: "r:/endpoints",
    path: "/endpoints",
    label: "Endpoints",
    hint: "go",
    icon: IconEndpoints,
  },
  {
    id: "r:/journeys",
    path: "/journeys",
    label: "Journeys",
    hint: "go",
    icon: IconJourneys,
  },
  {
    id: "r:/editor",
    path: "/editor",
    label: "Editor",
    hint: "go",
    icon: IconEditor,
    experimental: true,
  },
  { id: "r:/files", path: "/files", label: "Files", hint: "go", icon: IconFiles },
  {
    id: "r:/environments",
    path: "/environments",
    label: "Environments",
    hint: "go",
    icon: IconEnv,
  },
  {
    id: "r:/diff",
    path: "/diff",
    label: "Spec diff",
    hint: "go",
    icon: IconFiles,
  },
  {
    id: "r:/history",
    path: "/history",
    label: "Run history",
    hint: "go",
    icon: IconFiles,
  },
];

export function CommandPalette(props: CommandPaletteProps): JSX.Element {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("");
  const [cursor, setCursor] = createSignal(0);

  // Only fetch data when the palette is open so boot isn't slowed down.
  const [endpoints] = createResource(
    () => props.open,
    async (isOpen) => (isOpen ? await api.getEndpoints() : undefined),
  );
  const [journeys] = createResource(
    () => props.open,
    async (isOpen) => (isOpen ? await api.getJourneys() : undefined),
  );

  let inputEl: HTMLInputElement | undefined;
  createEffect(() => {
    if (props.open) {
      setQuery("");
      setCursor(0);
      // Focus the input on the next microtask so it's actually mounted.
      queueMicrotask(() => inputEl?.focus());
    }
  });

  const commands = createMemo<Command[]>(() => {
    const exp = experimentalEnabled();
    const routeCmds: Command[] = ROUTES.filter((r) => exp || !r.experimental).map((r) => ({
      id: r.id,
      label: r.label,
      hint: r.hint,
      icon: r.icon,
      run: () => navigate(r.path),
    }));
    const actionCmds: Command[] = props.onOpenImport
      ? [
          {
            id: "a:import",
            label: "Import from cURL…",
            hint: "action",
            icon: IconEndpoints,
            run: () => props.onOpenImport?.(),
          },
        ]
      : [];
    const endpointCmds: Command[] = (endpoints()?.endpoints ?? []).map((e) => ({
      id: `ep:${e.name}`,
      label: `${e.method} ${e.path}`,
      hint: "send",
      icon: IconEndpoints,
      run: () =>
        navigate(
          `/endpoints?method=${encodeURIComponent(e.method)}&url=${encodeURIComponent(
            `${endpoints()?.baseUrl ?? ""}${e.path}`,
          )}`,
        ),
    }));
    const journeyCmds: Command[] = exp
      ? (journeys()?.files ?? []).map((f) => ({
          id: `jr:${f}`,
          label: f,
          hint: "open",
          icon: IconJourneys,
          run: () => navigate("/editor"),
        }))
      : [];
    return [...actionCmds, ...routeCmds, ...endpointCmds, ...journeyCmds];
  });

  const filtered = createMemo<Command[]>(() => {
    const q = query().toLowerCase();
    if (!q) return commands();
    return commands().filter((c) => c.label.toLowerCase().includes(q));
  });

  createEffect(() => {
    if (cursor() >= filtered().length) setCursor(0);
  });

  const runCmd = (cmd: Command) => {
    cmd.run();
    props.onRun?.();
    props.onClose();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "j" && e.ctrlKey)) {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered().length - 1));
    } else if (e.key === "ArrowUp" || (e.key === "k" && e.ctrlKey)) {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered()[cursor()];
      if (cmd) runCmd(cmd);
    } else if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  };

  return (
    <Show when={props.open}>
      <div
        onClick={props.onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          "z-index": 80,
        }}
      />
      <div
        role="dialog"
        aria-label="Command palette"
        style={{
          position: "fixed",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(560px, 92vw)",
          background: "var(--bg-1)",
          border: "1px solid var(--bd-2)",
          "border-radius": "6px",
          "box-shadow": "0 20px 60px rgba(0,0,0,0.6)",
          "z-index": 81,
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
        }}
        onKeyDown={onKey}
        data-testid="command-palette"
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            padding: "10px 14px",
            "border-bottom": "1px solid var(--bd-1)",
          }}
        >
          <IconSearch size={13} style={{ color: "var(--fg-3)" }} />
          <input
            ref={inputEl}
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setCursor(0);
            }}
            placeholder="Search endpoints, journeys, pages…"
            class="mono"
            style={{ flex: 1, "font-size": "13px" }}
            data-testid="command-palette-input"
          />
          <span
            class="mono"
            style={{
              "font-size": "10px",
              color: "var(--fg-3)",
              border: "1px solid var(--bd-2)",
              padding: "1px 5px",
              "border-radius": "3px",
            }}
          >
            esc
          </span>
        </div>
        <div style={{ "max-height": "50vh", overflow: "auto", padding: "4px 0" }}>
          <Show
            when={filtered().length > 0}
            fallback={
              <div
                style={{
                  padding: "18px 16px",
                  "font-size": "12px",
                  color: "var(--fg-3)",
                  "text-align": "center",
                }}
              >
                No matches.
              </div>
            }
          >
            <For each={filtered()}>
              {(cmd, i) => (
                <button
                  type="button"
                  onClick={() => runCmd(cmd)}
                  data-testid={`command-${cmd.id}`}
                  style={{
                    width: "100%",
                    display: "flex",
                    "align-items": "center",
                    gap: "10px",
                    padding: "8px 14px",
                    "text-align": "left",
                    background: cursor() === i() ? "var(--bg-3)" : "transparent",
                    "font-size": "12px",
                  }}
                >
                  <cmd.icon size={13} style={{ color: "var(--fg-2)", "flex-shrink": 0 }} />
                  <span
                    class="mono"
                    style={{
                      flex: 1,
                      color: "var(--fg-0)",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {cmd.label}
                  </span>
                  <span class="mono" style={{ "font-size": "10px", color: "var(--fg-3)" }}>
                    {cmd.hint}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>
        <div
          style={{
            padding: "6px 14px",
            "border-top": "1px solid var(--bd-1)",
            "font-size": "10px",
            color: "var(--fg-3)",
            display: "flex",
            gap: "14px",
          }}
          class="mono"
        >
          <span>↑↓ navigate</span>
          <span>enter select</span>
          <span>esc close</span>
        </div>
      </div>
    </Show>
  );
}

/** Global hotkey that opens the palette on ⌘K (or Ctrl+K on Linux/Win). */
export function useCmdKHotkey(onOpen: () => void): void {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      // Don't fight the browser's address-bar shortcut on browsers that use
      // ⌘K for it — but most don't. Either way, grabbing it here is the
      // documented Journey shortcut.
      e.preventDefault();
      onOpen();
    }
  };
  window.addEventListener("keydown", handler);
  onCleanup(() => window.removeEventListener("keydown", handler));
}
