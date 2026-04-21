import type { JSX } from "solid-js";

export type TableInputProps = {
  value?: string;
  placeholder?: string;
  mono?: boolean;
  dim?: boolean;
  onInput?: (v: string) => void;
};

export function TableInput(props: TableInputProps): JSX.Element {
  return (
    <input
      value={props.value ?? ""}
      placeholder={props.placeholder}
      class={props.mono === false ? undefined : "mono"}
      onInput={(e) => props.onInput?.(e.currentTarget.value)}
      style={{
        width: "100%",
        "font-size": "12px",
        color: props.dim ? "var(--fg-3)" : "var(--fg-0)",
        padding: "3px 0",
      }}
    />
  );
}
