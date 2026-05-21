import { env, expect, invokeJourney, journey, step } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";
import { acquireToken } from "./helpers/auth.js";

/**
 * Sub-journey node *between* two HTTP steps, not at the pipeline start.
 * `list pets` is a public GET that needs no auth; the `authenticate`
 * sub-journey runs next; then `register a pet` uses the token it minted.
 *
 * Exercises the group stack at a non-zero pipeline position — the child
 * step indices must slot in without offsetting the steps that follow.
 */
journey("sub-journey mid-pipeline", () => {
  let token = "";
  let petId = 0;

  step("list pets", {
    endpoint: endpoints.findPetsByStatus,
    query: { status: "available" },
    assert(res) {
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    },
  });

  invokeJourney(acquireToken, {
    name: "authenticate",
    inputs: {
      username: env("USERNAME"),
      password: env("PASSWORD"),
    },
    after: (out) => {
      token = out.token;
    },
  });

  step("register a pet", {
    endpoint: endpoints.createPet,
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: { name: "Pepper", status: "available", tags: ["dog"] },
    assert(res) {
      expect(res.status).toBe(201);
    },
    after(res) {
      petId = (res.body as { id: number }).id;
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
