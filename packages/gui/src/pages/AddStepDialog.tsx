import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";
import { api } from "../api/client";
import {
  IconSearch,
  IconX,
  JsonPretty,
  MethodBadge,
  type HttpMethod,
} from "../ui";
import { insertStep, renderStepBlock } from "./SaveAsStepDialog";

export type AddStepDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Current in-memory source for the journey; dialog returns new source. */
  source: string;
  onAppend: (nextSource: string) => void;
};

/**
 * Picks an endpoint from /api/endpoints and appends a `step()` block that
 * references it. The insertion codemod is shared with "Save as step" on the
 * Endpoints page so both flows land structurally identical blocks.
 */
export function AddStepDialog(props: AddStepDialogProps): JSX.Element {
  const [endpoints] = createResource(
    () => props.open,
    async (isOpen) => (isOpen ? await api.getEndpoints() : undefined),
  );
  const [query, setQuery] = createSignal("");
  const [selectedName, setSelectedName] = createSignal<string | undefined>(undefined);
  const [stepName, setStepName] = createSignal("");
  const [status, setStatus] = createSignal<string | undefined>(undefined);

  createEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  createEffect(() => {
    const list = endpoints()?.endpoints ?? [];
    if (!selectedName() && list.length > 0) setSelectedName(list[0]!.name);
  });

  const filtered = createMemo(() => {
    const q = query().toLowerCase();
    const list = endpoints()?.endpoints ?? [];
    return q
      ? list.filter(
          (e) =>
            e.path.toLowerCase().includes(q) || e.name.toLowerCase().includes(q),
        )
      : list;
  });

  const selected = createMemo(() =>
    (endpoints()?.endpoints ?? []).find((e) => e.name === selectedName()),
  );

  createEffect(() => {
    const s = selected();
    if (!s) return;
    if (!stepName()) setStepName(`${s.method} ${s.path}`);
  });

  const snippet = () => {
    const s = selected();
    if (!s) return "";
    return renderStepBlock(stepName().trim() || `${s.method} ${s.path}`, {
      endpoint: s,
      method: s.method,
      path: s.path,
      headers: {},
    });
  };

  const append = () => {
    const s = selected();
    if (!s) return;
    const res = insertStep(props.source, snippet());
    if (!res.ok) {
      setStatus(res.reason);
      return;
    }
    props.onAppend(res.source);
    props.onClose();
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
        aria-label="Add step from endpoint"
        data-testid="add-step-dialog"
        style={{
          position: "fixed",
          top: "12%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(680px, 94vw)",
          "max-height": "76vh",
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
            Add step from endpoint
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
            display: "grid",
            "grid-template-columns": "280px 1fr",
            flex: 1,
            "min-height": 0,
          }}
        >
          <div
            style={{
              "border-right": "1px solid var(--bd-1)",
              display: "flex",
              "flex-direction": "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "8px 12px",
                display: "flex",
                "align-items": "center",
                gap: "6px",
                "border-bottom": "1px solid var(--bd-1)",
              }}
            >
              <IconSearch size={12} style={{ color: "var(--fg-3)" }} />
              <input
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                placeholder="filter endpoints…"
                class="mono"
                data-testid="add-step-filter"
                style={{ flex: 1, "font-size": "12px" }}
              />
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              <For each={filtered()}>
                {(e) => (
                  <button
                    type="button"
                    onClick={() => setSelectedName(e.name)}
                    data-testid={`add-step-endpoint-${e.name}`}
                    style={{
                      width: "100%",
                      display: "flex",
                      "align-items": "center",
                      gap: "8px",
                      padding: "6px 14px",
                      "text-align": "left",
                      "font-size": "12px",
                      background:
                        selectedName() === e.name ? "var(--bg-3)" : "transparent",
                      "border-left":
                        selectedName() === e.name
                          ? "2px solid var(--ac)"
                          : "2px solid transparent",
                    }}
                  >
                    <MethodBadge method={e.method as HttpMethod} />
                    <span
                      class="mono"
                      style={{
                        flex: 1,
                        color: "var(--fg-1)",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                      }}
                    >
                      {e.path}
                    </span>
                  </button>
                )}
              </For>
            </div>
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
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "4px",
              }}
            >
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
                value={stepName()}
                onInput={(e) => setStepName(e.currentTarget.value)}
                class="mono"
                data-testid="add-step-name"
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
                data-testid="add-step-preview"
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
                  "max-height": "240px",
                  overflow: "auto",
                }}
              >
                <JsonPretty text={snippet()} />
              </pre>
            </div>
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
              style={{ "font-size": "11px", color: "var(--err)" }}
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
            onClick={append}
            disabled={!selected()}
            data-testid="add-step-append"
            style={{
              padding: "5px 14px",
              background: "var(--ac)",
              color: "#1a1200",
              "border-radius": "4px",
              "font-size": "12px",
              "font-weight": 600,
              opacity: selected() ? 1 : 0.5,
            }}
          >
            Append step
          </button>
        </div>
      </div>
    </Show>
  );
}

/**
 * Patches an existing step's name in source. Returns the new source or
 * `undefined` if the step at `stepStart..stepEnd` doesn't match the expected
 * `step("OLD_NAME", {` opening.
 */
export function renameStep(
  source: string,
  oldName: string,
  newName: string,
  stepStart: number,
  stepEnd: number,
): string | undefined {
  const block = source.slice(stepStart, stepEnd);
  const match = block.match(/^step\(\s*"([^"]+)"/);
  if (!match || match[1] !== oldName) return undefined;
  const before = source.slice(0, stepStart);
  const after = source.slice(stepEnd);
  const replaced = block.replace(
    /^step\(\s*"[^"]+"/,
    `step(${JSON.stringify(newName)}`,
  );
  return `${before}${replaced}${after}`;
}
