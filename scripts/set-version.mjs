#!/usr/bin/env node
// Lockstep version bump across the publishable packages.
// Usage: pnpm version:set <MAJOR.MINOR.PATCH>
//
// Journey ships five packages to npm as a single lockstep version
// (core, codegen, cli, k6-adapter, postman-adapter). The private
// packages (gui, root journey, docs) are never published, so they are
// left untouched.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PACKAGES = ["core", "codegen", "cli", "k6-adapter", "postman-adapter"];

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: pnpm version:set <MAJOR.MINOR.PATCH>");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const pkg of PACKAGES) {
  const file = join(root, "packages", pkg, "package.json");
  const json = JSON.parse(readFileSync(file, "utf8"));
  const prev = json.version;
  json.version = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`  ${json.name}: ${prev} -> ${version}`);
}
console.log(`\nAll ${PACKAGES.length} publishable packages set to ${version}.`);
