import { For, Show, createResource, createSignal, type Component } from "solid-js";
import { api, type DriftEndpoint, type SpecDrift } from "../api/client";
import {
  IconRefresh,
  MethodBadge,
  Panel,
  type HttpMethod,
} from "../ui";

export const DiffPage: Component = () => {
  const [drift, { refetch }] = createResource(() => api.getSpecDrift());
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<string | undefined>(undefined);

  const regenerate = async () => {
    setBusy(true);
    setStatus(undefined);
    try {
      const res = await api.regenerate();
      setStatus(`Regenerated ${res.operationCount} endpoints.`);
      await refetch();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{ padding: "24px 32px", overflow: "auto", height: "100%" }}
      data-testid="diff-page"
    >
      <div
        style={{
          display: "flex",
          "align-items": "baseline",
          gap: "12px",
          "margin-bottom": "4px",
        }}
      >
        <h1
          style={{
            "font-size": "22px",
            "font-weight": 600,
            margin: 0,
            "letter-spacing": "-0.01em",
          }}
        >
          Spec drift
        </h1>
        <span
          class="mono"
          style={{ color: "var(--fg-3)", "font-size": "12px" }}
        >
          openapi spec ↔ generated/endpoints.ts
        </span>
      </div>
      <div
        style={{
          "font-size": "13px",
          color: "var(--fg-2)",
          "margin-bottom": "24px",
          display: "flex",
          "align-items": "center",
          gap: "12px",
        }}
      >
        <Show
          when={drift()}
          fallback={<span>Loading…</span>}
        >
          {(d) => (
            <>
              <Show
                when={d().count > 0}
                fallback={<span>In sync. No drift detected.</span>}
              >
                <span>
                  {d().count} {d().count === 1 ? "endpoint" : "endpoints"} drifted —{" "}
                  {d().added.length} added, {d().removed.length} removed.
                </span>
              </Show>
              <button
                type="button"
                onClick={() => void regenerate()}
                disabled={busy()}
                data-testid="regenerate"
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                  padding: "5px 12px",
                  background: "var(--ac)",
                  color: "#1a1200",
                  "border-radius": "4px",
                  "font-size": "12px",
                  "font-weight": 600,
                  opacity: busy() ? 0.6 : 1,
                  cursor: busy() ? "wait" : "pointer",
                }}
              >
                <IconRefresh size={11} />{" "}
                {busy() ? "Regenerating…" : "Run journey generate"}
              </button>
              <Show when={status()}>
                <span
                  class="mono"
                  style={{
                    "font-size": "11px",
                    color: status()?.startsWith("Regenerated")
                      ? "var(--ok)"
                      : "var(--err)",
                  }}
                >
                  {status()}
                </span>
              </Show>
            </>
          )}
        </Show>
      </div>

      <Show when={drift()}>
        {(d) => (
          <>
            <Show when={!d().hasSpec}>
              <Panel title="No spec loaded">
                <div
                  style={{
                    padding: "14px 16px",
                    "font-size": "12px",
                    color: "var(--fg-3)",
                  }}
                >
                  The OpenAPI spec referenced in journey.config.json couldn't
                  be loaded. Fix the <span class="mono">spec</span> path, then
                  come back.
                </div>
              </Panel>
            </Show>
            <Show when={d().hasSpec && !d().hasGenerated}>
              <Panel title="Nothing generated yet">
                <div
                  style={{
                    padding: "14px 16px",
                    "font-size": "12px",
                    color: "var(--fg-3)",
                  }}
                >
                  <span class="mono">generated/endpoints.ts</span> doesn't
                  exist. Click <span style={{ color: "var(--ac)" }}>Run journey generate</span>{" "}
                  to create it.
                </div>
              </Panel>
            </Show>
            <Show when={d().count > 0}>
              <div
                style={{
                  display: "grid",
                  "grid-template-columns": "1fr 1fr",
                  gap: "20px",
                }}
              >
                <Panel
                  title="Added in spec"
                  badge={d().added.length > 0 ? d().added.length : undefined}
                >
                  <DriftList endpoints={d().added} accent="ok" />
                </Panel>
                <Panel
                  title="Removed from spec"
                  badge={d().removed.length > 0 ? d().removed.length : undefined}
                >
                  <DriftList endpoints={d().removed} accent="err" />
                </Panel>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};

function DriftList(props: {
  endpoints: DriftEndpoint[];
  accent: "ok" | "err";
}): ReturnType<Component> {
  const color = props.accent === "ok" ? "var(--ok)" : "var(--err)";
  return (
    <Show
      when={props.endpoints.length > 0}
      fallback={
        <div
          style={{
            padding: "14px 16px",
            "font-size": "12px",
            color: "var(--fg-3)",
          }}
        >
          None.
        </div>
      }
    >
      <div>
        <For each={props.endpoints}>
          {(e, i) => (
            <div
              data-testid={`drift-row-${e.method}-${e.path}`}
              style={{
                display: "grid",
                "grid-template-columns": "16px 50px 1fr auto",
                "align-items": "center",
                gap: "10px",
                padding: "8px 14px",
                "border-top": i() === 0 ? "none" : "1px solid var(--bd-1)",
                "font-size": "12px",
              }}
            >
              <span
                style={{
                  color,
                  "font-weight": 600,
                  "text-align": "center",
                }}
              >
                {props.accent === "ok" ? "+" : "−"}
              </span>
              <MethodBadge method={e.method as HttpMethod} />
              <span
                class="mono"
                style={{
                  color: "var(--fg-1)",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                }}
              >
                {e.path}
              </span>
              <span
                class="mono"
                style={{ "font-size": "11px", color: "var(--fg-3)" }}
              >
                {e.operationId}
              </span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

// Re-export for Overview to show a compact summary.
export function useSpecDrift(): () => SpecDrift | undefined {
  const [drift] = createResource(() => api.getSpecDrift());
  return drift;
}
