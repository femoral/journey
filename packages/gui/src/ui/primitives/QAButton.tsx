import type { Component, JSX } from "solid-js";
import type { IconProps } from "../icons";

export type QAButtonProps = {
  icon: Component<IconProps>;
  label: string;
  sub?: string;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
};

export function QAButton(props: QAButtonProps): JSX.Element {
  const Icon = props.icon;
  return (
    <button
      onClick={props.onClick}
      class="group"
      style={{
        display: "flex",
        "align-items": "center",
        gap: "10px",
        padding: "10px 12px",
        border: "1px solid var(--bd-1)",
        "border-radius": "5px",
        "text-align": "left",
        background: "var(--bg-0)",
        transition: "border-color 0.1s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--bd-3)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--bd-1)";
      }}
    >
      <Icon size={14} style={{ color: "var(--ac)" }} />
      <div>
        <div style={{ "font-size": "12px", color: "var(--fg-0)" }}>{props.label}</div>
        <div class="mono" style={{ "font-size": "10px", color: "var(--fg-3)" }}>
          {props.sub}
        </div>
      </div>
    </button>
  );
}
