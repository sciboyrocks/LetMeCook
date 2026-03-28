import * as vscode from 'vscode';
import { openDashboard } from './commands/dashboard.js';
import { cloneRepo } from './commands/clone.js';
import { openTasksPanel } from './providers/tasksWebviewPanel.js';
import { LetMeCookTreeProvider, TaskItem } from './providers/tasksProvider.js';
import { startHeartbeat } from './heartbeat.js';
import { apiRequest, type Task } from './api.js';

export function activate(ctx: vscode.ExtensionContext): void {
  // ── Activity bar tree view ──────────────────────────────────────────────
  const treeProvider = new LetMeCookTreeProvider();
  const treeView = vscode.window.createTreeView('letmecookPanel', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });
  ctx.subscriptions.push(treeView);

  // Auto-refresh when workspace folder changes
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => treeProvider.refresh()),
  );

  // Initial refresh
  treeProvider.refresh();

  // ── Status bar items ────────────────────────────────────────────────────

  // 🏠 Dashboard
  const dashboardItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  dashboardItem.text = '$(home) Dashboard';
  dashboardItem.tooltip = 'LetMeCook: Open Dashboard';
  dashboardItem.command = 'letmecook.openDashboard';
  dashboardItem.show();
  ctx.subscriptions.push(dashboardItem);

  // 📋 Tasks
  const tasksItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99,
  );
  tasksItem.text = '$(tasklist) Tasks';
  tasksItem.tooltip = 'LetMeCook: Open Tasks panel';
  tasksItem.command = 'letmecook.openTasks';
  tasksItem.show();
  ctx.subscriptions.push(tasksItem);

  // ── Command registrations ───────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand('letmecook.openDashboard', openDashboard),

    vscode.commands.registerCommand('letmecook.openTasks', () => openTasksPanel(ctx)),

    vscode.commands.registerCommand('letmecook.cloneRepo', cloneRepo),

    vscode.commands.registerCommand('letmecook.refreshTasks', () => treeProvider.refresh()),

    vscode.commands.registerCommand('letmecook.addTask', async () => {
      const title = await vscode.window.showInputBox({
        prompt: 'New task title',
        placeHolder: 'Fix the thing…',
      });
      if (!title?.trim()) return;

      const { getCurrentSlug } = await import('./project.js');
      const slug = getCurrentSlug();
      if (!slug) {
        vscode.window.showWarningMessage('No LetMeCook project detected in this workspace.');
        return;
      }

      try {
        await apiRequest<Task>('POST', `/api/projects/${slug}/tasks`, { title: title.trim() });
        await treeProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to add task: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand('letmecook.completeTask', async (itemOrId: TaskItem | string) => {
      const id = itemOrId instanceof TaskItem ? itemOrId.task.id : itemOrId;
      try {
        await apiRequest('PATCH', `/api/tasks/${id}`, { status: 'done' });
        await treeProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to complete task: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

  // ── Heartbeat ────────────────────────────────────────────────────────────
  startHeartbeat(ctx);
}

export function deactivate(): void {
  // Resources are disposed via ctx.subscriptions
}
