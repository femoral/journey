/**
 * Launch-time gate for experimental GUI features.
 *
 * Set `VITE_JOURNEY_EXPERIMENTAL=1` (or `=true`) to enable. Read on every call
 * so tests can flip `import.meta.env.VITE_JOURNEY_EXPERIMENTAL` between renders.
 */
export function experimentalEnabled(): boolean {
  const raw = import.meta.env.VITE_JOURNEY_EXPERIMENTAL;
  return raw === "1" || raw === "true";
}
