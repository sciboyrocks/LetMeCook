/**
 * Base interface for all AI providers.
 *
 * To add a new provider:
 *  1. Create a new file in `lib/ai/providers/`
 *  2. Implement the `AIProvider` interface
 *  3. Add it to the `BUILTIN_PROVIDERS` map in `lib/ai/provider-registry.ts`
 *  4. Add any required env vars to `config.ts`
 *
 * Providers come in two flavours:
 *  - 'cli'  — spawn a local CLI tool (e.g. gemini-cli, aider, llm)
 *  - 'api'  — call a remote REST API with an API key (e.g. OpenAI, Anthropic, Google AI)
 */
export interface AIProvider {
  /** Stable machine identifier, used in DB and settings. */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Connection type: CLI subprocess or REST API. */
  readonly type: 'cli' | 'api';

  /**
   * Send a prompt and return the generated text.
   * Must throw on timeout or hard failure (caught by the adapter).
   */
  complete(opts: AICompleteOptions): Promise<string>;

  /**
   * Quick health / availability check.
   * Called by GET /api/ai/providers to show status in the UI.
   */
  isAvailable(): Promise<AIAvailability>;
}

export interface AICompleteOptions {
  /** Optional system-level instruction. */
  systemPrompt?: string;
  /** The user-facing prompt. */
  userPrompt: string;
  /** Hard timeout in milliseconds (default: 60_000). */
  timeoutMs?: number;
  /**
   * Rough hint for the model — providers that support max_tokens use this.
   * Defaults to 2048.
   */
  maxTokens?: number;
}

export interface AIAvailability {
  ok: boolean;
  /** Human-readable status line shown in the UI. */
  detail?: string;
}

/** Metadata shape returned from GET /api/ai/providers */
export interface AIProviderInfo {
  id: string;
  name: string;
  type: 'cli' | 'api';
  active: boolean;
  availability?: AIAvailability;
}
