import { env, expect, invokeJourney, journey, step } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";
import { establishSession } from "./helpers/session.js";

/**
 * Two-level sub-journey nesting. `establishSession` is a reusable journey
 * that *itself* invokes `acquireToken`, so the timeline nests:
 *
 *   open a session       (group)
 *     acquire token      (group)
 *       login via IDP
 *     verify token
 *   register a pet
 *   clean up
 *
 * Exercises recursive group rendering in the GUI and the runtime's
 * 8-level recursion cap.
 */
journey("nested sub-journey", () => {
  let token = "";
  let petId = 0;

  invokeJourney(establishSession, {
    name: "open a session",
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
    body: { name: "Clover", status: "available", tags: ["rabbit"] },
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
