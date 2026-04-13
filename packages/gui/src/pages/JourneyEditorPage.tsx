import { createResource, createSignal, For, Show, type Component } from "solid-js";
import { api } from "../api/client";

const SKELETON = (name: string) => `import { journey, step, expect } from "@journey/core";

journey(${JSON.stringify(name)}, () => {
  step("first step", {
    endpoint: { method: "GET", path: "/" },
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});
`;

/**
 * Best-effort structured preview. Regex-based and only surfaces fields we can
 * read without running the user's TS — anything dynamic (lazy headers/body
 * referring to closure state) won't appear.
 */
function parseSteps(source: string): Array<{ name: string; endpoint?: string }> {
  const steps: Array<{ name: string; endpoint?: string }> = [];
  const re = /step\(\s*"([^"]+)"\s*,\s*\{([\s\S]*?)\n\s*\}\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const inner = m[2] ?? "";
    const epMatch = inner.match(/endpoint:\s*([^,\n]+)/);
    steps.push({ name: m[1]!, ...(epMatch ? { endpoint: epMatch[1]!.trim() } : {}) });
  }
  return steps;
}

export const JourneyEditorPage: Component = () => {
  const [list, { refetch: refetchList }] = createResource(api.getJourneys);
  const [selected, setSelected] = createSignal<string | undefined>(undefined);
  const [source, setSource] = createSignal("");
  const [status, setStatus] = createSignal<string | undefined>(undefined);

  const open = async (file: string) => {
    setSelected(file);
    setStatus(undefined);
    const res = await api.getJourneySource(file);
    setSource(res.source);
  };

  const save = async () => {
    const file = selected();
    if (!file) return;
    try {
      await api.saveJourneySource(file, source());
      setStatus("Saved.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const create = async () => {
    const input = globalThis.prompt("New journey name (e.g. 'create payment'):");
    if (!input) return;
    const slug = input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    if (!slug) return;
    const file = `${slug}.journey.ts`;
    await api.saveJourneySource(file, SKELETON(input));
    await refetchList();
    await open(file);
  };

  const remove = async () => {
    const file = selected();
    if (!file) return;
    if (!globalThis.confirm(`Delete ${file}?`)) return;
    await api.deleteJourney(file);
    setSelected(undefined);
    setSource("");
    await refetchList();
  };

  return (
    <div class="grid grid-cols-[20rem_1fr] gap-6 h-full">
      <aside>
        <div class="flex items-center justify-between mb-3">
          <h1 class="text-xl font-semibold">Editor</h1>
          <button
            type="button"
            class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sm"
            onClick={() => void create()}
            data-testid="new-journey"
          >
            + New
          </button>
        </div>
        <Show when={list()}>
          {(l) => (
            <ul class="space-y-0.5" data-testid="journey-file-list">
              <For each={l().files} fallback={<p class="text-slate-500 text-sm">Empty.</p>}>
                {(file) => (
                  <li>
                    <button
                      type="button"
                      class="w-full text-left px-2 py-1 rounded hover:bg-slate-800 font-mono text-xs"
                      classList={{ "bg-slate-800": selected() === file }}
                      onClick={() => void open(file)}
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
      <section class="min-w-0 flex flex-col gap-3">
        <Show
          when={selected()}
          fallback={<p class="text-slate-400">Pick a file or create a new one.</p>}
        >
          <div class="font-mono text-sm">{selected()}</div>
          <textarea
            class="flex-1 bg-slate-900 border border-slate-700 rounded p-2 font-mono text-sm min-h-[18rem]"
            data-testid="source-editor"
            value={source()}
            onInput={(e) => setSource(e.currentTarget.value)}
          />
          <div class="flex gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-700 text-white text-sm"
              onClick={() => void save()}
              data-testid="save-journey"
            >
              Save
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded bg-rose-900 hover:bg-rose-800 text-rose-100 text-sm"
              onClick={() => void remove()}
            >
              Delete
            </button>
          </div>
          <Show when={status()}>
            <p class="text-sm text-slate-400" data-testid="editor-status">
              {status()}
            </p>
          </Show>
          <section class="border border-slate-800 rounded p-3">
            <h3 class="text-xs uppercase tracking-wider text-slate-500 mb-2">Parsed steps</h3>
            <ul class="font-mono text-xs space-y-1" data-testid="parsed-steps">
              <For
                each={parseSteps(source())}
                fallback={<li class="text-slate-500">No steps detected.</li>}
              >
                {(s) => (
                  <li>
                    <span class="text-slate-200">{s.name}</span>
                    <Show when={s.endpoint}>
                      <span class="text-slate-500"> → {s.endpoint}</span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>
      </section>
    </div>
  );
};
