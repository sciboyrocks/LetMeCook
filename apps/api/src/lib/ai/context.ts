/**
 * AI Context Builder (8.2)
 *
 * Assembles a context packet from project metadata, tasks, git status, and
 * file snippets for use in AI prompts.  Token guardrails are applied so we
 * never accidentally send a multi-MB repo into the model.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { db } from '../../db/index.js';
import { config } from '../../config.js';

// Extensions allowed in file-snippet context (security + relevance allowlist)
const ALLOWED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h',
  '.json', '.yaml', '.yml', '.toml', '.env.example',
  '.md', '.mdx', '.txt', '.sh', '.sql',
  '.html', '.css', '.scss', '.svelte', '.vue',
]);

// Single-file snippet cap (chars)
const MAX_FILE_CHARS = 4_000;
// Total context cap (chars) — ~6k tokens at 4 chars/token
const MAX_CONTEXT_CHARS = 24_000;

export interface ProjectContextPacket {
  project: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    status: string;
    tags: string[];
    createdAt: string;
  };
  tasks: {
    id: string;
    title: string;
    status: string;
    priority: number;
  }[];
  gitStatus: string | null;
  recentCommits: string | null;
  fileTree: string | null;
  fileSnippets: { path: string; content: string }[];
  tokenGuard: { totalChars: number; capped: boolean };
}

type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  tags: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: number;
};

export function buildProjectContext(slugOrId: string): ProjectContextPacket | null {
  const project = db
    .prepare<[string, string], ProjectRow>(
      'SELECT id, slug, name, description, status, tags, created_at FROM projects WHERE slug = ? OR id = ? LIMIT 1'
    )
    .get(slugOrId, slugOrId);

  if (!project) return null;

  const tasks = db
    .prepare<[string], TaskRow>(
      "SELECT id, title, status, priority FROM tasks WHERE project_id = ? AND status != 'done' ORDER BY priority ASC, position ASC LIMIT 20"
    )
    .all(project.id);

  const projectDir = join(config.projectsDir, project.slug);
  const gitStatus = safeExec('git status --short', projectDir);
  const recentCommits = safeExec('git log --oneline -10', projectDir);
  const fileTree = buildFileTree(projectDir);

  const snippets: { path: string; content: string }[] = [];
  let totalChars = 0;
  let capped = false;

  if (existsSync(projectDir)) {
    for (const filePath of collectTextFiles(projectDir, projectDir)) {
      if (totalChars >= MAX_CONTEXT_CHARS) { capped = true; break; }
      const content = safeReadFile(filePath, MAX_FILE_CHARS);
      if (!content) continue;
      snippets.push({ path: filePath, content });
      totalChars += content.length;
    }
  }

  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      description: project.description,
      status: project.status ?? 'active',
      tags: parseJson<string[]>(project.tags) ?? [],
      createdAt: project.created_at,
    },
    tasks,
    gitStatus,
    recentCommits,
    fileTree,
    fileSnippets: snippets,
    tokenGuard: { totalChars, capped },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeExec(cmd: string, cwd: string): string | null {
  if (!existsSync(cwd)) return null;
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function buildFileTree(dir: string, depth = 0, maxDepth = 3): string | null {
  if (!existsSync(dir) || depth > maxDepth) return null;
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '__pycache__' && e.name !== 'dist' && e.name !== '.next')
      .slice(0, 40);

    return entries
      .map((e) => {
        const indent = '  '.repeat(depth);
        if (e.isDirectory()) {
          const sub = buildFileTree(join(dir, e.name), depth + 1, maxDepth) ?? '';
          return `${indent}${e.name}/\n${sub}`;
        }
        return `${indent}${e.name}`;
      })
      .join('\n');
  } catch {
    return null;
  }
}

function collectTextFiles(baseDir: string, dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (['node_modules', '__pycache__', 'dist', '.next', '.git', 'vendor'].includes(entry.name)) continue;

      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        collectTextFiles(baseDir, full, files);
      } else if (ALLOWED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const stat = statSync(full);
        if (stat.size < 100_000) { // skip huge files
          files.push(full.replace(baseDir + '/', ''));
        }
      }
    }
  } catch {
    // permission errors etc — skip silently
  }
  return files;
}

function safeReadFile(relPath: string, maxChars: number): string | null {
  // Already a relative path — never traverse outside projectsDir
  const normalized = relPath.replace(/\.\.\//g, '');
  try {
    const content = readFileSync(normalized, 'utf-8');
    return content.length > maxChars ? content.slice(0, maxChars) + '\n...[truncated]' : content;
  } catch {
    return null;
  }
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}
