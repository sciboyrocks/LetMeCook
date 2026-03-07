import * as vscode from 'vscode';

export async function openDashboard(): Promise<void> {
  // LETMECOOK_DASHBOARD_URL is the browser-facing URL (e.g. http://localhost:3001)
  // LETMECOOK_URL is the API URL reachable from the extension host (container-internal)
  const dashUrl = process.env['LETMECOOK_DASHBOARD_URL'] || 'http://localhost:3001';
  const url = `${dashUrl.replace(/\/$/, '')}/dashboard`;
  await vscode.env.openExternal(vscode.Uri.parse(url));
}
