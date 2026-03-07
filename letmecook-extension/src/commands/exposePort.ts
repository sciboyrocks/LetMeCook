import * as vscode from 'vscode';
import { apiRequest } from '../api.js';
import { getCurrentProject } from '../project.js';

interface TunnelData {
  id: string;
  url: string | null;
  port: number;
  status: string;
}

export async function exposePort(): Promise<void> {
  const portInput = await vscode.window.showInputBox({
    prompt: 'Which port do you want to expose?',
    placeHolder: '3000',
    validateInput(val) {
      const n = parseInt(val, 10);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        return 'Enter a valid port number (1–65535)';
      }
      return undefined;
    },
  });

  if (!portInput) return;
  const port = parseInt(portInput, 10);

  // Resolve project ID if available (optional field)
  let projectId: string | undefined;
  try {
    const project = await getCurrentProject();
    projectId = project?.id;
  } catch {
    // Non-fatal — projectId is optional
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Starting cloudflared tunnel on port ${port}…`,
      cancellable: false,
    },
    async () => {
      try {
        let tunnel = await apiRequest<TunnelData>('POST', '/api/tunnels/expose', {
          port,
          ...(projectId ? { projectId } : {}),
        });

        // Poll for the URL if not yet available (cloudflared can take a few seconds)
        if (!tunnel.url && tunnel.id) {
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            try {
              const active = await apiRequest<TunnelData[]>('GET', '/api/tunnels/active');
              const updated = active.find((t) => t.id === tunnel.id);
              if (updated?.url) {
                tunnel = updated;
                break;
              }
            } catch {
              // keep polling
            }
          }
        }

        const url = tunnel.url ?? '(URL unavailable — check Monitor page)';
        const choice = await vscode.window.showInformationMessage(
          `Tunnel active: ${url}`,
          ...(tunnel.url ? ['Copy Link', 'Open in Browser'] as const : []),
        );

        if (choice === 'Copy Link' && tunnel.url) {
          await vscode.env.clipboard.writeText(tunnel.url);
          vscode.window.showInformationMessage('Link copied to clipboard.');
        } else if (choice === 'Open in Browser' && tunnel.url) {
          await vscode.env.openExternal(vscode.Uri.parse(tunnel.url));
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to expose port: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}
