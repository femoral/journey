import type { JSX } from "solid-js";
import { Show } from "solid-js";

export type PanelProps = {
  title?: JSX.Element;
  badge?: JSX.Element;
  action?: JSX.Element;
  children: JSX.Element;
};

export function Panel(props: PanelProps): JSX.Element {
  return (
    <div
      style={{
        border: "1px solid var(--bd-1)",
        "border-radius": "6px",
        background: "var(--bg-1)",
        overflow: "hidden",
      }}
    >
      <Show when={props.title || props.action || props.badge}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            padding: "10px 12px",
            "border-bottom": "1px solid var(--bd-1)",
          }}
        >
          <div style={{ "font-size": "12px", "font-weight": 500, color: "var(--fg-0)" }}>
            {props.title}
          </div>
          <Show when={props.badge}>
            <span
              class="mono"
              style={{
                "font-size": "10px",
                color: "var(--ac)",
                background: "var(--ac-bg)",
                padding: "0 5px",
                "border-radius": "8px",
              }}
            >
              {props.badge}
            </span>
          </Show>
          <div style={{ flex: 1 }} />
          {props.action}
        </div>
      </Show>
      {props.children}
    </div>
  );
}
