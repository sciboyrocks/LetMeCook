import * as vscode from 'vscode';
import { apiRequest } from '../api.js';

interface CloneJobData {
  jobId: string;
  status: string;
}

export async function cloneRepo(): Promise<void> {
  const repoUrl = await vscode.window.showInputBox({
    prompt: 'Enter the Git repository URL to clone',
    placeHolder: 'https://github.com/user/repo.git',
    validateInput(val) {
      const trimmed = val.trim();
      if (!trimmed) return 'URL is required';
      if (!/^https?:\/\//i.test(trimmed) && !/^git@/i.test(trimmed)) {
        return 'Please enter a valid https:// or git@ URL';
      }
      // Block local/file URLs (SSRF guard)
      if (/^(file:|https?:\/\/localhost|https?:\/\/127\.|https?:\/\/0\.0\.0\.0)/i.test(trimmed)) {
        return 'Local or loopback URLs are not allowed';
      }
      return undefined;
    },
  });

  if (!repoUrl) return;

  const name = await vscode.window.showInputBox({
    prompt: 'Project name (leave blank to derive from the repo name)',
    placeHolder: 'my-project',
  });

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Cloning repository…', cancellable: false },
    async () => {
      try {
        const result = await apiRequest<CloneJobData>('POST', '/api/projects/clone', {
          repoUrl: repoUrl.trim(),
          ...(name?.trim() ? { name: name.trim() } : {}),
        });
        vscode.window.showInformationMessage(
          `Clone job started (id: ${result.jobId}). Check the dashboard for live progress.`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Clone failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}
