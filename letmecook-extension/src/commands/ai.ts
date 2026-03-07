/**
 * AI Commands (Phase 8.12)
 *
 * Commands:
 *  letmecook.askAI              — Ask AI anything about the current project
 *  letmecook.generateTasksFromSelection — Turn selected code/text into tasks
 *  letmecook.explainError       — Paste an error and get an explanation
 */
import * as vscode from 'vscode';
import { apiRequest } from '../api.js';
import { getCurrentSlug } from '../project.js';

interface AIAskResponse {
  answer: string;
  runId: string;
  providerId: string;
}

interface AIPlanResponse {
  tasks: string[];
  saved: { id: string; title: string }[];
  runId: string;
  providerId: string;
}

interface AICommitResponse {
  messages: string[];
  runId: string;
  providerId: string;
}

// ─── Ask AI about this project ───────────────────────────────────────────────

export async function askAI(): Promise<void> {
  const slug = getCurrentSlug();
  if (!slug) {
    vscode.window.showWarningMessage('No LetMeCook project detected in this workspace.');
    return;
  }

  const question = await vscode.window.showInputBox({
    prompt: 'Ask the AI about this project',
    placeHolder: 'How does the auth flow work? / What should I work on next?',
    ignoreFocusOut: true,
  });
  if (!question?.trim()) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'LetMeCook AI…', cancellable: false },
    async () => {
      try {
        const res = await apiRequest<AIAskResponse>('POST', `/api/ai/projects/${slug}/ask`, {
          question: question.trim(),
        });
        showAIResult('AI Answer', res.answer, res.providerId);
      } catch (err) {
        vscode.window.showErrorMessage(`AI error: ${(err as Error).message}`);
      }
    }
  );
}

// ─── Generate tasks from selection ───────────────────────────────────────────

export async function generateTasksFromSelection(): Promise<void> {
  const slug = getCurrentSlug();
  const editor = vscode.window.activeTextEditor;

  // Use selected text as the goal/context, fall back to prompting
  const selection = editor?.document.getText(editor.selection).trim();

  const goal = selection
    ? selection
    : await vscode.window.showInputBox({
        prompt: 'Describe what you want to implement (or select code first)',
        placeHolder: 'Build a user auth system with JWT…',
        ignoreFocusOut: true,
      });

  if (!goal?.trim()) return;

  const saveToProject = slug
    ? await vscode.window.showQuickPick(['Yes — save tasks to current project', 'No — just show them'], {
        title: 'Save generated tasks?',
      })
    : null;

  const shouldSave = saveToProject?.startsWith('Yes');

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Generating tasks…', cancellable: false },
    async () => {
      try {
        const res = await apiRequest<AIPlanResponse>('POST', '/api/ai/plan', {
          goal: goal.trim(),
          projectSlug: shouldSave ? slug : undefined,
        });

        if (res.tasks.length === 0) {
          vscode.window.showWarningMessage('AI returned no tasks. Try a more specific goal.');
          return;
        }

        const taskList = res.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n');
        const savedMsg = res.saved.length ? `\n\n✅ ${res.saved.length} tasks saved to project.` : '';

        vscode.window.showInformationMessage(
          `Generated ${res.tasks.length} tasks${savedMsg}`,
          'View in Terminal'
        ).then((choice) => {
          if (choice === 'View in Terminal') {
            const terminal = vscode.window.createTerminal('LetMeCook AI Tasks');
            terminal.sendText(`echo "${taskList.replace(/"/g, '\\"')}"`);
            terminal.show();
          }
        });

        // Also show in output channel for easy copying
        const out = vscode.window.createOutputChannel('LetMeCook AI');
        out.clear();
        out.appendLine(`# Generated Tasks [${res.providerId}]\n`);
        out.appendLine(taskList);
        if (savedMsg) out.appendLine(savedMsg);
        out.show(true);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('disabled')) {
          vscode.window.showWarningMessage('AI feature is disabled on the server. Enable it in server settings.');
        } else {
          vscode.window.showErrorMessage(`AI error: ${msg}`);
        }
      }
    }
  );
}

// ─── Explain current error ────────────────────────────────────────────────────

export async function explainError(): Promise<void> {
  const slug = getCurrentSlug();

  // Try to pre-fill from selected text or active terminal output
  const editor = vscode.window.activeTextEditor;
  const selectedText = editor?.document.getText(editor.selection).trim() ?? '';

  const errorText = selectedText || await vscode.window.showInputBox({
    prompt: 'Paste the error message or stack trace',
    placeHolder: 'TypeError: Cannot read properties of undefined…',
    ignoreFocusOut: true,
  });

  if (!errorText?.trim()) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Asking AI to explain error…', cancellable: false },
    async () => {
      try {
        const question = `Explain this error and suggest a fix:\n\n${errorText.trim()}`;
        const endpoint = slug ? `/api/ai/projects/${slug}/ask` : '/api/ai/projects/unknown/ask';
        
        // Use ask endpoint if we have a project, else fallback to a simpler prompt
        let answer: string;
        let providerId: string;
        
        if (slug) {
          const res = await apiRequest<AIAskResponse>('POST', `/api/ai/projects/${slug}/ask`, {
            question,
          });
          answer = res.answer;
          providerId = res.providerId;
        } else {
          // No project context — use plan endpoint as a fallback for error explanation
          const res = await apiRequest<AIPlanResponse>('POST', '/api/ai/plan', {
            goal: question,
          });
          answer = res.tasks.join('\n');
          providerId = res.providerId;
        }

        showAIResult('Error Explanation', answer, providerId);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('disabled')) {
          vscode.window.showWarningMessage('AI feature is disabled on the server.');
        } else {
          vscode.window.showErrorMessage(`AI error: ${msg}`);
        }
      }
    }
  );
}

// ─── AI Commit Message ────────────────────────────────────────────────────────

export async function generateCommitMessage(): Promise<void> {
  const slug = getCurrentSlug();
  if (!slug) {
    vscode.window.showWarningMessage('No LetMeCook project detected in this workspace.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Generating commit messages…', cancellable: false },
    async () => {
      try {
        const res = await apiRequest<AICommitResponse>('POST', '/api/ai/git/commit-message', {
          projectSlug: slug,
        });

        if (!res.messages.length) {
          vscode.window.showWarningMessage('No staged changes found. Stage some files first.');
          return;
        }

        const picked = await vscode.window.showQuickPick(
          res.messages.map((m, i) => ({ label: m, description: ['Conventional', 'Plain', 'WIP'][i] ?? '' })),
          { title: `AI Commit Messages [${res.providerId}]`, placeHolder: 'Pick a commit message' }
        );

        if (picked) {
          await vscode.env.clipboard.writeText(picked.label);
          vscode.window.showInformationMessage(`Copied to clipboard: "${picked.label}"`);
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('NO_DIFF') || msg.includes('staged')) {
          vscode.window.showWarningMessage('No staged changes found. Run "git add" first.');
        } else if (msg.includes('disabled')) {
          vscode.window.showWarningMessage('AI feature is disabled on the server.');
        } else {
          vscode.window.showErrorMessage(`AI error: ${msg}`);
        }
      }
    }
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function showAIResult(title: string, content: string, providerId: string): void {
  const out = vscode.window.createOutputChannel(`LetMeCook AI — ${title}`);
  out.clear();
  out.appendLine(`# ${title} [${providerId}]\n`);
  out.appendLine(content);
  out.show(true);
}
