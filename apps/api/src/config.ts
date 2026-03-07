import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars'),
  DATA_DIR: z.string().default('/app/data'),
  PROJECTS_DIR: z.string().optional(),
  DOMAIN: z.string().default('localhost'),
  CODE_SERVER_HOST: z.string().default('code-server'),
  CODE_SERVER_PORT: z.coerce.number().int().positive().default(8080),
  REDIS_URL: z.string().default('redis://redis:6379'),
  API_KEY: z.string().optional(),
  GDRIVE_CREDENTIALS_PATH: z.string().optional(),
  GDRIVE_FOLDER_ID: z.string().optional(),
  GDRIVE_OAUTH_CLIENT_ID: z.string().optional(),
  GDRIVE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GDRIVE_OAUTH_REFRESH_TOKEN: z.string().optional(),
  // AI Provider — API keys (all optional; which one is used depends on the active provider setting)
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  GEMINI_CLI_BIN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  console.error('❌ Invalid environment variables:');
  console.error(result.error.flatten().fieldErrors);
  process.exit(1);
}

const data = result.data;

export const config = {
  env: data.NODE_ENV,
  port: data.PORT,
  sessionSecret: data.SESSION_SECRET,
  dataDir: data.DATA_DIR,
  projectsDir: data.PROJECTS_DIR ?? `${data.DATA_DIR}/projects`,
  domain: data.DOMAIN,
  codeServerHost: data.CODE_SERVER_HOST,
  codeServerPort: data.CODE_SERVER_PORT,
  codeServerUrl: `http://${data.CODE_SERVER_HOST}:${data.CODE_SERVER_PORT}`,
  redisUrl: data.REDIS_URL,
  apiKey: data.API_KEY,
  gdriveCredentialsPath: data.GDRIVE_CREDENTIALS_PATH ?? null,
  gdriveFolderId: data.GDRIVE_FOLDER_ID ?? null,
  gdriveOAuthClientId: data.GDRIVE_OAUTH_CLIENT_ID ?? null,
  gdriveOAuthClientSecret: data.GDRIVE_OAUTH_CLIENT_SECRET ?? null,
  gdriveOAuthRefreshToken: data.GDRIVE_OAUTH_REFRESH_TOKEN ?? null,
  // AI provider env vars are read directly by each provider class (process.env)
  // so they're listed in config only for reference / startup documentation.
  isProd: data.NODE_ENV === 'production',
} as const;
