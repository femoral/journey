import { createResource, For, Show, type Component } from "solid-js";
import { api, type TreeNode } from "../api/client";

const Node: Component<{ node: TreeNode; depth: number }> = (props) => {
  const indent = `${props.depth * 1.25}rem`;
  return (
    <li>
      <div
        class="font-mono text-sm py-0.5"
        style={{ "padding-left": indent }}
        data-testid={`tree-${props.node.type}`}
      >
        <span class="text-slate-500 mr-2">{props.node.type === "dir" ? "▸" : "·"}</span>
        <span class={props.node.type === "dir" ? "text-brand-500" : "text-slate-200"}>
          {props.node.name}
        </span>
      </div>
      <Show when={props.node.children && props.node.children.length > 0}>
        <ul>
          <For each={props.node.children}>
            {(child) => <Node node={child} depth={props.depth + 1} />}
          </For>
        </ul>
      </Show>
    </li>
  );
};

export const FilesPage: Component = () => {
  const [tree] = createResource(api.getTree);
  return (
    <div>
      <h1 class="text-2xl font-semibold mb-4">Files</h1>
      <Show when={tree.loading}>
        <p class="text-slate-400">Loading…</p>
      </Show>
      <Show when={tree()}>
        {(t) => (
          <div class="space-y-6">
            <For each={t().sections}>
              {(section) => (
                <section>
                  <h2 class="text-sm uppercase tracking-wider text-slate-500 mb-2">
                    {section.label}
                  </h2>
                  <Show
                    when={section.children.length > 0}
                    fallback={<p class="text-slate-500 text-sm">empty</p>}
                  >
                    <ul data-testid={`section-${section.label}`}>
                      <For each={section.children}>
                        {(node) => <Node node={node} depth={0} />}
                      </For>
                    </ul>
                  </Show>
                </section>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  );
};
