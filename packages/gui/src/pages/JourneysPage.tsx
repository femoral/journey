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
import { runEvents, type PlannedNode as WirePlannedNode } from "../api/runEvents";
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

/**
 * One entry in a journey's resolved pipeline, as broadcast by `step:planned`.
 * `kind: "sub"` marks an `invokeJourney(...)` node; its best-effort discovered
 * child pipeline is carried in `children` (recursively, for nesting) so the
 * timeline can pre-render nested rows before the sub-journey runs. A `sub`
 * node with no `children` was not discoverable at plan time — its rows fill in
 * live via `group:start` / step events.
 */
interface PlannedNode {
  name: string;
  kind: "step" | "sub";
  /** Endpoint token fed to `resolveIdleEndpoint`; absent for sub-journey nodes. */
  endpoint?: string;
  /** Sub-journey only — best-effort discovered child pipeline. */
  children?: PlannedNode[];
}

interface JourneyRuntimeState {
  results?: JourneyResult[];
  runState: UiRunState;
  error?: string;
  // Absolute stepIdx values currently executing — covers both HTTP steps and
  // sub-journey group nodes. Keyed by stepIdx (not array position) so it stays
  // correct when a sub-journey shifts the numbering of later steps.
  inFlight: Set<number>;
  sourceChecksum?: string;
  stale?: boolean;
  // Resolved top-level pipeline broadcast by the runner on `step:planned`. When
  // set, it wins over the regex-parsed source for the timeline, so journeys
  // whose bodies inject steps via helpers — or call sub-journeys — render the
  // real plan from the first frame of the run.
  plannedSteps?: PlannedNode[];
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

/**
 * Maps a wire `PlannedNode` (from `step:planned` or the plan endpoint) to the
 * page's `PlannedNode`, recursing into sub-journey children.
 */
function mapPlannedNode(s: WirePlannedNode): PlannedNode {
  const kind: "step" | "sub" = s.kind === "sub" ? "sub" : "step";
  const node: PlannedNode = { name: s.name, kind };
  if (kind === "step") {
    if (s.method && s.path) {
      // Synthesize an inline-descriptor token so resolveIdleEndpoint can
      // produce the MethodBadge + URL subtext.
      node.endpoint = `{ method: "${s.method}", path: "${s.path}" }`;
    }
  } else {
    // Recurse into the discovered child pipeline (nested subs included).
    node.children = (s.children ?? []).map((c) => mapPlannedNode(c));
  }
  return node;
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

  // Endpoint catalog — only its `baseUrl` is needed now that the plan endpoint
  // supplies each step's method + path directly.
  const [endpointsRes] = createResource(() => api.getEndpoints());
  // Prefer the selected environment's BASE_URL when /api/endpoints returns no
  // configured baseUrl (petstore-style projects set BASE_URL via env vars, not
  // journey.config.json). Falls back to the endpoint catalog value, then "".
  const baseUrl = (): string => {
    const envBase = envSel?.envValues?.()?.["BASE_URL"];
    if (envBase) return envBase;
    return endpointsRes()?.baseUrl ?? "";
  };

  // Idle steps carry a synthesized `{ method: "GET", path: "/foo" }` token
  // produced by `mapPlannedNode` from the plan endpoint's method + path.
  function resolveIdleEndpoint(
    token: string | undefined,
  ): { method: string; url: string } | undefined {
    if (!token) return undefined;
    const methodMatch = token.match(/method\s*:\s*["']([A-Z]+)["']/);
    const pathMatch = token.match(/path\s*:\s*["']([^"']+)["']/);
    if (methodMatch && pathMatch) {
      return { method: methodMatch[1]!, url: `${baseUrl()}${pathMatch[1]!}` };
    }
    return undefined;
  }

  // Source checksum for the currently selected journey — used to detect drift
  // between a cached run and the current on-disk source.
  const [idleSource] = createResource(selected, async (file) => {
    try {
      const { source } = await api.getJourneySource(file);
      return { checksum: fnv1a(source ?? "") };
    } catch {
      return { checksum: "" };
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

  // Plan tree for the selected journey, fetched from the server's plan
  // endpoint — the sole source for the idle timeline. The plan endpoint
  // evaluates the journey (and its sub-journeys) so the timeline can render
  // sub-journey rows — nested children included — before the first run.
  // `failed: true` marks a journey body that could not be evaluated.
  const [idlePlan] = createResource(
    () => {
      const file = selected();
      if (!file) return undefined;
      return { file, env: envSel?.selectedEnv() };
    },
    async ({ file, env }) => {
      try {
        const { journeys } = await api.getJourneyPlan(file, env);
        const steps = journeys?.[0]?.steps ?? [];
        return { file, steps, failed: false };
      } catch {
        return { file, steps: [] as WirePlannedNode[], failed: true };
      }
    },
  );

  // Seed `plannedSteps` once the plan resolves so idle sub-journey rows render
  // up front. A live run's `step:planned` later overrides this with the
  // authoritative tree. Keyed on the plan's own `file` so a slow response
  // can't land on a journey the user has since switched away from.
  createEffect(() => {
    const plan = idlePlan();
    if (!plan || plan.failed) return;
    updateJourneyState(plan.file, {
      plannedSteps: plan.steps.map(mapPlannedNode),
    });
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
    // Keep `plannedSteps` so the discovered pipeline (sub-journeys included)
    // stays on screen during the gap between kickoff and the run's first
    // `step:planned` frame — otherwise the timeline flickers back to the
    // source parse, which can't see `invokeJourney(...)` nodes.
    store.delete(file);
    setJourneyStates((prev) => {
      const planned = prev[file]?.plannedSteps;
      return {
        ...prev,
        [file]: {
          runState: "running",
          inFlight: new Set<number>(),
          ...(planned ? { plannedSteps: planned } : {}),
        },
      };
    });
    subs.get(file)?.close();
    subs.delete(file);

    // Capture the current source checksum so a successful run persists with
    // the version it actually ran against — used later to detect drift.
    const sourceChecksum = idleSource()?.checksum ?? "";

    // Live pipeline tree, built from SSE events. `liveTree` holds the
    // top-level nodes; a sub-journey node carries its child steps in
    // `.children`. `groupStack` routes child step/group events into the
    // innermost open sub-journey; `byIdx` maps absolute stepIdx → node so
    // request/response/end frames land on the right row regardless of how
    // sub-journeys shift the numbering.
    const liveTree: StepResult[] = [];
    const groupStack: StepResult[] = [];
    const byIdx = new Map<number, StepResult>();
    const inFlight = new Set<number>();
    let journeyName = file.replace(/\.journey\.ts$/, "");

    const container = (): StepResult[] =>
      groupStack.length > 0 ? groupStack[groupStack.length - 1]!.children! : liveTree;

    const cloneStep = (s: StepResult): StepResult => ({
      ...s,
      ...(s.children ? { children: s.children.map(cloneStep) } : {}),
    });

    const publish = (ok: boolean, durationMs: number) => {
      updateJourneyState(file, {
        results: [{ name: journeyName, ok, steps: liveTree.map(cloneStep), durationMs }],
        inFlight: new Set(inFlight),
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
            updateJourneyState(file, {
              plannedSteps: event.steps.map(mapPlannedNode),
            });
            break;
          }
          case "group:start": {
            const node: StepResult = {
              name: event.name,
              ok: false,
              durationMs: 0,
              kind: "sub",
              children: [],
              stepIdx: event.stepIdx,
              cacheStatus: event.cacheStatus,
            };
            container().push(node);
            byIdx.set(event.stepIdx, node);
            groupStack.push(node);
            inFlight.add(event.stepIdx);
            publish(false, 0);
            break;
          }
          case "group:end": {
            const node = byIdx.get(event.stepIdx);
            if (node) {
              node.ok = event.ok;
              node.durationMs = event.durationMs;
              if (event.error !== undefined) node.error = event.error;
            }
            if (groupStack[groupStack.length - 1] === node) groupStack.pop();
            inFlight.delete(event.stepIdx);
            publish(false, 0);
            break;
          }
          case "step:start": {
            journeyName = event.journeyName;
            const node: StepResult = {
              name: event.name,
              ok: false,
              durationMs: 0,
              kind: "step",
              stepIdx: event.stepIdx,
            };
            container().push(node);
            byIdx.set(event.stepIdx, node);
            inFlight.add(event.stepIdx);
            publish(false, 0);
            break;
          }
          case "request": {
            const s = byIdx.get(event.stepIdx);
            if (s) s.request = { method: event.method, url: event.url };
            publish(false, 0);
            break;
          }
          case "response": {
            const s = byIdx.get(event.stepIdx);
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
            const s = byIdx.get(event.stepIdx);
            if (s) {
              s.ok = event.ok;
              s.durationMs = event.durationMs;
              if (event.error !== undefined) s.error = event.error;
            }
            inFlight.delete(event.stepIdx);
            publish(false, 0);
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
            // Top-level pipeline for idle rendering — the plan tree seeded
            // from the plan endpoint, then overridden by a live run's
            // `step:planned` broadcast.
            const idleNodes = (): PlannedNode[] => state().plannedSteps ?? [];
            const stepCount = () =>
              Math.max(state().results?.[0]?.steps.length ?? 0, idleNodes().length);
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

                <Show
                  when={
                    idlePlan()?.failed === true &&
                    !idlePlan.loading &&
                    (state().plannedSteps?.length ?? 0) === 0 &&
                    !state().results
                  }
                >
                  <div
                    data-testid="plan-unavailable"
                    style={{
                      padding: "10px 20px",
                      "font-size": "12px",
                      color: "var(--fg-2)",
                      "border-bottom": "1px solid var(--bd-1)",
                    }}
                  >
                    Plan unavailable — this journey's body could not be evaluated without running
                    it. Run the journey to see its resolved steps.
                  </div>
                </Show>

                <div style={{ flex: 1, overflow: "auto" }}>
                  <StepTimeline
                    runState={state().runState}
                    results={state().results}
                    idleNodes={idleNodes()}
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

interface TimelineRow {
  step: StepResult;
  state: RunState;
  index: number;
}

/**
 * Run state of a single node. `stepIdx` present + in `inFlight` → running;
 * absent stepIdx → an idle planned row that hasn't executed; otherwise the
 * recorded outcome (`ok`, or a non-zero duration / explicit error) decides.
 * A bare `!ok` with no duration means the node started but hasn't ended yet.
 */
function nodeRunState(s: StepResult, inFlight: Set<number>): RunState {
  if (s.stepIdx !== undefined && inFlight.has(s.stepIdx)) return "running";
  if (s.stepIdx === undefined) return "idle";
  if (s.ok) return "pass";
  if (s.durationMs > 0 || s.error !== undefined) return "fail";
  return "running";
}

/**
 * Builds an idle (not-yet-run) timeline node from a planned pipeline entry,
 * recursing into a sub-journey's discovered child pipeline so nested rows
 * render before the run reaches them. No `stepIdx` is assigned — these are
 * placeholders until the live run events arrive.
 */
function idlePlannedToStep(
  p: PlannedNode,
  resolveEndpoint: (token: string | undefined) => { method: string; url: string } | undefined,
): StepResult {
  const step: StepResult = { name: p.name, ok: false, durationMs: 0, kind: p.kind };
  if (p.kind === "sub") {
    step.children = (p.children ?? []).map((c) => idlePlannedToStep(c, resolveEndpoint));
  } else {
    const resolved = resolveEndpoint(p.endpoint);
    if (resolved) step.request = resolved;
  }
  return step;
}

function StepTimeline(props: {
  runState: UiRunState;
  results: JourneyResult[] | undefined;
  idleNodes: PlannedNode[];
  inFlight: Set<number>;
  stale: boolean;
  resolveEndpoint: (token: string | undefined) => { method: string; url: string } | undefined;
  onRunOnly: (stepIdx: number) => void;
  onSendViaEndpoints: (step: StepResult) => void;
}): JSX.Element {
  const liveTop = createMemo<StepResult[]>(() => props.results?.[0]?.steps ?? []);
  // Top-level rows: live nodes win positionally over the idle plan (both are
  // in pipeline order), so steps not yet started still render as idle rows.
  const rows = createMemo<TimelineRow[]>(() => {
    const live = liveTop();
    const idle = props.idleNodes;
    const len = Math.max(live.length, idle.length);
    const out: TimelineRow[] = [];
    for (let i = 0; i < len; i++) {
      const liveStep = live[i];
      if (liveStep) {
        let step = liveStep;
        // A live HTTP step that hasn't received its `request` frame yet falls
        // back to the planned endpoint so the verb/URL don't flicker.
        if (liveStep.kind !== "sub" && !liveStep.request) {
          const p = idle[i];
          const resolved = p && p.kind === "step" ? props.resolveEndpoint(p.endpoint) : undefined;
          if (resolved) step = { ...liveStep, request: resolved };
        }
        out.push({ step, state: nodeRunState(liveStep, props.inFlight), index: i });
      } else {
        const p = idle[i]!;
        out.push({
          step: idlePlannedToStep(p, props.resolveEndpoint),
          state: "idle",
          index: i,
        });
      }
    }
    return out;
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
        <Show when={props.runState === "done" && rows().length > 0}>
          <span class="mono">{rows().reduce((a, r) => a + r.step.durationMs, 0)}ms</span>
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
        when={rows().length > 0}
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
                depth={0}
                inFlight={props.inFlight}
                onRunOnly={props.onRunOnly}
                onSendViaEndpoints={props.onSendViaEndpoints}
              />
            )}
          </Index>
        </div>
      </Show>
    </div>
  );
}

/** Short status badge shown on a sub-journey group row in place of a method badge. */
function groupBadgeText(step: StepResult): string {
  if (step.cacheStatus === "hit") return "cached";
  const n = step.children?.length ?? 0;
  if (n > 0) return `${n} step${n === 1 ? "" : "s"}`;
  return "sub-journey";
}

function StepCard(props: {
  step: StepResult;
  index: number;
  state: RunState;
  /** 0 = top-level pipeline row; >0 = a step nested inside a sub-journey. */
  depth: number;
  inFlight: Set<number>;
  onRunOnly: (stepIdx: number) => void;
  onSendViaEndpoints: (step: StepResult) => void;
}): JSX.Element {
  const isSub = () => props.step.kind === "sub";
  const [expanded, setExpanded] = createSignal(props.state === "fail");
  // Auto-expand the first time this card enters the "fail" state so the user
  // sees the error (or the failing child) without an extra click.
  let didAutoExpand = props.state === "fail";
  createEffect(() => {
    if (props.state === "fail" && !didAutoExpand) {
      didAutoExpand = true;
      setExpanded(true);
    }
  });
  const childRows = createMemo<TimelineRow[]>(() =>
    (props.step.children ?? []).map((c, i) => ({
      step: c,
      state: nodeRunState(c, props.inFlight),
      index: i,
    })),
  );
  const inFlightSelf = () =>
    props.step.stepIdx !== undefined && props.inFlight.has(props.step.stepIdx);
  const testid = props.depth === 0 ? `step-card-${props.index}` : `substep-card-${props.index}`;
  return (
    <div
      style={{
        display: "flex",
        gap: "10px",
        "margin-bottom": "8px",
        position: "relative",
      }}
      data-testid={testid}
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
          <Show
            when={!isSub()}
            fallback={
              <span
                class="mono"
                data-testid="sub-journey-badge"
                style={{
                  "font-size": "9px",
                  "font-weight": 600,
                  "letter-spacing": "0.05em",
                  padding: "2px 5px",
                  "border-radius": "3px",
                  background: "var(--ac-bg)",
                  color: "var(--ac)",
                  "flex-shrink": 0,
                }}
              >
                SUB
              </span>
            }
          >
            <Show when={props.step.request}>
              {(req) => <MethodBadge method={req().method as HttpMethod} />}
            </Show>
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
              {isSub() ? groupBadgeText(props.step) : (props.step.request?.url ?? " ")}
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
          <Show
            when={isSub()}
            fallback={
              <StepDetail
                step={props.step}
                inFlight={inFlightSelf()}
                onRunOnly={() => props.onRunOnly(props.step.stepIdx ?? props.index)}
                onSendViaEndpoints={() => props.onSendViaEndpoints(props.step)}
              />
            }
          >
            <div
              style={{
                "border-top": "1px solid var(--bd-1)",
                background: "var(--bg-0)",
                padding: "10px 12px 2px",
              }}
            >
              <Show
                when={childRows().length > 0}
                fallback={
                  <div
                    style={{
                      "font-size": "12px",
                      color: props.step.error ? "var(--err)" : "var(--fg-3)",
                      "white-space": "pre-wrap",
                      "padding-bottom": "8px",
                    }}
                  >
                    {props.step.error ?? "Sub-journey has not run yet."}
                  </div>
                }
              >
                <Index each={childRows()}>
                  {(row) => (
                    <StepCard
                      step={row().step}
                      index={row().index}
                      state={row().state}
                      depth={props.depth + 1}
                      inFlight={props.inFlight}
                      onRunOnly={props.onRunOnly}
                      onSendViaEndpoints={props.onSendViaEndpoints}
                    />
                  )}
                </Index>
              </Show>
            </div>
          </Show>
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
