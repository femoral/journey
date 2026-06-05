import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportToK6 } from "../src/index.js";

/**
 * Sub-journey cache parity for the k6 shim. The cache is per-VU and in-memory:
 * module-scoped state in the emitted script persists across a VU's iterations.
 * We simulate a VU by instantiating the script once and calling its entry
 * `main()` repeatedly, then assert which HTTP requests fired.
 */

const BASE = "http://cache.test";

interface Captured {
  method: string;
  url: string;
  headers: Record<string, string>;
}

/** Emit a k6 script for an inline journey source and return the source string. */
async function emit(src: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "journey-k6-cache-"));
  try {
    const file = join(dir, "c.journey.ts");
    await writeFile(file, src, "utf8");
    const { source } = await exportToK6({ journeyFile: file, outDir: dir });
    return source;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Instantiate the emitted script with stubbed k6 globals (as in parity.test.ts)
 * and hand back the captured-request array plus the entry function so the test
 * can drive iterations itself. `now` lets the TTL test inject a fake clock —
 * the shim only ever calls `Date.now()`.
 */
function instantiate(
  source: string,
  opts: { env?: Record<string, string>; now?: () => number } = {},
): { requests: Captured[]; main: () => void } {
  const runnable = source
    .replace(/^import .*$/gm, "")
    .replace("export default function ()", "return function ()");

  const requests: Captured[] = [];
  const http = {
    request(
      method: string,
      url: string,
      _body: unknown,
      params?: { headers?: Record<string, string> },
    ) {
      requests.push({ method, url, headers: params?.headers ?? {} });
      return {
        status: 200,
        headers: { "Content-Type": "application/json" },
        json: () => ({ ok: true, id: 1, token: "tok" }),
        body: '{"ok":true,"id":1,"token":"tok"}',
      };
    },
  };
  const check = (value: unknown, predicates: Record<string, (v: unknown) => boolean>): boolean => {
    let ok = true;
    for (const name of Object.keys(predicates)) if (!predicates[name]!(value)) ok = false;
    return ok;
  };
  const group = (_label: string, fn: () => void): void => {
    fn();
  };
  const env = { JOURNEY_BASE_URL: BASE, ...(opts.env ?? {}) };
  const DateStub = opts.now ? { now: opts.now } : Date;

  const factory = new Function("http", "check", "group", "__ENV", "console", "Date", runnable);
  const main = factory(http, check, group, env, console, DateStub) as () => void;
  return { requests, main };
}

const count = (reqs: Captured[], suffix: string): number =>
  reqs.filter((r) => r.url.endsWith(suffix)).length;

// A reusable sub-journey (`POST /seed`) cached by a static key, plus a parent
// that consumes its output and then hits `GET /use`.
const CACHED = `\
import { journey, step, invokeJourney, output, z } from "@journey/core";

const seed = journey("seed", { reusable: true, outputs: z.object({ id: z.number() }) }, () => {
  step("create", {
    endpoint: { method: "POST", path: "/seed" },
    after: (res) => output({ id: res.body.id }),
  });
});

journey("uses cache", () => {
  let seenId = 0;
  invokeJourney(seed, {
    cacheKey: "fixed",
    after: (out) => { seenId = out.id; },
  });
  step("use", {
    endpoint: { method: "GET", path: "/use" },
    headers: () => ({ "X-Seed-Id": String(seenId) }),
  });
});
`;

const CACHED_TTL = `\
import { journey, step, invokeJourney, output, z } from "@journey/core";

const seed = journey("seed", { reusable: true, outputs: z.object({ id: z.number() }) }, () => {
  step("create", { endpoint: { method: "POST", path: "/seed" }, after: (res) => output({ id: res.body.id }) });
});

journey("uses ttl cache", () => {
  invokeJourney(seed, { cacheKey: "k", cacheTtlMs: 1000 });
  step("use", { endpoint: { method: "GET", path: "/use" } });
});
`;

describe("k6 shim — sub-journey cache", () => {
  it("runs a cacheKey'd sub-journey once across VU iterations, but the parent every time", async () => {
    const source = await emit(CACHED);
    const { requests, main } = instantiate(source);
    main();
    main();

    // Child request fired once (cache hit on the second iteration)…
    expect(count(requests, "/seed")).toBe(1);
    // …while the parent pipeline ran both times.
    expect(count(requests, "/use")).toBe(2);

    // The parent's `after` ran with the replayed cached output on the hit, so
    // both `GET /use` requests carry the seeded id.
    const uses = requests.filter((r) => r.url.endsWith("/use"));
    expect(uses.map((r) => r.headers["X-Seed-Id"])).toEqual(["1", "1"]);
  });

  it("re-runs the child every iteration when JOURNEY_CACHE=off", async () => {
    const source = await emit(CACHED);
    const { requests, main } = instantiate(source, { env: { JOURNEY_CACHE: "off" } });
    main();
    main();

    expect(count(requests, "/seed")).toBe(2);
    expect(count(requests, "/use")).toBe(2);
  });

  it("expires a TTL'd entry and re-runs the child after it goes stale", async () => {
    const source = await emit(CACHED_TTL);
    let clock = 1000;
    const { requests, main } = instantiate(source, { now: () => clock });

    main(); // miss → POST /seed, stores expiresAt = 1000 + 1000 = 2000
    clock = 1500;
    main(); // still fresh (1500 < 2000) → hit, no POST /seed
    expect(count(requests, "/seed")).toBe(1);

    clock = 2500;
    main(); // expired (2500 >= 2000) → miss, POST /seed again
    expect(count(requests, "/seed")).toBe(2);
  });
});
