import type { JSX } from "solid-js";
import { For } from "solid-js";

export type SegBtnProps<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
};

export function SegBtn<T extends string>(props: SegBtnProps<T>): JSX.Element {
  return (
    <div
      role="radiogroup"
      style={{
        display: "flex",
        gap: "2px",
        background: "var(--bg-2)",
        padding: "2px",
        "border-radius": "4px",
      }}
    >
      <For each={props.options}>
        {(o) => (
          <button
            role="radio"
            aria-checked={props.value === o}
            onClick={() => props.onChange(o)}
            style={{
              flex: 1,
              padding: "4px 8px",
              "font-size": "11px",
              "border-radius": "3px",
              background: props.value === o ? "var(--bg-0)" : "transparent",
              color: props.value === o ? "var(--fg-0)" : "var(--fg-2)",
              border: props.value === o ? "1px solid var(--bd-2)" : "1px solid transparent",
              "text-transform": "capitalize",
            }}
          >
            {o}
          </button>
        )}
      </For>
    </div>
  );
}
