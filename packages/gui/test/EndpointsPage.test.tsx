import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { EndpointsPage } from "../src/pages/EndpointsPage";

const listResp = {
  baseUrl: "https://api.example.com",
  endpoints: [
    {
      name: "findPetsByStatus",
      method: "GET",
      path: "/pet/findByStatus",
      parameters: [{ name: "status", in: "query", required: true }],
    },
    {
      name: "getPet",
      method: "GET",
      path: "/pets/{id}",
      parameters: [{ name: "id", in: "path", required: true }],
    },
  ],
};

const proxyResp = {
  status: 200,
  headers: {},
  body: [{ id: "1" }],
  durationMs: 4,
};

describe("EndpointsPage", () => {
  it("appends query params to the URL when sending a request", async () => {
    let captured: { url?: string } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.endsWith("/api/endpoints")) {
          return new Response(JSON.stringify(listResp), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/api/request")) {
          captured = JSON.parse(init!.body as string) as { url?: string };
          return new Response(JSON.stringify(proxyResp), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    render(() => <EndpointsPage />);
    const row = await waitFor(() => screen.getByTestId("endpoint-row-findPetsByStatus"));
    fireEvent.click(row);

    const statusInput = await waitFor(() => screen.getByTestId("query-status"));
    fireEvent.input(statusInput, { target: { value: "available" } });
    fireEvent.click(screen.getByTestId("send-button"));

    await waitFor(() => expect(screen.getByTestId("response-status").textContent).toBe("200"));
    expect(captured.url).toBe("https://api.example.com/pet/findByStatus?status=available");
    vi.unstubAllGlobals();
  });
});
