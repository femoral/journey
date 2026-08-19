/**
 * Process-wide undici dispatcher wiring.
 *
 * Both knobs live here because both are `Agent` construction options, and a
 * run only ever installs one global agent:
 *
 * - **TLS verification** (`--insecure` / `tlsRejectUnauthorized: false`).
 * - **Connect timeout** (`--connect-timeout` / `connectTimeoutMs`) — the budget
 *   for DNS + TCP + TLS handshake. This is *not* what `--timeout` controls:
 *   that one wraps the whole fetch in an `AbortController`, so it can only fire
 *   once a connection exists. A host that never completes its handshake still
 *   fails at undici's 10s `connectTimeout` default with
 *   `UND_ERR_CONNECT_TIMEOUT`, and `--timeout 0` doesn't move it.
 *
 * Installing the agent as the global dispatcher makes `fetch` honour it, so
 * helper code calling `globalThis.fetch` gets the same settings. The agent is
 * also returned so callers can put it on `HttpContext.dispatcher` for explicit,
 * non-global wiring.
 *
 * Installing the agent also means swapping in undici's own `fetch`. Node's
 * built-in `fetch` belongs to Node's *internal* copy of undici, which is a
 * different major than the one we depend on — handing it a dispatcher from our
 * copy makes every request die instantly with
 * `invalid onRequestStart method (UND_ERR_INVALID_ARG)`, because the two
 * copies disagree on the handler interface. Taking the `fetch` from the same
 * module as the `Agent` keeps both halves on one version.
 */

export interface DispatcherOptions {
  /** Disable TLS certificate verification. */
  insecure?: boolean;
  /** Connect timeout (ms); `0` disables it. Unset → undici's 10s default. */
  connectTimeoutMs?: number;
}

/**
 * Cached agent plus the option signature it was built from. Watch-mode reruns
 * pass the same options, so they reuse the agent instead of leaking a new one
 * (and its socket pool) on every rerun.
 */
let current: { key: string; agent: unknown } | undefined;
let warnedInsecure = false;

/**
 * Process-level options from CLI flags. `serve` records them here so that a
 * later per-project call (a run triggered through the API, whose
 * `journey.config.json` asks for e.g. `tlsRejectUnauthorized: false`) rebuilds
 * the agent *on top of* the flags instead of silently dropping them — the
 * global dispatcher is a single slot, so the last write wins.
 */
let defaults: DispatcherOptions = {};

export function setDispatcherDefaults(opts: DispatcherOptions): void {
  defaults = opts;
}

/**
 * Build and install the global undici dispatcher for this process. Returns
 * `undefined` when neither option is set, so callers leave
 * `HttpContext.dispatcher` alone and Node's default agent stays in place.
 */
export async function configureDispatcher(opts: DispatcherOptions): Promise<unknown> {
  // Flags win over per-project config: an explicit `--connect-timeout` should
  // not be undone by a project that happens to set `connectTimeoutMs`.
  const insecure = opts.insecure === true || defaults.insecure === true;
  const connectTimeoutMs = defaults.connectTimeoutMs ?? opts.connectTimeoutMs;
  if (!insecure && connectTimeoutMs === undefined) return undefined;

  const key = `${insecure}:${connectTimeoutMs ?? "default"}`;
  if (current?.key === key) return current.agent;

  const { Agent, fetch: undiciFetch, setGlobalDispatcher } = await import("undici");
  const agent = new Agent({
    ...(connectTimeoutMs !== undefined ? { connectTimeout: connectTimeoutMs } : {}),
    connect: {
      ...(insecure ? { rejectUnauthorized: false } : {}),
      // `connect.timeout` is what the connector actually reads; undici spreads
      // `connect` last, so the top-level `connectTimeout` alone would be
      // clobbered by this object. Set both.
      ...(connectTimeoutMs !== undefined ? { timeout: connectTimeoutMs } : {}),
    },
  });
  setGlobalDispatcher(agent as Parameters<typeof setGlobalDispatcher>[0]);
  // Pair the dispatcher with its own `fetch` — see the note above. Both the
  // instrumented `@usejourney/core` `fetch` and `http.execute` read the global
  // binding per call, so the swap reaches every request without re-wiring them.
  globalThis.fetch = undiciFetch as unknown as typeof globalThis.fetch;
  current = { key, agent };

  // Warn only after the agent is actually installed — otherwise a failed
  // `import("undici")` would print the warning and leave the process
  // unprotected, hiding the real failure on the retry.
  if (insecure && !warnedInsecure) {
    warnedInsecure = true;
    console.error("journey: WARNING — TLS verification disabled (--insecure)");
  }
  return agent;
}
