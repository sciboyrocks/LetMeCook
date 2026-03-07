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

export function getActiveProviderId(): string | null {
  const row = db
    .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
    .get(SETTINGS_KEY);
  return row?.value || null;
}

export function setActiveProvider(id: string): void {
  if (!getProviderById(id)) {
    throw new Error(`Unknown provider ID: '${id}'`);
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTINGS_KEY, id);
}

export function getActiveProvider(): AIProvider {
  const id = getActiveProviderId();
  if (!id) {
    throw new Error('No AI provider selected. Please choose a provider from the Connections page.');
  }
  const provider = getProviderById(id);
  if (!provider) {
    throw new Error(`Unknown provider ID: '${id}'`);
  }
  return provider;
}

// ─── API Key management ──────────────────────────────────────────────────────

const API_KEY_PREFIX = 'ai_key_';

/** Get the API key for a provider: DB first, then env var fallback. */
export function getProviderApiKey(providerId: string): string {
  const row = db
    .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
    .get(`${API_KEY_PREFIX}${providerId}`);
  if (row?.value) return row.value;

  // Env var fallback
  const envMap: Record<string, string | undefined> = {
    'gemini-api': process.env.GEMINI_API_KEY,
    'openai': process.env.OPENAI_API_KEY,
    'anthropic': process.env.ANTHROPIC_API_KEY,
  };
  return envMap[providerId] ?? '';
}

/** Set (or overwrite) the API key for a provider in the DB. */
export function setProviderApiKey(providerId: string, apiKey: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    `${API_KEY_PREFIX}${providerId}`,
    apiKey,
  );
}

/** Remove the stored API key for a provider from the DB. */
export function clearProviderApiKey(providerId: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(`${API_KEY_PREFIX}${providerId}`);
}

/** Check if a provider has an API key set (either DB or env). */
export function hasProviderApiKey(providerId: string): boolean {
  return getProviderApiKey(providerId).length > 0;
}

/** Return a masked version of the key for display (first 4 + last 4 chars). */
export function getMaskedApiKey(providerId: string): string | null {
  const key = getProviderApiKey(providerId);
  if (!key) return null;
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}${'•'.repeat(Math.min(key.length - 8, 20))}${key.slice(-4)}`;
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
