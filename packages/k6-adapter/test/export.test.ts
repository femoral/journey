import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportToK6 } from "../src/index.js";

function hasK6(): boolean {
  try {
    const res = spawnSync("k6", ["version"], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

const describeIfK6 = hasK6() ? describe : describe.skip;

describe("exportToK6 — static output", () => {
  it("emits a k6 script with shim, inlined endpoints, and journey body", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "journey-k6-"));
    try {
      await mkdir(join(tmp, "generated"));
      await writeFile(
        join(tmp, "generated", "endpoints.ts"),
        `import type { EndpointRef } from "@journey/core";
export const endpoints = {
  listPets: { method: "GET", path: "/pets", operationId: "listPets" } as unknown as EndpointRef<unknown>,
} as const;
`,
      );
      const journey = join(tmp, "list-pets.journey.ts");
      await writeFile(
        journey,
        `import { journey, step, expect } from "@journey/core";
import { endpoints } from "./generated/endpoints.js";

journey("list pets", () => {
  step("fetch", {
    endpoint: endpoints.listPets,
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});
`,
      );

      const result = await exportToK6({ journeyFile: journey });
      expect(result.outFile).toMatch(/list-pets\.k6\.js$/);
      const src = await readFile(result.outFile, "utf8");
      expect(src).toContain('import http from "k6/http"');
      expect(src).toContain('import { check, group } from "k6"');
      expect(src).not.toContain("@journey/core");
      expect(src).toContain("const endpoints = {");
      expect(src).toContain("listPets:");
      expect(src).toContain('journey("list pets"');
      expect(src).toContain("export default function");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("bakes k6Options into `export const options` when provided", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "journey-k6-opts-"));
    try {
      const journey = join(tmp, "load.journey.ts");
      await writeFile(
        journey,
        `import { journey, step } from "@journey/core";
journey("load", () => {
  step("ping", { endpoint: { method: "GET", path: "/ping" } });
});
`,
      );
      const result = await exportToK6({
        journeyFile: journey,
        k6Options: { vus: 10, duration: "30s" },
      });
      const src = await readFile(result.outFile, "utf8");
      expect(src).toContain("export const options =");
      expect(src).toContain('"vus": 10');
      expect(src).toContain('"duration": "30s"');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("omits the options block when k6Options is not provided", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "journey-k6-noopts-"));
    try {
      const journey = join(tmp, "plain.journey.ts");
      await writeFile(
        journey,
        `import { journey, step } from "@journey/core";
journey("plain", () => {
  step("ping", { endpoint: { method: "GET", path: "/ping" } });
});
`,
      );
      const result = await exportToK6({ journeyFile: journey });
      const src = await readFile(result.outFile, "utf8");
      expect(src).not.toContain("export const options");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("writes into outDir when provided", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "journey-k6-outdir-"));
    try {
      const journey = join(tmp, "src", "ping.journey.ts");
      await mkdir(dirname(journey), { recursive: true });
      await writeFile(
        journey,
        `import { journey, step } from "@journey/core";
journey("p", () => { step("s", { endpoint: { method: "GET", path: "/" } }); });
`,
      );
      const outDir = join(tmp, "out");
      const result = await exportToK6({ journeyFile: journey, outDir });
      expect(result.outFile).toBe(join(outDir, "ping.k6.js"));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("exportToK6 — sub-journeys", () => {
  it("emits invokeJourney calls and the k6 group import for inlining", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "journey-k6-sub-"));
    try {
      const journey = join(tmp, "with-sub.journey.ts");
      await writeFile(
        journey,
        `import { journey, step, invokeJourney, output, z } from "@journey/core";

const warmUp = journey(
  "warm up",
  { reusable: true, outputs: z.object({ count: z.number() }) },
  () => {
    step("ping", {
      endpoint: { method: "GET", path: "/ping" },
      after: () => output({ count: 1 }),
    });
  },
);

journey("with sub", () => {
  let count = 0;
  invokeJourney(warmUp, { name: "warm", after: (out) => { count = out.count; } });
  step("main", { endpoint: { method: "GET", path: "/main" } });
});
`,
      );
      const result = await exportToK6({ journeyFile: journey });
      const src = await readFile(result.outFile, "utf8");
      // The shim provides group() so sub-journey nodes can be inlined under it.
      expect(src).toContain('import { check, group } from "k6"');
      // User code is preserved verbatim — the shim's journey()/invokeJourney()
      // do the inlining at runtime.
      expect(src).toContain("invokeJourney(warmUp,");
      expect(src).toContain("reusable: true");
      expect(src).not.toContain("@journey/core");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("recursively inlines a sub-journey imported from a helper file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "journey-k6-helper-"));
    try {
      await mkdir(join(tmp, "helpers"));
      await writeFile(
        join(tmp, "helpers", "auth.ts"),
        `import { journey, step, output, z } from "@journey/core";
export const acquireToken = journey(
  "auth.acquire-token",
  { reusable: true, outputs: z.object({ token: z.string() }) },
  () => {
    step("login", {
      endpoint: { method: "POST", path: "/login" },
      after: () => output({ token: "t" }),
    });
  },
);
`,
      );
      const journey = join(tmp, "checkout.journey.ts");
      await writeFile(
        journey,
        `import { journey, step, invokeJourney } from "@journey/core";
import { acquireToken } from "./helpers/auth.js";

journey("checkout", () => {
  let token = "";
  invokeJourney(acquireToken, { after: (out) => { token = out.token; } });
  step("order", {
    endpoint: { method: "POST", path: "/orders" },
    headers: () => ({ Authorization: "Bearer " + token }),
  });
});
`,
      );
      const result = await exportToK6({ journeyFile: journey });
      const src = await readFile(result.outFile, "utf8");
      expect(src).toContain("// ----- inlined from ./helpers/auth.js -----");
      // `export const` from the helper is rewritten to a plain `const`.
      expect(src).toContain("const acquireToken =");
      expect(src).not.toContain("export const acquireToken");
      expect(src).not.toContain("@journey/core");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describeIfK6("exportToK6 — live k6 run", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/pets" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ id: "1" }]));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("bad address");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("k6 run executes the exported script successfully", async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const base = join(testDir, "..", ".test-tmp");
    await mkdir(base, { recursive: true });
    const tmp = await mkdtemp(join(base, "k6-run-"));
    try {
      const journey = join(tmp, "list-pets.journey.ts");
      await writeFile(
        journey,
        `import { journey, step, expect } from "@journey/core";

journey("list pets", () => {
  step("fetch", {
    endpoint: { method: "GET", path: "/pets" },
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});
`,
      );
      const { outFile } = await exportToK6({ journeyFile: journey });
      const child = spawn("k6", ["run", "--vus=1", "--iterations=1", outFile], {
        env: { ...process.env, JOURNEY_BASE_URL: baseUrl },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      const code: number = await new Promise((res, rej) => {
        child.once("error", rej);
        child.once("close", (c) => res(c ?? 0));
      });
      expect(code, `k6 failed:\n${stdout}\n${stderr}`).toBe(0);
      const combined = stdout + stderr;
      expect(combined).toMatch(/list pets.*fetch/);
      expect(combined).toMatch(/checks.*100\.00%/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 60000);

  it("k6 run executes a journey with an inlined sub-journey", async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const base = join(testDir, "..", ".test-tmp");
    await mkdir(base, { recursive: true });
    const tmp = await mkdtemp(join(base, "k6-sub-run-"));
    try {
      const journey = join(tmp, "checkout.journey.ts");
      await writeFile(
        journey,
        `import { journey, step, expect, invokeJourney, output, z } from "@journey/core";

const warmUp = journey(
  "warm up",
  { reusable: true, outputs: z.object({ ok: z.boolean() }) },
  () => {
    step("prefetch pets", {
      endpoint: { method: "GET", path: "/pets" },
      assert(res) {
        expect(res.status).toBe(200);
      },
      after: () => output({ ok: true }),
    });
  },
);

journey("checkout", () => {
  let warmed = false;
  invokeJourney(warmUp, { name: "warm up", after: (out) => { warmed = out.ok; } });
  step("fetch", {
    endpoint: { method: "GET", path: "/pets" },
    assert(res) {
      expect(res.status).toBe(200);
      expect(warmed).toBe(true);
    },
  });
});
`,
      );
      const { outFile } = await exportToK6({ journeyFile: journey });
      const child = spawn("k6", ["run", "--vus=1", "--iterations=1", outFile], {
        env: { ...process.env, JOURNEY_BASE_URL: baseUrl },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      const code: number = await new Promise((res, rej) => {
        child.once("error", rej);
        child.once("close", (c) => res(c ?? 0));
      });
      expect(code, `k6 failed:\n${stdout}\n${stderr}`).toBe(0);
      const combined = stdout + stderr;
      // The sub-journey ran under a k6 group named "warm up".
      expect(combined).toContain("warm up");
      expect(combined).toMatch(/checks.*100\.00%/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 60000);
});
