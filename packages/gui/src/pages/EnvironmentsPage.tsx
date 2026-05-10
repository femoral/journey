import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  type Component,
  type JSX,
} from "solid-js";
import { api, type Environment } from "../api/client";
import {
  IconPlus,
  IconX,
  JsonPretty,
  SegBtn,
} from "../ui";

type Row = { key: string; value: string };


export const EnvironmentsPage: Component = () => {
  const [data, { refetch }] = createResource(api.getEnvironments);
  const [selectedName, setSelectedName] = createSignal<string | undefined>(undefined);
  const [draft, setDraft] = createSignal<Row[]>([]);
  const [status, setStatus] = createSignal<string | undefined>(undefined);
  const [view, setView] = createSignal<"table" | "JSON">("table");

  const selectedEnv = createMemo(() =>
    data()?.environments.find((e) => e.name === selectedName()),
  );

  const isDirty = createMemo(() => {
    const env = selectedEnv();
    if (!env) return false;
    const built: Record<string, string> = {};
    for (const { key, value } of draft()) {
      if (key.trim()) built[key] = value;
    }
    const original = env.values;
    const builtKeys = Object.keys(built);
    if (builtKeys.length !== Object.keys(original).length) return true;
    for (const k of builtKeys) {
      if (built[k] !== original[k]) return true;
    }
    return false;
  });

  const loadDraftFor = (env: Environment) => {
    setDraft(Object.entries(env.values).map(([key, value]) => ({ key, value })));
    setStatus(undefined);
  };

  const save = async () => {
    const name = selectedName();
    if (!name) return;
    const values: Record<string, string> = {};
    for (const { key, value } of draft()) {
      if (key.trim()) values[key] = value;
    }
    try {
      await api.saveEnvironment(name, values);
      setStatus("Saved.");
      await refetch();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const destroy = async () => {
    const name = selectedName();
    if (!name) return;
    if (!globalThis.confirm(`Delete environment "${name}"?`)) return;
    await api.deleteEnvironment(name);
    setSelectedName(undefined);
    setDraft([]);
    await refetch();
  };

  const create = async () => {
    const name = globalThis.prompt("Environment name (letters, numbers, _.- only):");
    if (!name) return;
    await api.saveEnvironment(name, {});
    setSelectedName(name);
    setDraft([]);
    await refetch();
  };

  const updateRow = (i: number, patch: Partial<Row>) => {
    setDraft(draft().map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const removeRow = (i: number) => {
    setDraft(draft().filter((_, idx) => idx !== i));
  };

  return (
    <div
      style={{ display: "flex", height: "100%", "min-height": 0 }}
      data-testid="environments-page"
    >
      <aside
        style={{
          width: "220px",
          "border-right": "1px solid var(--bd-1)",
          display: "flex",
          "flex-direction": "column",
          background: "var(--bg-0)",
          "flex-shrink": 0,
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            "font-size": "10px",
            color: "var(--fg-3)",
            "text-transform": "uppercase",
            "letter-spacing": "0.08em",
            "border-bottom": "1px solid var(--bd-1)",
          }}
        >
          Environments
        </div>
        <div
          style={{ flex: 1, padding: "6px 6px", overflow: "auto" }}
        >
          <Show when={data()}>
            {(d) => (
              <div data-testid="env-list">
              <For
                each={d().environments}
                fallback={
                  <div
                    style={{
                      padding: "14px 10px",
                      "font-size": "12px",
                      color: "var(--fg-3)",
                    }}
                  >
                    No environments yet.
                  </div>
                }
              >
                {(env) => {
                  const active = () => selectedName() === env.name;
                  const isDefault = () => env.name === d().defaultEnvironment;
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedName(env.name);
                        loadDraftFor(env);
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        "align-items": "center",
                        gap: "8px",
                        padding: "7px 10px",
                        "border-radius": "4px",
                        "font-size": "12px",
                        background: active() ? "var(--bg-3)" : "transparent",
                        "border-left": active()
                          ? "2px solid var(--ac)"
                          : "2px solid transparent",
                        "text-align": "left",
                      }}
                      onMouseEnter={(e) => {
                        if (!active())
                          (e.currentTarget as HTMLElement).style.background =
                            "var(--bg-1)";
                      }}
                      onMouseLeave={(e) => {
                        if (!active())
                          (e.currentTarget as HTMLElement).style.background =
                            "transparent";
                      }}
                    >
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          "border-radius": "50%",
                          background: isDefault()
                            ? "var(--ac)"
                            : "var(--fg-3)",
                        }}
                      />
                      <span
                        class="mono"
                        style={{ flex: 1, color: "var(--fg-0)" }}
                      >
                        {env.name}
                      </span>
                      <span
                        class="mono"
                        style={{ "font-size": "10px", color: "var(--fg-3)" }}
                      >
                        {Object.keys(env.values).length}
                      </span>
                    </button>
                  );
                }}
              </For>
              </div>
            )}
          </Show>
          <button
            type="button"
            data-testid="new-env"
            onClick={() => void create()}
            style={{
              width: "100%",
              display: "flex",
              "align-items": "center",
              gap: "8px",
              padding: "7px 10px",
              "margin-top": "6px",
              "font-size": "12px",
              color: "var(--fg-2)",
              border: "1px dashed var(--bd-2)",
              "border-radius": "4px",
            }}
          >
            <IconPlus size={11} /> New environment
          </button>
        </div>
      </aside>

      <section
        style={{
          flex: 1,
          "min-width": 0,
          display: "flex",
          "flex-direction": "column",
        }}
      >
        <Show
          when={selectedName()}
          fallback={
            <div
              style={{
                flex: 1,
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                color: "var(--fg-3)",
                "font-size": "13px",
              }}
            >
              Select or create an environment.
            </div>
          }
        >
          <div
            style={{
              padding: "14px 20px 12px",
              "border-bottom": "1px solid var(--bd-1)",
              display: "flex",
              "align-items": "center",
              gap: "10px",
              "flex-shrink": 0,
            }}
          >
            <div style={{ flex: 1, "min-width": 0 }}>
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "10px",
                  "margin-bottom": "3px",
                }}
              >
                <h2
                  class="mono"
                  style={{
                    "font-size": "16px",
                    "font-weight": 600,
                    margin: 0,
                  }}
                  data-testid="env-heading"
                >
                  {selectedName()}
                </h2>
                <Show when={selectedName() === data()?.defaultEnvironment}>
                  <span
                    class="mono"
                    style={{
                      "font-size": "10px",
                      color: "var(--ac)",
                      background: "var(--ac-bg)",
                      padding: "1px 6px",
                      "border-radius": "2px",
                    }}
                  >
                    default
                  </span>
                </Show>
              </div>
              <div
                class="mono"
                style={{ "font-size": "11px", color: "var(--fg-3)" }}
              >
                environments/{selectedName()}.json · {draft().length}{" "}
                {draft().length === 1 ? "variable" : "variables"}
              </div>
            </div>
            <SegBtn<"table" | "JSON">
              options={["table", "JSON"] as const}
              value={view()}
              onChange={setView}
            />
          </div>

          <Show when={view() === "table"}>
            <div style={{ flex: 1, overflow: "auto" }} data-testid="env-values">
              <div
                style={{
                  display: "grid",
                  "grid-template-columns": "200px 1fr 40px 24px",
                  gap: "10px",
                  padding: "8px 20px",
                  "font-size": "10px",
                  color: "var(--fg-3)",
                  "text-transform": "uppercase",
                  "letter-spacing": "0.08em",
                  "border-bottom": "1px solid var(--bd-1)",
                }}
              >
                <span>Key</span>
                <span>Value</span>
                <span />
                <span />
              </div>
              <For each={draft()}>
                {(row, i) => {
                  return (
                    <div
                      style={{
                        display: "grid",
                        "grid-template-columns": "200px 1fr 40px 24px",
                        gap: "10px",
                        padding: "7px 20px",
                        "align-items": "center",
                        "border-bottom": "1px solid var(--bd-1)",
                        "font-size": "12px",
                      }}
                      class="mono"
                    >
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "5px",
                          "min-width": 0,
                        }}
                      >
                        <input
                          value={row.key}
                          placeholder="KEY"
                          onInput={(e) =>
                            updateRow(i(), { key: e.currentTarget.value })
                          }
                          style={{
                            flex: 1,
                            "font-size": "12px",
                            color: "var(--info)",
                            width: "100%",
                            "min-width": 0,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "6px",
                        }}
                      >
                        <input
                          value={row.value}
                          placeholder="value"
                          type="text"
                          onInput={(e) =>
                            updateRow(i(), { value: e.currentTarget.value })
                          }
                          style={{
                            flex: 1,
                            "font-size": "12px",
                            color:
                              row.value.startsWith("$")
                                ? "var(--m-patch)"
                                : "var(--fg-0)",
                            width: "100%",
                          }}
                        />
                      </div>
                      <span />
                      <button
                        type="button"
                        onClick={() => removeRow(i())}
                        style={{ color: "var(--fg-3)" }}
                        aria-label={`Remove ${row.key || "row"}`}
                      >
                        <IconX size={10} />
                      </button>
                    </div>
                  );
                }}
              </For>
              <button
                type="button"
                data-testid="add-row"
                onClick={() => setDraft([...draft(), { key: "", value: "" }])}
                style={{
                  padding: "10px 20px",
                  "font-size": "12px",
                  color: "var(--fg-3)",
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                }}
              >
                <IconPlus size={11} /> Add variable
              </button>
            </div>
          </Show>

          <Show when={view() === "JSON"}>
            <pre
              class="mono"
              style={{
                margin: 0,
                padding: "16px 22px",
                "font-size": "12px",
                "line-height": 1.7,
                color: "var(--fg-1)",
                flex: 1,
                overflow: "auto",
                background: "var(--bg-0)",
              }}
            >
              <JsonPretty text={jsonFor(draft())} />
            </pre>
          </Show>

          <FooterBar
            onSave={() => void save()}
            onDelete={() => void destroy()}
            status={status()}
            canSave={isDirty()}
          />
        </Show>
      </section>
    </div>
  );
};

