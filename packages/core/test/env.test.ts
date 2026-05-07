import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearActiveEnvironment,
  env,
  listEnvironments,
  loadEnvironment,
  setActiveEnvironment,
  tryEnv,
} from "../src/env.js";

describe("env()", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "journey-env-"));
    clearActiveEnvironment();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    clearActiveEnvironment();
  });

  it("throws when no active environment", () => {
    expect(() => env("USER")).toThrow(/no active environment/);
  });

  it("reads values from the active environment", async () => {
    await writeFile(join(dir, "dev.json"), JSON.stringify({ USER: "alice", COUNT: 5 }));
    const values = await loadEnvironment(dir, "dev");
    setActiveEnvironment("dev", values);
    expect(env("USER")).toBe("alice");
    expect(env("COUNT")).toBe("5");
    expect(() => env("MISSING")).toThrow(/not found in environment "dev"/);
  });

  it("lists environments", async () => {
    await writeFile(join(dir, "dev.json"), "{}");
    await writeFile(join(dir, "staging.json"), "{}");
    await writeFile(join(dir, "notes.txt"), "ignore me");
    expect(await listEnvironments(dir)).toEqual(["dev", "staging"]);
  });

  it("rejects non-object JSON", async () => {
    await writeFile(join(dir, "bad.json"), "[1,2,3]");
    await expect(loadEnvironment(dir, "bad")).rejects.toThrow(/must contain a JSON object/);
  });

  it("tryEnv returns undefined instead of throwing", () => {
    expect(tryEnv("ANY")).toBeUndefined();
    setActiveEnvironment("dev", { FOO: "bar" });
    expect(tryEnv("FOO")).toBe("bar");
    expect(tryEnv("MISSING")).toBeUndefined();
  });
});
