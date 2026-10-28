/**
 * Runtime shim bundled into every emitted k6 script. It is the module that
 * `import … from "@usejourney/core"` resolves to at export time, so it exports
 * the public surface journeys use (`journey`, `step`, `expect`, `fetch`,
 * `multipart`, …) plus a few `__`-prefixed hooks the generated entry calls.
 *
 * The run loop is "maybe-async": it stays synchronous while every lazy value
 * and hook is synchronous (so `group()` tags every request), and only switches
 * to promise chaining when a hook returns a thenable (`async` hooks, `fetch`).
 * k6 awaits a promise returned from the default function.
 */
export const SHIM_MODULE_SOURCE = `import http from "k6/http";
import { check, group } from "k6";
import { Trend, Counter } from "k6/metrics";

// k6 reads JOURNEY_BASE_URL; BASE_URL (the name environments/*.json use for
// \`journey run\`) is the fallback.
const __BASE_URL = __ENV.JOURNEY_BASE_URL || __ENV.BASE_URL || "";
const __journeys = [];
let __currentNodes = null;
let __outputSlot = null;
const __MAX_SUB_DEPTH = 8;
const __config = { metricsPrefix: null, haltOnFailure: false, projectRoot: "./", files: {} };

// Sub-journey output cache — mirrors the runtime's MemorySubJourneyCache.
// Scope is per-VU: k6 gives each VU its own JS runtime, and module-scoped state
// persists across that VU's iterations (there is no cross-VU mutable shared
// state — SharedArray is read-only). So a cached value is reused across the
// iterations of one VU; each VU warms its own copy. Set JOURNEY_CACHE=off to
// force every iteration cold (true per-iteration cost for load measurement).
const __subCache = {};
const __cacheOff = __ENV.JOURNEY_CACHE === "off";
function __cacheGet(key) {
  const e = __subCache[key];
  if (!e) return undefined;
  if (e.expiresAt !== undefined && Date.now() >= e.expiresAt) {
    delete __subCache[key];
    return undefined;
  }
  return e;
}
function __cacheSet(key, value, ttlMs) {
  __subCache[key] = ttlMs !== undefined ? { value: value, expiresAt: Date.now() + ttlMs } : { value: value };
}

// ---- maybe-async helpers -------------------------------------------------
function __isThenable(v) {
  return v !== null && (typeof v === "object" || typeof v === "function") && typeof v.then === "function";
}
function __then(v, fn) {
  return __isThenable(v) ? v.then(fn) : fn(v);
}
function __lazy(v) {
  return typeof v === "function" ? v() : v;
}
function __tryFinally(body, fin) {
  let r;
  try { r = body(); } catch (e) { fin(); throw e; }
  if (__isThenable(r)) return r.then((v) => { fin(); return v; }, (e) => { fin(); throw e; });
  fin();
  return r;
}
// Run fn; report { ok, error } synchronously when possible, else as a promise.
function __attempt(fn) {
  let r;
  try { r = fn(); } catch (e) { return { ok: false, error: e }; }
  if (__isThenable(r)) return r.then(() => ({ ok: true }), (e) => ({ ok: false, error: e }));
  return { ok: true };
}

// Minimal no-op stand-in for zod. Reusable journeys declare \`inputs\` / \`outputs\`
// schemas via \`z\`, but k6 has no zod runtime and the schemas are not enforced
// in exported scripts — every access or call returns the same chainable proxy.
export const z = new Proxy(function () {}, {
  get() { return z; },
  apply() { return z; },
  construct() { return z; },
});

// Sub-journey cacheKey / cacheTtlMs / cache opts ARE honored — see __runSub
// and the per-VU note on __subCache above.
export function journey(name, optsOrBody, maybeBody) {
  const body = typeof optsOrBody === "function" ? optsOrBody : maybeBody;
  const opts = typeof optsOrBody === "function" ? null : optsOrBody;
  if (opts && opts.reusable === true) {
    return { __journeyHandle: true, name, body };
  }
  __journeys.push({ name, body });
}

export function step(name, opts) {
  if (!__currentNodes) {
    throw new Error("step(" + JSON.stringify(name) + ") called outside a journey(...) body");
  }
  __currentNodes.push({ kind: "step", name, opts });
}

export function invokeJourney(handle, opts) {
  if (!__currentNodes) {
    throw new Error("invokeJourney(...) called outside a journey(...) body");
  }
  __currentNodes.push({ kind: "sub", handle, opts: opts || {} });
}

export function output(value) {
  if (__outputSlot) __outputSlot.value = value;
}

export function env(key) {
  const v = __ENV[key];
  if (v === undefined) throw new Error("env: missing " + key);
  return v;
}

export function tryEnv(key) {
  return __ENV[key];
}

export function isEndpointRef(e) {
  return e !== null && typeof e === "object" && typeof e.operationId === "string";
}

export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssertionError";
  }
}

function __fmt(v) {
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a); const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

// Mirrors @usejourney/core's expect() — same matchers, same failure messages.
export function expect(value) {
  const fail = (msg) => { throw new AssertionError(msg); };
  const num = (m) => { if (typeof value !== "number") fail(m + " is only supported on numbers (got " + typeof value + ")"); };
  return {
    toBe(expected) { if (!Object.is(value, expected)) fail("expected " + __fmt(value) + " to be " + __fmt(expected)); },
    toEqual(expected) { if (!deepEqual(value, expected)) fail("expected " + __fmt(value) + " to equal " + __fmt(expected)); },
    toBeDefined() { if (value === undefined) fail("expected value to be defined"); },
    toContain(expected) {
      if (typeof value === "string") {
        if (typeof expected !== "string" || !value.includes(expected)) fail("expected " + __fmt(value) + " to contain " + __fmt(expected));
        return;
      }
      if (Array.isArray(value)) { if (!value.some((v) => deepEqual(v, expected))) fail("expected array to contain " + __fmt(expected)); return; }
      fail("toContain is only supported on strings and arrays");
    },
    toMatch(expected) {
      if (typeof value !== "string") fail("toMatch is only supported on strings");
      const re = typeof expected === "string" ? new RegExp(expected) : expected;
      if (!re.test(value)) fail("expected " + __fmt(value) + " to match " + re);
    },
    toBeGreaterThan(n) { num("toBeGreaterThan"); if (!(value > n)) fail("expected " + __fmt(value) + " to be greater than " + n); },
    toBeGreaterThanOrEqual(n) { num("toBeGreaterThanOrEqual"); if (!(value >= n)) fail("expected " + __fmt(value) + " to be greater than or equal to " + n); },
    toBeLessThan(n) { num("toBeLessThan"); if (!(value < n)) fail("expected " + __fmt(value) + " to be less than " + n); },
    toBeLessThanOrEqual(n) { num("toBeLessThanOrEqual"); if (!(value <= n)) fail("expected " + __fmt(value) + " to be less than or equal to " + n); },
    toHaveLength(n) {
      const len = value === null || value === undefined ? undefined : value.length;
      if (typeof len !== "number") fail("toHaveLength is only supported on strings, arrays, and objects with a numeric .length");
      if (len !== n) fail("expected " + __fmt(value) + " to have length " + n + ", got " + len);
    },
  };
}

// ---- files / multipart ---------------------------------------------------
// fileFrom() paths are project-root relative. The export pre-loads every
// string-literal fileFrom("…") path with open(…, "b") in the init context and
// hands the bytes over through __configure({ files }).
function __isFileRef(v) { return v !== null && typeof v === "object" && v.__journeyFile === true; }
function __isMultipart(v) { return v !== null && typeof v === "object" && v.__journeyMultipart === true; }
function __basename(p) { const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\\\")); return i === -1 ? p : p.slice(i + 1); }
function __isAbsPath(p) { return p.charAt(0) === "/" || /^[A-Za-z]:[\\\\/]/.test(p); }

function __loadFile(path) {
  if (Object.prototype.hasOwnProperty.call(__config.files, path)) return __config.files[path];
  let bytes;
  try {
    bytes = open(__isAbsPath(path) ? path : __config.projectRoot + path, "b");
  } catch (e) {
    throw new Error(
      "fileFrom(" + JSON.stringify(path) + "): the file was not pre-loaded at k6 init time and can't be opened now (" +
        (e && e.message ? e.message : e) + "). Pass a string literal to fileFrom() so \`journey export k6\` can pre-load it, " +
        "or call fileFrom() at module top level.",
    );
  }
  __config.files[path] = bytes;
  return bytes;
}

export function fileFrom(path, contentType, filename) {
  if (typeof path !== "string" || path.length === 0) throw new TypeError("fileFrom(path): path must be a non-empty string");
  // At init time (module top level) this opens the file eagerly; in a VU it
  // only succeeds for paths the export pre-loaded.
  __loadFile(path);
  const ref = { __journeyFile: true, path: path };
  if (contentType !== undefined) ref.contentType = contentType;
  if (filename !== undefined) ref.filename = filename;
  return ref;
}

export function multipart(parts) {
  if (parts === null || typeof parts !== "object") throw new TypeError("multipart(parts): parts must be an object");
  const copy = {};
  for (const k of Object.keys(parts)) copy[k] = parts[k];
  return { __journeyMultipart: true, parts: copy };
}

export function isFileRef(v) { return __isFileRef(v); }
export function isMultipartBody(v) { return __isMultipart(v); }

function __headerKey(h, name) {
  const lower = name.toLowerCase();
  for (const k of Object.keys(h)) if (k.toLowerCase() === lower) return k;
  return undefined;
}
function __defaultHeader(h, name, value) {
  if (__headerKey(h, name) === undefined) h[name] = value;
}
function __toArrayBuffer(v) {
  if (v instanceof ArrayBuffer) return v;
  return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
}

// Encode a resolved step body for http.request, defaulting Content-Type the
// way @usejourney/core's buildRequest does. Mutates \`headers\`.
function __encodeBody(body, headers) {
  if (body === undefined) return null;
  if (typeof body === "string") { __defaultHeader(headers, "Content-Type", "application/json"); return body; }
  if (__isMultipart(body)) {
    // k6 sets multipart/form-data with its own boundary; a caller-supplied
    // Content-Type can't carry it, so drop it (core does the same).
    const ctKey = __headerKey(headers, "Content-Type");
    if (ctKey !== undefined) delete headers[ctKey];
    const names = Object.keys(body.parts);
    const out = {};
    let hasFile = false;
    for (const k of names) {
      const v = body.parts[k];
      if (__isFileRef(v)) {
        hasFile = true;
        out[k] = http.file(__loadFile(v.path), v.filename || __basename(v.path), v.contentType || "application/octet-stream");
      } else {
        out[k] = String(v);
      }
    }
    if (hasFile) return out; // object body with a file → k6 sends multipart/form-data
    // Text-only: k6 would url-encode an object body, so build multipart by hand.
    const boundary = "----JourneyBoundary" + Math.random().toString(36).slice(2);
    let s = "";
    for (const k of names) {
      s += "--" + boundary + "\\r\\nContent-Disposition: form-data; name=\\"" + k + "\\"\\r\\n\\r\\n" + out[k] + "\\r\\n";
    }
    headers["Content-Type"] = "multipart/form-data; boundary=" + boundary;
    return s + "--" + boundary + "--\\r\\n";
  }
  if (__isFileRef(body)) {
    __defaultHeader(headers, "Content-Type", body.contentType || "application/octet-stream");
    return __loadFile(body.path);
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    __defaultHeader(headers, "Content-Type", "application/octet-stream");
    return __toArrayBuffer(body);
  }
  __defaultHeader(headers, "Content-Type", "application/json");
  return JSON.stringify(body);
}

// ---- fetch ---------------------------------------------------------------
// Minimal WHATWG-fetch stand-in for helpers that \`import { fetch } from
// "@usejourney/core"\`. Backed by the synchronous http.request; resolves to a
// Response-like object. Rejects (like fetch) only on network errors.
function __headersLike(raw) {
  const lower = {};
  if (raw) for (const k of Object.keys(raw)) lower[k.toLowerCase()] = String(raw[k]);
  return {
    get(name) { const v = lower[String(name).toLowerCase()]; return v === undefined ? null : v; },
    has(name) { return Object.prototype.hasOwnProperty.call(lower, String(name).toLowerCase()); },
    forEach(cb) { for (const k of Object.keys(lower)) cb(lower[k], k); },
    keys() { return Object.keys(lower)[Symbol.iterator](); },
    entries() { return Object.keys(lower).map((k) => [k, lower[k]])[Symbol.iterator](); },
  };
}
function __plainHeaders(h) {
  const out = {};
  if (!h) return out;
  if (typeof h.forEach === "function" && !Array.isArray(h)) { h.forEach((v, k) => { out[k] = v; }); return out; }
  if (Array.isArray(h)) { for (const pair of h) out[pair[0]] = pair[1]; return out; }
  for (const k of Object.keys(h)) out[k] = h[k];
  return out;
}

export function fetch(input, init) {
  try {
    const opts = init || {};
    const url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    const method = String(opts.method || (input && input.method) || "GET").toUpperCase();
    const headers = __plainHeaders(opts.headers);
    let body = opts.body === undefined || opts.body === null ? null : opts.body;
    if (body !== null && typeof body !== "string") {
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) body = __toArrayBuffer(body);
      else throw new TypeError("fetch (k6 export): only string and binary bodies are supported");
    }
    const res = http.request(method, url, body, { headers: headers });
    if (res.status === 0 && res.error) return Promise.reject(new TypeError("fetch failed: " + res.error));
    const text = res.body === null || res.body === undefined ? "" : typeof res.body === "string" ? res.body : String(res.body);
    const response = {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      statusText: res.status_text || "",
      url: res.url || url,
      redirected: false,
      headers: __headersLike(res.headers),
      text() { return Promise.resolve(text); },
      json() { try { return Promise.resolve(JSON.parse(text)); } catch (e) { return Promise.reject(e); } },
      clone() { return response; },
    };
    return Promise.resolve(response);
  } catch (e) {
    return Promise.reject(e);
  }
}

// ---- request execution ---------------------------------------------------
function __parseBody(res, headers) {
  const ct = headers["content-type"] || "";
  if (ct.indexOf("json") !== -1) { try { return res.json(); } catch (e) { return null; } }
  return res.body;
}

// Response header keys are lowercased, matching fetch() in the core runtime.
function __lowerHeaders(h) {
  const out = {};
  if (h) for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k];
  return out;
}

function __interpolate(path, params) {
  if (!params) return path;
  let out = path;
  for (const k of Object.keys(params)) out = out.replace("{" + k + "}", encodeURIComponent(String(params[k])));
  return out;
}

function __mergeHeaders(h) {
  const out = {};
  if (h) for (const k of Object.keys(h)) out[k] = h[k];
  return out;
}

function __buildQuery(query) {
  if (!query) return "";
  const parts = [];
  for (const k of Object.keys(query)) {
    const v = query[k];
    if (v !== undefined) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

// Evaluate a journey body, collecting its pipeline nodes (step + sub).
function __collectNodes(body, input) {
  const nodes = [];
  const prev = __currentNodes;
  __currentNodes = nodes;
  try { body(input); } finally { __currentNodes = prev; }
  return nodes;
}

// ---- custom metrics (opt-in via --metrics-prefix) ------------------------
const __metrics = {};
const __warnedMetrics = {};
let __flowMetrics = null;
let __flowDuration = 0;

function __slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
// Metric base name (<prefix>_<slug>) for a step, or null when it opted out.
function __metricName(stepName, opts) {
  const m = opts ? opts.metric : undefined;
  if (m === false) return null;
  const slug = typeof m === "string" && m !== "" ? m.replace(/[^A-Za-z0-9_]+/g, "_") : __slug(stepName);
  return __config.metricsPrefix + "_" + (slug || "step");
}
function __declareMetric(name) {
  if (__metrics[name]) return;
  __metrics[name] = { duration: new Trend(name + "_duration"), tps: new Counter(name + "_tps") };
}
// k6 only allows metric declaration in the init context, but steps are only
// known by evaluating journey bodies. Dry-collect every journey (and, best
// effort, every sub-journey) at init to declare a Trend + Counter per step.
function __declareNodes(nodes, depth) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === "step") {
      const name = __metricName(n.name, n.opts);
      if (name) __declareMetric(name);
      continue;
    }
    if (depth >= __MAX_SUB_DEPTH) continue;
    let input;
    try { input = __lazy(n.opts.inputs); } catch (e) { input = undefined; }
    if (__isThenable(input)) input = undefined;
    try {
      __declareNodes(__collectNodes(n.handle.body, input), depth + 1);
    } catch (e) {
      console.warn("[journey] metrics: could not pre-declare metrics for sub-journey " + JSON.stringify(n.handle.name) + " (" + (e && e.message ? e.message : e) + ")");
    }
  }
}
export function __declareMetrics() {
  if (!__config.metricsPrefix) return;
  __flowMetrics = {
    duration: new Trend(__config.metricsPrefix + "_flow_duration"),
    tps: new Counter(__config.metricsPrefix + "_flow_tps"),
  };
  for (let i = 0; i < __journeys.length; i++) {
    const j = __journeys[i];
    try {
      __declareNodes(__collectNodes(j.body, undefined), 0);
    } catch (e) {
      console.warn("[journey] metrics: could not pre-declare metrics for journey " + JSON.stringify(j.name) + " (" + (e && e.message ? e.message : e) + ")");
    }
  }
}
function __recordStep(stepName, opts, res) {
  if (!__config.metricsPrefix) return;
  const d = res.timings ? res.timings.duration : 0;
  __flowDuration += d;
  const name = __metricName(stepName, opts);
  if (!name) return;
  const m = __metrics[name];
  if (!m) {
    if (!__warnedMetrics[name]) {
      __warnedMetrics[name] = true;
      console.warn("[journey] metrics: " + name + "_* was not declared at init (step only discovered at run time); not recorded");
    }
    return;
  }
  m.duration.add(d);
  m.tps.add(1);
}

// Thrown to stop the iteration when an assert fails under --halt-on-failure.
const __HALT = { __journeyHalt: true };

function __executeStep(current, journeyName) {
  const opts = current.opts;
  // Same resolution order as the core runtime: headers, query, body, params.
  return __then(__lazy(opts.headers), (headers) =>
    __then(__lazy(opts.query), (query) =>
      __then(__lazy(opts.body), (body) =>
        __then(__lazy(opts.params), (params) => __send(current, journeyName, headers, query, body, params)))));
}

function __send(current, journeyName, headers, query, body, params) {
  const opts = current.opts;
  const path = __interpolate(opts.endpoint.path, params);
  const base = opts.endpoint.baseUrl || __BASE_URL;
  const url = base + path + __buildQuery(query);
  const requestHeaders = __mergeHeaders(headers);
  const payload = __encodeBody(body, requestHeaders);
  const res = http.request(opts.endpoint.method, url, payload, { headers: requestHeaders });
  __recordStep(current.name, opts, res);
  const resHeaders = __lowerHeaders(res.headers);
  const wrapped = { status: res.status, headers: resHeaders, body: __parseBody(res, resHeaders) };
  const afterHook = () => (opts.after ? opts.after(wrapped) : undefined);
  if (!opts.assert) return afterHook();
  const name = journeyName + " › " + current.name;
  return __then(__attempt(() => opts.assert(wrapped)), (r) => {
    if (!r.ok) console.error(name + ": " + (r.error && r.error.message ? r.error.message : r.error));
    check(wrapped, { [name]: () => r.ok });
    if (!r.ok && __config.haltOnFailure) throw __HALT;
    return afterHook();
  });
}

// Inline a sub-journey node under a k6 group() named after the child journey.
// On a cache hit the child's requests are skipped entirely and the stored
// output is replayed; the parent's assert/after still run either way.
function __runSub(node, depth) {
  if (depth >= __MAX_SUB_DEPTH) {
    throw new Error("invokeJourney: sub-journey nesting exceeded " + __MAX_SUB_DEPTH + " levels");
  }
  const handle = node.handle;
  const opts = node.opts || {};
  const label = opts.name || handle.name;
  return __then(__lazy(opts.inputs), (input) => {
    // Cache active only when a cacheKey is supplied and not disabled — mirrors
    // the core runtime. Composite key is childName:resolvedKey.
    let resolvedKey;
    if (opts.cacheKey !== undefined) {
      resolvedKey = typeof opts.cacheKey === "function" ? opts.cacheKey(input) : opts.cacheKey;
    }
    const cacheKeyStr =
      !__cacheOff && resolvedKey !== undefined && opts.cache !== "off"
        ? handle.name + ":" + resolvedKey
        : undefined;

    const slot = { value: undefined };
    const finish = () => {
      if (opts.assert) {
        return __then(opts.assert(slot.value), () => (opts.after ? opts.after(slot.value) : undefined));
      }
      return opts.after ? opts.after(slot.value) : undefined;
    };
    if (cacheKeyStr !== undefined) {
      const entry = __cacheGet(cacheKeyStr);
      if (entry !== undefined) { slot.value = entry.value; return finish(); }
    }
    const prevSlot = __outputSlot;
    __outputSlot = slot;
    const ran = __tryFinally(() => {
      const childNodes = __collectNodes(handle.body, input);
      // group() rejects async functions; a sync callback that returns a
      // promise is accepted (requests after its first await lose the tag).
      return group(label, () => __runNodes(childNodes, handle.name, depth + 1));
    }, () => { __outputSlot = prevSlot; });
    return __then(ran, () => {
      if (cacheKeyStr !== undefined) __cacheSet(cacheKeyStr, slot.value, opts.cacheTtlMs);
      return finish();
    });
  });
}

function __runNodes(nodes, journeyName, depth) {
  let i = 0;
  const next = () => {
    while (i < nodes.length) {
      const node = nodes[i++];
      const r = node.kind === "sub" ? __runSub(node, depth) : __executeStep(node, journeyName);
      if (__isThenable(r)) return r.then(next);
    }
    return undefined;
  };
  return next();
}

/** Called by the generated entry before any journey module evaluates. */
export function __configure(cfg) {
  if (cfg.metricsPrefix) __config.metricsPrefix = cfg.metricsPrefix;
  if (cfg.haltOnFailure) __config.haltOnFailure = true;
  if (cfg.projectRoot) __config.projectRoot = cfg.projectRoot;
  if (cfg.files) for (const k of Object.keys(cfg.files)) __config.files[k] = cfg.files[k];
}

/** One k6 iteration: run every registered entry journey in order. */
export function __iterate() {
  __flowDuration = 0;
  let j = 0;
  const next = () => {
    while (j < __journeys.length) {
      const def = __journeys[j++];
      const r = __runNodes(__collectNodes(def.body, undefined), def.name, 0);
      if (__isThenable(r)) return r.then(next);
    }
    return undefined;
  };
  // Flow metrics are recorded only for iterations that ran every step.
  const done = () => {
    if (__flowMetrics) {
      __flowMetrics.duration.add(__flowDuration);
      __flowMetrics.tps.add(1);
    }
  };
  const halted = (e) => {
    if (e === __HALT) return undefined;
    throw e;
  };
  let r;
  try { r = next(); } catch (e) { return halted(e); }
  if (__isThenable(r)) return r.then(done, halted);
  done();
  return undefined;
}
`;
