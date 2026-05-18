const INVALID = /[^a-zA-Z0-9]+/g;
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function pascalCaseParts(input: string): string {
  return input
    .split(INVALID)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Derive a stable JS identifier for an operation. When `operationId` is a valid
 * identifier we trust it verbatim — users chose that name intentionally. Otherwise
 * derive from method + path, e.g. `GET /v1/accounts/{id}` → `getV1AccountsById`.
 */
export function operationName(
  method: string,
  path: string,
  operationId: string | undefined,
): string {
  if (operationId && IDENT_RE.test(operationId)) return operationId;
  const cleanedPath = path.replace(/\{([^}]+)\}/g, "By_$1").replace(/\//g, "_");
  const pascal = pascalCaseParts(`${method}_${cleanedPath}`);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let i = 2;
  while (taken.has(`${base}${i}`)) i += 1;
  const next = `${base}${i}`;
  taken.add(next);
  return next;
}
