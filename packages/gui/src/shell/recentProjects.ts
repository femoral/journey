export type RecentProject = {
  name: string;
  path: string;
};

const KEY = "jrn:recentProjects";
const MAX = 8;

export function loadRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is RecentProject =>
        p && typeof p === "object" && typeof p.name === "string" && typeof p.path === "string",
    );
  } catch {
    return [];
  }
}

export function saveRecentProjects(list: RecentProject[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* ignore quota errors */
  }
}

export function upsertRecentProject(
  list: RecentProject[],
  project: RecentProject,
): RecentProject[] {
  const without = list.filter((p) => p.path !== project.path);
  return [project, ...without].slice(0, MAX);
}
