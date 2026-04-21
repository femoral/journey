import type { JSX } from "solid-js";
import { For, createMemo } from "solid-js";

export type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
};

export function Sparkline(props: SparklineProps): JSX.Element {
  const w = () => props.width ?? 240;
  const h = () => props.height ?? 40;

  const path = createMemo(() => {
    const vs = props.values;
    if (vs.length === 0) return { d: "", pts: [] as [number, number][] };
    const max = Math.max(...vs);
    const min = Math.min(...vs);
    const range = max - min || 1;
    const pts: [number, number][] = vs.map((v, i) => [
      vs.length > 1 ? (i / (vs.length - 1)) * w() : w() / 2,
      h() - ((v - min) / range) * (h() - 4) - 2,
    ]);
    const d = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
      .join(" ");
    return { d, pts };
  });

  return (
    <svg
      width="100%"
      height={h()}
      viewBox={`0 0 ${w()} ${h()}`}
      preserveAspectRatio="none"
    >
      <path d={`${path().d} L${w()} ${h()} L0 ${h()} Z`} fill="var(--ac-bg)" />
      <path d={path().d} stroke="var(--ac)" stroke-width="1.5" fill="none" />
      <For each={path().pts}>
        {(p) => <circle cx={p[0]} cy={p[1]} r="2" fill="var(--ac)" />}
      </For>
    </svg>
  );
}
