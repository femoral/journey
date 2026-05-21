import { env, expect, invokeJourney, journey, step } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";
import { acquireToken } from "./helpers/auth.js";

/**
 * Negative case: the sub-journey itself fails. `acquireToken` is invoked
 * with a deliberately wrong password, so its `login via IDP` step gets a
 * 401 and the status assertion throws.
 *
 * The failure propagates across the `invokeJourney` boundary: the
 * `authenticate` group node fails, which fails the parent run. The group
 * row goes red and the pipeline halts — `list pets` below never runs and
 * stays idle (not yellow). The `after` hook is never reached because the
 * sub-journey produces no `output`.
 *
 * This run is EXPECTED to fail. It exists to demonstrate failure
 * propagation without hand-editing the shared `helpers/auth.ts`.
 */
journey("sub-journey failure", () => {
  invokeJourney(acquireToken, {
    name: "authenticate",
    inputs: {
      username: env("USERNAME"),
      password: "deliberately-the-wrong-password",
    },
    after: () => {
      throw new Error("unreachable — the sub-journey fails before producing output");
    },
  });

  step("list pets", {
    endpoint: endpoints.findPetsByStatus,
    query: { status: "available" },
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});
