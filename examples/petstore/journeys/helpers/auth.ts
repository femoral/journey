import { env, expect, journey, output, step, z } from "@usejourney/core";

/**
 * Reusable sub-journey: exchanges credentials for a bearer token at the IDP
 * mock. Declared with `{ reusable: true }`, so it does NOT auto-run — it
 * returns a typed handle that entry journeys pass to `invokeJourney(...)`.
 *
 * This replaces the copy-pasted "login via IDP" step that otherwise lives
 * verbatim at the top of every journey that needs auth.
 *
 * Note `z` is imported from `@usejourney/core` — a Journey project carries no
 * dependencies of its own, so `import { z } from "zod"` would not resolve.
 */
export const acquireToken = journey(
  "auth.acquire-token",
  {
    reusable: true,
    inputs: z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }),
    outputs: z.object({
      token: z.string().min(1),
      expiresIn: z.number(),
    }),
  },
  (input) => {
    step("login via IDP", {
      endpoint: {
        method: "POST",
        path: "/auth/login",
        // AUTH_BASE_URL is environment config (same for every caller); only
        // the credentials vary per call, so they are the typed `inputs`.
        baseUrl: env("AUTH_BASE_URL"),
      },
      body: { username: input.username, password: input.password },
      assert(res) {
        expect(res.status).toBe(200);
      },
      after(res) {
        const body = res.body as { token: string; expiresIn: number };
        // `output(...)` is the sub-journey's return value; the parent's
        // `invokeJourney({ after })` hook receives exactly this object,
        // validated against the `outputs` schema above.
        output({ token: body.token, expiresIn: body.expiresIn });
      },
    });
  },
);
