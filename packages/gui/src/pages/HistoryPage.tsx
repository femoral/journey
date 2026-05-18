import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  type Component,
  type JSX,
} from "solid-js";
import {
  api,
  type JourneyResult,
  type RunDetail,
  type RunSummary,
  type StepResult,
} from "../api/client";
import { JsonDiff } from "../components/JsonDiff";
import {
  IconDiff,
  IconSearch,
  IconX,
  JsonPretty,
  Panel,
  RunDot,
  StatusPill,
  type RunState,
} from "../ui";

export const HistoryPage: Component = () => {
  const [runs] = createResource(api.listRuns);
  const [filter, setFilter] = createSignal("");
  const [selectedId, setSelectedId] = createSignal<string | undefined>(undefined);
  const [compareId, setCompareId] = createSignal<string | undefined>(undefined);
  const [pickingCompare, setPickingCompare] = createSignal(false);

  // `mutate` is pulled so we can explicitly clear the resource when the source
  // flips back to undefined — Solid keeps the previously-resolved value
  // otherwise, and the Close-diff / unpick-run buttons want a clean slate.
  const [selectedDetail, { mutate: mutateSelectedDetail }] = createResource(selectedId, (id) =>
    api.getRun(id),
  );
  const [compareDetail, { mutate: mutateCompareDetail }] = createResource(compareId, (id) =>
    api.getRun(id),
  );

  const filtered = createMemo(() => {
    const q = filter().toLowerCase();
    const list = runs() ?? [];
    if (!q) return list;
    return list.filter((r) => r.journeyNames.some((n) => n.toLowerCase().includes(q)));
  });

  const stats = createMemo(() => {
    const list = runs() ?? [];
    if (list.length === 0) {
      return { total: 0, passRate: 0, avgMs: 0, passCount: 0, failCount: 0 };
    }
    const passCount = list.filter((r) => r.ok).length;
    const totalMs = list.reduce((a, r) => a + r.durationMs, 0);
    return {
      total: list.length,
      passCount,
      failCount: list.length - passCount,
      passRate: list.length ? passCount / list.length : 0,
      avgMs: list.length ? Math.round(totalMs / list.length) : 0,
    };
  });

  const pickRun = (r: RunSummary) => {
    if (pickingCompare() && r.id !== selectedId()) {
      setCompareId(r.id);
      setPickingCompare(false);
      return;
    }
    // Swapping the selected run mustn't flash the previous detail — drop it
    // so the pane shows a loader (or blank) until the new fetch resolves.
    if (r.id !== selectedId()) mutateSelectedDetail(undefined);
    setSelectedId(r.id);
    setCompareId(undefined);
    mutateCompareDetail(undefined);
    setPickingCompare(false);
  };

  return (
    <div style={{ display: "flex", height: "100%", "min-height": 0 }} data-testid="history-page">
      <aside
        style={{
          width: "360px",
          "border-right": "1px solid var(--bd-1)",
          display: "flex",
          "flex-direction": "column",
          background: "var(--bg-0)",
          "flex-shrink": 0,
        }}
      >
        <div
          style={{
            padding: "14px 16px 10px",
            "border-bottom": "1px solid var(--bd-1)",
            display: "flex",
            "flex-direction": "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", "align-items": "baseline", gap: "8px" }}>
            <h1 style={{ "font-size": "18px", "font-weight": 600, margin: 0 }}>Run history</h1>
            <span
              class="mono"
              style={{ "font-size": "11px", color: "var(--fg-3)" }}
              data-testid="history-count"
            >
              {stats().total} runs
            </span>
          </div>
          <div
            style={{
              display: "grid",
              "grid-template-columns": "1fr 1fr 1fr",
              gap: "12px",
              "font-size": "11px",
              color: "var(--fg-2)",
            }}
          >
            <Stat label="Pass rate" value={`${Math.round(stats().passRate * 100)}%`} />
            <Stat label="Avg duration" value={`${stats().avgMs}ms`} />
            <Stat
              label="Pass / fail"
              value={`${stats().passCount} / ${stats().failCount}`}
              valueColor={stats().failCount > 0 ? "var(--err)" : "var(--fg-0)"}
            />
          </div>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "6px",
              background: "var(--bg-2)",
              border: "1px solid var(--bd-1)",
              "border-radius": "4px",
              padding: "5px 8px",
            }}
          >
            <IconSearch size={12} style={{ color: "var(--fg-3)" }} />
            <input
              value={filter()}
              onInput={(e) => setFilter(e.currentTarget.value)}
              placeholder="filter by journey…"
              class="mono"
              style={{ flex: 1, "font-size": "12px" }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto" }} data-testid="history-list">
          <Show
            when={filtered().length > 0}
            fallback={
              <div
                style={{
                  padding: "16px",
                  "font-size": "12px",
                  color: "var(--fg-3)",
                  "text-align": "center",
                }}
              >
                No runs yet.
              </div>
            }
          >
            <For each={filtered()}>
              {(r) => {
                const isSelected = () => selectedId() === r.id;
                const isCompare = () => compareId() === r.id;
                return (
                  <button
                    type="button"
                    onClick={() => pickRun(r)}
                    data-testid={`history-row-${r.id}`}
                    style={{
                      width: "100%",
                      display: "grid",
                      "grid-template-columns": "14px minmax(0, 1fr) auto",
                      "align-items": "center",
                      gap: "10px",
                      padding: "10px 16px",
                      "text-align": "left",
                      background: isSelected()
                        ? "var(--bg-3)"
                        : isCompare()
                          ? "var(--info-bg)"
                          : "transparent",
                      "border-left": isSelected()
                        ? "2px solid var(--ac)"
                        : isCompare()
                          ? "2px solid var(--info)"
                          : "2px solid transparent",
                      "border-bottom": "1px solid var(--bd-1)",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected() && !isCompare())
                        (e.currentTarget as HTMLElement).style.background = "var(--bg-1)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected() && !isCompare())
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    <RunDot state={r.ok ? "pass" : "fail"} />
                    <div style={{ "min-width": 0 }}>
                      <div
                        class="mono"
                        style={{
                          "font-size": "12px",
                          color: "var(--fg-0)",
                          overflow: "hidden",
                          "text-overflow": "ellipsis",
                          "white-space": "nowrap",
                        }}
                      >
                        {r.journeyNames.join(", ") || "—"}
                      </div>
                      <div
                        class="mono"
                        style={{
                          "font-size": "10px",
                          color: "var(--fg-3)",
                          "margin-top": "2px",
                        }}
                      >
                        {formatRelative(r.timestamp)} · {r.stepCount} steps · {r.durationMs}ms
                      </div>
                    </div>
                    <Show when={isCompare()}>
                      <span class="mono" style={{ "font-size": "10px", color: "var(--info)" }}>
                        B
                      </span>
                    </Show>
                    <Show when={isSelected()}>
                      <span class="mono" style={{ "font-size": "10px", color: "var(--ac)" }}>
                        A
                      </span>
                    </Show>
                  </button>
                );
              }}
            </For>
          </Show>
        </div>
      </aside>

      <section
        style={{
          flex: 1,
          "min-width": 0,
          display: "flex",
          "flex-direction": "column",
          overflow: "auto",
        }}
      >
        <Show
          when={selectedDetail()}
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
              Pick a run on the left.
            </div>
          }
        >
          {(a) => (
            <div
              style={{
                padding: "16px 20px",
                display: "flex",
                "flex-direction": "column",
                gap: "16px",
              }}
            >
              <DetailHeader
                detail={a()}
                label="A"
                compareDetail={compareDetail()}
                pickingCompare={pickingCompare()}
                onStartCompare={() => setPickingCompare(true)}
                onCancelCompare={() => {
                  setCompareId(undefined);
                  mutateCompareDetail(undefined);
                  setPickingCompare(false);
                }}
              />
              <Show when={compareDetail()} fallback={<RunResults results={a().results} />}>
                {(b) => <DiffPane a={a()} b={b()} />}
              </Show>
            </div>
          )}
        </Show>
      </section>
    </div>
  );
};

