import type { JSX } from "solid-js";
import { Show, createSignal, onCleanup } from "solid-js";
import { IconConsole, IconX } from "../ui/icons";

/**
 * Placeholder dock for the future live-run console (M4 builds the real one).
 * For now it renders an empty panel with the correct resize behavior so the
 * rest of the shell can be validated and so M4 only has to fill the tabs in.
 */
export type ConsoleDockShellProps = {
  open: boolean;
  onClose: () => void;
};

const MIN_H = 200;
const MAX_H = 700;
const HEIGHT_KEY = "jrn:consoleHeight";

export function ConsoleDockShell(props: ConsoleDockShellProps): JSX.Element {
  const initialHeight = Number(localStorage.getItem(HEIGHT_KEY)) || 300;
  const [height, setHeight] = createSignal(
    Math.max(MIN_H, Math.min(MAX_H, initialHeight)),
  );

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height();
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(MIN_H, Math.min(MAX_H, startH + (startY - ev.clientY)));
      setHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem(HEIGHT_KEY, String(height()));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  onCleanup(() => {
    localStorage.setItem(HEIGHT_KEY, String(height()));
  });

  return (
    <Show when={props.open}>
      <div
        style={{
          height: `${height()}px`,
          "flex-shrink": 0,
          "border-top": "1px solid var(--bd-2)",
          background: "var(--bg-0)",
          display: "flex",
          "flex-direction": "column",
          position: "relative",
        }}
      >
        <div
          onMouseDown={onMouseDown}
          role="separator"
          aria-orientation="horizontal"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "-3px",
            height: "6px",
            cursor: "row-resize",
            "z-index": 2,
          }}
        />
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            padding: "0 12px",
            "border-bottom": "1px solid var(--bd-1)",
            height: "36px",
            "flex-shrink": 0,
          }}
        >
          <IconConsole size={13} style={{ color: "var(--fg-2)" }} />
          <span style={{ "font-size": "12px", color: "var(--fg-1)" }}>Console</span>
          <span
            class="mono"
            style={{
              "font-size": "10px",
              color: "var(--fg-3)",
              border: "1px solid var(--bd-1)",
              padding: "1px 5px",
              "border-radius": "3px",
            }}
          >
            preview
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={props.onClose}
            style={{ color: "var(--fg-2)", padding: "6px 8px" }}
            title="Close"
          >
            <IconX size={12} />
          </button>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            color: "var(--fg-3)",
            "font-size": "12px",
            "flex-direction": "column",
            gap: "8px",
          }}
        >
          <span>Live request/response stream will appear here.</span>
          <span class="mono" style={{ "font-size": "10px", color: "var(--fg-4)" }}>
            wired in a later milestone
          </span>
        </div>
      </div>
    </Show>
  );
}
