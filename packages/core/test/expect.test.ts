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

  it("toBeGreaterThan / toBeGreaterThanOrEqual", () => {
    expect(5).toBeGreaterThan(4);
    expect(5).toBeGreaterThanOrEqual(5);
    v(() => expect(5).toBeGreaterThan(5)).toThrow(AssertionError);
    v(() => expect(4).toBeGreaterThanOrEqual(5)).toThrow(AssertionError);
    v(() => expect("5" as unknown as number).toBeGreaterThan(4)).toThrow(
      /toBeGreaterThan is only supported on numbers/,
    );
  });

  it("toBeLessThan / toBeLessThanOrEqual", () => {
    expect(4).toBeLessThan(5);
    expect(5).toBeLessThanOrEqual(5);
    v(() => expect(5).toBeLessThan(5)).toThrow(AssertionError);
    v(() => expect(6).toBeLessThanOrEqual(5)).toThrow(AssertionError);
  });

  it("toHaveLength on strings, arrays, and length-bearing objects", () => {
    expect("abc").toHaveLength(3);
    expect([1, 2, 3, 4]).toHaveLength(4);
    expect({ length: 7 } as unknown as { length: number }).toHaveLength(7);
    v(() => expect([1, 2]).toHaveLength(3)).toThrow(AssertionError);
    v(() => expect(123 as unknown as number[]).toHaveLength(3)).toThrow(
      /toHaveLength is only supported/,
    );
  });
});
