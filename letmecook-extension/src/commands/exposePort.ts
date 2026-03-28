import * as vscode from 'vscode';
import { getPortUrl } from '../api.js';

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

  // The dev URL is always available via nginx — no wait needed.
  const devUrl = getPortUrl(port);

  const choice = await vscode.window.showInformationMessage(
    `Port ${port} is accessible at ${devUrl}`,
    'Copy Link',
    'Open in Browser',
  );

  if (choice === 'Copy Link') {
    await vscode.env.clipboard.writeText(devUrl);
    vscode.window.showInformationMessage('Link copied to clipboard.');
    return;
  }

  if (choice === 'Open in Browser') {
    await vscode.env.openExternal(vscode.Uri.parse(devUrl));
    return;
  }
}
