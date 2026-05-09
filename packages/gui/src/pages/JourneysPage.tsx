import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  type Component,
  type JSX,
} from "solid-js";
import { api, type JourneyResult, type RunSummary, type StepResult } from "../api/client";
import { runEvents } from "../api/runEvents";
import { useNavigate } from "@solidjs/router";
import { useConsole } from "../shell/consoleContext";
import { useEnvSelection } from "../shell/envContext";
import {
  IconCheck,
  IconChevron,
  IconClock,
  IconCopy,
  IconEditor,
  IconEndpoints,
  IconPlay,
  IconPlus,
  IconSearch,
  IconStop,
  IconX,
  JsonPretty,
  MethodBadge,
  MiniTab,
  RunDot,
  StatusPill,
  type HttpMethod,
  type RunState,
} from "../ui";

type UiRunState = "idle" | "running" | "done";

export const JourneysPage: Component = () => {
  const cons = useConsole();
  const envSel = useEnvSelection();
  const navigate = useNavigate();
  const [list, { refetch: refetchList }] = createResource(api.getJourneys);
  const [selected, setSelected] = createSignal<string | undefined>(undefined);
  const [results, setResults] = createSignal<JourneyResult[] | undefined>(undefined);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [runState, setRunState] = createSignal<UiRunState>("idle");
  const [filter, setFilter] = createSignal("");

  // /api/runs is loaded solely to annotate the left-side journey list with a
  // relative "last run" timestamp; comparison + full history live on /history.
  const [runs, { refetch: refetchRuns }] = createResource(api.listRuns);

  // Active SSE subscription — aborted on unmount or on a fresh run kickoff.
  let activeSub: { close: () => void } | undefined;
  onCleanup(() => activeSub?.close());

  const filteredFiles = createMemo(() => {
    const q = filter().toLowerCase();
    const files = list()?.files ?? [];
    return q ? files.filter((f) => f.toLowerCase().includes(q)) : files;
  });

  const pickJourney = (file: string) => {
    setSelected(file);
    setResults(undefined);
    setError(undefined);
    setRunState("idle");
  };

  const run = async (opts: { upToStepIdx?: number } = {}) => {
    const file = selected();
    if (!file) return;
    setRunState("running");
    setError(undefined);
    setResults(undefined);
    activeSub?.close();

    // Local scratch updated from SSE events; copied to the results signal on
    // every mutation so the step timeline rerenders as steps complete.
    const liveSteps: StepResult[] = [];
    let journeyName = file.replace(/\.journey\.ts$/, "");
    const publish = (ok: boolean, durationMs: number) => {
      setResults([
        {
          name: journeyName,
          ok,
          steps: liveSteps.map((s) => ({ ...s })),
          durationMs,
        },
      ]);
    };

    try {
      const env = envSel?.selectedEnv();
      const { runId } = await api.startJourneyRun(file, {
        ...opts,
        ...(env !== undefined ? { env } : {}),
      });
      activeSub = runEvents.subscribe(runId, (event) => {
        cons.ingest(event);
        switch (event.kind) {
          case "step:start":
            journeyName = event.journeyName;
            liveSteps.push({ name: event.name, ok: false, durationMs: 0 });
            publish(false, 0);
            break;
          case "request": {
            const s = liveSteps[event.stepIdx];
            if (s) s.request = { method: event.method, url: event.url };
            publish(false, 0);
            break;
          }
          case "response": {
            const s = liveSteps[event.stepIdx];
            if (s)
              s.response = {
                status: event.status,
                headers: event.headers,
                body: event.body,
              };
            publish(false, 0);
            break;
          }
          case "step:end": {
            const s = liveSteps[event.stepIdx];
            if (s) {
              s.ok = event.ok;
              s.durationMs = event.durationMs;
              if (event.error !== undefined) s.error = event.error;
            }
            publish(false, 0);
            break;
          }
          case "run:end":
            publish(event.ok, event.durationMs);
            setRunState("done");
            activeSub?.close();
            activeSub = undefined;
            void refetchRuns();
            void refetchList();
            break;
          case "error":
            setError(event.message);
            break;
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunState("idle");
    }
  };

  return (
    <div style={{ display: "flex", height: "100%", "min-height": 0 }} data-testid="journeys-page">
      <aside
        style={{
          width: "300px",
          "border-right": "1px solid var(--bd-1)",
          display: "flex",
          "flex-direction": "column",
          background: "var(--bg-0)",
          "flex-shrink": 0,
        }}
      >
        <div
          style={{
            padding: "10px 10px 8px",
            display: "flex",
            gap: "6px",
            "border-bottom": "1px solid var(--bd-1)",
          }}
        >
          <div
            style={{
              flex: 1,
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
              placeholder="filter…"
              style={{ flex: 1, "font-size": "12px" }}
            />
          </div>
          <button
            title="New journey (M6)"
            disabled
            style={{
              padding: "0 8px",
              border: "1px solid var(--bd-2)",
              "border-radius": "4px",
              color: "var(--fg-2)",
              opacity: 0.5,
              cursor: "not-allowed",
            }}
          >
            <IconPlus size={12} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }} data-testid="journey-list">
          <Show
            when={filteredFiles().length > 0}
            fallback={
              <div
                style={{
                  padding: "14px",
                  "font-size": "12px",
                  color: "var(--fg-3)",
                }}
              >
                No journeys found.
              </div>
            }
          >
            <For each={filteredFiles()}>
              {(file) => (
                <JourneyRow
                  file={file}
                  lastRun={(runs() ?? []).find((r) => r.journeyNames.includes(file))}
                  active={selected() === file}
                  onClick={() => pickJourney(file)}
                />
              )}
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
          overflow: "hidden",
        }}
      >
        <Show
          when={selected()}
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
              Select a journey on the left.
            </div>
          }
        >
          {(file) => (
            <>
              <JourneyHeader
                file={file()}
                steps={results()?.[0]?.steps.length ?? 0}
                runState={runState()}
                onRun={() => void run()}
                onViewHistory={() => navigate("/history")}
              />

              <Show when={error()}>
                <div
                  data-testid="run-error"
                  style={{
                    padding: "10px 20px",
                    "font-size": "12px",
                    color: "var(--err)",
                    "border-bottom": "1px solid var(--bd-1)",
                    background: "var(--err-bg)",
                  }}
                >
                  {error()}
                </div>
              </Show>

              <div style={{ flex: 1, overflow: "auto" }}>
                <StepTimeline
                  runState={runState()}
                  results={results()}
                  onRunOnly={(stepIdx) => void run({ upToStepIdx: stepIdx })}
                  onSendViaEndpoints={(step) => {
                    if (!step.request) return;
                    navigate(
                      `/endpoints?method=${encodeURIComponent(step.request.method)}&url=${encodeURIComponent(step.request.url)}`,
                    );
                  }}
                />
              </div>
            </>
          )}
        </Show>
      </section>
    </div>
  );
};

