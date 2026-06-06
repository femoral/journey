import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import newman from "newman";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExportPostman } from "../src/commands/exportPostman.js";

// ── project scaffolding ───────────────────────────────────────────────────────

async function makeProject(): Promise<string> {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const base = join(testDir, "..", ".test-tmp");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "exportPostman-"));
  await mkdir(join(root, "journeys"), { recursive: true });
  return root;
}

async function makeFullProject(envValues: Record<string, string> = {}): Promise<string> {
  const root = await makeProject();
  await writeFile(
    join(root, "journey.config.json"),
    JSON.stringify({
      spec: "openapi.yaml",
      generatedDir: "generated",
      journeysDir: "journeys",
      environmentsDir: "environments",
    }),
  );
  await mkdir(join(root, "environments"), { recursive: true });
  await writeFile(
    join(root, "environments", "test.json"),
    JSON.stringify({ BASE_URL: "http://localhost:8080", API_KEY: "secret-key", ...envValues }),
  );
  return root;
}

// ── journey fixtures ──────────────────────────────────────────────────────────

const ITEMS_JOURNEY = `\
import { journey, step } from "@journey/core";
journey("items api", () => {
  step("list items", { endpoint: { method: "GET", path: "/items" } });
  step("create item", { endpoint: { method: "POST", path: "/items" }, body: { name: "test" } });
});
`;

const ENV_JOURNEY = `\
import { env, journey, step } from "@journey/core";
journey("env test", () => {
  step("fetch", {
    endpoint: { method: "GET", path: "/data" },
    headers: () => ({ "X-Api-Key": env("API_KEY") }),
  });
});
`;

const TAGGED_JOURNEY = `\
import { journey, step } from "@journey/core";
journey("tagged", { tags: ["smoke"] }, () => {
  step("p", { endpoint: { method: "GET", path: "/" } });
});
journey("untagged", () => {
  step("p", { endpoint: { method: "GET", path: "/" } });
});
`;

// A reusable journey + an entry journey that invokes it as a pipeline node.
const SUB_JOURNEY = `\
import { journey, step, output, invokeJourney, z } from "@journey/core";

const acquireToken = journey(
  "auth.token",
  { reusable: true, inputs: z.object({ user: z.string() }), outputs: z.object({ token: z.string() }) },
  (input) => {
    step("exchange", {
      endpoint: { method: "POST", path: "/token" },
      body: () => ({ user: input.user }),
      after: () => output({ token: "t" }),
    });
  },
);

journey("checkout", () => {
  let token = "";
  invokeJourney(acquireToken, {
    name: "authenticate",
    inputs: { user: "alice" },
    cacheKey: (i) => i.user,
    after: (out) => { token = out.token; },
  });
  step("place order", { endpoint: { method: "POST", path: "/orders" }, body: { item: "x" } });
});
`;

// ── Newman wrapper ────────────────────────────────────────────────────────────

function runNewman(
  collectionPath: string,
  environmentPath?: string,
): Promise<newman.NewmanRunSummary> {
  return new Promise((resolve, reject) => {
    newman.run(
      {
        collection: collectionPath,
        ...(environmentPath !== undefined ? { environment: environmentPath } : {}),
        reporters: [],
      },
      (err, summary) => (err ? reject(err) : resolve(summary!)),
    );
  });
}

// ── collection structure tests ────────────────────────────────────────────────

