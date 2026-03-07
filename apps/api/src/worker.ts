import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import { Worker, type Job } from 'bullmq';
import { google } from 'googleapis';
import { config } from './config.js';
import { db } from './db/index.js';
import { slugify } from './lib/slugify.js';
import { JOB_QUEUE_NAME, type JobType, type JobPayloadMap } from './lib/jobs.js';
import { aiRun } from './lib/ai/adapter.js';
import { buildProjectContext } from './lib/ai/context.js';
import { getFlag } from './lib/flags.js';

const connection = { url: config.redisUrl };

class JobCancelledError extends Error {
  constructor(message = 'Job cancelled') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

class JobTimeoutError extends Error {
  constructor(message = 'Job timed out') {
    super(message);
    this.name = 'JobTimeoutError';
  }
}

function appendLog(jobId: string, level: 'info' | 'warn' | 'error', message: string) {
  db.prepare('INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)').run(jobId, level, message.slice(0, 2_000));
}

function updateJob(
  jobId: string,
  patch: {
    status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    progress?: number;
    resultJson?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    started?: boolean;
    finished?: boolean;
  }
) {
  const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const params: unknown[] = [];

  if (patch.status) {
    updates.push('status = ?');
    params.push(patch.status);
  }
  if (patch.progress !== undefined) {
    updates.push('progress = ?');
    params.push(Math.max(0, Math.min(100, Math.floor(patch.progress))));
  }
  if (patch.resultJson !== undefined) {
    updates.push('result_json = ?');
    params.push(patch.resultJson);
  }
  if (patch.errorCode !== undefined) {
    updates.push('error_code = ?');
    params.push(patch.errorCode);
  }
  if (patch.errorMessage !== undefined) {
    updates.push('error_message = ?');
    params.push(patch.errorMessage);
  }
  if (patch.started) updates.push('started_at = CURRENT_TIMESTAMP');
  if (patch.finished) updates.push('finished_at = CURRENT_TIMESTAMP');

  params.push(jobId);
  db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

function isCancelRequested(jobId: string): boolean {
  const row = db
    .prepare<[string], { cancel_requested: number }>('SELECT cancel_requested FROM jobs WHERE id = ?')
    .get(jobId);
  return Boolean(row?.cancel_requested);
}

function uniqueSlug(input: string): string {
  let candidate = input;
  let i = 1;
  while (true) {
    const existing = db.prepare<[string], { id: string }>('SELECT id FROM projects WHERE slug = ?').get(candidate);
    if (!existing) return candidate;
    i += 1;
    candidate = `${input}-${i}`;
  }
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile()) count += 1;
    if (entry.isDirectory()) count += countFiles(join(dir, entry.name));
  }
  return count;
}

function sanitizeGitMessage(msg: string): string {
  return msg.replace(/:[^:@\s]+@/g, ':***@');
}

function getGithubAuthFromGh(): { token: string | null } {
  const ghCheck = spawnSync('gh', ['--version'], { encoding: 'utf-8' });
  if (ghCheck.status !== 0) return { token: null };

  const tokenResult = spawnSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf-8' });
  if (tokenResult.status !== 0) return { token: null };

  const token = tokenResult.stdout.trim();
  return { token: token || null };
}

async function runCommandStreaming(opts: {
  jobId: string;
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  onOutput?: (line: string) => void;
}) {
  const { jobId, command, args, cwd, timeoutMs, onOutput } = opts;

  const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let timedOut = false;
  let cancelled = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, timeoutMs);

  const cancelPoll = setInterval(() => {
    if (isCancelRequested(jobId)) {
      cancelled = true;
      child.kill('SIGTERM');
    }
  }, 500);

  const emitLines = (source: NodeJS.ReadableStream | null, sink: (line: string) => void) => {
    if (!source) return;
    let buffered = '';
    source.on('data', (chunk: Buffer | string) => {
      buffered += chunk.toString();
      const lines = buffered.split(/\r\n|\r|\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) sink(trimmed);
      }
    });
    source.on('end', () => {
      const trimmed = buffered.trim();
      if (trimmed) sink(trimmed);
    });
  };

  emitLines(child.stdout, (line) => onOutput?.(line));
  emitLines(child.stderr, (line) => onOutput?.(line));

  const [code] = (await once(child, 'close')) as [number | null];

  clearTimeout(timeout);
  clearInterval(cancelPoll);

  if (cancelled) {
    throw new JobCancelledError();
  }
  if (timedOut) {
    throw new JobTimeoutError();
  }
  if (code !== 0) {
    throw new Error(`${command} exited with code ${code ?? 'unknown'}`);
  }
}

