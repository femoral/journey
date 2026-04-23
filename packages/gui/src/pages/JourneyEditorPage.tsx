import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  type Accessor,
  type Component,
  type JSX,
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
import {
  IconDot,
  IconEditor,
  IconLayers,
  IconPlay,
  IconPlus,
  MiniTab,
  SegBtn,
  TsHighlight,
} from "../ui";

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
    let braces = 1;
    let i = stepStart + m[0].length;
    while (i < source.length && braces > 0) {
      if (source[i] === "{") braces++;
      else if (source[i] === "}") braces--;
      i++;
    }
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
  const first = steps[0]!;
  const last = steps[steps.length - 1]!;
  const before = source.slice(0, first.start);
  const after = source.slice(last.end);
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
  active: boolean;
  index: number;
  onClick: () => void;
}> = (props) => {
  const sortable = createSortable(props.id);
  return (
    <li
      ref={sortable.ref}
      onClick={props.onClick}
      data-testid={`editor-step-${props.index}`}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        padding: "8px 10px",
        "margin-bottom": "3px",
        background: props.active ? "var(--bg-3)" : "var(--bg-1)",
        border: `1px solid ${props.active ? "var(--ac-bd)" : "var(--bd-1)"}`,
        "border-radius": "4px",
        cursor: "grab",
        opacity: sortable.isActiveDraggable ? 0.4 : 1,
      }}
      {...sortable.dragActivators}
    >
      <DragHandle />
      <span
        class="mono"
        style={{
          "font-size": "10px",
          color: "var(--fg-3)",
          width: "18px",
          "text-align": "right",
        }}
      >
        {props.index + 1}
      </span>
      <span
        style={{
          "font-size": "12px",
          color: "var(--fg-0)",
          flex: 1,
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
        }}
      >
        {props.step.name}
      </span>
      <Show when={props.step.endpoint}>
        <span
          class="mono"
          style={{
            "font-size": "10px",
            color: "var(--fg-3)",
            "max-width": "12rem",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          → {props.step.endpoint}
        </span>
      </Show>
    </li>
  );
};

function DragHandle(): JSX.Element {
  return (
    <svg
      width="8"
      height="14"
      viewBox="0 0 8 14"
      style={{ "flex-shrink": 0 }}
      aria-hidden="true"
    >
      {[0, 4, 8, 12].map((y) => (
        <g>
          <circle cx="2" cy={y + 1} r="0.8" fill="var(--fg-3)" />
          <circle cx="6" cy={y + 1} r="0.8" fill="var(--fg-3)" />
        </g>
      ))}
    </svg>
  );
}

type ViewMode = "Visual" | "Source";

