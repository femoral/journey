/**
 * @journey/codegen — reads an OpenAPI spec and writes typed endpoints + models.
 * Behavior lands in the M1 codegen issue.
 */

export interface GenerateOptions {
  specPath: string;
  outDir: string;
}

export async function generate(_opts: GenerateOptions): Promise<void> {
  throw new Error("not implemented");
}
