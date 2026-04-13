/** Runtime shim injected into every emitted k6 script. */
export const SHIM_SOURCE = `import http from "k6/http";
import { check } from "k6";

const __BASE_URL = __ENV.JOURNEY_BASE_URL || "";
const __journeys = [];
let __currentSteps = null;

function journey(name, body) {
  __journeys.push({ name, body });
}

function step(name, opts) {
  if (!__currentSteps) {
    throw new Error("step(" + JSON.stringify(name) + ") called outside a journey(...) body");
  }
  __currentSteps.push({ name, opts });
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
`;

/** The k6 default function, appended after user code. */
export const ENTRY_SOURCE = `
export default function () {
  for (let i = 0; i < __journeys.length; i++) {
    const j = __journeys[i];
    const steps = [];
    __currentSteps = steps;
    try { j.body(); } finally { __currentSteps = null; }
    for (let s = 0; s < steps.length; s++) {
      const current = steps[s];
      const opts = current.opts;
      const headers = typeof opts.headers === "function" ? opts.headers() : (opts.headers || {});
      const body = typeof opts.body === "function" ? opts.body() : opts.body;
      const path = __interpolate(opts.endpoint.path, opts.params);
      const base = opts.endpoint.baseUrl || __BASE_URL;
      const url = base + path;
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
        const name = j.name + " › " + current.name;
        check(wrapped, {
          [name]: (r) => {
            try { opts.assert(r); return true; } catch (e) { console.error(name + ": " + (e && e.message ? e.message : e)); return false; }
          },
        });
      }
      if (opts.after) opts.after(wrapped);
    }
  }
}
`;