function FooterBar(props: {
  onSave: () => void;
  onDelete: () => void;
  status: string | undefined;
  canSave: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        padding: "10px 20px",
        "border-top": "1px solid var(--bd-1)",
        display: "flex",
        "align-items": "center",
        gap: "8px",
        "flex-shrink": 0,
      }}
    >
      <Show when={props.status}>
        <span
          class="mono"
          data-testid="env-status"
          style={{
            "font-size": "11px",
            color: props.status?.startsWith("Saved") ? "var(--ok)" : "var(--err)",
          }}
        >
          {props.status}
        </span>
      </Show>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={props.onDelete}
        style={{
          padding: "6px 12px",
          border: "1px solid var(--bd-2)",
          "border-radius": "4px",
          "font-size": "12px",
          color: "var(--err)",
        }}
      >
        Delete
      </button>
      <button
        type="button"
        data-testid="save-env"
        onClick={props.onSave}
        disabled={!props.canSave}
        style={{
          padding: "6px 14px",
          background: props.canSave ? "var(--ac)" : "var(--bg-3)",
          color: props.canSave ? "#1a1200" : "var(--fg-3)",
          "border-radius": "4px",
          "font-size": "12px",
          "font-weight": 600,
          cursor: props.canSave ? "pointer" : "not-allowed",
        }}
      >
        Save
      </button>
    </div>
  );
}

function jsonFor(rows: Row[]): string {
  const obj: Record<string, string> = {};
  for (const { key, value } of rows) {
    if (!key.trim()) continue;
    obj[key] = value;
  }
  return JSON.stringify(obj, null, 2);
}
