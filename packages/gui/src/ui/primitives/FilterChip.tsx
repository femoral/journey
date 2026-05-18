import type { JSX } from "solid-js";
import { For } from "solid-js";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { IconFilter } from "../icons";

export type FilterChipProps<T extends string> = {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  /** Abbreviate the value if longer than 8 chars. */
  short?: boolean;
  /** Value that counts as "off" (doesn't highlight chip). Defaults to "all". */
  emptyValue?: T;
};

export function FilterChip<T extends string>(props: FilterChipProps<T>): JSX.Element {
  const empty = () => props.emptyValue ?? ("all" as T);
  const active = () => props.value !== empty();
  const display = () => {
    const v = props.value;
    if (props.short && v.length > 8) return v.slice(0, 8) + "…";
    return v;
  };
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        class="mono"
        style={{
          display: "flex",
          "align-items": "center",
          gap: "4px",
          padding: "3px 8px",
          border: "1px solid var(--bd-1)",
          "border-radius": "3px",
          "font-size": "11px",
          background: active() ? "var(--ac-bg)" : "var(--bg-2)",
          color: active() ? "var(--ac)" : "var(--fg-2)",
        }}
      >
        <IconFilter size={10} />
        <span>
          {props.label}:{display()}
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          style={{
            background: "var(--bg-1)",
            border: "1px solid var(--bd-2)",
            "border-radius": "4px",
            padding: "3px",
            "min-width": "120px",
            "box-shadow": "0 8px 24px rgba(0,0,0,0.4)",
            "z-index": 70,
          }}
        >
          <For each={props.options}>
            {(opt) => (
              <DropdownMenu.Item
                onSelect={() => props.onChange(opt)}
                class="mono"
                style={{
                  width: "100%",
                  padding: "4px 8px",
                  "text-align": "left",
                  "font-size": "11px",
                  "border-radius": "3px",
                  color: opt === props.value ? "var(--ac)" : "var(--fg-1)",
                  background: opt === props.value ? "var(--ac-bg)" : "transparent",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {opt}
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
