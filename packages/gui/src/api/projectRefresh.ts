import { createSignal } from "solid-js";

// Shared counter so any component subscribed to project state (Shell banner,
// ProjectPage settings panel) refetches when one of them mutates the config.
// Bump after a successful PATCH /api/project/config call.
const [tick, setTick] = createSignal(0);

export function projectRefreshTick(): number {
  return tick();
}

export function bumpProjectRefresh(): void {
  setTick((t) => t + 1);
}
