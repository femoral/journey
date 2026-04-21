import type { JSX } from "solid-js";
import { Show } from "solid-js";

export type MiniTabProps = {
  active: boolean;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  label: JSX.Element;
  count?: number | null;
};

export function MiniTab(props: MiniTabProps): JSX.Element {
  return (
    <button
      onClick={props.onClick}
      role="tab"
      aria-selected={props.active}
      style={{
        padding: "7px 12px",
        "font-size": "11px",
        color: props.active ? "var(--fg-0)" : "var(--fg-2)",
        "border-bottom": props.active ? "2px solid var(--ac)" : "2px solid transparent",
        "margin-bottom": "-1px",
        display: "flex",
        "align-items": "center",
        gap: "5px",
      }}
    >
      {props.label}
      <Show when={props.count != null}>
        <span class="mono" style={{ "font-size": "9px", color: "var(--fg-3)" }}>
          {props.count}
        </span>
      </Show>
    </button>
  );
}
