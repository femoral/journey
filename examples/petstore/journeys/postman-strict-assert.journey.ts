import { env, expect, invokeJourney, journey, step } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";
import { acquireToken } from "./helpers/auth.js";

/**
 * Demonstrates strict assertion enforcement in the Postman export.
 *
 * Export with state threading:
 *
 *   journey export postman ./journeys/postman-strict-assert.journey.ts \
 *     --thread-state --env local
 *
 * Under `--thread-state` every `expect()` in an `assert(res)` / a sub-journey
 * call's `assert(out)` becomes its own enforced `pm.test`. Run the collection in
 * Newman/Postman and the assertions below COUNT in the summary — green here,
 * because each holds against the mock. Flip one (e.g. `toBe(201)` → `toBe(200)`
 * on "create pet") to watch the run go RED with a non-zero exit, the way a real
 * acceptance suite gates CI.
 *
 * The token minted by `acquireToken` is threaded into the `Authorization`
 * headers below, and the created `petId` into the later path param — closure
 * state surviving across Postman request sandboxes via `__journey_state`.
 *
 * Append `--lenient` to restore the legacy non-enforcing skeleton: the same
 * `expect()` calls run but a failure is swallowed to a console line, so the run
 * stays green and the assertion tally reads 0. See `sub-journey-failure.journey.ts`
 * for the negative case — under strict export its 401 status assert reds, as it
 * should.
 */
journey("postman strict assert", () => {
  let token = "";
  let petId = 0;

  invokeJourney(acquireToken, {
    name: "authenticate",
    inputs: { username: env("USERNAME"), password: env("PASSWORD") },
    // Enforced under --thread-state: the sub-journey's typed output is asserted
    // on the folder's terminal request.
    assert: (out) => {
      expect(out.expiresIn).toBe(3600);
    },
    after: (out) => {
      token = out.token;
    },
  });

  step("create pet", {
    endpoint: endpoints.createPet,
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: { name: "Strict", status: "available", tags: ["cat"] },
    assert(res) {
      expect(res.status).toBe(201);
      const pet = res.body as { name: string; status: string };
      expect(pet.name).toBe("Strict");
    },
    after(res) {
      petId = (res.body as { id: number }).id;
    },
  });

  step("fetch pet", {
    endpoint: endpoints.getPetById,
    params: () => ({ id: petId }),
    assert(res) {
      expect(res.status).toBe(200);
      expect((res.body as { id: number }).id).toBe(petId);
    },
  });
});