function JourneyRow(props: {
  file: string;
  lastRun: RunSummary | undefined;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const name = () => props.file.replace(/\.journey\.ts$/, "");
  const state = (): RunState => {
    if (!props.lastRun) return "idle";
    return props.lastRun.ok ? "pass" : "fail";
  };
  return (
    <button
      onClick={props.onClick}
      style={{
        width: "100%",
        display: "flex",
        "flex-direction": "column",
        gap: "4px",
        padding: "10px 14px",
        "text-align": "left",
        background: props.active ? "var(--bg-3)" : "transparent",
        "border-left": props.active ? "2px solid var(--ac)" : "2px solid transparent",
        "border-bottom": "1px solid var(--bd-1)",
      }}
      onMouseEnter={(e) => {
        if (!props.active) (e.currentTarget as HTMLElement).style.background = "var(--bg-1)";
      }}
      onMouseLeave={(e) => {
        if (!props.active) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          width: "100%",
        }}
      >
        <RunDot state={state()} />
        <span
          class="mono"
          style={{
            flex: 1,
            "font-size": "13px",
            color: "var(--fg-0)",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {name()}
        </span>
        <span class="mono" style={{ "font-size": "10px", color: "var(--fg-3)" }}>
          {props.lastRun ? formatRelative(props.lastRun.timestamp) : "—"}
        </span>
      </div>
      <div
        class="mono"
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "font-size": "10px",
          color: "var(--fg-3)",
        }}
      >
        <span>{props.file}</span>
      </div>
    </button>
  );
}

function JourneyHeader(props: {
  file: string;
  steps: number;
  runState: UiRunState;
  onRun: () => void;
  onViewHistory: () => void;
}): JSX.Element {
  const name = () => props.file.replace(/\.journey\.ts$/, "");
  return (
    <div
      style={{
        padding: "14px 20px 12px",
        "border-bottom": "1px solid var(--bd-1)",
        "flex-shrink": 0,
      }}
    >
      <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
        <div style={{ flex: 1, "min-width": 0 }}>
          <h2
            class="mono"
            style={{
              "font-size": "16px",
              "font-weight": 600,
              margin: "0 0 3px",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {name()}
          </h2>
          <div
            class="mono"
            style={{
              "font-size": "11px",
              color: "var(--fg-3)",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {props.file}
            <Show when={props.steps > 0}>
              {" · "}
              {props.steps} {props.steps === 1 ? "step" : "steps"}
            </Show>
          </div>
        </div>
        <button
          type="button"
          onClick={props.onViewHistory}
          title="Open the run history page"
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            padding: "6px 10px",
            border: "1px solid var(--bd-2)",
            "border-radius": "4px",
            "font-size": "12px",
            color: "var(--fg-1)",
          }}
        >
          <IconClock size={12} /> History
        </button>
        <button
          title="Open in editor (M6)"
          disabled
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            padding: "6px 10px",
            border: "1px solid var(--bd-2)",
            "border-radius": "4px",
            "font-size": "12px",
            color: "var(--fg-2)",
            opacity: 0.5,
            cursor: "not-allowed",
          }}
        >
          <IconEditor size={12} />
        </button>
        <button
          type="button"
          data-testid="run-button"
          onClick={props.onRun}
          disabled={props.runState === "running"}
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            padding: "7px 16px",
            background: props.runState === "running" ? "var(--bg-2)" : "var(--ac)",
            color: props.runState === "running" ? "var(--fg-0)" : "#1a1200",
            "border-radius": "5px",
            "font-weight": 600,
            "font-size": "12px",
            border: props.runState === "running" ? "1px solid var(--bd-2)" : "none",
          }}
        >
          <Show
            when={props.runState === "running"}
            fallback={
              <>
                <IconPlay size={10} /> Run journey
              </>
            }
          >
            <IconStop size={10} /> Running…
          </Show>
        </button>
      </div>
    </div>
  );
}

