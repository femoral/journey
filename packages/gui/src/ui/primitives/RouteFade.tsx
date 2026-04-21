import type { JSX } from "solid-js";

/**
 * Wraps a route's content to fade-in on mount. Use with `<RouteFade key={...}>`
 * so a changed key re-triggers the animation on route change.
 */
export type RouteFadeProps = {
  children: JSX.Element;
};

export function RouteFade(props: RouteFadeProps): JSX.Element {
  return (
    <div
      style={{
        animation: "jrn-fade-in 0.2s ease-out",
        height: "100%",
        "min-height": 0,
        display: "flex",
        "flex-direction": "column",
      }}
    >
      {props.children}
    </div>
  );
}
