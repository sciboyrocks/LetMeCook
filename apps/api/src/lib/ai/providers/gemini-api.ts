/**
 * Google Gemini API key provider — calls the Generative Language REST API.
 *
 * Required env var: GEMINI_API_KEY
 * Optional env vars:
 *   GEMINI_MODEL   — defaults to 'gemini-2.0-flash'
 */
import type { AIProvider, AICompleteOptions, AIAvailability } from './base.js';

const DEFAULT_MODEL = 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiApiProvider implements AIProvider {
  readonly id = 'gemini-api';
  readonly name = 'Gemini (API Key)';
  readonly type = 'api' as const;

  private get apiKey() { return process.env.GEMINI_API_KEY ?? ''; }
  private get model() { return process.env.GEMINI_MODEL ?? DEFAULT_MODEL; }

  async complete(opts: AICompleteOptions): Promise<string> {
    const { userPrompt, systemPrompt, timeoutMs = 60_000, maxTokens = 2048 } = opts;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    };
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    let res: Response;
    try {
      res = await fetch(
        `${GEMINI_API_BASE}/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${txt.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Gemini API returned an empty response');
    return text;
  }

  async isAvailable(): Promise<AIAvailability> {
    if (!this.apiKey) return { ok: false, detail: 'GEMINI_API_KEY not set' };
    try {
      const res = await fetch(
        `${GEMINI_API_BASE}/models?key=${this.apiKey}`,
        { signal: AbortSignal.timeout(5_000) }
      );
      if (!res.ok) return { ok: false, detail: `Gemini API returned ${res.status}` };
      return { ok: true, detail: `Model: ${this.model}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}
