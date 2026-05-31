/** Runtime shim injected into every emitted k6 script. */
export const SHIM_SOURCE = `import http from "k6/http";
import { check, group } from "k6";

const __BASE_URL = __ENV.JOURNEY_BASE_URL || "";
const __journeys = [];
let __currentNodes = null;
let __outputSlot = null;
const __MAX_SUB_DEPTH = 8;

// Minimal no-op stand-in for zod. Reusable journeys declare \`inputs\` / \`outputs\`
// schemas via \`z\`, but k6 has no zod runtime and the schemas are not enforced
// in exported scripts — every access or call returns the same chainable proxy.
const z = new Proxy(function () {}, {
  get() { return z; },
  apply() { return z; },
  construct() { return z; },
});

// note: sub-journey cacheKey / cacheTtlMs / cache opts are NOT translated to
// k6 — every VU iteration re-runs the child journey. See the export-k6 docs.
function journey(name, optsOrBody, maybeBody) {
  const body = typeof optsOrBody === "function" ? optsOrBody : maybeBody;
  const opts = typeof optsOrBody === "function" ? null : optsOrBody;
  if (opts && opts.reusable === true) {
    return { __journeyHandle: true, name, body };
  }
  __journeys.push({ name, body });
}

function step(name, opts) {
  if (!__currentNodes) {
    throw new Error("step(" + JSON.stringify(name) + ") called outside a journey(...) body");
  }
  __currentNodes.push({ kind: "step", name, opts });
}

function invokeJourney(handle, opts) {
  if (!__currentNodes) {
    throw new Error("invokeJourney(...) called outside a journey(...) body");
  }
  __currentNodes.push({ kind: "sub", handle, opts: opts || {} });
}

function output(value) {
  if (__outputSlot) __outputSlot.value = value;
}

function env(key) {
  const v = __ENV[key];
  if (v === undefined) throw new Error("env: missing " + key);
  return v;
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

function expect(value) {
  const fail = (msg) => { const e = new Error(msg); e.name = "AssertionError"; throw e; };
  return {
    toBe(expected) { if (!Object.is(value, expected)) fail("expected " + JSON.stringify(value) + " to be " + JSON.stringify(expected)); },
    toEqual(expected) { if (!deepEqual(value, expected)) fail("expected " + JSON.stringify(value) + " to equal " + JSON.stringify(expected)); },
    toBeDefined() { if (value === undefined) fail("expected value to be defined"); },
    toContain(expected) {
      if (typeof value === "string") { if (!value.includes(expected)) fail("expected string to contain " + JSON.stringify(expected)); return; }
      if (Array.isArray(value)) { if (!value.some((v) => deepEqual(v, expected))) fail("expected array to contain " + JSON.stringify(expected)); return; }
      fail("toContain only supports strings and arrays");
    },
    toMatch(expected) {
      if (typeof value !== "string") fail("toMatch only supports strings");
      const re = typeof expected === "string" ? new RegExp(expected) : expected;
      if (!re.test(value)) fail("expected " + JSON.stringify(value) + " to match " + re);
    },
  };
}

function __parseBody(res) {
  const ct = (res.headers && (res.headers["Content-Type"] || res.headers["content-type"])) || "";
  if (ct.indexOf("json") !== -1) { try { return res.json(); } catch (e) { return null; } }
  return res.body;
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

function __executeStep(current, journeyName) {
  const opts = current.opts;
  const headers = typeof opts.headers === "function" ? opts.headers() : (opts.headers || {});
  const body = typeof opts.body === "function" ? opts.body() : opts.body;
  // params and query are lazy in the core runtime — resolve a function form
  // before interpolating the path / building the query string, like headers/body.
  const params = typeof opts.params === "function" ? opts.params() : opts.params;
  const query = typeof opts.query === "function" ? opts.query() : opts.query;
  const path = __interpolate(opts.endpoint.path, params);
  const base = opts.endpoint.baseUrl || __BASE_URL;
  const url = base + path + __buildQuery(query);
  const requestHeaders = __mergeHeaders(headers);
  if (body !== undefined && !("Content-Type" in requestHeaders) && !("content-type" in requestHeaders)) {
    requestHeaders["Content-Type"] = "application/json";
  }
  const res = http.request(
    opts.endpoint.method,
    url,
    body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : null,
    { headers: requestHeaders },
  );
  const wrapped = { status: res.status, headers: res.headers, body: __parseBody(res) };
  if (opts.assert) {
    const name = journeyName + " › " + current.name;
    check(wrapped, {
      [name]: (r) => {
        try { opts.assert(r); return true; } catch (e) { console.error(name + ": " + (e && e.message ? e.message : e)); return false; }
      },
    });
  }
  if (opts.after) opts.after(wrapped);
}

// Inline a sub-journey node under a k6 group() named after the child journey.
function __runSub(node, depth) {
  if (depth >= __MAX_SUB_DEPTH) {
    throw new Error("invokeJourney: sub-journey nesting exceeded " + __MAX_SUB_DEPTH + " levels");
  }
  const handle = node.handle;
  const opts = node.opts || {};
  const label = opts.name || handle.name;
  let input = opts.inputs;
  if (typeof input === "function") input = input();
  const childNodes = __collectNodes(handle.body, input);
  const prevSlot = __outputSlot;
  const slot = { value: undefined };
  __outputSlot = slot;
  try {
    group(label, () => { __runNodes(childNodes, handle.name, depth + 1); });
  } finally {
    __outputSlot = prevSlot;
  }
  if (opts.assert) opts.assert(slot.value);
  if (opts.after) opts.after(slot.value);
}

function __runNodes(nodes, journeyName, depth) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.kind === "sub") __runSub(node, depth);
    else __executeStep(node, journeyName);
  }
}
`;

/** The k6 default function, appended after user code. */
export const ENTRY_SOURCE = `
export default function () {
  for (let i = 0; i < __journeys.length; i++) {
    const j = __journeys[i];
    const nodes = __collectNodes(j.body, undefined);
    __runNodes(nodes, j.name, 0);
  }
}
`;
