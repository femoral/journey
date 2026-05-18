---
title: Assertions
description: expect, Expectation, AssertionError.
sources:
  - packages/core/src/expect.ts
---

# Assertions

Built-in matcher helper. Narrative + examples: [Writing journeys → expect()](../../guide/writing-journeys/expect).

## `expect<T>(value)`

```ts
function expect<T>(value: T): Expectation<T>;
```

Returns a chain of matcher methods. Each method throws `AssertionError` on failure.

## `Expectation<T>`

```ts
interface Expectation<T> {
  toBe(expected: T): void;
  toEqual(expected: unknown): void;
  toBeDefined(): void;
  toContain(expected: unknown): void;
  toMatch(expected: RegExp | string): void;
}
```

| Method          | Works on      | Check                                                                              |
| --------------- | ------------- | ---------------------------------------------------------------------------------- |
| `toBe(x)`       | any           | `Object.is(value, x)`.                                                             |
| `toEqual(x)`    | any           | Recursive deep equality.                                                           |
| `toBeDefined()` | any           | `value !== undefined`.                                                             |
| `toContain(x)`  | string, array | `.includes` on strings; deep-equal element check on arrays. Throws on other types. |
| `toMatch(re)`   | string        | `re.test(value)`. Accepts `RegExp` or a string (wrapped in `new RegExp`).          |

## `AssertionError`

```ts
class AssertionError extends Error {
  constructor(message: string);
}
```

Thrown by `expect(…).to*()` on failure. `name === "AssertionError"`. The message includes both values, formatted via `JSON.stringify` (or `String(value)` for non-serializable inputs).

## Custom matchers

There is no official mechanism for extending `Expectation<T>`. For anything more exotic — snapshot matching, custom type guards, per-project predicates — use a third-party library:

```ts
import { strict as assert } from "node:assert";

step("ping", {
  endpoint: endpoints.ping,
  assert(res) {
    assert.equal(res.status, 200);
  },
});
```

The runtime treats any thrown value as a step failure, so any matcher library works as long as it throws on failure.