function StepTimeline(props: {
  runState: UiRunState;
  results: JourneyResult[] | undefined;
  onRunOnly: (stepIdx: number) => void;
  onSendViaEndpoints: (step: StepResult) => void;
}): JSX.Element {
  const allSteps = createMemo<StepResult[]>(() => {
    const rs = props.results ?? [];
    return rs.flatMap((r) => r.steps);
  });

  return (
    <div
      style={{
        padding: "14px 20px",
        "border-right": "1px solid var(--bd-1)",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "10px",
          "margin-bottom": "12px",
          "font-size": "11px",
          color: "var(--fg-2)",
        }}
      >
        <span
          class="mono"
          style={{
            "text-transform": "uppercase",
            "letter-spacing": "0.06em",
            color: "var(--fg-3)",
          }}
        >
          Current run
        </span>
        <Show when={props.runState === "done" && allSteps().length > 0}>
          <span class="mono">{allSteps().reduce((a, s) => a + s.durationMs, 0)}ms</span>
        </Show>
        <Show when={props.runState === "running"}>
          <span class="mono" style={{ color: "var(--ac)" }}>
            running…
          </span>
        </Show>
        <span style={{ flex: 1 }} />
        <IconClock size={11} />
      </div>

      <Show
        when={allSteps().length > 0}
        fallback={
          <div
            style={{
              padding: "32px 12px",
              "font-size": "12px",
              color: "var(--fg-3)",
              "text-align": "center",
            }}
            data-testid="empty-run"
          >
            Hit <span class="mono">Run journey</span> to see steps stream in.
          </div>
        }
      >
        <div style={{ position: "relative" }} data-testid="run-results">
          <div
            style={{
              position: "absolute",
              left: "11px",
              top: "14px",
              bottom: "14px",
              width: "1px",
              background: "var(--bd-2)",
            }}
          />
          <For each={allSteps()}>
            {(step, i) => (
              <StepCard
                step={step}
                index={i()}
                defaultExpanded={!step.ok}
                onRunOnly={() => props.onRunOnly(i())}
                onSendViaEndpoints={() => props.onSendViaEndpoints(step)}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function StepCard(props: {
  step: StepResult;
  index: number;
  defaultExpanded: boolean;
  onRunOnly: () => void;
  onSendViaEndpoints: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded);
  const state = (): RunState => (props.step.ok ? "pass" : "fail");
  return (
    <div
      style={{
        display: "flex",
        gap: "10px",
        "margin-bottom": "8px",
        position: "relative",
      }}
      data-testid={`step-card-${props.index}`}
    >
      <div style={{ "padding-top": "4px", "z-index": 1 }}>
        <StepIcon state={state()} index={props.index} />
      </div>
      <div
        style={{
          flex: 1,
          border: "1px solid var(--bd-1)",
          "border-radius": "5px",
          background: "var(--bg-1)",
          overflow: "hidden",
          "min-width": 0,
        }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded()}
          style={{
            width: "100%",
            display: "flex",
            "align-items": "center",
            gap: "10px",
            padding: "8px 12px",
            "text-align": "left",
          }}
        >
          <Show when={props.step.request}>
            {(req) => <MethodBadge method={req().method as HttpMethod} />}
          </Show>
          <div
            style={{
              flex: 1,
              "min-width": 0,
              display: "flex",
              "flex-direction": "column",
              "align-items": "flex-start",
            }}
          >
            <span
              style={{
                "font-size": "12px",
                color: "var(--fg-0)",
                "font-weight": 500,
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
                "max-width": "100%",
              }}
            >
              {props.step.name}
            </span>
            <Show when={props.step.request?.url}>
              {(url) => (
                <span
                  class="mono"
                  style={{
                    "font-size": "10px",
                    color: "var(--fg-3)",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    "max-width": "100%",
                  }}
                >
                  {url()}
                </span>
              )}
            </Show>
          </div>
          <Show when={props.step.response}>{(res) => <StatusPill status={res().status} />}</Show>
          <span
            class="mono"
            style={{
              "font-size": "11px",
              color: "var(--fg-2)",
              width: "50px",
              "text-align": "right",
            }}
          >
            {props.step.durationMs}ms
          </span>
          <IconChevron
            size={11}
            style={{
              color: "var(--fg-3)",
              transform: expanded() ? "rotate(90deg)" : "none",
              transition: "transform 0.15s",
            }}
          />
        </button>
        <Show when={expanded()}>
          <StepDetail
            step={props.step}
            onRunOnly={props.onRunOnly}
            onSendViaEndpoints={props.onSendViaEndpoints}
          />
        </Show>
      </div>
    </div>
  );
}

function StepIcon(props: { state: RunState; index: number }): JSX.Element {
  const base = {
    width: "22px",
    height: "22px",
    "border-radius": "50%",
    background: "var(--bg-0)",
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
  } as const;
  if (props.state === "pass") {
    return (
      <div
        style={{
          ...base,
          border: "1.5px solid var(--ok)",
          color: "var(--ok)",
        }}
      >
        <IconCheck size={11} />
      </div>
    );
  }
  if (props.state === "fail") {
    return (
      <div
        style={{
          ...base,
          border: "1.5px solid var(--err)",
          color: "var(--err)",
        }}
      >
        <IconX size={11} />
      </div>
    );
  }
  if (props.state === "running") {
    return (
      <div
        style={{
          ...base,
          border: "1.5px solid var(--ac)",
          "box-shadow": "0 0 0 3px var(--ac-bg)",
        }}
      >
        <RunDot state="running" size={6} />
      </div>
    );
  }
  return (
    <div
      class="mono"
      style={{
        ...base,
        border: "1.5px solid var(--bd-2)",
        color: "var(--fg-3)",
        "font-size": "10px",
      }}
    >
      {props.index + 1}
    </div>
  );
}

type DetailTab = "request" | "response" | "logs";

function StepDetail(props: {
  step: StepResult;
  onRunOnly: () => void;
  onSendViaEndpoints: () => void;
}): JSX.Element {
  const [tab, setTab] = createSignal<DetailTab>(props.step.ok ? "response" : "response");
  const reqBodyPresent = createMemo(
    () => false, // StepResult.request only exposes method/url today
  );
  const reqText = () => {
    if (!props.step.request) return "";
    return `${props.step.request.method} ${props.step.request.url}`;
  };
  const resText = () => {
    const r = props.step.response;
    if (!r) return "";
    try {
      return JSON.stringify(r.body, null, 2);
    } catch {
      return String(r.body);
    }
  };
  return (
    <div
      style={{
        "border-top": "1px solid var(--bd-1)",
        background: "var(--bg-0)",
      }}
    >
      <div
        style={{
          padding: "2px 12px 0",
          display: "flex",
          "align-items": "center",
          "border-bottom": "1px solid var(--bd-1)",
        }}
        role="tablist"
      >
        <MiniTab label="Request" active={tab() === "request"} onClick={() => setTab("request")} />
        <MiniTab
          label="Response"
          active={tab() === "response"}
          onClick={() => setTab("response")}
        />
        <Show when={props.step.error}>
          <MiniTab label="Error" active={tab() === "logs"} onClick={() => setTab("logs")} />
        </Show>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          data-testid={`step-copy-curl-${props.step.name}`}
          onClick={() => {
            if (!props.step.request) return;
            const text = `curl -X ${props.step.request.method} '${props.step.request.url}'`;
            void navigator.clipboard.writeText(text).catch(() => {});
          }}
          title="Copy as cURL (method + URL only; full curl on Console rows)"
          style={{
            padding: "4px 8px",
            "font-size": "11px",
            color: "var(--fg-2)",
            display: "flex",
            "align-items": "center",
            gap: "4px",
          }}
        >
          <IconCopy size={10} /> curl
        </button>
        <button
          type="button"
          data-testid={`step-run-only-${props.step.name}`}
          onClick={props.onRunOnly}
          title="Rerun the journey up to and including this step"
          style={{
            padding: "4px 8px",
            "font-size": "11px",
            color: "var(--ac)",
            display: "flex",
            "align-items": "center",
            gap: "4px",
          }}
        >
          <IconPlay size={10} /> Run only
        </button>
        <button
          type="button"
          data-testid={`step-send-endpoints-${props.step.name}`}
          onClick={props.onSendViaEndpoints}
          disabled={!props.step.request}
          title="Open this request in the Endpoints page"
          style={{
            padding: "4px 8px",
            "font-size": "11px",
            color: "var(--fg-2)",
            display: "flex",
            "align-items": "center",
            gap: "4px",
            opacity: props.step.request ? 1 : 0.5,
            cursor: props.step.request ? "pointer" : "not-allowed",
          }}
        >
          <IconEndpoints size={10} /> Endpoints
        </button>
      </div>
      <div style={{ padding: "10px 14px" }}>
        <Show when={tab() === "request"}>
          <Show
            when={props.step.request}
            fallback={
              <div style={{ "font-size": "12px", color: "var(--fg-3)" }}>No request recorded.</div>
            }
          >
            <pre
              class="mono"
              style={{
                margin: 0,
                "font-size": "12px",
                "line-height": 1.6,
                color: "var(--fg-1)",
              }}
            >
              {reqText()}
            </pre>
          </Show>
        </Show>
        <Show when={tab() === "response"}>
          <Show
            when={props.step.response}
            fallback={
              <div style={{ "font-size": "12px", color: "var(--fg-3)" }}>No response recorded.</div>
            }
          >
            <pre
              class="mono"
              style={{
                margin: 0,
                "font-size": "12px",
                "line-height": 1.6,
                color: "var(--fg-1)",
                "white-space": "pre-wrap",
              }}
            >
              <JsonPretty text={resText()} />
            </pre>
          </Show>
        </Show>
        <Show when={tab() === "logs"}>
          <div
            class="mono"
            style={{
              "font-size": "12px",
              color: "var(--err)",
              "white-space": "pre-wrap",
            }}
          >
            {props.step.error}
          </div>
        </Show>
      </div>
    </div>
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
