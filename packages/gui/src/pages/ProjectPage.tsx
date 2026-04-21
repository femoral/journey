import {
  For,
  Show,
  createMemo,
  createResource,
  type Accessor,
  type Component,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { api, type ProjectSummary, type RunSummary } from "../api/client";
import {
  DriftRow,
  IconChevron,
  IconEndpoints,
  IconPlay,
  IconPlus,
  IconRefresh,
  Panel,
  QAButton,
  RunDot,
  Stat,
  type RunState,
} from "../ui";

export const ProjectPage: Component = () => {
  const navigate = useNavigate();
  const [project] = createResource(api.getProject);
  const [runs] = createResource(api.listRuns);

  const recentRuns = createMemo(() => (runs() ?? []).slice(0, 6));
  const last24h = createMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return (runs() ?? []).filter((r) => {
      const t = Date.parse(r.timestamp);
      return Number.isFinite(t) && t >= cutoff;
    });
  });
  const passCount = createMemo(() => last24h().filter((r) => r.ok).length);
  const failCount = createMemo(() => last24h().length - passCount());

  return (
    <div
      style={{ padding: "24px 32px", overflow: "auto", height: "100%" }}
      data-testid="project-page"
    >
      <Show when={project.error}>
        <p class="mono" style={{ color: "var(--err)" }} data-testid="error">
          Failed to load project: {(project.error as Error).message}
        </p>
      </Show>

      <Show when={project()}>
        {(p: Accessor<ProjectSummary>) => {
          const displayName = () => p().config.name ?? basename(p().projectDir);
          const summary = () => {
            const bits = [];
            if (p().config.spec) bits.push(p().config.spec);
            if (p().config.baseUrl) bits.push(p().config.baseUrl);
            return bits;
          };
          return (
            <>
              <div
                style={{
                  display: "flex",
                  "align-items": "baseline",
                  gap: "12px",
                  "margin-bottom": "4px",
                  "flex-wrap": "wrap",
                }}
              >
                <h1
                  style={{
                    "font-size": "22px",
                    "font-weight": 600,
                    margin: 0,
                    "letter-spacing": "-0.01em",
                  }}
                  data-testid="project-name"
                >
                  {displayName()}
                </h1>
                <span
                  class="mono"
                  style={{ color: "var(--fg-3)", "font-size": "12px" }}
                >
                  {p().projectDir}
                </span>
              </div>
              <div
                style={{
                  "font-size": "13px",
                  color: "var(--fg-2)",
                  "margin-bottom": "28px",
                }}
              >
                <Show when={p().config.spec}>
                  <span class="mono">{p().config.spec}</span>
                </Show>
                <Show when={p().config.spec && p().config.baseUrl}>
                  <span style={{ color: "var(--fg-3)" }}> · </span>
                </Show>
                <Show when={p().config.baseUrl}>
                  <span class="mono">{p().config.baseUrl}</span>
                </Show>
              </div>

              <div
                style={{
                  display: "grid",
                  "grid-template-columns": "repeat(4, 1fr)",
                  gap: "1px",
                  background: "var(--bd-1)",
                  border: "1px solid var(--bd-1)",
                  "border-radius": "6px",
                  "margin-bottom": "28px",
                  overflow: "hidden",
                }}
              >
                <Stat
                  label="Endpoints"
                  value={<span data-testid="endpoint-count">{p().counts.endpoints}</span>}
                  sub={`from ${p().config.spec ?? "openapi spec"}`}
                />
                <Stat
                  label="Journeys"
                  value={p().counts.journeys}
                  sub={p().counts.journeys === 1 ? "1 file" : `${p().counts.journeys} files`}
                />
                <Stat
                  label="Environments"
                  value={p().counts.environments}
                  sub={
                    p().config.defaultEnvironment
                      ? `default: ${p().config.defaultEnvironment}`
                      : "no default set"
                  }
                />
                <Stat
                  label="Last 24h runs"
                  value={last24h().length}
                  sub={
                    last24h().length === 0
                      ? "no runs yet"
                      : `${passCount()} passed · ${failCount()} failed`
                  }
                  valueColor={failCount() > 0 ? "var(--err)" : undefined}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  "grid-template-columns": "minmax(0, 1.4fr) minmax(0, 1fr)",
                  gap: "20px",
                }}
              >
                <Panel
                  title="Recent runs"
                  action={
                    <button
                      onClick={() => navigate("/journeys")}
                      style={{
                        color: "var(--fg-2)",
                        "font-size": "12px",
                        display: "flex",
                        "align-items": "center",
                        gap: "3px",
                      }}
                    >
                      View all <IconChevron size={10} />
                    </button>
                  }
                >
                  <Show
                    when={recentRuns().length > 0}
                    fallback={<EmptyRuns onCreate={() => navigate("/editor")} />}
                  >
                    <For each={recentRuns()}>
                      {(r, i) => <RecentRunRow run={r} isFirst={i() === 0} />}
                    </For>
                  </Show>
                </Panel>

                <div
                  style={{
                    display: "flex",
                    "flex-direction": "column",
                    gap: "20px",
                  }}
                >
                  <Panel title="Quick actions">
                    <div
                      style={{
                        padding: "10px",
                        display: "grid",
                        "grid-template-columns": "1fr 1fr",
                        gap: "6px",
                      }}
                    >
                      <QAButton
                        icon={IconPlay}
                        label="Run journeys"
                        sub={
                          p().counts.journeys === 1
                            ? "1 journey"
                            : `${p().counts.journeys} journeys`
                        }
                        onClick={() => navigate("/journeys")}
                      />
                      <QAButton
                        icon={IconEndpoints}
                        label="Send request"
                        sub="endpoints"
                        onClick={() => navigate("/endpoints")}
                      />
                      <QAButton
                        icon={IconRefresh}
                        label="Regenerate"
                        sub="from openapi"
                      />
                      <QAButton
                        icon={IconPlus}
                        label="New journey"
                        sub="from skeleton"
                        onClick={() => navigate("/editor")}
                      />
                    </div>
                  </Panel>

                  <Panel title="Spec drift" badge="soon">
                    <div
                      style={{
                        padding: "2px 12px 10px",
                        opacity: 0.7,
                        "pointer-events": "none",
                      }}
                    >
                      <DriftRow
                        method="POST"
                        path="—"
                        change="drift detection"
                        detail="ships in M5a"
                      />
                    </div>
                  </Panel>
                </div>
              </div>
            </>
          );
        }}
      </Show>
    </div>
  );
};

