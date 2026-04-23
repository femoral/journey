import type { JSX } from "solid-js";
import { createEffect, createResource, createSignal, createMemo } from "solid-js";
import { useLocation } from "@solidjs/router";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ConsoleDock } from "./ConsoleDock";
import {
  loadRecentProjects,
  saveRecentProjects,
  upsertRecentProject,
  type RecentProject,
} from "./recentProjects";
import { api } from "../api/client";
import { RouteFade } from "../ui";
import { createConsoleStore } from "./consoleStore";
import { ConsoleContext } from "./consoleContext";

export function Shell(props: { children?: JSX.Element }): JSX.Element {
  const [project] = createResource(() => api.getProject());
  const [switcherOpen, setSwitcherOpen] = createSignal(false);
  const [consoleOpen, setConsoleOpen] = createSignal(false);
  const [recents, setRecents] = createSignal<RecentProject[]>(loadRecentProjects());

  const consoleStore = createConsoleStore();

  // Auto-open the console dock the first time any run activity appears, so
  // users discover it without having to click the Console button first.
  let autoOpened = false;
  createEffect(() => {
    if (!autoOpened && consoleStore.entries().length > 0) {
      autoOpened = true;
      setConsoleOpen(true);
    }
  });

  // As soon as the backend tells us which project is loaded, remember it.
  createMemo(() => {
    const p = project();
    if (!p?.projectDir) return;
    const name = p.config?.name ?? basename(p.projectDir);
    const next = upsertRecentProject(recents(), { name, path: p.projectDir });
    if (JSON.stringify(next) !== JSON.stringify(recents())) {
      setRecents(next);
      saveRecentProjects(next);
    }
  });

  const location = useLocation();

  return (
    <ConsoleContext.Provider value={consoleStore}>
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          height: "100vh",
          background: "var(--bg-0)",
        }}
      >
        <TopBar
          projectName={project()?.config?.name ?? (project()?.projectDir ? basename(project()!.projectDir) : undefined)}
          envName={project()?.config?.defaultEnvironment}
          envBaseUrl={project()?.config?.baseUrl}
          onOpenSwitcher={() => setSwitcherOpen(true)}
          onToggleConsole={() => setConsoleOpen((o) => !o)}
          consoleOpen={consoleOpen()}
        />
        <ProjectSwitcher
          open={switcherOpen()}
          onClose={() => setSwitcherOpen(false)}
          projects={recents()}
          currentPath={project()?.projectDir}
          onSwitch={(p) => {
            console.info("[shell] project switch requested", p);
          }}
          onOpenFolder={() => {
            console.info("[shell] open folder requested");
          }}
          onInitNew={() => {
            console.info("[shell] init new project requested");
          }}
        />

        <div style={{ flex: 1, display: "flex", "min-height": 0 }}>
          <Sidebar
            counts={{
              endpoints: project()?.counts?.endpoints,
              journeys: project()?.counts?.journeys,
              envs: project()?.counts?.environments,
            }}
          />
          <div
            style={{
              flex: 1,
              display: "flex",
              "flex-direction": "column",
              "min-width": 0,
              "min-height": 0,
            }}
          >
            <div style={{ flex: 1, "min-height": 0, overflow: "hidden" }}>
              <RouteFade>
                <div
                  data-route={location.pathname}
                  style={{ flex: 1, "min-height": 0, overflow: "auto", width: "100%" }}
                >
                  {props.children}
                </div>
              </RouteFade>
            </div>
            <ConsoleDock open={consoleOpen()} onClose={() => setConsoleOpen(false)} />
          </div>
        </div>
      </div>
    </ConsoleContext.Provider>
  );
}

function basename(p: string): string {
  const s = p.replace(/\/$/, "");
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}