async function processClone(jobId: string, payload: JobPayloadMap['clone'], timeoutMs: number) {
  const repoUrl = payload.repoUrl?.trim();
  if (!repoUrl) throw new Error('Repository URL is required');
  if (repoUrl.startsWith('file://') || repoUrl.startsWith('/') || repoUrl.startsWith('../')) {
    throw new Error('Local file clone URLs are not allowed');
  }

  updateJob(jobId, { progress: 5 });
  appendLog(jobId, 'info', `Preparing clone: ${repoUrl}`);

  const urlSlug = repoUrl.split('/').pop()?.replace(/\.git$/, '') || 'project';
  const displayName = payload.name?.trim() || urlSlug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const slug = uniqueSlug(slugify(displayName));
  const projectDir = join(config.projectsDir, slug);

  mkdirSync(config.projectsDir, { recursive: true });

  let cloneUrl = repoUrl;
  const ghAuth = getGithubAuthFromGh();
  if (ghAuth.token && cloneUrl.startsWith('https://github.com/')) {
    cloneUrl = cloneUrl.replace('https://github.com/', `https://x-access-token:${encodeURIComponent(ghAuth.token)}@github.com/`);
  }

  const args = ['clone', '--progress', '--depth', '100'];
  if (payload.branch?.trim()) args.push('--branch', payload.branch.trim());
  args.push(cloneUrl, projectDir);

  let progress = 10;
  await runCommandStreaming({
    jobId,
    command: 'git',
    args,
    timeoutMs,
    onOutput: (line) => {
      const redacted = sanitizeGitMessage(line);
      appendLog(jobId, 'info', redacted);
      const match = redacted.match(/(\d{1,3})%/);
      if (match) {
        const pct = Math.min(95, Number(match[1]));
        if (pct > progress) {
          progress = pct;
          updateJob(jobId, { progress: pct });
        }
      }
    },
  });

  spawnSync('chown', ['-R', '1000:1000', projectDir]);

  const id = uuidv4();
  db.prepare('INSERT INTO projects (id, name, slug, description, color) VALUES (?, ?, ?, ?, ?)').run(
    id,
    displayName,
    slug,
    (payload.description ?? '').trim(),
    payload.color ?? '#6366f1'
  );

  updateJob(jobId, { progress: 100 });
  appendLog(jobId, 'info', `Clone complete (${countFiles(projectDir)} files).`);

  return { projectId: id, slug, name: displayName };
}