function RecentRunRow(props: { run: RunSummary; isFirst: boolean }): ReturnType<Component> {
  const state = (): RunState => (props.run.ok ? "pass" : "fail");
  const journey = () => props.run.journeyNames[0] ?? "—";
  const extraCount = () =>
    props.run.journeyNames.length > 1 ? `+${props.run.journeyNames.length - 1}` : "";
  return (
    <div
      data-testid="recent-run-row"
      style={{
        display: "grid",
        "grid-template-columns": "16px minmax(0, 1fr) auto 24px",
        "align-items": "center",
        gap: "12px",
        padding: "8px 12px",
        "border-top": props.isFirst ? "none" : "1px solid var(--bd-1)",
        "font-size": "12px",
      }}
    >
      <RunDot state={state()} />
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "min-width": 0,
        }}
      >
        <span
          class="mono"
          style={{
            color: "var(--fg-0)",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
          }}
        >
          {journey()}
        </span>
        <Show when={extraCount()}>
          <span
            class="mono"
            style={{
              "font-size": "10px",
              color: "var(--fg-3)",
              border: "1px solid var(--bd-2)",
              padding: "0 4px",
              "border-radius": "2px",
            }}
          >
            {extraCount()}
          </span>
        </Show>
      </div>
      <span
        class="mono"
        style={{ color: "var(--fg-3)", "text-align": "right", "font-size": "11px" }}
      >
        {formatRelative(props.run.timestamp)}
      </span>
      <button style={{ color: "var(--fg-3)" }} aria-label="Open run">
        <IconChevron size={11} />
      </button>
    </div>
  );
}

function EmptyRuns(props: { onCreate: () => void }): ReturnType<Component> {
  return (
    <div
      style={{
        padding: "22px 16px",
        "text-align": "center",
        color: "var(--fg-3)",
        "font-size": "12px",
      }}
    >
      <div style={{ "margin-bottom": "10px" }}>No runs yet.</div>
      <button
        onClick={props.onCreate}
        style={{
          display: "inline-flex",
          "align-items": "center",
          gap: "5px",
          "font-size": "11px",
          color: "var(--ac)",
        }}
      >
        <IconPlus size={11} /> Create a journey to start running
      </button>
    </div>
  );
}

function basename(p: string): string {
  const s = p.replace(/\/$/, "");
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
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
