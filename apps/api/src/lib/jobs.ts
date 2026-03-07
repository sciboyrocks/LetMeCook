import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { db } from '../db/index.js';

export const JOB_QUEUE_NAME = 'letmecook';

export type JobType = 'clone' | 'scaffold' | 'export-zip' | 'backup' | 'ai-agent';

export const JOB_TIMEOUTS_MS: Record<JobType, number> = {
  clone: 5 * 60_000,
  scaffold: 8 * 60_000,
  'export-zip': 3 * 60_000,
  backup: 10 * 60_000,
  'ai-agent': 15 * 60_000,
};

export interface CloneJobPayload {
  repoUrl: string;
  name?: string;
  description?: string;
  color?: string;
  branch?: string;
}

export interface ScaffoldJobPayload {
  template: 'nextjs' | 'vite-react' | 'express' | 'node-ts' | 'python' | 'go';
  name: string;
  description?: string;
  color?: string;
}

export interface ExportZipJobPayload {
  projectIdOrSlug: string;
}

export interface BackupJobPayload {
  projectId: string;
  projectSlug: string;
}

export interface AIAgentJobPayload {
  projectId: string;
  projectSlug: string;
  instruction: string;
}

export type JobPayloadMap = {
  clone: CloneJobPayload;
  scaffold: ScaffoldJobPayload;
  'export-zip': ExportZipJobPayload;
  backup: BackupJobPayload;
  'ai-agent': AIAgentJobPayload;
};

const connection = { url: config.redisUrl };

export const jobsQueue = new Queue(JOB_QUEUE_NAME, { connection });

export async function enqueueJob<T extends JobType>(
  type: T,
  payload: JobPayloadMap[T]
): Promise<{ id: string; status: 'queued'; timeoutMs: number }> {
  const id = uuidv4();
  const timeoutMs = JOB_TIMEOUTS_MS[type];

  db.prepare(
    `INSERT INTO jobs (id, type, status, progress, timeout_ms, payload_json)
     VALUES (?, ?, 'queued', 0, ?, ?)`
  ).run(id, type, timeoutMs, JSON.stringify(payload));

  db.prepare('INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)').run(
    id,
    'info',
    `Queued ${type} job`
  );

  await jobsQueue.add(type, payload, {
    jobId: id,
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 100,
  });

  return { id, status: 'queued', timeoutMs };
}