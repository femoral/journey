import type { CacheMode } from "@journey/core";
import { startServer } from "../server/server.js";
import { enableInsecureTls } from "./run.js";

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
}

export async function runServe(opts: ServeOptions): Promise<number> {
  if (opts.insecure) await enableInsecureTls();
  const srv = await startServer({
    projectDir: opts.projectDir,
    ...(opts.host !== undefined ? { host: opts.host } : {}),
    ...(opts.port !== undefined ? { port: opts.port } : {}),
    ...(opts.debug !== undefined ? { debug: opts.debug } : {}),
    ...(opts.cache !== undefined ? { cache: opts.cache } : {}),
    ...(opts.cacheTtlMs !== undefined ? { cacheTtlMs: opts.cacheTtlMs } : {}),
  });
  console.log(`Journey API listening at ${srv.url}`);
  console.log(`For the GUI, run: pnpm --filter @journey/gui dev`);

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
