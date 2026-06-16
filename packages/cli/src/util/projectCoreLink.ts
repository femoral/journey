import { existsSync, readFileSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Node's ESM resolves bare specifiers by walking up from the importing
// file looking for `node_modules/<pkg>`. A user's `.journey.ts` doing
// `import "@usejourney/core"` therefore needs the package present somewhere
// in the project's ancestor chain. Rather than asking users to `pnpm
// install` inside every project (the CLI already ships @usejourney/core as
// a sibling dep), we plant a symlink at `<projectDir>/node_modules/@usejourney/core`
// pointing at the CLI's bundled copy.
function locateJourneyCoreDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 50; depth++) {
    const pkgJson = join(dir, "node_modules", "@usejourney", "core", "package.json");
    if (existsSync(pkgJson)) {
      JSON.parse(readFileSync(pkgJson, "utf8"));
      return dirname(pkgJson);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("ensureProjectCoreLink: could not locate the CLI-bundled @usejourney/core");
}

let cachedCoreDir: string | undefined;

export async function ensureProjectCoreLink(projectDir: string): Promise<void> {
  const link = join(projectDir, "node_modules", "@usejourney", "core");
  if (existsSync(link)) return;
  if (!cachedCoreDir) cachedCoreDir = locateJourneyCoreDir();
  await mkdir(dirname(link), { recursive: true });
  // `junction` on Windows behaves like a directory link without requiring
  // elevated privileges; ignored on POSIX where `dir` is the right type.
  const type = process.platform === "win32" ? "junction" : "dir";
  await symlink(cachedCoreDir, link, type);
}
