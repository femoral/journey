import { env, expect, invokeJourney, journey, output, step, z } from "@usejourney/core";
import { acquireToken } from "./auth.js";

/**
 * Reusable sub-journey that *itself* contains a sub-journey node. It calls
 * `invokeJourney(acquireToken, ...)` to mint a token, then verifies that
 * token against the IDP `/auth/whoami` endpoint before returning a session
 * object.
 *
 * An entry journey that invokes `establishSession` therefore nests two
 * levels deep — exercising recursive group rendering and the runtime's
 * depth tracking.
 */
export const establishSession = journey(
  "session.establish",
  {
    reusable: true,
    inputs: z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }),
    outputs: z.object({
      token: z.string().min(1),
      username: z.string().min(1),
    }),
  },
  (input) => {
    let token = "";

    // Nested sub-journey node: a reusable journey may invoke another.
    invokeJourney(acquireToken, {
      name: "acquire token",
      inputs: {
        username: input.username,
        password: input.password,
      },
      after: (out) => {
        token = out.token;
      },
    });

    step("verify token", {
      endpoint: {
        method: "GET",
        path: "/auth/whoami",
        baseUrl: env("AUTH_BASE_URL"),
      },
      headers: () => ({ Authorization: `Bearer ${token}` }),
      assert(res) {
        expect(res.status).toBe(200);
      },
      after(res) {
        const body = res.body as { username: string };
        output({ token, username: body.username });
      },
    });
  },
);
