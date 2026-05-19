import {
  For,
  Index,
  Match,
  Show,
  Switch,
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  untrack,
  type Component,
  type JSX,
} from "solid-js";
import { api, type JourneyResult, type RunSummary, type StepResult } from "../api/client";
import { runEvents } from "../api/runEvents";
import { parseSteps, type ParsedStep } from "../util/parseSteps";
import {
  createLocalStorageRunStateStore,
  fnv1a,
  type CachedRun,
  type RunStateStore,
} from "../state/runStateStore";
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

interface JourneyRuntimeState {
  results?: JourneyResult[];
  runState: UiRunState;
  error?: string;
  inFlight: Set<number>;
  sourceChecksum?: string;
  stale?: boolean;
  // Resolved step list broadcast by the runner on `step:planned`. When set, it
  // wins over the regex-parsed source for the timeline, so journeys whose
  // bodies inject steps via helpers render the real plan from the first frame
  // of the run instead of growing in place as `step:start` events arrive.
  plannedSteps?: ParsedStep[];
  // Live runId, set as soon as POST /run returns its 202. Used by the Stop
  // button to call POST /api/runs/:id/abort. Cleared (set to undefined) on
  // run:end so a stale id doesn't outlive its broadcaster.
  runId?: string | undefined;
  // True once the user has clicked Stop but the final `run:end` hasn't landed
  // yet — keeps the button disabled (label: "Stopping…") so a second click
  // can't double-fire the abort.
  aborting?: boolean | undefined;
}

function emptyRuntimeState(): JourneyRuntimeState {
  return { runState: "idle", inFlight: new Set<number>() };
}

