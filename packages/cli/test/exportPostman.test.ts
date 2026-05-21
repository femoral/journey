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
