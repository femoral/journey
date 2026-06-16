import { expect, invokeJourney, journey, output, step, z } from "@usejourney/core";
import { endpoints } from "../generated/endpoints.js";

/**
 * A reusable fixture that makes **two** requests, cached and invoked from two
 * entry journeys. It exercises the multi-request branch of the sub-journey
 * cache: on `journey export postman --bundle` the first invocation runs both
 * child requests (the window opens only on the fixture's terminal request, so
 * nothing is over-skipped mid-fixture), and the second invocation — sharing the
 * `cacheKey` — skips the whole fixture.
 *
 * It is read-only (two `findByStatus` listings), so it runs without auth.
 */
const warmCatalog = journey(
  "fixtures.warm-catalog",
  { reusable: true, outputs: z.object({ sold: z.number() }) },
  () => {
    step("list available", {
      endpoint: endpoints.findPetsByStatus,
      query: { status: "available" },
      assert(res) {
        expect(res.status).toBe(200);
      },
    });
    step("list sold", {
      endpoint: endpoints.findPetsByStatus,
      query: { status: "sold" },
      assert(res) {
        expect(res.status).toBe(200);
      },
      after(res) {
        output({ sold: Array.isArray(res.body) ? res.body.length : 0 });
      },
    });
  },
);

journey("catalog check A", () => {
  invokeJourney(warmCatalog, { name: "warm catalog", cacheKey: "catalog" });
  step("spot check pending", {
    endpoint: endpoints.findPetsByStatus,
    query: { status: "pending" },
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});

journey("catalog check B", () => {
  // Same cacheKey — in a bundle the two-request fixture runs once for the whole
  // collection run; this journey's invocation is skipped on the cache hit.
  invokeJourney(warmCatalog, { name: "warm catalog", cacheKey: "catalog" });
  step("spot check pending", {
    endpoint: endpoints.findPetsByStatus,
    query: { status: "pending" },
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});
