import { journey, step, expect } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";

journey("list available pets", () => {
  step("findByStatus", {
    endpoint: endpoints.findPetsByStatus,
    query: { status: "available", limit: 5 },
    assert(res) {
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    },
  });
});
