/**
 * Minimal script runtime for the Endpoints page's pre/post hooks. Code runs
 * in-browser via `new Function`, so it has full page privileges; this is a
 * local-first dev tool, not a sandbox. If we ever let journeys execute arbitrary
 * user scripts server-side this will need a hardened replacement.
 */

export type ScriptLog = { level: "info" | "warn" | "error"; text: string };

export type ScriptCtx = {
  /** Mutable request headers for pre-scripts. */
  headers: Record<string, string>;
  /** Mutable query parameters for pre-scripts. */
  query: Record<string, string>;
  /** Mutable request body for pre-scripts. */
  body: unknown;
  /** Read-only snapshot of the active environment. */
  env: Record<string, string>;
  /** Captures log output for the console Logs tab. */
  log: (...args: unknown[]) => void;
};

export type ScriptResult = {
  ok: boolean;
  error?: string;
  logs: ScriptLog[];
};

function fmt(args: unknown[]): string {
  return args
    .map((a) =>
      typeof a === "string"
        ? a
        : (() => {
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          })(),
    )
    .join(" ");
}

/**
 * Executes `src` as the body of an async function with the given script
 * context. Pre-scripts use this directly; post-scripts wrap with a `res`
 * binding via {@link runPostScript}.
 */
export async function runPreScript(
  src: string,
  ctx: Omit<ScriptCtx, "log">,
): Promise<ScriptResult> {
  if (!src.trim()) return { ok: true, logs: [] };
  const logs: ScriptLog[] = [];
  const log = (...args: unknown[]) => {
    logs.push({ level: "info", text: fmt(args) });
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(
      "ctx",
      `return (async () => { const { headers, query, body, env, log } = ctx; ${src}\n; })()`,
    );
    await fn({ ...ctx, log });
    return { ok: true, logs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      logs,
    };
  }
}

export async function runPostScript(
  src: string,
  ctx: Omit<ScriptCtx, "log">,
  res: { status: number; headers: Record<string, string>; body: unknown },
): Promise<ScriptResult> {
  if (!src.trim()) return { ok: true, logs: [] };
  const logs: ScriptLog[] = [];
  const log = (...args: unknown[]) => {
    logs.push({ level: "info", text: fmt(args) });
  };
  // Minimal `expect` shim — mirrors the @usejourney/core assertion used in step
  // assert hooks. Throws with a readable message so the caller surfaces it.
  const expect = <T>(actual: T) => ({
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`);
      }
    },
    toEqual(expected: T) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error("expected value to be defined");
      }
    },
  });
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(
      "ctx",
      "res",
      "expect",
      `return (async () => { const { headers, query, body, env, log } = ctx; ${src}\n; })()`,
    );
    await fn({ ...ctx, log }, res, expect);
    return { ok: true, logs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      logs,
    };
  }
}
