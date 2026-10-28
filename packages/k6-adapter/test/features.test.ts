import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportToK6, type ExportK6Options } from "../src/index.js";
import { instantiate, type CapturedRequest, type StubResponse } from "./harness.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "journey-k6-feat-"));
  await writeFile(join(root, "journey.config.json"), "{}");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Write `files` under the temp project, export `journeys/main.journey.ts`. */
async function emit(
  files: Record<string, string>,
  opts: Omit<ExportK6Options, "journeyFile"> = {},
): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  }
  const { source } = await exportToK6({
    journeyFile: join(root, "journeys", "main.journey.ts"),
    outDir: join(root, "k6"),
    ...opts,
  });
  return source;
}

const json = (status: number, body: unknown): StubResponse => ({
  status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const AUTH_LIB = `import { journey, step, output, expect, z } from "@usejourney/core";
export const authSession = journey("auth session", { reusable: true, outputs: z.object({ sid: z.string() }) }, () => {
  let code = "";
  step("auth", {
    endpoint: { method: "POST", path: "/token/authCode" },
    body: "cif=1",
    assert: (res) => expect(res.status).toBe(200),
    after: (res) => { code = res.body.code; },
  });
  step("session", {
    endpoint: { method: "POST", path: "/v1/sessions" },
    body: () => ({ code }),
    after: (res) => output({ sid: res.body.sid }),
  });
});
`;

describe("custom metrics (metricsPrefix)", () => {
  const FLOW = `import { journey, step, invokeJourney, expect } from "@usejourney/core";
import { authSession } from "./lib/auth.js";
journey("cards", () => {
  let sid = "";
  invokeJourney(authSession, { after: (o) => { sid = o.sid; } });
  step("Fetch cards list", {
    endpoint: { method: "GET", path: "/v1/cards" },
    headers: () => ({ Authorization: "Sid " + sid }),
    assert: (res) => expect(res.status).toBe(200),
  });
  step("update card preferences", {
    endpoint: { method: "PUT", path: "/v1/cards/k/preferences" },
    metric: "update_card_pref",
    body: { on: true },
  });
  step("noise", { endpoint: { method: "GET", path: "/noise" }, metric: false });
});
`;
  const respond = (r: CapturedRequest): StubResponse => {
    if (r.url.endsWith("/token/authCode")) return { ...json(200, { code: "c1" }), durationMs: 5 };
    if (r.url.endsWith("/v1/sessions")) return { ...json(201, { sid: "s1" }), durationMs: 7 };
    return { ...json(200, {}), durationMs: 11 };
  };

  it("declares a Trend + Counter per step (sub-journey steps included) and per flow", async () => {
    const source = await emit(
      { "journeys/lib/auth.ts": AUTH_LIB, "journeys/main.journey.ts": FLOW },
      { metricsPrefix: "wave" },
    );
    expect(source).toContain('import { Trend, Counter } from "k6/metrics"');
    const h = instantiate(source, { respond });
    // Declared at init, before any iteration ran.
    expect(Object.keys(h.metrics).sort()).toEqual([
      "wave_auth_duration",
      "wave_auth_tps",
      "wave_fetch_cards_list_duration",
      "wave_fetch_cards_list_tps",
      "wave_flow_duration",
      "wave_flow_tps",
      "wave_session_duration",
      "wave_session_tps",
      "wave_update_card_pref_duration",
      "wave_update_card_pref_tps",
    ]);
    h.main();
    h.main();
    expect(h.metrics).toEqual({
      wave_auth_duration: [5, 5],
      wave_auth_tps: [1, 1],
      wave_session_duration: [7, 7],
      wave_session_tps: [1, 1],
      wave_fetch_cards_list_duration: [11, 11],
      wave_fetch_cards_list_tps: [1, 1],
      wave_update_card_pref_duration: [11, 11],
      wave_update_card_pref_tps: [1, 1],
      // Sum of every request in the iteration, `metric: false` steps included.
      wave_flow_duration: [45, 45],
      wave_flow_tps: [1, 1],
    });
    expect(h.groups).toEqual(["auth session", "auth session"]);
  });

  it("emits no metrics without a prefix and rejects an invalid one", async () => {
    const files = { "journeys/lib/auth.ts": AUTH_LIB, "journeys/main.journey.ts": FLOW };
    const h = instantiate(await emit(files), { respond });
    h.main();
    expect(h.metrics).toEqual({});
    await expect(emit(files, { metricsPrefix: "1bad-prefix" })).rejects.toThrow(
      /invalid metrics prefix/,
    );
  });
});

describe("async hooks and fetch", () => {
  it("awaits async lazy values and an async after() that uses fetch", async () => {
    const source = await emit({
      "journeys/main.journey.ts": `import { journey, step, fetch, expect } from "@usejourney/core";
journey("async", () => {
  let token = "";
  step("first", {
    endpoint: { method: "GET", path: "/first" },
    headers: async () => ({ "X-Async": "yes" }),
    after: async () => {
      const r = await fetch("http://side.test/token", { method: "POST", headers: { "X-H": "1" }, body: "x" });
      expect(r.ok).toBe(true);
      expect(r.headers.get("content-type")).toBe("application/json");
      token = ((await r.json()) as { token: string }).token;
    },
  });
  step("second", {
    endpoint: { method: "GET", path: "/second" },
    headers: () => ({ Authorization: "Bearer " + token }),
    assert: async (res) => { expect(res.status).toBe(200); },
  });
});
`,
    });
    const h = instantiate(source, {
      respond: (r) => (r.url.endsWith("/token") ? json(200, { token: "t-9" }) : json(200, {})),
    });
    await h.main();
    expect(h.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET http://k6.test/first",
      "POST http://side.test/token",
      "GET http://k6.test/second",
    ]);
    expect(h.requests[0]!.headers).toEqual({ "X-Async": "yes" });
    expect(h.requests[1]).toEqual({
      method: "POST",
      url: "http://side.test/token",
      body: "x",
      headers: { "X-H": "1" },
    });
    expect(h.requests[2]!.headers).toEqual({ Authorization: "Bearer t-9" });
    expect(h.checks).toEqual([{ name: "async › second", ok: true }]);
  });

  it("rejects fetch on a network error (status 0)", async () => {
    const source = await emit({
      "journeys/main.journey.ts": `import { journey, step, fetch } from "@usejourney/core";
journey("net", () => {
  step("s", { endpoint: { method: "GET", path: "/s" }, after: async () => { await fetch("http://down.test/"); } });
});
`,
    });
    const h = instantiate(source, {
      respond: (r) =>
        r.url.startsWith("http://down.test")
          ? { status: 0, headers: {}, body: "", error: "dial tcp: refused" }
          : json(200, {}),
    });
    await expect(Promise.resolve(h.main())).rejects.toThrow(/fetch failed/);
  });
});

describe("multipart and binary bodies", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

  it("pre-loads string-literal fileFrom paths with open() relative to the script", async () => {
    await mkdir(join(root, "fixtures"));
    await writeFile(join(root, "fixtures", "id.png"), PNG);
    const source = await emit({
      "journeys/main.journey.ts": `import { journey, step, multipart, fileFrom } from "@usejourney/core";
journey("upload", () => {
  step("multipart", {
    endpoint: { method: "POST", path: "/scan" },
    headers: { "Content-Type": "multipart/form-data", "X-Keep": "1" },
    body: () => multipart({ kind: "id", n: 2, file: fileFrom("fixtures/id.png", "image/png") }),
  });
  step("raw", { endpoint: { method: "PUT", path: "/raw" }, body: fileFrom("fixtures/id.png", "image/png") });
  step("bytes", { endpoint: { method: "PUT", path: "/bytes" }, body: () => new Uint8Array([1, 2, 250]) });
  step("text form", { endpoint: { method: "POST", path: "/form" }, body: multipart({ a: "1" }) });
});
`,
    });
    // k6/ is one level below the project root.
    expect(source).toContain('"fixtures/id.png": open("../fixtures/id.png", "b")');
    const buf = PNG.buffer.slice(0);
    const h = instantiate(source, { files: { "../fixtures/id.png": buf } });
    h.main();
    const [mp, raw, bytes, form] = h.requests;
    // Content-Type dropped so k6 can set multipart/form-data with its boundary.
    expect(mp!.headers).toEqual({ "X-Keep": "1" });
    expect(mp!.body).toEqual({
      kind: "id",
      n: "2",
      file: { data: buf, filename: "id.png", content_type: "image/png" },
    });
    expect(raw!.headers).toEqual({ "Content-Type": "image/png" });
    expect(raw!.body).toBe(buf);
    expect(bytes!.headers).toEqual({ "Content-Type": "application/octet-stream" });
    expect([...new Uint8Array(bytes!.body as ArrayBuffer)]).toEqual([1, 2, 250]);
    const ct = form!.headers["Content-Type"]!;
    const boundary = ct.replace("multipart/form-data; boundary=", "");
    expect(form!.body).toBe(
      `--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--${boundary}--\r\n`,
    );
  });

  it("fails the export when a fileFrom path does not exist", async () => {
    await expect(
      emit({
        "journeys/main.journey.ts": `import { journey, step, fileFrom } from "@usejourney/core";
journey("u", () => { step("s", { endpoint: { method: "PUT", path: "/x" }, body: fileFrom("fixtures/missing.bin") }); });
`,
      }),
    ).rejects.toThrow(
      /main\.journey\.ts: fileFrom\("fixtures\/missing\.bin"\) → .* does not exist/,
    );
  });
});

