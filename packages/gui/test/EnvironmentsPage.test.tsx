import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { EnvironmentsPage } from "../src/pages/EnvironmentsPage";

const listResp = {
  defaultEnvironment: "dev",
  environments: [
    { name: "dev", values: { USER: "alice" } },
    { name: "staging", values: {} },
  ],
};

describe("EnvironmentsPage", () => {
  it("loads the list, edits a value, and issues a PUT on save", async () => {
    const fetchMock = vi.fn(async (input: Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ USER: "bob" });
        return new Response(JSON.stringify({ name: "dev", values: body }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(listResp), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(() => <EnvironmentsPage />);
    await waitFor(() => expect(screen.getByTestId("env-list")).toBeTruthy());
    fireEvent.click(screen.getByText("dev"));
    await waitFor(() => expect(screen.getByTestId("env-heading").textContent).toBe("dev"));

    const valueInputs = screen.getByTestId("env-values").querySelectorAll("input");
    const valueInput = valueInputs[1] as HTMLInputElement;
    fireEvent.input(valueInput, { target: { value: "bob" } });
    fireEvent.click(screen.getByTestId("save-env"));

    await waitFor(() => expect(screen.getByTestId("env-status").textContent).toContain("Saved"));
    vi.unstubAllGlobals();
  });
});
