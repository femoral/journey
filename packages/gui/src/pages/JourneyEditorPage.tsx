import {
  createResource,
  createSignal,
  For,
  Show,
  type Accessor,
  type Component,
} from "solid-js";
import {
  closestCenter,
  createSortable,
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
} from "@thisbeyond/solid-dnd";
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

interface ParsedStep {
  name: string;
  endpoint?: string;
  start: number;
  end: number;
}

/**
 * Regex-based step extraction with character offsets into the source string.
 * Uses a balanced-brace counter to find each step's closing brace, which is
 * more robust than the original `\n\s*\}\s*\)` approach for nested code.
 */
function parseSteps(source: string): ParsedStep[] {
  const steps: ParsedStep[] = [];
  const re = /step\(\s*"([^"]+)"\s*,\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const stepStart = m.index;
    const name = m[1]!;
    // Find the matching closing `});` by counting braces from after the `{`.
    let braces = 1;
    let i = stepStart + m[0].length;
    while (i < source.length && braces > 0) {
      if (source[i] === "{") braces++;
      else if (source[i] === "}") braces--;
      i++;
    }
    // Advance past `);` — typically `});` immediately follows.
    if (source[i] === ")") i++;
    if (source[i] === ";") i++;
    const stepEnd = i;
    const inner = source.slice(stepStart, stepEnd);
    const epMatch = inner.match(/endpoint:\s*([^,\n]+)/);
    const entry: ParsedStep = { name, start: stepStart, end: stepEnd };
    if (epMatch) entry.endpoint = epMatch[1]!.trim();
    steps.push(entry);
  }
  return steps;
}

function reorderSource(source: string, steps: ParsedStep[], from: number, to: number): string {
  if (from === to) return source;
  const ordered = steps.slice();
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved!);
  // Rebuild source by replacing the region spanning all steps.
  const first = steps[0]!;
  const last = steps[steps.length - 1]!;
  const before = source.slice(0, first.start);
  const after = source.slice(last.end);
  // Preserve whitespace between steps: grab the gap that followed each step
  // in the original source (the chars between one step's end and the next's start).
  const gaps: string[] = [];
  for (let g = 0; g < steps.length - 1; g++) {
    gaps.push(source.slice(steps[g]!.end, steps[g + 1]!.start));
  }
  let mid = "";
  for (let g = 0; g < ordered.length; g++) {
    mid += source.slice(ordered[g]!.start, ordered[g]!.end);
    if (g < ordered.length - 1) mid += gaps[Math.min(g, gaps.length - 1)] ?? "\n\n";
  }
  return before + mid + after;
}

const StepItem: Component<{
  step: ParsedStep;
  id: string;
}> = (props) => {
  const sortable = createSortable(props.id);
  return (
    <li
      ref={sortable.ref}
      class="flex items-center gap-2 px-2 py-1 rounded cursor-grab bg-slate-900 border border-slate-800"
      classList={{ "opacity-50": sortable.isActiveDraggable }}
      {...sortable.dragActivators}
    >
      <span class="text-slate-500 text-xs">⠿</span>
      <span class="text-slate-200 text-sm">{props.step.name}</span>
      <Show when={props.step.endpoint}>
        <span class="text-slate-500 text-xs ml-auto truncate max-w-[12rem]">
          → {props.step.endpoint}
        </span>
      </Show>
    </li>
  );
};

export const JourneyEditorPage: Component = () => {
  const [list, { refetch: refetchList }] = createResource(api.getJourneys);
  const [selected, setSelected] = createSignal<string | undefined>(undefined);
  const [source, setSource] = createSignal("");
  const [status, setStatus] = createSignal<string | undefined>(undefined);

  const parsedSteps = () => parseSteps(source());
  const stepIds = () => parsedSteps().map((_, i) => String(i));

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

  const onDragEnd = (event: { draggable: { id: string | number }; droppable?: { id: string | number } | null }) => {
    if (!event.droppable || event.draggable.id === event.droppable.id) return;
    const steps = parsedSteps();
    const from = steps.findIndex((_, i) => String(i) === String(event.draggable.id));
    const to = steps.findIndex((_, i) => String(i) === String(event.droppable!.id));
    if (from === -1 || to === -1) return;
    setSource(reorderSource(source(), steps, from, to));
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
          {(l: Accessor<{ files: string[] }>) => (
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
            <h3 class="text-xs uppercase tracking-wider text-slate-500 mb-2">
              Steps (drag to reorder)
            </h3>
            <Show
              when={parsedSteps().length > 0}
              fallback={
                <p class="text-slate-500 text-xs" data-testid="no-steps">
                  No steps detected.
                </p>
              }
            >
              <DragDropProvider onDragEnd={onDragEnd} collisionDetector={closestCenter}>
                <DragDropSensors />
                <SortableProvider ids={stepIds()}>
                  <ul class="space-y-1" data-testid="parsed-steps">
                    <For each={parsedSteps()}>
                      {(s, i) => <StepItem step={s} id={String(i())} />}
                    </For>
                  </ul>
                </SortableProvider>
                <DragOverlay>
                  <div class="px-2 py-1 rounded bg-brand-600/20 border border-brand-500 text-sm text-brand-500">
                    Moving…
                  </div>
                </DragOverlay>
              </DragDropProvider>
            </Show>
          </section>
        </Show>
      </section>
    </div>
  );
};

export { parseSteps, reorderSource };
