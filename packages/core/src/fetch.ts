import type { RequestLog, ResponseLog } from "./logger.js";
import { getCurrentCtx } from "./runtime.js";

// Derive parameter/return types from the platform `fetch` so we don't depend
// on the `lib: ["dom"]` aliases (RequestInfo / HeadersInit / BodyInit) — core
// targets es2023 + Node's global fetch only.
type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];
type FetchResponse = Awaited<ReturnType<typeof globalThis.fetch>>;

/**
 * Drop-in replacement for `globalThis.fetch` that routes through the
 * currently-executing journey's logger when called from inside a step hook.
 *
 * Outside a run context (no active `runJourney`) it delegates to the platform
 * `fetch` with no behaviour change — the same helper module is therefore
 * safe to import from ad-hoc scripts or top-level setup code.
 *
 * Intended use: auth-helper steps that mint a token from a separate service
 * inside an `after` hook. Raw `globalThis.fetch` works but is invisible to
 * the Debug Console and run history; this wrapper makes those calls
 * observable without forcing helpers to thread the HttpContext through.
 */
export async function fetch(input: FetchInput, init?: FetchInit): Promise<FetchResponse> {
  const ctx = getCurrentCtx();
  const logger = ctx?.logger;
  // Snapshot the platform fetch per-call so a test that swaps `globalThis.fetch`
  // before invoking the wrapper still sees its replacement.
  const realFetch = globalThis.fetch;
  if (!logger) {
    return realFetch(input, init);
  }

  const reqLog = buildRequestLog(input, init);
  logger.onRequest?.(reqLog);

  const started = Date.now();
  let res: FetchResponse;
  try {
    res = await realFetch(input, init);
  } catch (err) {
    logger.onError?.(reqLog, err, Date.now() - started);
    throw err;
  }

  logger.onResponse?.(reqLog, await buildResponseLog(res, Date.now() - started));
  return res;
}

function buildRequestLog(input: FetchInput, init: FetchInit | undefined): RequestLog {
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const method = (init?.method ?? (isRequest ? input.method : "GET")).toUpperCase();
  const url = isRequest
    ? input.url
    : typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : String(input);
  const headers = headersToRecord(init?.headers ?? (isRequest ? input.headers : undefined));
  const log: RequestLog = { method, url, headers };
  if (init?.body !== undefined && init?.body !== null) log.body = bodyForLog(init.body);
  return log;
}

async function buildResponseLog(res: FetchResponse, durationMs: number): Promise<ResponseLog> {
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const contentType = res.headers.get("content-type") ?? "";
  let body: unknown = "<unreadable>";
  try {
    const cloned = res.clone();
    body = contentType.includes("json")
      ? await cloned.json().catch(() => null)
      : await cloned.text();
  } catch {
    // Streaming bodies, opaque responses, or platforms that reject clone()
    // — drop the body rather than break the caller's response handling.
    body = "<unreadable>";
  }
  return { status: res.status, headers, body, durationMs };
}

type HeadersLike = NonNullable<FetchInit>["headers"];

function headersToRecord(headers: HeadersLike | undefined): Record<string, string> {
  if (!headers) return {};
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const [k, v] of headers as Array<[string, string]>) out[k] = v;
    return out;
  }
  return { ...(headers as Record<string, string>) };
}

function bodyForLog(body: unknown): unknown {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  // FormData / Blob / ArrayBuffer / ReadableStream — flag opaque so the log
  // stays JSON-serialisable without consuming the original body.
  return "<binary>";
}
