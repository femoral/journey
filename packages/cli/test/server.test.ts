import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../src/server/server.js";

describe("journey serve — /api/project", () => {
  let srv: RunningServer;
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "journey-serve-"));
    await mkdir(join(projectDir, "generated"), { recursive: true });
    await mkdir(join(projectDir, "journeys"), { recursive: true });
    await mkdir(join(projectDir, "environments"), { recursive: true });
    await writeFile(
      join(projectDir, "journey.config.json"),
      JSON.stringify({ name: "demo", spec: "openapi.yaml", baseUrl: "https://api.example.com" }),
    );
    await writeFile(
      join(projectDir, "openapi.yaml"),
      `openapi: 3.0.0
info: { title: t, version: "1" }
paths:
  /pets:
    get:
      operationId: listPets
      parameters:
        - name: status
          in: query
          required: false
          description: filter by status
        - name: limit
          in: query
          required: false
      responses:
        "200": { description: ok }
  /pets/{id}:
    get:
      operationId: getPet
      parameters:
        - name: id
          in: path
          required: true
      responses:
        "200": { description: ok }
`,
    );
    await writeFile(
      join(projectDir, "generated", "endpoints.ts"),
      `export const endpoints = {
  listPets: { method: "GET", path: "/pets" },
  getPet: { method: "GET", path: "/pets/{id}" },
} as const;
`,
    );
    await writeFile(join(projectDir, "environments", "dev.json"), "{}");
    await writeFile(join(projectDir, "environments", "staging.json"), "{}");
    srv = await startServer({ projectDir, port: 0 });
  });

  afterAll(async () => {
    await srv.close();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("reports project config + counts", async () => {
    const res = await fetch(`${srv.url}/api/project`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      config: { name: string; baseUrl: string };
      counts: { endpoints: number; journeys: number; environments: number };
    };
    expect(body.config.name).toBe("demo");
    expect(body.config.baseUrl).toBe("https://api.example.com");
    expect(body.counts).toEqual({ endpoints: 2, journeys: 0, environments: 2 });
  });

  it("PATCH /api/project/config persists tlsRejectUnauthorized and rejects unknown keys", async () => {
    // Default — schema fills tlsRejectUnauthorized: true even though the fixture didn't set it.
    const initial = (await (await fetch(`${srv.url}/api/project`)).json()) as {
      config: { tlsRejectUnauthorized: boolean };
    };
    expect(initial.config.tlsRejectUnauthorized).toBe(true);

    // Flip off — written to disk + reflected in the summary.
    const patch = await fetch(`${srv.url}/api/project/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tlsRejectUnauthorized: false }),
    });
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as { config: { tlsRejectUnauthorized: boolean } };
    expect(patched.config.tlsRejectUnauthorized).toBe(false);
    const onDisk = JSON.parse(await readFile(`${projectDir}/journey.config.json`, "utf8")) as {
      tlsRejectUnauthorized: boolean;
      name: string;
    };
    expect(onDisk.tlsRejectUnauthorized).toBe(false);
    expect(onDisk.name).toBe("demo"); // unrelated fields preserved

    // Unknown patch key is rejected with 500 / clear error (route handler maps thrown errors).
    const bad = await fetch(`${srv.url}/api/project/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://elsewhere" }),
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const badBody = (await bad.json()) as { error?: string };
    expect(badBody.error).toMatch(/baseUrl/);

    // Restore for downstream tests in this file.
    await fetch(`${srv.url}/api/project/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tlsRejectUnauthorized: true }),
    });
  });

  it("health check", async () => {
    const res = await fetch(`${srv.url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("404 for unknown routes", async () => {
    const res = await fetch(`${srv.url}/api/nope`);
    expect(res.status).toBe(404);
  });

  it("lists endpoints with parameters parsed from the spec", async () => {
    const res = await fetch(`${srv.url}/api/endpoints`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      baseUrl?: string;
      endpoints: Array<{
        name: string;
        method: string;
        path: string;
        parameters: Array<{ name: string; in: string; required: boolean }>;
      }>;
    };
    expect(body.baseUrl).toBe("https://api.example.com");

    const list = body.endpoints.find((e) => e.name === "listPets");
    expect(list).toMatchObject({ method: "GET", path: "/pets" });
    expect(list?.parameters.map((p) => `${p.in}:${p.name}`).sort()).toEqual([
      "query:limit",
      "query:status",
    ]);

    const getPet = body.endpoints.find((e) => e.name === "getPet");
    expect(getPet?.parameters.map((p) => `${p.in}:${p.name}`)).toEqual(["path:id"]);
    expect(getPet?.parameters[0]?.required).toBe(true);
  });

  it("lists, saves, and deletes environments", async () => {
    type EnvListBody = { environments: Array<{ name: string; values: Record<string, string> }> };
    const list = (await (await fetch(`${srv.url}/api/environments`)).json()) as EnvListBody;
    expect(list.environments.map((e) => e.name).sort()).toEqual(["dev", "staging"]);

    const put = await fetch(`${srv.url}/api/environments/dev`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ TOKEN: "abc" }),
    });
    expect(put.status).toBe(200);

    const refetched = (await (await fetch(`${srv.url}/api/environments`)).json()) as EnvListBody;
    const dev = refetched.environments.find((e) => e.name === "dev");
    expect(dev?.values).toEqual({ TOKEN: "abc" });

    const del = await fetch(`${srv.url}/api/environments/staging`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const afterDelete = (await (await fetch(`${srv.url}/api/environments`)).json()) as EnvListBody;
    expect(afterDelete.environments.map((e) => e.name)).toEqual(["dev"]);

    // invalid name
    const bad = await fetch(`${srv.url}/api/environments/..%2Fetc%2Fpasswd`, { method: "DELETE" });
    expect(bad.status).toBe(400);
  });

  it("reads, writes, and deletes journey source files", async () => {
    const file = "demo.journey.ts";
    const source = `import { journey } from "@journey/core";\njourney("x", () => {});\n`;

    const put = await fetch(`${srv.url}/api/journeys/${file}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source }),
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${srv.url}/api/journeys/${file}`);
    expect(get.status).toBe(200);
    const body = (await get.json()) as { source: string };
    expect(body.source).toBe(source);

    const bad = await fetch(`${srv.url}/api/journeys/..%2Fetc%2Fpasswd`);
    expect(bad.status).toBe(400);

    const del = await fetch(`${srv.url}/api/journeys/${file}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });

  it("streams run events over SSE and exposes runId on the sync POST response", async () => {
    // Stand up a target server the journey will hit.
    const { createServer } = await import("node:http");
    const target = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ method: req.method, url: req.url }));
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    const targetAddr = target.address();
    const targetPort = typeof targetAddr === "object" && targetAddr ? targetAddr.port : 0;

    // Write a minimal journey file into the fixture's journeys dir.
    // No operationId — endpoint is treated as a descriptor so its baseUrl
    // actually takes effect (EndpointRefs read baseUrl from ctx).
    await writeFile(
      join(projectDir, "journeys", "smoke.journey.ts"),
      `import { journey, step } from "@journey/core";
journey("smoke", () => {
  step("one", { endpoint: { method: "GET", path: "/a", baseUrl: "http://127.0.0.1:${targetPort}" } });
  step("two", { endpoint: { method: "GET", path: "/b", baseUrl: "http://127.0.0.1:${targetPort}" } });
});
`,
    );

    try {
      // stream: true — POST returns { runId } without awaiting results.
      const post = await fetch(`${srv.url}/api/journeys/smoke.journey.ts/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });
      expect(post.status).toBe(202);
      const { runId } = (await post.json()) as { runId: string };
      expect(runId).toBeTruthy();

      // Subscribe to SSE and collect events until run:end.
      const evRes = await fetch(`${srv.url}/api/runs/${runId}/events`);
      expect(evRes.status).toBe(200);
      expect(evRes.headers.get("content-type")).toMatch(/text\/event-stream/);

      const reader = evRes.body!.getReader();
      const decoder = new TextDecoder();
      const events: { kind: string; runId: string }[] = [];
      let buf = "";
      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line.
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const parsed = JSON.parse(dataLine.slice(5).trim()) as {
            kind: string;
            runId: string;
          };
          events.push(parsed);
          if (parsed.kind === "run:end") {
            done = true;
            break;
          }
        }
      }

      const kinds = events.map((e) => e.kind);
      expect(kinds[0]).toBe("run:start");
      // step:planned arrives before any step:start so the GUI can pre-render
      // the resolved step list.
      const plannedIdx = kinds.indexOf("step:planned");
      const firstStepStart = kinds.indexOf("step:start");
      expect(plannedIdx).toBeGreaterThanOrEqual(0);
      expect(plannedIdx).toBeLessThan(firstStepStart);
      expect(kinds).toContain("step:start");
      expect(kinds).toContain("request");
      expect(kinds).toContain("response");
      expect(kinds).toContain("step:end");
      expect(kinds[kinds.length - 1]).toBe("run:end");
      // All events carry the same runId.
      for (const e of events) expect(e.runId).toBe(runId);
    } finally {
      await new Promise<void>((r) => target.close(() => r()));
    }
  });

  it("runs a journey using invokeJourney + zod re-export through the runner", async () => {
    // Proves a journey project (zero deps of its own) can reach `z`,
    // `invokeJourney`, and `output` via the `@journey/core` symlink — the
    // sub-journey surface from #87 resolves end-to-end through the CLI runner.
    const { createServer } = await import("node:http");
    const target = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/token") {
        res.end(JSON.stringify({ access_token: "tok-123" }));
      } else {
        res.end(JSON.stringify({ seen: req.headers.authorization ?? null }));
      }
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    const targetAddr = target.address();
    const targetPort = typeof targetAddr === "object" && targetAddr ? targetAddr.port : 0;
    const base = `http://127.0.0.1:${targetPort}`;

    await writeFile(
      join(projectDir, "journeys", "subjourney.journey.ts"),
      `import { journey, step, invokeJourney, output, z } from "@journey/core";

const acquireToken = journey(
  "auth.acquire-token",
  { reusable: true, outputs: z.object({ token: z.string() }) },
  () => {
    step("exchange", {
      endpoint: { method: "POST", path: "/token", baseUrl: "${base}" },
      after: (res) => output({ token: res.body.access_token }),
    });
  },
);

journey("with-sub", () => {
  let token = "";
  invokeJourney(acquireToken, { after: (out) => { token = out.token; } });
  step("call", {
    endpoint: { method: "GET", path: "/data", baseUrl: "${base}" },
    headers: () => ({ Authorization: \`Bearer \${token}\` }),
  });
});
`,
    );

    try {
      const post = await fetch(`${srv.url}/api/journeys/subjourney.journey.ts/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(post.status).toBe(200);
      const body = (await post.json()) as {
        results: Array<{
          ok: boolean;
          steps: Array<{
            name: string;
            ok: boolean;
            kind?: string;
            response?: { body: unknown };
          }>;
        }>;
      };
      const journeyResult = body.results[0]!;
      expect(journeyResult.ok).toBe(true);
      // Pipeline: [sub node, http step].
      expect(journeyResult.steps).toHaveLength(2);
      expect(journeyResult.steps[0]!.kind).toBe("sub");
      expect(journeyResult.steps[0]!.name).toBe("auth.acquire-token");
      // The bearer token minted by the sub-journey reached the parent step.
      expect(journeyResult.steps[1]!.response?.body).toEqual({ seen: "Bearer tok-123" });
    } finally {
      await new Promise<void>((r) => target.close(() => r()));
    }
  });

  it("streams group:start/group:end frames bracketing a sub-journey's child steps", async () => {
    const { createServer } = await import("node:http");
    const target = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/token") {
        res.end(JSON.stringify({ access_token: "tok-xyz" }));
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    const targetAddr = target.address();
    const targetPort = typeof targetAddr === "object" && targetAddr ? targetAddr.port : 0;
    const base = `http://127.0.0.1:${targetPort}`;

    await writeFile(
      join(projectDir, "journeys", "grouped.journey.ts"),
      `import { journey, step, invokeJourney, output, z } from "@journey/core";

const auth = journey(
  "auth.sub",
  { reusable: true, outputs: z.object({ token: z.string() }) },
  () => {
    step("exchange", {
      endpoint: { method: "POST", path: "/token", baseUrl: "${base}" },
      after: (res) => output({ token: res.body.access_token }),
    });
  },
);

journey("grouped", () => {
  invokeJourney(auth, {});
  step("after-auth", { endpoint: { method: "GET", path: "/data", baseUrl: "${base}" } });
});
`,
    );

    try {
      const post = await fetch(`${srv.url}/api/journeys/grouped.journey.ts/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });
      expect(post.status).toBe(202);
      const { runId } = (await post.json()) as { runId: string };

      const evRes = await fetch(`${srv.url}/api/runs/${runId}/events`);
      const reader = evRes.body!.getReader();
      const decoder = new TextDecoder();
      const events: Array<{ kind: string; stepIdx?: number; firstChildStepIdx?: number }> = [];
      let buf = "";
      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const parsed = JSON.parse(dataLine.slice(5).trim()) as {
            kind: string;
            stepIdx?: number;
            firstChildStepIdx?: number;
          };
          events.push(parsed);
          if (parsed.kind === "run:end") {
            done = true;
            break;
          }
        }
      }

      const kinds = events.map((e) => e.kind);
      // group:start fires before the child step's step:start, group:end after it.
      const groupStartIdx = kinds.indexOf("group:start");
      const groupEndIdx = kinds.indexOf("group:end");
      const firstStepStartIdx = kinds.indexOf("step:start");
      expect(groupStartIdx).toBeGreaterThanOrEqual(0);
      expect(groupEndIdx).toBeGreaterThan(groupStartIdx);
      expect(groupStartIdx).toBeLessThan(firstStepStartIdx);
      expect(firstStepStartIdx).toBeLessThan(groupEndIdx);

      // The sub-journey node occupies stepIdx 0; its child step starts at 1.
      const groupStart = events[groupStartIdx]!;
      expect(groupStart.stepIdx).toBe(0);
      expect(groupStart.firstChildStepIdx).toBe(1);

      // The child step event carries the firstChildStepIdx slot.
      const childStart = events.find((e) => e.kind === "step:start");
      expect(childStart!.stepIdx).toBe(1);

      // step:planned carries the nested plan tree — the sub-journey's child
      // step is discovered at plan time, before the group runs.
      const planned = events.find((e) => e.kind === "step:planned") as
        | {
            steps: Array<{ kind?: string; name: string; children?: Array<{ name: string }> }>;
          }
        | undefined;
      expect(planned).toBeDefined();
      expect(planned!.steps).toHaveLength(2);
      expect(planned!.steps[0]!.kind).toBe("sub");
      expect(planned!.steps[0]!.name).toBe("auth.sub");
      expect(planned!.steps[0]!.children?.map((c) => c.name)).toEqual(["exchange"]);
      expect(planned!.steps[1]!.name).toBe("after-auth");
    } finally {
      await new Promise<void>((r) => target.close(() => r()));
    }
  });

  it("GET /api/journeys/:file/plan resolves the nested plan tree without running", async () => {
    await writeFile(
      join(projectDir, "journeys", "planned.journey.ts"),
      `import { journey, step, invokeJourney } from "@journey/core";

const child = journey("child.sub", { reusable: true }, () => {
  step("inner", { endpoint: { method: "GET", path: "/x", baseUrl: "http://127.0.0.1:1" } });
});

journey("planned", () => {
  step("first", { endpoint: { method: "GET", path: "/a", baseUrl: "http://127.0.0.1:1" } });
  invokeJourney(child, {});
});
`,
    );

    const res = await fetch(`${srv.url}/api/journeys/planned.journey.ts/plan`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      journeys: Array<{
        name: string;
        steps: Array<{ kind?: string; name: string; children?: Array<{ name: string }> }>;
      }>;
    };
    // Reusable journeys aren't auto-registered, so only the entry is planned.
    const plan = body.journeys.find((j) => j.name === "planned");
    expect(plan).toBeDefined();
    expect(plan!.steps).toHaveLength(2);
    expect(plan!.steps[0]).toMatchObject({ kind: "step", name: "first" });
    expect(plan!.steps[1]!.kind).toBe("sub");
    expect(plan!.steps[1]!.name).toBe("child.sub");
    expect(plan!.steps[1]!.children?.map((c) => c.name)).toEqual(["inner"]);
  });

  it("aborts an in-flight run via POST /api/runs/:id/abort", async () => {
    // Slow target so we can fire abort while the first step is still pending.
    const { createServer } = await import("node:http");
    const target = createServer((_req, res) => {
      // Never respond — close the socket only when the server is torn down.
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      }, 30_000);
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    const targetAddr = target.address();
    const targetPort = typeof targetAddr === "object" && targetAddr ? targetAddr.port : 0;

    await writeFile(
      join(projectDir, "journeys", "abortable.journey.ts"),
      `import { journey, step } from "@journey/core";
journey("slow", () => {
  step("hang", { endpoint: { method: "GET", path: "/slow", baseUrl: "http://127.0.0.1:${targetPort}" } });
});
`,
    );

    try {
      const post = await fetch(`${srv.url}/api/journeys/abortable.journey.ts/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });
      expect(post.status).toBe(202);
      const { runId } = (await post.json()) as { runId: string };

      // Subscribe to SSE in the background; wait until the first `request`
      // frame lands so we know the fetch has actually been dispatched, then
      // fire the abort.
      const evRes = await fetch(`${srv.url}/api/runs/${runId}/events`);
      const reader = evRes.body!.getReader();
      const decoder = new TextDecoder();
      const events: { kind: string }[] = [];
      let buf = "";
      let sawRequest = false;
      let runEndOk: boolean | undefined;

      const drain = (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            const parsed = JSON.parse(dataLine.slice(5).trim()) as {
              kind: string;
              ok?: boolean;
            };
            events.push(parsed);
            if (parsed.kind === "request") sawRequest = true;
            if (parsed.kind === "run:end") {
              runEndOk = parsed.ok;
              return;
            }
          }
        }
      })();

      // Wait until the request has been fired (max ~2s).
      const deadline = Date.now() + 2000;
      while (!sawRequest && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(sawRequest).toBe(true);

      const abort = await fetch(`${srv.url}/api/runs/${runId}/abort`, { method: "POST" });
      expect(abort.status).toBe(202);
      const abortBody = (await abort.json()) as { aborted: boolean };
      expect(abortBody.aborted).toBe(true);

      await drain;
      expect(runEndOk).toBe(false);
      // An `error` frame for the aborted fetch should be present.
      expect(events.some((e) => e.kind === "error")).toBe(true);

      // A second abort after completion returns 404 — controller is gone.
      const lateAbort = await fetch(`${srv.url}/api/runs/${runId}/abort`, { method: "POST" });
      expect(lateAbort.status).toBe(404);
    } finally {
      // Force-drop the hung connection so close() doesn't wait 30s for the
      // setTimeout in the handler. closeAllConnections is the supported
      // teardown for `http.Server` with long-lived requests.
      target.closeAllConnections?.();
      await new Promise<void>((r) => target.close(() => r()));
    }
  });

  it("reports spec drift and regenerates on POST /api/generate", async () => {
    type Drift = {
      added: Array<{ method: string; path: string; operationId: string }>;
      removed: Array<{ method: string; path: string; operationId: string }>;
      count: number;
      hasGenerated: boolean;
      hasSpec: boolean;
    };

    // Fixture: spec has getPet + listPets, generated/endpoints.ts has getPet +
    // deletePet. So listPets is added-in-spec, deletePet is removed-from-spec.
    const generatedEndpoints = `// AUTO-GENERATED
import type { EndpointRef } from "@journey/core";
export const endpoints = {
  getPet: { method: "GET", path: "/pets/{id}", operationId: "getPet" } as unknown as EndpointRef<unknown>,
  deletePet: { method: "DELETE", path: "/pets/{id}", operationId: "deletePet" } as unknown as EndpointRef<unknown>,
} as const;
`;
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(join(projectDir, "generated", "endpoints.ts"), generatedEndpoints);

    const drift = (await (await fetch(`${srv.url}/api/spec/drift`)).json()) as Drift;
    expect(drift.hasSpec).toBe(true);
    expect(drift.hasGenerated).toBe(true);
    expect(drift.added.map((e) => `${e.method} ${e.path}`).sort()).toEqual(["GET /pets"]);
    expect(drift.removed.map((e) => `${e.method} ${e.path}`).sort()).toEqual(["DELETE /pets/{id}"]);
    expect(drift.count).toBe(2);

    const regen = await fetch(`${srv.url}/api/generate`, { method: "POST" });
    expect(regen.status).toBe(200);
    const regenBody = (await regen.json()) as { operationCount: number };
    expect(regenBody.operationCount).toBe(2);

    const afterDrift = (await (await fetch(`${srv.url}/api/spec/drift`)).json()) as Drift;
    expect(afterDrift.count).toBe(0);
  });

  it("proxies a request and returns status + body", async () => {
    // Stand up a throwaway target server.
    const { createServer } = await import("node:http");
    const target = createServer((req, res) => {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ echo: req.method }));
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    const addr = target.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const res = await fetch(`${srv.url}/api/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "POST", url: `http://127.0.0.1:${port}/x`, body: { a: 1 } }),
      });
      expect(res.status).toBe(200);
      const out = (await res.json()) as { status: number; body: unknown };
      expect(out.status).toBe(201);
      expect(out.body).toEqual({ echo: "POST" });
    } finally {
      await new Promise<void>((r) => target.close(() => r()));
    }
  });
});
