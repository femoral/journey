import { createResource, Show, type Accessor, type Component } from "solid-js";
import { api, type ProjectSummary } from "../api/client";

export const ProjectPage: Component = () => {
  const [project] = createResource(api.getProject);

  return (
    <div>
      <h1 class="text-2xl font-semibold mb-4">Overview</h1>
      <Show when={project.loading}>
        <p class="text-slate-400">Loading…</p>
      </Show>
      <Show when={project.error}>
        <p class="text-red-400" data-testid="error">
          Failed to load project: {(project.error as Error).message}
        </p>
      </Show>
      <Show when={project()}>
        {(p: Accessor<ProjectSummary>) => (
          <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 font-mono text-sm">
            <dt class="text-slate-400">Name</dt>
            <dd data-testid="project-name">{p().config.name ?? "—"}</dd>
            <dt class="text-slate-400">Directory</dt>
            <dd class="text-slate-300">{p().projectDir}</dd>
            <dt class="text-slate-400">Spec</dt>
            <dd class="text-slate-300">{p().config.spec}</dd>
            <dt class="text-slate-400">Base URL</dt>
            <dd class="text-slate-300">{p().config.baseUrl ?? "—"}</dd>
            <dt class="text-slate-400">Endpoints</dt>
            <dd data-testid="endpoint-count">{p().counts.endpoints}</dd>
            <dt class="text-slate-400">Journeys</dt>
            <dd>{p().counts.journeys}</dd>
            <dt class="text-slate-400">Environments</dt>
            <dd>{p().counts.environments}</dd>
          </dl>
        )}
      </Show>
    </div>
  );
};
