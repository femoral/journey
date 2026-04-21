import type { JSX } from "solid-js";

export type FieldProps = {
  label: JSX.Element;
  children: JSX.Element;
};

export function Field(props: FieldProps): JSX.Element {
  return (
    <label style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
      <span
        style={{
          "font-size": "11px",
          color: "var(--fg-2)",
          "text-transform": "uppercase",
          "letter-spacing": "0.06em",
        }}
      >
        {props.label}
      </span>
      {props.children}
    </label>
  );
}
