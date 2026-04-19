import { describe, expect, it } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { JsonDiff } from "../src/components/JsonDiff";

describe("JsonDiff", () => {
  it("renders same lines without prefix color", () => {
    render(() => <JsonDiff left={{ a: 1 }} right={{ a: 1 }} />);
    expect(screen.getByTestId("diff-output").textContent).toContain('"a": 1');
  });

  it("highlights additions and deletions", () => {
    render(() => <JsonDiff left={{ a: 1, b: 2 }} right={{ a: 1, c: 3 }} />);
    const text = screen.getByTestId("diff-output").textContent ?? "";
    // "b": 2 should be prefixed "- ", "c": 3 should be prefixed "+ "
    expect(text).toContain('-   "b": 2');
    expect(text).toContain('+   "c": 3');
  });
});
