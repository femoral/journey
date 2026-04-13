import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { EndpointsPage } from "../src/pages/EndpointsPage";

const listResp = {
  baseUrl: "https://api.example.com",
  endpoints: [
    { name: "listPets", method: "GET", path: "/pets" },
    { name: "getPet", method: "GET", path: "/pets/{id}" },
  ],
};

const proxyResp = {
  status: 200,
  headers: {},
  body: [{ id: "1" }],
  durationMs: 4,
};

function stub(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: Request | string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/api/endpoints")) {
      return new Response(JSON.stringify(listResp), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/api/request")) {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      expect(body.url).toBe("https://api.example.com/pets");
      expect(body.method).toBe("GET");
      return new Response(JSON.stringify(proxyResp), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected ${url}`);
  });
}

describe("EndpointsPage", () => {
  it("lists endpoints and sends a request against the selected one", async () => {
    vi.stubGlobal("fetch", stub());
    render(() => <EndpointsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("endpoint-list")).toBeTruthy();
    });
    fireEvent.click(screen.getAllByRole("button")[0]!);
    fireEvent.click(screen.getByTestId("send-button"));
    await waitFor(() => {
      expect(screen.getByTestId("response-status").textContent).toBe("200");
    });
    expect(screen.getByTestId("response-body").textContent).toContain('"id": "1"');
    vi.unstubAllGlobals();
  });
});
