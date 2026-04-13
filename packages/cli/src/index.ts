import { Command } from "commander";

const notImplemented = (name: string) => () => {
  console.error(`journey ${name}: not implemented`);
  process.exit(1);
};

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("journey")
    .description("Local-first API testing & orchestration tool")
    .version("0.0.0");

  program
    .command("init <dir>")
    .requiredOption("--spec <path>", "OpenAPI spec file or URL")
    .description("Scaffold a new Journey project from an OpenAPI spec")
    .action(notImplemented("init"));

  program
    .command("generate")
    .description("Regenerate typed endpoints/models from the spec")
    .action(notImplemented("generate"));

  const run = program
    .command("run [journey-file]")
    .option("--env <name>", "Environment file to use")
    .option("--all", "Run all journeys in the project")
    .description("Run a journey (or all journeys)")
    .action(notImplemented("run"));
  void run;

  const exp = program.command("export").description("Export a journey to another format");
  exp
    .command("k6 <journey-file>")
    .description("Export a journey as a k6 script")
    .action(notImplemented("export k6"));

  const envCmd = program.command("env").description("Environment management");
  envCmd.command("list").description("List available environments").action(notImplemented("env list"));

  return program;
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  buildProgram().parseAsync(process.argv);
}
