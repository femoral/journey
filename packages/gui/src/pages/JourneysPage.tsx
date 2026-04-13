import { createResource, createSignal, For, Show, type Component } from "solid-js";
import { api, type JourneyResult } from "../api/client";

export const JourneysPage: Component = () => {
  const [list] = createResource(api.getJourneys);
  const [selected, setSelected] = createSignal<string | undefined>(undefined);
  const [results, setResults] = createSignal<JourneyResult[] | undefined>(undefined);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [busy, setBusy] = createSignal(false);

  const run = async () => {
    const file = selected();
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setResults(undefined);
    try {
      const res = await api.runJourney(file);
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="grid grid-cols-[20rem_1fr] gap-6">
      <aside>
        <h1 class="text-xl font-semibold mb-3">Journeys</h1>
        <Show when={list()}>
          {(l) => (
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
      <section class="min-w-0">
        <Show
          when={selected()}
          fallback={<p class="text-slate-400">Select a journey on the left.</p>}
        >
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
              {(rs) => (
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
                                  {(req) => (
                                    <span class="text-slate-400">
                                      {req().method} {req().url}
                                    </span>
                                  )}
                                </Show>
                                <Show when={s.response}>
                                  {(res) => <span class="text-slate-400">→ {res().status}</span>}
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
        </Show>
      </section>
    </div>
  );
};