describe("export postman — collection structure", () => {
  it("generates valid collection JSON with correct schema and shape", async () => {
    const root = await makeProject();
    try {
      await writeFile(join(root, "journeys", "items.journey.ts"), ITEMS_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys", "items.journey.ts"),
        outDir,
        tags: [],
      });

      const col = JSON.parse(await readFile(join(outDir, "items.postman_collection.json"), "utf8"));

      expect(col.info.schema).toBe(
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      );
      expect(col.item).toHaveLength(1);

      const folder = col.item[0];
      expect(folder.name).toBe("items api");
      expect(folder.item).toHaveLength(2);

      type Item = {
        name: string;
        request: {
          url: { raw: string; path: string[] };
          method: string;
          body?: { mode: string; raw: string };
        };
      };
      const [get, post] = folder.item as [Item, Item];
      expect(get.name).toBe("list items");
      expect(get.request.method).toBe("GET");
      expect(get.request.url.raw).toBe("{{BASE_URL}}/items");
      expect(get.request.url.path).toEqual(["items"]);

      expect(post.name).toBe("create item");
      expect(post.request.method).toBe("POST");
      expect(post.request.body?.mode).toBe("raw");
      expect(JSON.parse(post.request.body!.raw)).toEqual({ name: "test" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("maps env() calls to {{KEY}} Postman variable syntax", async () => {
    const root = await makeFullProject();
    try {
      await writeFile(join(root, "journeys", "env.journey.ts"), ENV_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys", "env.journey.ts"),
        outDir,
        tags: [],
        projectDir: root,
      });

      const col = JSON.parse(await readFile(join(outDir, "env.postman_collection.json"), "utf8"));
      const headers: Array<{ key: string; value: string }> = col.item[0].item[0].request.header;
      const apiKeyHeader = headers.find((h) => h.key === "X-Api-Key");
      expect(apiKeyHeader?.value).toBe("{{API_KEY}}");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies tag filtering — only tagged journeys appear in collection", async () => {
    const root = await makeProject();
    try {
      await writeFile(join(root, "journeys", "tagged.journey.ts"), TAGGED_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys", "tagged.journey.ts"),
        outDir,
        tags: ["smoke"],
      });

      const col = JSON.parse(
        await readFile(join(outDir, "tagged.postman_collection.json"), "utf8"),
      );
      expect(col.item).toHaveLength(1);
      expect(col.item[0].name).toBe("tagged");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects --out with directory mode", async () => {
    const root = await makeProject();
    try {
      await expect(
        runExportPostman({ path: join(root, "journeys"), out: join(root, "out.json"), tags: [] }),
      ).rejects.toThrow(/--out is only valid with a single journey file/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits a sub-journey as a nested folder with folder-scoped variables", async () => {
    const root = await makeProject();
    try {
      await writeFile(join(root, "journeys", "checkout.journey.ts"), SUB_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys", "checkout.journey.ts"),
        outDir,
        tags: [],
      });

      const col = JSON.parse(
        await readFile(join(outDir, "checkout.postman_collection.json"), "utf8"),
      );
      expect(col.item).toHaveLength(1);

      const folder = col.item[0];
      expect(folder.name).toBe("checkout");
      // Pipeline: [ sub "authenticate", step "place order" ].
      expect(folder.item).toHaveLength(2);

      const sub = folder.item[0];
      expect(sub.name).toBe("authenticate");
      expect(sub.description).toMatch(/Sub-journey/);
      // Inputs become folder-scoped variables.
      expect(sub.variable).toContainEqual({ key: "user", value: "alice" });
      // Child steps live inside the nested folder.
      expect(sub.item).toHaveLength(1);
      expect(sub.item[0].name).toBe("exchange");
      expect(sub.item[0].request.method).toBe("POST");
      expect(sub.item[0].request.url.raw).toContain("/token");

      // The parent's own step is a sibling of the nested folder, not duplicated.
      const order = folder.item[1];
      expect(order.name).toBe("place order");
      expect(order.request.method).toBe("POST");
      expect(order.request.url.raw).toContain("/orders");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("drops NaN query/param values instead of emitting literal NaN", async () => {
    // `env()` is a {{KEY}} placeholder at export time, so `Number(env("X"))`
    // is NaN. The exporter must not bake `limit=NaN` / `/items/NaN`.
    const NUM_ENV_JOURNEY = `\
import { env, journey, step } from "@journey/core";
journey("num env", () => {
  step("list", {
    endpoint: { method: "GET", path: "/items/{id}" },
    params: () => ({ id: Number(env("MISSING_ID")) }),
    query: () => ({ status: "available", limit: Number(env("PET_LIST_LIMIT")) }),
  });
});
`;
    const root = await makeProject();
    try {
      await writeFile(join(root, "journeys", "num.journey.ts"), NUM_ENV_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({ path: join(root, "journeys", "num.journey.ts"), outDir, tags: [] });

      const col = JSON.parse(await readFile(join(outDir, "num.postman_collection.json"), "utf8"));
      const req = col.item[0].item[0].request;
      expect(req.url.raw).not.toContain("NaN");
      // NaN path param falls back to a {{id}} placeholder.
      expect(req.url.raw).toContain("/items/{{id}}");
      // NaN query value is dropped; the resolvable one survives.
      const keys = (req.url.query as Array<{ key: string }>).map((q) => q.key);
      expect(keys).toEqual(["status"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses --name to override collection name", async () => {
    const root = await makeProject();
    try {
      await writeFile(join(root, "journeys", "items.journey.ts"), ITEMS_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys", "items.journey.ts"),
        outDir,
        tags: [],
        name: "My Custom Collection",
      });

      const col = JSON.parse(await readFile(join(outDir, "items.postman_collection.json"), "utf8"));
      expect(col.info.name).toBe("My Custom Collection");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ── bundle (single collection) tests ──────────────────────────────────────────

const SECOND_JOURNEY = `\
import { journey, step } from "@journey/core";
journey("orders api", () => {
  step("list orders", { endpoint: { method: "GET", path: "/orders" } });
});
`;

const CHECKOUT_A = `\
import { journey, step } from "@journey/core";
journey("checkout", () => {
  step("a", { endpoint: { method: "GET", path: "/a" } });
});
`;

const CHECKOUT_B = `\
import { journey, step } from "@journey/core";
journey("checkout", () => {
  step("b", { endpoint: { method: "GET", path: "/b" } });
});
`;

describe("export postman — bundle", () => {
  it("aggregates journeys across files into one collection", async () => {
    const root = await makeFullProject();
    try {
      await writeFile(join(root, "journeys", "items.journey.ts"), ITEMS_JOURNEY);
      await writeFile(join(root, "journeys", "orders.journey.ts"), SECOND_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys"),
        outDir,
        tags: [],
        bundle: true,
        env: "test",
        projectDir: root,
      });

      const col = JSON.parse(
        await readFile(join(outDir, "journeys.postman_collection.json"), "utf8"),
      );
      expect(col.info.name).toBe("journeys");
      const names = (col.item as Array<{ name: string }>).map((f) => f.name).sort();
      expect(names).toEqual(["items api", "orders api"]);

      // Environment written exactly once alongside the single collection.
      const env = JSON.parse(await readFile(join(outDir, "test.postman_environment.json"), "utf8"));
      expect(env.name).toBe("test");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows --out with a directory when --bundle is set", async () => {
    const root = await makeProject();
    try {
      await writeFile(join(root, "journeys", "items.journey.ts"), ITEMS_JOURNEY);
      await writeFile(join(root, "journeys", "orders.journey.ts"), SECOND_JOURNEY);
      const outFile = join(root, "all.postman_collection.json");
      await runExportPostman({
        path: join(root, "journeys"),
        out: outFile,
        bundle: true,
        tags: [],
      });

      const col = JSON.parse(await readFile(outFile, "utf8"));
      expect(col.item).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("honors --name as the bundled collection name", async () => {
    const root = await makeProject();
    try {
      await writeFile(join(root, "journeys", "items.journey.ts"), ITEMS_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys"),
        outDir,
        tags: [],
        bundle: true,
        name: "Suite",
      });

      const col = JSON.parse(
        await readFile(join(outDir, "journeys.postman_collection.json"), "utf8"),
      );
      expect(col.info.name).toBe("Suite");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("suffixes duplicate journey names across files", async () => {
    const root = await makeProject();
    try {
      await writeFile(join(root, "journeys", "a.journey.ts"), CHECKOUT_A);
      await writeFile(join(root, "journeys", "b.journey.ts"), CHECKOUT_B);
      const outDir = join(root, "out");
      await runExportPostman({ path: join(root, "journeys"), outDir, tags: [], bundle: true });

      const col = JSON.parse(
        await readFile(join(outDir, "journeys.postman_collection.json"), "utf8"),
      );
      const names = (col.item as Array<{ name: string }>).map((f) => f.name);
      // Files discovered alphabetically: a.journey.ts → "checkout", b → "checkout (2)".
      expect(names).toEqual(["checkout", "checkout (2)"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ── sub-journey cache ─────────────────────────────────────────────────────────

// Two entry journeys that both invoke the same reusable journey with the same
// cacheKey — in a bundle they share one cache slot, so the child runs once.
const CACHE_BUNDLE = `\
import { journey, step, output, invokeJourney, z } from "@journey/core";

const acquireToken = journey(
  "auth.token",
  { reusable: true, inputs: z.object({ user: z.string() }), outputs: z.object({ token: z.string() }) },
  (input) => {
    step("exchange", {
      endpoint: { method: "POST", path: "/token" },
      body: () => ({ user: input.user }),
      after: () => output({ token: "t" }),
    });
  },
);

journey("first flow", () => {
  invokeJourney(acquireToken, { name: "authenticate", inputs: { user: "alice" }, cacheKey: (i) => i.user });
  step("step a", { endpoint: { method: "GET", path: "/a" } });
});

journey("second flow", () => {
  invokeJourney(acquireToken, { name: "authenticate", inputs: { user: "alice" }, cacheKey: (i) => i.user });
  step("step b", { endpoint: { method: "GET", path: "/b" } });
});
`;

// Same shape, but no cacheKey — the child runs in every journey.
const NOCACHE_BUNDLE = CACHE_BUNDLE.replace(/, cacheKey: \(i\) => i\.user/g, "");

describe("export postman — sub-journey cache", () => {
  it("emits a folder skip + terminal-request window-open for a cached sub-journey", async () => {
    const root = await makeProject();
    try {
      await writeFile(join(root, "journeys", "flows.journey.ts"), CACHE_BUNDLE);
      const outDir = join(root, "out");
      await runExportPostman({ path: join(root, "journeys"), outDir, tags: [], bundle: true });

      const col = JSON.parse(
        await readFile(join(outDir, "journeys.postman_collection.json"), "utf8"),
      );
      const authFolder = col.item[0].item[0];
      expect(authFolder.name).toBe("authenticate");

      // The folder pre-request checks the window and skips while it is valid.
      const pre = authFolder.event
        .find((e: { listen: string }) => e.listen === "prerequest")
        .script.exec.join("\n");
      expect(pre).toContain("pm.execution.skipRequest()");

      // The window is opened on the sub's terminal request test (not a folder
      // test), so a multi-request child runs fully on the cold pass.
      const childTest = authFolder.item[0].event
        .find((e: { listen: string }) => e.listen === "test")
        .script.exec.join("\n");
      // Composite key childName:resolvedKey → sanitized collection-variable name.
      expect(childTest).toContain('"__jc_auth_token_alice"');
      expect(childTest).toContain("pm.collectionVariables.set");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ── environment export tests ──────────────────────────────────────────────────

describe("export postman — environment files", () => {
  it("exports named environment with correct Postman structure", async () => {
    const root = await makeFullProject({ BASE_URL: "http://localhost:8080", TOKEN: "abc" });
    try {
      await writeFile(join(root, "journeys", "items.journey.ts"), ITEMS_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys", "items.journey.ts"),
        outDir,
        tags: [],
        env: "test",
        projectDir: root,
      });

      const env = JSON.parse(await readFile(join(outDir, "test.postman_environment.json"), "utf8"));
      expect(env.name).toBe("test");
      expect(env.values).toEqual(
        expect.arrayContaining([
          { key: "BASE_URL", value: "http://localhost:8080", enabled: true },
          { key: "TOKEN", value: "abc", enabled: true },
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exports all environments when --all-envs is passed", async () => {
    const root = await makeFullProject({ BASE_URL: "http://localhost:8080" });
    try {
      await writeFile(
        join(root, "environments", "staging.json"),
        JSON.stringify({ BASE_URL: "https://staging.example.com" }),
      );
      await writeFile(join(root, "journeys", "items.journey.ts"), ITEMS_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys"),
        outDir,
        tags: [],
        allEnvs: true,
        projectDir: root,
      });

      const testEnv = JSON.parse(
        await readFile(join(outDir, "test.postman_environment.json"), "utf8"),
      );
      const stagingEnv = JSON.parse(
        await readFile(join(outDir, "staging.postman_environment.json"), "utf8"),
      );
      expect(testEnv.name).toBe("test");
      expect(stagingEnv.name).toBe("staging");
      expect(stagingEnv.values).toContainEqual({
        key: "BASE_URL",
        value: "https://staging.example.com",
        enabled: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ── Newman e2e ────────────────────────────────────────────────────────────────

describe("Newman e2e", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  const hits: Array<{ method: string; url: string }> = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      hits.push({ method: req.method ?? "", url: req.url ?? "" });
      if (req.method === "GET" && req.url === "/items") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("[]");
      } else if (req.method === "POST" && req.url === "/items") {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: 1, name: "test" }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("exported collection + environment run against a mock server with no failures", async () => {
    const root = await makeFullProject({ BASE_URL: baseUrl });
    try {
      await writeFile(join(root, "journeys", "smoke.journey.ts"), ITEMS_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys", "smoke.journey.ts"),
        outDir,
        tags: [],
        env: "test",
        projectDir: root,
      });

      const collectionPath = join(outDir, "smoke.postman_collection.json");
      const envPath = join(outDir, "test.postman_environment.json");
      const summary = await runNewman(collectionPath, envPath);

      expect(summary.run.failures).toHaveLength(0);
      expect(summary.run.stats.requests.total).toBe(2);
      expect(hits.some((h) => h.method === "GET" && h.url === "/items")).toBe(true);
      expect(hits.some((h) => h.method === "POST" && h.url === "/items")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

// ── Newman e2e — sub-journey nested folders ───────────────────────────────────

describe("Newman e2e — sub-journeys", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  const hits: Array<{ method: string; url: string }> = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      hits.push({ method: req.method ?? "", url: req.url ?? "" });
      if (req.method === "POST" && req.url === "/token") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ token: "t" }));
      } else if (req.method === "POST" && req.url === "/orders") {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: 1 }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("a collection with a nested sub-journey folder runs cleanly in Newman", async () => {
    const root = await makeFullProject({ BASE_URL: baseUrl });
    try {
      await writeFile(join(root, "journeys", "checkout.journey.ts"), SUB_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys", "checkout.journey.ts"),
        outDir,
        tags: [],
        env: "test",
        projectDir: root,
      });

      const collectionPath = join(outDir, "checkout.postman_collection.json");
      const envPath = join(outDir, "test.postman_environment.json");
      const summary = await runNewman(collectionPath, envPath);

      expect(summary.run.failures).toHaveLength(0);
      // The nested folder's request + the parent step both fire.
      expect(summary.run.stats.requests.total).toBe(2);
      expect(hits.some((h) => h.method === "POST" && h.url === "/token")).toBe(true);
      expect(hits.some((h) => h.method === "POST" && h.url === "/orders")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

// ── Newman e2e — state threading (--thread-state) ─────────────────────────────

// A reusable login whose output token must reach later requests, plus an id
// created mid-flow that feeds a later path param.
const THREAD_JOURNEY = `\
import { journey, step, output, invokeJourney, expect, z } from "@journey/core";

const login = journey(
  "auth",
  { reusable: true, inputs: z.object({ user: z.string() }), outputs: z.object({ token: z.string() }) },
  (input) => {
    step("token", {
      endpoint: { method: "POST", path: "/token" },
      body: () => ({ user: input.user }),
      after: (res) => output({ token: res.body.token }),
    });
  },
);

journey("flow", () => {
  let token = "";
  let id = 0;
  invokeJourney(login, { name: "auth", inputs: { user: "alice" }, after: (out) => { token = out.token; } });
  step("create", {
    endpoint: { method: "POST", path: "/items" },
    headers: () => ({ Authorization: \`Bearer \${token}\` }),
    body: { name: "x" },
    after: (res) => { id = res.body.id; },
  });
  step("get", {
    endpoint: { method: "GET", path: "/items/{id}" },
    params: () => ({ id }),
    headers: () => ({ Authorization: \`Bearer \${token}\` }),
    assert(res) { expect(res.status).toBe(200); },
  });
});
`;

describe("Newman e2e — state threading", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let hits: Array<{ method: string; url: string; auth: string | null }> = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const auth = (req.headers["authorization"] as string) ?? null;
      hits.push({ method: req.method ?? "", url: req.url ?? "", auth });
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "POST" && req.url === "/token") return json(200, { token: "tok-xyz" });
      const authed = auth === "Bearer tok-xyz";
      if (req.method === "POST" && req.url === "/items")
        return authed ? json(201, { id: 7 }) : json(401, {});
      if (req.method === "GET" && req.url === "/items/7")
        return authed ? json(200, { id: 7 }) : json(401, {});
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("threads a sub-journey token and a created id into later requests", async () => {
    const root = await makeFullProject({ BASE_URL: baseUrl });
    hits = [];
    try {
      await writeFile(join(root, "journeys", "flow.journey.ts"), THREAD_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys", "flow.journey.ts"),
        outDir,
        tags: [],
        threadState: true,
        env: "test",
        projectDir: root,
      });

      const summary = await runNewman(
        join(outDir, "flow.postman_collection.json"),
        join(outDir, "test.postman_environment.json"),
      );

      expect(summary.run.failures).toHaveLength(0);
      // Token from the sub-journey output reached both later requests' headers.
      const create = hits.find((h) => h.url === "/items" && h.method === "POST");
      expect(create?.auth).toBe("Bearer tok-xyz");
      // The created id (7) threaded into the GET path param, and carried auth.
      const get = hits.find((h) => h.url === "/items/7");
      expect(get).toBeDefined();
      expect(get?.auth).toBe("Bearer tok-xyz");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

// ── Newman e2e — sub-journey input threading (--thread-state) ──────────────────

// A token minted by one sub-journey is passed into a SECOND sub-journey via a
// DYNAMIC `inputs: () => ({ token })`, and the child uses `input.token` in a
// header. Without input-boundary threading the child sees an empty token → 401
// (regression: github #107).
const INPUT_THREAD_JOURNEY = `\
import { journey, step, output, invokeJourney, expect, z } from "@journey/core";

const login = journey(
  "auth",
  { reusable: true, inputs: z.object({ user: z.string() }), outputs: z.object({ token: z.string() }) },
  (input) => {
    step("token", {
      endpoint: { method: "POST", path: "/token" },
      body: () => ({ user: input.user }),
      after: (res) => output({ token: res.body.token }),
    });
  },
);

const seed = journey(
  "seed",
  { reusable: true, inputs: z.object({ token: z.string() }), outputs: z.object({ id: z.number() }) },
  (input) => {
    step("create", {
      endpoint: { method: "POST", path: "/items" },
      headers: () => ({ Authorization: \`Bearer \${input.token}\` }),
      after: (res) => output({ id: res.body.id }),
    });
  },
);

journey("flow", () => {
  let token = "";
  let id = 0;
  invokeJourney(login, { name: "auth", inputs: { user: "alice" }, after: (out) => { token = out.token; } });
  invokeJourney(seed, { name: "seed", inputs: () => ({ token }), after: (out) => { id = out.id; } });
  step("get", {
    endpoint: { method: "GET", path: "/items/{id}" },
    params: () => ({ id }),
    assert(res) { expect(res.status).toBe(200); },
  });
});
`;

describe("Newman e2e — sub-journey input threading", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let hits: Array<{ method: string; url: string; auth: string | null }> = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const auth = (req.headers["authorization"] as string) ?? null;
      hits.push({ method: req.method ?? "", url: req.url ?? "", auth });
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "POST" && req.url === "/token") return json(200, { token: "tok-xyz" });
      const authed = auth === "Bearer tok-xyz";
      if (req.method === "POST" && req.url === "/items")
        return authed ? json(201, { id: 7 }) : json(401, {});
      if (req.method === "GET" && req.url === "/items/7") return json(200, { id: 7 });
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("threads a token through a sub-journey's dynamic inputs into the child's header", async () => {
    const root = await makeFullProject({ BASE_URL: baseUrl });
    hits = [];
    try {
      await writeFile(join(root, "journeys", "flow.journey.ts"), INPUT_THREAD_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys", "flow.journey.ts"),
        outDir,
        tags: [],
        threadState: true,
        env: "test",
        projectDir: root,
      });

      const summary = await runNewman(
        join(outDir, "flow.postman_collection.json"),
        join(outDir, "test.postman_environment.json"),
      );

      expect(summary.run.failures).toHaveLength(0);
      // The token reached the SECOND sub-journey's child header via its dynamic
      // input — the create succeeded (would be 401 with an empty token).
      const create = hits.find((h) => h.url === "/items" && h.method === "POST");
      expect(create?.auth).toBe("Bearer tok-xyz");
      // The created id then threaded into the later GET path param.
      expect(hits.some((h) => h.url === "/items/7")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

// ── Newman e2e — multi-request sub-journey cache ──────────────────────────────

// A reusable fixture with TWO requests, cached and invoked from two journeys.
// The cold pass must run BOTH child requests (the old folder-test set opened the
// window mid-folder and skipped the second); the cache hit skips both.
const MULTI_REQ_BUNDLE = `\
import { journey, step, invokeJourney, z } from "@journey/core";

const seed = journey("fixtures.seed", { reusable: true }, () => {
  step("a", { endpoint: { method: "POST", path: "/a" } });
  step("b", { endpoint: { method: "POST", path: "/b" } });
});

journey("one", () => {
  invokeJourney(seed, { name: "seed", cacheKey: "k" });
  step("done", { endpoint: { method: "GET", path: "/done" } });
});

journey("two", () => {
  invokeJourney(seed, { name: "seed", cacheKey: "k" });
  step("done", { endpoint: { method: "GET", path: "/done" } });
});
`;

describe("Newman e2e — multi-request sub-journey cache", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let hits: string[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      hits.push(req.url ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("runs a multi-request cached child fully cold, then skips all of it on a hit", async () => {
    const root = await makeFullProject({ BASE_URL: baseUrl });
    hits = [];
    try {
      await writeFile(join(root, "journeys", "mr.journey.ts"), MULTI_REQ_BUNDLE);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys"),
        outDir,
        tags: [],
        bundle: true,
        env: "test",
        projectDir: root,
      });

      const summary = await runNewman(
        join(outDir, "journeys.postman_collection.json"),
        join(outDir, "test.postman_environment.json"),
      );

      expect(summary.run.failures).toHaveLength(0);
      // Cold pass ran BOTH child requests (no mid-folder over-skip)…
      expect(hits.filter((u) => u === "/a")).toHaveLength(1);
      expect(hits.filter((u) => u === "/b")).toHaveLength(1);
      // …the second journey hit the cache and skipped both; its own step ran.
      expect(hits.filter((u) => u === "/done")).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

// ── Newman e2e — body & query threading ───────────────────────────────────────

// A created id + kind feed a later dynamic request body and a dynamic query.
const BODY_QUERY_JOURNEY = `\
import { journey, step, expect } from "@journey/core";

journey("body and query", () => {
  let id = 0;
  let kind = "";
  step("create", {
    endpoint: { method: "POST", path: "/things" },
    body: { name: "x" },
    after: (res) => { id = res.body.id; kind = res.body.kind; },
  });
  step("note", {
    endpoint: { method: "POST", path: "/things/{id}/notes" },
    params: () => ({ id }),
    body: () => ({ text: \`note for \${id}\` }),
    assert(res) { expect(res.status).toBe(201); },
  });
  step("list", {
    endpoint: { method: "GET", path: "/things" },
    query: () => ({ kind }),
    assert(res) { expect(res.status).toBe(200); },
  });
});
`;

describe("Newman e2e — body & query threading", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let hits: Array<{ method: string; url: string; body: string }> = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        hits.push({ method: req.method ?? "", url: req.url ?? "", body: raw });
        const json = (code: number, body: unknown) => {
          res.writeHead(code, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (req.method === "POST" && req.url === "/things")
          return json(201, { id: 9, kind: "gadget" });
        if (req.method === "POST" && req.url === "/things/9/notes") {
          const ok = (() => {
            try {
              return String(JSON.parse(raw).text).includes("9");
            } catch {
              return false;
            }
          })();
          return json(ok ? 201 : 400, { ok });
        }
        if (req.method === "GET" && req.url === "/things?kind=gadget") return json(200, []);
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("threads a created id into a later body and a captured value into a query", async () => {
    const root = await makeFullProject({ BASE_URL: baseUrl });
    hits = [];
    try {
      await writeFile(join(root, "journeys", "bq.journey.ts"), BODY_QUERY_JOURNEY);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys", "bq.journey.ts"),
        outDir,
        tags: [],
        threadState: true,
        env: "test",
        projectDir: root,
      });

      const summary = await runNewman(
        join(outDir, "bq.postman_collection.json"),
        join(outDir, "test.postman_environment.json"),
      );

      expect(summary.run.failures).toHaveLength(0);
      // Dynamic body carried the created id (9) into POST /things/9/notes.
      const note = hits.find((h) => h.url === "/things/9/notes");
      expect(note).toBeDefined();
      expect(JSON.parse(note!.body).text).toBe("note for 9");
      // Dynamic query carried the captured kind into GET /things?kind=gadget.
      expect(hits.some((h) => h.url === "/things?kind=gadget")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

// ── Newman e2e — cache + threading fold (--thread-state) ──────────────────────

// Two journeys share a cacheKey'd auth sub-journey AND consume its token. The
// second journey hits the cache (login skipped) — the token must still thread.
const CACHE_THREAD_BUNDLE = `\
import { journey, step, output, invokeJourney, expect, z } from "@journey/core";

const acquireToken = journey(
  "auth.token",
  { reusable: true, inputs: z.object({ user: z.string() }), outputs: z.object({ token: z.string() }) },
  (input) => {
    step("exchange", {
      endpoint: { method: "POST", path: "/token" },
      body: () => ({ user: input.user }),
      after: (res) => output({ token: res.body.token }),
    });
  },
);

journey("first", () => {
  let token = "";
  invokeJourney(acquireToken, { name: "authenticate", inputs: { user: "alice" }, cacheKey: (i) => i.user, after: (out) => { token = out.token; } });
  step("read one", {
    endpoint: { method: "GET", path: "/protected" },
    headers: () => ({ Authorization: \`Bearer \${token}\` }),
    assert(res) { expect(res.status).toBe(200); },
  });
});

journey("second", () => {
  let token = "";
  invokeJourney(acquireToken, { name: "authenticate", inputs: { user: "alice" }, cacheKey: (i) => i.user, after: (out) => { token = out.token; } });
  step("read two", {
    endpoint: { method: "GET", path: "/protected" },
    headers: () => ({ Authorization: \`Bearer \${token}\` }),
    assert(res) { expect(res.status).toBe(200); },
  });
});
`;

describe("Newman e2e — cache + threading fold", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let hits: Array<{ method: string; url: string; auth: string | null }> = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const auth = (req.headers["authorization"] as string) ?? null;
      hits.push({ method: req.method ?? "", url: req.url ?? "", auth });
      if (req.method === "POST" && req.url === "/token") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ token: "tok-9" }));
      } else if (req.url === "/protected") {
        res.writeHead(auth === "Bearer tok-9" ? 200 : 401, { "content-type": "application/json" });
        res.end(JSON.stringify({}));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("a cache hit still threads the child's output to later requests", async () => {
    const root = await makeFullProject({ BASE_URL: baseUrl });
    hits = [];
    try {
      await writeFile(join(root, "journeys", "ct.journey.ts"), CACHE_THREAD_BUNDLE);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys"),
        outDir,
        tags: [],
        bundle: true,
        threadState: true,
        env: "test",
        projectDir: root,
      });

      const summary = await runNewman(
        join(outDir, "journeys.postman_collection.json"),
        join(outDir, "test.postman_environment.json"),
      );

      expect(summary.run.failures).toHaveLength(0);
      // Login ran once (second journey hit the cache and skipped it)…
      expect(hits.filter((h) => h.url === "/token").length).toBe(1);
      // …yet BOTH protected reads carried the threaded token.
      const protectedHits = hits.filter((h) => h.url === "/protected");
      expect(protectedHits).toHaveLength(2);
      expect(protectedHits.every((h) => h.auth === "Bearer tok-9")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

// ── Newman e2e — sub-journey cache ────────────────────────────────────────────

describe("Newman e2e — sub-journey cache", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let hits: Array<{ method: string; url: string }> = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      hits.push({ method: req.method ?? "", url: req.url ?? "" });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: "t" }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const tokenHits = () => hits.filter((h) => h.method === "POST" && h.url === "/token").length;

  it("runs a shared cached sub-journey once across a bundled collection", async () => {
    const root = await makeFullProject({ BASE_URL: baseUrl });
    hits = [];
    try {
      await writeFile(join(root, "journeys", "flows.journey.ts"), CACHE_BUNDLE);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys"),
        outDir,
        tags: [],
        bundle: true,
        env: "test",
        projectDir: root,
      });

      const summary = await runNewman(
        join(outDir, "journeys.postman_collection.json"),
        join(outDir, "test.postman_environment.json"),
      );

      expect(summary.run.failures).toHaveLength(0);
      // The second journey's `authenticate` folder is skipped — /token once.
      expect(tokenHits()).toBe(1);
      // Both parents' own steps still fire.
      expect(hits.some((h) => h.url === "/a")).toBe(true);
      expect(hits.some((h) => h.url === "/b")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("runs the sub-journey in every flow without a cacheKey", async () => {
    const root = await makeFullProject({ BASE_URL: baseUrl });
    hits = [];
    try {
      await writeFile(join(root, "journeys", "flows.journey.ts"), NOCACHE_BUNDLE);
      const outDir = join(root, "out");
      await runExportPostman({
        path: join(root, "journeys"),
        outDir,
        tags: [],
        bundle: true,
        env: "test",
        projectDir: root,
      });

      const summary = await runNewman(
        join(outDir, "journeys.postman_collection.json"),
        join(outDir, "test.postman_environment.json"),
      );

      expect(summary.run.failures).toHaveLength(0);
      expect(tokenHits()).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
