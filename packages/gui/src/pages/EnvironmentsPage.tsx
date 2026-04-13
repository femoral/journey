import { createResource, createSignal, For, Show, type Component } from "solid-js";
import { api, type Environment } from "../api/client";

function isSecretKey(key: string): boolean {
  return /(pass|secret|token|key)/i.test(key);
}

export const EnvironmentsPage: Component = () => {
  const [data, { refetch }] = createResource(api.getEnvironments);
  const [selectedName, setSelectedName] = createSignal<string | undefined>(undefined);
  const [draft, setDraft] = createSignal<Array<[string, string]>>([]);
  const [status, setStatus] = createSignal<string | undefined>(undefined);

  const loadDraftFor = (env: Environment) => {
    setDraft(Object.entries(env.values));
    setStatus(undefined);
  };

  const save = async () => {
    const name = selectedName();
    if (!name) return;
    const values: Record<string, string> = {};
    for (const [k, v] of draft()) {
      if (k.trim()) values[k] = v;
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

  return (
    <div class="grid grid-cols-[20rem_1fr] gap-6">
      <aside>
        <div class="flex items-center justify-between mb-3">
          <h1 class="text-xl font-semibold">Environments</h1>
          <button
            type="button"
            class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sm"
            onClick={() => void create()}
            data-testid="new-env"
          >
            + New
          </button>
        </div>
        <Show when={data()}>
          {(d) => (
            <ul class="space-y-0.5" data-testid="env-list">
              <For
                each={d().environments}
                fallback={<p class="text-slate-500 text-sm">No environments yet.</p>}
              >
                {(env) => (
                  <li>
                    <button
                      type="button"
                      class="w-full text-left px-2 py-1 rounded hover:bg-slate-800 text-sm"
                      classList={{ "bg-slate-800": selectedName() === env.name }}
                      onClick={() => {
                        setSelectedName(env.name);
                        loadDraftFor(env);
                      }}
                    >
                      {env.name}
                      <Show when={env.name === d().defaultEnvironment}>
                        <span class="text-brand-500 text-xs ml-2">default</span>
                      </Show>
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
          when={selectedName()}
          fallback={<p class="text-slate-400">Select or create an environment.</p>}
        >
          <div class="space-y-3">
            <h2 class="text-lg font-mono" data-testid="env-heading">
              {selectedName()}
            </h2>
            <ul class="space-y-1" data-testid="env-values">
              <For each={draft()}>
                {([k, v], i) => (
                  <li class="flex gap-2 items-center">
                    <input
                      class="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-40 font-mono text-sm"
                      value={k}
                      placeholder="KEY"
                      onInput={(e) => {
                        const copy = draft().slice();
                        const current = copy[i()]!;
                        copy[i()] = [e.currentTarget.value, current[1]];
                        setDraft(copy);
                      }}
                    />
                    <input
                      class="bg-slate-900 border border-slate-700 rounded px-2 py-1 flex-1 font-mono text-sm"
                      type={isSecretKey(k) ? "password" : "text"}
                      value={v}
                      placeholder="value"
                      onInput={(e) => {
                        const copy = draft().slice();
                        const current = copy[i()]!;
                        copy[i()] = [current[0], e.currentTarget.value];
                        setDraft(copy);
                      }}
                    />
                    <button
                      type="button"
                      class="text-slate-500 hover:text-rose-400 text-sm"
                      onClick={() => setDraft(draft().filter((_, idx) => idx !== i()))}
                    >
                      remove
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <div class="flex gap-2">
              <button
                type="button"
                class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sm"
                onClick={() => setDraft([...draft(), ["", ""]])}
                data-testid="add-row"
              >
                + Add row
              </button>
              <button
                type="button"
                class="px-2 py-1 rounded bg-brand-600 hover:bg-brand-700 text-sm text-white"
                onClick={() => void save()}
                data-testid="save-env"
              >
                Save
              </button>
              <button
                type="button"
                class="px-2 py-1 rounded bg-rose-900 hover:bg-rose-800 text-sm text-rose-100"
                onClick={() => void destroy()}
              >
                Delete
              </button>
            </div>
            <Show when={status()}>
              <p class="text-sm text-slate-400" data-testid="env-status">
                {status()}
              </p>
            </Show>
          </div>
        </Show>
      </section>
    </div>
  );
};
