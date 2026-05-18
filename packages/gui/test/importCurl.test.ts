import { describe, expect, it } from "vitest";
import { parseCurl } from "../src/pages/importCurl";

describe("parseCurl", () => {
  it("parses a GET with headers", () => {
    const r = parseCurl(`curl 'https://api.example.com/pets' -H 'x-trace: abc' --compressed`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.method).toBe("GET");
    expect(r.value.url).toBe("https://api.example.com/pets");
    expect(r.value.headers["x-trace"]).toBe("abc");
  });

  it("parses a POST with JSON body via -d and line continuations", () => {
    const r = parseCurl(
      `curl -X POST 'https://api.example.com/pets' \\\n  -H 'content-type: application/json' \\\n  -d '{"name":"rex"}'`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.method).toBe("POST");
    expect(r.value.body).toBe('{"name":"rex"}');
    expect(r.value.headers["content-type"]).toBe("application/json");
  });

  it("implies POST when -d is present without -X", () => {
    const r = parseCurl(`curl https://x --data 'a=b'`);
    expect(r.ok && r.value.method).toBe("POST");
  });

  it("extracts basic auth from -u user:pass", () => {
    const r = parseCurl(`curl -u ada:love 'https://x'`);
    expect(r.ok && r.value.basicAuth).toEqual({ username: "ada", password: "love" });
  });

  it("returns an error when no URL is present", () => {
    const r = parseCurl(`curl -X GET -H 'x: y'`);
    expect(r.ok).toBe(false);
  });

  it("warns on unsupported flags without failing", () => {
    const r = parseCurl(`curl -F 'file=@./a.txt' https://x`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.warnings.some((w) => w.includes("--form"))).toBe(true);
  });

  it("handles single and double quoted headers", () => {
    const r = parseCurl(
      `curl "https://x" -H "Authorization: Bearer with spaces" -H 'X-Single: val'`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.headers["Authorization"]).toBe("Bearer with spaces");
    expect(r.value.headers["X-Single"]).toBe("val");
  });
});
