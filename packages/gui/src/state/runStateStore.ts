import type { JourneyResult } from "../api/client";

export type CachedRunState = "running" | "done";

export interface CachedRun {
  results: JourneyResult[];
  runState: CachedRunState;
  error?: string;
  sourceChecksum: string;
  finishedAt?: string;
}

// Seam for swapping the persistence backend later (e.g. a backend-backed store
// that hydrates from /api/runs). The interface is sync because consumers only
// touch it on user-driven events — never on render.
export interface RunStateStore {
  setProjectId(id: string): void;
  get(file: string): CachedRun | undefined;
  set(file: string, value: CachedRun): void;
  delete(file: string): void;
  clear(): void;
}

// FNV-1a 32-bit, returned as 8-char hex. Deterministic, dependency-free, fast
// enough for journey-source-sized strings.
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const KEY_PREFIX = "journey:runState:v1";

function safeStorage(): Storage | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
}

export function createLocalStorageRunStateStore(initialProjectId = "default"): RunStateStore {
  let projectId = initialProjectId;
  const storage = safeStorage();

  const key = (file: string) => `${KEY_PREFIX}:${projectId}:${file}`;

  return {
    setProjectId(id: string) {
      projectId = id || "default";
    },
    get(file: string): CachedRun | undefined {
      if (!storage) return undefined;
      try {
        const raw = storage.getItem(key(file));
        if (!raw) return undefined;
        return JSON.parse(raw) as CachedRun;
      } catch {
        return undefined;
      }
    },
    set(file: string, value: CachedRun) {
      if (!storage) return;
      try {
        storage.setItem(key(file), JSON.stringify(value));
      } catch {
        // Quota or serialization failure — swallow; cache is best-effort.
      }
    },
    delete(file: string) {
      if (!storage) return;
      try {
        storage.removeItem(key(file));
      } catch {
        // ignore
      }
    },
    clear() {
      if (!storage) return;
      try {
        const prefix = `${KEY_PREFIX}:${projectId}:`;
        const toRemove: string[] = [];
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && k.startsWith(prefix)) toRemove.push(k);
        }
        for (const k of toRemove) storage.removeItem(k);
      } catch {
        // ignore
      }
    },
  };
}

// In-memory variant used by tests (no localStorage dependency).
export function createMemoryRunStateStore(initialProjectId = "default"): RunStateStore {
  let projectId = initialProjectId;
  const data = new Map<string, CachedRun>();
  const key = (file: string) => `${projectId}:${file}`;
  return {
    setProjectId(id: string) {
      projectId = id || "default";
    },
    get(file) {
      return data.get(key(file));
    },
    set(file, value) {
      data.set(key(file), value);
    },
    delete(file) {
      data.delete(key(file));
    },
    clear() {
      const prefix = `${projectId}:`;
      for (const k of [...data.keys()]) if (k.startsWith(prefix)) data.delete(k);
    },
  };
}
