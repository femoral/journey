import type { JSX } from "solid-js";
import { createEffect, createResource, createSignal, createMemo } from "solid-js";
import { useLocation } from "@solidjs/router";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ConsoleDock } from "./ConsoleDock";
import { CommandPalette, useCmdKHotkey } from "./CommandPalette";
import { ImportDialog } from "./ImportDialog";
import {
  loadRecentProjects,
  saveRecentProjects,
  upsertRecentProject,
  type RecentProject,
} from "./recentProjects";
import { api } from "../api/client";
import { projectRefreshTick } from "../api/projectRefresh";
import { RouteFade } from "../ui";
import { createConsoleStore } from "./consoleStore";
import { ConsoleContext } from "./consoleContext";
import { EnvContext, type EnvSelection } from "./envContext";
import { loadSelectedEnv, saveSelectedEnv } from "./selectedEnv";

export function Shell(props: { children?: JSX.Element }): JSX.Element {
  const [project] = createResource(projectRefreshTick, () => api.getProject());
  const [drift] = createResource(() => api.getSpecDrift());
  const [envs] = createResource(() => api.getEnvironments());
  const [switcherOpen, setSwitcherOpen] = createSignal(false);
  const [consoleOpen, setConsoleOpen] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [importOpen, setImportOpen] = createSignal(false);
  const [recents, setRecents] = createSignal<RecentProject[]>(loadRecentProjects());
  const [selectedEnv, setSelectedEnvSignal] = createSignal<string | undefined>(undefined);

  useCmdKHotkey(() => setPaletteOpen(true));

  const consoleStore = createConsoleStore();

  // Reconcile selectedEnv whenever project + env list resolve. Precedence:
  // 1) saved choice in localStorage (if it still exists in the env list),
  // 2) project defaultEnvironment, 3) first env in the list.
  createEffect(() => {
    const p = project();
    const e = envs();
    if (!p?.projectDir || !e) return;
    const names = new Set(e.environments.map((env) => env.name));
    if (names.size === 0) return;
    const current = selectedEnv();
    if (current && names.has(current)) return;
    const saved = loadSelectedEnv(p.projectDir);
    const fallback =
      (saved && names.has(saved) ? saved : undefined) ??
      e.defaultEnvironment ??
      p.config?.defaultEnvironment ??
      e.environments[0]?.name;
    if (fallback) setSelectedEnvSignal(fallback);
  });

  const setSelectedEnv = (name: string) => {
    setSelectedEnvSignal(name);
    const dir = project()?.projectDir;
    if (dir) saveSelectedEnv(dir, name);
  };

  const envSelection: EnvSelection = {
    selectedEnv,
    setSelectedEnv,
    environments: () => envs()?.environments ?? [],
    envValues: () => {
      const e = envs();
      const name = selectedEnv();
      if (!e || !name) return {};
      return e.environments.find((x) => x.name === name)?.values ?? {};
    },
  };

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
      <EnvContext.Provider value={envSelection}>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            height: "100vh",
            background: "var(--bg-0)",
          }}
        >
          <TopBar
            projectName={
              project()?.config?.name ??
              (project()?.projectDir ? basename(project()!.projectDir) : undefined)
            }
            envName={selectedEnv()}
            envBaseUrl={project()?.config?.baseUrl}
            envOptions={envSelection.environments().map((e) => e.name)}
            onSelectEnv={setSelectedEnv}
            onOpenSwitcher={() => setSwitcherOpen(true)}
            onToggleConsole={() => setConsoleOpen((o) => !o)}
            consoleOpen={consoleOpen()}
            onOpenPalette={() => setPaletteOpen(true)}
          />
          <CommandPalette
            open={paletteOpen()}
            onClose={() => setPaletteOpen(false)}
            onOpenImport={() => {
              setPaletteOpen(false);
              setImportOpen(true);
            }}
          />
          <ImportDialog open={importOpen()} onClose={() => setImportOpen(false)} />
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
                drift: drift()?.count,
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
              {project()?.config?.tlsRejectUnauthorized === false && (
                <div
                  data-testid="tls-insecure-banner"
                  style={{
                    padding: "6px 16px",
                    "font-size": "11px",
                    color: "var(--warn)",
                    background: "var(--warn-bg)",
                    "border-bottom": "1px solid var(--bd-1)",
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                  }}
                >
                  <span style={{ "font-weight": 600 }}>TLS verification disabled</span>
                  <span style={{ color: "var(--fg-2)" }}>
                    All HTTPS requests skip certificate validation. Reset in Project → Settings.
                  </span>
                </div>
              )}
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
      </EnvContext.Provider>
    </ConsoleContext.Provider>
  );
}

function basename(p: string): string {
  const s = p.replace(/\/$/, "");
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}
