import type { JSX } from "solid-js";
import { For } from "solid-js";

export type TimingSegment = [label: string, ms: number];

export type TimingBreakdownProps = {
  total: number;
  segments: TimingSegment[];
  width?: number;
};

const COLORS = ["var(--info)", "var(--m-patch)", "var(--ac)", "var(--ok)", "var(--fg-2)"];

export function TimingBreakdown(props: TimingBreakdownProps): JSX.Element {
  const sum = () => props.segments.reduce((a, [, n]) => a + n, 0) || 1;
  const width = () => props.width ?? 160;
  return (
    <div
      class="mono"
      style={{
        display: "flex",
        "align-items": "center",
        gap: "6px",
        "font-size": "10px",
      }}
    >
      <div
        style={{
          display: "flex",
          width: `${width()}px`,
          height: "6px",
          "border-radius": "3px",
          overflow: "hidden",
          background: "var(--bg-2)",
        }}
      >
        <For each={props.segments}>
          {([label, n], i) => (
            <div
              title={`${label}: ${n}ms`}
              style={{
                width: `${(n / sum()) * 100}%`,
                background: COLORS[i() % COLORS.length],
              }}
            />
          )}
        </For>
      </div>
      <span style={{ color: "var(--fg-3)" }}>{props.total}ms</span>
    </div>
  );
}
