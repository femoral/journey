import { AssertionError, env, expect, journey, step } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";

journey("list available pets", { tags: ["smoke"], k6: { vus: 5, duration: "10s" } }, () => {
  step("findByStatus", {
    endpoint: endpoints.findPetsByStatus,
    query: () => ({ status: "available", limit: Number(env("PET_LIST_LIMIT")) }),
    assert(res) {
      const limit = Number(env("PET_LIST_LIMIT"));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const len = (res.body as unknown[]).length;
      if (len > limit) {
        throw new AssertionError(`expected at most ${limit} pets, got ${len}`);
      }
    },
  });
});
