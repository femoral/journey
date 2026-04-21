import type { JSX } from "solid-js";
import { Show } from "solid-js";
import {
  IconChevronDown,
  IconConsole,
  IconFolder,
  IconSearch,
  IconSettings,
  JourneyMark,
} from "../ui/icons";

export type TopBarProps = {
  projectName: string | undefined;
  projectBranch?: string | undefined;
  envName?: string | undefined;
  envBaseUrl?: string | undefined;
  onOpenSwitcher: () => void;
  onToggleConsole: () => void;
  consoleOpen: boolean;
  onOpenTweaks?: (() => void) | undefined;
};

export function TopBar(props: TopBarProps): JSX.Element {
  return (
    <div
      style={{
        height: "var(--topbar-h)",
        display: "flex",
        "align-items": "center",
        "border-bottom": "1px solid var(--bd-1)",
        background: "var(--bg-0)",
        padding: "0 12px",
        gap: "10px",
        "flex-shrink": 0,
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "padding-right": "8px",
          "border-right": "1px solid var(--bd-1)",
          height: "100%",
        }}
      >
        <JourneyMark size={18} color="var(--ac)" />
        <span
          class="mono"
          style={{
            "font-size": "13px",
            "font-weight": 600,
            "letter-spacing": "-0.01em",
          }}
        >
          journey
        </span>
      </div>

      <button
        onClick={props.onOpenSwitcher}
        title="Switch project"
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "5px 10px 5px 8px",
          background: "var(--bg-2)",
          border: "1px solid var(--bd-2)",
          "border-radius": "5px",
          "font-size": "12px",
          color: "var(--fg-0)",
        }}
      >
        <IconFolder size={13} style={{ color: "var(--fg-2)" }} />
        <span class="mono" style={{ "font-weight": 500 }}>
          {props.projectName ?? "—"}
        </span>
        <Show when={props.projectBranch}>
          <span class="mono" style={{ color: "var(--fg-3)", "font-size": "11px" }}>
            ·
          </span>
          <span class="mono" style={{ color: "var(--fg-2)", "font-size": "11px" }}>
            {props.projectBranch}
          </span>
        </Show>
        <IconChevronDown size={11} style={{ color: "var(--fg-3)", "margin-left": "2px" }} />
      </button>

      <Show when={props.envName}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            padding: "5px 10px",
            border: "1px solid var(--bd-1)",
            "border-radius": "5px",
            "font-size": "11px",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              "border-radius": "50%",
              background: "var(--ac)",
            }}
          />
          <span class="mono" style={{ color: "var(--fg-1)" }}>
            {props.envName}
          </span>
          <Show when={props.envBaseUrl}>
            <span class="mono" style={{ color: "var(--fg-3)" }}>
              ·
            </span>
            <span class="mono" style={{ color: "var(--fg-2)" }}>
              {props.envBaseUrl}
            </span>
          </Show>
        </div>
      </Show>

      <div style={{ flex: 1 }} />

      <button
        disabled
        title="Search (coming soon)"
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "5px 10px",
          border: "1px solid var(--bd-1)",
          "border-radius": "5px",
          "font-size": "12px",
          color: "var(--fg-2)",
          "min-width": "220px",
          opacity: 0.6,
          cursor: "not-allowed",
        }}
      >
        <IconSearch size={12} />
        <span style={{ flex: 1, "text-align": "left" }}>
          Search endpoints, journeys…
        </span>
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
          ⌘K
        </span>
      </button>

      <div style={{ width: "1px", height: "20px", background: "var(--bd-1)" }} />

      <button
        onClick={props.onToggleConsole}
        title="Toggle console"
        aria-pressed={props.consoleOpen}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "5px 10px",
          "border-radius": "5px",
          "font-size": "12px",
          color: props.consoleOpen ? "var(--ac)" : "var(--fg-1)",
          background: props.consoleOpen ? "var(--ac-bg)" : "transparent",
          border: props.consoleOpen ? "1px solid var(--ac-bd)" : "1px solid transparent",
        }}
      >
        <IconConsole size={13} />
        <span>Console</span>
      </button>

      <Show when={props.onOpenTweaks}>
        <button
          onClick={props.onOpenTweaks}
          title="Tweaks"
          style={{
            width: "28px",
            height: "28px",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            color: "var(--fg-2)",
            "border-radius": "4px",
          }}
        >
          <IconSettings size={14} />
        </button>
      </Show>
    </div>
  );
}
