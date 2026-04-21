import type { JSX } from "solid-js";

export type SectionProps = {
  title: JSX.Element;
  children: JSX.Element;
};

export function Section(props: SectionProps): JSX.Element {
  return (
    <div>
      <div
        style={{
          "font-size": "10px",
          color: "var(--fg-3)",
          "text-transform": "uppercase",
          "letter-spacing": "0.06em",
          "margin-bottom": "6px",
        }}
      >
        {props.title}
      </div>
      {props.children}
    </div>
  );
}
