import { describe, expect, it } from "vitest";
import { buildProgram } from "./index.js";

describe("@journey/cli", () => {
  it("exposes the documented subcommands", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["env", "export", "generate", "init", "run"]);
  });
});