function Stat(props: { label: string; value: string; valueColor?: string }): JSX.Element {
  return (
    <div>
      <div
        style={{
          "font-size": "10px",
          color: "var(--fg-3)",
          "text-transform": "uppercase",
          "letter-spacing": "0.06em",
        }}
      >
        {props.label}
      </div>
      <div
        class="mono"
        style={{
          "font-size": "14px",
          color: props.valueColor ?? "var(--fg-0)",
          "margin-top": "2px",
        }}
      >
        {props.value}
      </div>
    </div>
  );
}

function DetailHeader(props: {
  detail: RunDetail;
  label: string;
  compareDetail: RunDetail | undefined;
  pickingCompare: boolean;
  onStartCompare: () => void;
  onCancelCompare: () => void;
}): JSX.Element {
  const ok = () => props.detail.results.every((r) => r.ok);
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "12px",
        "flex-wrap": "wrap",
      }}
    >
      <RunDot state={ok() ? "pass" : "fail"} size={10} />
      <h2
        class="mono"
        style={{
          "font-size": "15px",
          "font-weight": 600,
          margin: 0,
          color: "var(--fg-0)",
        }}
      >
        {props.detail.results.map((r) => r.name).join(", ") || props.detail.id}
      </h2>
      <span class="mono" style={{ "font-size": "11px", color: "var(--fg-3)" }}>
        {formatRelative(props.detail.timestamp)} ·{" "}
        {props.detail.results.reduce((a, r) => a + (r.durationMs ?? 0), 0)}
        ms
      </span>
      <div style={{ flex: 1 }} />
      <Show
        when={props.compareDetail}
        fallback={
          <button
            type="button"
            onClick={props.onStartCompare}
            data-testid="compare-start"
            style={{
              display: "flex",
              "align-items": "center",
              gap: "6px",
              padding: "5px 10px",
              border: props.pickingCompare ? "1px solid var(--ac-bd)" : "1px solid var(--bd-2)",
              "border-radius": "4px",
              "font-size": "11px",
              color: props.pickingCompare ? "var(--ac)" : "var(--fg-1)",
              background: props.pickingCompare ? "var(--ac-bg)" : "transparent",
            }}
          >
            <IconDiff size={11} />
            {props.pickingCompare ? "Pick a run to compare…" : "Compare"}
          </button>
        }
      >
        <button
          type="button"
          onClick={props.onCancelCompare}
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            padding: "5px 10px",
            border: "1px solid var(--bd-2)",
            "border-radius": "4px",
            "font-size": "11px",
            color: "var(--fg-1)",
          }}
        >
          <IconX size={11} /> Close diff
        </button>
      </Show>
    </div>
  );
}

