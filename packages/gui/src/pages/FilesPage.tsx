import {
  For,
  Show,
  createResource,
  createSignal,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js";
import { api, type ProjectTree, type TreeNode } from "../api/client";
import {
  IconChevron,
  IconFiles,
  IconFolder,
  IconX,
  JsonPretty,
  TsHighlight,
} from "../ui";

type SelectedFile = {
  section: string;
  relPath: string;
};

export const FilesPage: Component = () => {
  const [tree] = createResource(api.getTree);
  const [selected, setSelected] = createSignal<SelectedFile | undefined>(undefined);

  return (
    <div
      style={{ display: "flex", height: "100%", "min-height": 0 }}
      data-testid="files-page"
    >
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
            Project tree
          </span>
          <div style={{ flex: 1 }} />
          <span
            class="mono"
            style={{ "font-size": "10px", color: "var(--fg-3)" }}
          >
            {tree()?.projectDir ?? ""}
          </span>
        </div>
        <Show when={tree.loading}>
          <div
            style={{
              padding: "14px",
              "font-size": "12px",
              color: "var(--fg-3)",
            }}
          >
            Loading…
          </div>
        </Show>
        <Show when={tree()}>
          {(t) => (
            <div style={{ flex: 1, overflow: "auto", padding: "6px 0" }}>
              <For each={t().sections}>
                {(section) => (
                  <SectionNode
                    section={section}
                    selected={selected()}
                    onSelect={(rel) =>
                      setSelected({ section: section.label, relPath: rel })
                    }
                  />
                )}
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
              Pick a file to preview its contents.
            </div>
          }
        >
          {(s: Accessor<SelectedFile>) => <FilePreview file={s()} />}
        </Show>
      </section>
    </div>
  );
};

function SectionNode(props: {
  section: ProjectTree["sections"][number];
  selected: SelectedFile | undefined;
  onSelect: (relPath: string) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(true);
  const locked = () => props.section.label === "generated";

  return (
    <div data-testid={`section-${props.section.label}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          "align-items": "center",
          gap: "6px",
          padding: "4px 10px",
          "text-align": "left",
          "font-size": "12px",
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLElement).style.background = "var(--bg-1)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLElement).style.background = "transparent")
        }
      >
        <IconChevron
          size={9}
          style={{
            color: "var(--fg-3)",
            transform: open() ? "rotate(90deg)" : "none",
            transition: "transform 0.1s",
          }}
        />
        <IconFolder
          size={13}
          style={{ color: locked() ? "var(--fg-3)" : "var(--ac)" }}
        />
        <span class="mono" style={{ color: "var(--fg-0)", "font-weight": 500 }}>
          {props.section.label}/
        </span>
        <Show when={locked()}>
          <span
            class="mono"
            style={{
              "font-size": "10px",
              color: "var(--fg-3)",
              "margin-left": "4px",
            }}
          >
            generated — don't edit
          </span>
        </Show>
      </button>
      <Show when={open()}>
        <Show
          when={props.section.children.length > 0}
          fallback={
            <div
              style={{
                padding: "4px 10px 4px 36px",
                "font-size": "11px",
                color: "var(--fg-3)",
              }}
            >
              empty
            </div>
          }
        >
          <For each={props.section.children}>
            {(node) => (
              <TreeEntry
                node={node}
                parentRel=""
                depth={1}
                locked={locked()}
                selected={props.selected}
                sectionLabel={props.section.label}
                onSelect={props.onSelect}
              />
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}

function TreeEntry(props: {
  node: TreeNode;
  parentRel: string;
  depth: number;
  locked: boolean;
  selected: SelectedFile | undefined;
  sectionLabel: string;
  onSelect: (relPath: string) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(props.depth < 2);
  const rel = () =>
    props.parentRel ? `${props.parentRel}/${props.node.name}` : props.node.name;

  const active = () =>
    props.selected?.section === props.sectionLabel &&
    props.selected?.relPath === rel();

  if (props.node.type === "dir") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            "align-items": "center",
            gap: "6px",
            padding: `4px 10px 4px ${10 + props.depth * 14}px`,
            "text-align": "left",
            "font-size": "12px",
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLElement).style.background = "var(--bg-1)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLElement).style.background = "transparent")
          }
        >
          <IconChevron
            size={9}
            style={{
              color: "var(--fg-3)",
              transform: open() ? "rotate(90deg)" : "none",
              transition: "transform 0.1s",
            }}
          />
          <IconFolder
            size={13}
            style={{ color: props.locked ? "var(--fg-3)" : "var(--ac)" }}
          />
          <span class="mono" style={{ color: "var(--fg-0)" }}>
            {props.node.name}/
          </span>
        </button>
        <Show when={open() && props.node.children}>
          <For each={props.node.children}>
            {(child) => (
              <TreeEntry
                node={child}
                parentRel={rel()}
                depth={props.depth + 1}
                locked={props.locked}
                selected={props.selected}
                sectionLabel={props.sectionLabel}
                onSelect={props.onSelect}
              />
            )}
          </For>
        </Show>
      </>
    );
  }
  return (
    <button
      type="button"
      onClick={() => props.onSelect(rel())}
      data-testid={`tree-file-${rel()}`}
      style={{
        width: "100%",
        display: "flex",
        "align-items": "center",
        gap: "6px",
        padding: `4px 10px 4px ${22 + props.depth * 14}px`,
        "text-align": "left",
        "font-size": "12px",
        background: active() ? "var(--bg-3)" : "transparent",
        "border-left": active()
          ? "2px solid var(--ac)"
          : "2px solid transparent",
        opacity: props.locked ? 0.7 : 1,
      }}
      onMouseEnter={(e) => {
        if (!active())
          (e.currentTarget as HTMLElement).style.background = "var(--bg-1)";
      }}
      onMouseLeave={(e) => {
        if (!active())
          (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <IconFiles size={12} style={{ color: "var(--fg-3)" }} />
      <span
        class="mono"
        style={{
          color: active() ? "var(--fg-0)" : "var(--fg-1)",
          flex: 1,
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
        }}
      >
        {props.node.name}
      </span>
      <Show when={props.locked}>
        <span
          class="mono"
          style={{ "font-size": "9px", color: "var(--fg-3)" }}
        >
          generated
        </span>
      </Show>
    </button>
  );
}

function FilePreview(props: { file: SelectedFile }): JSX.Element {
  const locked = () => props.file.section === "generated";
  const name = () => props.file.relPath.split("/").pop() ?? props.file.relPath;
  const isJson = () => /\.(json|ya?ml)$/.test(name());
  const displayPath = () => `${props.file.section}/${props.file.relPath}`;

  const [content] = createResource(
    () => props.file,
    async (f) => {
      if (f.section === "journeys" && /\.journey\.ts$/.test(f.relPath)) {
        try {
          const r = await api.getJourneySource(f.relPath);
          return r.source;
        } catch (e) {
          return `// failed to load: ${errorMessage(e)}`;
        }
      }
      if (f.section === "environments" && /\.json$/.test(f.relPath)) {
        const envName = f.relPath.replace(/\.json$/, "");
        try {
          const envs = await api.getEnvironments();
          const env = envs.environments.find((e) => e.name === envName);
          if (!env) return `// environment "${envName}" not found`;
          return JSON.stringify(env.values, null, 2);
        } catch (e) {
          return `// failed to load: ${errorMessage(e)}`;
        }
      }
      return `// ${f.section}/${f.relPath}\n// Preview of this file type ships in a later milestone.`;
    },
  );

  return (
    <>
      <div
        style={{
          padding: "10px 18px",
          "border-bottom": "1px solid var(--bd-1)",
          display: "flex",
          "align-items": "center",
          gap: "10px",
          "flex-shrink": 0,
        }}
      >
        <IconFiles size={13} style={{ color: "var(--fg-2)" }} />
        <span class="mono" style={{ "font-size": "13px" }}>
          {displayPath()}
        </span>
        <Show when={locked()}>
          <div
            class="mono"
            style={{
              display: "flex",
              "align-items": "center",
              gap: "5px",
              padding: "2px 8px",
              background: "var(--warn-bg)",
              color: "var(--warn)",
              border: "1px solid var(--warn)",
              "border-radius": "3px",
              "font-size": "10px",
            }}
          >
            <IconX size={10} /> read-only · regenerated by{" "}
            <span style={{ color: "var(--ac)" }}>journey generate</span>
          </div>
        </Show>
        <div style={{ flex: 1 }} />
      </div>
      <pre
        class="mono"
        style={{
          margin: 0,
          padding: "14px 18px",
          "font-size": "12px",
          "line-height": 1.7,
          color: "var(--fg-1)",
          flex: 1,
          overflow: "auto",
          "white-space": "pre-wrap",
          "word-break": "break-word",
        }}
      >
        <Show when={content.loading}>
          <span style={{ color: "var(--fg-3)" }}>Loading…</span>
        </Show>
        <Show when={content()}>
          <Show when={isJson()} fallback={<TsHighlight text={content() ?? ""} />}>
            <JsonPretty text={content() ?? ""} />
          </Show>
        </Show>
      </pre>
    </>
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
