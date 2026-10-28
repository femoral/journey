import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runExportK6 } from "../src/commands/exportK6.js";

async function makeProject(): Promise<string> {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const base = join(testDir, "..", ".test-tmp");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "exportK6-"));
  const journeysDir = join(root, "journeys");
  await mkdir(journeysDir, { recursive: true });

  await writeFile(
    join(journeysDir, "smoke.journey.ts"),
    `import { journey, step } from "@usejourney/core";
journey("smoke", { tags: ["smoke"], k6: { vus: 1, duration: "5s" } }, () => {
  step("ping", { endpoint: { method: "GET", path: "/ping" } });
});
`,
  );
  await writeFile(
    join(journeysDir, "load.journey.ts"),
    `import { journey, step } from "@usejourney/core";
journey("load", { tags: ["load"], k6: { vus: 10, duration: "30s" } }, () => {
  step("ping", { endpoint: { method: "GET", path: "/ping" } });
});
`,
  );
  await writeFile(
    join(journeysDir, "untagged.journey.ts"),
    `import { journey, step } from "@usejourney/core";
journey("untagged", () => {
  step("ping", { endpoint: { method: "GET", path: "/ping" } });
});
`,
  );

  return root;
}

describe("export k6 tag filter", () => {
  it("emits one .k6.js per tag-matching file and skips others", async () => {
    const root = await makeProject();
    try {
      const journeysDir = join(root, "journeys");
      const outDir = join(root, "out");
      await runExportK6({ path: journeysDir, outDir, tags: ["load"] });

      const files = (await readdir(outDir)).sort();
      expect(files).toEqual(["load.k6.js"]);

      const src = await readFile(join(outDir, "load.k6.js"), "utf8");
      expect(src).toContain("var options = {");
      expect(src).toMatch(/export \{[^}]*\boptions\b[^}]*\}/);
      expect(src).toContain('"vus": 10');
      expect(src).toContain('"duration": "30s"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits all files when no --tag is passed", async () => {
    const root = await makeProject();
    try {
      const journeysDir = join(root, "journeys");
      const outDir = join(root, "out");
      await runExportK6({ path: journeysDir, outDir, tags: [] });

      const files = (await readdir(outDir)).sort();
      expect(files).toEqual(["load.k6.js", "smoke.k6.js", "untagged.k6.js"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("errors when a file has multiple journeys with k6 options", async () => {
    const root = await makeProject();
    try {
      const journeysDir = join(root, "journeys");
      await writeFile(
        join(journeysDir, "two-k6.journey.ts"),
        `import { journey, step } from "@usejourney/core";
journey("a", { k6: { vus: 1 } }, () => { step("p", { endpoint: { method: "GET", path: "/" } }); });
journey("b", { k6: { vus: 2 } }, () => { step("p", { endpoint: { method: "GET", path: "/" } }); });
`,
      );
      const outDir = join(root, "out");
      await expect(runExportK6({ path: journeysDir, outDir, tags: [] })).rejects.toThrow(
        /2 journeys declare k6 options/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects --out with directory mode", async () => {
    const root = await makeProject();
    try {
      await expect(
        runExportK6({ path: join(root, "journeys"), out: "out.k6.js", tags: [] }),
      ).rejects.toThrow(/--out is only valid with a single journey file/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports single-file mode with --out and tag filter (skips when not matching)", async () => {
    const root = await makeProject();
    try {
      const file = join(root, "journeys", "smoke.journey.ts");
      const outFile = join(root, "out.k6.js");
      // Smoke file does not match 'load' — should not write anything.
      await runExportK6({ path: file, out: outFile, tags: ["load"] });
      await expect(readFile(outFile, "utf8")).rejects.toThrow();

      // Now match: should write.
      await runExportK6({ path: file, out: outFile, tags: ["smoke"] });
      const src = await readFile(outFile, "utf8");
      expect(src).toContain('"vus": 1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("export k6 in a fresh project", () => {
  it("plants the @usejourney/core link like `journey run`, and passes metrics/halt flags", async () => {
    // Outside the monorepo, so `@usejourney/core` only resolves through the link.
    const root = await mkdtemp(join(tmpdir(), "journey-fresh-export-"));
    try {
      await writeFile(join(root, "journey.config.json"), "{}");
      await writeFile(join(root, "package.json"), '{"type":"module"}');
      await mkdir(join(root, "journeys", "lib"), { recursive: true });
      await writeFile(
        join(root, "journeys", "lib", "profiles.ts"),
        `declare const __ENV: Record<string, string> | undefined;
export function pickProfile() {
  const name = typeof __ENV !== "undefined" ? __ENV.OPT_NAME : undefined;
  return name === "2X" ? { vus: 40 } : { vus: 1 };
}
`,
      );
      await writeFile(
        join(root, "journeys", "flow.journey.ts"),
        `import { journey, step } from "@usejourney/core";
import { pickProfile } from "./lib/profiles.js";
export const options = pickProfile();
journey("flow", { tags: ["load"] }, () => {
  step("ping", { endpoint: { method: "GET", path: "/ping" }, metric: "pong" });
});
`,
      );
      expect(existsSync(join(root, "node_modules", "@usejourney", "core"))).toBe(false);
      const outDir = join(root, "k6");
      await runExportK6({
        path: join(root, "journeys"),
        outDir,
        tags: ["load"],
        metricsPrefix: "wave",
        haltOnFailure: true,
      });
      expect(existsSync(join(root, "node_modules", "@usejourney", "core", "package.json"))).toBe(
        true,
      );
      const src = await readFile(join(outDir, "flow.k6.js"), "utf8");
      expect(src).toContain('"metricsPrefix": "wave"');
      expect(src).toContain('"haltOnFailure": true');
      expect(src).toContain("var options = pickProfile();");
      expect(src).toMatch(/export \{[^}]*\boptions\b[^}]*\}/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