async function processScaffold(jobId: string, payload: JobPayloadMap['scaffold'], timeoutMs: number) {
  if (!payload.name?.trim()) throw new Error('Project name is required');

  const slug = uniqueSlug(slugify(payload.name.trim()));
  const projectDir = join(config.projectsDir, slug);
  mkdirSync(projectDir, { recursive: true });

  appendLog(jobId, 'info', `Scaffolding ${payload.template} in ${slug}`);
  updateJob(jobId, { progress: 5 });

  writeFileSync(join(projectDir, 'README.md'), `# ${payload.name.trim()}\n\n${payload.description ?? ''}\n`);

  try {
    if (payload.template === 'python') {
      updateJob(jobId, { progress: 20 });
      await runCommandStreaming({
        jobId,
        command: 'python3',
        args: ['-m', 'venv', join(projectDir, '.venv')],
        timeoutMs,
        onOutput: (line) => appendLog(jobId, 'info', line),
      });
      writeFileSync(
        join(projectDir, 'main.py'),
        'def main():\n    print("Hello, world!")\n\n\nif __name__ == "__main__":\n    main()\n'
      );
    } else if (payload.template === 'go') {
      updateJob(jobId, { progress: 20 });
      const moduleName = slug.replace(/-/g, '_');
      await runCommandStreaming({
        jobId,
        command: 'go',
        args: ['mod', 'init', moduleName],
        cwd: projectDir,
        timeoutMs,
        onOutput: (line) => appendLog(jobId, 'info', line),
      });
      writeFileSync(
        join(projectDir, 'main.go'),
        `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, ${payload.name.trim()}!")\n}\n`
      );
    } else {
      const templates: Record<Exclude<JobPayloadMap['scaffold']['template'], 'python' | 'go'>, { cmd: string; args: string[] }> = {
        nextjs: {
          cmd: 'npx',
          args: [
            '--yes',
            'create-next-app@latest',
            projectDir,
            '--typescript',
            '--tailwind',
            '--eslint',
            '--app',
            '--no-src-dir',
            '--import-alias',
            '@/*',
            '--no-turbopack',
          ],
        },
        'vite-react': {
          cmd: 'npm',
          args: ['create', 'vite@latest', projectDir, '--', '--template', 'react-ts'],
        },
        express: {
          cmd: 'npx',
          args: ['--yes', 'express-generator', '--no-view', projectDir],
        },
        'node-ts': {
          cmd: 'npx',
          args: ['--yes', 'create-ts-project@latest', projectDir],
        },
      };

      const selected = templates[payload.template];
      updateJob(jobId, { progress: 20 });
      await runCommandStreaming({
        jobId,
        command: selected.cmd,
        args: selected.args,
        timeoutMs,
        onOutput: (line) => appendLog(jobId, 'info', line),
      });
    }
  } catch (error) {
    rmSync(projectDir, { recursive: true, force: true });
    throw error;
  }

  spawnSync('chown', ['-R', '1000:1000', projectDir]);

  const id = uuidv4();
  db.prepare('INSERT INTO projects (id, name, slug, description, color) VALUES (?, ?, ?, ?, ?)').run(
    id,
    payload.name.trim(),
    slug,
    (payload.description ?? '').trim(),
    payload.color ?? '#6366f1'
  );

  updateJob(jobId, { progress: 100 });
  appendLog(jobId, 'info', `Scaffold complete (${countFiles(projectDir)} files).`);

  return { projectId: id, slug, name: payload.name.trim() };
}

async function processExportZip(jobId: string, payload: JobPayloadMap['export-zip']) {
  const idOrSlug = payload.projectIdOrSlug;
  const project = db
    .prepare<[string, string], { id: string; slug: string; name: string }>(
      'SELECT id, slug, name FROM projects WHERE id = ? OR slug = ?'
    )
    .get(idOrSlug, idOrSlug);

  if (!project) throw new Error('Project not found');

  const projectDir = join(config.projectsDir, project.slug);
  if (!existsSync(projectDir)) throw new Error('Project directory not found on disk');

  const exportsDir = join(config.dataDir, 'exports');
  mkdirSync(exportsDir, { recursive: true });

  const zipPath = join(exportsDir, `${jobId}.zip`);
  const filename = `${project.slug}.zip`;

  updateJob(jobId, { progress: 10 });
  appendLog(jobId, 'info', 'Building archive…');

  const archive = archiver('zip', { zlib: { level: 9 } });
  const output = createWriteStream(zipPath);

  archive.on('warning', (err) => appendLog(jobId, 'warn', err.message));
  archive.on('progress', (data) => {
    const pct = data.entries.total > 0
      ? Math.min(95, Math.floor((data.entries.processed / data.entries.total) * 100))
      : 50;
    updateJob(jobId, { progress: pct });
  });

  archive.pipe(output);
  archive.glob('**/*', {
    cwd: projectDir,
    dot: true,
    ignore: [
      '.git',
      '**/.git/**',
      'node_modules',
      '**/node_modules/**',
      '.next',
      '**/.next/**',
      '.venv',
      '**/.venv/**',
      'venv',
      '**/venv/**',
      'dist',
      '**/dist/**',
      'build',
      '**/build/**',
    ],
  });

  await archive.finalize();
  await once(output, 'close');

  updateJob(jobId, { progress: 100 });
  appendLog(jobId, 'info', 'Archive ready for download.');
  return { zipPath, filename, projectId: project.id, slug: project.slug };
}

