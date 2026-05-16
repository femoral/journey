import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectOperations, generate } from "../src/index.js";
import { findPrefixOutliers } from "../src/lint.js";
import { loadSpec } from "../src/parse.js";
import type { Operation } from "../src/types.js";

const fixture = fileURLToPath(new URL("./fixtures/petstore.yaml", import.meta.url));

describe("codegen", () => {
  let out: string;
  beforeEach(async () => {
    out = await mkdtemp(join(tmpdir(), "journey-codegen-"));
  });
  afterEach(async () => {
    await rm(out, { recursive: true, force: true });
  });

  it("collects operations with stable names", async () => {
    const doc = await loadSpec(fixture);
    const ops = collectOperations(doc);
    expect(ops.map((o) => o.operationId)).toEqual(["listPets", "createPet", "getPetsById"]);
    expect(ops[0]).toMatchObject({ method: "get", path: "/pets" });
  });

  it("findPrefixOutliers flags 1 vs 30 prefix mismatch but not balanced splits", () => {
    const odd: Operation[] = [
      { method: "get", path: "/api/v1/foo", operationId: "f" },
      ...Array.from(
        { length: 30 },
        (_, i): Operation => ({
          method: "get",
          path: `/v1/op${i}`,
          operationId: `op${i}`,
        }),
      ),
    ];
    const result = findPrefixOutliers(odd);
    expect(result).not.toBeNull();
    expect(result!.majority.prefix).toBe("/v1");
    expect(result!.minority.prefix).toBe("/api");
    expect(result!.message).toContain("'/api'");
    expect(result!.message).toContain("'/v1'");

    const balanced: Operation[] = [
      ...Array.from(
        { length: 5 },
        (_, i): Operation => ({
          method: "get",
          path: `/v1/x${i}`,
          operationId: `a${i}`,
        }),
      ),
      ...Array.from(
        { length: 5 },
        (_, i): Operation => ({
          method: "get",
          path: `/v2/x${i}`,
          operationId: `b${i}`,
        }),
      ),
    ];
    expect(findPrefixOutliers(balanced)).toBeNull();

    const tiny: Operation[] = [
      { method: "get", path: "/api/foo", operationId: "f" },
      { method: "get", path: "/v1/op", operationId: "o" },
    ];
    expect(findPrefixOutliers(tiny)).toBeNull();
  });

  it("writes models.ts and endpoints.ts", async () => {
    const result = await generate({ specPath: fixture, outDir: out });
    expect(result.operationCount).toBe(3);

    const models = await readFile(result.modelsPath, "utf8");
    expect(models).toContain("export interface paths");
    expect(models).toContain("Pet");

    const endpoints = await readFile(result.endpointsPath, "utf8");
    expect(endpoints).toContain('import type { EndpointRef } from "@journey/core"');
    expect(endpoints).toContain("listPets:");
    expect(endpoints).toContain('method: "GET", path: "/pets"');
    expect(endpoints).toContain("createPet:");
    expect(endpoints).toContain('method: "POST", path: "/pets"');
  });
});
