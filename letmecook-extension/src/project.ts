import * as vscode from 'vscode';
import { apiRequest, type Project } from './api.js';

let cachedProject: Project | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 60_000;

/** Returns the last path segment of the first workspace folder (the project slug). */
export function getCurrentSlug(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const parts = folders[0].uri.fsPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

/**
 * Fetches the current project from the API by slug.
 * Results are cached for 60 seconds.
 */
export async function getCurrentProject(): Promise<Project | null> {
  const slug = getCurrentSlug();
  if (!slug) return null;

  if (cachedProject?.slug === slug && Date.now() - cacheTs < CACHE_TTL_MS) {
    return cachedProject;
  }

  try {
    const projects = await apiRequest<Project[]>('GET', '/api/projects');
    cachedProject = projects.find((p) => p.slug === slug) ?? null;
    cacheTs = Date.now();
    return cachedProject;
  } catch {
    return cachedProject; // return stale on error
  }
}

export function clearProjectCache(): void {
  cachedProject = null;
  cacheTs = 0;
}
