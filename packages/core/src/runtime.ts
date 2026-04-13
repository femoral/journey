import type { Endpoint, ResponseOf } from "./endpoint.js";
import { buildRequest, execute, type HttpContext, type HttpResponse } from "./http.js";

type Lazy<T> = T | (() => T | Promise<T>);

export interface StepOptions<E extends Endpoint> {
  endpoint: E;
  params?: Record<string, string | number>;
  query?: Lazy<Record<string, string | number | boolean | undefined>>;
  headers?: Lazy<Record<string, string>>;
  body?: Lazy<unknown>;
  timeoutMs?: number;
  assert?: (res: HttpResponse<ResponseOf<E>>) => void | Promise<void>;
  after?: (res: HttpResponse<ResponseOf<E>>) => void | Promise<void>;
}

interface StepDef {
  name: string;
  options: StepOptions<Endpoint>;
}

interface JourneyDef {
  name: string;
  body: () => void | Promise<void>;
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

const registry: JourneyDef[] = [];
let collecting: StepDef[] | undefined;

export function journey(name: string, body: () => void | Promise<void>): void {
  registry.push({ name, body });
}

export function step<E extends Endpoint>(name: string, options: StepOptions<E>): void {
  if (!collecting) {
    throw new Error(`step(${JSON.stringify(name)}) called outside a journey(...) body`);
  }
  collecting.push({ name, options: options as StepOptions<Endpoint> });
}

export function getRegisteredJourneys(): ReadonlyArray<JourneyDef> {
  return registry;
}

export function clearRegistry(): void {
  registry.length = 0;
}

async function resolveLazy<T>(v: Lazy<T> | undefined): Promise<T | undefined> {
  if (v === undefined) return undefined;
  return typeof v === "function" ? await (v as () => T | Promise<T>)() : v;
}

export async function runJourney(def: JourneyDef, ctx: HttpContext): Promise<JourneyResult> {
  const steps: StepDef[] = [];
  const prev = collecting;
  collecting = steps;
  try {
    await def.body();
  } finally {
    collecting = prev;
  }

  const results: StepResult[] = [];
  const journeyStart = Date.now();
  let ok = true;

  for (const s of steps) {
    const start = Date.now();
    try {
      const headers = await resolveLazy(s.options.headers);
      const query = await resolveLazy(s.options.query);
      const body = await resolveLazy(s.options.body);
      const req = buildRequest(
        {
          endpoint: s.options.endpoint,
          ...(s.options.params !== undefined ? { params: s.options.params } : {}),
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
      results.push({
        name: s.name,
        ok: true,
        request: { method: req.method, url: req.url },
        response,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      ok = false;
      results.push({
        name: s.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      });
      break;
    }
  }

  return { name: def.name, ok, steps: results, durationMs: Date.now() - journeyStart };
}

export async function runAllRegistered(ctx: HttpContext): Promise<JourneyResult[]> {
  const defs = registry.slice();
  clearRegistry();
  const results: JourneyResult[] = [];
  for (const def of defs) {
    results.push(await runJourney(def, ctx));
  }
  return results;
}
