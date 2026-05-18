import { describe, expect, it } from "vitest";
import { runPostScript, runPreScript } from "../src/pages/scripts";

describe("runPreScript", () => {
  it("mutates ctx.headers and logs", async () => {
    const ctx = { headers: {} as Record<string, string>, query: {}, body: undefined, env: {} };
    const r = await runPreScript(`headers['X-Trace'] = 'abc'; log('setting trace');`, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.headers["X-Trace"]).toBe("abc");
    expect(r.logs).toEqual([{ level: "info", text: "setting trace" }]);
  });

  it("captures thrown errors", async () => {
    const r = await runPreScript(`throw new Error('nope');`, {
      headers: {},
      query: {},
      body: undefined,
      env: {},
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("nope");
  });

  it("is a no-op for empty input", async () => {
    const r = await runPreScript("   ", {
      headers: {},
      query: {},
      body: undefined,
      env: {},
    });
    expect(r.ok).toBe(true);
    expect(r.logs).toEqual([]);
  });
});

describe("runPostScript", () => {
  it("runs expect() on res and logs on pass", async () => {
    const r = await runPostScript(
      `expect(res.status).toBe(200); log('ok');`,
      { headers: {}, query: {}, body: undefined, env: {} },
      { status: 200, headers: {}, body: { ok: true } },
    );
    expect(r.ok).toBe(true);
    expect(r.logs).toEqual([{ level: "info", text: "ok" }]);
  });

  it("fails when an assertion throws", async () => {
    const r = await runPostScript(
      `expect(res.status).toBe(200);`,
      { headers: {}, query: {}, body: undefined, env: {} },
      { status: 500, headers: {}, body: {} },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expected 500 to be 200/);
  });
});