export const JourneyEditorPage: Component = () => {
  const [list, { refetch: refetchList }] = createResource(api.getJourneys);
  const [selected, setSelected] = createSignal<string | undefined>(undefined);
  const [source, setSource] = createSignal("");
  const [originalSource, setOriginalSource] = createSignal("");
  const [status, setStatus] = createSignal<string | undefined>(undefined);
  const [mode, setMode] = createSignal<ViewMode>("Source");
  const [activeStep, setActiveStep] = createSignal(0);

  const parsedSteps = createMemo(() => parseSteps(source()));
  const stepIds = () => parsedSteps().map((_, i) => String(i));
  const dirty = () => source() !== originalSource() && selected() !== undefined;

  const open = async (file: string) => {
    setSelected(file);
    setStatus(undefined);
    setActiveStep(0);
    const res = await api.getJourneySource(file);
    setSource(res.source);
    setOriginalSource(res.source);
  };

  const save = async () => {
    const file = selected();
    if (!file) return;
    try {
      await api.saveJourneySource(file, source());
      setOriginalSource(source());
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
    setOriginalSource("");
    await refetchList();
  };

  const onDragEnd = (event: {
    draggable: { id: string | number };
    droppable?: { id: string | number } | null;
  }) => {
    if (!event.droppable || event.draggable.id === event.droppable.id) return;
    const steps = parsedSteps();
    const from = steps.findIndex((_, i) => String(i) === String(event.draggable.id));
    const to = steps.findIndex((_, i) => String(i) === String(event.droppable!.id));
    if (from === -1 || to === -1) return;
    setSource(reorderSource(source(), steps, from, to));
  };

  return (
    <div
      style={{ display: "flex", height: "100%", "min-height": 0 }}
      data-testid="editor-page"
    >
      <aside
        style={{
          width: "240px",
          "border-right": "1px solid var(--bd-1)",
          display: "flex",
          "flex-direction": "column",
          background: "var(--bg-0)",
          "flex-shrink": 0,
        }}
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            padding: "10px 14px",
            "border-bottom": "1px solid var(--bd-1)",
          }}
        >
          <span
            style={{
              "font-size": "10px",
              color: "var(--fg-3)",
              "text-transform": "uppercase",
              "letter-spacing": "0.08em",
            }}
          >
            Journeys
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            data-testid="new-journey"
            onClick={() => void create()}
            style={{
              "font-size": "11px",
              color: "var(--ac)",
              display: "flex",
              "align-items": "center",
              gap: "4px",
            }}
          >
            <IconPlus size={11} /> New
          </button>
        </div>
        <Show when={list()}>
          {(l: Accessor<{ files: string[] }>) => (
            <div
              style={{ flex: 1, overflow: "auto", padding: "6px 6px" }}
              data-testid="journey-file-list"
            >
              <For
                each={l().files}
                fallback={
                  <div
                    style={{
                      padding: "12px 10px",
                      "font-size": "12px",
                      color: "var(--fg-3)",
                    }}
                  >
                    Empty.
                  </div>
                }
              >
                {(file) => {
                  const active = () => selected() === file;
                  return (
                    <button
                      type="button"
                      onClick={() => void open(file)}
                      class="mono"
                      style={{
                        width: "100%",
                        "text-align": "left",
                        padding: "6px 10px",
                        "border-radius": "4px",
                        "font-size": "12px",
                        background: active() ? "var(--bg-3)" : "transparent",
                        "border-left": active()
                          ? "2px solid var(--ac)"
                          : "2px solid transparent",
                        color: "var(--fg-1)",
                      }}
                      onMouseEnter={(e) => {
                        if (!active())
                          (e.currentTarget as HTMLElement).style.background =
                            "var(--bg-1)";
                      }}
                      onMouseLeave={(e) => {
                        if (!active())
                          (e.currentTarget as HTMLElement).style.background =
                            "transparent";
                      }}
                    >
                      {file}
                    </button>
                  );
                }}
              </For>
            </div>
          )}
        </Show>
      </aside>

      <section
        style={{
          flex: 1,
          "min-width": 0,
          display: "flex",
          "flex-direction": "column",
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
              Pick a file or create a new one.
            </div>
          }
        >
          <Header
            file={selected()!}
            mode={mode()}
            dirty={dirty()}
            status={status()}
            onModeChange={setMode}
            onSave={() => void save()}
            onDelete={() => void remove()}
          />
          <div style={{ flex: 1, display: "flex", "min-height": 0 }}>
            <StepListPane
              steps={parsedSteps()}
              ids={stepIds()}
              active={activeStep()}
              onSelect={setActiveStep}
              onDragEnd={onDragEnd}
            />
            <Show when={mode() === "Visual"} fallback={<SourceView source={source()} onInput={setSource} />}>
              <Inspector step={parsedSteps()[activeStep()]} />
            </Show>
          </div>
        </Show>
      </section>
    </div>
  );
};

function Header(props: {
  file: string;
  mode: ViewMode;
  dirty: boolean;
  status: string | undefined;
  onModeChange: (m: ViewMode) => void;
  onSave: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "10px",
        padding: "10px 16px",
        "border-bottom": "1px solid var(--bd-1)",
        "flex-shrink": 0,
      }}
    >
      <IconEditor size={14} style={{ color: "var(--ac)" }} />
      <span class="mono" style={{ "font-size": "13px", "font-weight": 500 }}>
        journeys/{props.file}
      </span>
      <Show when={props.dirty}>
        <span
          class="mono"
          style={{
            "font-size": "10px",
            color: "var(--ac)",
            background: "var(--ac-bg)",
            padding: "1px 6px",
            "border-radius": "2px",
          }}
        >
          modified
        </span>
      </Show>
      <Show when={props.status}>
        <span
          class="mono"
          data-testid="editor-status"
          style={{
            "font-size": "11px",
            color: props.status?.startsWith("Saved") ? "var(--ok)" : "var(--err)",
          }}
        >
          {props.status}
        </span>
      </Show>
      <div style={{ flex: 1 }} />
      <SegBtn<ViewMode>
        options={["Visual", "Source"] as const}
        value={props.mode}
        onChange={props.onModeChange}
      />
      <button
        type="button"
        title="Run journey (visit Journeys page)"
        disabled
        style={{
          padding: "5px 10px",
          border: "1px solid var(--bd-2)",
          "border-radius": "4px",
          "font-size": "11px",
          color: "var(--fg-2)",
          display: "flex",
          "align-items": "center",
          gap: "5px",
          opacity: 0.5,
          cursor: "not-allowed",
        }}
      >
        <IconPlay size={11} /> Run
      </button>
      <button
        type="button"
        onClick={props.onDelete}
        style={{
          padding: "5px 10px",
          border: "1px solid var(--bd-2)",
          "border-radius": "4px",
          "font-size": "11px",
          color: "var(--err)",
        }}
      >
        Delete
      </button>
      <button
        type="button"
        data-testid="save-journey"
        onClick={props.onSave}
        style={{
          padding: "5px 12px",
          background: "var(--ac)",
          color: "#1a1200",
          "border-radius": "4px",
          "font-size": "11px",
          "font-weight": 600,
        }}
      >
        Save
      </button>
    </div>
  );
}

