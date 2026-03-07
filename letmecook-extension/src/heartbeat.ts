import * as vscode from 'vscode';
import { apiRequest } from './api.js';
import { getCurrentProject } from './project.js';

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // every 2 minutes
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;      // idle after 5 minutes of no activity

let lastActivity = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function recordActivity(): void {
  lastActivity = Date.now();
}

async function sendHeartbeat(): Promise<void> {
  if (Date.now() - lastActivity > IDLE_THRESHOLD_MS) return;

  const project = await getCurrentProject();
  if (!project) return;

  try {
    await apiRequest('POST', '/api/activity/heartbeat', { projectId: project.id });
  } catch {
    // Never surface heartbeat errors to the user
  }
}

export function startHeartbeat(ctx: vscode.ExtensionContext): void {
  // Mark activity on any text change or editor switch
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => recordActivity()),
    vscode.window.onDidChangeActiveTextEditor(() => recordActivity()),
    vscode.window.onDidChangeWindowState((s) => { if (s.focused) recordActivity(); }),
  );

  recordActivity(); // treat activation itself as activity

  timer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  ctx.subscriptions.push({ dispose: () => { if (timer) clearInterval(timer); } });
}
