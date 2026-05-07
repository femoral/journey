import { env, expect, journey, step } from "@journey/core";

/**
 * Round-trips a token through the IDP and asserts that the active environment
 * really is the one the operator selected. Running with `--env ci` against the
 * `local` mock data fails loudly, which makes env wiring observable.
 */
journey("whoami", () => {
  let token = "";

  step("login via IDP", {
    endpoint: {
      method: "POST",
      path: "/auth/login",
      baseUrl: env("AUTH_BASE_URL"),
    },
    body: { username: env("USERNAME"), password: env("PASSWORD") },
    assert(res) {
      expect(res.status).toBe(200);
    },
    after(res) {
      token = (res.body as { token: string }).token;
    },
  });

  step("whoami", {
    endpoint: {
      method: "GET",
      path: "/auth/whoami",
      baseUrl: env("AUTH_BASE_URL"),
    },
    headers: () => ({ Authorization: `Bearer ${token}` }),
    assert(res) {
      expect(res.status).toBe(200);
      const body = res.body as { username: string };
      expect(body.username).toBe(env("EXPECTED_USERNAME"));
    },
  });
});
