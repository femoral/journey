/**
 * @journey/k6-adapter — transpiles a .journey.ts into a runnable k6 script.
 * Behavior lands in the M2 export issue.
 */

export interface ExportK6Options {
  journeyFile: string;
  outFile: string;
}

export async function exportToK6(_opts: ExportK6Options): Promise<void> {
  throw new Error("not implemented");
}