async function processBackup(jobId: string, payload: JobPayloadMap['backup']) {
  const project = db
    .prepare<[string], { id: string; slug: string; name: string }>(
      'SELECT id, slug, name FROM projects WHERE id = ?'
    )
    .get(payload.projectId);

  if (!project) throw new Error('Project not found');

  const projectDir = join(config.projectsDir, project.slug);
  if (!existsSync(projectDir)) throw new Error('Project directory not found on disk');

  const backupsDir = join(config.dataDir, 'backups');
  mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const filename = `${project.slug}_${timestamp}.zip`;
  const zipPath = join(backupsDir, filename);
  const backupId = uuidv4();

  db.prepare(
    'INSERT INTO backups (id, project_id, filename, status) VALUES (?, ?, ?, ?)'
  ).run(backupId, project.id, filename, 'pending');

  updateJob(jobId, { progress: 10 });
  appendLog(jobId, 'info', `Creating backup for ${project.name}…`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  const output = createWriteStream(zipPath);

  archive.on('warning', (err) => appendLog(jobId, 'warn', err.message));
  archive.on('progress', (data) => {
    const pct = data.entries.total > 0
      ? Math.min(80, 10 + Math.floor((data.entries.processed / data.entries.total) * 70))
      : 40;
    updateJob(jobId, { progress: pct });
  });

  archive.pipe(output);
  archive.glob('**/*', {
    cwd: projectDir,
    dot: true,
    ignore: [
      '.git', '**/.git/**',
      'node_modules', '**/node_modules/**',
      '.next', '**/.next/**',
      '.venv', '**/.venv/**',
      'venv', '**/venv/**',
    ],
  });

  await archive.finalize();
  await once(output, 'close');

  const { size: sizeBytes } = await import('node:fs').then((fs) => fs.statSync(zipPath));

  db.prepare(
    "UPDATE backups SET status = 'completed', size_bytes = ? WHERE id = ?"
  ).run(sizeBytes, backupId);

  // Prune old backups — keep last 7 per project
  const oldBackups = db
    .prepare<[string], { id: string; filename: string }>(
      "SELECT id, filename FROM backups WHERE project_id = ? AND status = 'completed' ORDER BY created_at DESC"
    )
    .all(project.id);

  if (oldBackups.length > 7) {
    for (const old of oldBackups.slice(7)) {
      const oldPath = join(backupsDir, old.filename);
      try { rmSync(oldPath, { force: true }); } catch {}
      db.prepare('DELETE FROM backups WHERE id = ?').run(old.id);
    }
    appendLog(jobId, 'info', `Pruned ${oldBackups.length - 7} old backup(s)`);
  }

  updateJob(jobId, { progress: 100 });
  appendLog(jobId, 'info', `Backup complete (${(sizeBytes / 1024).toFixed(0)} KB)`);

  // ── Google Drive upload ───────────────────────────────────────────────
  let driveFileId: string | null = null;
  const folderIdRow = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get('gdrive_folder_id');
  const driveFolderId = folderIdRow?.value ?? null;
  if (driveFolderId) {
    try {
      updateJob(jobId, { progress: 95 });
      appendLog(jobId, 'info', 'Uploading to Google Drive…');

      // Prefer OAuth2 (user credentials) over service account — service accounts
      // have no storage quota on personal Google Drive (My Drive) folders.
      const refreshToken =
        (db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get('gdrive_refresh_token')?.value ?? null) ||
        config.gdriveOAuthRefreshToken;

      let auth: InstanceType<typeof google.auth.OAuth2> | InstanceType<typeof google.auth.GoogleAuth>;

      if (refreshToken && config.gdriveOAuthClientId && config.gdriveOAuthClientSecret) {
        const oAuth2Client = new google.auth.OAuth2(
          config.gdriveOAuthClientId,
          config.gdriveOAuthClientSecret,
          'urn:ietf:wg:oauth:2.0:oob'
        );
        oAuth2Client.setCredentials({ refresh_token: refreshToken });
        auth = oAuth2Client;
        appendLog(jobId, 'info', 'Using OAuth2 credentials for Drive upload');
      } else if (config.gdriveCredentialsPath) {
        auth = new google.auth.GoogleAuth({
          keyFile: config.gdriveCredentialsPath,
          scopes: ['https://www.googleapis.com/auth/drive'],
        });
        appendLog(jobId, 'warn', 'Using service account — upload may fail on personal My Drive. Run /api/system/gdrive/auth-url to set up OAuth2.');
      } else {
        appendLog(jobId, 'warn', 'No Drive credentials configured — skipping upload. Set GDRIVE_OAUTH_CLIENT_ID/SECRET and connect via /api/system/gdrive/auth-url.');
        return { backupId, filename, sizeBytes, driveFileId: null, projectId: project.id, slug: project.slug };
      }

      const drive = google.drive({ version: 'v3', auth });

      const res = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
          name: filename,
          parents: [driveFolderId],
        },
        media: {
          mimeType: 'application/zip',
          body: createReadStream(zipPath),
        },
        fields: 'id',
      });

      driveFileId = res.data.id ?? null;

      if (driveFileId) {
        db.prepare(
          'UPDATE backups SET drive_id = ?, status = ? WHERE id = ?'
        ).run(driveFileId, 'completed', backupId);
        appendLog(jobId, 'info', `Uploaded to Drive (id: ${driveFileId})`);

        // Remove local zip to save disk space after successful upload
        try { rmSync(zipPath, { force: true }); } catch {}
      }

      // Prune old Drive files — keep the 7 most recent per project in Drive
      const driveBackups = db
        .prepare<[string], { id: string; drive_id: string; filename: string }>(
          "SELECT id, drive_id, filename FROM backups WHERE project_id = ? AND drive_id IS NOT NULL ORDER BY created_at DESC"
        )
        .all(project.id);

      if (driveBackups.length > 7) {
        for (const old of driveBackups.slice(7)) {
          try {
            await drive.files.delete({ fileId: old.drive_id, supportsAllDrives: true });
          } catch {}
          db.prepare('DELETE FROM backups WHERE id = ?').run(old.id);
        }
        appendLog(jobId, 'info', `Pruned ${driveBackups.length - 7} old Drive backup(s)`);
      }
    } catch (driveErr) {
      const msg = driveErr instanceof Error ? driveErr.message : String(driveErr);
      appendLog(jobId, 'warn', `Drive upload failed (backup still saved locally): ${msg}`);
    }
  } else {
    appendLog(jobId, 'info', 'No Drive folder configured — skipping Drive upload. Connect Google Drive in the Connections page.');
  }

  updateJob(jobId, { progress: 100 });

  return { backupId, filename, sizeBytes, driveFileId, projectId: project.id, slug: project.slug };
}

