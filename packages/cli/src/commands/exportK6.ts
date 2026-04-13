import { exportToK6 } from "@journey/k6-adapter";

export interface ExportK6CliOptions {
  journeyFile: string;
  out?: string;
}

export async function runExportK6(opts: ExportK6CliOptions): Promise<void> {
  const result = await exportToK6({
    journeyFile: opts.journeyFile,
    ...(opts.out !== undefined ? { outFile: opts.out } : {}),
  });
  console.log(`Wrote k6 script → ${result.outFile}`);
}
