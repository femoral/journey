import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import yaml from "js-yaml";
import type { OpenApiDocument } from "./types.js";

export async function loadSpec(specPath: string): Promise<OpenApiDocument> {
  const raw = await readFile(specPath, "utf8");
  const ext = extname(specPath).toLowerCase();
  const doc = ext === ".json" ? (JSON.parse(raw) as unknown) : (yaml.load(raw) as unknown);
  if (!doc || typeof doc !== "object") {
    throw new Error(`Spec at ${specPath} did not parse to an object`);
  }
  const typed = doc as OpenApiDocument;
  if (!typed.openapi && !typed.swagger) {
    throw new Error(`Spec at ${specPath} is missing "openapi"/"swagger" field`);
  }
  return typed;
}
