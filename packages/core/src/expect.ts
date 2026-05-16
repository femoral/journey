export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

export interface Expectation<T> {
  toBe(expected: T): void;
  toEqual(expected: unknown): void;
  toBeDefined(): void;
  toContain(expected: unknown): void;
  toMatch(expected: RegExp | string): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeLessThan(n: number): void;
  toBeLessThanOrEqual(n: number): void;
  toHaveLength(n: number): void;
}

function format(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

export function expect<T>(value: T): Expectation<T> {
  return {
    toBe(expected) {
      if (!Object.is(value, expected)) {
        throw new AssertionError(`expected ${format(value)} to be ${format(expected)}`);
      }
    },
    toEqual(expected) {
      if (!deepEqual(value, expected)) {
        throw new AssertionError(`expected ${format(value)} to equal ${format(expected)}`);
      }
    },
    toBeDefined() {
      if (value === undefined) {
        throw new AssertionError(`expected value to be defined`);
      }
    },
    toContain(expected) {
      if (typeof value === "string") {
        if (typeof expected !== "string" || !value.includes(expected)) {
          throw new AssertionError(`expected ${format(value)} to contain ${format(expected)}`);
        }
        return;
      }
      if (Array.isArray(value)) {
        if (!value.some((v) => deepEqual(v, expected))) {
          throw new AssertionError(`expected array to contain ${format(expected)}`);
        }
        return;
      }
      throw new AssertionError(`toContain is only supported on strings and arrays`);
    },
    toMatch(expected) {
      if (typeof value !== "string") {
        throw new AssertionError(`toMatch is only supported on strings`);
      }
      const re = typeof expected === "string" ? new RegExp(expected) : expected;
      if (!re.test(value)) {
        throw new AssertionError(`expected ${format(value)} to match ${re}`);
      }
    },
    toBeGreaterThan(n) {
      assertNumber(value, "toBeGreaterThan");
      if (!(value > n)) {
        throw new AssertionError(`expected ${format(value)} to be greater than ${n}`);
      }
    },
    toBeGreaterThanOrEqual(n) {
      assertNumber(value, "toBeGreaterThanOrEqual");
      if (!(value >= n)) {
        throw new AssertionError(`expected ${format(value)} to be greater than or equal to ${n}`);
      }
    },
    toBeLessThan(n) {
      assertNumber(value, "toBeLessThan");
      if (!(value < n)) {
        throw new AssertionError(`expected ${format(value)} to be less than ${n}`);
      }
    },
    toBeLessThanOrEqual(n) {
      assertNumber(value, "toBeLessThanOrEqual");
      if (!(value <= n)) {
        throw new AssertionError(`expected ${format(value)} to be less than or equal to ${n}`);
      }
    },
    toHaveLength(n) {
      const len = (value as { length?: unknown } | null | undefined)?.length;
      if (typeof len !== "number") {
        throw new AssertionError(
          `toHaveLength is only supported on strings, arrays, and objects with a numeric .length`,
        );
      }
      if (len !== n) {
        throw new AssertionError(`expected ${format(value)} to have length ${n}, got ${len}`);
      }
    },
  };
}

function assertNumber(value: unknown, matcher: string): asserts value is number {
  if (typeof value !== "number") {
    throw new AssertionError(`${matcher} is only supported on numbers (got ${typeof value})`);
  }
}