async function processAIAgent(jobId: string, payload: JobPayloadMap['ai-agent']) {
  if (!getFlag(db, 'ai')) {
    throw new Error('AI feature is disabled. Enable it in Connections → AI Providers.');
  }

  const { projectId, projectSlug, instruction } = payload;

  if (!instruction?.trim()) throw new Error('Instruction is required');

  const project = db
    .prepare<[string], { id: string; slug: string; name: string }>('SELECT id, slug, name FROM projects WHERE id = ?')
    .get(projectId);
  if (!project) throw new Error('Project not found');

  updateJob(jobId, { progress: 5 });
  appendLog(jobId, 'info', `Starting AI agent for project: ${project.name}`);
  appendLog(jobId, 'info', `Instruction: ${instruction.trim()}`);

  // Build project context
  updateJob(jobId, { progress: 10 });
  appendLog(jobId, 'info', 'Gathering project context (tasks, git status, file tree)…');
  const ctx = buildProjectContext(projectSlug);

  const contextParts: string[] = [
    `Project: ${project.name} (${projectSlug})`,
  ];
  if (ctx) {
    if (ctx.project.description) contextParts.push(`Description: ${ctx.project.description}`);
    if (ctx.project.tags.length) contextParts.push(`Tags: ${ctx.project.tags.join(', ')}`);
    if (ctx.tasks.length) {
      contextParts.push('\nOpen tasks:');
      for (const t of ctx.tasks) {
        contextParts.push(`  [${t.status}] (P${t.priority}) ${t.title}`);
      }
    }
    if (ctx.gitStatus) contextParts.push(`\nGit status:\n${ctx.gitStatus}`);
    if (ctx.recentCommits) contextParts.push(`\nRecent commits:\n${ctx.recentCommits}`);
    if (ctx.fileTree) contextParts.push(`\nFile tree (excerpt):\n${ctx.fileTree}`);
    if (ctx.fileSnippets.length) {
      contextParts.push('\nKey file snippets:');
      for (const s of ctx.fileSnippets) {
        contextParts.push(`\n--- ${s.path} ---\n${s.content}`);
      }
    }
  }
  const contextStr = contextParts.join('\n');
  appendLog(jobId, 'info', `Context built (${contextStr.length} chars). Invoking AI agent…`);

  updateJob(jobId, { progress: 20 });

  // Phase 1: Analyse & plan
  appendLog(jobId, 'info', '── Phase 1: Analysing task and forming a plan ──');
  let planResult: { text: string; runId: string };
  try {
    planResult = await aiRun({
      action: 'ai-agent-plan',
      projectId,
      systemPrompt: `You are a senior software engineer acting as an autonomous coding agent. You have access to the project context below. The user has assigned you a task. 

Respond with a concise, numbered action plan (max 8 steps) of what you will do to complete the task. Each step on its own line starting with a number and period. Be specific and technical. No preamble.`,
      userPrompt: `Project context:\n${contextStr}\n\nAssigned task: ${instruction.trim()}`,
      maxTokens: 1024,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(jobId, 'error', `AI plan failed: ${msg}`);
    throw err;
  }

  const planSteps = planResult.text
    .split('\n')
    .map((l) => l.replace(/^\d+\.\s*/, '').trim())
    .filter((l) => l.length > 0);

  for (const step of planSteps) {
    appendLog(jobId, 'info', `  → ${step}`);
  }

  updateJob(jobId, { progress: 35 });

  // Phase 2: Execute each step with AI reasoning
  appendLog(jobId, 'info', '\n── Phase 2: Executing plan ──');
  const stepResults: string[] = [];
  const totalSteps = planSteps.length;

  for (let i = 0; i < planSteps.length; i++) {
    if (isCancelRequested(jobId)) throw new JobCancelledError();

    const step = planSteps[i];
    const stepNum = i + 1;
    const progressStart = 35 + Math.floor((i / totalSteps) * 45);
    updateJob(jobId, { progress: progressStart });
    appendLog(jobId, 'info', `\n[Step ${stepNum}/${totalSteps}] ${step}`);

    let stepResult: { text: string };
    try {
      stepResult = await aiRun({
        action: 'ai-agent-step',
        projectId,
        systemPrompt: `You are executing step ${stepNum} of ${totalSteps} in a coding task for project "${project.name}".

Full plan:
${planSteps.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}

Project context:
${contextStr}

Previous step results:
${stepResults.length > 0 ? stepResults.map((r, idx) => `Step ${idx + 1}: ${r}`).join('\n') : 'None yet'}

Current step: ${step}

Execute this step. Be concise and specific. If this step involves writing code, provide the actual code. If it involves analysis, provide the analysis. Output only what is relevant to this step.`,
        userPrompt: `Execute step ${stepNum}: ${step}`,
        maxTokens: 2048,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog(jobId, 'warn', `Step ${stepNum} encountered an issue: ${msg}`);
      stepResults.push(`(failed: ${msg})`);
      continue;
    }

    const resultSnippet = stepResult.text.trim();
    stepResults.push(resultSnippet.slice(0, 500));

    // Stream the result line by line
    for (const line of resultSnippet.split('\n').slice(0, 30)) {
      if (line.trim()) appendLog(jobId, 'info', line);
    }
    if (resultSnippet.split('\n').length > 30) {
      appendLog(jobId, 'info', '  … (truncated for log)');
    }
  }

  updateJob(jobId, { progress: 85 });

  // Phase 3: Summary
  appendLog(jobId, 'info', '\n── Phase 3: Generating summary ──');
  if (isCancelRequested(jobId)) throw new JobCancelledError();

  let summaryResult: { text: string };
  try {
    summaryResult = await aiRun({
      action: 'ai-agent-summary',
      projectId,
      systemPrompt: `You are summarising the result of an autonomous coding agent run. Be concise (max 4 sentences). State what was accomplished, any code that was produced, and any follow-up actions the developer should take.`,
      userPrompt: `Task: ${instruction.trim()}\n\nPlan:\n${planSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nStep results:\n${stepResults.map((r, i) => `Step ${i + 1}: ${r}`).join('\n\n')}`,
      maxTokens: 512,
    });
  } catch {
    summaryResult = { text: 'Agent completed all steps. Review the log above for details.' };
  }

  updateJob(jobId, { progress: 95 });
  appendLog(jobId, 'info', '\n── Summary ──');
  for (const line of summaryResult.text.trim().split('\n')) {
    if (line.trim()) appendLog(jobId, 'info', line);
  }

  updateJob(jobId, { progress: 100 });

  return {
    projectId,
    projectSlug,
    instruction: instruction.trim(),
    planSteps,
    summary: summaryResult.text.trim(),
  };
}

async function processJob(job: Job) {
  const jobId = String(job.id);
  const type = job.name as JobType;
  const timeoutRow = db.prepare<[string], { timeout_ms: number }>('SELECT timeout_ms FROM jobs WHERE id = ?').get(jobId);
  const timeoutMs = timeoutRow?.timeout_ms ?? 300_000;

  updateJob(jobId, { status: 'running', progress: 1, started: true, errorCode: null, errorMessage: null, resultJson: null });
  appendLog(jobId, 'info', `Worker started ${type} job`);

  try {
    if (isCancelRequested(jobId)) {
      throw new JobCancelledError();
    }

    let result: Record<string, unknown>;
    if (type === 'clone') {
      result = await processClone(jobId, job.data as JobPayloadMap['clone'], timeoutMs);
    } else if (type === 'scaffold') {
      result = await processScaffold(jobId, job.data as JobPayloadMap['scaffold'], timeoutMs);
    } else if (type === 'export-zip') {
      result = await processExportZip(jobId, job.data as JobPayloadMap['export-zip']);
    } else if (type === 'backup') {
      result = await processBackup(jobId, job.data as JobPayloadMap['backup']);
    } else if (type === 'ai-agent') {
      result = await processAIAgent(jobId, job.data as JobPayloadMap['ai-agent']);
    } else {
      throw new Error(`Unknown job type: ${type}`);
    }

    updateJob(jobId, {
      status: 'completed',
      progress: 100,
      resultJson: JSON.stringify(result),
      finished: true,
      errorCode: null,
      errorMessage: null,
    });
    appendLog(jobId, 'info', 'Job completed');
  } catch (error) {
    if (error instanceof JobCancelledError) {
      updateJob(jobId, {
        status: 'cancelled',
        finished: true,
        errorCode: 'JOB_CANCELLED',
        errorMessage: 'Job cancelled by user',
      });
      appendLog(jobId, 'warn', 'Job cancelled');
      return;
    }

    if (error instanceof JobTimeoutError) {
      updateJob(jobId, {
        status: 'failed',
        finished: true,
        errorCode: 'JOB_TIMEOUT',
        errorMessage: 'Job exceeded hard timeout',
      });
      appendLog(jobId, 'error', 'Job timed out');
      return;
    }

    const message = error instanceof Error ? sanitizeGitMessage(error.message) : String(error);
    updateJob(jobId, {
      status: 'failed',
      finished: true,
      errorCode: 'JOB_FAILED',
      errorMessage: message,
    });
    appendLog(jobId, 'error', message);
  }
}

const worker = new Worker(
  JOB_QUEUE_NAME,
  async (job: Job) => processJob(job),
  { connection }
);

function pruneOldJobs(keepCount = 20) {
  try {
    const oldJobs = db
      .prepare<[number], { id: string }>(
        `SELECT id FROM jobs WHERE status IN ('completed', 'failed', 'cancelled') ORDER BY created_at DESC LIMIT -1 OFFSET ?`
      )
      .all(keepCount);
    if (oldJobs.length === 0) return;
    const ids = oldJobs.map((j) => j.id);
    const placeholders = ids.map(() => '?').join(', ');
    db.prepare(`DELETE FROM job_logs WHERE job_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`).run(...ids);
    console.log(`[worker] 🧹 Pruned ${ids.length} old job(s)`);
  } catch (err) {
    console.error('[worker] prune error:', err);
  }
}

worker.on('completed', (job) => {
  console.log(`[worker] ✅ Job ${job.id} completed`);
  pruneOldJobs();
});

worker.on('failed', (job, err) => {
  console.error(`[worker] ❌ Job ${job?.id} failed: ${err.message}`);
  pruneOldJobs();
});

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down…`);
  try {
    await worker.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

console.log('[worker] 🔧 BullMQ worker started, listening for jobs…');
