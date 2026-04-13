import { describe, expect as v, it } from "vitest";
import { AssertionError, expect } from "../src/expect.js";

describe("expect()", () => {
  it("toBe passes on identity", () => {
    expect(1).toBe(1);
    v(() => expect(1).toBe(2)).toThrow(AssertionError);
  });
  it("toEqual deep-equals", () => {
    expect({ a: [1, 2] }).toEqual({ a: [1, 2] });
    v(() => expect({ a: 1 }).toEqual({ a: 2 })).toThrow(AssertionError);
  });
  it("toBeDefined", () => {
    expect(0).toBeDefined();
    v(() => expect(undefined).toBeDefined()).toThrow(AssertionError);
  });
  it("toContain on strings and arrays", () => {
    expect("hello world").toContain("world");
    expect([1, 2, 3]).toContain(2);
    v(() => expect("abc").toContain("z")).toThrow(AssertionError);
  });
  it("toMatch with regex or string", () => {
    expect("abc-123").toMatch(/\d+/);
    expect("abc-123").toMatch("abc");
    v(() => expect("abc").toMatch(/\d+/)).toThrow(AssertionError);
  });
});
