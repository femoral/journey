import { env, expect, invokeJourney, journey, step } from "@usejourney/core";
import { endpoints } from "../generated/endpoints.js";
import { acquireToken } from "./helpers/auth.js";

/**
 * Sub-journey node at the *start* of the pipeline. `invokeJourney(acquireToken,
 * ...)` is the first node — a peer of the HTTP steps, not an inline `step`.
 * The token it mints flows forward through a closure variable, exactly like
 * step-to-step state. The pet-adoption steps below are a realistic payload
 * for the scenario.
 */
journey("sub-journey at start", () => {
  let token = "";
  let petId = 0;

  invokeJourney(acquireToken, {
    // Display label for the timeline (defaults to the handle's name otherwise).
    name: "authenticate",
    inputs: {
      username: env("USERNAME"),
      password: env("PASSWORD"),
    },
    // Cache key — a hit replays the token and skips the child run. The key
    // captures everything that varies the output (the credentials, keyed by
    // username here). `journey export k6` honors this in-memory per-VU and
    // `journey export postman` skips the request via a collection variable.
    cacheKey: () => env("USERNAME"),
    after: (out) => {
      token = out.token;
    },
  });

  step("put a pet up for adoption", {
    endpoint: endpoints.createPet,
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: { name: "Biscuit", status: "available", tags: ["dog", "good-boy"] },
    assert(res) {
      expect(res.status).toBe(201);
      const pet = res.body as { id: number; status: string };
      expect(pet.status).toBe("available");
    },
    after(res) {
      petId = (res.body as { id: number }).id;
    },
  });

  step("adopt the pet (mark sold)", {
    endpoint: endpoints.updatePet,
    params: () => ({ id: petId }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: { status: "sold" },
    assert(res) {
      expect(res.status).toBe(200);
      expect((res.body as { status: string }).status).toBe("sold");
    },
  });

  step("confirm adoption", {
    endpoint: endpoints.getPetById,
    params: () => ({ id: petId }),
    assert(res) {
      expect(res.status).toBe(200);
      const pet = res.body as { id: number; name: string; status: string };
      expect(pet.id).toBe(petId);
      expect(pet.name).toBe("Biscuit");
      expect(pet.status).toBe("sold");
    },
  });

  step("clean up", {
    endpoint: endpoints.deletePet,
    params: () => ({ id: petId }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    assert(res) {
      expect(res.status).toBe(204);
    },
  });
});
