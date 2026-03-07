/**
 * AI Provider Registry
 *
 * Maintains the map of all registered providers and resolves the active one.
 * The active provider ID is stored in the `settings` DB row: key = 'ai_provider'.
 *
 * To add a new provider:
 *   1. Implement AIProvider in a file under `lib/ai/providers/`
 *   2. Import and add it to BUILTIN_PROVIDERS below
 *   3. Done — it will appear in GET /api/ai/providers
 */
import type { AIProvider, AIProviderInfo } from './providers/base.js';
import { GeminiCliProvider } from './providers/gemini-cli.js';
import { GeminiApiProvider } from './providers/gemini-api.js';
import { OpenAIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { db } from '../../db/index.js';

// ─── Register providers here ─────────────────────────────────────────────────
const BUILTIN_PROVIDERS: AIProvider[] = [
  new GeminiCliProvider(),
  new GeminiApiProvider(),
  new OpenAIProvider(),
  new AnthropicProvider(),
];

// Allow runtime registration (e.g. in tests or plugins)
const runtimeProviders: AIProvider[] = [];

export function registerProvider(provider: AIProvider): void {
  if (runtimeProviders.some((p) => p.id === provider.id)) {
    throw new Error(`Provider '${provider.id}' is already registered`);
  }
  runtimeProviders.push(provider);
}

export function getAllProviders(): AIProvider[] {
  return [...BUILTIN_PROVIDERS, ...runtimeProviders];
}

export function getProviderById(id: string): AIProvider | undefined {
  return getAllProviders().find((p) => p.id === id);
}

// ─── Active provider ──────────────────────────────────────────────────────────

const SETTINGS_KEY = 'ai_provider';
const DEFAULT_PROVIDER_ID = 'gemini-cli';

export function getActiveProviderId(): string {
  const row = db
    .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
    .get(SETTINGS_KEY);
  return row?.value || DEFAULT_PROVIDER_ID;
}

export function setActiveProvider(id: string): void {
  if (!getProviderById(id)) {
    throw new Error(`Unknown provider ID: '${id}'`);
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTINGS_KEY, id);
}

export function getActiveProvider(): AIProvider {
  const id = getActiveProviderId();
  const provider = getProviderById(id);
  if (!provider) {
    // Fallback to first available
    const fallback = getAllProviders()[0];
    if (!fallback) throw new Error('No AI providers registered');
    return fallback;
  }
  return provider;
}

// ─── Info helpers ─────────────────────────────────────────────────────────────

export async function getAllProviderInfo(): Promise<AIProviderInfo[]> {
  const activeId = getActiveProviderId();
  return Promise.all(
    getAllProviders().map(async (p): Promise<AIProviderInfo> => {
      const info: AIProviderInfo = {
        id: p.id,
        name: p.name,
        type: p.type,
        active: p.id === activeId,
        availability: await p.isAvailable(),
      };
      return info;
    })
  );
}
