import type { ZodType } from "zod";
import type { Endpoint, ResponseOf } from "./endpoint.js";
import { subJourneyCacheKey } from "./cache.js";
import { buildRequest, execute, type HttpContext, type HttpResponse } from "./http.js";
import {
  describeError,
  type GroupEndEvent,
  type GroupStartEvent,
  type PlannedNode,
} from "./logger.js";

/** Caller-supplied run metadata. runId is forwarded to every lifecycle event. */
export interface RunMeta {
  runId?: string;
  /**
   * Absolute (monotonic across journey boundaries) stepIdx to stop after. The
   * run still emits `run:end` cleanly; journeys/steps past this index are not
   * collected or executed. Use for "run only up to this step" in the GUI.
   */
  upToStepIdx?: number;
}

type Lazy<T> = T | (() => T | Promise<T>);

export interface StepOptions<E extends Endpoint> {
  endpoint: E;
  params?: Lazy<Record<string, string | number>>;
  query?: Lazy<Record<string, string | number | boolean | undefined>>;
  headers?: Lazy<Record<string, string>>;
  body?: Lazy<unknown>;
  timeoutMs?: number;
  assert?: (res: HttpResponse<ResponseOf<E>>) => void | Promise<void>;
  after?: (res: HttpResponse<ResponseOf<E>>) => void | Promise<void>;
}

export interface StepDef {
  name: string;
  options: StepOptions<Endpoint>;
}

/**
 * Recorded call to a reusable journey, captured in the parent's pipeline at
 * registration time. The `handle` carries the child def and its input/output
 * schemas; everything else is per-call configuration. See `invokeJourney`.
 */
export interface SubJourneyCallDef {
  handle: JourneyHandle<unknown, unknown>;
  /** Display label for the timeline; defaults to `handle.name`. */
  name?: string;
  /** Lazy or eager input. Validated against `handle.inputs` (if set) before child body runs. */
  inputs?: Lazy<unknown>;
  /** Cache opts — plumbed through `onGroupStart`. Store lookup lands in #90. */
  cacheKey?: string | ((input: unknown) => string);
  cacheTtlMs?: number;
  cache?: "off" | "inherit";
  assert?: (out: unknown) => void | Promise<void>;
  after?: (out: unknown) => void | Promise<void>;
}

/**
 * One ordered entry in the resolved pipeline of a journey. Both kinds consume
 * exactly one `stepIdx` slot in the run's monotonic counter; child steps
 * inside a `sub` node consume their own slots in the same counter.
 */
export type PipelineNode = { kind: "step"; def: StepDef } | { kind: "sub"; def: SubJourneyCallDef };

/**
 * Typed reference to a reusable journey. Returned by `journey(name, { reusable: true, ... }, body)`.
 * Pass it to `invokeJourney(handle, ...)`; the phantom `I`/`O` parameters drive
 * type inference at the call site.
 */
export interface JourneyHandle<I = unknown, O = unknown> {
  readonly name: string;
  readonly inputs?: ZodType<I>;
  readonly outputs?: ZodType<O>;
  /** Internal: the def the runtime invokes. Treat as opaque. */
  readonly __def: JourneyDef;
  /** Phantom — never assigned at runtime, only present in the type. */
  readonly __input?: I;
  readonly __output?: O;
}

/**
 * k6 `export const options` shape for an exported journey. Strict named fields
 * cover the common load profiles (vus + duration, iterations, stages); the
 * index signature passes everything else through so adding a k6 knob (e.g.
 * thresholds, scenarios, ext) does not require a core release.
 */
export interface K6JourneyOptions {
  vus?: number;
  duration?: string;
  iterations?: number;
  stages?: Array<{ duration: string; target: number }>;
  [extra: string]: unknown;
}

/**
 * Per-call configuration accepted by the 3-arg `journey()` overloads. The
 * field set is split by mode:
 *
 * - Entry journeys (default — registered for `runAllRegistered`): `tags`, `k6`.
 * - Reusable journeys (`reusable: true`, no auto-run, returns a handle):
 *   `inputs`, `outputs`.
 *
 * The two sets are disjoint in the public overloads. Mixing is an `as any`
 * escape from the type-level split; the footgun guard in `runAllRegistered`
 * catches it at run start.
 */
