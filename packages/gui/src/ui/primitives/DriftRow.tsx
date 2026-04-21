import type { JSX } from "solid-js";
import { MethodBadge, type HttpMethod } from "./badges";

export type DriftRowProps = {
  method: HttpMethod;
  path: string;
  change: string;
  detail?: string;
};

export function DriftRow(props: DriftRowProps): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        padding: "6px 0",
        "border-bottom": "1px dashed var(--bd-1)",
        "font-size": "11px",
      }}
    >
      <MethodBadge method={props.method} />
      <span class="mono" style={{ color: "var(--fg-1)" }}>
        {props.path}
      </span>
      <span style={{ flex: 1 }} />
      <span class="mono" style={{ color: "var(--ac)" }}>
        {props.change}
      </span>
      <span class="mono" style={{ color: "var(--fg-3)" }}>
        {props.detail}
      </span>
    </div>
  );
}
