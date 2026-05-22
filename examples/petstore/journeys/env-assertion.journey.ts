import { env, expect, invokeJourney, journey, step } from "@journey/core";
import { acquireToken } from "./helpers/auth.js";

/**
 * Round-trips a token through the IDP and asserts that the active environment
 * really is the one the operator selected. Running with `--env ci` against the
 * `local` mock data fails loudly, which makes env wiring observable.
 *
 * The token comes from the `acquireToken` reusable sub-journey rather than an
 * inline login step — the same auth bootstrap every authed journey shares.
 */
journey("env assertion", () => {
  let token = "";

  invokeJourney(acquireToken, {
    name: "authenticate",
    inputs: { username: env("USERNAME"), password: env("PASSWORD") },
    after: (out) => {
      token = out.token;
    },
  });

  step("whoami", {
    endpoint: {
      method: "GET",
      path: "/auth/whoami",
      baseUrl: env("AUTH_BASE_URL"),
    },
    headers: () => ({ Authorization: `Bearer ${token}` }),
    assert(res) {
      expect(res.status).toBe(200);
      const body = res.body as { username: string };
      expect(body.username).toBe(env("EXPECTED_USERNAME"));
    },
  });
});
