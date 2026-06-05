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
 * Scope of this increment: headers + path params (reads) and `after` (writes)
 * plus sub-journey `output()` → parent `after`. Body and query threading are
 * tracked follow-ups; static values keep their baked behaviour.
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

// `expect`/`output` shims for test scripts (assert uses expect; a sub-journey
// child's `after` calls output()).
const TEST_SHIMS = [
  `function expect(v){ return {`,
  `  toBe:function(e){ pm.expect(v).to.eql(e); },`,
  `  toEqual:function(e){ pm.expect(v).to.eql(e); },`,
  `  toBeDefined:function(){ pm.expect(v).to.not.be.undefined; },`,
  `  toContain:function(e){ pm.expect(v).to.include(e); },`,
  `  toMatch:function(e){ pm.expect(String(v)).to.match(typeof e === "string" ? new RegExp(e) : e); },`,
  `}; }`,
  `function output(v){ __s.__out = v; }`,
];

/** Run a zero-arg lazy closure under `with(__s)` and return its value (or {}). */
function runLazy(src: string): string {
  return `(new Function("__s","env","with(__s){ try { return ${toCallable(src).replace(/"/g, '\\"')}(); } catch (e) { return undefined; } }"))(__s, env)`;
}

/** True when a step option is a function (dynamic) rather than a baked value. */
function isFn(v: unknown): v is (...a: unknown[]) => unknown {
  return typeof v === "function";
}

/**
 * Pre-request script for a step: apply dynamic headers (upsert) and dynamic
 * path params (as `pm.variables`, so the baked `{{key}}` placeholders resolve).
 * Returns the exec lines, or null when the step has nothing dynamic to thread.
 */
export function stepPrerequest(step: StepDef): string[] | null {
  const lines: string[] = [];
  const headers = step.options.headers;
  const params = step.options.params;

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
): string[] | null {
  const assert = step.options.assert;
  const after = step.options.after;
  if (!isFn(assert) && !isFn(after) && parentHooks.length === 0) return null;

  const lines: string[] = [
    ...PRELUDE,
    ...TEST_SHIMS,
    `var res = { status: pm.response.code, headers: pm.response.headers && pm.response.headers.toObject ? pm.response.headers.toObject() : {}, body: (function(){ try { return pm.response.json(); } catch (e) { return pm.response.text(); } })() };`,
  ];
  if (isFn(assert)) lines.push(...runHook(assert.toString(), "res"));
  if (isFn(after)) lines.push(...runHook(after.toString(), "res"));
  // When this is the terminal request of a sub-journey folder, the child set
  // `output(...)` → `__s.__out`; the parent call's assert/after then consume
  // it. Inner-to-outer order (the immediate parent's hooks first).
  for (const hook of parentHooks) lines.push(...runHook(hook.toString(), "__s.__out"));
  lines.push(`__save();`);
  return lines;
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
