import { expect, journey, step } from "@usejourney/core";
import { endpoints } from "../generated/endpoints.js";

/**
 * Deliberately long-running journey: ten sequential public GETs. The
 * petstore mock adds 200–1000ms of simulated latency per request (see
 * `server.mjs`, `MOCK_DELAY_MIN_MS` / `MOCK_DELAY_MAX_MS`), so a full run
 * takes several seconds — long enough to exercise the Stop button mid-run.
 *
 * On stop, the in-flight step is aborted and the run ends `ok: false` with
 * "Run stopped by user"; the remaining steps stay idle.
 */
journey("slow run", () => {
  for (let i = 1; i <= 10; i++) {
    step(`poll pets #${i}`, {
      endpoint: endpoints.findPetsByStatus,
      query: { status: "available" },
      assert(res) {
        expect(res.status).toBe(200);
      },
    });
  }
});