function RunResults(props: { results: JourneyResult[] }): JSX.Element {
  return (
    <Panel title="Steps">
      <For each={props.results}>
        {(r) => (
          <div>
            <div
              style={{
                padding: "8px 14px",
                "border-bottom": "1px solid var(--bd-1)",
                "font-size": "12px",
                color: "var(--fg-2)",
              }}
            >
              <span class="mono" style={{ color: "var(--fg-0)" }}>
                {r.name}
              </span>
            </div>
            <For each={r.steps}>{(s) => <StepRow step={s} />}</For>
          </div>
        )}
      </For>
    </Panel>
  );
}

function StepRow(props: { step: StepResult }): JSX.Element {
  const state = (): RunState => (props.step.ok ? "pass" : "fail");
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "16px minmax(0, 1fr) auto auto",
        "align-items": "center",
        gap: "10px",
        padding: "6px 14px",
        "border-bottom": "1px solid var(--bd-1)",
        "font-size": "12px",
      }}
    >
      <RunDot state={state()} size={6} />
      <div style={{ "min-width": 0 }}>
        <span
          style={{
            color: "var(--fg-0)",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {props.step.name}
        </span>
        <Show when={props.step.request}>
          {(req) => (
            <span
              class="mono"
              style={{
                "font-size": "10px",
                color: "var(--fg-3)",
                "margin-left": "8px",
              }}
            >
              {req().method} {req().url}
            </span>
          )}
        </Show>
      </div>
      <Show when={props.step.response}>{(res) => <StatusPill status={res().status} />}</Show>
      <span class="mono" style={{ "font-size": "11px", color: "var(--fg-2)" }}>
        {props.step.durationMs}ms
      </span>
      <Show when={props.step.error}>
        <div
          class="mono"
          style={{
            "grid-column": "2 / -1",
            "font-size": "11px",
            color: "var(--err)",
            "white-space": "pre-wrap",
          }}
        >
          {props.step.error}
        </div>
      </Show>
    </div>
  );
}

function DiffPane(props: { a: RunDetail; b: RunDetail }): JSX.Element {
  const stepsA = () => props.a.results[0]?.steps ?? [];
  const stepsB = () => props.b.results[0]?.steps ?? [];
  const [stepIdx, setStepIdx] = createSignal(0);
  return (
    <Panel
      title={`A: ${formatRelative(props.a.timestamp)} ↔ B: ${formatRelative(props.b.timestamp)}`}
    >
      <Show when={stepsA().length > 0 && stepsB().length > 0}>
        <div
          style={{
            display: "flex",
            "flex-wrap": "wrap",
            gap: "6px",
            padding: "10px 14px",
            "border-bottom": "1px solid var(--bd-1)",
          }}
        >
          <For each={stepsA()}>
            {(s, i) => (
              <button
                type="button"
                onClick={() => setStepIdx(i())}
                class="mono"
                style={{
                  padding: "3px 10px",
                  "font-size": "11px",
                  "border-radius": "3px",
                  background: stepIdx() === i() ? "var(--ac-bg)" : "var(--bg-2)",
                  color: stepIdx() === i() ? "var(--ac)" : "var(--fg-2)",
                  border: stepIdx() === i() ? "1px solid var(--ac-bd)" : "1px solid transparent",
                }}
              >
                {s.name}
              </button>
            )}
          </For>
        </div>
        <div style={{ padding: "12px 14px" }}>
          <JsonDiff
            left={stepsA()[stepIdx()]?.response?.body}
            right={stepsB()[stepIdx()]?.response?.body}
            leftLabel={`A: ${formatRelative(props.a.timestamp)}`}
            rightLabel={`B: ${formatRelative(props.b.timestamp)}`}
          />
        </div>
      </Show>
    </Panel>
  );
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 0) return "now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

// Unused but keeps the JsonPretty import live if/when the detail pane adopts
// a "raw JSON" view — TODO wire this into a toggle in M5c.
export const __internal = { JsonPretty };