describe("module bundling", () => {
  it("supports namespace imports, aliased imports, default exports and clashing names", async () => {
    const source = await emit({
      "journeys/lib/a.ts": `export const BASE = "/a";\nexport default function pathA(x: string) { return BASE + "/" + x; }\n`,
      "journeys/lib/b.ts": `const BASE = "/b";\nexport const pathB = (x: string) => BASE + "/" + x;\nexport const HEADERS = { "X-Lib": "b" };\n`,
      "journeys/main.journey.ts": `import { journey, step } from "@usejourney/core";
import pathA from "./lib/a.js";
import * as libB from "./lib/b";
import { HEADERS as H } from "./lib/b.js";
const BASE = "/main";
journey("imports", () => {
  step("a", { endpoint: { method: "GET", path: pathA("1") } });
  step("b", { endpoint: { method: "GET", path: libB.pathB("2") }, headers: H });
  step("main", { endpoint: { method: "GET", path: BASE } });
});
`,
    });
    const h = instantiate(source);
    h.main();
    expect(h.requests.map((r) => [r.url, r.headers])).toEqual([
      ["http://k6.test/a/1", {}],
      ["http://k6.test/b/2", { "X-Lib": "b" }],
      ["http://k6.test/main", {}],
    ]);
  });

  it("fails loudly on npm imports, naming the specifier and file", async () => {
    await expect(
      emit({
        "journeys/lib/h.ts": `import * as R from "ramda";\nexport const isNil = R.isNil;\n`,
        "journeys/main.journey.ts": `import { journey, step } from "@usejourney/core";
import { isNil } from "./lib/h.js";
journey("npm", () => { step("s", { endpoint: { method: "GET", path: isNil(null) ? "/y" : "/n" } }); });
`,
      }),
    ).rejects.toThrow(/lib[/\\]h\.ts:1:\d+: unsupported import "ramda"/);
  });

  it("fails on core exports the k6 shim does not provide", async () => {
    await expect(
      emit({
        "journeys/main.journey.ts": `import { journey, step, loadConfig } from "@usejourney/core";
journey("x", () => { step("s", { endpoint: { method: "GET", path: String(loadConfig) } }); });
`,
      }),
    ).rejects.toThrow(/loadConfig/);
  });

  it("rejects `export default` in the journey file", async () => {
    await expect(
      emit({
        "journeys/main.journey.ts": `import { journey } from "@usejourney/core";\njourney("x", () => {});\nexport default function () {}\n`,
      }),
    ).rejects.toThrow(/cannot `export default`/);
  });
});