export const JourneysPage: Component = () => {
  const cons = useConsole();
  const envSel = useEnvSelection();
  const navigate = useNavigate();
  const [list, { refetch: refetchList }] = createResource(api.getJourneys);
  const [selected, setSelected] = createSignal<string | undefined>(undefined);
  const [journeyStates, setJourneyStates] = createSignal<Record<string, JourneyRuntimeState>>({});
  const [filter, setFilter] = createSignal("");

  // /api/runs is loaded solely to annotate the left-side journey list with a
  // relative "last run" timestamp; comparison + full history live on /history.
  const [runs, { refetch: refetchRuns }] = createResource(api.listRuns);

  // Project info — used to namespace the localStorage cache so switching
  // projects doesn't leak last-run state across them.
  const [project] = createResource(() => api.getProject());
  const store: RunStateStore = createLocalStorageRunStateStore();
  createEffect(() => {
    const p = project();
    if (!p?.projectDir) return;
    store.setProjectId(p.projectDir);
    // Drop in-memory state + close active subs when project changes; the new
    // project's cache will hydrate on first journey pick.
    untrack(() => {
      setJourneyStates({});
      subs.forEach((s) => s.close());
      subs.clear();
    });
  });

  // Per-journey SSE subscriptions. Survive navigation away from the page-level
  // selected journey so multi-journey runs can stream in the background; all
  // are closed on page unmount.
  const subs = new Map<string, { close: () => void }>();
  onCleanup(() => {
    subs.forEach((s) => s.close());
    subs.clear();
  });

  const filteredFiles = createMemo(() => {
    const q = filter().toLowerCase();
    const files = list()?.files ?? [];
    return q ? files.filter((f) => f.toLowerCase().includes(q)) : files;
  });

  function updateJourneyState(
    file: string,
    patch:
      | Partial<JourneyRuntimeState>
      | ((prev: JourneyRuntimeState) => Partial<JourneyRuntimeState>),
  ) {
    setJourneyStates((prev) => {
      const cur = prev[file] ?? emptyRuntimeState();
      const next = typeof patch === "function" ? patch(cur) : patch;
      return { ...prev, [file]: { ...cur, ...next } };
    });
  }

  // Endpoint catalog used to pre-resolve idle steps' method + URL before any
  // run. Map keyed by the generated endpoint identifier (e.g. "findPetsByStatus").
  const [endpointsRes] = createResource(() => api.getEndpoints());
  const endpointMap = createMemo(() => {
    const list = endpointsRes()?.endpoints ?? [];
    const m = new Map<string, { method: string; path: string }>();
    for (const ep of list) m.set(ep.name, { method: ep.method, path: ep.path });
    return m;
  });
  // Prefer the selected environment's BASE_URL when /api/endpoints returns no
  // configured baseUrl (petstore-style projects set BASE_URL via env vars, not
  // journey.config.json). Falls back to the endpoint catalog value, then "".
  const baseUrl = (): string => {
    const envBase = envSel?.envValues?.()?.["BASE_URL"];
    if (envBase) return envBase;
    return endpointsRes()?.baseUrl ?? "";
  };

  function resolveIdleEndpoint(
    token: string | undefined,
  ): { method: string; url: string } | undefined {
    if (!token) return undefined;
    // Reference form: `endpoints.findPetsByStatus` / `e.findById` etc.
    // parseSteps captures up to comma or newline, so the token may include
    // trailing `});` — just match the leading identifier(s).
    const refMatch = token.match(/^\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?([A-Za-z_$][\w$]*)\b/);
    if (refMatch) {
      const ep = endpointMap().get(refMatch[1]!);
      if (ep) return { method: ep.method, url: `${baseUrl()}${ep.path}` };
    }
    // Inline form: `{ method: "GET", path: "/foo" }`
    const methodMatch = token.match(/method\s*:\s*["']([A-Z]+)["']/);
    const pathMatch = token.match(/path\s*:\s*["']([^"']+)["']/);
    if (methodMatch && pathMatch) {
      return { method: methodMatch[1]!, url: `${baseUrl()}${pathMatch[1]!}` };
    }
    return undefined;
  }

  // Parsed step list + checksum for the currently selected journey. Used both
  // to render the idle step list before any run and to detect drift between a
  // cached run and the current on-disk source.
  const [idleSource] = createResource(selected, async (file) => {
    try {
      const { source } = await api.getJourneySource(file);
      const src = source ?? "";
      return { source: src, parsed: parseSteps(src), checksum: fnv1a(src) };
    } catch {
      return { source: "", parsed: [] as ParsedStep[], checksum: "" };
    }
  });

  // When the parsed source resolves, flag a stale cache (checksum drift)
  // without dropping the displayed results — user still sees prior context.
  createEffect(() => {
    const file = selected();
    if (!file) return;
    const idle = idleSource();
    if (!idle) return;
    const state = untrack(() => journeyStates()[file]);
    if (!state) return;
    if (state.sourceChecksum && idle.checksum && state.sourceChecksum !== idle.checksum) {
      if (!state.stale) updateJourneyState(file, { stale: true });
    }
  });

  const current = (): JourneyRuntimeState | undefined => {
    const f = selected();
    return f ? journeyStates()[f] : undefined;
  };

  const pickJourney = (file: string) => {
    setSelected(file);
    setJourneyStates((prev) => {
      if (prev[file]) return prev; // preserve in-memory state (e.g. background run)
      const cached = store.get(file);
      if (cached) {
        // Cached "running" means a run was in flight when the app closed; we
        // can't resume the SSE stream, so present as a completed snapshot
        // until the user re-runs.
        const hydrated: JourneyRuntimeState = {
          results: cached.results,
          runState: "done",
          inFlight: new Set<number>(),
          sourceChecksum: cached.sourceChecksum,
        };
        if (cached.error !== undefined) hydrated.error = cached.error;
        return { ...prev, [file]: hydrated };
      }
      return { ...prev, [file]: emptyRuntimeState() };
    });
  };

  const stop = async () => {
    const file = selected();
    if (!file) return;
    const state = journeyStates()[file];
    const runId = state?.runId;
    if (!runId || state.aborting) return;
    updateJourneyState(file, { aborting: true });
    try {
      await api.abortRun(runId);
    } catch (e) {
      // 404 just means the run already finished — broadcaster will still emit
      // run:end and we'll transition normally. Surface other failures so the
      // user knows the stop request didn't take.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/404/.test(msg)) {
        updateJourneyState(file, { error: msg, aborting: false });
      }
    }
  };

  const run = async (opts: { upToStepIdx?: number } = {}) => {
    const file = selected();
    if (!file) return;
    // Invalidate any cached run for this journey and reset its in-memory state.
    store.delete(file);
    setJourneyStates((prev) => ({
      ...prev,
      [file]: {
        runState: "running",
        inFlight: new Set<number>(),
      },
    }));
    subs.get(file)?.close();
    subs.delete(file);

    // Capture the current source checksum so a successful run persists with
    // the version it actually ran against — used later to detect drift.
    const sourceChecksum = idleSource()?.checksum ?? "";

    const liveSteps: StepResult[] = [];
    let journeyName = file.replace(/\.journey\.ts$/, "");
    const publish = (ok: boolean, durationMs: number) => {
      updateJourneyState(file, {
        results: [
          {
            name: journeyName,
            ok,
            steps: liveSteps.map((s) => ({ ...s })),
            durationMs,
          },
        ],
      });
    };

    try {
      const env = envSel?.selectedEnv();
      const { runId } = await api.startJourneyRun(file, {
        ...opts,
        ...(env !== undefined ? { env } : {}),
      });
      updateJourneyState(file, { runId });
      const sub = runEvents.subscribe(runId, (event) => {
        cons.ingest(event);
        switch (event.kind) {
          case "step:planned": {
            // This page renders one journey per file; ignore additional
            // journeys that might run in the same SSE stream.
            if (event.journeyIdx !== 0) break;
            const parsed = idleSource()?.parsed ?? [];
            // Prefer the runtime-supplied method+path (covers helper-injected
            // steps); fall back to the source parse for cases where the
            // runtime descriptor is less informative (unlikely).
            const merged: ParsedStep[] = event.steps.map((s) => {
              const entry: ParsedStep = { name: s.name, start: 0, end: 0 };
              if (s.method && s.path) {
                // Synthesize an inline-descriptor token so resolveIdleEndpoint
                // can produce the MethodBadge + URL subtext using its existing
                // parser.
                entry.endpoint = `{ method: "${s.method}", path: "${s.path}" }`;
              } else {
                const match = parsed.find((p) => p.name === s.name);
                if (match?.endpoint !== undefined) entry.endpoint = match.endpoint;
              }
              return entry;
            });
            updateJourneyState(file, { plannedSteps: merged });
            break;
          }
          case "step:start": {
            journeyName = event.journeyName;
            // Pre-fill request with the resolved endpoint so the MethodBadge
            // and URL row stay rendered between step:start and the actual
            // `request` SSE frame (avoids first-step flicker). Prefer the
            // planned list (covers helper-injected steps) over the source
            // parse.
            const initial: StepResult = { name: event.name, ok: false, durationMs: 0 };
            const plannedList = untrack(() => journeyStates()[file]?.plannedSteps);
            const lookup = plannedList ?? idleSource()?.parsed ?? [];
            const parsed = lookup[event.stepIdx];
            const resolved = parsed ? resolveIdleEndpoint(parsed.endpoint) : undefined;
            if (resolved) initial.request = resolved;
            liveSteps.push(initial);
            batch(() => {
              updateJourneyState(file, (prev) => {
                const next = new Set(prev.inFlight);
                next.add(event.stepIdx);
                return { inFlight: next };
              });
              publish(false, 0);
            });
            break;
          }
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
            batch(() => {
              updateJourneyState(file, (prev) => {
                const next = new Set(prev.inFlight);
                next.delete(event.stepIdx);
                return { inFlight: next };
              });
              publish(false, 0);
            });
            break;
          }
          case "run:end": {
            batch(() => {
              publish(event.ok, event.durationMs);
              updateJourneyState(file, (prev) => {
                const patch: Partial<JourneyRuntimeState> = {
                  runState: "done",
                  inFlight: new Set<number>(),
                  sourceChecksum,
                  stale: false,
                  aborting: false,
                  runId: undefined,
                };
                if (prev.aborting && prev.error === undefined) {
                  patch.error = "Run stopped by user";
                }
                return patch;
              });
            });
            subs.get(file)?.close();
            subs.delete(file);
            const finalState = journeyStates()[file];
            if (finalState?.results) {
              const cached: CachedRun = {
                results: finalState.results,
                runState: "done",
                sourceChecksum,
                finishedAt: new Date().toISOString(),
              };
              if (finalState.error !== undefined) cached.error = finalState.error;
              store.set(file, cached);
            }
            void refetchRuns();
            void refetchList();
            break;
          }
          case "error":
            updateJourneyState(file, { error: event.message });
            break;
        }
      });
      subs.set(file, sub);
    } catch (e) {
      updateJourneyState(file, {
        error: e instanceof Error ? e.message : String(e),
        runState: "idle",
      });
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
              {(file) => {
                const live = journeyStates()[file]?.runState;
                return (
                  <JourneyRow
                    file={file}
                    lastRun={(runs() ?? []).find((r) => r.journeyNames.includes(file))}
                    {...(live ? { liveRunState: live } : {})}
                    active={selected() === file}
                    onClick={() => pickJourney(file)}
                  />
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
          {(file) => {
            const state = (): JourneyRuntimeState => current() ?? emptyRuntimeState();
            const idle = () => state().plannedSteps ?? idleSource()?.parsed ?? [];
            const stepCount = () =>
              Math.max(state().results?.[0]?.steps.length ?? 0, idle().length);
            return (
              <>
                <JourneyHeader
                  file={file()}
                  steps={stepCount()}
                  runState={state().runState}
                  aborting={state().aborting ?? false}
                  canStop={state().runId !== undefined}
                  {...(state().stale ? { stale: true } : {})}
                  onRun={() => void run()}
                  onStop={() => void stop()}
                  onViewHistory={() => navigate("/history")}
                />

                <Show when={state().error}>
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
                    {state().error}
                  </div>
                </Show>

                <div style={{ flex: 1, overflow: "auto" }}>
                  <StepTimeline
                    runState={state().runState}
                    results={state().results}
                    idleSteps={idle()}
                    inFlight={state().inFlight}
                    stale={state().stale ?? false}
                    resolveEndpoint={resolveIdleEndpoint}
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
            );
          }}
        </Show>
      </section>
    </div>
  );
};

function JourneyRow(props: {
  file: string;
  lastRun: RunSummary | undefined;
  liveRunState?: UiRunState;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const name = () => props.file.replace(/\.journey\.ts$/, "");
  const state = (): RunState => {
    if (props.liveRunState === "running") return "running";
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
  aborting: boolean;
  canStop: boolean;
  stale?: boolean;
  onRun: () => void;
  onStop: () => void;
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
            <Show when={props.stale}>
              {" · "}
              <span
                data-testid="stale-badge"
                title="Journey source changed since this run"
                style={{ color: "var(--warn, var(--fg-3))" }}
              >
                stale — source changed
              </span>
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
          onClick={() => (props.runState === "running" ? props.onStop() : props.onRun())}
          disabled={props.runState === "running" && (props.aborting || !props.canStop)}
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
            cursor:
              props.runState === "running" && (props.aborting || !props.canStop)
                ? "not-allowed"
                : "pointer",
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
            <IconStop size={10} /> {props.aborting ? "Stopping…" : "Stop"}
          </Show>
        </button>
      </div>
    </div>
  );
}

interface MergedRow {
  step: StepResult;
  state: RunState;
  index: number;
  inFlight: boolean;
  defaultExpanded: boolean;
}

function StepTimeline(props: {
  runState: UiRunState;
  results: JourneyResult[] | undefined;
  idleSteps: ParsedStep[];
  inFlight: Set<number>;
  stale: boolean;
  resolveEndpoint: (token: string | undefined) => { method: string; url: string } | undefined;
  onRunOnly: (stepIdx: number) => void;
  onSendViaEndpoints: (step: StepResult) => void;
}): JSX.Element {
  const liveSteps = createMemo<StepResult[]>(() => {
    const rs = props.results ?? [];
    return rs.flatMap((r) => r.steps);
  });
  const rows = createMemo<MergedRow[]>(() => {
    const live = liveSteps();
    const idle = props.idleSteps;
    const len = Math.max(live.length, idle.length);
    const out: MergedRow[] = [];
    for (let i = 0; i < len; i++) {
      const liveStep = live[i];
      const inFlight = props.inFlight.has(i);
      if (liveStep) {
        // Ended = no longer in flight AND has a recorded outcome (pass, or a
        // non-zero duration / explicit error from step:end). Bare !ok with no
        // duration means we're still mid-run for this step.
        let s: RunState;
        if (inFlight) s = "running";
        else if (liveStep.ok) s = "pass";
        else if (liveStep.durationMs > 0 || liveStep.error !== undefined) s = "fail";
        else s = "running";
        // Fall back to the pre-resolved idle endpoint when live row exists but
        // hasn't received its `request` SSE frame yet (avoids verb/URL flicker
        // between `step:start` and `request`).
        let step = liveStep;
        if (!liveStep.request) {
          const parsed = idle[i];
          const resolved = parsed ? props.resolveEndpoint(parsed.endpoint) : undefined;
          if (resolved) step = { ...liveStep, request: resolved };
        }
        out.push({
          step,
          state: s,
          index: i,
          inFlight,
          defaultExpanded: s === "fail",
        });
      } else {
        const parsed = idle[i]!;
        const resolved = props.resolveEndpoint(parsed.endpoint);
        const idleStep: StepResult = { name: parsed.name, ok: false, durationMs: 0 };
        if (resolved) idleStep.request = resolved;
        out.push({
          step: idleStep,
          state: "idle",
          index: i,
          inFlight: false,
          defaultExpanded: false,
        });
      }
    }
    return out;
  });
  const allSteps = createMemo<StepResult[]>(() => rows().map((r) => r.step));

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
          <Index each={rows()}>
            {(row, i) => (
              <StepCard
                step={row().step}
                index={i}
                state={row().state}
                inFlight={row().inFlight}
                defaultExpanded={row().defaultExpanded}
                onRunOnly={() => props.onRunOnly(i)}
                onSendViaEndpoints={() => props.onSendViaEndpoints(row().step)}
              />
            )}
          </Index>
        </div>
      </Show>
    </div>
  );
}

function StepCard(props: {
  step: StepResult;
  index: number;
  state: RunState;
  inFlight: boolean;
  defaultExpanded: boolean;
  onRunOnly: () => void;
  onSendViaEndpoints: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded);
  // Auto-expand the first time this card enters the "fail" state so the user
  // sees the error without an extra click. Subsequent toggles are honored.
  let didAutoExpand = props.defaultExpanded;
  createEffect(() => {
    if (props.state === "fail" && !didAutoExpand) {
      didAutoExpand = true;
      setExpanded(true);
    }
  });
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
        <StepIcon state={props.state} index={props.index} />
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
            <span
              class="mono"
              style={{
                "font-size": "10px",
                color: "var(--fg-3)",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
                "max-width": "100%",
                "min-height": "14px",
                "line-height": "14px",
              }}
            >
              {props.step.request?.url ?? " "}
            </span>
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
            {props.state === "idle" ? "—" : `${props.step.durationMs}ms`}
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
            inFlight={props.inFlight}
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
  return (
    <Switch
      fallback={
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
      }
    >
      <Match when={props.state === "pass"}>
        <div
          style={{
            ...base,
            border: "1.5px solid var(--ok)",
            color: "var(--ok)",
          }}
        >
          <IconCheck size={11} />
        </div>
      </Match>
      <Match when={props.state === "fail"}>
        <div
          style={{
            ...base,
            border: "1.5px solid var(--err)",
            color: "var(--err)",
          }}
        >
          <IconX size={11} />
        </div>
      </Match>
      <Match when={props.state === "running"}>
        <div
          style={{
            ...base,
            border: "1.5px solid var(--ac)",
            "box-shadow": "0 0 0 3px var(--ac-bg)",
          }}
        >
          <RunDot state="running" size={6} />
        </div>
      </Match>
    </Switch>
  );
}

type DetailTab = "request" | "response" | "logs";

function StepDetail(props: {
  step: StepResult;
  inFlight: boolean;
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
              <div style={{ "font-size": "12px", color: "var(--fg-3)" }}>
                {props.inFlight ? "Awaiting request…" : "No request recorded."}
              </div>
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
              <div style={{ "font-size": "12px", color: "var(--fg-3)" }}>
                {props.inFlight ? "Awaiting response…" : "No response recorded."}
              </div>
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
