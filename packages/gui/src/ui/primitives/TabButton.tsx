import type { JSX } from "solid-js";
import { Show } from "solid-js";

export type TabButtonProps = {
  active: boolean;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  label: JSX.Element;
  count?: number | null;
};

export function TabButton(props: TabButtonProps): JSX.Element {
  return (
    <button
      onClick={props.onClick}
      role="tab"
      aria-selected={props.active}
      style={{
        padding: "10px 14px",
        display: "flex",
        "align-items": "center",
        gap: "6px",
        "font-size": "12px",
        color: props.active ? "var(--fg-0)" : "var(--fg-2)",
        "border-bottom": props.active ? "2px solid var(--ac)" : "2px solid transparent",
        "margin-bottom": "-1px",
      }}
    >
      {props.label}
      <Show when={props.count != null}>
        <span class="mono" style={{ "font-size": "10px", color: "var(--fg-3)" }}>
          {props.count}
        </span>
      </Show>
    </button>
  );
}
