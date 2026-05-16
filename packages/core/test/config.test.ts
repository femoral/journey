import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, resolveBaseUrl, resolveConfigPaths } from "../src/config.js";
import { clearActiveEnvironment, setActiveEnvironment } from "../src/env.js";

describe("loadConfig", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "journey-config-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("applies defaults and resolves paths", async () => {
    await writeFile(join(dir, "journey.config.json"), JSON.stringify({ name: "x" }));
    const loaded = await loadConfig(dir);
    expect(loaded.config.spec).toBe("openapi.yaml");
    expect(loaded.config.generatedDir).toBe("generated");
    const paths = resolveConfigPaths(loaded);
    expect(paths.specPath).toBe(join(dir, "openapi.yaml"));
    expect(paths.environmentsDir).toBe(join(dir, "environments"));
  });

  it("rejects unknown fields and bad URLs", async () => {
    await writeFile(join(dir, "journey.config.json"), JSON.stringify({ nope: true }));
    await expect(loadConfig(dir)).rejects.toThrow(/failed validation/);
    await writeFile(join(dir, "journey.config.json"), JSON.stringify({ baseUrl: "not-a-url" }));
    await expect(loadConfig(dir)).rejects.toThrow(/failed validation/);
  });

  it("tlsRejectUnauthorized defaults to true and accepts explicit booleans", async () => {
    await writeFile(join(dir, "journey.config.json"), JSON.stringify({ name: "x" }));
    let loaded = await loadConfig(dir);
    expect(loaded.config.tlsRejectUnauthorized).toBe(true);

    await writeFile(
      join(dir, "journey.config.json"),
      JSON.stringify({ name: "x", tlsRejectUnauthorized: false }),
    );
    loaded = await loadConfig(dir);
    expect(loaded.config.tlsRejectUnauthorized).toBe(false);

    await writeFile(
      join(dir, "journey.config.json"),
      JSON.stringify({ name: "x", tlsRejectUnauthorized: "yes" }),
    );
    await expect(loadConfig(dir)).rejects.toThrow(/failed validation/);
  });
});

describe("resolveBaseUrl", () => {
  afterEach(() => clearActiveEnvironment());

  it("prefers config.baseUrl", () => {
    setActiveEnvironment("any", { BASE_URL: "http://from-env" });
    expect(
      resolveBaseUrl({
        spec: "openapi.yaml",
        generatedDir: "generated",
        journeysDir: "journeys",
        environmentsDir: "environments",
        baseUrl: "http://from-config",
        runHistoryKeepCount: 20,
      }),
    ).toBe("http://from-config");
  });

  it("falls back to env BASE_URL when config has none", () => {
    setActiveEnvironment("any", { BASE_URL: "http://from-env" });
    expect(
      resolveBaseUrl({
        spec: "openapi.yaml",
        generatedDir: "generated",
        journeysDir: "journeys",
        environmentsDir: "environments",
        runHistoryKeepCount: 20,
      }),
    ).toBe("http://from-env");
  });

  it("returns undefined when neither source supplies a URL", () => {
    expect(
      resolveBaseUrl({
        spec: "openapi.yaml",
        generatedDir: "generated",
        journeysDir: "journeys",
        environmentsDir: "environments",
        runHistoryKeepCount: 20,
      }),
    ).toBeUndefined();
  });
});