describe("profile selection via `export const options`", () => {
  const PROFILES = `declare const __ENV: Record<string, string> | undefined;
const PROFILES: Record<string, { stages: Array<{ duration: string; target: number }> }> = {
  "0D": { stages: [{ duration: "1m", target: 1 }] },
  "2X": { stages: [{ duration: "2m", target: 40 }] },
};
export function pickProfile() {
  const name = typeof __ENV !== "undefined" ? __ENV.OPT_NAME : undefined;
  return PROFILES[(name ?? "0D").toUpperCase()] ?? PROFILES["0D"]!;
}
`;
  const FLOW = `import { journey, step } from "@usejourney/core";
import { pickProfile } from "./lib/profiles.js";
export const options = pickProfile();
journey("profiled", { tags: ["load"] }, () => {
  step("ping", { endpoint: { method: "GET", path: "/ping" } });
});
`;

  it("re-exports the journey's options, evaluated against __ENV at init", async () => {
    const source = await emit(
      { "journeys/lib/profiles.ts": PROFILES, "journeys/main.journey.ts": FLOW },
      { metricsPrefix: "wave" },
    );
    expect(instantiate(source, { env: { OPT_NAME: "2X" } }).exports.options).toEqual({
      stages: [{ duration: "2m", target: 40 }],
    });
    const h = instantiate(source);
    expect(h.exports.options).toEqual({ stages: [{ duration: "1m", target: 1 }] });
    h.main();
    expect(h.metrics.wave_ping_tps).toEqual([1]);
  });

  it("rejects a file that has both a k6 block and `export const options`", async () => {
    await expect(
      emit(
        { "journeys/lib/profiles.ts": PROFILES, "journeys/main.journey.ts": FLOW },
        { k6Options: { vus: 1 } },
      ),
    ).rejects.toThrow(/both a journey `k6` block and `export const options`/);
  });
});

