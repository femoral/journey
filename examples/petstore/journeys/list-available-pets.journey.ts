import { journey, step, expect } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";

journey("list available pets", () => {
  step("findByStatus", {
    endpoint: endpoints.findPetsByStatus,
    query: { status: "available" },
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});
