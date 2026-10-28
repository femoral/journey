import { transformSync } from "esbuild";

/**
 * Evaluates an emitted k6 script in-process with stubbed k6 modules
 * (`k6/http`, `k6`, `k6/metrics`) and globals (`__ENV`, `open`), so tests can
 * drive iterations and inspect requests, checks, groups and metric samples
 * without a k6 binary. The script is ESM; it is turned into a CJS function
 * body with esbuild and evaluated with a stub `require`.
 */

export interface StubResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  durationMs?: number;
  /** k6 sets `error` (with status 0) on network failures. */
  error?: string;
}

export interface CapturedRequest {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

export interface HarnessOptions {
  env?: Record<string, string>;
  now?: () => number;
  /** Return a response per request; default is a 200 `{"ok":true}` JSON. */
  respond?: (req: CapturedRequest) => StubResponse;
  /** Files `open(path, "b")` can return, keyed by the path passed to open(). */
  files?: Record<string, ArrayBuffer>;
}

export interface Harness {
  requests: CapturedRequest[];
  checks: Array<{ name: string; ok: boolean }>;
  groups: string[];
  /** metric name → recorded samples, for every Trend / Counter declared. */
  metrics: Record<string, number[]>;
  /** paths passed to open(). */
  opened: string[];
  errors: string[];
  exports: Record<string, unknown>;
  /** One k6 iteration (the script's default export). May return a promise. */
  main: () => unknown;
}

export function instantiate(source: string, opts: HarnessOptions = {}): Harness {
  const { code } = transformSync(source, { format: "cjs", loader: "js" });
  const requests: CapturedRequest[] = [];
  const checks: Harness["checks"] = [];
  const groups: string[] = [];
  const metrics: Record<string, number[]> = {};
  const opened: string[] = [];
  const errors: string[] = [];

  const respond: (req: CapturedRequest) => StubResponse =
    opts.respond ??
    (() => ({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: '{"ok":true}',
    }));

  const http = {
    request(
      method: string,
      url: string,
      body: unknown,
      params?: { headers?: Record<string, string> },
    ) {
      const req = { method, url, body, headers: params?.headers ?? {} };
      requests.push(req);
      const r = respond(req);
      return {
        status: r.status,
        headers: r.headers,
        body: r.body,
        json: () => JSON.parse(r.body),
        timings: { duration: r.durationMs ?? 10 },
        ...(r.error !== undefined ? { error: r.error } : {}),
      };
    },
    file(data: unknown, filename: string, contentType: string) {
      return { data, filename, content_type: contentType };
    },
  };
  const k6 = {
    check(value: unknown, predicates: Record<string, (v: unknown) => boolean>): boolean {
      let all = true;
      for (const name of Object.keys(predicates)) {
        const ok = predicates[name]!(value);
        checks.push({ name, ok });
        if (!ok) all = false;
      }
      return all;
    },
    group(label: string, fn: () => unknown): unknown {
      groups.push(label);
      return fn();
    },
  };
  class Metric {
    constructor(name: string) {
      metrics[name] = [];
      this.name = name;
    }
    name: string;
    add(v: number) {
      metrics[this.name]!.push(v);
    }
  }
  const modules: Record<string, unknown> = {
    "k6/http": http,
    k6,
    "k6/metrics": { Trend: Metric, Counter: Metric },
  };
  const require = (id: string) => {
    if (!(id in modules)) throw new Error(`harness: unexpected require(${id})`);
    return modules[id];
  };
  const open = (path: string) => {
    opened.push(path);
    const f = opts.files?.[path];
    if (!f) throw new Error(`open: no such file ${path}`);
    return f;
  };
  const consoleStub = {
    ...console,
    error: (...a: unknown[]) => errors.push(a.map(String).join(" ")),
    warn: (...a: unknown[]) => errors.push(a.map(String).join(" ")),
  };
  const env = { JOURNEY_BASE_URL: "http://k6.test", ...(opts.env ?? {}) };
  const DateStub = opts.now ? { now: opts.now } : Date;
  const module = { exports: {} as Record<string, unknown> };
  const factory = new Function(
    "require",
    "module",
    "exports",
    "__ENV",
    "open",
    "console",
    "Date",
    code,
  );
  factory(require, module, module.exports, env, open, consoleStub, DateStub);
  const main = module.exports.default as () => unknown;
  return { requests, checks, groups, metrics, opened, errors, exports: module.exports, main };
}
