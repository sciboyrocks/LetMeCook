import * as vscode from 'vscode';
import { getPortUrl } from '../api.js';

/**
 * Overrides VS Code's default port-forwarding behaviour for every detected
 * port:
 *   - Sets the label shown in the PORTS tab to the public dev URL
 *     (e.g. https://3000.samrudhraikote.me)
 *   - Suppresses the built-in "Open in browser" notification so users aren't
 *     directed to the /code/proxy/{port} URL.
 */
export class DevPortAttributesProvider implements vscode.PortAttributesProvider {
  providePortAttributes(
    port: number,
    _pid: number | undefined,
    _commandLine: string | undefined,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.PortAttributes> {
    const attrs = new vscode.PortAttributes(vscode.PortAutoForwardAction.Silent);
    attrs.label = getPortUrl(port);
    return attrs;
  }
}
