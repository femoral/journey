import type { JSX } from "solid-js";
import { Show } from "solid-js";

export type TypeHintProps = {
  t: string;
  required?: boolean;
};

export function TypeHint(props: TypeHintProps): JSX.Element {
  return (
    <span
      class="mono"
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "4px",
        "font-size": "10px",
      }}
    >
      <span style={{ color: "var(--fg-3)" }}>{props.t}</span>
      <Show when={props.required}>
        <span style={{ color: "var(--ac)", "font-size": "9px" }}>required</span>
      </Show>
    </span>
  );
}
