/**
 * Experimental: thread journey closure-state through Postman collection
 * variables so a sub-journey's `output()` and step-to-step state reach later
 * requests, instead of being baked to placeholders at export time.
 *
 * Journey state flows through closure variables; Postman has no shared scope,
 * only `{{vars}}` round-tripped via `pm.*` between request sandboxes. So we
 * recover each closure's source (`Function.prototype.toString()`) and re-run it
 * inside a Postman script against a JSON carrier held in the collection
 * variable `__journey_state`:
 *
 *   - READS resolve through `with (__s) { ... }` (the carrier's properties
 *     shadow the closure's free variables), so we don't have to discover which
 *     variables a closure reads.
 *   - WRITES (assignment targets in `after`) are pre-seeded as carrier keys so
 *     the `with`-scoped assignment lands on the carrier and survives the
 *     round-trip.
 *
 * This is a best-effort transform for the common closure shapes. Known limits:
 * only JSON-serialisable state survives; closures referencing module-level
 * imports (helpers, `endpoints`) won't resolve; async closures are unsupported.
 *
 * Covers dynamic headers, path params, query and body (reads) and `after`
 * (writes), a sub-journey call's dynamic `inputs` (parent state → the child's
 * `input.*`), and sub-journey `output()` → parent `after`. Static values keep
 * their baked behaviour.
 */

import type { StepDef } from "@journey/core";

export const STATE_VAR = "__journey_state";

