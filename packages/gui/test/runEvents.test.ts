import { afterEach, describe, expect, it, vi } from "vitest";
import { SseRunEventSource, TauriRunEventSource, type RunEvent } from "../src/api/runEvents";

function sseFrames(events: RunEvent[]): string {
  return events.map((e) => `event: ${e.kind}\ndata: ${JSON.stringify(e)}`).join("\n\n") + "\n\n";
}

function makeStreamResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("SseRunEventSource", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("replays events in order and stops after run:end", async () => {
    const events: RunEvent[] = [
      { kind: "run:start", runId: "r1", journeyNames: ["j"] },
      {
        kind: "step:start",
        runId: "r1",
        journeyIdx: 0,
        journeyName: "j",
        stepIdx: 0,
        name: "one",
      },
      {
        kind: "step:end",
        runId: "r1",
        journeyIdx: 0,
        stepIdx: 0,
        ok: true,
        durationMs: 1,
      },
      {
        kind: "run:end",
        runId: "r1",
        ok: true,
        durationMs: 2,
        results: [{ name: "j", ok: true }],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeStreamResponse(sseFrames(events))),
    );
    const seen: RunEvent[] = [];
    const source = new SseRunEventSource();
    const sub = source.subscribe("r1", (e) => seen.push(e));
    // Let the reader loop drain.
    await new Promise((r) => setTimeout(r, 20));
    sub.close();
    expect(seen.map((e) => e.kind)).toEqual(["run:start", "step:start", "step:end", "run:end"]);
    expect(seen.every((e) => e.runId === "r1")).toBe(true);
  });

  it("emits an error event when the HTTP status is non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    const seen: RunEvent[] = [];
    new SseRunEventSource().subscribe("r1", (e) => seen.push(e));
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe("error");
  });

  it("close() aborts the in-flight request", async () => {
    const aborts: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.signal) aborts.push(init.signal);
        // Never resolve; simulates a long-running stream.
        return await new Promise<Response>(() => {});
      }),
    );
    const sub = new SseRunEventSource().subscribe("r1", () => {});
    await new Promise((r) => setTimeout(r, 5));
    sub.close();
    expect(aborts[0]?.aborted).toBe(true);
  });
});

describe("TauriRunEventSource", () => {
  it("delegates subscribe to the fallback source", () => {
    const fake = {
      subscribe: vi.fn(() => ({ close: vi.fn() })),
    };
    new TauriRunEventSource(fake).subscribe("r1", () => {});
    expect(fake.subscribe).toHaveBeenCalledWith("r1", expect.any(Function));
  });
});
