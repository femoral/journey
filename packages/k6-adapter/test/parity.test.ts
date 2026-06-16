import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { clearRegistry, runAllRegistered } from "@usejourney/core";
import { describe, expect, it } from "vitest";
import { exportToK6 } from "../src/index.js";

/**
 * Drift guard: the k6 adapter ships its own `shim.ts` re-implementation of the
 * runtime primitives (`journey`/`step`/`invokeJourney`/`expect`/`output`).
 * Nothing else fails if that shim drifts from `@usejourney/core`'s real run loop —
 * a silent gap between `journey run` and `journey export k6`.
 *
 * This test runs one fixture journey two ways and asserts the observable HTTP
 * behaviour is identical:
 *   Path A — `@usejourney/core` `runAllRegistered` with an injected `fetchImpl`.
 *   Path B — the actual emitted k6 script, executed with stubbed k6 globals.
 *
 * It does NOT merge the two implementations (the source-inlining strategy is
 * deliberate — k6 load tests re-evaluate closures per VU iteration). It only
 * pins their observable behaviour together.
 */

const BASE = "http://parity.test";

interface CapturedRequest {
  method: string;
  url: string;
  body: string | null;
  headers: Record<string, string>;
}

function lowerKeys(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

function normalize(
  method: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
): CapturedRequest {
  return {
    method: method.toUpperCase(),
    url,
    body: body == null ? null : String(body),
    headers: lowerKeys(headers),
  };
}

/** Path A — drive the fixture through the real `@usejourney/core` run loop. */
async function runViaCore(): Promise<CapturedRequest[]> {
  const requests: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push(
      normalize(
        init?.method ?? "GET",
        String(input),
        init?.body,
        (init?.headers as Record<string, string>) ?? {},
      ),
    );
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  clearRegistry();
  await import("./fixtures/parity.journey.js");
  await runAllRegistered({ baseUrl: BASE, fetchImpl });
  return requests;
}

/** Path B — execute the emitted k6 script with stubbed k6 globals. */
async function runViaK6Shim(): Promise<{ requests: CapturedRequest[]; groups: string[] }> {
  const fixture = fileURLToPath(new URL("./fixtures/parity.journey.ts", import.meta.url));
  // exportToK6 always writes the emitted script; aim it at a temp dir so the
  // repo source tree stays clean. Only `source` is used here.
  const outDir = await mkdtemp(join(tmpdir(), "journey-k6-parity-"));
  let source: string;
  try {
    ({ source } = await exportToK6({ journeyFile: fixture, outDir }));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }

  // Drop the `k6/http` + `k6` imports (we inject those) and turn the
  // `export default function` entry point into a value the factory returns.
  const runnable = source
    .replace(/^import .*$/gm, "")
    .replace("export default function ()", "return function ()");

  const requests: CapturedRequest[] = [];
  const groups: string[] = [];

  const http = {
    request(
      method: string,
      url: string,
      body: unknown,
      params?: { headers?: Record<string, string> },
    ) {
      requests.push(normalize(method, url, body, params?.headers ?? {}));
      return {
        status: 200,
        headers: { "Content-Type": "application/json" },
        json: () => ({ ok: true }),
        body: '{"ok":true}',
      };
    },
  };
  const check = (value: unknown, predicates: Record<string, (v: unknown) => boolean>): boolean => {
    let ok = true;
    for (const name of Object.keys(predicates)) {
      if (!predicates[name]!(value)) ok = false;
    }
    return ok;
  };
  const group = (label: string, fn: () => void): void => {
    groups.push(label);
    fn();
  };
  const env = { JOURNEY_BASE_URL: BASE };

  const factory = new Function("http", "check", "group", "__ENV", "console", runnable);
  const main = factory(http, check, group, env, console) as () => void;
  main();
  return { requests, groups };
}

describe("k6 shim ⇄ @usejourney/core parity", () => {
  it("emits an identical HTTP request sequence through both run paths", async () => {
    const coreRequests = await runViaCore();
    const { requests: k6Requests, groups } = await runViaK6Shim();

    // Sanity: login (sub-journey) → get one (param + query) → create. The
    // `get one` URL proves path interpolation (`{id}` → 42) and query building.
    expect(coreRequests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `POST ${BASE}/login`,
      `GET ${BASE}/items/42?verbose=true&limit=5`,
      `POST ${BASE}/items`,
    ]);

    // The core guarantee: the k6 script issues the same requests, in the same
    // order, with the same resolved headers and bodies. A drift in the shim's
    // step execution, lazy-value timing, or sub-journey ordering breaks this.
    expect(k6Requests).toEqual(coreRequests);

    // The sub-journey ran under a k6 group named after the `invokeJourney` call.
    expect(groups).toEqual(["auth"]);

    // The lazy `headers`/`body` closures saw state mutated by the sub-journey's
    // `after` and the `list` step's `assert` — proves hook ordering parity.
    expect(k6Requests[1]!.headers["authorization"]).toBe("Bearer tok-123");
    expect(k6Requests[2]!.headers["x-seq"]).toBe("1");
  });
});
