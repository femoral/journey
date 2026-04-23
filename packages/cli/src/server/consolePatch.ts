import type { JourneyLogger, LogEvent } from "@journey/core";
import { inspect } from "node:util";

type ConsoleFn = (...args: unknown[]) => void;

/**
 * Forwards `console.log` / `console.warn` / `console.error` / `console.info`
 * calls to both the original console (so terminal output is preserved) and to
 * `logger.onLog`, letting SSE subscribers see user-code logs in-band.
 *
 * Returned function restores the original console; call it from a `finally`.
 *
 * Concurrency note: this patches the *global* console — a journey run and a
 * concurrent unrelated Node task would share the patched console. The runner
 * only calls this from serve's request-handling path, which is serialized per
 * run, so this is acceptable in practice. If we ever run multiple journeys in
 * parallel per-process, this needs to move to an AsyncLocalStorage-scoped
 * logger.
 */
export function patchConsole(logger: JourneyLogger): () => void {
  if (!logger.onLog) return () => {};

  // Store the raw references for exact-identity restoration. Inside the
  // wrappers we call `.apply(console, args)` so methods that inspect `this`
  // still see the real console instance.
  const orig = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  const forward = (
    level: LogEvent["level"],
    original: ConsoleFn,
    args: unknown[],
  ) => {
    try {
      logger.onLog?.({ level, text: formatArgs(args) });
    } catch {
      /* don't let a broken subscriber break user code */
    }
    original.apply(console, args);
  };

  console.log = (...args: unknown[]) => forward("info", orig.log, args);
  console.info = (...args: unknown[]) => forward("info", orig.info, args);
  console.warn = (...args: unknown[]) => forward("warn", orig.warn, args);
  console.error = (...args: unknown[]) => forward("error", orig.error, args);

  return () => {
    console.log = orig.log;
    console.info = orig.info;
    console.warn = orig.warn;
    console.error = orig.error;
  };
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      // `inspect` matches what Node prints natively (handles cycles, symbols,
      // coloring off in non-tty — we strip colors). JSON.stringify would drop
      // BigInt / functions / symbols.
      return inspect(a, { depth: 4, colors: false, compact: true });
    })
    .join(" ");
}