export interface JourneyOptions {
  /** Entry-only — drives `journey export k6 --tag` filtering. */
  tags?: string[];
  /** Entry-only — baked into the emitted k6 script's `export const options`. */
  k6?: K6JourneyOptions;
  /** Switches to reusable mode when true. */
  reusable?: boolean;
  /** Reusable-only — child input schema. Validated before the child body runs. */
  inputs?: ZodType;
  /** Reusable-only — child output schema. Validated when the child completes. */
  outputs?: ZodType;
}

export interface JourneyDef {
  name: string;
  /** Bodies for entries take no argument; reusable bodies take the validated input. */
  body: (input?: unknown) => void | Promise<void>;
  options?: JourneyOptions;
}

export interface StepResult {
  name: string;
  ok: boolean;
  request?: { method: string; url: string };
  response?: HttpResponse;
  error?: string;
  durationMs: number;
  /** Set on sub-journey nodes; the flat list of child step results in execution order. */
  children?: StepResult[];
  /** Set on sub-journey nodes — distinguishes a group entry from a regular step. */
  kind?: "step" | "sub";
  /** Set on sub-journey nodes — whether the output cache was hit or missed. */
  cacheStatus?: "hit" | "miss";
}

export interface JourneyResult {
  name: string;
  ok: boolean;
  steps: StepResult[];
  durationMs: number;
}

interface ChildOutputSlot {
  value: unknown;
  written: boolean;
}

// Shared across module instances — tsx can load `@journey/core` more than once
// (once from the runner, once through the journey file's imports), and we need
// both copies to point at the same registry/collector.
interface SharedState {
  registry: JourneyDef[];
  collecting: PipelineNode[] | undefined;
  /**
   * The HttpContext driving the currently-executing journey. `runJourney`
   * sets this before iterating steps and clears it afterwards so user-facing
   * helpers (e.g. the instrumented `fetch` export) can route their I/O
   * through the active run's logger without needing the ctx threaded as an
   * argument.
   */
  currentCtx: HttpContext | undefined;
  /**
   * Stack of in-flight reusable journey output slots. `output(value)` writes
   * to the top slot; it's a stack so a sub-journey that itself invokes another
   * sub-journey doesn't trample the outer slot.
   */
  childOutputs: ChildOutputSlot[];
}
const STATE_KEY = Symbol.for("@journey/core::runtime-state");
const globals = globalThis as unknown as { [STATE_KEY]?: SharedState };
const state: SharedState =
  globals[STATE_KEY] ??
  (globals[STATE_KEY] = {
    registry: [],
    collecting: undefined,
    currentCtx: undefined,
    childOutputs: [],
  });

/** Hard limit on nested `invokeJourney` calls; trips on suspected runaway recursion. */
const MAX_SUB_JOURNEY_DEPTH = 8;

/**
 * Returns the HttpContext bound to the currently-executing journey, or
 * undefined when called outside a run. Consumed by the instrumented `fetch`
 * helper so that ad-hoc HTTP calls made from inside step hooks land on the
 * same logger as the steps themselves.
 */
export function getCurrentCtx(): HttpContext | undefined {
  return state.currentCtx;
}

/** Type for the journey body when no `inputs` schema is set. */
type EntryBody = () => void | Promise<void>;
/** Type for a reusable journey body — receives the validated input. */
type ReusableBody<I> = (input: I) => void | Promise<void>;

/** Strict reusable options — discriminated by literal `reusable: true`. */
export interface ReusableJourneyOptions<I, O> {
  reusable: true;
  inputs?: ZodType<I>;
  outputs?: ZodType<O>;
}

/** Strict entry options — `reusable` must be absent or false. */
export interface EntryJourneyOptions {
  reusable?: false;
  tags?: string[];
  k6?: K6JourneyOptions;
}