function StepListPane(props: {
  steps: ParsedStep[];
  ids: string[];
  active: number;
  onSelect: (i: number) => void;
  onDragEnd: (event: {
    draggable: { id: string | number };
    droppable?: { id: string | number } | null;
  }) => void;
}): JSX.Element {
  return (
    <div
      style={{
        width: "320px",
        "border-right": "1px solid var(--bd-1)",
        display: "flex",
        "flex-direction": "column",
        background: "var(--bg-0)",
        overflow: "hidden",
        "flex-shrink": 0,
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          display: "flex",
          "align-items": "center",
          "border-bottom": "1px solid var(--bd-1)",
        }}
      >
        <span
          style={{
            "font-size": "10px",
            color: "var(--fg-3)",
            "text-transform": "uppercase",
            "letter-spacing": "0.08em",
          }}
        >
          Steps · {props.steps.length}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          disabled
          title="Add step (M6)"
          style={{
            "font-size": "11px",
            color: "var(--fg-3)",
            display: "flex",
            "align-items": "center",
            gap: "4px",
            opacity: 0.5,
            cursor: "not-allowed",
          }}
        >
          <IconPlus size={11} /> Add step
        </button>
      </div>
      <div
        style={{ flex: 1, overflow: "auto", padding: "6px 10px 10px" }}
      >
        <Show
          when={props.steps.length > 0}
          fallback={
            <div
              data-testid="no-steps"
              style={{
                "font-size": "11px",
                color: "var(--fg-3)",
                padding: "8px 4px",
              }}
            >
              No steps detected.
            </div>
          }
        >
          <DragDropProvider onDragEnd={props.onDragEnd} collisionDetector={closestCenter}>
            <DragDropSensors />
            <SortableProvider ids={props.ids}>
              <ul
                data-testid="parsed-steps"
                style={{
                  margin: 0,
                  padding: 0,
                  "list-style": "none",
                  display: "flex",
                  "flex-direction": "column",
                }}
              >
                <For each={props.steps}>
                  {(s, i) => (
                    <StepItem
                      step={s}
                      id={String(i())}
                      index={i()}
                      active={i() === props.active}
                      onClick={() => props.onSelect(i())}
                    />
                  )}
                </For>
              </ul>
            </SortableProvider>
            <DragOverlay>
              <div
                style={{
                  padding: "8px 10px",
                  "border-radius": "4px",
                  background: "var(--ac-bg)",
                  border: "1px solid var(--ac-bd)",
                  color: "var(--ac)",
                  "font-size": "12px",
                }}
              >
                Moving…
              </div>
            </DragOverlay>
          </DragDropProvider>
        </Show>
      </div>
    </div>
  );
}

type InspectorTab = "Config" | "Assertions" | "Extract" | "Hooks";

