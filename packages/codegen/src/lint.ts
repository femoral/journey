import type { Operation } from "./types.js";

export interface PrefixLintFinding {
  majority: { prefix: string; count: number };
  minority: { prefix: string; count: number };
  message: string;
}

/**
 * Flags specs where one or two operations sit under a top-level prefix that
 * the rest of the API doesn't share. Catches the `/api/v1/foo` typo when 30
 * other ops live under `/v1/...` — common when an OpenAPI is hand-assembled.
 *
 * Heuristic: take the first path segment of every operation, bucket counts.
 * If the dominant bucket holds ≥80% and the smallest other bucket holds
 * ≤20% on a corpus of ≥5 operations, return a finding. Multi-prefix specs
 * with a balanced split fall through silently.
 */
export function findPrefixOutliers(operations: ReadonlyArray<Operation>): PrefixLintFinding | null {
  if (operations.length < 5) return null;
  const buckets = new Map<string, number>();
  for (const op of operations) {
    const first = firstSegment(op.path);
    buckets.set(first, (buckets.get(first) ?? 0) + 1);
  }
  if (buckets.size < 2) return null;
  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  const total = operations.length;
  const [majPrefix, majCount] = sorted[0]!;
  const [minPrefix, minCount] = sorted[sorted.length - 1]!;
  if (majCount / total < 0.8) return null;
  if (minCount / total > 0.2) return null;
  return {
    majority: { prefix: `/${majPrefix}`, count: majCount },
    minority: { prefix: `/${minPrefix}`, count: minCount },
    message: `journey: warning — ${minCount} operation(s) use prefix '/${minPrefix}' while ${majCount} use '/${majPrefix}'`,
  };
}

function firstSegment(path: string): string {
  const trimmed = path.replace(/^\/+/, "");
  const idx = trimmed.indexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(0, idx);
}
