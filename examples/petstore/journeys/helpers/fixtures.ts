import { endpoints } from "../../generated/endpoints.js";
import { expect, journey, output, step, z } from "@usejourney/core";

/**
 * Non-auth fixture sub-journeys for the pet resource — the companion to
 * helpers/auth.ts. `seedPet` creates a throwaway pet and hands back its id;
 * `removePet` tears one down. A journey that needs a scratch pet invokes
 * `seedPet` at the start and `removePet` at the end instead of copy-pasting
 * the create/delete steps into every file.
 *
 * Both take the bearer `token` as a typed input — the caller authenticates
 * once (via the `acquireToken` sub-journey) and threads the token through.
 * This is the "common endpoint as a helper" pattern: the create/delete calls
 * are factored into one typed, named, LSP-renameable unit.
 */
export const seedPet = journey(
  "fixtures.seed-pet",
  {
    reusable: true,
    inputs: z.object({
      token: z.string().min(1),
      name: z.string().min(1),
    }),
    outputs: z.object({
      petId: z.number(),
    }),
  },
  (input) => {
    step("create fixture pet", {
      endpoint: endpoints.createPet,
      headers: () => ({ Authorization: `Bearer ${input.token}` }),
      body: { name: input.name, status: "available", tags: ["fixture"] },
      assert(res) {
        expect(res.status).toBe(201);
      },
      after(res) {
        // `output(...)` is the sub-journey's return value, validated against
        // the `outputs` schema; the parent's `invokeJourney({ after })` gets it.
        output({ petId: (res.body as { id: number }).id });
      },
    });
  },
);

/**
 * Teardown counterpart. No `outputs` schema — a cleanup node returns nothing,
 * so it never calls `output()`.
 */
export const removePet = journey(
  "fixtures.remove-pet",
  {
    reusable: true,
    inputs: z.object({
      token: z.string().min(1),
      petId: z.number(),
    }),
  },
  (input) => {
    step("delete fixture pet", {
      endpoint: endpoints.deletePet,
      params: () => ({ id: input.petId }),
      headers: () => ({ Authorization: `Bearer ${input.token}` }),
      assert(res) {
        expect(res.status).toBe(204);
      },
    });
  },
);
