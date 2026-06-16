import type { JourneyResult } from "@usejourney/core";

export function printResults(results: JourneyResult[]): void {
  for (const r of results) {
    const marker = r.ok ? "✓" : "✗";
    console.log(`${marker} ${r.name} (${r.durationMs}ms)`);
    for (const s of r.steps) {
      const sm = s.ok ? "  ✓" : "  ✗";
      const reqStr = s.request ? ` ${s.request.method} ${s.request.url}` : "";
      const status = s.response ? ` → ${s.response.status}` : "";
      console.log(`${sm} ${s.name}${reqStr}${status} (${s.durationMs}ms)`);
      if (!s.ok && s.error) console.log(`      ${s.error}`);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${passed} passed, ${failed} failed`);
}

export function overallOk(results: JourneyResult[]): boolean {
  return results.every((r) => r.ok);
}
