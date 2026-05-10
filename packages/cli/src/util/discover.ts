import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function discoverJourneyFiles(journeysDir: string): Promise<string[]> {
  try {
    const entries = await readdir(journeysDir);
    return entries
      .filter((e) => e.endsWith(".journey.ts"))
      .sort()
      .map((e) => join(journeysDir, e));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
