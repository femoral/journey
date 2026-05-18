import { describe, expect, it, vi } from "vitest";
import { contribute, fetchOAuth2Token, interpolateEnv } from "../src/pages/auth";

describe("interpolateEnv", () => {
  it("substitutes {{env.VAR}} against the provided env", () => {
    expect(interpolateEnv("Bearer {{env.TOKEN}}", { TOKEN: "abc" })).toBe("Bearer abc");
  });

  it("leaves unknown vars in place", () => {
    expect(interpolateEnv("{{env.MISSING}}", {})).toBe("{{env.MISSING}}");
  });
});

describe("contribute", () => {
  it("returns empty contributions for kind=none", () => {
    expect(contribute({ kind: "none" }, {})).toEqual({
      headers: {},
      query: {},
    });
  });

  it("emits a Basic header from username/password", () => {
    const c = contribute({ kind: "basic", username: "ada", password: "lovelace" }, {});
    expect(c.headers.Authorization).toBe(`Basic ${btoa("ada:lovelace")}`);
  });

  it("emits a Bearer header, substituting env vars", () => {
    const c = contribute({ kind: "bearer", token: "{{env.T}}" }, { T: "xyz" });
    expect(c.headers.Authorization).toBe("Bearer xyz");
  });

  it("routes API key to header or query based on where", () => {
    const h = contribute({ kind: "apikey", where: "header", name: "X-Api-Key", value: "abc" }, {});
    expect(h.headers["X-Api-Key"]).toBe("abc");
    expect(h.query).toEqual({});

    const q = contribute({ kind: "apikey", where: "query", name: "api_key", value: "abc" }, {});
    expect(q.query.api_key).toBe("abc");
    expect(q.headers).toEqual({});
  });

  it("uses a cached OAuth2 token when still valid", () => {
    const future = Date.now() + 60_000;
    const c = contribute(
      {
        kind: "oauth2",
        tokenUrl: "",
        clientId: "",
        clientSecret: "",
        scope: "",
        cached: { accessToken: "t", expiresAt: future },
      },
      {},
    );
    expect(c.headers.Authorization).toBe("Bearer t");
  });

  it("drops an expired OAuth2 cached token", () => {
    const past = Date.now() - 1_000;
    const c = contribute(
      {
        kind: "oauth2",
        tokenUrl: "",
        clientId: "",
        clientSecret: "",
        scope: "",
        cached: { accessToken: "t", expiresAt: past },
      },
      {},
    );
    expect(c.headers).toEqual({});
  });
});

describe("fetchOAuth2Token", () => {
  it("POSTs client-credentials and caches the returned token", async () => {
    const proxy = vi.fn(async () => ({
      status: 200,
      body: { access_token: "granted", expires_in: 120 },
    }));
    const next = await fetchOAuth2Token(
      {
        kind: "oauth2",
        tokenUrl: "https://auth/token",
        clientId: "id",
        clientSecret: "secret",
        scope: "read",
      },
      {},
      proxy,
    );
    expect(next.cached?.accessToken).toBe("granted");
    expect(next.cached?.expiresAt).toBeGreaterThan(Date.now());
    expect(proxy).toHaveBeenCalledWith(
      "https://auth/token",
      expect.stringContaining("grant_type=client_credentials"),
      expect.objectContaining({ "content-type": "application/x-www-form-urlencoded" }),
    );
  });
});
