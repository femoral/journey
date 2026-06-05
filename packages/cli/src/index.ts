import { resolve as resolvePath } from "node:path";
import { Command } from "commander";
import type { CacheMode } from "@journey/core";
import { runEnvList } from "./commands/envList.js";
import { runExportK6 } from "./commands/exportK6.js";
import { runExportPostman } from "./commands/exportPostman.js";
import { runGenerate } from "./commands/generate.js";
import { runInit } from "./commands/init.js";
import { runCommand } from "./commands/run.js";
import { runServe } from "./commands/serve.js";

function parseCacheMode(value: string): CacheMode {
  if (value === "off" || value === "run" || value === "process" || value === "disk") {
    return value;
  }
  throw new Error(`--cache must be one of off|run|process|disk (got "${value}")`);
}

async function handle(fn: () => Promise<number | void>): Promise<never> {
  try {
    const code = (await fn()) ?? 0;
    process.exit(code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`journey: ${msg}`);
    process.exit(1);
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("journey")
    .description("Local-first API testing & orchestration tool")
    .version("0.0.0");

  program
    .command("init <dir>")
    .requiredOption("--spec <path>", "OpenAPI spec file")
    .option("--force", "Scaffold into a non-empty directory", false)
    .description("Scaffold a new Journey project from an OpenAPI spec")
    .action((dir: string, options: { spec: string; force?: boolean }) =>
      handle(() =>
        runInit({
          dir,
          spec: options.spec,
          ...(options.force !== undefined ? { force: options.force } : {}),
        }),
      ),
    );

  program
    .command("generate")
    .description("Regenerate typed endpoints/models from the spec")
    .action(() => handle(() => runGenerate(process.cwd())));

  program
    .command("run [journey-file...]")
    .option("--env <name>", "Environment file to use")
    .option("--all", "Run all journeys in the project", false)
    .option("--debug", "Log every request and response to stderr", false)
    .option("--watch", "Rerun on file changes", false)
    .option(
      "--insecure",
      "Disable TLS certificate verification (for self-signed / corporate CAs)",
      false,
    )
    .option(
      "--cache <mode>",
      "Sub-journey output cache: off|run|process|disk",
      parseCacheMode,
      "process",
    )
    .option("--cache-ttl <ms>", "Default sub-journey cache TTL in ms", (v) => parseInt(v, 10))
    .description("Run one or more journeys (or --all)")
    .action(
      (
        files: string[],
        options: {
          env?: string;
          all?: boolean;
          debug?: boolean;
          watch?: boolean;
          insecure?: boolean;
          cache?: CacheMode;
          cacheTtl?: number;
        },
      ) =>
        handle(() =>
          runCommand({
            projectDir: process.cwd(),
            files,
            ...(options.all !== undefined ? { all: options.all } : {}),
            ...(options.env !== undefined ? { env: options.env } : {}),
            ...(options.debug !== undefined ? { debug: options.debug } : {}),
            ...(options.watch !== undefined ? { watch: options.watch } : {}),
            ...(options.insecure !== undefined ? { insecure: options.insecure } : {}),
            ...(options.cache !== undefined ? { cache: options.cache } : {}),
            ...(options.cacheTtl !== undefined ? { cacheTtlMs: options.cacheTtl } : {}),
          }),
        ),
    );

  const exp = program.command("export").description("Export a journey to another format");
  exp
    .command("k6 <path>")
    .option("--out <path>", "Output file (single-file mode only)")
    .option(
      "--out-dir <path>",
      "Output directory (used in directory mode; falls back to writing next to each source)",
    )
    .option(
      "--tag <tag>",
      "Only export journeys with this tag (repeatable, AND across repeats)",
      (v: string, prev: string[] = []) => [...prev, v],
      [] as string[],
    )
    .description("Export one or more journeys as k6 scripts (path may be a file or directory)")
    .action((path: string, options: { out?: string; outDir?: string; tag: string[] }) =>
      handle(() =>
        runExportK6({
          path,
          ...(options.out !== undefined ? { out: options.out } : {}),
          ...(options.outDir !== undefined ? { outDir: options.outDir } : {}),
          tags: options.tag,
        }),
      ),
    );

  exp
    .command("postman <path>")
    .option("--out <path>", "Output file (single-file mode only)")
    .option(
      "--out-dir <path>",
      "Output directory (used in directory mode; falls back to writing next to each source)",
    )
    .option(
      "--tag <tag>",
      "Only export journeys with this tag (repeatable, AND across repeats)",
      (v: string, prev: string[] = []) => [...prev, v],
      [] as string[],
    )
    .option("--name <name>", "Override the collection name")
    .option("--env <name>", "Export named environment as a Postman environment file")
    .option("--all-envs", "Export all environments as Postman environment files")
    .option("--bundle", "Aggregate every matching journey (across all files) into one collection")
    .description(
      "Export one or more journeys as a Postman Collection v2.1.0 (path may be a file or directory)",
    )
    .action(
      (
        path: string,
        options: {
          out?: string;
          outDir?: string;
          tag: string[];
          name?: string;
          env?: string;
          allEnvs?: boolean;
          bundle?: boolean;
        },
      ) =>
        handle(() =>
          runExportPostman({
            path,
            ...(options.out !== undefined ? { out: options.out } : {}),
            ...(options.outDir !== undefined ? { outDir: options.outDir } : {}),
            ...(options.name !== undefined ? { name: options.name } : {}),
            ...(options.env !== undefined ? { env: options.env } : {}),
            ...(options.allEnvs !== undefined ? { allEnvs: options.allEnvs } : {}),
            ...(options.bundle !== undefined ? { bundle: options.bundle } : {}),
            tags: options.tag,
          }),
        ),
    );

  program
    .command("serve")
    .option("--port <n>", "Port (default 5181)", (v) => parseInt(v, 10))
    .option("--host <host>", "Host (default 127.0.0.1)")
    .option("--project <dir>", "Project directory (default: cwd)")
    .option("--debug", "Log every request/response while running journeys", false)
    .option(
      "--insecure",
      "Disable TLS certificate verification for journey runs triggered via the API",
      false,
    )
    .option(
      "--cache <mode>",
      "Sub-journey output cache: off|run|process|disk",
      parseCacheMode,
      "process",
    )
    .option("--cache-ttl <ms>", "Default sub-journey cache TTL in ms", (v) => parseInt(v, 10))
    .description("Run the GUI backend API for the current project")
    .action(
      (options: {
        port?: number;
        host?: string;
        project?: string;
        debug?: boolean;
        insecure?: boolean;
        cache?: CacheMode;
        cacheTtl?: number;
      }) => {
        const projectDir = options.project
          ? resolvePath(process.cwd(), options.project)
          : process.cwd();
        return handle(() =>
          runServe({
            projectDir,
            ...(options.port !== undefined ? { port: options.port } : {}),
            ...(options.host !== undefined ? { host: options.host } : {}),
            ...(options.debug !== undefined ? { debug: options.debug } : {}),
            ...(options.insecure !== undefined ? { insecure: options.insecure } : {}),
            ...(options.cache !== undefined ? { cache: options.cache } : {}),
            ...(options.cacheTtl !== undefined ? { cacheTtlMs: options.cacheTtl } : {}),
          }),
        );
      },
    );

  const envCmd = program.command("env").description("Environment management");
  envCmd
    .command("list")
    .description("List available environments")
    .action(() => handle(() => runEnvList(process.cwd())));

  return program;
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  buildProgram().parseAsync(process.argv);
}
