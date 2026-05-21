import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DiskSubJourneyCache,
  MemorySubJourneyCache,
  createSubJourneyCache,
  subJourneyCacheKey,
} from "../src/cache.js";

describe("subJourneyCacheKey", () => {
  it("composes the child journey name and resolved key", () => {
    expect(subJourneyCacheKey("auth.acquire-token", "alice")).toBe("auth.acquire-token:alice");
  });
});

describe("MemorySubJourneyCache", () => {
  it("round-trips a value through set/get", () => {
    const cache = new MemorySubJourneyCache();
    cache.set("k", { token: "t" });
    expect(cache.get("k")).toEqual({ value: { token: "t" } });
  });

  it("returns undefined for a missing key", () => {
    expect(new MemorySubJourneyCache().get("nope")).toBeUndefined();
  });

  it("evicts an entry once its TTL elapses", () => {
    vi.useFakeTimers();
    try {
      const cache = new MemorySubJourneyCache();
      cache.set("k", "v", 1000);
      expect(cache.get("k")?.value).toBe("v");
      vi.advanceTimersByTime(1001);
      expect(cache.get("k")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clear() drops every entry", () => {
    const cache = new MemorySubJourneyCache();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});

describe("DiskSubJourneyCache", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "journey-cache-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips a value through set/get", async () => {
    const cache = new DiskSubJourneyCache(dir);
    await cache.set("auth:alice", { token: "t" });
    expect(await cache.get("auth:alice")).toEqual({ value: { token: "t" } });
  });

  it("persists across instances — survives a process restart", async () => {
    await new DiskSubJourneyCache(dir).set("auth:alice", { token: "kept" });
    // A fresh instance models the server being restarted.
    const reopened = new DiskSubJourneyCache(dir);
    expect(await reopened.get("auth:alice")).toEqual({ value: { token: "kept" } });
  });

  it("evicts an entry once its TTL elapses", async () => {
    vi.useFakeTimers();
    try {
      const cache = new DiskSubJourneyCache(dir);
      await cache.set("k", "v", 1000);
      expect((await cache.get("k"))?.value).toBe("v");
      vi.advanceTimersByTime(1001);
      expect(await cache.get("k")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns undefined for a missing key", async () => {
    expect(await new DiskSubJourneyCache(dir).get("missing")).toBeUndefined();
  });
});

describe("createSubJourneyCache", () => {
  it("off → no cache", () => {
    expect(createSubJourneyCache("off", { diskDir: "/tmp/x" })).toBeUndefined();
  });

  it("run / process → in-memory cache", () => {
    expect(createSubJourneyCache("run", { diskDir: "/tmp/x" })).toBeInstanceOf(
      MemorySubJourneyCache,
    );
    expect(createSubJourneyCache("process", { diskDir: "/tmp/x" })).toBeInstanceOf(
      MemorySubJourneyCache,
    );
  });

  it("disk → disk-backed cache", () => {
    expect(createSubJourneyCache("disk", { diskDir: "/tmp/x" })).toBeInstanceOf(
      DiskSubJourneyCache,
    );
  });
});