// Reusable: returns a typed handle, does NOT register for auto-run.
export function journey<I, O>(
  name: string,
  options: ReusableJourneyOptions<I, O>,
  body: ReusableBody<I>,
): JourneyHandle<I, O>;
// Entry with options: registered, auto-run.
export function journey(name: string, options: EntryJourneyOptions, body: EntryBody): void;
// Entry, no options: registered, auto-run.
export function journey(name: string, body: EntryBody): void;
export function journey(
  name: string,
  optionsOrBody: ReusableJourneyOptions<unknown, unknown> | EntryJourneyOptions | EntryBody,
  maybeBody?: ReusableBody<unknown> | EntryBody,
): JourneyHandle<unknown, unknown> | void {
  const bodyFn =
    typeof optionsOrBody === "function"
      ? (optionsOrBody as EntryBody)
      : (maybeBody as ReusableBody<unknown> | EntryBody);
  const options = typeof optionsOrBody === "function" ? undefined : optionsOrBody;
  if (options && (options as ReusableJourneyOptions<unknown, unknown>).reusable === true) {
    const reusable = options as ReusableJourneyOptions<unknown, unknown>;
    const def: JourneyDef = {
      name,
      body: bodyFn as (input?: unknown) => void | Promise<void>,
      options: {
        reusable: true,
        ...(reusable.inputs ? { inputs: reusable.inputs } : {}),
        ...(reusable.outputs ? { outputs: reusable.outputs } : {}),
      },
    };
    const handle: JourneyHandle<unknown, unknown> = {
      name,
      ...(reusable.inputs ? { inputs: reusable.inputs } : {}),
      ...(reusable.outputs ? { outputs: reusable.outputs } : {}),
      __def: def,
    };
    return handle;
  }
  // Entry mode — push to the auto-run registry.
  const entryOpts = options as EntryJourneyOptions | undefined;
  const def: JourneyDef = {
    name,
    body: bodyFn as EntryBody,
    ...(entryOpts ? { options: entryOpts } : {}),
  };
  state.registry.push(def);
}

export function step<E extends Endpoint>(name: string, options: StepOptions<E>): void {
  if (!state.collecting) {
    throw new Error(`step(${JSON.stringify(name)}) called outside a journey(...) body`);
  }
  state.collecting.push({
    kind: "step",
    def: { name, options: options as StepOptions<Endpoint> },
  });
}

/** Options accepted at an `invokeJourney(handle, opts)` call site. */
export interface InvokeJourneyOptions<I, O> {
  inputs?: I | (() => I | Promise<I>);
  /** Override the timeline display label; defaults to `handle.name`. */
  name?: string;
  cacheKey?: string | ((input: I) => string);
  cacheTtlMs?: number;
  cache?: "off" | "inherit";
  assert?: (out: O) => void | Promise<void>;
  after?: (out: O) => void | Promise<void>;
}

/**
 * Pipeline-level primitive: registers a sub-journey call as a node in the
 * surrounding journey's pipeline. Like `step()`, this is called during the
 * registration phase (the journey body), not at execution time — the child
 * runs inline when the runtime reaches the node.
 */
export function invokeJourney<I, O>(
  handle: JourneyHandle<I, O>,
  opts: InvokeJourneyOptions<I, O> = {},
): void {
  if (!state.collecting) {
    throw new Error(
      `invokeJourney(${JSON.stringify(handle.name)}) called outside a journey(...) body`,
    );
  }
  const callDef: SubJourneyCallDef = {
    handle: handle as JourneyHandle<unknown, unknown>,
  };
  if (opts.name !== undefined) callDef.name = opts.name;
  if (opts.inputs !== undefined) callDef.inputs = opts.inputs as Lazy<unknown>;
  if (opts.cacheKey !== undefined) {
    const ck = opts.cacheKey;
    callDef.cacheKey =
      typeof ck === "function" ? (ck as (input: unknown) => string) : (ck as string);
  }
  if (opts.cacheTtlMs !== undefined) callDef.cacheTtlMs = opts.cacheTtlMs;
  if (opts.cache !== undefined) callDef.cache = opts.cache;
  if (opts.assert !== undefined) {
    callDef.assert = opts.assert as (out: unknown) => void | Promise<void>;
  }
  if (opts.after !== undefined) {
    callDef.after = opts.after as (out: unknown) => void | Promise<void>;
  }
  state.collecting.push({ kind: "sub", def: callDef });
}

/**
 * Terminal helper for reusable journeys: records the value returned to the
 * parent's `invokeJourney({ after })`. Called from inside any step's `after`
 * hook within the child body. Multiple calls: last wins (with a warn log).
 * Called outside a reusable journey context: warn and no-op.
 */
