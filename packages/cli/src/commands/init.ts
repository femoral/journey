import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { generate } from "@journey/codegen";

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

export async function runInit(opts: InitOptions): Promise<void> {
  const projectDir = isAbsolute(opts.dir) ? opts.dir : resolve(process.cwd(), opts.dir);
  const empty = await isEmpty(projectDir);
  if (!empty && !opts.force) {
    throw new Error(
      `Target directory ${projectDir} is not empty. Pass --force to scaffold anyway.`,
    );
  }

  const specSource = isAbsolute(opts.spec) ? opts.spec : resolve(process.cwd(), opts.spec);
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

  await writeFile(
    join(projectDir, ".gitignore"),
    `.journey/cache/\nnode_modules/\n`,
    "utf8",
  );

  const generated = await generate({
    specPath: specDest,
    outDir: join(projectDir, "generated"),
  });
  console.log(
    `Initialized Journey project at ${projectDir} (${generated.operationCount} operations).`,
  );
}