describe("shim parity details", () => {
  it("implements every core matcher", async () => {
    const source = await emit({
      "journeys/main.journey.ts": `import { journey, step, expect } from "@usejourney/core";
journey("m", () => {
  step("pass", {
    endpoint: { method: "GET", path: "/p" },
    assert: (res) => {
      expect(res.body.n).toBeGreaterThan(1);
      expect(res.body.n).toBeGreaterThanOrEqual(2);
      expect(res.body.n).toBeLessThan(3);
      expect(res.body.n).toBeLessThanOrEqual(2);
      expect(res.body.list).toHaveLength(2);
      expect("abc").toHaveLength(3);
    },
  });
  step("fail", { endpoint: { method: "GET", path: "/f" }, assert: (res) => expect(res.body.n).toBeLessThan(2) });
  step("type", { endpoint: { method: "GET", path: "/t" }, assert: () => expect("2").toBeGreaterThan(1) });
});
`,
    });
    const h = instantiate(source, { respond: () => json(200, { n: 2, list: [1, 2] }) });
    h.main();
    expect(h.checks).toEqual([
      { name: "m › pass", ok: true },
      { name: "m › fail", ok: false },
      { name: "m › type", ok: false },
    ]);
    expect(h.errors).toEqual([
      "m › fail: expected 2 to be less than 2",
      "m › type: toBeGreaterThan is only supported on numbers (got string)",
    ]);
  });

  const HALT = `import { journey, step, expect } from "@usejourney/core";
journey("halt", () => {
  step("bad", { endpoint: { method: "GET", path: "/bad" }, assert: (res) => expect(res.status).toBe(200) });
  step("next", { endpoint: { method: "GET", path: "/next" } });
});
`;

  it("stops the iteration on a failed assert only with haltOnFailure", async () => {
    const respond = (r: CapturedRequest) => json(r.url.endsWith("/bad") ? 500 : 200, {});
    const carryOn = instantiate(await emit({ "journeys/main.journey.ts": HALT }), { respond });
    carryOn.main();
    expect(carryOn.requests.map((r) => r.url)).toEqual([
      "http://k6.test/bad",
      "http://k6.test/next",
    ]);

    const halted = instantiate(
      await emit({ "journeys/main.journey.ts": HALT }, { haltOnFailure: true, metricsPrefix: "w" }),
      { respond },
    );
    expect(halted.main()).toBeUndefined();
    expect(halted.requests.map((r) => r.url)).toEqual(["http://k6.test/bad"]);
    expect(halted.checks).toEqual([{ name: "halt › bad", ok: false }]);
    // An incomplete iteration records no flow sample.
    expect(halted.metrics.w_flow_tps).toEqual([]);
  });

  it("falls back to BASE_URL and lowercases response header keys", async () => {
    const source = await emit({
      "journeys/main.journey.ts": `import { journey, step, expect } from "@usejourney/core";
journey("b", () => {
  step("s", { endpoint: { method: "GET", path: "/s" }, assert: (res) => expect(res.headers["x-trace"]).toBe("t1") });
});
`,
    });
    const h = instantiate(source, {
      env: { JOURNEY_BASE_URL: "", BASE_URL: "http://fallback.test" },
      respond: () => ({ status: 200, headers: { "X-Trace": "t1" }, body: "" }),
    });
    h.main();
    expect(h.requests[0]!.url).toBe("http://fallback.test/s");
    expect(h.checks).toEqual([{ name: "b › s", ok: true }]);
  });
});