export function output(value: unknown): void {
  if (state.childOutputs.length === 0) {
    state.currentCtx?.logger?.onLog?.({
      level: "warn",
      text: "output() called outside a reusable journey; ignored",
    });
    return;
  }
  const slot = state.childOutputs[state.childOutputs.length - 1]!;
  if (slot.written) {
    state.currentCtx?.logger?.onLog?.({
      level: "warn",
      text: "output() called more than once in a single sub-journey; last value wins",
    });
  }
  slot.value = value;
  slot.written = true;
}

export function getRegisteredJourneys(): ReadonlyArray<JourneyDef> {
  return state.registry;
}

export function clearRegistry(): void {
  state.registry.length = 0;
}

/**
 * Walks a journey body and returns the **step** nodes only. Kept as a
 * filter-down view for back-compat with exporters that don't yet support
 * sub-journey nesting (#91, #92); new consumers should use `collectPipeline`.
 */
export async function collectSteps(def: JourneyDef): Promise<ReadonlyArray<StepDef>> {
  const nodes = await collectPipeline(def);
  return nodes
    .filter((n): n is { kind: "step"; def: StepDef } => n.kind === "step")
    .map((n) => n.def);
}

/** Walks a journey body and returns every pipeline node (step + sub) in order. */
export async function collectPipeline(def: JourneyDef): Promise<ReadonlyArray<PipelineNode>> {
  return collectPipelineWithInput(def, undefined);
}

/**
 * Evaluates a journey body to collect its pipeline nodes, passing `input` to
 * the body. Entry bodies ignore the argument; reusable bodies receive it as
 * their declared input. `state.collecting` is saved and restored so a
 * collection can nest inside another (used by plan-time sub-journey discovery).
 */
async function collectPipelineWithInput(def: JourneyDef, input: unknown): Promise<PipelineNode[]> {
  const nodes: PipelineNode[] = [];
  const prev = state.collecting;
  state.collecting = nodes;
  try {
    await def.body(input);
  } finally {
    state.collecting = prev;
  }
  return nodes;
}

async function resolveLazy<T>(v: Lazy<T> | undefined): Promise<T | undefined> {
  if (v === undefined) return undefined;
  return typeof v === "function" ? await (v as () => T | Promise<T>)() : v;
}

/**
 * Best-effort plan-time discovery of a sub-journey's child pipeline. Evaluates
 * the reusable journey body — no HTTP, just `step()` / `invokeJourney()`
 * registration — with the call's resolved inputs. Returns `null` when input
 * resolution or the body itself throws, so the caller can mark the planned
 * node `incomplete`.
 *
 * The child body also runs at execution time (`executeSubNode`), so an
 * `inputs` resolver with side effects fires twice. Inputs are normally pure
 * (env reads, references to the parent's input), so this is acceptable for a
 * best-effort plan.
 */
async function discoverChildNodes(call: SubJourneyCallDef): Promise<PipelineNode[] | null> {
  let input: unknown;
  try {
    input = call.inputs !== undefined ? await resolveLazy(call.inputs) : undefined;
  } catch {
    input = undefined;
  }
  try {
    return await collectPipelineWithInput(call.handle.__def, input);
  } catch {
    return null;
  }
}

/**
 * Walks a resolved pipeline into the nested `PlannedNode` tree broadcast on
 * `onPlanned`. Recurses into sub-journey nodes — best-effort, see
 * `discoverChildNodes` — and marks a node `incomplete` when its child
 * pipeline could not be discovered or the recursion cap is reached.
 */
async function planPipeline(
  nodes: ReadonlyArray<PipelineNode>,
  depth: number,
): Promise<PlannedNode[]> {
  const out: PlannedNode[] = [];
  for (const node of nodes) {
    if (node.kind === "step") {
      out.push({
        kind: "step",
        name: node.def.name,
        method: node.def.options.endpoint.method,
        path: node.def.options.endpoint.path,
      });
      continue;
    }
    const planned: PlannedNode = {
      kind: "sub",
      name: node.def.name ?? node.def.handle.name,
    };
    const childNodes = depth < MAX_SUB_JOURNEY_DEPTH ? await discoverChildNodes(node.def) : null;
    if (childNodes) {
      planned.children = await planPipeline(childNodes, depth + 1);
    } else {
      planned.incomplete = true;
    }
    out.push(planned);
  }
  return out;
}

