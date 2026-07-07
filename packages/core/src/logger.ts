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
 * Fired once per journey, right after `runJourney` has finished collecting the
 * step list (a single execution of `def.body()`) and before any `onStepStart`.
 * The full ordered step list is known at this point — subscribers can use it to
 * pre-render a timeline without waiting for each `step:start` to arrive.
 *
 * Particularly useful for journeys whose bodies inject steps via helpers (e.g.
 * `registerAuthStep()` calling `step()` from inside the body): a static parse
 * of the source can't see those, but `onPlanned` does.
 *
 * `stepIdxOffset` is the absolute index of the first step in this journey
 * within the surrounding `runAllRegistered` call; consumers can use it to map
 * positions in `steps` back to the monotonic `stepIdx` values that subsequent
 * `step:start` / `step:end` events will carry.
 */
/**
 * One entry in a planned pipeline. `kind` is `"step"` for an HTTP step
 * (carries method/path from the endpoint) and `"sub"` for an
 * `invokeJourney(...)` node (carries the child journey's display name;
 * method/path are unset).
 *
 * A `"sub"` node carries `children` — the best-effort plan of the child
 * pipeline, discovered by evaluating the reusable journey body at plan time
 * (recursively, so nested sub-journeys are included). `incomplete` is set
 * when that discovery could not run — e.g. the body threw, or the recursion
 * cap was hit — in which case `children` is absent and subscribers fall back
 * to the live `onGroupStart` / step events once the sub-journey executes.
 *
 * Plan-time discovery is best-effort: conditional `step()` calls and a
 * sub-journey that turns out to be a cache hit can make the planned tree
 * differ from what actually runs. The live group/step events are always
 * authoritative.
 */
export interface PlannedNode {
  kind?: "step" | "sub";
  name: string;
  method?: string;
  path?: string;
  /** Sub-journey only — best-effort plan of the child pipeline. */
  children?: PlannedNode[];
  /** Sub-journey only — true when the child pipeline could not be discovered. */
  incomplete?: boolean;
}

export interface RunPlannedEvent {
  runId: string;
  journeyIdx: number;
  journeyName: string;
  stepIdxOffset: number;
  /**
   * Resolved pipeline entries, in order. A `"sub"` entry nests its child
   * pipeline under `children` (see `PlannedNode`) so subscribers can
   * pre-render the full tree — including nested sub-journeys — without
   * waiting for the run to enter each group.
   */
  steps: ReadonlyArray<PlannedNode>;
}

/**
 * Fired at the moment a sub-journey node (an `invokeJourney(handle, ...)`
 * call) begins executing — before any of the child's steps run. The `stepIdx`
 * is the slot consumed by the sub-journey itself in the parent run's
 * monotonic counter; child step events that follow carry `firstChildStepIdx`
 * and beyond.
 */
export interface GroupStartEvent {
  runId: string;
  journeyIdx: number;
  /** Display name for the timeline (override on the call site, else handle.name). */
  name: string;
  /** Child journey's authored name (i.e. handle.name). Distinct from `name` only when overridden. */
  childJourneyName: string;
  /** Slot consumed by the sub-journey node itself. */
  stepIdx: number;
  /** First child stepIdx that will fire inside this group (== `stepIdx + 1`). */
  firstChildStepIdx: number;
  /** "miss" / "hit". Until #90 lands the cache store, this is always "miss". */
  cacheStatus: "miss" | "hit";
  /** Resolved cache key if the caller supplied a `cacheKey` opt. Omitted otherwise. */
  resolvedKey?: string;
}

/** Fired once the sub-journey node finishes (success, failure, or cache hit short-circuit). */
export interface GroupEndEvent {
  runId: string;
  journeyIdx: number;
  name: string;
  childJourneyName: string;
  stepIdx: number;
  /** Last child stepIdx that fired inside this group. Equal to `stepIdx` when the child had no steps (or hit cache). */
  lastChildStepIdx: number;
  ok: boolean;
  durationMs: number;
  error?: string;
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
  onPlanned?(event: RunPlannedEvent): void;
  onStepStart?(event: StepStartEvent): void;
  onStepEnd?(event: StepEndEvent): void;
  onRequest?(req: RequestLog): void;
  onResponse?(req: RequestLog, res: ResponseLog): void;
  onError?(req: RequestLog, error: unknown, durationMs: number): void;
  /** Fired when a sub-journey node begins executing, before any child step events. */
  onGroupStart?(event: GroupStartEvent): void;
  /** Fired when a sub-journey node finishes; carries the child step range and the group outcome. */
  onGroupEnd?(event: GroupEndEvent): void;
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

/**
 * Walks `err.cause` up to `depth` links and joins each message with ` ← `.
 * Surfaces the real reason behind `fetch failed` (Node's fetch wraps undici
 * errors, e.g. `ECONNREFUSED`, `ENOTFOUND`, OpenSSL cert errors). Includes
 * the error `code` in parentheses when present.
 */
export function describeError(err: unknown, depth = 3): string {
  const parts: string[] = [];
  let cur: unknown = err;
  while (cur !== null && cur !== undefined && parts.length < depth) {
    const e = cur as { message?: unknown; code?: unknown; cause?: unknown };
    const msg = typeof e.message === "string" ? e.message : String(cur);
    const code = typeof e.code === "string" ? ` (${e.code})` : "";
    parts.push(`${msg}${code}`);
    cur = e.cause;
  }
  return parts.length === 0 ? String(err) : parts.join(" ← ");
}

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

/** Content-types treated as human-printable. Everything else is opaque (binary/file). */
const TEXTUAL_CONTENT_TYPE_RE = /json|^text\/|xml|html|javascript|x-www-form-urlencoded|csv|yaml/i;

/** True when a response body in this content-type is safe to print as-is. No signal (empty/undefined) defaults to textual. */
export function isTextualContentType(contentType: string | undefined): boolean {
  if (!contentType) return true;
  return TEXTUAL_CONTENT_TYPE_RE.test(contentType);
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** `file[N bytes]` from a `content-length` header, or `file[]` when the length is unknown. */
export function formatOpaqueBody(headers: Record<string, string>): string {
  const len = findHeader(headers, "content-length");
  return len ? `file[${len} bytes]` : "file[]";
}

function fmtBody(body: unknown, max: number, headers: Record<string, string>): string {
  if (body === undefined || body === null) return "";
  if (!isTextualContentType(findHeader(headers, "content-type"))) return formatOpaqueBody(headers);
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
      const body = fmtBody(req.body, max, req.headers);
      if (body) write(`  body    ${body}`);
    },
    onResponse(req, res) {
      write(`← ${res.status} ${req.method} ${req.url} (${res.durationMs}ms)`);
      const body = fmtBody(res.body, max, res.headers);
      if (body) write(`  body    ${body}`);
    },
    onError(req, err, durationMs) {
      write(`✗ ${req.method} ${req.url} failed after ${durationMs}ms: ${describeError(err)}`);
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
