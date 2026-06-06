import { env, expect, invokeJourney, journey, step } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";
import { acquireToken } from "./helpers/auth.js";

/**
 * Exercises the dynamic **body** and **query** paths of `journey export postman
 * --thread-state`. A pet is created, then:
 *
 * - the intake note's request **body** is built from the captured `petId`
 *   (`body: () => ({ text: ... })`), and
 * - the status listing's **query** is built from the captured `petStatus`
 *   (`query: () => ({ status: petStatus })`).
 *
 * Under `--thread-state` the exporter bakes `{{__journey_body}}` / `{{__q_status}}`
 * placeholders and fills them from the re-run closures in each request's
 * pre-request script, so the exported collection runs the real flow in Newman
 * instead of sending export-time placeholder values. Run normally it behaves
 * like any other journey — the closures carry state through `petId`/`petStatus`.
 */
journey("threaded notes (dynamic body + query)", () => {
  let token = "";
  let petId = 0;
  let petStatus = "";

  invokeJourney(acquireToken, {
    name: "authenticate",
    inputs: { username: env("USERNAME"), password: env("PASSWORD") },
    cacheKey: () => env("USERNAME"),
    after: (out) => {
      token = out.token;
    },
  });

  step("register a pet", {
    endpoint: endpoints.createPet,
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: { name: "Marble", status: "available", tags: ["cat"] },
    assert(res) {
      expect(res.status).toBe(201);
    },
    after(res) {
      const pet = res.body as { id: number; status: string };
      petId = pet.id;
      petStatus = pet.status;
    },
  });

  // Dynamic body — the note text is built from state captured above.
  step("attach an intake note", {
    endpoint: endpoints.addPetNote,
    params: () => ({ id: petId }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: () => ({ text: `intake note for pet ${petId}` }),
    assert(res) {
      expect(res.status).toBe(201);
      expect((res.body as { text: string }).text).toContain(String(petId));
    },
  });

  // Dynamic query — list other pets sharing the status we just observed.
  step("list pets sharing its status", {
    endpoint: endpoints.findPetsByStatus,
    query: () => ({ status: petStatus }),
    assert(res) {
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
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
