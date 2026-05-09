const PREFIX = "jrn:selectedEnv:";

export function loadSelectedEnv(projectDir: string): string | undefined {
  try {
    const v = localStorage.getItem(PREFIX + projectDir);
    return v ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveSelectedEnv(projectDir: string, name: string): void {
  try {
    localStorage.setItem(PREFIX + projectDir, name);
  } catch {
    /* ignore quota errors */
  }
}
