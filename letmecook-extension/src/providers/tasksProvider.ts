import * as vscode from 'vscode';
import { apiRequest, type Task } from '../api.js';
import { getCurrentProject, getCurrentSlug } from '../project.js';
import { getBaseUrl } from '../api.js';

// ─── Tree item types ────────────────────────────────────────────────────────

export class SectionItem extends vscode.TreeItem {
  constructor(
    public readonly sectionId: 'info' | 'tasks' | 'links',
    label: string,
    iconId: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'section';
    this.iconPath = new vscode.ThemeIcon(iconId);
  }
}

export class TaskItem extends vscode.TreeItem {
  constructor(public readonly task: Task) {
    super('', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'task';

    const priorityIcon = task.priority === 1 ? '🔴 ' : task.priority === 2 ? '🟡 ' : '';
    this.label = `${priorityIcon}${task.title}`;
    this.description = task.status === 'doing' ? 'in progress' : undefined;
    this.tooltip = new vscode.MarkdownString(
      `**${task.title}**\n\nStatus: \`${task.status}\`  Priority: ${['', 'High', 'Medium', 'Low'][task.priority] ?? 'Low'}`,
    );

    const iconId =
      task.status === 'done' ? 'pass-filled' : task.status === 'doing' ? 'sync' : 'circle-outline';
    this.iconPath = new vscode.ThemeIcon(iconId);
  }
}

export class InfoItem extends vscode.TreeItem {
  constructor(label: string, description?: string, iconId?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (description !== undefined) this.description = description;
    if (iconId) this.iconPath = new vscode.ThemeIcon(iconId);
    this.contextValue = 'info';
  }
}

export class LinkItem extends vscode.TreeItem {
  constructor(label: string, iconId: string, commandId: string, args?: unknown[]) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'link';
    this.command = { command: commandId, title: label, arguments: args ?? [] };
    this.iconPath = new vscode.ThemeIcon(iconId);
  }
}

type AnyItem = SectionItem | TaskItem | InfoItem | LinkItem;

// ─── Provider ───────────────────────────────────────────────────────────────

export class LetMeCookTreeProvider implements vscode.TreeDataProvider<AnyItem> {
  private readonly _onChange = new vscode.EventEmitter<AnyItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onChange.event;

  private tasks: Task[] = [];
  private projectName: string | null = null;
  private projectStatus: string | null = null;
  private todayMinutes = 0;

  private readonly sections = {
    info: new SectionItem('info', 'Project Info', 'info'),
    tasks: new SectionItem('tasks', 'Tasks', 'checklist'),
    links: new SectionItem('links', 'Quick Links', 'link'),
  };

  async refresh(): Promise<void> {
    const slug = getCurrentSlug();

    if (!slug) {
      this.tasks = [];
      this.projectName = null;
      this.projectStatus = null;
      this.todayMinutes = 0;
      this._onChange.fire();
      return;
    }

    // Fetch project info and tasks in parallel
    const [projectResult, tasksResult, heatmapResult] = await Promise.allSettled([
      getCurrentProject(),
      apiRequest<Task[]>('GET', `/api/projects/${slug}/tasks`),
      apiRequest<{ date: string; count: number }[]>('GET', '/api/activity/heatmap?days=1'),
    ]);

    if (projectResult.status === 'fulfilled' && projectResult.value) {
      this.projectName = projectResult.value.name;
      this.projectStatus = projectResult.value.status ?? null;
    }

    if (tasksResult.status === 'fulfilled') {
      this.tasks = tasksResult.value;
    }

    if (heatmapResult.status === 'fulfilled') {
      const today = new Date().toISOString().slice(0, 10);
      this.todayMinutes = heatmapResult.value.find((r) => r.date === today)?.count ?? 0;
    }

    this._onChange.fire();
  }

  getTreeItem(element: AnyItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AnyItem): AnyItem[] {
    // Root level
    if (!element) {
      const slug = getCurrentSlug();
      if (!slug) {
        return [new InfoItem('No project detected', 'Open a project folder', 'warning')];
      }
      return [this.sections.info, this.sections.tasks, this.sections.links];
    }

    // Section: Project Info
    if (element instanceof SectionItem && element.sectionId === 'info') {
      const name = this.projectName ?? getCurrentSlug() ?? '–';
      const items: InfoItem[] = [new InfoItem('Project', name, 'folder')];

      if (this.projectStatus) {
        items.push(new InfoItem('Status', this.projectStatus, 'tag'));
      }

      const h = Math.floor(this.todayMinutes / 60);
      const m = this.todayMinutes % 60;
      const timeStr = h > 0 ? `${h}h ${m}m` : this.todayMinutes > 0 ? `${m}m` : '—';
      items.push(new InfoItem('Time today', timeStr, 'clock'));

      return items;
    }

    // Section: Tasks (non-done only)
    if (element instanceof SectionItem && element.sectionId === 'tasks') {
      const active = this.tasks.filter((t) => t.status !== 'done');
      if (active.length === 0) return [new InfoItem('No open tasks', undefined, 'check-all')];
      return active.map((t) => new TaskItem(t));
    }

    // Section: Quick Links
    if (element instanceof SectionItem && element.sectionId === 'links') {
      return [
        new LinkItem('Open Dashboard', 'dashboard', 'letmecook.openDashboard'),
        new LinkItem('Ask AI', 'sparkle', 'letmecook.askAI'),
        new LinkItem('Generate AI Commit Message', 'git-commit', 'letmecook.generateCommitMessage'),
        new LinkItem('Explain Current Error', 'bug', 'letmecook.explainError'),
        new LinkItem('Expose Port', 'plug', 'letmecook.exposePort'),
        new LinkItem('Open Tasks Panel', 'checklist', 'letmecook.openTasks'),
        new LinkItem('Commit & Push', 'cloud-upload', 'letmecook.commitPush'),
      ];
    }

    return [];
  }
}
