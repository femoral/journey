---
title: Assertions with expect()
description: The built-in expect() matcher — every method, what it checks, and how errors surface.
sources:
  - packages/core/src/expect.ts
---

# Assertions with `expect()`

`@journey/core` ships a minimal matcher. For anything more exotic, use any assertion library you like — all that matters is that failures throw.

```ts
function expect<T>(value: T): Expectation<T>;

interface Expectation<T> {
  toBe(expected: T): void;
  toEqual(expected: unknown): void;
  toBeDefined(): void;
  toContain(expected: unknown): void;
  toMatch(expected: RegExp | string): void;
}
```

## Matchers

| Matcher         | Works on       | Semantics |
|-----------------|----------------|-----------|
| `toBe(x)`       | any value      | Identity check via `Object.is(value, x)`. |
| `toEqual(x)`    | any value      | Recursive deep equality on plain objects and arrays. |
| `toBeDefined()` | any value      | Passes as long as `value !== undefined`. |
| `toContain(x)`  | string / array | On strings: `value.includes(x)`. On arrays: any element deep-equals `x`. Throws on other types. |
| `toMatch(re)`   | string         | `re.test(value)`. Accepts `RegExp` or a string (wrapped in `new RegExp`). |

### `toBe` — identity

```ts
expect(res.status).toBe(200);
expect(body.name).toBe("Mittens");
```

Good for primitives (numbers, booleans, strings) and specific object references. For object structural comparisons, use `toEqual`.

### `toEqual` — deep equality

```ts
expect(body.tags).toEqual(["cat", "indoor"]);
expect(body).toEqual({ id: 1, name: "Mittens" });
```

Recurses into plain objects and arrays. Object keys must match exactly — no subset matching.

### `toBeDefined`

```ts
expect(body.id).toBeDefined();
```

Passes for anything that isn't `undefined` — including `null`, `0`, `""`, `false`. If you specifically want to rule out `null`, add a separate `toBe(null)` check.

### `toContain`

Dual-purpose by argument type:

```ts
expect("hello world").toContain("world");        // string.includes
expect([1, 2, 3]).toContain(2);                  // array element equals
expect([{ id: 1 }, { id: 2 }]).toContain({ id: 1 }); // deep equal in array
```

Throws `toContain is only supported on strings and arrays` if called on anything else.

### `toMatch`

```ts
expect(body.name).toMatch(/^M/);
expect(body.uuid).toMatch("^[a-f0-9-]{36}$"); // strings are wrapped in RegExp
```

Throws `toMatch is only supported on strings` if `value` isn't a string.

## Error format

Failures throw `AssertionError`. The message includes both values, JSON-formatted:

```
expected "pending" to be "available"
expected {"id":1} to equal {"id":2}
expected ["a","b"] to contain "c"
```

Objects that don't `JSON.stringify` cleanly fall back to `String(value)`.

## Plain `throw` works too

The runtime treats any thrown value as a step failure. You don't have to use `expect`:

```ts
assert(res) {
  if (res.status !== 200) {
    throw new Error(`unexpected ${res.status}`);
  }
  if (!res.body) {
    throw new Error("empty body");
  }
}
```

Useful when you have a helper function that already throws on bad input (e.g. a parser), or when you want to include structured context in the error.

## Typical shape of an `assert`

```ts
step("read pet", {
  endpoint: endpoints.getPetById,
  params: { id: petId },
  assert(res) {
    expect(res.status).toBe(200);

    const body = res.body as { id: number; name: string; tags: string[] };
    expect(body.id).toBeDefined();
    expect(body.name).toBe("Mittens");
    expect(body.tags).toEqual(["cat", "indoor"]);
    expect(body.tags).toContain("cat");
    expect(body.name).toMatch(/^M/);

    expect(res.headers["content-type"]).toContain("application/json");
  },
});
```

## Swapping in another library

Nothing stops you from importing `vitest`, `chai`, `node:assert/strict`, or any other matcher library — they all throw on failure, which is the only contract the runtime cares about:

```ts
import { strict as assert } from "node:assert";

step("ping", {
  endpoint: endpoints.ping,
  assert(res) {
    assert.equal(res.status, 200);
  },
});
```

The built-in `expect` is there so you don't have to pull in a dependency for simple cases.
