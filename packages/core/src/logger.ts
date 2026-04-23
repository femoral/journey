/**
 * Pluggable request/response logger. The runtime calls into a logger attached
 * to the HttpContext (if any); CLI/GUI surfaces wire one up when --debug or
 * DEBUG=journey is set.
 */

export interface RequestLog {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface ResponseLog {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
}

/**
 * Fired at the top of a run before any step executes. The runtime allocates a
 * runId if the caller didn't pass one in, so subscribers can correlate later
 * events back to the run.
 */
export interface RunStartEvent {
  runId: string;
  journeyNames: string[];
}

/** Fired once per run after every journey has either completed or halted. */
export interface RunEndEvent {
  runId: string;
  ok: boolean;
  durationMs: number;
  results: ReadonlyArray<{ name: string; ok: boolean }>;
}

/**
 * Fired when a step starts executing, before any lazy-resolved headers/query/
 * body are materialized and before `onRequest`. `stepIdx` is monotonic across
 * the whole run, not just within a journey — this way consumers don't need to
 * track journey boundaries to correlate events.
 */
export interface StepStartEvent {
  runId: string;
  journeyIdx: number;
  journeyName: string;
  stepIdx: number;
  name: string;
}

/** Fired when a step finishes, after `onResponse`/`onError`. */
export interface StepEndEvent {
  runId: string;
  journeyIdx: number;
  stepIdx: number;
  ok: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Fired for `console.log` / `console.warn` / `console.error` calls made from
 * inside step hooks (e.g. `after(res) { console.log(res.body.id); }`). The
 * subscriber attaches its own `stepIdx`; core carries only the raw level + text.
 */
export interface LogEvent {
  level: "info" | "warn" | "error";
  text: string;
}

export interface JourneyLogger {
  onRunStart?(event: RunStartEvent): void;
  onRunEnd?(event: RunEndEvent): void;
  onStepStart?(event: StepStartEvent): void;
  onStepEnd?(event: StepEndEvent): void;
  onRequest?(req: RequestLog): void;
  onResponse?(req: RequestLog, res: ResponseLog): void;
  onError?(req: RequestLog, error: unknown, durationMs: number): void;
  /**
   * Fired for user-code `console.*` calls captured during a run. The runner
   * installs a shim that forwards each call here and to the original console
   * so terminal output stays intact.
   */
  onLog?(event: LogEvent): void;
  info?(message: string): void;
}

/** Header names that get redacted before logging by default. */
export const SECRET_HEADERS: ReadonlyArray<string> = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "proxy-authorization",
];

export function maskHeaders(
  headers: Record<string, string>,
  masks: ReadonlyArray<string> = SECRET_HEADERS,
): Record<string, string> {
  const lower = masks.map((m) => m.toLowerCase());
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = lower.includes(k.toLowerCase()) ? "***" : v;
  }
  return out;
}

export interface ConsoleLoggerOptions {
  /** Where to write each line. Defaults to console.error so stdout stays clean. */
  write?: (line: string) => void;
  /** Mask secret-looking headers (default true). */
  mask?: boolean;
  /** Truncate logged response/request bodies past this many chars (default 1024). */
  maxBodyChars?: number;
}

function fmtBody(body: unknown, max: number): string {
  if (body === undefined || body === null) return "";
  const s = typeof body === "string" ? body : JSON.stringify(body);
  return s.length > max ? `${s.slice(0, max)}… (${s.length - max} more chars)` : s;
}

export function createConsoleLogger(opts: ConsoleLoggerOptions = {}): JourneyLogger {
  const write = opts.write ?? ((line: string) => console.error(line));
  const mask = opts.mask !== false;
  const max = opts.maxBodyChars ?? 1024;
  return {
    onRequest(req) {
      write(`→ ${req.method} ${req.url}`);
      const headers = mask ? maskHeaders(req.headers) : req.headers;
      const headerKeys = Object.keys(headers);
      if (headerKeys.length > 0) write(`  headers ${JSON.stringify(headers)}`);
      const body = fmtBody(req.body, max);
      if (body) write(`  body    ${body}`);
    },
    onResponse(req, res) {
      write(`← ${res.status} ${req.method} ${req.url} (${res.durationMs}ms)`);
      const body = fmtBody(res.body, max);
      if (body) write(`  body    ${body}`);
    },
    onError(req, err, durationMs) {
      const msg = err instanceof Error ? err.message : String(err);
      write(`✗ ${req.method} ${req.url} failed after ${durationMs}ms: ${msg}`);
    },
    info(msg) {
      write(msg);
    },
  };
}

/**
 * Returns a console logger when DEBUG env var includes "journey" (or "*"),
 * otherwise undefined. Useful for CLI bins that want to opt in via env var.
 */
export function loggerFromEnv(env: NodeJS.ProcessEnv = process.env): JourneyLogger | undefined {
  const debug = env.DEBUG;
  if (!debug) return undefined;
  const tags = debug.split(",").map((t) => t.trim().toLowerCase());
  if (tags.some((t) => t === "*" || t === "journey" || t === "journey:*")) {
    return createConsoleLogger();
  }
  return undefined;
}
