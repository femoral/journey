import { access, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generate, loadSpec } from "@journey/codegen";

export interface InitOptions {
  dir: string;
  spec: string;
  force?: boolean;
}

async function isEmpty(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length === 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
}

async function readCliVersion(): Promise<string> {
  // Resolves to packages/cli/package.json in dev (src/) and to the published
  // package.json sibling of dist/index.js when installed.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../../package.json"), join(here, "../package.json")];
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(await readFile(candidate, "utf8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `Could not locate @journey/cli package.json (tried ${candidates.join(", ")}). ` +
      `Refusing to scaffold a project.json with an unusable version range.`,
  );
}

export async function runInit(opts: InitOptions): Promise<void> {
  const projectDir = isAbsolute(opts.dir) ? opts.dir : resolve(process.cwd(), opts.dir);
  const empty = await isEmpty(projectDir);
  if (!empty && !opts.force) {
    throw new Error(
      `Target directory ${projectDir} is not empty. Pass --force to scaffold anyway.`,
    );
  }

  const specSource = isAbsolute(opts.spec) ? opts.spec : resolve(process.cwd(), opts.spec);
  // Validate the spec BEFORE we mkdir / copy anything, so an invalid spec
  // leaves the filesystem untouched. loadSpec throws on missing
  // openapi/swagger root field or non-object YAML/JSON.
  try {
    await access(specSource);
  } catch {
    throw new Error(`Spec file not found: ${specSource}`);
  }
  await loadSpec(specSource);

  const specDestName = basename(specSource);
  const specDest = join(projectDir, specDestName);

  await mkdir(projectDir, { recursive: true });
  await mkdir(join(projectDir, "generated"), { recursive: true });
  await mkdir(join(projectDir, "journeys"), { recursive: true });
  await mkdir(join(projectDir, "environments"), { recursive: true });
  await mkdir(join(projectDir, ".journey", "cache"), { recursive: true });

  await copyFile(specSource, specDest);

  const config = {
    name: basename(projectDir),
    spec: specDestName,
    generatedDir: "generated",
    journeysDir: "journeys",
    environmentsDir: "environments",
  };
  await writeFile(
    join(projectDir, "journey.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );

  await writeFile(join(projectDir, ".gitignore"), `.journey/cache/\nnode_modules/\n`, "utf8");

  const cliVersion = await readCliVersion();
  const versionRange = `^${cliVersion}`;
  const pkg = {
    name: basename(projectDir),
    private: true,
    type: "module",
    dependencies: {
      "@journey/core": versionRange,
    },
    devDependencies: {
      "@journey/cli": versionRange,
    },
  };
  await writeFile(join(projectDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

  const generated = await generate({
    specPath: specDest,
    outDir: join(projectDir, "generated"),
  });
  console.log(
    `Initialized Journey project at ${projectDir} (${generated.operationCount} operations).`,
  );
  if (generated.operationCount === 0) {
    console.warn(
      "journey: warning — spec parsed but contained 0 operations. The generated endpoints.ts will be empty.",
    );
  }
  console.log("Next: cd into the project and run `pnpm install` (or `npm install`).");
}
