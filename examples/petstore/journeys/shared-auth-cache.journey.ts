import { env, expect, invokeJourney, journey, step } from "@usejourney/core";
import { endpoints } from "../generated/endpoints.js";
import { acquireToken } from "./helpers/auth.js";

/**
 * Two entry journeys that both authenticate through the SAME reusable
 * sub-journey with the SAME `cacheKey`. The point is what happens at export:
 *
 * - `journey export postman ./journeys --bundle` puts both journeys in one
 *   collection. Their `authenticate` folders share the cache slot
 *   `auth.acquire-token:<USERNAME>`, so the IDP login fires once for the whole
 *   collection run — the second journey's auth folder is skipped.
 * - `journey export k6` caches the token in-memory per VU, so each VU logs in
 *   once and reuses the token across its iterations (set `JOURNEY_CACHE=off`
 *   to force a cold login every iteration for a true-cost load test).
 *
 * The two journeys are deliberately independent read flows — the shared cost
 * is only the auth handshake, which is exactly the fixture-style work the
 * cache is meant to dedupe.
 */

const credentials = () => ({ username: env("USERNAME"), password: env("PASSWORD") });

journey("browse available pets", () => {
  let token = "";

  invokeJourney(acquireToken, {
    name: "authenticate",
    inputs: credentials,
    cacheKey: () => env("USERNAME"),
    after: (out) => {
      token = out.token;
    },
  });

  step("list available pets", {
    endpoint: endpoints.findPetsByStatus,
    query: () => ({ status: "available" }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});

journey("count sold pets", () => {
  let token = "";

  invokeJourney(acquireToken, {
    name: "authenticate",
    inputs: credentials,
    // Same key as the journey above — in a bundle they share one cache slot.
    cacheKey: () => env("USERNAME"),
    after: (out) => {
      token = out.token;
    },
  });

  step("list sold pets", {
    endpoint: endpoints.findPetsByStatus,
    query: () => ({ status: "sold" }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});
