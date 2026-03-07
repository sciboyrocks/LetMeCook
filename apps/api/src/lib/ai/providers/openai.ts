/**
 * OpenAI API provider — calls the OpenAI REST API with an API key.
 *
 * Required env var: OPENAI_API_KEY
 * Optional env vars:
 *   OPENAI_MODEL        — defaults to 'gpt-4o-mini'
 *   OPENAI_BASE_URL     — for compatible endpoints (e.g. Azure OpenAI, Ollama)
 */
import type { AIProvider, AICompleteOptions, AIAvailability } from './base.js';

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';
  readonly type = 'api' as const;

  private get apiKey() { return process.env.OPENAI_API_KEY ?? ''; }
  private get model() { return process.env.OPENAI_MODEL ?? 'gpt-4o-mini'; }
  private get baseUrl() { return (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com').replace(/\/$/, ''); }

  async complete(opts: AICompleteOptions): Promise<string> {
    const { userPrompt, systemPrompt, timeoutMs = 60_000, maxTokens = 2048 } = opts;

    const messages: { role: string; content: string }[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userPrompt });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI returned an empty response');
    return text;
  }

  async isAvailable(): Promise<AIAvailability> {
    if (!this.apiKey) return { ok: false, detail: 'OPENAI_API_KEY not set' };
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return { ok: false, detail: `OpenAI returned ${res.status}` };
      return { ok: true, detail: `Model: ${this.model}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}
