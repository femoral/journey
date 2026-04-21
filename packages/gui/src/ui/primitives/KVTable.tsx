import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import { IconPlus } from "../icons";

export type KVRow = {
  enabled?: boolean;
  cells: JSX.Element[];
};

export type KVTableProps = {
  rows: KVRow[];
  columns: {
    template: string;
    headers: JSX.Element[];
  };
  addLabel?: string;
  onAdd?: () => void;
};

export function KVTable(props: KVTableProps): JSX.Element {
  return (
    <div>
      <div
        style={{
          display: "grid",
          "grid-template-columns": props.columns.template,
          padding: "6px 16px",
          "font-size": "10px",
          color: "var(--fg-3)",
          "text-transform": "uppercase",
          "letter-spacing": "0.08em",
          "border-bottom": "1px solid var(--bd-1)",
          gap: "8px",
        }}
      >
        <For each={props.columns.headers}>{(h) => <div>{h}</div>}</For>
      </div>
      <For each={props.rows}>
        {(r) => (
          <div
            style={{
              display: "grid",
              "grid-template-columns": props.columns.template,
              padding: "6px 16px",
              "align-items": "center",
              gap: "8px",
              "border-bottom": "1px solid var(--bd-1)",
              opacity: r.enabled === false ? 0.5 : 1,
            }}
          >
            <For each={r.cells}>{(c) => <div style={{ "min-width": 0 }}>{c}</div>}</For>
          </div>
        )}
      </For>
      <Show when={props.onAdd || props.addLabel}>
        <button
          onClick={props.onAdd}
          style={{
            padding: "8px 16px",
            color: "var(--fg-3)",
            "font-size": "12px",
            display: "flex",
            "align-items": "center",
            gap: "6px",
          }}
        >
          <IconPlus size={11} /> {props.addLabel ?? "Add row"}
        </button>
      </Show>
    </div>
  );
}