function Inspector(props: { step: ParsedStep | undefined }): JSX.Element {
  const [tab, setTab] = createSignal<InspectorTab>("Config");
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        "flex-direction": "column",
        "min-width": 0,
      }}
    >
      <Show
        when={props.step}
        fallback={
          <div
            style={{
              flex: 1,
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              color: "var(--fg-3)",
              "font-size": "12px",
            }}
          >
            Pick a step on the left.
          </div>
        }
      >
        {(s) => (
          <>
            <div
              style={{
                padding: "10px 16px",
                "border-bottom": "1px solid var(--bd-1)",
                display: "flex",
                "flex-direction": "column",
                gap: "4px",
              }}
            >
              <span
                style={{ "font-size": "12px", color: "var(--fg-2)" }}
              >
                Selected step
              </span>
              <span
                style={{ "font-size": "16px", "font-weight": 600, color: "var(--fg-0)" }}
              >
                {s().name}
              </span>
              <Show when={s().endpoint}>
                <span class="mono" style={{ "font-size": "11px", color: "var(--fg-3)" }}>
                  → {s().endpoint}
                </span>
              </Show>
            </div>
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "padding-left": "12px",
                "border-bottom": "1px solid var(--bd-1)",
                "flex-shrink": 0,
              }}
              role="tablist"
            >
              {(
                ["Config", "Assertions", "Extract", "Hooks"] as InspectorTab[]
              ).map((id) => (
                <MiniTab
                  active={tab() === id}
                  onClick={() => setTab(id)}
                  label={id}
                />
              ))}
            </div>
            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "16px 18px",
                "font-size": "12px",
                color: "var(--fg-2)",
              }}
            >
              <Show when={tab() === "Config"}>
                <p style={{ margin: 0 }}>
                  Inline editing of step config (endpoint, headers, body) ships with the
                  visual step builder in M6f. For now, switch to{" "}
                  <span style={{ color: "var(--ac)" }}>Source</span> mode to edit raw TS.
                </p>
              </Show>
              <Show when={tab() === "Assertions"}>
                <p style={{ margin: 0 }}>
                  Assertion picker (status, JSON-path, regex) ships in M6.
                </p>
              </Show>
              <Show when={tab() === "Extract"}>
                <p style={{ margin: 0 }}>
                  Extraction helpers (closure variables, response paths) ship in M6.
                </p>
              </Show>
              <Show when={tab() === "Hooks"}>
                <p style={{ margin: 0 }}>
                  Pre/post script editors ship in M6e.
                </p>
              </Show>
              <div
                style={{
                  "margin-top": "16px",
                  padding: "10px 12px",
                  border: "1px solid var(--bd-1)",
                  "border-radius": "4px",
                  background: "var(--bg-1)",
                  display: "flex",
                  "flex-direction": "column",
                  gap: "6px",
                }}
              >
                <span
                  style={{
                    "font-size": "10px",
                    color: "var(--fg-3)",
                    "text-transform": "uppercase",
                    "letter-spacing": "0.08em",
                  }}
                >
                  Closure variables
                </span>
                <span
                  class="mono"
                  style={{
                    "font-size": "11px",
                    color: "var(--fg-3)",
                    display: "flex",
                    "align-items": "center",
                    gap: "6px",
                  }}
                >
                  <IconDot size={8} style={{ color: "var(--ac)" }} />
                  Tracked when the variable graph lands in M6f.
                </span>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

function SourceView(props: {
  source: string;
  onInput: (s: string) => void;
}): JSX.Element {
  let preEl: HTMLPreElement | undefined;
  const syncScroll = (ta: HTMLTextAreaElement) => {
    if (!preEl) return;
    preEl.scrollTop = ta.scrollTop;
    preEl.scrollLeft = ta.scrollLeft;
  };
  // Shared layout for both overlay pre and the editable textarea. Any drift here
  // (padding, font, wrapping) breaks cursor/highlight alignment — keep in sync.
  const sharedLayout = {
    margin: 0,
    padding: "14px 18px",
    "font-size": "12px",
    "font-family": "var(--ff-mono)",
    "line-height": 1.7,
    "white-space": "pre-wrap",
    "word-break": "break-word",
    "tab-size": 2,
  } as const;
  return (
    <div
      style={{
        flex: 1,
        "min-width": 0,
        position: "relative",
        display: "flex",
        "flex-direction": "column",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "6px 16px",
          "border-bottom": "1px solid var(--bd-1)",
          "font-size": "10px",
          color: "var(--fg-3)",
          "text-transform": "uppercase",
          "letter-spacing": "0.08em",
          "flex-shrink": 0,
        }}
      >
        <IconLayers size={11} />
        <span>Source</span>
      </div>
      <div style={{ flex: 1, position: "relative", "min-height": 0 }}>
        <pre
          ref={preEl}
          aria-hidden="true"
          style={{
            ...sharedLayout,
            position: "absolute",
            inset: 0,
            color: "var(--fg-1)",
            "pointer-events": "none",
            overflow: "hidden",
          }}
        >
          <TsHighlight text={props.source} />
          {/* Trailing newline so the last line scrolls into view like a real editor. */}
          {"\n"}
        </pre>
        <textarea
          data-testid="source-editor"
          value={props.source}
          onInput={(e) => {
            props.onInput(e.currentTarget.value);
            syncScroll(e.currentTarget);
          }}
          onScroll={(e) => syncScroll(e.currentTarget)}
          spellcheck={false}
          style={{
            ...sharedLayout,
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            color: "transparent",
            "caret-color": "var(--fg-0)",
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "none",
            overflow: "auto",
          }}
        />
      </div>
    </div>
  );
}

export { parseSteps, reorderSource };
