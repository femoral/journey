import { describe, expect as vExpect, it } from "vitest";
import { env, expect, journey, step } from "./index.js";

describe("@journey/core stubs", () => {
  it("exports throw until implemented", () => {
    vExpect(() => journey("x", () => {})).toThrow("not implemented");
    vExpect(() =>
      step("x", { endpoint: { method: "GET", path: "/" } }),
    ).toThrow("not implemented");
    vExpect(() => env("X")).toThrow("not implemented");
    vExpect(() => expect(1).toBe(1)).toThrow("not implemented");
  });
});
