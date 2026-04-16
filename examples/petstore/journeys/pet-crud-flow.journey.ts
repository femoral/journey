import { env, expect, journey, step } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";

/**
 * End-to-end pet lifecycle. Exercises every method on the example API and
 * passes state between steps via plain closure variables — no templating.
 */
journey("pet CRUD flow", () => {
  let token = "";
  let petId = 0;

  step("login", {
    endpoint: endpoints.login,
    body: { username: env("USERNAME"), password: env("PASSWORD") },
    assert(res) {
      expect(res.status).toBe(200);
      const body = res.body as { token: string; expiresIn: number };
      expect(body.token).toBeDefined();
      expect(body.expiresIn).toBe(3600);
    },
    after(res) {
      token = (res.body as { token: string }).token;
    },
  });

  step("create pet", {
    endpoint: endpoints.createPet,
    headers: () => ({
      Authorization: `Bearer ${token}`,
      "X-Request-Id": `${env("REQUEST_ID_PREFIX")}-create`,
    }),
    body: { name: "Mittens", status: "available", tags: ["cat", "indoor"] },
    assert(res) {
      expect(res.status).toBe(201);
      const pet = res.body as { id: number; name: string; status: string };
      expect(pet.name).toBe("Mittens");
      expect(pet.status).toBe("available");
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

  step("patch status to pending", {
    endpoint: endpoints.updatePet,
    params: () => ({ id: petId }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: { status: "pending" },
    assert(res) {
      expect(res.status).toBe(200);
      const pet = res.body as { name: string; status: string };
      expect(pet.status).toBe("pending");
      expect(pet.name).toBe("Mittens"); // patch preserved name
    },
  });

  step("replace pet wholesale", {
    endpoint: endpoints.replacePet,
    params: () => ({ id: petId }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: { name: "Mittens II", status: "sold", tags: ["cat"] },
    assert(res) {
      expect(res.status).toBe(200);
      const pet = res.body as { name: string; status: string; tags: string[] };
      expect(pet.name).toBe("Mittens II");
      expect(pet.status).toBe("sold");
      expect(pet.tags).toEqual(["cat"]);
    },
  });

  step("add a note", {
    endpoint: endpoints.addPetNote,
    params: () => ({ id: petId }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: { text: "Adopted by the Carroll family" },
    assert(res) {
      expect(res.status).toBe(201);
      const note = res.body as { petId: number; text: string };
      expect(note.petId).toBe(petId);
      expect(note.text).toBe("Adopted by the Carroll family");
    },
  });

  step("list notes", {
    endpoint: endpoints.listPetNotes,
    params: () => ({ id: petId }),
    assert(res) {
      expect(res.status).toBe(200);
      const notes = res.body as Array<{ text: string }>;
      expect(notes.length).toBe(1);
    },
  });

  step("delete pet", {
    endpoint: endpoints.deletePet,
    params: () => ({ id: petId }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    assert(res) {
      expect(res.status).toBe(204);
    },
  });

  step("verify pet is gone", {
    endpoint: endpoints.getPetById,
    params: () => ({ id: petId }),
    assert(res) {
      expect(res.status).toBe(404);
    },
  });
});
