import type { JSX } from "solid-js";
import { Checkbox as KCheckbox } from "@kobalte/core/checkbox";

export type CheckboxProps = {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
};

/**
 * Journey-styled checkbox built on Kobalte for a11y. 13px square with an amber
 * accent fill; matches the prototype's inline form look.
 */
export function Checkbox(props: CheckboxProps): JSX.Element {
  return (
    <KCheckbox
      checked={props.checked ?? false}
      onChange={(v) => props.onChange?.(v)}
      disabled={props.disabled ?? false}
      aria-label={props["aria-label"] ?? ""}
    >
      <KCheckbox.Input class="sr-only" />
      <KCheckbox.Control
        style={{
          width: "13px",
          height: "13px",
          "border-radius": "2px",
          border: `1px solid ${props.checked ? "var(--ac)" : "var(--bd-3)"}`,
          background: props.checked ? "var(--ac)" : "transparent",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "flex-shrink": 0,
          cursor: props.disabled ? "not-allowed" : "pointer",
        }}
      >
        <KCheckbox.Indicator>
          <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
            <path
              d="M1.5 4.5L3.5 6.5L7.5 2"
              stroke="#1a1200"
              stroke-width="1.5"
              fill="none"
              stroke-linecap="square"
            />
          </svg>
        </KCheckbox.Indicator>
      </KCheckbox.Control>
    </KCheckbox>
  );
}
