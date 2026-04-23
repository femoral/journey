import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";
import { api, type EndpointSummary } from "../api/client";
import { IconX, JsonPretty } from "../ui";

export type SaveAsStepPayload = {
  endpoint: EndpointSummary;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
};

export type SaveAsStepDialogProps = {
  open: boolean;
  onClose: () => void;
  payload: SaveAsStepPayload | undefined;
  onSaved?: (file: string) => void;
};

/**
 * Appends a `step(...)` block into the last `});` of the chosen journey file.
 * This is a textual codemod — fine for journeys authored through the bundled
 * skeleton (`journey("name", () => { ...steps... });`). For hand-written
 * journeys with multiple top-level calls the user is warned up-front.
 */
export function SaveAsStepDialog(props: SaveAsStepDialogProps): JSX.Element {
  const [journeys] = createResource(
    () => props.open,
    async (isOpen) => (isOpen ? await api.getJourneys() : undefined),
  );
  const [file, setFile] = createSignal<string | undefined>(undefined);
  const [name, setName] = createSignal("");
  const [status, setStatus] = createSignal<string | undefined>(undefined);
  const [busy, setBusy] = createSignal(false);

  // Default the step name to METHOD /path when a payload arrives.
  createEffect(() => {
    if (!props.open) return;
    const p = props.payload;
    if (p) setName(`${p.method} ${p.path}`);
    const list = journeys()?.files ?? [];
    if (!file() && list.length > 0) setFile(list[0]);
  });

  createEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const snippet = () => {
    const p = props.payload;
    if (!p) return "";
    return renderStepBlock(name().trim() || `${p.method} ${p.path}`, p);
  };

  const save = async () => {
    const p = props.payload;
    const f = file();
    if (!p || !f) return;
    setBusy(true);
    setStatus(undefined);
    try {
      const src = await api.getJourneySource(f);
      const next = insertStep(src.source, snippet());
      if (!next.ok) {
        setStatus(next.reason);
        setBusy(false);
        return;
      }
      await api.saveJourneySource(f, next.source);
      setStatus(`Saved to ${f}.`);
      props.onSaved?.(f);
      // Give the user a beat to read "Saved" before closing.
      setTimeout(() => {
        setBusy(false);
        props.onClose();
      }, 600);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Show when={props.open}>
      <div
        onClick={props.onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          "z-index": 80,
        }}
      />
      <div
        role="dialog"
        aria-label="Save request as journey step"
        data-testid="save-as-step-dialog"
        style={{
          position: "fixed",
          top: "15%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(620px, 94vw)",
          "max-height": "72vh",
          background: "var(--bg-1)",
          border: "1px solid var(--bd-2)",
          "border-radius": "6px",
          "box-shadow": "0 20px 60px rgba(0,0,0,0.6)",
          "z-index": 81,
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            padding: "10px 14px",
            "border-bottom": "1px solid var(--bd-1)",
          }}
        >
          <div style={{ "font-size": "13px", "font-weight": 600 }}>
            Save as journey step
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={props.onClose}
            style={{ color: "var(--fg-3)" }}
            aria-label="Close"
          >
            <IconX size={13} />
          </button>
        </div>
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            "flex-direction": "column",
            gap: "12px",
            overflow: "auto",
          }}
        >
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <label
              style={{
                "font-size": "10px",
                color: "var(--fg-3)",
                "text-transform": "uppercase",
                "letter-spacing": "0.08em",
              }}
            >
              Target journey
            </label>
            <select
              data-testid="save-as-step-file"
              value={file() ?? ""}
              onChange={(e) => setFile(e.currentTarget.value || undefined)}
              class="mono"
              style={{
                padding: "6px 8px",
                border: "1px solid var(--bd-2)",
                "border-radius": "4px",
                background: "var(--bg-0)",
                color: "var(--fg-0)",
                "font-size": "12px",
              }}
            >
              <Show
                when={(journeys()?.files ?? []).length > 0}
                fallback={<option value="">(no journeys found)</option>}
              >
                <For each={journeys()?.files ?? []}>
                  {(f) => <option value={f}>{f}</option>}
                </For>
              </Show>
            </select>
          </div>

          <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <label
              style={{
                "font-size": "10px",
                color: "var(--fg-3)",
                "text-transform": "uppercase",
                "letter-spacing": "0.08em",
              }}
            >
              Step name
            </label>
            <input
              data-testid="save-as-step-name"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              class="mono"
              style={{
                padding: "6px 8px",
                border: "1px solid var(--bd-2)",
                "border-radius": "4px",
                background: "var(--bg-0)",
                color: "var(--fg-0)",
                "font-size": "12px",
              }}
            />
          </div>

          <div>
            <div
              style={{
                "font-size": "10px",
                color: "var(--fg-3)",
                "text-transform": "uppercase",
                "letter-spacing": "0.08em",
                "margin-bottom": "4px",
              }}
            >
              Preview
            </div>
            <pre
              class="mono"
              data-testid="save-as-step-preview"
              style={{
                margin: 0,
                padding: "10px 14px",
                "font-size": "11px",
                "line-height": 1.6,
                color: "var(--fg-1)",
                background: "var(--bg-0)",
                border: "1px solid var(--bd-1)",
                "border-radius": "4px",
                "white-space": "pre-wrap",
                "word-break": "break-word",
                "max-height": "260px",
                overflow: "auto",
              }}
            >
              <JsonPretty text={snippet()} />
            </pre>
          </div>
          <div
            style={{
              "font-size": "11px",
              color: "var(--fg-3)",
            }}
          >
            Appended before the last <span class="mono">{");"}</span> in the
            file. For multi-journey files, double-check the result.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            padding: "10px 14px",
            "border-top": "1px solid var(--bd-1)",
          }}
        >
          <Show when={status()}>
            <span
              class="mono"
              data-testid="save-as-step-status"
              style={{
                "font-size": "11px",
                color: status()?.startsWith("Saved") ? "var(--ok)" : "var(--err)",
              }}
            >
              {status()}
            </span>
          </Show>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={props.onClose}
            style={{
              padding: "5px 12px",
              border: "1px solid var(--bd-2)",
              "border-radius": "4px",
              "font-size": "12px",
              color: "var(--fg-1)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="save-as-step-save"
            onClick={() => void save()}
            disabled={busy() || !file() || !props.payload}
            style={{
              padding: "5px 14px",
              background: "var(--ac)",
              color: "#1a1200",
              "border-radius": "4px",
              "font-size": "12px",
              "font-weight": 600,
              opacity: busy() ? 0.6 : 1,
            }}
          >
            {busy() ? "Saving…" : "Append step"}
          </button>
        </div>
      </div>
    </Show>
  );
}

