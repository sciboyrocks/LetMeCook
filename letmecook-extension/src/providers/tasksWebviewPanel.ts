import * as vscode from 'vscode';
import { apiRequest, type Task } from '../api.js';
import { getCurrentSlug } from '../project.js';
import { randomBytes } from 'node:crypto';

let panel: vscode.WebviewPanel | undefined;

// ─── Public entry point ──────────────────────────────────────────────────────

export async function openTasksPanel(ctx: vscode.ExtensionContext): Promise<void> {
  if (panel) {
    panel.reveal(vscode.ViewColumn.One);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'letmecookTasks',
    'LetMeCook — Tasks',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  panel.onDidDispose(() => { panel = undefined; }, null, ctx.subscriptions);

  await refreshPanel();

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage(
    async (msg: WebviewMessage) => {
      switch (msg.type) {
        case 'TOGGLE_TASK':
          await toggleTask(msg.id, msg.currentStatus);
          break;
        case 'ADD_TASK':
          await addTask(msg.title);
          break;
        case 'DELETE_TASK':
          await deleteTask(msg.id);
          break;
        case 'REFRESH':
          await refreshPanel();
          break;
      }
    },
    null,
    ctx.subscriptions,
  );
}

// ─── Internal helpers ────────────────────────────────────────────────────────

type WebviewMessage =
  | { type: 'TOGGLE_TASK'; id: string; currentStatus: Task['status'] }
  | { type: 'ADD_TASK'; title: string }
  | { type: 'DELETE_TASK'; id: string }
  | { type: 'REFRESH' };

async function refreshPanel(): Promise<void> {
  if (!panel) return;
  const slug = getCurrentSlug();

  let tasks: Task[] = [];
  let error: string | null = null;

  if (!slug) {
    error = 'No LetMeCook project detected. Open a project folder.';
  } else {
    try {
      tasks = await apiRequest<Task[]>('GET', `/api/projects/${slug}/tasks`);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load tasks';
    }
  }

  panel.webview.html = buildHtml(tasks, slug ?? '', error);
}

async function toggleTask(id: string, currentStatus: Task['status']): Promise<void> {
  const nextStatus: Task['status'] =
    currentStatus === 'todo' ? 'doing' : currentStatus === 'doing' ? 'done' : 'todo';
  try {
    await apiRequest('PATCH', `/api/tasks/${id}`, { status: nextStatus });
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to update task: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await refreshPanel();
}

async function addTask(title: string): Promise<void> {
  const slug = getCurrentSlug();
  if (!slug) return;
  try {
    await apiRequest('POST', `/api/projects/${slug}/tasks`, { title });
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to add task: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await refreshPanel();
}

async function deleteTask(id: string): Promise<void> {
  try {
    await apiRequest('DELETE', `/api/tasks/${id}`);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to delete task: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await refreshPanel();
}

// ─── HTML builder ────────────────────────────────────────────────────────────

function buildHtml(tasks: Task[], slug: string, error: string | null): string {
  const nonce = randomBytes(16).toString('hex');

  const grouped = {
    todo: tasks.filter((t) => t.status === 'todo'),
    doing: tasks.filter((t) => t.status === 'doing'),
    done: tasks.filter((t) => t.status === 'done'),
  };

  const renderTask = (t: Task): string => {
    const priorityBadge =
      t.priority === 1
        ? '<span class="badge high">High</span>'
        : t.priority === 2
          ? '<span class="badge med">Med</span>'
          : '';

    const nextStatus =
      t.status === 'todo' ? 'doing' : t.status === 'doing' ? 'done' : 'todo';
    const toggleLabel =
      t.status === 'todo' ? '▶' : t.status === 'doing' ? '✓' : '↩';

    return `
      <li class="task-item ${t.status}" data-id="${esc(t.id)}" data-status="${esc(t.status)}">
        <button class="toggle-btn" title="Move to ${nextStatus}">${toggleLabel}</button>
        <span class="task-title">${esc(t.title)}</span>
        ${priorityBadge}
        <button class="delete-btn" title="Delete task">✕</button>
      </li>`;
  };

  const renderSection = (
    title: string,
    items: Task[],
    emptyMsg: string,
  ): string => `
    <section>
      <h3>${title} <span class="count">${items.length}</span></h3>
      ${
        items.length === 0
          ? `<p class="empty">${emptyMsg}</p>`
          : `<ul>${items.map(renderTask).join('')}</ul>`
      }
    </section>`;

  const body = error
    ? `<div class="error">${esc(error)}</div>`
    : `
        <div class="add-row">
          <input id="newTaskInput" type="text" placeholder="New task…" />
          <button id="addTaskBtn">Add</button>
        </div>
        ${renderSection('📋 To Do', grouped.todo, 'All clear!')}
        ${renderSection('⚡ In Progress', grouped.doing, 'Nothing in progress')}
        ${renderSection('✅ Done', grouped.done, 'Nothing done yet')}
      `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tasks — ${esc(slug)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px 20px;
      margin: 0;
    }
    h2 { margin: 0 0 16px; font-size: 1.1rem; }
    h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: .05em;
         color: var(--vscode-descriptionForeground); margin: 20px 0 8px; }
    .count { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
             border-radius: 99px; padding: 1px 7px; font-size: 0.75rem; margin-left: 6px; }
    ul { list-style: none; padding: 0; margin: 0; }
    .task-item {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 8px; border-radius: 4px;
      border: 1px solid var(--vscode-widget-border, transparent);
      margin-bottom: 4px;
      background: var(--vscode-list-inactiveSelectionBackground, transparent);
    }
    .task-item.done { opacity: 0.5; }
    .task-title { flex: 1; }
    .task-item.done .task-title { text-decoration: line-through; }
    .toggle-btn, .delete-btn {
      background: none; border: 1px solid var(--vscode-button-border, transparent);
      color: var(--vscode-foreground); cursor: pointer; border-radius: 3px;
      padding: 2px 6px; font-size: 0.8rem;
      opacity: 0.7;
    }
    .toggle-btn:hover, .delete-btn:hover { opacity: 1; }
    .delete-btn { color: var(--vscode-errorForeground); margin-left: auto; }
    .badge {
      font-size: 0.7rem; padding: 1px 5px; border-radius: 3px; font-weight: 600;
    }
    .badge.high { background: #f97316; color: #fff; }
    .badge.med  { background: #eab308; color: #000; }
    .add-row {
      display: flex; gap: 8px; margin-bottom: 12px;
    }
    .add-row input {
      flex: 1; padding: 5px 8px; border-radius: 4px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: inherit; font-size: inherit;
    }
    .add-row button {
      padding: 5px 12px; border-radius: 4px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; cursor: pointer; font-family: inherit; font-size: inherit;
    }
    .add-row button:hover { background: var(--vscode-button-hoverBackground); }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.85rem; }
    .error { color: var(--vscode-errorForeground); padding: 12px; }
  </style>
</head>
<body>
  <h2>📋 Tasks${slug ? ` — ${esc(slug)}` : ''}</h2>
  ${body}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function addTask() {
      const input = document.getElementById('newTaskInput');
      const title = input.value.trim();
      if (!title) return;
      vscode.postMessage({ type: 'ADD_TASK', title });
      input.value = '';
    }

    // Use event delegation for dynamically rendered task buttons
    document.body.addEventListener('click', (e) => {
      const target = e.target;
      if (target.classList.contains('toggle-btn')) {
        const li = target.closest('.task-item');
        if (li) vscode.postMessage({ type: 'TOGGLE_TASK', id: li.dataset.id, currentStatus: li.dataset.status });
      } else if (target.classList.contains('delete-btn')) {
        const li = target.closest('.task-item');
        if (li) vscode.postMessage({ type: 'DELETE_TASK', id: li.dataset.id });
      }
    });

    document.getElementById('addTaskBtn')?.addEventListener('click', addTask);
    document.getElementById('newTaskInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTask();
    });
  </script>
</body>
</html>`;
}

/** Basic HTML entity escaping to prevent XSS in the webview. */
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
