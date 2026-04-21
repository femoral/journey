import type { JSX } from "solid-js";

export type StatProps = {
  label: string;
  value: JSX.Element;
  sub?: JSX.Element;
  valueColor?: string;
};

export function Stat(props: StatProps): JSX.Element {
  return (
    <div style={{ background: "var(--bg-1)", padding: "14px 16px" }}>
      <div
        style={{
          "font-size": "11px",
          color: "var(--fg-2)",
          "text-transform": "uppercase",
          "letter-spacing": "0.06em",
          "margin-bottom": "6px",
        }}
      >
        {props.label}
      </div>
      <div
        class="mono"
        style={{
          "font-size": "26px",
          "font-weight": 500,
          color: props.valueColor ?? "var(--fg-0)",
          "line-height": 1,
        }}
      >
        {props.value}
      </div>
      <div
        class="mono"
        style={{
          "font-size": "11px",
          color: "var(--fg-3)",
          "margin-top": "4px",
        }}
      >
        {props.sub}
      </div>
    </div>
  );
}
