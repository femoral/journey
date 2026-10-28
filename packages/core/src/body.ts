import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

/**
 * Reference to a file on disk, used as a request body (raw binary upload) or
 * as a part of a `multipart()` body. Created by `fileFrom()`; the bytes are
 * read lazily at request time by the Node runner, and at k6 init time (via
 * `open(path, "b")`) by the k6 export.
 */
export interface FileRef {
  readonly __journeyFile: true;
  /** Path as written in the journey — relative paths resolve against the project root. */
  readonly path: string;
  /** MIME type sent for the file. Defaults to `application/octet-stream`. */
  readonly contentType?: string;
  /** Filename reported in a multipart part. Defaults to the path's basename. */
  readonly filename?: string;
}

/** A value accepted as one part of a `multipart()` body. */
export type MultipartValue = string | number | boolean | FileRef;

/** A `multipart/form-data` request body. Created by `multipart()`. */
export interface MultipartBody {
  readonly __journeyMultipart: true;
  readonly parts: Readonly<Record<string, MultipartValue>>;
}

/**
 * Reference a file to upload. Relative paths resolve against the **project
 * root** (the directory holding `journey.config.json`), not the journey file.
 *
 * - As a step `body`, the file is sent as the raw request body with
 *   `Content-Type: <contentType>` (default `application/octet-stream`).
 * - As a `multipart()` part, it becomes a file part with `filename` (default:
 *   the path's basename) and `contentType`.
 *
 * For `journey export k6`, the path should be a string literal so the export
 * can pre-load it with `open(path, "b")` in the k6 init context.
 *
 * @example
 * step("upload", {
 *   endpoint: endpoints.virusScan,
 *   body: () => multipart({ file: fileFrom("fixtures/sample.png", "image/png") }),
 * });
 */
export function fileFrom(path: string, contentType?: string, filename?: string): FileRef {
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError("fileFrom(path): path must be a non-empty string");
  }
  return {
    __journeyFile: true,
    path,
    ...(contentType !== undefined ? { contentType } : {}),
    ...(filename !== undefined ? { filename } : {}),
  };
}

/**
 * Build a `multipart/form-data` body. String/number/boolean values become text
 * fields; `fileFrom(...)` values become file parts. The runner (and k6) set
 * the `Content-Type: multipart/form-data; boundary=…` header — any
 * `Content-Type` supplied in the step's `headers` is dropped for multipart
 * bodies, because a hand-written one can't carry the generated boundary.
 *
 * @example
 * body: () => multipart({ description: "id card", file: fileFrom("fixtures/id.png", "image/png") })
 */
export function multipart(parts: Record<string, MultipartValue>): MultipartBody {
  if (parts === null || typeof parts !== "object") {
    throw new TypeError("multipart(parts): parts must be an object");
  }
  return { __journeyMultipart: true, parts: { ...parts } };
}

export function isFileRef(value: unknown): value is FileRef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __journeyFile?: unknown }).__journeyFile === true
  );
}

export function isMultipartBody(value: unknown): value is MultipartBody {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __journeyMultipart?: unknown }).__journeyMultipart === true
  );
}

function isBinary(value: unknown): value is ArrayBuffer | ArrayBufferView | Blob {
  return (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Blob !== "undefined" && value instanceof Blob)
  );
}

/**
 * The `Content-Type` the runner adds when the step sets none. `null` means
 * "drop any caller-set header" (multipart: the encoder supplies one with the
 * generated boundary).
 */
export function defaultContentType(body: unknown): string | null {
  if (isMultipartBody(body)) return null;
  if (isFileRef(body)) return body.contentType ?? "application/octet-stream";
  if (isBinary(body)) {
    if (typeof Blob !== "undefined" && body instanceof Blob && body.type) return body.type;
    return "application/octet-stream";
  }
  return "application/json";
}

function filePath(ref: FileRef, baseDir: string | undefined): string {
  return isAbsolute(ref.path) ? ref.path : resolve(baseDir ?? process.cwd(), ref.path);
}

