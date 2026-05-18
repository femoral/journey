import type { JSX } from "solid-js";
import { Show } from "solid-js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | (string & {});

const METHOD_COLORS: Record<string, string> = {
  GET: "var(--m-get)",
  POST: "var(--m-post)",
  PUT: "var(--m-put)",
  PATCH: "var(--m-patch)",
  DELETE: "var(--m-del)",
};

export type MethodBadgeProps = {
  method: HttpMethod;
  size?: "sm" | "lg";
};

export function MethodBadge(props: MethodBadgeProps): JSX.Element {
  const color = () => METHOD_COLORS[props.method] ?? "var(--fg-2)";
  const size = () => props.size ?? "sm";
  const display = () => (props.method === "DELETE" ? "DEL" : props.method);
  return (
    <span
      class="mono"
      data-testid="method-badge"
      style={{
        color: color(),
        "font-weight": 600,
        "font-size": size() === "sm" ? "10px" : "11px",
        "letter-spacing": "0.04em",
        "min-width": size() === "sm" ? "30px" : "38px",
        display: "inline-block",
        "text-align": "left",
      }}
    >
      {display()}
    </span>
  );
}

export type StatusPillProps = {
  status: number;
};

export function StatusPill(props: StatusPillProps): JSX.Element {
  const palette = () => {
    const s = props.status;
    if (s >= 200 && s < 300) return { color: "var(--ok)", bg: "var(--ok-bg)" };
    if (s >= 300 && s < 500) return { color: "var(--warn)", bg: "var(--warn-bg)" };
    if (s >= 500) return { color: "var(--err)", bg: "var(--err-bg)" };
    return { color: "var(--fg-2)", bg: "transparent" };
  };
  return (
    <span
      class="mono"
      data-testid="status-pill"
      style={{
        color: palette().color,
        background: palette().bg,
        padding: "1px 6px",
        "border-radius": "3px",
        "font-size": "11px",
        "font-weight": 600,
      }}
    >
      {props.status}
    </span>
  );
}

export type RunState = "pass" | "fail" | "running" | "pending" | "idle";

export type RunDotProps = {
  state: RunState;
  size?: number;
};

export function RunDot(props: RunDotProps): JSX.Element {
  const color = () => {
    switch (props.state) {
      case "pass":
        return "var(--ok)";
      case "fail":
        return "var(--err)";
      case "running":
        return "var(--ac)";
      default:
        return "var(--fg-3)";
    }
  };
  const size = () => props.size ?? 8;
  return (
    <span
      data-testid="run-dot"
      data-state={props.state}
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        "border-radius": "50%",
        background: color(),
        "box-shadow": props.state === "running" ? `0 0 0 3px ${color()}22` : "none",
        "flex-shrink": 0,
        display: "inline-block",
        animation: props.state === "running" ? "jrn-pulse 1s ease-in-out infinite" : undefined,
      }}
    />
  );
}
