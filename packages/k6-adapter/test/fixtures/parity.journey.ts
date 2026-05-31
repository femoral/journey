// Fixture for the k6-shim ⇄ @journey/core parity test. Exercises the surfaces
// the shim re-implements: HTTP steps, function-valued `headers`/`body`/`params`/
// `query` (lazy evaluation order matters — `token` is set by the sub-journey's
// `after`), path-param interpolation, query-string building, an `assert` +
// `after` hook, and one `invokeJourney` sub-journey call.
import { journey, step, invokeJourney, output, expect, z } from "@journey/core";

let token = "";
const counter = { n: 0 };

const auth = journey("auth", { reusable: true, outputs: z.object({ token: z.string() }) }, () => {
  step("login", {
    endpoint: { method: "POST", path: "/login" },
    body: () => ({ user: "alice" }),
    after: () => output({ token: "tok-123" }),
  });
});

journey("parity fixture", () => {
  invokeJourney(auth, {
    name: "auth",
    after: (out) => {
      token = out.token;
    },
  });
  // Function-valued params (path interpolation) + query (string building) — the
  // surfaces the shim historically dropped. `id` lands in `/items/{id}`.
  step("get one", {
    endpoint: { method: "GET", path: "/items/{id}" },
    params: () => ({ id: 42 }),
    query: () => ({ verbose: true, limit: 5 }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    assert(res) {
      counter.n += 1;
      expect(res.status).toBe(200);
    },
  });
  step("create", {
    endpoint: { method: "POST", path: "/items" },
    headers: () => ({ Authorization: `Bearer ${token}`, "X-Seq": String(counter.n) }),
    body: () => ({ name: "thing", seq: counter.n }),
  });
});
