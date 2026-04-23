import type { Component, JSX } from "solid-js";
import { For, Show } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import {
  type IconProps,
  IconClock,
  IconDiff,
  IconEditor,
  IconEndpoints,
  IconEnv,
  IconFiles,
  IconGit,
  IconHome,
  IconJourneys,
  IconLayers,
} from "../ui/icons";

export type SidebarCounts = {
  endpoints?: number | undefined;
  journeys?: number | undefined;
  envs?: number | undefined;
  /** Spec-drift count — surfaces as a badge on the Spec diff tool. */
  drift?: number | undefined;
};

export type SidebarFooterInfo = {
  branch?: string;
  commit?: string;
  version?: string;
  servePort?: number;
};

export type SidebarProps = {
  counts: SidebarCounts;
  footer?: SidebarFooterInfo;
};

type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: Component<IconProps>;
  badge?: number | string | null;
  dim?: boolean;
};

export function Sidebar(props: SidebarProps): JSX.Element {
  const navItems = (): NavItem[] => [
    { id: "overview", href: "/", label: "Overview", icon: IconHome, badge: null },
    {
      id: "endpoints",
      href: "/endpoints",
      label: "Endpoints",
      icon: IconEndpoints,
      badge: props.counts.endpoints ?? null,
    },
    {
      id: "journeys",
      href: "/journeys",
      label: "Journeys",
      icon: IconJourneys,
      badge: props.counts.journeys ?? null,
    },
    { id: "editor", href: "/editor", label: "Editor", icon: IconEditor, badge: null },
    { id: "files", href: "/files", label: "Files", icon: IconFiles, badge: null },
    {
      id: "environments",
      href: "/environments",
      label: "Environments",
      icon: IconEnv,
      badge: props.counts.envs ?? null,
    },
  ];

  const toolItems = (): NavItem[] => [
    {
      id: "diff",
      href: "/diff",
      label: "Spec diff",
      icon: IconDiff,
      badge: props.counts.drift && props.counts.drift > 0 ? props.counts.drift : null,
    },
    { id: "history", href: "/history", label: "Run history", icon: IconClock, badge: null, dim: true },
    { id: "mock", href: "/mock", label: "Mock server", icon: IconLayers, badge: null, dim: true },
  ];

  return (
    <div
      style={{
        width: "var(--sidebar-w)",
        "flex-shrink": 0,
        background: "var(--bg-0)",
        "border-right": "1px solid var(--bd-1)",
        display: "flex",
        "flex-direction": "column",
        padding: "10px 8px",
      }}
    >
      <SidebarSection label="Project">
        <For each={navItems()}>{(n) => <SidebarItem item={n} />}</For>
      </SidebarSection>

      <SidebarSection label="Tools">
        <For each={toolItems()}>{(n) => <SidebarItem item={n} />}</For>
      </SidebarSection>

      <div style={{ flex: 1 }} />

      <Show when={props.footer}>
        {(footer) => (
          <div
            style={{
              "border-top": "1px solid var(--bd-1)",
              padding: "10px 6px 2px",
              display: "flex",
              "flex-direction": "column",
              gap: "6px",
            }}
          >
            <Show when={footer().branch || footer().commit}>
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                  "font-size": "11px",
                  color: "var(--fg-2)",
                }}
              >
                <IconGit size={11} />
                <Show when={footer().branch}>
                  <span class="mono" style={{ color: "var(--fg-1)" }}>
                    {footer().branch}
                  </span>
                </Show>
                <Show when={footer().commit}>
                  <span class="mono" style={{ color: "var(--fg-3)" }}>
                    ·
                  </span>
                  <span class="mono">{footer().commit}</span>
                </Show>
              </div>
            </Show>
            <Show when={footer().version || footer().servePort}>
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                  "font-size": "11px",
                  color: "var(--fg-3)",
                }}
              >
                <Show when={footer().version}>
                  <span class="mono">v{footer().version}</span>
                </Show>
                <span style={{ flex: 1 }} />
                <Show when={footer().servePort}>
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      "border-radius": "50%",
                      background: "var(--ok)",
                    }}
                  />
                  <span>serve :{footer().servePort}</span>
                </Show>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

function SidebarSection(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div style={{ "margin-bottom": "14px" }}>
      <div
        style={{
          padding: "4px 8px 6px",
          "font-size": "10px",
          "font-weight": 500,
          color: "var(--fg-3)",
          "letter-spacing": "0.08em",
          "text-transform": "uppercase",
        }}
      >
        {props.label}
      </div>
      <div style={{ display: "flex", "flex-direction": "column", gap: "1px" }}>
        {props.children}
      </div>
    </div>
  );
}

function SidebarItem(props: { item: NavItem }): JSX.Element {
  const location = useLocation();
  const active = () => {
    const path = location.pathname;
    if (props.item.href === "/") return path === "/";
    return path === props.item.href || path.startsWith(props.item.href + "/");
  };
  const Icon = props.item.icon;
  return (
    <A
      href={props.item.href}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "9px",
        padding: "6px 8px",
        "border-radius": "4px",
        background: active() ? "var(--bg-3)" : "transparent",
        color: props.item.dim
          ? "var(--fg-3)"
          : active()
            ? "var(--fg-0)"
            : "var(--fg-1)",
        "font-size": "13px",
        width: "100%",
        "text-align": "left",
        position: "relative",
        "text-decoration": "none",
      }}
      onMouseEnter={(e) => {
        if (!active())
          (e.currentTarget as HTMLElement).style.background = "var(--bg-1)";
      }}
      onMouseLeave={(e) => {
        if (!active())
          (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <Show when={active()}>
        <span
          style={{
            position: "absolute",
            left: "-8px",
            top: "6px",
            bottom: "6px",
            width: "2px",
            background: "var(--ac)",
            "border-radius": "0 2px 2px 0",
          }}
        />
      </Show>
      <Icon size={14} style={{ color: active() ? "var(--ac)" : "var(--fg-2)" }} />
      <span style={{ flex: 1 }}>{props.item.label}</span>
      <Show when={props.item.badge != null && props.item.badge !== ""}>
        <span
          class="mono"
          style={{
            "font-size": "10px",
            color: "var(--fg-3)",
            padding: "0 4px",
          }}
        >
          {props.item.badge}
        </span>
      </Show>
    </A>
  );
}
