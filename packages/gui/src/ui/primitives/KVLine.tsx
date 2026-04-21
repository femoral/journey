import type { JSX } from "solid-js";

export type KVLineProps = {
  k: JSX.Element;
  v: JSX.Element;
};

export function KVLine(props: KVLineProps): JSX.Element {
  return (
    <div
      class="mono"
      style={{
        display: "grid",
        "grid-template-columns": "70px 1fr",
        gap: "10px",
        "font-size": "11px",
        padding: "2px 0",
      }}
    >
      <span style={{ color: "var(--fg-3)" }}>{props.k}</span>
      <span style={{ color: "var(--fg-0)" }}>{props.v}</span>
    </div>
  );
}