/** Wrap a closure's source so it is a callable expression. */
export function toCallable(src: string): string {
  const s = src.trim();
  // Arrow or function expression — already an expression.
  if (
    /^(async\s+)?function\b/.test(s) ||
    /^(async\s*)?\(/.test(s) ||
    /^(async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(s)
  ) {
    return `(${s})`;
  }
  // Method shorthand: `name(args) { ... }` → `function (args) { ... }`.
  return `(${s.replace(/^(async\s+)?[A-Za-z_$][\w$]*\s*\(/, (m) =>
    /^async/.test(m) ? "async function(" : "function(",
  )})`;
}

const JS_RESERVED = new Set([
  "if",
  "else",
  "for",
  "while",
  "do",
  "return",
  "var",
  "let",
  "const",
  "function",
  "new",
  "typeof",
  "instanceof",
  "in",
  "of",
  "this",
  "true",
  "false",
  "null",
  "undefined",
  "void",
  "delete",
  "try",
  "catch",
  "throw",
  "switch",
  "case",
  "break",
  "continue",
  "async",
  "await",
]);

/**
 * Assignment targets in a closure body — the variables an `after` writes back
 * to journey state. We pre-seed these as carrier keys so a `with`-scoped
 * assignment persists. Member writes (`a.b = …`) and `==`/`=>` are ignored.
 */
export function writeTargets(src: string, locals: ReadonlyArray<string>): string[] {
  const skip = new Set([...locals, ...JS_RESERVED]);
  const out = new Set<string>();
  const re = /(^|[^.=!<>+\-*/%&|^\w$])([A-Za-z_$][\w$]*)\s*=(?![=>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[2]!;
    if (!skip.has(name)) out.add(name);
  }
  return [...out];
}

/** Param names of a closure source, e.g. `(res)` / `res =>` / `after(res)`. */
function paramNames(src: string): string[] {
  const s = src.trim();
  const arrowBare = /^(async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(s);
  if (arrowBare) return [arrowBare[2]!];
  const paren = /^(?:async\s+)?(?:[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/.exec(s);
  if (!paren) return [];
  return paren[1]!
    .split(",")
    .map((p) => p.trim().split(/[=:\s]/)[0]!)
    .filter(Boolean);
}

// Prelude shared by every threaded script: rehydrate the carrier and provide
// the `env` shim. `with` needs a non-strict `Function`, which is what we build.
const PRELUDE = [
  `var __s = JSON.parse(pm.collectionVariables.get(${JSON.stringify(STATE_VAR)}) || "{}");`,
  `function __save(){ pm.collectionVariables.set(${JSON.stringify(STATE_VAR)}, JSON.stringify(__s)); }`,
  `function env(k){ var v = pm.variables.get(k); return v === undefined ? pm.collectionVariables.get(k) : v; }`,
];

/**
 * `expect`/`output` shims for test scripts (assert uses expect; a sub-journey
 * child's `after` calls output()).
 *
 * Two modes:
 *   - **strict** (default): each matcher wraps its `pm.expect` in its own
 *     `pm.test(...)`. A genuine assertion failure throws *inside* that `pm.test`
 *     callback → Newman records it red and counts it. A threading artifact
 *     (unresolved import / arg-eval `TypeError`) is thrown *outside* any
 *     matcher's `pm.test` — during raw closure code or while evaluating the
 *     `expect(...)`/matcher arguments — so it bubbles to `runHook`'s outer
 *     try/catch and is swallowed. The `pm.test` boundary is the
 *     genuine-vs-artifact discriminator, so no error tagging is needed.
 *   - **lenient** (`--lenient`): bare `pm.expect`, no `pm.test`. The outer
 *     try/catch swallows everything — the legacy non-enforcing skeleton.
 *
 * Strict labels read `<__base> · assert <n>` where `__base` is set per-script by
 * the caller (the step / sub-journey name); the chai message carries the value
 * detail. Assertions do not short-circuit: a failed `expect` is recorded and the
 * hook keeps running (matches the legacy behaviour where `after` always ran).
 */
function testShims(strict: boolean): string[] {
  if (!strict) {
    return [
      `function expect(v){ return {`,
      `  toBe:function(e){ pm.expect(v).to.eql(e); },`,
      `  toEqual:function(e){ pm.expect(v).to.eql(e); },`,
      `  toBeDefined:function(){ pm.expect(v).to.not.be.undefined; },`,
      `  toContain:function(e){ pm.expect(v).to.include(e); },`,
      `  toMatch:function(e){ pm.expect(String(v)).to.match(typeof e === "string" ? new RegExp(e) : e); },`,
      `}; }`,
      `function output(v){ __s.__out = v; }`,
    ];
  }
  return [
    `var __ai = 0;`,
    `function __label(){ return (typeof __base !== "undefined" ? __base : "assertion") + " · assert " + (++__ai); }`,
    `function expect(v){ return {`,
    `  toBe:function(e){ pm.test(__label(), function(){ pm.expect(v).to.eql(e); }); },`,
    `  toEqual:function(e){ pm.test(__label(), function(){ pm.expect(v).to.eql(e); }); },`,
    `  toBeDefined:function(){ pm.test(__label(), function(){ pm.expect(v).to.not.be.undefined; }); },`,
    `  toContain:function(e){ pm.test(__label(), function(){ pm.expect(v).to.include(e); }); },`,
    `  toMatch:function(e){ pm.test(__label(), function(){ pm.expect(String(v)).to.match(typeof e === "string" ? new RegExp(e) : e); }); },`,
    `}; }`,
    `function output(v){ __s.__out = v; }`,
  ];
}

/** Run a zero-arg lazy closure under `with(__s)` and return its value (or {}). */
function runLazy(src: string): string {
  return `(new Function("__s","env","with(__s){ try { return ${toCallable(src).replace(/"/g, '\\"')}(); } catch (e) { return undefined; } }"))(__s, env)`;
}

/** True when a step option is a function (dynamic) rather than a baked value. */
function isFn(v: unknown): v is (...a: unknown[]) => unknown {
  return typeof v === "function";
}

/**
 * Folder pre-request that threads a sub-journey call's **dynamic** `inputs`
 * across the input boundary. The call's `inputs: () => ({ token, … })` closure
 * reads parent-scope state; we re-run it against the carrier and seed the
 * result under the child body's parameter name (`input`), so the child's own
 * closures — `headers: () => ({ Authorization: \`Bearer ${input.token}\` })` —
 * resolve `input.*` through their `with(__s)`. Saves first, so a following
 * cache-hit script (which re-reads the carrier) observes the seeded inputs.
 *
 * Only emitted for function-valued `inputs`: a static / `env()`-placeholder
 * input bakes to resolvable `{{KEY}}` folder data and needs no threading.
 */
export function subInputSeed(paramName: string, inputsSrc: string): string[] {
  return [
    ...PRELUDE,
    `var __in = ${runLazy(inputsSrc)};`,
    `if (__in && typeof __in === "object") __s[${JSON.stringify(paramName)}] = __in;`,
    `__save();`,
  ];
}

/**
 * Pre-request script for a step. Dynamic options are recomputed against the
 * carrier and applied to the outgoing request:
 *   - `headers` → `pm.request.headers.upsert`
 *   - `params`  → `pm.variables` (the baked `{{key}}` path slots resolve)
 *   - `query`   → `pm.variables` named `__q_<key>` (baked `?k={{__q_k}}` resolve)
 *   - `body`    → `pm.variables.__journey_body` (baked raw `{{__journey_body}}`)
 * Returns the exec lines, or null when the step has nothing dynamic to thread.
 */
export function stepPrerequest(step: StepDef): string[] | null {
  const lines: string[] = [];
  const { headers, params, query, body } = step.options;

  if (isFn(headers)) {
    lines.push(
      `var __h = ${runLazy(headers.toString())};`,
      `if (__h) Object.keys(__h).forEach(function(k){ pm.request.headers.upsert({ key: k, value: String(__h[k]) }); });`,
    );
  }
  if (isFn(params)) {
    lines.push(
      `var __p = ${runLazy(params.toString())};`,
      `if (__p) Object.keys(__p).forEach(function(k){ pm.variables.set(k, String(__p[k])); });`,
    );
  }
  if (isFn(query)) {
    lines.push(
      `var __q = ${runLazy(query.toString())};`,
      `if (__q) Object.keys(__q).forEach(function(k){ if (__q[k] !== undefined) pm.variables.set("__q_" + k, String(__q[k])); });`,
    );
  }
  if (isFn(body)) {
    lines.push(
      `var __b = ${runLazy(body.toString())};`,
      `pm.variables.set("__journey_body", __b === undefined ? "" : (typeof __b === "string" ? __b : JSON.stringify(__b)));`,
    );
  }
  if (lines.length === 0) return null;
  return [...PRELUDE, ...lines];
}

/**
 * Build the test-script lines that run a `res`-taking hook (`after`/`assert`)
 * under `with(__s)`, pre-seeding its write targets so assignments persist.
 */
function runHook(src: string, resExpr: string): string[] {
  const targets = writeTargets(src, paramNames(src));
  const seed = targets.map(
    (t) => `if (!(${JSON.stringify(t)} in __s)) __s[${JSON.stringify(t)}] = undefined;`,
  );
  const callable = toCallable(src).replace(/"/g, '\\"');
  return [
    ...seed,
    `try { (new Function("__s","__arg","env","expect","output","with(__s){ ${callable}(__arg); }"))(__s, ${resExpr}, env, expect, output); } catch (e) { console.log("journey hook:", e && e.message ? e.message : e); }`,
  ];
}

/**
 * Test script for a step: rebuild `res`, run `assert` then `after` (mirroring
 * the runtime order), then optionally a sub-journey's parent `after(out)` when
 * this is the terminal request of a sub-journey folder, then persist.
 */
export function stepTest(
  step: StepDef,
  parentHooks: ReadonlyArray<(out: unknown) => unknown> = [],
  cacheStore?: CacheStore,
  strict = true,
): string[] | null {
  const assert = step.options.assert;
  const after = step.options.after;
  if (!isFn(assert) && !isFn(after) && parentHooks.length === 0 && !cacheStore) return null;

  const lines: string[] = [
    ...PRELUDE,
    `var __base = ${JSON.stringify(step.name)};`,
    ...testShims(strict),
    `var res = { status: pm.response.code, headers: pm.response.headers && pm.response.headers.toObject ? pm.response.headers.toObject() : {}, body: (function(){ try { return pm.response.json(); } catch (e) { return pm.response.text(); } })() };`,
  ];
  if (isFn(assert)) lines.push(...runHook(assert.toString(), "res"));
  if (isFn(after)) lines.push(...runHook(after.toString(), "res"));
  // When this is the terminal request of a sub-journey folder, the child set
  // `output(...)` → `__s.__out`; the parent call's assert/after then consume
  // it. Inner-to-outer order (the immediate parent's hooks first).
  for (const hook of parentHooks) lines.push(...runHook(hook.toString(), "__s.__out"));
  lines.push(`__save();`);
  // Cache miss-path store: runs last, so it sees the child's `output(...)`.
  if (cacheStore) lines.push(...cacheStoreLines(cacheStore));
  return lines;
}

function hookLines(srcs: ReadonlyArray<string>, outExpr: string): string[] {
  const lines: string[] = [];
  for (const src of srcs) lines.push(...runHook(src, outExpr));
  return lines;
}

/** Names + expiry expression that wire a threaded sub-journey's cache. */
export interface CacheStore {
  jcVar: string;
  jcvVar: string;
  expExpr: string;
}

/**
 * Folder pre-request for a `cacheKey`'d sub-journey **under state threading** —
 * folds the cache skip into the carrier so a hit still delivers the child's
 * output. On a hit it restores the stored output into `__journey_state.__out`,
 * runs the call's hooks against it (so e.g. a token still reaches later steps),
 * saves, then skips the request. The miss-path store (expiry + value) lives in
 * the terminal child's request test — see {@link stepTest}'s `cacheStore` — so
 * it observes the child's `output(...)` (Newman runs folder tests *before*
 * request tests, so a folder test would store the value too early).
 */
export function cacheHitPrerequest(
  store: CacheStore,
  hooks: ReadonlyArray<(out: unknown) => unknown>,
  strict = true,
): string[] {
  const hookSrcs = hooks.map((h) => h.toString());
  return [
    ...PRELUDE,
    `var __base = "sub-journey";`,
    ...testShims(strict),
    `var __exp = pm.collectionVariables.get(${JSON.stringify(store.jcVar)});`,
    `if (__exp && Date.now() < Number(__exp)) {`,
    `  var __v = pm.collectionVariables.get(${JSON.stringify(store.jcvVar)});`,
    `  if (__v) { try { __s.__out = JSON.parse(__v); } catch (e) {} }`,
    ...hookLines(hookSrcs, "__s.__out").map((l) => "  " + l),
    `  __save();`,
    `  pm.execution.skipRequest();`,
    `}`,
  ];
}

/**
 * Folder pre-request that skips a cached sub-journey's request while the cache
 * window is valid — the plain (non-threaded) cache. The window is opened by
 * {@link cacheExpirySet} on the sub's **terminal** request, so on the cold run
 * every request in a multi-request child still executes (a folder-level set
 * would open the window mid-folder and over-skip the remaining requests).
 */
export function cacheSkipPrerequest(store: CacheStore): string[] {
  return [
    `var __exp = pm.collectionVariables.get(${JSON.stringify(store.jcVar)});`,
    `if (__exp && Date.now() < Number(__exp)) { pm.execution.skipRequest(); }`,
  ];
}

/** Open the cache window — appended to a cached sub's terminal request test. */
export function cacheExpirySet(store: CacheStore): string[] {
  return [
    `var __exp = pm.collectionVariables.get(${JSON.stringify(store.jcVar)});`,
    `if (!(__exp && Date.now() < Number(__exp))) { pm.collectionVariables.set(${JSON.stringify(store.jcVar)}, String(${store.expExpr})); }`,
  ];
}

/** The miss-path store appended to a cached sub's terminal request test. */
function cacheStoreLines(store: CacheStore): string[] {
  return [
    `var __exp = pm.collectionVariables.get(${JSON.stringify(store.jcVar)});`,
    `if (!(__exp && Date.now() < Number(__exp))) {`,
    `  pm.collectionVariables.set(${JSON.stringify(store.jcVar)}, String(${store.expExpr}));`,
    `  if (__s.__out !== undefined) pm.collectionVariables.set(${JSON.stringify(store.jcvVar)}, JSON.stringify(__s.__out));`,
    `}`,
  ];
}

/**
 * Folder-level pre-request that resets the carrier when execution enters a new
 * entry journey. Folder scripts run before every request in the folder (incl.
 * nested sub-folders), and the journey-name marker keeps the reset to once per
 * journey.
 */
export function journeyResetEvent(journeyName: string): string[] {
  const v = JSON.stringify(STATE_VAR);
  const n = JSON.stringify(journeyName);
  return [
    `var __s = JSON.parse(pm.collectionVariables.get(${v}) || "{}");`,
    `if (__s.__journey !== ${n}) { pm.collectionVariables.set(${v}, JSON.stringify({ __journey: ${n} })); }`,
  ];
}

/**
 * Pre-request for the skipped **reset** item at the head of the collection.
 * Postman persists collection variables across Runner executions, so a re-run
 * would observe the *previous* run's open cache windows and threaded carrier:
 * cached sub-journeys would skip their requests (and their side effects), and
 * threaded asserts would gate on stale state — turning a clean cold run red.
 * (Newman starts each run with empty variables, so it never sees this.) Clearing
 * the carrier and every cache slot here makes each GUI run start cold, matching
 * Newman. The request itself never sends — `pm.execution.skipRequest()` drops it
 * (Newman ≥ 6 / Postman ≥ 10.12, the same floor the cache already requires).
 */
export function collectionResetScript(): string[] {
  return [
    `var __all = pm.collectionVariables.toObject ? pm.collectionVariables.toObject() : {};`,
    `Object.keys(__all).forEach(function(k){`,
    `  if (k === ${JSON.stringify(STATE_VAR)} || k.indexOf("__jc_") === 0 || k.indexOf("__jcv_") === 0) {`,
    `    pm.collectionVariables.unset(k);`,
    `  }`,
    `});`,
    `if (pm.execution && pm.execution.skipRequest) pm.execution.skipRequest();`,
  ];
}
