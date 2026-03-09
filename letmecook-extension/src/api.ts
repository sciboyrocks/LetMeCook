import * as vscode from 'vscode';

export interface Task {
  id: string;
  project_id: string;
  title: string;
  status: 'todo' | 'doing' | 'done';
  priority: number;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  color: string;
  pinned: number;
  status: string;
  last_opened_at: string | null;
}

export function getBaseUrl(): string {
  const envUrl = process.env['LETMECOOK_URL'];
  if (envUrl) return envUrl.replace(/\/$/, '');
  const cfg = vscode.workspace.getConfiguration('letmecook');
  return cfg.get<string>('apiUrl', 'http://localhost:3000');
}

export function getApiKey(): string {
  const envKey = process.env['LETMECOOK_API_KEY'];
  if (envKey) return envKey;
  const cfg = vscode.workspace.getConfiguration('letmecook');
  return cfg.get<string>('apiKey', '');
}

/** Returns the dev-forwarding domain, e.g. "dev.samrudhraikote.me" */
export function getDevDomain(): string {
  const envDomain = process.env['LETMECOOK_DEV_DOMAIN'];
  if (envDomain) return envDomain.replace(/\/$/, '');
  const cfg = vscode.workspace.getConfiguration('letmecook');
  return cfg.get<string>('devDomain', 'samrudhraikote.me');
}

/** Constructs the public URL for a dev-forwarded port. */
export function getPortUrl(port: number): string {
  return `https://${port}.${getDevDomain()}`;
}

export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const key = getApiKey();

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['X-API-Key'] = key;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = (await res.json()) as {
    ok: boolean;
    data?: T;
    error?: { code: string; message: string };
  };

  if (!json.ok) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
  return json.data as T;
}
