import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../src/server/server.js";

describe("journey serve — /api/project", () => {
  let srv: RunningServer;
  let projectDir: string;

  beforeAll(async () => {
    // Colocate the fixture under packages/cli/.test-tmp so the tsx-loaded
    // journey file can resolve `@journey/core` via the pnpm workspace link
    // in packages/cli/node_modules. The OS tmpdir has no such link.
    const cliDir = dirname(dirname(fileURLToPath(import.meta.url)));
    const base = join(cliDir, ".test-tmp");
    await mkdir(base, { recursive: true });
    projectDir = await mkdtemp(join(base, "journey-serve-"));
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
    const targetPort =
      typeof targetAddr === "object" && targetAddr ? targetAddr.port : 0;

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
    expect(drift.added.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
      "GET /pets",
    ]);
    expect(drift.removed.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
      "DELETE /pets/{id}",
    ]);
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
