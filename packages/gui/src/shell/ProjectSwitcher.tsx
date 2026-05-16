import type { JSX } from "solid-js";
import { For, Show, createEffect, onCleanup } from "solid-js";
import { IconFolder, IconPlus } from "../ui/icons";
import type { RecentProject } from "./recentProjects";
import { isTauri } from "../api/runEvents";

export type ProjectSwitcherProps = {
  open: boolean;
  onClose: () => void;
  projects: RecentProject[];
  currentPath: string | undefined;
  onSwitch: (project: RecentProject) => void;
  onOpenFolder: () => void;
  onInitNew: () => void;
};

export function ProjectSwitcher(props: ProjectSwitcherProps): JSX.Element {
  createEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <Show when={props.open}>
      <div
        onClick={props.onClose}
        style={{
          position: "fixed",
          inset: 0,
          "z-index": 40,
        }}
      />
      <div
        role="dialog"
        aria-label="Project switcher"
        style={{
          position: "absolute",
          top: "calc(var(--topbar-h) + 4px)",
          left: "144px",
          "z-index": 50,
          width: "340px",
          background: "var(--bg-1)",
          border: "1px solid var(--bd-2)",
          "border-radius": "6px",
          "box-shadow": "0 16px 40px rgba(0,0,0,0.5)",
          padding: "6px",
        }}
      >
        <div
          style={{
            padding: "6px 8px 4px",
            "font-size": "10px",
            color: "var(--fg-3)",
            "text-transform": "uppercase",
            "letter-spacing": "0.08em",
          }}
        >
          Recent projects
        </div>
        <Show
          when={props.projects.length > 0}
          fallback={
            <div style={{ padding: "10px 8px", "font-size": "12px", color: "var(--fg-3)" }}>
              No recent projects yet.
            </div>
          }
        >
          <For each={props.projects}>
            {(p) => {
              const active = () => p.path === props.currentPath;
              return (
                <button
                  onClick={() => {
                    props.onSwitch(p);
                    props.onClose();
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    "align-items": "center",
                    gap: "10px",
                    padding: "7px 8px",
                    "border-radius": "4px",
                    background: active() ? "var(--bg-3)" : "transparent",
                    "text-align": "left",
                  }}
                  onMouseEnter={(e) => {
                    if (!active())
                      (e.currentTarget as HTMLElement).style.background = "var(--bg-2)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active())
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  <IconFolder size={13} style={{ color: active() ? "var(--ac)" : "var(--fg-2)" }} />
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div class="mono" style={{ "font-size": "13px", "font-weight": 500 }}>
                      {p.name}
                    </div>
                    <div
                      class="mono"
                      style={{
                        "font-size": "11px",
                        color: "var(--fg-3)",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                      }}
                    >
                      {p.path}
                    </div>
                  </div>
                </button>
              );
            }}
          </For>
        </Show>
        <div
          style={{
            "border-top": "1px solid var(--bd-1)",
            "margin-top": "4px",
            "padding-top": "4px",
          }}
        >
          <Show when={isTauri()}>
            <button
              onClick={() => {
                props.onOpenFolder();
                props.onClose();
              }}
              style={{
                width: "100%",
                display: "flex",
                "align-items": "center",
                gap: "10px",
                padding: "7px 8px",
                "border-radius": "4px",
                color: "var(--fg-1)",
                "font-size": "12px",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--bg-2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <IconFolder size={13} style={{ color: "var(--fg-2)" }} />
              <span>Open folder…</span>
              <span style={{ flex: 1 }} />
              <Kbd>⌘O</Kbd>
            </button>
          </Show>
          <button
            onClick={() => {
              props.onInitNew();
              props.onClose();
            }}
            style={{
              width: "100%",
              display: "flex",
              "align-items": "center",
              gap: "10px",
              padding: "7px 8px",
              "border-radius": "4px",
              color: "var(--fg-1)",
              "font-size": "12px",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--bg-2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <IconPlus size={13} style={{ color: "var(--fg-2)" }} />
            <span>Init new project…</span>
          </button>
        </div>
      </div>
    </Show>
  );
}

function Kbd(props: { children: JSX.Element }): JSX.Element {
  return (
    <span
      class="mono"
      style={{
        "font-size": "10px",
        color: "var(--fg-3)",
        border: "1px solid var(--bd-2)",
        padding: "1px 4px",
        "border-radius": "3px",
      }}
    >
      {props.children}
    </span>
  );
}
