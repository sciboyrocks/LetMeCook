/**
 * Anthropic (Claude) API provider.
 *
 * Required env var: ANTHROPIC_API_KEY
 * Optional env vars:
 *   ANTHROPIC_MODEL   — defaults to 'claude-3-5-haiku-20241022'
 */
import type { AIProvider, AICompleteOptions, AIAvailability } from './base.js';

const DEFAULT_MODEL = 'claude-3-5-haiku-20241022';
const ANTHROPIC_API = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic (Claude)';
  readonly type = 'api' as const;

  private get apiKey() { return process.env.ANTHROPIC_API_KEY ?? ''; }
  private get model() { return process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL; }

  async complete(opts: AICompleteOptions): Promise<string> {
    const { userPrompt, systemPrompt, timeoutMs = 60_000, maxTokens = 2048 } = opts;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userPrompt }],
    };
    if (systemPrompt) body.system = systemPrompt;

    let res: Response;
    try {
      res = await fetch(`${ANTHROPIC_API}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${txt.slice(0, 200)}`);
    }

    const json = (await res.json()) as { content?: { type: string; text: string }[] };
    const text = json.content?.find((b) => b.type === 'text')?.text?.trim();
    if (!text) throw new Error('Anthropic returned an empty response');
    return text;
  }

  async isAvailable(): Promise<AIAvailability> {
    if (!this.apiKey) return { ok: false, detail: 'ANTHROPIC_API_KEY not set' };
    // Anthropic doesn't have a free list-models endpoint; do a tiny probe completion
    try {
      const res = await fetch(`${ANTHROPIC_API}/v1/messages`, {
        method: 'POST',
        signal: AbortSignal.timeout(8_000),
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        return { ok: false, detail: `Anthropic ${res.status}: ${txt.slice(0, 120)}` };
      }
      return { ok: true, detail: `Model: ${this.model}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}
