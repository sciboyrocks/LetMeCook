/**
 * Gemini CLI provider — spawns the `gemini` CLI subprocess.
 *
 * Requires: `gemini` binary on PATH (npm i -g @google/gemini-cli or similar).
 * No API key needed in env — the CLI handles its own auth.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { AIProvider, AICompleteOptions, AIAvailability } from './base.js';

export class GeminiCliProvider implements AIProvider {
  readonly id = 'gemini-cli';
  readonly name = 'Gemini (CLI)';
  readonly type = 'cli' as const;

  /** Override the binary name/path via env: GEMINI_CLI_BIN */
  private get bin() {
    return process.env.GEMINI_CLI_BIN ?? 'gemini';
  }

  async complete(opts: AICompleteOptions): Promise<string> {
    const { userPrompt, systemPrompt, timeoutMs = 60_000 } = opts;

    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n---\n\n${userPrompt}`
      : userPrompt;

    return runCli({
      bin: this.bin,
      args: ['--prompt', fullPrompt],
      timeoutMs,
    });
  }

  async isAvailable(): Promise<AIAvailability> {
    try {
      const out = await runCli({ bin: this.bin, args: ['--version'], timeoutMs: 5_000 });
      return { ok: true, detail: `CLI ready: ${out.trim().split('\n')[0]}` };
    } catch (err) {
      return { ok: false, detail: `gemini CLI not found or failed: ${(err as Error).message}` };
    }
  }
}

async function runCli(opts: { bin: string; args: string[]; timeoutMs: number }): Promise<string> {
  const { bin, args, timeoutMs } = opts;
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
  child.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });

  const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  const [code] = (await once(child, 'close')) as [number | null];
  clearTimeout(timer);

  if (code !== 0) {
    throw new Error(stderr.trim() || `${bin} exited with code ${code}`);
  }
  return stdout;
}
