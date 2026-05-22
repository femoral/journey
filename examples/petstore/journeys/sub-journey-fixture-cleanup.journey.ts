import { env, expect, invokeJourney, journey, step } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";
import { acquireToken } from "./helpers/auth.js";
import { removePet, seedPet } from "./helpers/fixtures.js";

/**
 * Fixture lifecycle built from sub-journeys-as-helpers. The pipeline is
 * [ authenticate -> seed a pet -> exercise it -> tear it down -> verify gone ]:
 * three sub-journey nodes bracketing the real test steps.
 *
 * `seedPet` / `removePet` are non-auth common-endpoint sub-journeys — the
 * create/delete calls a dozen journeys would otherwise copy-paste, factored
 * into one typed unit. `inputs` here are lazy (`() => (...)`) because `token`
 * and `petId` are produced by the preceding sub-journey's `after` hook.
 */
journey("sub-journey fixture cleanup", () => {
  let token = "";
  let petId = 0;

  invokeJourney(acquireToken, {
    name: "authenticate",
    inputs: { username: env("USERNAME"), password: env("PASSWORD") },
    after: (out) => {
      token = out.token;
    },
  });

  invokeJourney(seedPet, {
    name: "seed a pet",
    inputs: () => ({ token, name: "Fixture Fido" }),
    after: (out) => {
      petId = out.petId;
    },
  });

  step("the seeded pet is available", {
    endpoint: endpoints.getPetById,
    params: () => ({ id: petId }),
    assert(res) {
      expect(res.status).toBe(200);
      const pet = res.body as { id: number; name: string; status: string };
      expect(pet.id).toBe(petId);
      expect(pet.name).toBe("Fixture Fido");
      expect(pet.status).toBe("available");
    },
  });

  invokeJourney(removePet, {
    name: "tear down the pet",
    inputs: () => ({ token, petId }),
  });

  step("the pet is gone", {
    endpoint: endpoints.getPetById,
    params: () => ({ id: petId }),
    assert(res) {
      expect(res.status).toBe(404);
    },
  });
});
