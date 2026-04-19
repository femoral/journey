import {
  createResource,
  createSignal,
  For,
  Show,
  type Accessor,
  type Component,
} from "solid-js";
import { api, type JourneyResult, type RunDetail, type RunSummary } from "../api/client";
import { JsonDiff } from "../components/JsonDiff";

export const JourneysPage: Component = () => {
  const [list] = createResource(api.getJourneys);
  const [selected, setSelected] = createSignal<string | undefined>(undefined);
  const [results, setResults] = createSignal<JourneyResult[] | undefined>(undefined);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [busy, setBusy] = createSignal(false);

  // Run history
  const [runs, { refetch: refetchRuns }] = createResource(api.listRuns);
  const [diffA, setDiffA] = createSignal<RunDetail | undefined>(undefined);
  const [diffB, setDiffB] = createSignal<RunDetail | undefined>(undefined);
  const [diffStep, setDiffStep] = createSignal<number>(0);

  const run = async () => {
    const file = selected();
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setResults(undefined);
    try {
      const res = await api.runJourney(file);
      setResults(res.results);
      await refetchRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadForDiff = async (summary: RunSummary, slot: "A" | "B") => {
    const detail = await api.getRun(summary.id);
    if (slot === "A") setDiffA(detail);
    else setDiffB(detail);
  };

  return (
    <div class="grid grid-cols-[20rem_1fr] gap-6">
      <aside>
        <h1 class="text-xl font-semibold mb-3">Journeys</h1>
        <Show when={list()}>
          {(l: Accessor<{ files: string[] }>) => (
            <ul class="space-y-0.5" data-testid="journey-list">
              <For
                each={l().files}
                fallback={<p class="text-slate-500 text-sm">No journeys found.</p>}
              >
                {(file) => (
                  <li>
                    <button
                      type="button"
                      class="w-full text-left px-2 py-1 rounded hover:bg-slate-800 font-mono text-xs"
                      classList={{ "bg-slate-800": selected() === file }}
                      onClick={() => setSelected(file)}
                    >
                      {file}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          )}
        </Show>
      </aside>
      <section class="min-w-0 space-y-6">
        <Show
          when={selected()}
          fallback={<p class="text-slate-400">Select a journey on the left.</p>}
        >
          {/* ---- Runner ---- */}
          <div class="space-y-4">
            <div class="font-mono text-sm">{selected()}</div>
            <button
              type="button"
              class="px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
              disabled={busy()}
              onClick={() => void run()}
              data-testid="run-button"
            >
              {busy() ? "Running…" : "Run"}
            </button>
            <Show when={error()}>
              <p class="text-rose-400 text-sm" data-testid="run-error">
                {error()}
              </p>
            </Show>
            <Show when={results()}>
              {(rs: Accessor<JourneyResult[]>) => (
                <div class="space-y-4" data-testid="run-results">
                  <For each={rs()}>
                    {(r) => (
                      <div class="border border-slate-800 rounded p-3">
                        <header class="flex items-center gap-2 mb-2">
                          <span class={r.ok ? "text-emerald-400" : "text-rose-400"}>
                            {r.ok ? "✓" : "✗"}
                          </span>
                          <span class="font-semibold">{r.name}</span>
                          <span class="text-slate-500 text-xs">({r.durationMs}ms)</span>
                        </header>
                        <ul class="space-y-1">
                          <For each={r.steps}>
                            {(s) => (
                              <li class="font-mono text-xs flex gap-2 items-baseline">
                                <span class={s.ok ? "text-emerald-400" : "text-rose-400"}>
                                  {s.ok ? "✓" : "✗"}
                                </span>
                                <span class="text-slate-200">{s.name}</span>
                                <Show when={s.request}>
                                  {(req: Accessor<{ method: string; url: string }>) => (
                                    <span class="text-slate-400">
                                      {req().method} {req().url}
                                    </span>
                                  )}
                                </Show>
                                <Show when={s.response}>
                                  {(res: Accessor<{ status: number }>) => (
                                    <span class="text-slate-400">→ {res().status}</span>
                                  )}
                                </Show>
                                <span class="text-slate-600">({s.durationMs}ms)</span>
                                <Show when={s.error}>
                                  <span class="text-rose-400">— {s.error}</span>
                                </Show>
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </Show>
          </div>

          {/* ---- History + Diff ---- */}
          <Show when={(runs() ?? []).length > 0}>
            <div>
              <h2 class="text-sm uppercase tracking-wider text-slate-500 mb-2">Run history</h2>
              <div class="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div class="text-slate-500 mb-1">Side A (previous)</div>
                  <ul class="space-y-0.5" data-testid="history-a">
                    <For each={runs()}>
                      {(r) => (
                        <li>
                          <button
                            type="button"
                            class="w-full text-left px-2 py-1 rounded hover:bg-slate-800 font-mono"
                            classList={{ "bg-slate-800": diffA()?.id === r.id }}
                            onClick={() => void loadForDiff(r, "A")}
                          >
                            <span class={r.ok ? "text-emerald-400" : "text-rose-400"}>
                              {r.ok ? "✓" : "✗"}
                            </span>{" "}
                            {r.timestamp.slice(0, 19).replace("T", " ")}{" "}
                            <span class="text-slate-500">{r.journeyNames.join(", ")}</span>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
                <div>
                  <div class="text-slate-500 mb-1">Side B (current)</div>
                  <ul class="space-y-0.5" data-testid="history-b">
                    <For each={runs()}>
                      {(r) => (
                        <li>
                          <button
                            type="button"
                            class="w-full text-left px-2 py-1 rounded hover:bg-slate-800 font-mono"
                            classList={{ "bg-slate-800": diffB()?.id === r.id }}
                            onClick={() => void loadForDiff(r, "B")}
                          >
                            <span class={r.ok ? "text-emerald-400" : "text-rose-400"}>
                              {r.ok ? "✓" : "✗"}
                            </span>{" "}
                            {r.timestamp.slice(0, 19).replace("T", " ")}{" "}
                            <span class="text-slate-500">{r.journeyNames.join(", ")}</span>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </div>
            </div>
          </Show>

          <Show when={diffA() && diffB()}>
            <div>
              <h2 class="text-sm uppercase tracking-wider text-slate-500 mb-2">Response diff</h2>
              <Show
                when={
                  diffA()!.results[0]?.steps.length &&
                  diffB()!.results[0]?.steps.length
                }
              >
                <div class="flex gap-2 mb-2">
                  <For
                    each={diffA()!.results[0]!.steps}
                  >
                    {(s, i) => (
                      <button
                        type="button"
                        class="px-2 py-0.5 rounded text-xs font-mono"
                        classList={{
                          "bg-brand-600 text-white": diffStep() === i(),
                          "bg-slate-800 text-slate-300 hover:bg-slate-700": diffStep() !== i(),
                        }}
                        onClick={() => setDiffStep(i())}
                        data-testid={`diff-step-${i()}`}
                      >
                        {s.name}
                      </button>
                    )}
                  </For>
                </div>
                <JsonDiff
                  left={diffA()!.results[0]!.steps[diffStep()]?.response?.body}
                  right={diffB()!.results[0]!.steps[diffStep()]?.response?.body}
                  leftLabel={`A: ${diffA()!.timestamp.slice(0, 19)}`}
                  rightLabel={`B: ${diffB()!.timestamp.slice(0, 19)}`}
                />
              </Show>
            </div>
          </Show>
        </Show>
      </section>
    </div>
  );
};