/**
 * Renders a `step("name", { … });` block from an endpoint + its resolved
 * request fields. Uses the descriptor form for `endpoint` so the journey
 * file doesn't need a codegen-generated import to work.
 */
export function renderStepBlock(
  name: string,
  p: SaveAsStepPayload,
): string {
  const lines: string[] = [];
  lines.push(`  step(${JSON.stringify(name)}, {`);
  lines.push(
    `    endpoint: { method: ${JSON.stringify(p.method)}, path: ${JSON.stringify(p.path)} },`,
  );
  if (Object.keys(p.headers).length > 0) {
    lines.push(`    headers: ${JSON.stringify(p.headers, null, 2).replace(/\n/g, "\n    ")},`);
  }
  if (p.body !== undefined) {
    const bodyStr = JSON.stringify(p.body, null, 2).replace(/\n/g, "\n    ");
    lines.push(`    body: ${bodyStr},`);
  }
  lines.push(`  });`);
  return lines.join("\n");
}

export function insertStep(
  source: string,
  snippet: string,
): { ok: true; source: string } | { ok: false; reason: string } {
  const idx = source.lastIndexOf("});");
  if (idx === -1) {
    return {
      ok: false,
      reason:
        "Couldn't find `});` to insert before. Is this a valid journey file?",
    };
  }
  // Find the start of the line containing the closing `});` so we preserve
  // indentation before it.
  let lineStart = idx;
  while (lineStart > 0 && source[lineStart - 1] !== "\n") lineStart--;
  const before = source.slice(0, lineStart);
  const after = source.slice(lineStart);
  // Separate the new block from the previous line and from the closing `});`.
  const sep = before.endsWith("\n") ? "" : "\n";
  return { ok: true, source: `${before}${sep}${snippet}\n${after}` };
}
