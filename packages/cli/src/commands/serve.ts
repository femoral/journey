import type { CacheMode } from "@usejourney/core";
import { startServer } from "../server/server.js";
import { configureDispatcher, setDispatcherDefaults } from "../util/dispatcher.js";

export interface ServeOptions {
  projectDir: string;
  port?: number;
  host?: string;
  debug?: boolean;
  /** Disable TLS verification for journey runs triggered through the API. */
  insecure?: boolean;
  /** Sub-journey output cache lifetime; defaults to `process`. */
  cache?: CacheMode;
  /** Default TTL (ms) for sub-journey cache entries. */
  cacheTtlMs?: number;
  /** Default request timeout (ms) for runs triggered via the API; 0 disables; unset → core's 60s default. */
  timeoutMs?: number;
  /** Connect timeout (ms) for DNS + TCP + TLS; 0 disables; unset → undici's 10s default. */
  connectTimeoutMs?: number;
}

export async function runServe(opts: ServeOptions): Promise<number> {
  // Flags are process-level: recorded as defaults so a per-project rebuild in
  // `runJourneyFile` can't drop them, then applied to the global dispatcher.
  setDispatcherDefaults({
    ...(opts.insecure !== undefined ? { insecure: opts.insecure } : {}),
    ...(opts.connectTimeoutMs !== undefined ? { connectTimeoutMs: opts.connectTimeoutMs } : {}),
  });
  await configureDispatcher({});
  const srv = await startServer({
    projectDir: opts.projectDir,
    ...(opts.host !== undefined ? { host: opts.host } : {}),
    ...(opts.port !== undefined ? { port: opts.port } : {}),
    ...(opts.debug !== undefined ? { debug: opts.debug } : {}),
    ...(opts.cache !== undefined ? { cache: opts.cache } : {}),
    ...(opts.cacheTtlMs !== undefined ? { cacheTtlMs: opts.cacheTtlMs } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
  console.log(`Journey API listening at ${srv.url}`);
  console.log(`For the GUI, run: pnpm --filter @usejourney/gui dev`);

  await new Promise<void>((resolve) => {
    const handler = () => {
      console.log("Shutting down…");
      void srv.close().then(() => resolve());
    };
    process.once("SIGINT", handler);
    process.once("SIGTERM", handler);
  });
  return 0;
}
