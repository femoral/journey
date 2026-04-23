import { describe, expect, it } from "vitest";
import { insertStep, renderStepBlock } from "../src/pages/SaveAsStepDialog";

describe("renderStepBlock", () => {
  it("emits a complete step block with headers and body", () => {
    const s = renderStepBlock("GET /pet/123", {
      endpoint: {
        name: "getPet",
        method: "GET",
        path: "/pet/{id}",
        parameters: [],
      },
      method: "GET",
      path: "/pet/123",
      headers: { Authorization: "Bearer t" },
      body: { foo: "bar" },
    });
    expect(s).toContain(`step("GET /pet/123", {`);
    expect(s).toContain(`endpoint: { method: "GET", path: "/pet/123" }`);
    expect(s).toContain(`"Authorization": "Bearer t"`);
    expect(s).toContain(`"foo": "bar"`);
    expect(s.trimEnd().endsWith("});")).toBe(true);
  });

  it("omits the headers and body keys when empty/undefined", () => {
    const s = renderStepBlock("GET /", {
      endpoint: { name: "x", method: "GET", path: "/", parameters: [] },
      method: "GET",
      path: "/",
      headers: {},
    });
    expect(s).not.toContain("headers:");
    expect(s).not.toContain("body:");
  });
});

describe("insertStep", () => {
  it("inserts before the last `});` preserving formatting", () => {
    const src = `journey("x", () => {
  step("first", { endpoint: { method: "GET", path: "/a" } });
});
`;
    const snippet = `  step("second", { endpoint: { method: "GET", path: "/b" } });`;
    const res = insertStep(src, snippet);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.source).toContain(`step("first"`);
    expect(res.source).toContain(`step("second"`);
    // The new step comes after the first one.
    expect(res.source.indexOf("second")).toBeGreaterThan(
      res.source.indexOf("first"),
    );
    // The final `});` is still present.
    expect(res.source.trimEnd().endsWith("});")).toBe(true);
  });

  it("fails cleanly when the source has no `});`", () => {
    const res = insertStep("// empty journey file", "  step(...);");
    expect(res.ok).toBe(false);
  });
});