/**
 * Resolves a journey's plan tree without executing it — the same nested
 * `PlannedNode[]` that `onPlanned` broadcasts at run start. Evaluates the
 * journey body (and, best-effort, each sub-journey body) to discover steps;
 * performs no HTTP. Lets a surface pre-render a timeline before the run.
 *
 * `env()` references in the body are resolved against the active environment,
 * so callers should `setActiveEnvironment(...)` first, exactly as they would
 * before a run.
 */
export async function planJourney(def: JourneyDef): Promise<PlannedNode[]> {
  const nodes = await collectPipeline(def);
  return planPipeline(nodes, 0);
}

interface ExecMeta {
  runId: string;
  journeyIdx: number;
  journeyName: string;
}

interface ExecState {
  counter: number;
  ok: boolean;
  /** Set when the loop should stop launching new nodes (abort, upToStepIdx hit). */
  halt: boolean;
}

async function executeStepNode(
  s: StepDef,
  ctx: HttpContext,
  meta: ExecMeta,
  stepIdx: number,
): Promise<StepResult> {
  const start = Date.now();
  ctx.logger?.onStepStart?.({
    runId: meta.runId,
    journeyIdx: meta.journeyIdx,
    journeyName: meta.journeyName,
    stepIdx,
    name: s.name,
  });
  try {
    const headers = await resolveLazy(s.options.headers);
    const query = await resolveLazy(s.options.query);
    const body = await resolveLazy(s.options.body);
    const params = await resolveLazy(s.options.params);
    const req = buildRequest(
      {
        endpoint: s.options.endpoint,
        ...(params !== undefined ? { params } : {}),
        ...(query !== undefined ? { query } : {}),
        ...(headers !== undefined ? { headers } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(s.options.timeoutMs !== undefined ? { timeoutMs: s.options.timeoutMs } : {}),
      },
      ctx,
    );
    const response = await execute(req, ctx);
    if (s.options.assert) await s.options.assert(response as HttpResponse<never>);
    if (s.options.after) await s.options.after(response as HttpResponse<never>);
    const durationMs = Date.now() - start;
    ctx.logger?.onStepEnd?.({
      runId: meta.runId,
      journeyIdx: meta.journeyIdx,
      stepIdx,
      ok: true,
      durationMs,
    });
    return {
      name: s.name,
      ok: true,
      request: { method: req.method, url: req.url },
      response,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = describeError(err);
    ctx.logger?.onStepEnd?.({
      runId: meta.runId,
      journeyIdx: meta.journeyIdx,
      stepIdx,
      ok: false,
      durationMs,
      error,
    });
    return { name: s.name, ok: false, error, durationMs };
  }
}

function resolveCacheKey(
  cacheKey: SubJourneyCallDef["cacheKey"],
  input: unknown,
): string | undefined {
  if (cacheKey === undefined) return undefined;
  if (typeof cacheKey === "function") return cacheKey(input);
  return cacheKey;
}

async function executeSubNode(
  call: SubJourneyCallDef,
  ctx: HttpContext,
  meta: ExecMeta,
  stepIdx: number,
  upToStepIdx: number | undefined,
  depth: number,
  execState: ExecState,
): Promise<StepResult> {
  const displayName = call.name ?? call.handle.name;
  const start = Date.now();
  const firstChildStepIdx = stepIdx + 1;

  // Resolve inputs eagerly so a schema mismatch surfaces before group:start.
  let input: unknown;
  try {
    input = call.inputs !== undefined ? await resolveLazy(call.inputs) : undefined;
    if (call.handle.inputs) {
      input = call.handle.inputs.parse(input);
    }
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = `sub-journey "${call.handle.name}" input validation failed: ${describeError(err)}`;
    // Still surface the group bookends so subscribers can attribute the failure.
    ctx.logger?.onGroupStart?.({
      runId: meta.runId,
      journeyIdx: meta.journeyIdx,
      name: displayName,
      childJourneyName: call.handle.name,
      stepIdx,
      firstChildStepIdx,
      cacheStatus: "miss",
    });
    ctx.logger?.onGroupEnd?.({
      runId: meta.runId,
      journeyIdx: meta.journeyIdx,
      name: displayName,
      childJourneyName: call.handle.name,
      stepIdx,
      lastChildStepIdx: stepIdx,
      ok: false,
      durationMs,
      error,
    });
    return { name: displayName, ok: false, error, durationMs, kind: "sub", children: [] };
  }

  const resolvedKey = resolveCacheKey(call.cacheKey, input);
  const cache = ctx.subJourneyCache;
  // Caching is active for this call only when a store is wired, the call
  // opted in with a `cacheKey`, and it isn't a per-call `cache: "off"`.
  const cacheKeyStr =
    cache !== undefined && resolvedKey !== undefined && call.cache !== "off"
      ? subJourneyCacheKey(call.handle.name, resolvedKey)
      : undefined;

  // Cache hit: replay the stored output, skip the child run entirely. No
  // child step events fire; `group:start`/`group:end` bracket nothing.
  if (cache !== undefined && cacheKeyStr !== undefined) {
    const entry = await cache.get(cacheKeyStr);
    if (entry !== undefined) {
      ctx.logger?.onGroupStart?.({
        runId: meta.runId,
        journeyIdx: meta.journeyIdx,
        name: displayName,
        childJourneyName: call.handle.name,
        stepIdx,
        firstChildStepIdx,
        cacheStatus: "hit",
        resolvedKey: resolvedKey!,
      });
      let cachedOutput: unknown = entry.value;
      let ok = true;
      let error: string | undefined;
      // Re-validate against the schema — guards against a stale disk entry
      // written by an older version of the child journey.
      if (call.handle.outputs) {
        try {
          cachedOutput = call.handle.outputs.parse(entry.value);
        } catch (err) {
          ok = false;
          error = `sub-journey "${call.handle.name}" cached output failed validation: ${describeError(err)}`;
        }
      }
      if (ok) {
        try {
          if (call.assert) await call.assert(cachedOutput);
          if (call.after) await call.after(cachedOutput);
        } catch (err) {
          ok = false;
          error = describeError(err);
        }
      }
      const durationMs = Date.now() - start;
      ctx.logger?.onGroupEnd?.({
        runId: meta.runId,
        journeyIdx: meta.journeyIdx,
        name: displayName,
        childJourneyName: call.handle.name,
        stepIdx,
        lastChildStepIdx: stepIdx,
        ok,
        durationMs,
        ...(error !== undefined ? { error } : {}),
      });
      return {
        name: displayName,
        ok,
        durationMs,
        kind: "sub",
        children: [],
        cacheStatus: "hit",
        ...(error !== undefined ? { error } : {}),
      };
    }
  }

  const groupStart: GroupStartEvent = {
    runId: meta.runId,
    journeyIdx: meta.journeyIdx,
    name: displayName,
    childJourneyName: call.handle.name,
    stepIdx,
    firstChildStepIdx,
    cacheStatus: "miss",
    ...(resolvedKey !== undefined ? { resolvedKey } : {}),
  };
  ctx.logger?.onGroupStart?.(groupStart);

  // Collect the child pipeline by evaluating the reusable body. Restore
  // `state.collecting` afterwards so the parent's pipeline keeps growing into
  // its own array.
  let childNodes: PipelineNode[];
  const prevCollecting = state.collecting;
  state.collecting = [];
  try {
    await call.handle.__def.body(input);
    childNodes = state.collecting;
  } finally {
    state.collecting = prevCollecting;
  }

  // Push an output slot so `output()` calls in any descendant step land here.
  const slot: ChildOutputSlot = { value: undefined, written: false };
  state.childOutputs.push(slot);

  const children: StepResult[] = [];
  let childOk = true;
  let childError: string | undefined;
  try {
    // Run child nodes in the same shared counter — sub-journey steps consume
    // monotonic stepIdx slots inside the parent's run.
    const childExecState: ExecState = { counter: stepIdx + 1, ok: true, halt: false };
    await executePipeline(childNodes, ctx, meta, upToStepIdx, depth + 1, childExecState, children);
    childOk = childExecState.ok;
    // Sync the outer counter to whatever the children consumed.
    execState.counter = childExecState.counter;
    if (!childOk) {
      const failed = children.find((c) => !c.ok);
      childError = failed
        ? `sub-journey "${call.handle.name}" failed at step "${failed.name}": ${failed.error ?? "unknown error"}`
        : `sub-journey "${call.handle.name}" failed`;
    }
    if (childExecState.halt) execState.halt = true;
  } finally {
    state.childOutputs.pop();
  }

  // Validate output against the schema (if any). A non-writing child whose
  // schema is set fails the node loudly.
  let validatedOutput: unknown = slot.written ? slot.value : undefined;
  if (childOk) {
    if (call.handle.outputs) {
      if (!slot.written) {
        childOk = false;
        childError = `sub-journey "${call.handle.name}" did not call output() before completing`;
      } else {
        try {
          validatedOutput = call.handle.outputs.parse(slot.value);
        } catch (err) {
          childOk = false;
          childError = `sub-journey "${call.handle.name}" output validation failed: ${describeError(err)}`;
        }
      }
    }
  }

  // Store the child's output on a successful miss so identical inputs
  // short-circuit next time. Written before parent assert/after — those run
  // per-call and are not part of the child's cacheable result.
  if (childOk && cache !== undefined && cacheKeyStr !== undefined) {
    const ttlMs = call.cacheTtlMs ?? ctx.subJourneyCacheTtlMs;
    await cache.set(cacheKeyStr, validatedOutput, ttlMs);
  }

  // Run parent-side assert/after only when the child succeeded.
  if (childOk) {
    try {
      if (call.assert) await call.assert(validatedOutput);
      if (call.after) await call.after(validatedOutput);
    } catch (err) {
      childOk = false;
      childError = describeError(err);
    }
  }

  const durationMs = Date.now() - start;
  const lastChildStepIdx = children.length > 0 ? execState.counter - 1 : stepIdx;
  const groupEnd: GroupEndEvent = {
    runId: meta.runId,
    journeyIdx: meta.journeyIdx,
    name: displayName,
    childJourneyName: call.handle.name,
    stepIdx,
    lastChildStepIdx,
    ok: childOk,
    durationMs,
    ...(childError !== undefined ? { error: childError } : {}),
  };
  ctx.logger?.onGroupEnd?.(groupEnd);

  return {
    name: displayName,
    ok: childOk,
    durationMs,
    kind: "sub",
    children,
    cacheStatus: "miss",
    ...(childError !== undefined ? { error: childError } : {}),
  };
}

async function executePipeline(
  nodes: ReadonlyArray<PipelineNode>,
  ctx: HttpContext,
  meta: ExecMeta,
  upToStepIdx: number | undefined,
  depth: number,
  execState: ExecState,
  out: StepResult[],
): Promise<void> {
  if (depth > MAX_SUB_JOURNEY_DEPTH) {
    throw new Error(
      `sub-journey recursion depth exceeded (max ${MAX_SUB_JOURNEY_DEPTH}); check for cycles`,
    );
  }
  for (const node of nodes) {
    if (ctx.signal?.aborted) {
      execState.ok = false;
      execState.halt = true;
      break;
    }
    if (upToStepIdx !== undefined && execState.counter > upToStepIdx) {
      execState.halt = true;
      break;
    }
    const stepIdx = execState.counter++;
    if (node.kind === "step") {
      const r = await executeStepNode(node.def, ctx, meta, stepIdx);
      out.push(r);
      if (!r.ok) {
        execState.ok = false;
        execState.halt = true;
        break;
      }
    } else {
      const r = await executeSubNode(node.def, ctx, meta, stepIdx, upToStepIdx, depth, execState);
      out.push(r);
      if (!r.ok) {
        execState.ok = false;
        execState.halt = true;
        break;
      }
    }
  }
}

/**
 * Runs a single entry journey. Emits `onStepStart` / `onStepEnd` (and
 * `onGroupStart` / `onGroupEnd` for any sub-journey nodes) through
 * `ctx.logger`; run-level lifecycle events (`onRunStart` / `onRunEnd`) are
 * the caller's responsibility — use `runAllRegistered` to get the full set.
 *
 * Pass `opts.journeyIdx` (and `opts.runId`) so step events carry the same
 * correlation identifiers as surrounding `runAllRegistered` invocations would
 * use; otherwise a fresh runId is minted and journeyIdx defaults to 0.
 */
export async function runJourney(
  def: JourneyDef,
  ctx: HttpContext,
  opts: {
    runId?: string;
    journeyIdx?: number;
    stepIdxOffset?: number;
    upToStepIdx?: number;
  } = {},
): Promise<JourneyResult> {
  const nodes = await collectPipeline(def);

  const runId = opts.runId ?? newRunId();
  const journeyIdx = opts.journeyIdx ?? 0;
  const stepIdxOffset = opts.stepIdxOffset ?? 0;

  // Announce the resolved plan up front so subscribers (notably the GUI) can
  // pre-render the full pipeline — including helper-injected steps and
  // sub-journey nodes that a static parse of the source would miss — without
  // waiting for each `onStepStart` to arrive. `planPipeline` recurses into
  // sub-journey nodes so the announced tree includes nested child steps.
  ctx.logger?.onPlanned?.({
    runId,
    journeyIdx,
    journeyName: def.name,
    stepIdxOffset,
    steps: await planPipeline(nodes, 0),
  });

  const journeyStart = Date.now();
  const meta: ExecMeta = { runId, journeyIdx, journeyName: def.name };
  const execState: ExecState = { counter: stepIdxOffset, ok: true, halt: false };
  const results: StepResult[] = [];

  // Expose the active ctx so helpers can call into the run's logger (e.g.
  // `import { fetch } from "@journey/core"` inside an `after` hook). Restored
  // in finally so nested or sequential journeys don't see a stale ctx.
  const prevCtx = state.currentCtx;
  state.currentCtx = ctx;
  try {
    await executePipeline(nodes, ctx, meta, opts.upToStepIdx, 0, execState, results);
  } finally {
    state.currentCtx = prevCtx;
  }

  return {
    name: def.name,
    ok: execState.ok,
    steps: results,
    durationMs: Date.now() - journeyStart,
  };
}

/**
 * Runs every currently-registered entry journey, clearing the registry first.
 * Emits `onRunStart` / `onRunEnd` bookends around the set, with each journey's
 * steps in between sharing the same runId. stepIdx is monotonic across the
 * whole run so a subscriber can key network/log streams by stepIdx without
 * caring about journey boundaries.
 */
export async function runAllRegistered(
  ctx: HttpContext,
  opts: RunMeta = {},
): Promise<JourneyResult[]> {
  const defs = state.registry.slice();
  // Footgun guard: reusable journeys must never land in the auto-run registry.
  // The type-level split rejects `inputs`/`outputs` on entry journeys, but JS
  // / `as any` can bypass that. Surface a clear diagnostic now instead of a
  // mysterious "body called with undefined input" failure deep in a step.
  for (const def of defs) {
    if (def.options?.inputs !== undefined || def.options?.outputs !== undefined) {
      throw new Error(
        `journey "${def.name}" declares an inputs/outputs schema but is registered as an entry. ` +
          `Mark it { reusable: true } and invoke it via invokeJourney(handle, ...), or remove the schema.`,
      );
    }
  }
  clearRegistry();
  const runId = opts.runId ?? newRunId();
  ctx.logger?.onRunStart?.({ runId, journeyNames: defs.map((d) => d.name) });
  const runStart = Date.now();
  const results: JourneyResult[] = [];
  let ok = true;
  let stepIdxOffset = 0;
  for (let journeyIdx = 0; journeyIdx < defs.length; journeyIdx++) {
    const def = defs[journeyIdx]!;
    const result = await runJourney(def, ctx, {
      runId,
      journeyIdx,
      stepIdxOffset,
      ...(opts.upToStepIdx !== undefined ? { upToStepIdx: opts.upToStepIdx } : {}),
    });
    results.push(result);
    if (!result.ok) ok = false;
    stepIdxOffset += countLeaves(result.steps);
    // Early-exit once the caller-requested cap is reached.
    if (opts.upToStepIdx !== undefined && stepIdxOffset > opts.upToStepIdx) break;
    // Stop launching follow-on journeys once the run has been aborted.
    if (ctx.signal?.aborted) {
      ok = false;
      break;
    }
  }
  ctx.logger?.onRunEnd?.({
    runId,
    ok,
    durationMs: Date.now() - runStart,
    results: results.map((r) => ({ name: r.name, ok: r.ok })),
  });
  return results;
}

/** Counts every stepIdx slot consumed in a result tree (group + nested children). */
function countLeaves(steps: ReadonlyArray<StepResult>): number {
  let n = 0;
  for (const s of steps) {
    n += 1; // the slot for this entry (step or sub group)
    if (s.children) n += countLeaves(s.children);
  }
  return n;
}

function newRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (rare for Node 18+).
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
