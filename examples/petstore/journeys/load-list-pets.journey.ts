import { env, expect, journey, step } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";

/**
 * Demo of journey-level load options. The emitted k6 script bakes the
 * `stages` ramp into `export const options`, so `k6 run load-list-pets.k6.js`
 * needs no extra flags. Filter the export with `--tag load`.
 */
journey(
  "load: list pets",
  {
    tags: ["load"],
    k6: {
      stages: [
        { duration: "10s", target: 5 },
        { duration: "30s", target: 20 },
        { duration: "10s", target: 0 },
      ],
    },
  },
  () => {
    step("findByStatus", {
      endpoint: endpoints.findPetsByStatus,
      query: () => ({ status: "available", limit: Number(env("PET_LIST_LIMIT")) }),
      assert(res) {
        expect(res.status).toBe(200);
      },
    });
  },
);
