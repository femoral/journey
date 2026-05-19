import { isEndpointRef, type Endpoint, type HttpMethod } from "./endpoint.js";
import type { JourneyLogger, RequestLog } from "./logger.js";

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body: T;
}

export interface HttpContext {
  /** Fallback base URL when the endpoint doesn't carry its own. */
  baseUrl?: string;
  /** Global default headers applied before per-step headers. */
  defaultHeaders?: Record<string, string>;
  /** Injectable fetch — default is global fetch. Tests override this. */
  fetchImpl?: typeof fetch;
  /** Optional logger called before/after each request. */
  logger?: JourneyLogger;
  /**
   * Optional undici `Dispatcher` (typed as `unknown` so core stays
   * dependency-free). When set, it is forwarded to `fetch` as `init.dispatcher`
   * so callers can disable TLS verification, route through a proxy, or pin a
   * client cert. The CLI's `--insecure` flag uses this.
   */
  dispatcher?: unknown;
  /**
   * Optional run-scoped AbortSignal. When set, every `fetch` issued through
   * `execute` (and through the instrumented `@journey/core` `fetch` helper)
   * receives it, and `runJourney` stops iterating steps as soon as it fires.
   * Used by the dev server's `POST /api/runs/:id/abort` route to cancel an
   * in-flight run.
   */
  signal?: AbortSignal;
}

export interface RequestSpec {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface BuildRequestOptions {
  endpoint: Endpoint;
  params?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export function resolveUrl(
  endpoint: Endpoint,
  ctx: HttpContext,
  params: Record<string, string | number> | undefined,
  query: Record<string, string | number | boolean | undefined> | undefined,
): string {
  const base = isEndpointRef(endpoint) ? ctx.baseUrl : (endpoint.baseUrl ?? ctx.baseUrl);
  if (!base) {
    throw new Error(
      `No base URL configured. Set \`baseUrl\` in journey.config.json or on the endpoint descriptor.`,
    );
  }
  let path = endpoint.path;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      path = path.replace(`{${k}}`, encodeURIComponent(String(v)));
    }
  }
  const missing = path.match(/\{([^}]+)\}/);
  if (missing) {
    throw new Error(`Missing path param "${missing[1]}" for ${endpoint.method} ${endpoint.path}`);
  }
  // Empty path resolves to `base` verbatim — no forced trailing slash. Otherwise
  // `new URL("", "https://h/foo/")` would echo the slash and break exact-path routes.
  let url: URL;
  if (path === "") {
    url = new URL(base);
  } else {
    // Append the path under the full base — `new URL("/x", "https://h/api")` would
    // drop `/api` because a leading slash makes the path origin-relative.
    const baseWithSlash = base.endsWith("/") ? base : `${base}/`;
    const relPath = path.startsWith("/") ? path.slice(1) : path;
    url = new URL(relPath, baseWithSlash);
  }
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.append(k, String(v));
    }
  }
  return url.toString();
}

export function buildRequest(opts: BuildRequestOptions, ctx: HttpContext): RequestSpec {
  const url = resolveUrl(opts.endpoint, ctx, opts.params, opts.query);
  const headers: Record<string, string> = {
    ...(ctx.defaultHeaders ?? {}),
    ...(opts.headers ?? {}),
  };
  const hasBody = opts.body !== undefined;
  if (hasBody && !("content-type" in lower(headers))) {
    headers["Content-Type"] = "application/json";
  }
  const spec: RequestSpec = { method: opts.endpoint.method, url, headers };
  if (hasBody) spec.body = opts.body;
  if (opts.timeoutMs !== undefined) spec.timeoutMs = opts.timeoutMs;
  return spec;
}

function lower(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

export async function execute(req: RequestSpec, ctx: HttpContext): Promise<HttpResponse> {
  const logReq: RequestLog = {
    method: req.method,
    url: req.url,
    headers: req.headers,
    ...(req.body !== undefined ? { body: req.body } : {}),
  };
  ctx.logger?.onRequest?.(logReq);

  const f = ctx.fetchImpl ?? fetch;
  const init: RequestInit = { method: req.method, headers: req.headers };
  if (req.body !== undefined) {
    init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }
  if (ctx.dispatcher !== undefined) {
    // `dispatcher` is a Node/undici extension typed as `Dispatcher` by
    // @types/node; we accept `unknown` from callers so core doesn't pull in
    // undici types. Cast through `Record<string, unknown>` to attach it.
    (init as unknown as Record<string, unknown>).dispatcher = ctx.dispatcher;
  }
  let timer: NodeJS.Timeout | undefined;
  const signals: AbortSignal[] = [];
  if (req.timeoutMs !== undefined) {
    const abort = new AbortController();
    timer = setTimeout(() => abort.abort(), req.timeoutMs);
    signals.push(abort.signal);
  }
  if (ctx.signal) signals.push(ctx.signal);
  if (signals.length === 1) init.signal = signals[0]!;
  else if (signals.length > 1) init.signal = AbortSignal.any(signals);
  const started = Date.now();
  try {
    const res = await f(req.url, init);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const contentType = res.headers.get("content-type") ?? "";
    const body: unknown = contentType.includes("json")
      ? await res.json().catch(() => null)
      : await res.text();
    const wrapped: HttpResponse = { status: res.status, headers, body };
    ctx.logger?.onResponse?.(logReq, { ...wrapped, durationMs: Date.now() - started });
    return wrapped;
  } catch (err) {
    ctx.logger?.onError?.(logReq, err, Date.now() - started);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
