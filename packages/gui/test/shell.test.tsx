import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { createSignal } from "solid-js";
import { TopBar } from "../src/shell/TopBar";
import { Sidebar } from "../src/shell/Sidebar";
import { ProjectSwitcher } from "../src/shell/ProjectSwitcher";
import { Shell } from "../src/shell/Shell";
import {
  loadRecentProjects,
  saveRecentProjects,
  upsertRecentProject,
} from "../src/shell/recentProjects";

describe("recentProjects", () => {
  it("upserts to the front and dedupes by path", () => {
    const list = [
      { name: "a", path: "/a" },
      { name: "b", path: "/b" },
    ];
    const next = upsertRecentProject(list, { name: "a-renamed", path: "/a" });
    expect(next).toEqual([
      { name: "a-renamed", path: "/a" },
      { name: "b", path: "/b" },
    ]);
  });

  it("round-trips through localStorage", () => {
    saveRecentProjects([{ name: "x", path: "/x" }]);
    expect(loadRecentProjects()).toEqual([{ name: "x", path: "/x" }]);
  });

  it("returns [] when storage is empty or malformed", () => {
    localStorage.setItem("jrn:recentProjects", "not json");
    expect(loadRecentProjects()).toEqual([]);
    localStorage.removeItem("jrn:recentProjects");
    expect(loadRecentProjects()).toEqual([]);
  });
});

describe("TopBar", () => {
  it("renders project name, env pill, and console toggle", () => {
    const [open, setOpen] = createSignal(false);
    render(() => (
      <TopBar
        projectName="ledger-api"
        envName="local"
        envBaseUrl="api.test:4000"
        onOpenSwitcher={() => {}}
        onToggleConsole={() => setOpen((o) => !o)}
        consoleOpen={open()}
      />
    ));
    expect(screen.getByText("ledger-api")).toBeDefined();
    expect(screen.getByText("local")).toBeDefined();
    expect(screen.getByText("api.test:4000")).toBeDefined();
    const btn = screen.getByTitle("Toggle console");
    fireEvent.click(btn);
    expect(open()).toBe(true);
  });

  it("disables the env switcher when no options are provided", () => {
    render(() => (
      <TopBar
        projectName="ledger-api"
        envName="local"
        envOptions={[]}
        onSelectEnv={() => {}}
        onOpenSwitcher={() => {}}
        onToggleConsole={() => {}}
        consoleOpen={false}
      />
    ));
    const trigger = screen.getByTestId("env-switcher") as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });

  it("exposes a working env switcher trigger when options exist", () => {
    const picked: string[] = [];
    render(() => (
      <TopBar
        projectName="ledger-api"
        envName="local"
        envOptions={["local", "ci", "staging"]}
        onSelectEnv={(name) => picked.push(name)}
        onOpenSwitcher={() => {}}
        onToggleConsole={() => {}}
        consoleOpen={false}
      />
    ));
    const trigger = screen.getByTestId("env-switcher") as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
  });
});

describe("Sidebar", () => {
  it("lists every project route with counts where supplied", () => {
    render(() => (
      <Router>
        <Route
          path="*"
          component={() => <Sidebar counts={{ endpoints: 12, journeys: 3, envs: 2 }} />}
        />
      </Router>
    ));
    expect(screen.getByText("Overview")).toBeDefined();
    expect(screen.getByText("Endpoints")).toBeDefined();
    expect(screen.getByText("Journeys")).toBeDefined();
    expect(screen.getByText("Files")).toBeDefined();
    expect(screen.getByText("Environments")).toBeDefined();
    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    // Editor is gated behind VITE_JOURNEY_EXPERIMENTAL.
    expect(screen.queryByText("Editor")).toBeNull();
  });

  it("surfaces the Editor entry when the experimental flag is on", () => {
    const prev = import.meta.env.VITE_JOURNEY_EXPERIMENTAL;
    import.meta.env.VITE_JOURNEY_EXPERIMENTAL = "1";
    try {
      render(() => (
        <Router>
          <Route path="*" component={() => <Sidebar counts={{}} />} />
        </Router>
      ));
      expect(screen.getByText("Editor")).toBeDefined();
    } finally {
      import.meta.env.VITE_JOURNEY_EXPERIMENTAL = prev;
    }
  });
});

describe("ProjectSwitcher", () => {
  it("renders recent projects and calls onSwitch when one is clicked", () => {
    const [switched, setSwitched] = createSignal<string | undefined>(undefined);
    render(() => (
      <ProjectSwitcher
        open
        onClose={() => {}}
        projects={[
          { name: "ledger-api", path: "/w/ledger/api" },
          { name: "other", path: "/w/other" },
        ]}
        currentPath="/w/ledger/api"
        onSwitch={(p) => setSwitched(p.path)}
        onOpenFolder={() => {}}
        onInitNew={() => {}}
      />
    ));
    fireEvent.click(screen.getByText("other"));
    expect(switched()).toBe("/w/other");
  });

  it("shows the empty hint when no projects are provided", () => {
    render(() => (
      <ProjectSwitcher
        open
        onClose={() => {}}
        projects={[]}
        currentPath={undefined}
        onSwitch={() => {}}
        onOpenFolder={() => {}}
        onInitNew={() => {}}
      />
    ));
    expect(screen.getByText("No recent projects yet.")).toBeDefined();
  });
});

describe("Shell — project switch", () => {
  const projectA = {
    projectDir: "/tmp/alpha",
    config: { name: "alpha", spec: "openapi.yaml", tlsRejectUnauthorized: true },
    counts: { journeys: 1, environments: 1, endpoints: 1 },
  };
  const projectB = {
    projectDir: "/tmp/bravo",
    config: { name: "bravo", spec: "openapi.yaml", tlsRejectUnauthorized: true },
    counts: { journeys: 2, environments: 2, endpoints: 2 },
  };

  // Mutable so `/api/project/open` can flip what `/api/project` returns next —
  // a stand-in for the serve backend swapping its loaded project.
  let current = projectA;

  beforeEach(() => {
    current = projectA;
    localStorage.clear();
    localStorage.setItem(
      "jrn:recentProjects",
      JSON.stringify([{ name: "bravo", path: "/tmp/bravo" }]),
    );
    const json = (body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        // `/api/project/open` must be matched before `/api/project`.
        if (url.includes("/api/project/open")) {
          current = projectB;
          return json(projectB);
        }
        if (url.includes("/api/project")) return json(current);
        if (url.includes("/api/spec/drift"))
          return json({ added: [], removed: [], count: 0, hasGenerated: true, hasSpec: true });
        if (url.includes("/api/environments"))
          return json({ environments: [], defaultEnvironment: undefined });
        return json({});
      }) as typeof fetch,
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("swaps the loaded project in place — no full-page reload", async () => {
    render(() => (
      <Router root={Shell}>
        <Route path="/" component={() => <div>route content</div>} />
      </Router>
    ));

    // Project A is loaded.
    await waitFor(() => expect(screen.getByText("alpha")).toBeDefined());

    // Open the switcher and pick the "bravo" recent.
    fireEvent.click(screen.getByTitle("Switch project"));
    await waitFor(() => expect(screen.getByText("bravo")).toBeDefined());
    fireEvent.click(screen.getByText("bravo"));

    // The TopBar now shows project B. If the old `window.location.reload()`
    // path were still in place, jsdom would not reload and the shell would
    // stay bound to project A — so this asserts the in-place swap worked.
    await waitFor(() => expect(screen.getByText("bravo")).toBeDefined());
    expect(screen.queryByText("alpha")).toBeNull();
  });
});
