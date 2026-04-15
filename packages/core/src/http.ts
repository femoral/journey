import { isEndpointRef, type Endpoint, type HttpMethod } from "./endpoint.js";

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
  // Append the path under the full base — `new URL("/x", "https://h/api")` would
  // drop `/api` because a leading slash makes the path origin-relative.
  const baseWithSlash = base.endsWith("/") ? base : `${base}/`;
  const relPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(relPath, baseWithSlash);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.append(k, String(v));
    }
  }
  return url.toString();
}

export function buildRequest(opts: BuildRequestOptions, ctx: HttpContext): RequestSpec {
  const url = resolveUrl(opts.endpoint, ctx, opts.params, opts.query);
  const headers: Record<string, string> = { ...(ctx.defaultHeaders ?? {}), ...(opts.headers ?? {}) };
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
  const f = ctx.fetchImpl ?? fetch;
  const init: RequestInit = { method: req.method, headers: req.headers };
  if (req.body !== undefined) {
    init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }
  let abort: AbortController | undefined;
  let timer: NodeJS.Timeout | undefined;
  if (req.timeoutMs !== undefined) {
    abort = new AbortController();
    init.signal = abort.signal;
    timer = setTimeout(() => abort?.abort(), req.timeoutMs);
  }
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
    return { status: res.status, headers, body };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
