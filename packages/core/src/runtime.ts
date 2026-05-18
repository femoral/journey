import type { Endpoint, ResponseOf } from "./endpoint.js";
import { buildRequest, execute, type HttpContext, type HttpResponse } from "./http.js";
import { describeError } from "./logger.js";

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

/** Per-call configuration accepted by the 3-arg `journey()` overload. */
export interface JourneyOptions {
  tags?: string[];
  k6?: K6JourneyOptions;
}

export interface JourneyDef {
  name: string;
  body: () => void | Promise<void>;
  options?: JourneyOptions;
}

export interface StepResult {
  name: string;
  ok: boolean;
  request?: { method: string; url: string };
  response?: HttpResponse;
  error?: string;
  durationMs: number;
}

export interface JourneyResult {
  name: string;
  ok: boolean;
  steps: StepResult[];
  durationMs: number;
}

// Shared across module instances — tsx can load `@journey/core` more than once
// (once from the runner, once through the journey file's imports), and we need
// both copies to point at the same registry/collector.
interface SharedState {
  registry: JourneyDef[];
  collecting: StepDef[] | undefined;
}
const STATE_KEY = Symbol.for("@journey/core::runtime-state");
const globals = globalThis as unknown as { [STATE_KEY]?: SharedState };
const state: SharedState =
  globals[STATE_KEY] ?? (globals[STATE_KEY] = { registry: [], collecting: undefined });

export function journey(name: string, body: () => void | Promise<void>): void;
export function journey(
  name: string,
  options: JourneyOptions,
  body: () => void | Promise<void>,
): void;
export function journey(
  name: string,
  optionsOrBody: JourneyOptions | (() => void | Promise<void>),
  maybeBody?: () => void | Promise<void>,
): void {
  const body = typeof optionsOrBody === "function" ? optionsOrBody : maybeBody!;
  const options = typeof optionsOrBody === "function" ? undefined : optionsOrBody;
  state.registry.push(options ? { name, body, options } : { name, body });
}

export function step<E extends Endpoint>(name: string, options: StepOptions<E>): void {
  if (!state.collecting) {
    throw new Error(`step(${JSON.stringify(name)}) called outside a journey(...) body`);
  }
  state.collecting.push({ name, options: options as StepOptions<Endpoint> });
}

export function getRegisteredJourneys(): ReadonlyArray<JourneyDef> {
  return state.registry;
}

export function clearRegistry(): void {
  state.registry.length = 0;
}

export async function collectSteps(def: JourneyDef): Promise<ReadonlyArray<StepDef>> {
  const steps: StepDef[] = [];
  const prev = state.collecting;
  state.collecting = steps;
  try {
    await def.body();
  } finally {
    state.collecting = prev;
  }
  return steps;
}

async function resolveLazy<T>(v: Lazy<T> | undefined): Promise<T | undefined> {
  if (v === undefined) return undefined;
  return typeof v === "function" ? await (v as () => T | Promise<T>)() : v;
}

/**
 * Runs a single journey. Emits `onStepStart` / `onStepEnd` events for each step
 * through `ctx.logger`; run-level lifecycle events (`onRunStart` / `onRunEnd`)
 * are the caller's responsibility — use `runAllRegistered` to get the full set.
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
  const steps: StepDef[] = [];
  const prev = state.collecting;
  state.collecting = steps;
  try {
    await def.body();
  } finally {
    state.collecting = prev;
  }

  const runId = opts.runId ?? newRunId();
  const journeyIdx = opts.journeyIdx ?? 0;
  const stepIdxOffset = opts.stepIdxOffset ?? 0;

  // Announce the resolved plan up front so subscribers (notably the GUI) can
  // pre-render the full step list — including any helper-injected steps that a
  // static parse of the source would miss — without waiting for each
  // `onStepStart` to arrive.
  ctx.logger?.onPlanned?.({
    runId,
    journeyIdx,
    journeyName: def.name,
    stepIdxOffset,
    steps: steps.map((s) => ({ name: s.name })),
  });

  const results: StepResult[] = [];
  const journeyStart = Date.now();
  let ok = true;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const stepIdx = stepIdxOffset + i;
    if (opts.upToStepIdx !== undefined && stepIdx > opts.upToStepIdx) break;
    const start = Date.now();
    ctx.logger?.onStepStart?.({
      runId,
      journeyIdx,
      journeyName: def.name,
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
      results.push({
        name: s.name,
        ok: true,
        request: { method: req.method, url: req.url },
        response,
        durationMs,
      });
      ctx.logger?.onStepEnd?.({ runId, journeyIdx, stepIdx, ok: true, durationMs });
    } catch (err) {
      ok = false;
      const durationMs = Date.now() - start;
      const error = describeError(err);
      results.push({ name: s.name, ok: false, error, durationMs });
      ctx.logger?.onStepEnd?.({
        runId,
        journeyIdx,
        stepIdx,
        ok: false,
        durationMs,
        error,
      });
      break;
    }
  }

  return { name: def.name, ok, steps: results, durationMs: Date.now() - journeyStart };
}

/**
 * Runs every currently-registered journey, clearing the registry first. Emits
 * `onRunStart` / `onRunEnd` bookends around the set, with each journey's steps
 * in between sharing the same runId. stepIdx is monotonic across the whole run
 * so a subscriber can key network/log streams by stepIdx without caring about
 * journey boundaries.
 */
export async function runAllRegistered(
  ctx: HttpContext,
  opts: RunMeta = {},
): Promise<JourneyResult[]> {
  const defs = state.registry.slice();
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
    stepIdxOffset += result.steps.length;
    // Early-exit once the caller-requested cap is reached.
    if (opts.upToStepIdx !== undefined && stepIdxOffset > opts.upToStepIdx) break;
  }
  ctx.logger?.onRunEnd?.({
    runId,
    ok,
    durationMs: Date.now() - runStart,
    results: results.map((r) => ({ name: r.name, ok: r.ok })),
  });
  return results;
}

function newRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (rare for Node 18+).
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
