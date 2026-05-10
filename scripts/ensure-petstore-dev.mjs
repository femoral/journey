#!/usr/bin/env node
// Ensures examples/petstore.dev/ exists as a scratch copy of the canonical petstore.
// Default: idempotent — does nothing if the scratch folder already exists.
// --force: wipe and rebuild from canonical.
//
// petstore.dev is excluded from pnpm-workspace.yaml so it does not pollute the
// lockfile. To wire up the @journey/* deps the journey files import, we copy
// the canonical petstore's node_modules verbatim — pnpm's symlinks are relative
// (e.g. ../../../packages/core) and resolve correctly from the sibling folder.
//
// Prereq: run `pnpm install` at the repo root before first `dev:reset` so the
// canonical examples/petstore/node_modules tree exists.

import { existsSync, rmSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const src = path.join(root, "examples", "petstore");
const dest = path.join(root, "examples", "petstore.dev");

const force = process.argv.includes("--force");

if (existsSync(dest) && !force) {
  process.exit(0);
}

if (!existsSync(path.join(src, "node_modules", "@journey", "core"))) {
  console.error(
    "[ensure-petstore-dev] examples/petstore/node_modules is missing @journey/core. Run `pnpm install` at the repo root first.",
  );
  process.exit(1);
}

if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}

const skip = new Set([".journey"]);
cpSync(src, dest, {
  recursive: true,
  verbatimSymlinks: true,
  filter: (p) => !skip.has(path.basename(p)),
});

const pkgPath = path.join(dest, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.name = "@journey-examples/petstore-dev";
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(
  `[${force ? "reset" : "ensure"}] ${path.relative(root, dest)} ${force ? "rebuilt" : "created"} from ${path.relative(root, src)}`,
);
