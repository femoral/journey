/**
 * Auth preset model for the Endpoints page. Mirrors the prototype's picker:
 * none | basic | bearer | apikey | oauth2 client-credentials. State persists
 * per endpoint-page session (not across reloads — storing API keys in
 * localStorage is the kind of thing the redesign brief explicitly calls out
 * as not-a-cloud-thing; secrets belong in environments/*.json).
 */

export type AuthPreset =
  | { kind: "none" }
  | { kind: "basic"; username: string; password: string }
  | { kind: "bearer"; token: string }
  | {
      kind: "apikey";
      where: "header" | "query";
      name: string;
      value: string;
    }
  | {
      kind: "oauth2";
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      scope: string;
      cached?: { accessToken: string; expiresAt: number };
    };

export type AuthPresetKind = AuthPreset["kind"];

/** Returns a fresh default for the given preset kind. */
export function defaultPreset(kind: AuthPresetKind): AuthPreset {
  switch (kind) {
    case "none":
      return { kind: "none" };
    case "basic":
      return { kind: "basic", username: "", password: "" };
    case "bearer":
      return { kind: "bearer", token: "" };
    case "apikey":
      return { kind: "apikey", where: "header", name: "X-Api-Key", value: "" };
    case "oauth2":
      return {
        kind: "oauth2",
        tokenUrl: "",
        clientId: "",
        clientSecret: "",
        scope: "",
      };
  }
}

/**
 * Interpolates `{{env.VAR}}` against a map of active env values. Journey files
 * use env() directly; the Endpoints page's ad-hoc Send doesn't run user code
 * so we substitute textually here before dispatching the request.
 */
export function interpolateEnv(input: string, env: Record<string, string>): string {
  return input.replace(/\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, k: string) =>
    k in env ? (env[k] ?? "") : `{{env.${k}}}`,
  );
}

export type AuthContribution = {
  headers: Record<string, string>;
  query: Record<string, string>;
};

/**
 * Given a preset, produce the headers and query params that should be merged
 * into the outgoing request. Returns empty contributions for "none" and for
 * presets missing required fields — callers just spread whatever is returned.
 */
export function contribute(preset: AuthPreset, env: Record<string, string>): AuthContribution {
  const out: AuthContribution = { headers: {}, query: {} };
  const sub = (s: string) => interpolateEnv(s, env);
  switch (preset.kind) {
    case "none":
      return out;
    case "basic": {
      const u = sub(preset.username);
      const p = sub(preset.password);
      if (!u && !p) return out;
      // `btoa` takes latin-1; works for the ASCII subset typical of creds.
      // For non-ASCII creds we'd need TextEncoder+base64 which the Send target
      // won't typically accept anyway.
      out.headers["Authorization"] = `Basic ${btoa(`${u}:${p}`)}`;
      return out;
    }
    case "bearer": {
      const t = sub(preset.token);
      if (!t) return out;
      out.headers["Authorization"] = `Bearer ${t}`;
      return out;
    }
    case "apikey": {
      const name = preset.name.trim();
      const value = sub(preset.value);
      if (!name || !value) return out;
      if (preset.where === "header") out.headers[name] = value;
      else out.query[name] = value;
      return out;
    }
    case "oauth2": {
      const c = preset.cached;
      if (c && c.expiresAt > Date.now() + 5_000 && c.accessToken) {
        out.headers["Authorization"] = `Bearer ${c.accessToken}`;
      }
      return out;
    }
  }
}

/**
 * Exchanges client-credentials for a bearer token via the configured token
 * URL, returning the updated preset with a cached token. Throws on non-2xx
 * or malformed response so the caller can surface the error inline.
 *
 * Goes through the /api/request proxy on the host, not directly — this
 * avoids browser CORS issues against token endpoints that don't whitelist
 * the dev origin.
 */
export async function fetchOAuth2Token(
  preset: Extract<AuthPreset, { kind: "oauth2" }>,
  env: Record<string, string>,
  proxy: (
    url: string,
    body: string,
    headers: Record<string, string>,
  ) => Promise<{ status: number; body: unknown }>,
): Promise<Extract<AuthPreset, { kind: "oauth2" }>> {
  const sub = (s: string) => interpolateEnv(s, env);
  const tokenUrl = sub(preset.tokenUrl).trim();
  if (!tokenUrl) throw new Error("token URL is required");
  const formBody = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: sub(preset.clientId),
    client_secret: sub(preset.clientSecret),
    ...(preset.scope ? { scope: sub(preset.scope) } : {}),
  }).toString();
  const res = await proxy(tokenUrl, formBody, {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`token endpoint returned ${res.status}`);
  }
  const body = res.body as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body?.access_token) {
    throw new Error("token response missing access_token");
  }
  const ttlMs = (body.expires_in ?? 3600) * 1000;
  return {
    ...preset,
    cached: {
      accessToken: body.access_token,
      expiresAt: Date.now() + ttlMs,
    },
  };
}