async function readFileRef(ref: FileRef, baseDir: string | undefined): Promise<Uint8Array> {
  const abs = filePath(ref, baseDir);
  try {
    return await readFile(abs);
  } catch (err) {
    throw new Error(
      `fileFrom(${JSON.stringify(ref.path)}): cannot read ${abs}: ${(err as Error).message}`,
    );
  }
}

// `BodyInit` lives in lib.dom; derive the accepted body type from the platform
// fetch instead so core keeps compiling against es2023 + @types/node only.
type FetchBody = NonNullable<NonNullable<Parameters<typeof globalThis.fetch>[1]>["body"]>;

export interface EncodedBody {
  body: FetchBody;
  /** Set for multipart bodies: the `Content-Type` carrying the generated boundary. */
  contentType?: string;
}

// WHATWG form-data escaping for names / filenames in Content-Disposition.
function escapeDisposition(v: string): string {
  return v.replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/"/g, "%22");
}

/**
 * Serialise a `multipart()` body to bytes. Encoded by hand (rather than via
 * `FormData`) so it works with whichever `fetch` is active — the CLI swaps in
 * undici's own `fetch` under `--insecure`, and that copy does not recognise
 * Node's built-in `FormData`.
 */
async function encodeMultipart(
  body: MultipartBody,
  baseDir: string | undefined,
): Promise<EncodedBody> {
  const boundary = `----JourneyBoundary${randomBytes(12).toString("hex")}`;
  const chunks: Uint8Array[] = [];
  const text = (s: string) => chunks.push(Buffer.from(s, "utf8"));
  for (const [name, value] of Object.entries(body.parts)) {
    text(`--${boundary}\r\n`);
    if (isFileRef(value)) {
      const bytes = await readFileRef(value, baseDir);
      const filename = value.filename ?? basename(value.path);
      text(
        `Content-Disposition: form-data; name="${escapeDisposition(name)}"; filename="${escapeDisposition(filename)}"\r\n` +
          `Content-Type: ${value.contentType ?? "application/octet-stream"}\r\n\r\n`,
      );
      chunks.push(bytes);
      text("\r\n");
    } else {
      text(
        `Content-Disposition: form-data; name="${escapeDisposition(name)}"\r\n\r\n${String(value)}\r\n`,
      );
    }
  }
  text(`--${boundary}--\r\n`);
  return {
    body: Buffer.concat(chunks) as unknown as FetchBody,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * Encode a resolved step body for `fetch`. Strings go raw; `multipart()` →
 * multipart/form-data bytes (+ boundary Content-Type); `fileFrom()` → file
 * bytes; `Uint8Array` / `ArrayBuffer` / `Blob` → bytes; anything else is
 * `JSON.stringify`'d.
 */
export async function encodeBody(body: unknown, baseDir: string | undefined): Promise<EncodedBody> {
  if (typeof body === "string") return { body };
  if (isMultipartBody(body)) return encodeMultipart(body, baseDir);
  if (isFileRef(body)) return { body: (await readFileRef(body, baseDir)) as unknown as FetchBody };
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return { body: new Uint8Array(await body.arrayBuffer()) as unknown as FetchBody };
  }
  if (isBinary(body)) return { body: body as unknown as FetchBody };
  return { body: JSON.stringify(body) };
}

/** JSON-friendly stand-in for a non-JSON body in request logs. */
export function describeBodyForLog(body: unknown): unknown {
  const describeFile = (f: FileRef) =>
    `<file ${f.path}${f.contentType ? ` (${f.contentType})` : ""}>`;
  if (isMultipartBody(body)) {
    const parts: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.parts)) parts[k] = isFileRef(v) ? describeFile(v) : v;
    return { "<multipart>": parts };
  }
  if (isFileRef(body)) return describeFile(body);
  if (body instanceof ArrayBuffer) return `<binary ${body.byteLength} bytes>`;
  if (ArrayBuffer.isView(body)) return `<binary ${body.byteLength} bytes>`;
  if (typeof Blob !== "undefined" && body instanceof Blob) return `<binary ${body.size} bytes>`;
  return body;
}
