import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileFrom, multipart } from "../src/body.js";
import { buildRequest, execute } from "../src/http.js";
import {
  clearRegistry,
  journey,
  runAllRegistered,
  step,
  type JourneyResult,
} from "../src/runtime.js";

interface Received {
  method: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

let server: Server;
let baseUrl: string;
let received: Received[] = [];
let dir: string;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x10, 0x80]);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "journey-body-"));
  await writeFile(join(dir, "img.png"), PNG);
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({ method: req.method!, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "string" || !addr) throw new Error("bad address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

async function run(body: unknown, headers?: Record<string, string>): Promise<Received> {
  received = [];
  const ctx = { baseUrl, baseDir: dir };
  const req = buildRequest(
    { endpoint: { method: "POST", path: "/upload" }, body, ...(headers ? { headers } : {}) },
    ctx,
  );
  const res = await execute(req, ctx);
  expect(res.status).toBe(200);
  return received[0]!;
}

describe("fileFrom / multipart bodies", () => {
  it("sends a multipart body with a binary file part and text fields", async () => {
    const got = await run(
      multipart({ kind: "id", n: 3, file: fileFrom("img.png", "image/png") }),
      // A hand-written multipart Content-Type can't carry the boundary — it is dropped.
      { "Content-Type": "multipart/form-data" },
    );
    const ct = got.headers["content-type"]!;
    expect(ct).toMatch(/^multipart\/form-data; boundary=/);
    const form = await new Response(got.body, { headers: { "content-type": ct } }).formData();
    expect(form.get("kind")).toBe("id");
    expect(form.get("n")).toBe("3");
    const file = form.get("file") as File;
    expect({ name: file.name, type: file.type }).toEqual({ name: "img.png", type: "image/png" });
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("sends a fileFrom body as raw bytes with its content type", async () => {
    const got = await run(fileFrom("img.png", "image/png"));
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.body.equals(PNG)).toBe(true);
  });

  it("sends Uint8Array bodies raw as application/octet-stream", async () => {
    const got = await run(new Uint8Array([1, 2, 3, 250]));
    expect(got.headers["content-type"]).toBe("application/octet-stream");
    expect([...got.body]).toEqual([1, 2, 3, 250]);
  });

  it("keeps an explicit Content-Type for raw binary bodies", async () => {
    const got = await run(fileFrom(join(dir, "img.png")), { "Content-Type": "application/x-foo" });
    expect(got.headers["content-type"]).toBe("application/x-foo");
  });

  it("fails the step with the resolved path when the file is missing", async () => {
    clearRegistry();
    journey("missing file", () => {
      step("upload", {
        endpoint: { method: "POST", path: "/upload" },
        body: () => multipart({ file: fileFrom("nope.png") }),
      });
    });
    const [result] = (await runAllRegistered({ baseUrl, baseDir: dir })) as JourneyResult[];
    expect(result!.ok).toBe(false);
    expect(result!.steps[0]!.error).toContain('fileFrom("nope.png"): cannot read');
  });
});
