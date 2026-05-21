import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Output cache for sub-journey invocations. When an `invokeJourney(...)` call
 * supplies a `cacheKey`, the resolved key + child journey name identify a
 * cache slot; a hit short-circuits the child run and replays the stored
 * output. See the M7 RFC (#86) for the lifetime model.
 */

/** Cache lifetime selected via `--cache`. */
export type CacheMode = "off" | "run" | "process" | "disk";

export interface CacheEntry {
  value: unknown;
  /** Epoch ms after which the entry is stale; absent → no expiry. */
  expiresAt?: number;
}

/**
 * Storage backend for sub-journey outputs. `get`/`set` may be sync (memory) or
 * async (disk); callers `await` the result either way.
 */
export interface SubJourneyCache {
  get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>;
  set(key: string, value: unknown, ttlMs?: number): void | Promise<void>;
}

/** Composite cache key — `${childJourneyName}:${resolvedKey}`. */
export function subJourneyCacheKey(journeyName: string, resolvedKey: string): string {
  return `${journeyName}:${resolvedKey}`;
}

function isExpired(entry: CacheEntry): boolean {
  return entry.expiresAt !== undefined && Date.now() >= entry.expiresAt;
}

function entryFor(value: unknown, ttlMs?: number): CacheEntry {
  return ttlMs !== undefined ? { value, expiresAt: Date.now() + ttlMs } : { value };
}

/**
 * In-memory cache. Lives as long as the holding process keeps the instance —
 * the CLI reuses one instance for `--cache=process` (persists across runs of
 * `journey serve`) and a fresh one per run for `--cache=run`.
 */
export class MemorySubJourneyCache implements SubJourneyCache {
  private readonly store = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: unknown, ttlMs?: number): void {
    this.store.set(key, entryFor(value, ttlMs));
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Disk-backed cache: one JSON file per key under `dir`, named by the SHA-256
 * of the composite key. Survives process restarts (`--cache=disk`).
 *
 * Values must be JSON-serializable — a sub-journey `output(...)` is normally a
 * plain object, so this holds in practice. Non-JSON values (Date, undefined,
 * functions) are silently lost in the round-trip.
 */
export class DiskSubJourneyCache implements SubJourneyCache {
  constructor(private readonly dir: string) {}

  private pathFor(key: string): string {
    return join(this.dir, `${createHash("sha256").update(key).digest("hex")}.json`);
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const path = this.pathFor(key);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return undefined;
    }
    let entry: CacheEntry;
    try {
      entry = JSON.parse(raw) as CacheEntry;
    } catch {
      return undefined;
    }
    if (isExpired(entry)) {
      await rm(path, { force: true });
      return undefined;
    }
    return entry;
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.pathFor(key), JSON.stringify(entryFor(value, ttlMs)), "utf8");
  }
}

/**
 * Builds the cache backend for a `CacheMode`. `off` → no cache. `run` and
 * `process` → a fresh `MemorySubJourneyCache` (the caller controls reuse, and
 * so the lifetime). `disk` → a `DiskSubJourneyCache` under `diskDir`.
 */
export function createSubJourneyCache(
  mode: CacheMode,
  opts: { diskDir: string },
): SubJourneyCache | undefined {
  switch (mode) {
    case "off":
      return undefined;
    case "disk":
      return new DiskSubJourneyCache(opts.diskDir);
    case "run":
    case "process":
      return new MemorySubJourneyCache();
  }
}
