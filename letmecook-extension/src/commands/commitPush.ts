import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execFile);

export async function commitPush(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage('No workspace folder open.');
    return;
  }

  const cwd = folders[0].uri.fsPath;

  // Check for any changes (staged or unstaged)
  let porcelain: string;
  try {
    const { stdout } = await execAsync('git', ['status', '--porcelain'], { cwd });
    porcelain = stdout.trim();
  } catch (err) {
    vscode.window.showErrorMessage(
      `Git error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  if (!porcelain) {
    vscode.window.showInformationMessage('Nothing to commit — working tree is clean.');
    return;
  }

  const ts = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const commitMsg = `wip: ${ts}`;

  const confirm = await vscode.window.showWarningMessage(
    `Commit all changes as "${commitMsg}" and push?`,
    { modal: true },
    'Confirm',
  );
  if (confirm !== 'Confirm') return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Committing and pushing…', cancellable: false },
    async (progress) => {
      try {
        progress.report({ message: 'git add -A' });
        await execAsync('git', ['add', '-A'], { cwd });

        progress.report({ message: 'git commit' });
        await execAsync('git', ['commit', '-m', commitMsg], { cwd });

        progress.report({ message: 'git push' });
        await execAsync('git', ['push'], { cwd });

        vscode.window.showInformationMessage('✅ Committed and pushed successfully.');
      } catch (err) {
        vscode.window.showErrorMessage(
          `Git operation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}
