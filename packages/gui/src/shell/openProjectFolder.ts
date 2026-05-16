import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "../api/runEvents";
import { api } from "../api/client";

export type OpenProjectResult =
  | { ok: true; projectDir: string }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "invalid"; message: string };

export async function openProjectAtPath(path: string): Promise<OpenProjectResult> {
  try {
    const summary = await api.openProject(path);
    return { ok: true, projectDir: summary.projectDir };
  } catch (err) {
    return {
      ok: false,
      reason: "invalid",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function pickAndOpenProjectFolder(): Promise<OpenProjectResult> {
  if (!isTauri()) return { ok: false, reason: "cancelled" };
  const selected = await open({ directory: true, multiple: false });
  if (!selected || typeof selected !== "string") {
    return { ok: false, reason: "cancelled" };
  }
  return openProjectAtPath(selected);
}
